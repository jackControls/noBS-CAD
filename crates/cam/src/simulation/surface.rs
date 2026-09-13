//! Bounded display reconstruction from the executed cutter sweeps. Numerical
//! stock, volume measurements and verification are never modified.
use super::*;
use crate::cutter::{CutterProfile, CutterSurface};
use std::cell::Cell;
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

mod detail;
#[cfg(test)]
mod tests;

// Retained by the existing byte-bounded checkpoint cache. A BVH replaces the
// XY bucket references, whose memory/work exploded with large face mills.
const MAX_SWEEPS: usize = 2048;
const MAX_VERTICES: usize = 65_536;
const MAX_SAMPLES: usize = 16_384;
const MAX_FIELD_EVALUATIONS: usize = 4_000_000;
pub(super) const WORK_LIMIT: &str = "stock display refinement work budget reached";

#[derive(Clone, PartialEq)]
struct CutterSweep {
    from: Point3Dto,
    to: Point3Dto,
    radius: f64,
    flute: f64,
    profile: CutterProfile,
    arc: Option<ArcSweep>,
}

#[derive(Clone, PartialEq)]
pub(super) struct StockBoundary {
    min: [f64; 3],
    max: [f64; 3],
    shape: CamResolvedStockDto,
}

impl StockBoundary {
    pub fn new(spec: &GridSpec, shape: CamResolvedStockDto) -> Self {
        let min = [spec.min.x, spec.min.y, spec.min.z];
        Self {
            min,
            max: std::array::from_fn(|i| min[i] + spec.cell_size[i] * spec.dimensions[i] as f64),
            shape,
        }
    }

    fn components(&self) -> u8 {
        match self.shape {
            CamResolvedStockDto::Cylinder { .. } => 7,
            CamResolvedStockDto::Hex { .. } => 9,
            _ => 6,
        }
    }

    fn component(&self, id: u8, p: [f64; 3]) -> (f64, [f64; 3]) {
        if id < 6 {
            let axis = id as usize / 2;
            let sign = if id % 2 == 0 { -1. } else { 1. };
            let mut normal = [0.; 3];
            normal[axis] = sign;
            return (
                if sign < 0. {
                    self.min[axis] - p[axis]
                } else {
                    p[axis] - self.max[axis]
                },
                normal,
            );
        }
        match self.shape {
            CamResolvedStockDto::Cylinder { center, radius } => {
                let x = p[0] - center.x;
                let y = p[1] - center.y;
                let length = x.hypot(y);
                (
                    length - radius,
                    [x / length.max(EPSILON), y / length.max(EPSILON), 0.],
                )
            }
            CamResolvedStockDto::Hex {
                center,
                across_flats,
            } => {
                let normal = match id {
                    6 => [1., 0., 0.],
                    7 => [0.5, 0.866_025_403_784_438_6, 0.],
                    _ => [0.5, -0.866_025_403_784_438_6, 0.],
                };
                let d = normal[0] * (p[0] - center.x) + normal[1] * (p[1] - center.y);
                (
                    d.abs() - across_flats * 0.5,
                    normal.map(|v| v * if d < 0. { -1. } else { 1. }),
                )
            }
            _ => unreachable!("only analytic stock has extra boundary components"),
        }
    }
}

#[derive(Clone, Default, PartialEq)]
pub(super) struct DisplayCuts {
    sweeps: Vec<CutterSweep>,
    pub initial: Option<StockBoundary>,
    pub limited: bool,
}

impl DisplayCuts {
    pub fn is_empty(&self) -> bool {
        self.sweeps.is_empty()
    }
    pub fn bytes(&self) -> usize {
        self.sweeps.capacity() * std::mem::size_of::<CutterSweep>()
    }

    pub fn record(&mut self, tool: &CamToolDto, from: Point3Dto, to: Point3Dto) {
        if self.limited {
            return;
        }
        let Ok(profile) = CutterProfile::new(tool.into()) else {
            self.limited = true;
            return;
        };
        let vertical = (from.x - to.x).abs() < EPSILON && (from.y - to.y).abs() < EPSILON;
        if vertical {
            if let Some(old) = self.sweeps.iter_mut().find(|old| {
                old.arc.is_none()
                    && old.profile == profile
                    && old.from.x == from.x
                    && old.to.x == from.x
                    && old.from.y == from.y
                    && old.to.y == from.y
                    // Tip travel intervals must overlap. Overlapping flutes
                    // alone do not prove that a shaped tip crossed the gap.
                    && from.z.min(to.z) <= old.from.z.max(old.to.z) + EPSILON
                    && from.z.max(to.z) + EPSILON >= old.from.z.min(old.to.z)
            }) {
                let low = old.from.z.min(old.to.z).min(from.z).min(to.z);
                let high = old.from.z.max(old.to.z).max(from.z).max(to.z);
                old.from.z = low;
                old.to.z = high;
                return;
            }
        }
        self.push(CutterSweep {
            from,
            to,
            radius: tool.diameter * 0.5,
            flute: tool.flute_length,
            profile,
            arc: None,
        });
    }

    fn push(&mut self, sweep: CutterSweep) {
        if self.sweeps.len() == MAX_SWEEPS {
            // Never reconstruct an incomplete union: doing so can put stock
            // back where a later operation has already cut it away.
            self.limited = true;
        } else if !self.limited {
            self.sweeps.push(sweep);
        }
    }

    pub fn record_arc(&mut self, tool: &CamToolDto, arc: &ArcSweep, tolerance: f64) {
        if self.limited {
            return;
        }
        if arc.plane == CamArcPlane::Xy && (arc.start_w - arc.end_w).abs() <= EPSILON {
            let Ok(profile) = CutterProfile::new(tool.into()) else {
                self.limited = true;
                return;
            };
            self.push(CutterSweep {
                from: arc.point(0.),
                to: arc.point(1.),
                radius: tool.diameter * 0.5,
                flute: tool.flute_length,
                profile,
                arc: Some(arc.clone()),
            });
        } else {
            // Vertical leads/helices use a model-relative bounded chord error.
            // Removal and verification still sample the true physical arc.
            // 1-cos(theta/2) <= theta²/8 also avoids cancellation in acos
            // for a large arc radius and a very small display tolerance.
            let angle = (8. * tolerance / arc.radius)
                .sqrt()
                .min(std::f64::consts::FRAC_PI_4);
            if !angle.is_finite() || angle <= 0. {
                self.limited = true;
                return;
            }
            let count = (arc.sweep.abs() / angle).ceil().max(1.) as usize;
            if count > 256 || self.sweeps.len().saturating_add(count) > MAX_SWEEPS {
                self.limited = true;
                return;
            }
            for i in 0..count {
                self.record(
                    tool,
                    arc.point(i as f64 / count as f64),
                    arc.point((i + 1) as f64 / count as f64),
                );
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum Feature {
    Stock(u8),
    Cut(usize, CutterSurface),
}

#[derive(Clone, Copy)]
struct Sample {
    distance: f64,
    normal: [f64; 3],
    feature: Feature,
}

#[derive(Clone, Copy)]
struct Bounds {
    min: [f64; 3],
    max: [f64; 3],
}

impl Bounds {
    fn union(self, other: Self) -> Self {
        Self {
            min: std::array::from_fn(|i| self.min[i].min(other.min[i])),
            max: std::array::from_fn(|i| self.max[i].max(other.max[i])),
        }
    }
    // Conservative signed lower bound, including points inside a BVH node.
    fn lower_bound(self, p: [f64; 3]) -> f64 {
        (0..3)
            .map(|i| (self.min[i] - p[i]).max(p[i] - self.max[i]))
            .fold(f64::NEG_INFINITY, f64::max)
    }
}

struct Node {
    bounds: Bounds,
    centers: Bounds,
    children: Option<[usize; 2]>,
    sweep: usize,
    uniform: bool,
}

/// Extraction-local, direct-mapped memoization. Collisions replace an entry,
/// never change the result. Unlike a fill-once map, later slices and the detail
/// pass still get useful caching after a tall part has visited 65k vertices.
struct Memo<K, V> {
    slots: Vec<Cell<Option<(K, V)>>>,
}

impl<K: Copy + Eq + Hash, V: Copy> Memo<K, V> {
    fn new(capacity: usize) -> Self {
        debug_assert!(capacity == 0 || capacity.is_power_of_two());
        Self {
            slots: vec![Cell::new(None); capacity],
        }
    }
    fn index(&self, key: &K) -> Option<usize> {
        if self.slots.is_empty() {
            return None;
        }
        let mut hasher = DefaultHasher::new();
        key.hash(&mut hasher);
        Some(hasher.finish() as usize & (self.slots.len() - 1))
    }
    fn get(&self, key: K) -> Option<V> {
        self.slots[self.index(&key)?]
            .get()
            .and_then(|(stored, value)| (stored == key).then_some(value))
    }
    fn insert(&self, key: K, value: V) {
        if let Some(index) = self.index(&key) {
            self.slots[index].set(Some((key, value)));
        }
    }
}

pub(super) struct Refiner<'a> {
    cuts: &'a DisplayCuts,
    nodes: Vec<Node>,
    root: usize,
    band: f64,
    evaluations: Cell<usize>,
    vertices: Memo<[u64; 6], Option<([f64; 3], [f32; 3])>>,
    samples: Memo<[u64; 3], Option<Sample>>,
}

impl<'a> Refiner<'a> {
    pub fn new(cuts: &'a DisplayCuts, cell_size: [f64; 3]) -> Self {
        let enabled = !cuts.limited && !cuts.sweeps.is_empty();
        let mut result = Self {
            cuts,
            nodes: Vec::with_capacity(cuts.sweeps.len() * 2),
            root: 0,
            band: cell_size.iter().map(|v| v * v).sum::<f64>().sqrt() * 0.85,
            vertices: Memo::new(if enabled { MAX_VERTICES } else { 0 }),
            samples: Memo::new(if enabled { MAX_SAMPLES } else { 0 }),
            evaluations: Cell::new(0),
        };
        if enabled {
            // For one profile at one Z interval, the meridian field is
            // monotone in radial distance: min_i f(r_i,z) = f(min_i r_i,z).
            // Search its center paths once rather than evaluating every
            // overlapping cutter volume around a pocket/chamfer loop.
            let mut groups = Vec::<Vec<usize>>::new();
            for (index, sweep) in cuts.sweeps.iter().enumerate() {
                if let Some(group) = groups
                    .iter_mut()
                    .find(|group| sweep.same_section(&cuts.sweeps[group[0]]))
                {
                    group.push(index);
                } else {
                    groups.push(vec![index]);
                }
            }
            let mut roots: Vec<_> = groups.iter_mut().map(|group| result.build(group)).collect();
            result.root = result.join_groups(&mut roots);
        }
        result
    }

    pub fn analytic_stock(&self) -> bool {
        self.cuts.initial.is_some() && !self.cuts.limited && !self.nodes.is_empty()
    }

    pub fn exhausted(&self) -> bool {
        self.evaluations.get() > MAX_FIELD_EVALUATIONS
    }

    fn charge(&self, index: usize) -> bool {
        let sweep = &self.cuts.sweeps[index];
        let sloped = (sweep.from.z - sweep.to.z).abs() > EPSILON
            && ((sweep.from.x - sweep.to.x).abs() > EPSILON
                || (sweep.from.y - sweep.to.y).abs() > EPSILON);
        let cost = if sloped { 40 } else { 1 };
        self.evaluations
            .set(self.evaluations.get().saturating_add(cost));
        !self.exhausted()
    }

    fn build(&mut self, indices: &mut [usize]) -> usize {
        let bounds = indices
            .iter()
            .map(|&i| self.cuts.sweeps[i].bounds())
            .reduce(Bounds::union)
            .unwrap();
        let index = self.nodes.len();
        self.nodes.push(Node {
            bounds,
            centers: indices
                .iter()
                .map(|&i| self.cuts.sweeps[i].center_bounds())
                .reduce(Bounds::union)
                .unwrap(),
            children: None,
            sweep: indices[0],
            uniform: true,
        });
        if indices.len() > 1 {
            let axis = (0..3)
                .max_by(|&a, &b| {
                    (bounds.max[a] - bounds.min[a]).total_cmp(&(bounds.max[b] - bounds.min[b]))
                })
                .unwrap();
            indices.sort_unstable_by(|&a, &b| {
                let ab = self.cuts.sweeps[a].bounds();
                let bb = self.cuts.sweeps[b].bounds();
                (ab.min[axis] + ab.max[axis])
                    .total_cmp(&(bb.min[axis] + bb.max[axis]))
                    .then(a.cmp(&b))
            });
            let (left, right) = indices.split_at_mut(indices.len() / 2);
            let children = [self.build(left), self.build(right)];
            self.nodes[index].children = Some(children);
        }
        index
    }

    fn join_groups(&mut self, roots: &mut [usize]) -> usize {
        if roots.len() == 1 {
            return roots[0];
        }
        let bounds = roots
            .iter()
            .map(|&i| self.nodes[i].bounds)
            .reduce(Bounds::union)
            .unwrap();
        let axis = (0..3)
            .max_by(|&a, &b| {
                (bounds.max[a] - bounds.min[a]).total_cmp(&(bounds.max[b] - bounds.min[b]))
            })
            .unwrap();
        roots.sort_by(|&a, &b| {
            (self.nodes[a].bounds.min[axis] + self.nodes[a].bounds.max[axis])
                .total_cmp(&(self.nodes[b].bounds.min[axis] + self.nodes[b].bounds.max[axis]))
                .then(a.cmp(&b))
        });
        let (a, b) = roots.split_at_mut(roots.len() / 2);
        let children = [self.join_groups(a), self.join_groups(b)];
        let index = self.nodes.len();
        self.nodes.push(Node {
            bounds,
            centers: bounds,
            children: Some(children),
            sweep: 0,
            uniform: false,
        });
        index
    }

    fn nearest_center(
        &self,
        index: usize,
        p: [f64; 3],
        limit_squared: f64,
        nearest: &mut Option<(usize, Point3Dto, f64, f64)>,
    ) {
        if self.exhausted() {
            return;
        }
        let node = &self.nodes[index];
        let distance = |bounds: Bounds| {
            (0..2)
                .map(|i| {
                    (bounds.min[i] - p[i])
                        .max(p[i] - bounds.max[i])
                        .max(0.)
                        .powi(2)
                })
                .sum::<f64>()
        };
        if distance(node.centers) > nearest.map_or(limit_squared, |(_, _, _, d)| d) {
            return;
        }
        if let Some([a, b]) = node.children {
            let order = if distance(self.nodes[a].centers) <= distance(self.nodes[b].centers) {
                [a, b]
            } else {
                [b, a]
            };
            self.nearest_center(order[0], p, limit_squared, nearest);
            self.nearest_center(order[1], p, limit_squared, nearest);
        } else if self.charge(node.sweep) {
            let (center, extension) = self.cuts.sweeps[node.sweep].closest(p);
            let d = (p[0] - center.x).powi(2) + (p[1] - center.y).powi(2);
            if d <= limit_squared
                && nearest
                    .is_none_or(|(index, _, _, best)| d < best || (d == best && node.sweep < index))
            {
                *nearest = Some((node.sweep, center, extension, d));
            }
        }
    }

    fn visit(&self, index: usize, point: [f64; 3], best: &mut Sample) {
        if self.exhausted() {
            return;
        }
        let node = &self.nodes[index];
        if node.bounds.lower_bound(point) > best.distance {
            return;
        }
        if node.uniform && node.children.is_some() {
            let sweep = &self.cuts.sweeps[node.sweep];
            let z = point[2] - sweep.from.z.min(sweep.to.z);
            let extension = (sweep.from.z - sweep.to.z).abs();
            let Some(radius) = sweep
                .profile
                .radial_extent_at_field(z, extension, best.distance)
            else {
                return;
            };
            let mut nearest = None;
            self.nearest_center(index, point, (radius + EPSILON).powi(2), &mut nearest);
            if let Some((sweep, center, extension, _)) = nearest {
                let candidate =
                    self.cuts.sweeps[sweep].sample_at(point, center, extension, sweep, None);
                if candidate.distance < best.distance
                    || (candidate.distance == best.distance && candidate.feature < best.feature)
                {
                    *best = candidate;
                }
            }
        } else if let Some([a, b]) = node.children {
            let order = if self.nodes[a].bounds.lower_bound(point)
                <= self.nodes[b].bounds.lower_bound(point)
            {
                [a, b]
            } else {
                [b, a]
            };
            self.visit(order[0], point, best);
            self.visit(order[1], point, best);
        } else {
            if !self.charge(node.sweep) {
                return;
            }
            let candidate = self.cuts.sweeps[node.sweep].sample(point, node.sweep, None);
            if candidate.distance < best.distance
                || (candidate.distance == best.distance && candidate.feature < best.feature)
            {
                *best = candidate;
            }
        }
    }

    fn sample(&self, point: [f64; 3]) -> Option<Sample> {
        if self.cuts.limited || self.nodes.is_empty() || self.exhausted() {
            return None;
        }
        let key = point.map(f64::to_bits);
        if let Some(value) = self.samples.get(key) {
            return value;
        }
        let value = self.sample_uncached(point);
        self.samples.insert(key, value);
        value
    }

    fn sample_uncached(&self, point: [f64; 3]) -> Option<Sample> {
        let mut cut = Sample {
            distance: self.band * 2.,
            normal: [0.; 3],
            feature: Feature::Cut(usize::MAX, CutterSurface::Bottom),
        };
        self.visit(self.root, point, &mut cut);
        if self.exhausted() {
            return None;
        }
        let found = !matches!(cut.feature, Feature::Cut(usize::MAX, _));
        let mut stock = if let Some(initial) = &self.cuts.initial {
            (0..initial.components())
                .map(|id| {
                    let (distance, normal) = initial.component(id, point);
                    Sample {
                        distance,
                        normal,
                        feature: Feature::Stock(id),
                    }
                })
                .max_by(|a, b| a.distance.total_cmp(&b.distance))
                .unwrap()
        } else {
            if !found {
                return None;
            }
            Sample {
                distance: f64::NEG_INFINITY,
                normal: [0.; 3],
                feature: cut.feature,
            }
        };
        if found && -cut.distance > stock.distance {
            stock = Sample {
                distance: -cut.distance,
                normal: cut.normal.map(|v| -v),
                feature: cut.feature,
            };
        }
        Some(stock)
    }

    fn component(&self, feature: Feature, p: [f64; 3]) -> Sample {
        match feature {
            Feature::Stock(id) => {
                let (distance, normal) = self.cuts.initial.as_ref().unwrap().component(id, p);
                Sample {
                    distance,
                    normal,
                    feature,
                }
            }
            Feature::Cut(index, part) => {
                if !self.charge(index) {
                    return Sample {
                        distance: 0.,
                        normal: [0.; 3],
                        feature,
                    };
                }
                let sample = self.cuts.sweeps[index].sample(p, index, Some(part));
                Sample {
                    distance: -sample.distance,
                    normal: sample.normal.map(|v| -v),
                    feature,
                }
            }
        }
    }

    pub fn project(&self, point: [f64; 3]) -> Option<([f64; 3], [f32; 3])> {
        let sample = self.sample(point)?;
        if !sample.distance.is_finite() || sample.distance.abs() > self.band {
            return None;
        }
        let length_squared = dot(sample.normal, sample.normal);
        if length_squared < EPSILON {
            return None;
        }
        Some((
            std::array::from_fn(|i| point[i] - sample.distance * sample.normal[i] / length_squared),
            sample.normal.map(|v| (v / length_squared.sqrt()) as f32),
        ))
    }

    pub fn project_in_cell(&self, raw: [f64; 3], cell: [f64; 3]) -> Option<([f64; 3], [f32; 3])> {
        let key = [
            raw[0].to_bits(),
            raw[1].to_bits(),
            raw[2].to_bits(),
            cell[0].to_bits(),
            cell[1].to_bits(),
            cell[2].to_bits(),
        ];
        if let Some(value) = self.vertices.get(key) {
            return value;
        }
        let value = self.project_cell_uncached(raw, cell);
        self.vertices.insert(key, value);
        value
    }

    fn project_cell_uncached(&self, raw: [f64; 3], cell: [f64; 3]) -> Option<([f64; 3], [f32; 3])> {
        let inside = |p: [f64; 3]| (0..3).all(|i| (p[i] - raw[i]).abs() <= cell[i] * 0.5 + 1e-8);
        let nearest = self.project(raw)?;
        // Analytic stock needs the intersections even when nearest fits: the
        // cell may contain both a top/bevel and a bevel/wall crease.
        if self.cuts.initial.is_none() && inside(nearest.0) {
            return Some(nearest);
        }
        let corners: [[f64; 3]; 8] = std::array::from_fn(|bits| {
            std::array::from_fn(|i| {
                raw[i] + (if bits & (1 << i) == 0 { -0.5 } else { 0.5 }) * cell[i]
            })
        });
        let mut fields = [0.; 8];
        let mut common_feature = None;
        let mut same_feature = true;
        for i in 0..8 {
            let s = self.sample(corners[i])?;
            fields[i] = s.distance;
            if i == 0 {
                common_feature = Some(s.feature);
            } else {
                same_feature &= common_feature == Some(s.feature);
            }
        }
        if same_feature && inside(nearest.0) {
            return Some(nearest);
        }
        let mut crossings = Vec::with_capacity(12);
        for axis in 0..3 {
            for i in 0..8 {
                if i & (1 << axis) != 0 {
                    continue;
                }
                let j = i | (1 << axis);
                if (fields[i] < 0.) == (fields[j] < 0.) {
                    continue;
                }
                let mut lo = corners[i];
                let mut hi = corners[j];
                let mut a = fields[i];
                let mut b = fields[j];
                for iteration in 0..20 {
                    let t = if iteration % 2 == 0 {
                        (a / (a - b)).clamp(0.05, 0.95)
                    } else {
                        0.5
                    };
                    let mid = std::array::from_fn(|k| lo[k] + (hi[k] - lo[k]) * t);
                    let d = self.sample(mid)?.distance;
                    if d.abs() < 1e-10 {
                        lo = mid;
                        hi = mid;
                        break;
                    }
                    if (d < 0.) == (a < 0.) {
                        lo = mid;
                        a = d;
                    } else {
                        hi = mid;
                        b = d;
                    }
                }
                let point = if a.abs() <= b.abs() { lo } else { hi };
                crossings.push((point, self.sample(point)?));
            }
        }
        if crossings.is_empty() {
            return inside(nearest.0).then_some(nearest);
        }
        let center = std::array::from_fn(|i| {
            crossings.iter().map(|(p, _)| p[i]).sum::<f64>() / crossings.len() as f64
        });
        let mut features = Vec::with_capacity(3);
        for (_, sample) in &crossings {
            if !features.contains(&sample.feature) {
                features.push(sample.feature);
            }
        }
        // Tangent-plane least squares preserves intersections; averaging the
        // crossings alone rounds a rim and makes a thin bevel look melted.
        let planes: Vec<_> = crossings
            .iter()
            .map(|(p, s)| (s.normal, dot(s.normal, sub(*p, center))))
            .collect();
        let qef = add(center, solve_planes(&planes));
        let point = self.project_features(qef, &features);
        if inside(point) && self.sample(point)?.distance.abs() < self.band * 1e-5 {
            return Some((point, self.sample(point)?.normal.map(|v| v as f32)));
        }
        let projected = self.project(center)?;
        if inside(projected.0) && self.sample(projected.0)?.distance.abs() < self.band * 1e-5 {
            return Some(projected);
        }
        // Mandatory dual-cell bound: no folded quads or spikes at cone tips,
        // intersecting cuts, or features that the occupancy grid cannot resolve.
        let (point, sample) = crossings.into_iter().min_by(|(a, _), (b, _)| {
            dot(sub(*a, raw), sub(*a, raw)).total_cmp(&dot(sub(*b, raw), sub(*b, raw)))
        })?;
        Some((point, sample.normal.map(|v| v as f32)))
    }

    fn project_features(&self, mut point: [f64; 3], features: &[Feature]) -> [f64; 3] {
        for _ in 0..5 {
            let planes: Vec<_> = features
                .iter()
                .map(|&f| {
                    let s = self.component(f, point);
                    (s.normal, -s.distance)
                })
                .collect();
            let delta = solve_planes(&planes);
            point = add(point, delta);
            if dot(delta, delta) < 1e-20 {
                break;
            }
        }
        point
    }
}

#[cfg(test)]
impl Drop for Refiner<'_> {
    fn drop(&mut self) {
        if std::env::var_os("NBCAD_CAM_DETAIL_CAPTURE").is_some() {
            let bytes = std::mem::size_of_val(self.vertices.slots.as_slice())
                + std::mem::size_of_val(self.samples.slots.as_slice());
            eprintln!(
                "Display work: {} / {} units; {} sweeps; {:.2} MiB extraction-local memo storage",
                self.evaluations.get(),
                MAX_FIELD_EVALUATIONS,
                self.cuts.sweeps.len(),
                bytes as f64 / 1_048_576.
            );
        }
    }
}

impl CutterSweep {
    fn same_section(&self, other: &Self) -> bool {
        let straight_section = |s: &Self| {
            (s.from.z - s.to.z).abs() <= EPSILON || (s.from.x == s.to.x && s.from.y == s.to.y)
        };
        straight_section(self)
            && straight_section(other)
            && self.profile == other.profile
            && self.from.z.min(self.to.z) == other.from.z.min(other.to.z)
            && self.from.z.max(self.to.z) == other.from.z.max(other.to.z)
    }

    fn center_bounds(&self) -> Bounds {
        let (min, max) = if let Some(arc) = &self.arc {
            // Only the executed arc, not its entire parent circle. Whole-circle
            // bounds make short corner rolls overlap most of a small part and
            // defeat the BVH even though the tool never reaches those regions.
            let mut min = [self.from.x.min(self.to.x), self.from.y.min(self.to.y)];
            let mut max = [self.from.x.max(self.to.x), self.from.y.max(self.to.y)];
            for quadrant in 0..4 {
                let angle = quadrant as f64 * std::f64::consts::FRAC_PI_2;
                let delta = if arc.sweep >= 0. {
                    (angle - arc.start_angle).rem_euclid(std::f64::consts::TAU)
                } else {
                    (arc.start_angle - angle).rem_euclid(std::f64::consts::TAU)
                };
                if delta <= arc.sweep.abs() + EPSILON {
                    let p = [
                        arc.center_u + arc.radius * angle.cos(),
                        arc.center_v + arc.radius * angle.sin(),
                    ];
                    for i in 0..2 {
                        min[i] = min[i].min(p[i]);
                        max[i] = max[i].max(p[i]);
                    }
                }
            }
            (min.map(|v| v - EPSILON), max.map(|v| v + EPSILON))
        } else {
            (
                [self.from.x.min(self.to.x), self.from.y.min(self.to.y)],
                [self.from.x.max(self.to.x), self.from.y.max(self.to.y)],
            )
        };
        Bounds {
            min: [min[0], min[1], self.from.z.min(self.to.z)],
            max: [max[0], max[1], self.from.z.max(self.to.z)],
        }
    }

    fn bounds(&self) -> Bounds {
        let mut b = self.center_bounds();
        for i in 0..2 {
            b.min[i] -= self.radius;
            b.max[i] += self.radius;
        }
        b.max[2] += self.flute;
        b
    }

    fn closest(&self, point: [f64; 3]) -> (Point3Dto, f64) {
        if let Some(arc) = &self.arc {
            let angle = (point[1] - arc.center_v).atan2(point[0] - arc.center_u);
            let delta = if arc.sweep >= 0. {
                (angle - arc.start_angle).rem_euclid(std::f64::consts::TAU)
            } else {
                (arc.start_angle - angle).rem_euclid(std::f64::consts::TAU)
            };
            let closest = if delta <= arc.sweep.abs() {
                arc.point((delta / arc.sweep.abs()).clamp(0., 1.))
            } else {
                let a = arc.point(0.);
                let b = arc.point(1.);
                if (point[0] - a.x).hypot(point[1] - a.y) < (point[0] - b.x).hypot(point[1] - b.y) {
                    a
                } else {
                    b
                }
            };
            return (closest, 0.);
        }
        let dx = self.to.x - self.from.x;
        let dy = self.to.y - self.from.y;
        let length_sq = dx * dx + dy * dy;
        if length_sq < EPSILON {
            return (
                Point3Dto::new(self.from.x, self.from.y, self.from.z.min(self.to.z)),
                (self.to.z - self.from.z).abs(),
            );
        }
        let t = (((point[0] - self.from.x) * dx + (point[1] - self.from.y) * dy) / length_sq)
            .clamp(0., 1.);
        if (self.to.z - self.from.z).abs() < EPSILON {
            return (lerp(self.from, self.to, t), 0.);
        }
        // A linear sweep of the convex cutter envelope is convex. Minimize
        // the signed field along the segment to retain actual sloping leads.
        let at = |t| {
            let p = lerp(self.from, self.to, t);
            self.profile
                .surface_at((point[0] - p.x).hypot(point[1] - p.y), point[2] - p.z, 0.)
                .0
        };
        let mut lo = 0.;
        let mut hi = 1.;
        let ratio = 0.618_033_988_749_894_9;
        let mut a = hi - (hi - lo) * ratio;
        let mut b = lo + (hi - lo) * ratio;
        let mut fa = at(a);
        let mut fb = at(b);
        for _ in 0..22 {
            if fa < fb {
                hi = b;
                b = a;
                fb = fa;
                a = hi - (hi - lo) * ratio;
                fa = at(a);
            } else {
                lo = a;
                a = b;
                fa = fb;
                b = lo + (hi - lo) * ratio;
                fb = at(b);
            }
        }
        let t = [0., 1., t, (lo + hi) * 0.5]
            .into_iter()
            .min_by(|&a, &b| at(a).total_cmp(&at(b)))
            .unwrap();
        (lerp(self.from, self.to, t), 0.)
    }

    fn sample(&self, point: [f64; 3], index: usize, component: Option<CutterSurface>) -> Sample {
        let (closest, extension) = self.closest(point);
        self.sample_at(point, closest, extension, index, component)
    }

    fn sample_at(
        &self,
        point: [f64; 3],
        closest: Point3Dto,
        extension: f64,
        index: usize,
        component: Option<CutterSurface>,
    ) -> Sample {
        let x = point[0] - closest.x;
        let y = point[1] - closest.y;
        let radial = x.hypot(y);
        let z = point[2] - closest.z;
        let (distance, normal, part) = component.map_or_else(
            || self.profile.surface_at(radial, z, extension),
            |part| {
                let (d, n) = self.profile.surface_component(part, radial, z, extension);
                (d, n, part)
            },
        );
        Sample {
            distance,
            normal: [
                normal[0] * x / radial.max(EPSILON),
                normal[0] * y / radial.max(EPSILON),
                normal[1],
            ],
            feature: Feature::Cut(index, part),
        }
    }
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] + b[i])
}

// Regularized 3x3 least squares. Unconstrained directions stay at the mass
// point rather than flying off toward the origin on nearly parallel normals.
fn solve_planes(planes: &[([f64; 3], f64)]) -> [f64; 3] {
    let mut m = [[0.; 4]; 3];
    for (n, d) in planes {
        for i in 0..3 {
            for j in 0..3 {
                m[i][j] += n[i] * n[j];
            }
            m[i][3] += n[i] * d;
        }
    }
    for (i, row) in m.iter_mut().enumerate() {
        row[i] += 1e-6;
    }
    for i in 0..3 {
        let pivot = (i..3)
            .max_by(|&a, &b| m[a][i].abs().total_cmp(&m[b][i].abs()))
            .unwrap();
        m.swap(i, pivot);
        let scale = m[i][i];
        for j in i..4 {
            m[i][j] /= scale;
        }
        for k in 0..3 {
            if k == i {
                continue;
            }
            let factor = m[k][i];
            for j in i..4 {
                m[k][j] -= factor * m[i][j];
            }
        }
    }
    std::array::from_fn(|i| m[i][3])
}
