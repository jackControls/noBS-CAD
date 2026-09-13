//! Continuous exterior clearing with a conservative convex remaining-stock
//! certificate. This is a generic convex-envelope fast path, not a rectangle
//! special case. Concavities and cavities are left to the checked fallback.
//!
//! Let H contain the protected target section and stock S be contained in
//! H (+) disk(B). A closed tool-center offset at d = B + R - e sweeps every
//! point with d-R <= distance(point,H) <= d+R. After the loop, remaining
//! stock is therefore contained in H (+) disk(B-e).
//!
//! At every offset point, a supporting normal n bounds old stock by
//! n.(p-center) <= -(R-e). The back half of a moving cutter is already swept
//! by its infinitesimally preceding positions; intersecting the front half
//! with that supporting half-plane bounds engagement by acos(1-e/R).
//! Tangent straight entries from air obey the same half-plane inequality.
//! Convex offset lines/arcs are C1, so the bound holds through corners too.

use super::{
    dist, subtract_arc, CamPlanError, CamSetupDto, Envelope, Point2Dto, Point3Dto, ProgramBuilder,
    Work, EPS,
};
use crate::model::CamAdaptiveParametersDto;

const MAX_HULL_POINTS: usize = 16_384;
const MAX_HULL_VERTICES: usize = 256;
const MAX_PASSES: usize = 2048;
/// Numeric slack, separate from the user's material allowance and grid error.
const CLEARANCE_GUARD: f64 = 1e-4;

fn cross(a: Point2Dto, b: Point2Dto, c: Point2Dto) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
fn point_segment(p: Point2Dto, a: Point2Dto, b: Point2Dto) -> f64 {
    let (x, y) = (b.x - a.x, b.y - a.y);
    let t = (((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y).max(EPS * EPS)).clamp(0.0, 1.0);
    (p.x - a.x - t * x).hypot(p.y - a.y - t * y)
}
fn segment_distance(a: Point2Dto, b: Point2Dto, c: Point2Dto, d: Point2Dto) -> f64 {
    if cross(a, b, c) * cross(a, b, d) < 0.0 && cross(c, d, a) * cross(c, d, b) < 0.0 {
        return 0.0;
    }
    point_segment(a, c, d)
        .min(point_segment(b, c, d))
        .min(point_segment(c, a, b))
        .min(point_segment(d, a, b))
}

#[derive(Clone)]
pub(super) struct ConvexStock {
    hull: Vec<Point2Dto>, // CCW; collinear interior points removed.
    normals: Vec<Point2Dto>,
    pub(super) offset: f64,
}

impl ConvexStock {
    fn from_points(mut points: Vec<Point2Dto>, offset: f64) -> Option<Self> {
        points.sort_by(|a, b| a.x.total_cmp(&b.x).then_with(|| a.y.total_cmp(&b.y)));
        points.dedup();
        if points.len() < 3 {
            return None;
        }
        let mut hull = Vec::new();
        for &p in &points {
            // Do not use a positive simplification epsilon: that could
            // replace a slightly convex corner by an inward chord.
            while hull.len() >= 2 && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0 {
                hull.pop();
            }
            hull.push(p);
        }
        let lower = hull.len();
        for &p in points[..points.len() - 1].iter().rev() {
            while hull.len() > lower && cross(hull[hull.len() - 2], hull[hull.len() - 1], p) <= 0.0
            {
                hull.pop();
            }
            hull.push(p);
        }
        hull.pop();
        if hull.len() < 3 || hull.len() > MAX_HULL_VERTICES {
            return None;
        }
        let normals = (0..hull.len())
            .map(|i| {
                let a = hull[i];
                let b = hull[(i + 1) % hull.len()];
                let length = dist(a, b);
                Point2Dto::new((b.y - a.y) / length, (a.x - b.x) / length)
            })
            .collect();
        Some(Self {
            hull,
            normals,
            offset,
        })
    }

    pub(super) fn from_envelope(
        e: &Envelope,
        depth: f64,
        axial: f64,
        allowance: f64,
        work: &mut Work,
    ) -> Result<Option<Self>, CamPlanError> {
        work.spend(e.target.len(), 0)?;
        let mut points = Vec::new();
        for y in 0..e.ny {
            let active = |x: usize| e.target[x + e.nx * y] + axial > depth + EPS;
            let Some(first) = (0..e.nx).find(|&x| active(x)) else {
                continue;
            };
            let last = (first..e.nx).rev().find(|&x| active(x)).unwrap();
            // Hull orientation is computed on integer grid indices so
            // floating point noise cannot create near-zero corner arcs.
            let x0 = first as f64;
            let x1 = (last + 1) as f64;
            let y0 = y as f64;
            let y1 = (y + 1) as f64;
            // Row extrema enclose every protected *whole cell*, not just
            // its center. Taking their hull preserves that containment.
            points.extend([
                Point2Dto::new(x0, y0),
                Point2Dto::new(x1, y0),
                Point2Dto::new(x0, y1),
                Point2Dto::new(x1, y1),
            ]);
            if points.len() > MAX_HULL_POINTS {
                return Ok(None);
            }
        }
        work.spend(points.len().saturating_mul(16), 0)?;
        let Some(mut hull) = Self::from_points(points, allowance + CLEARANCE_GUARD) else {
            return Ok(None);
        };
        for p in &mut hull.hull {
            p.x = e.min.x + p.x * e.h;
            p.y = e.min.y + p.y * e.h;
        }
        // The index-space normals are invariant under this uniform scale.
        // Reject numerically ambiguous corners rather than emit a full
        // circle when a tiny intended turn rounds to coincident angles.
        for i in 0..hull.normals.len() {
            let a = hull.normals[i];
            let b = hull.normals[(i + 1) % hull.normals.len()];
            if (a.x * b.y - a.y * b.x) <= 1e-8 {
                return Ok(None);
            }
        }
        Ok(Some(hull))
    }

    pub(super) fn vertices(&self) -> usize {
        self.hull.len()
    }
    fn inside(&self, p: Point2Dto) -> bool {
        (0..self.hull.len())
            .all(|i| cross(self.hull[i], self.hull[(i + 1) % self.hull.len()], p) >= -EPS)
    }
    pub(super) fn distance(&self, p: Point2Dto) -> f64 {
        if self.inside(p) {
            return 0.0;
        }
        (0..self.hull.len())
            .map(|i| point_segment(p, self.hull[i], self.hull[(i + 1) % self.hull.len()]))
            .fold(f64::INFINITY, f64::min)
    }
    pub(super) fn capsule_clear(&self, a: Point2Dto, b: Point2Dto, r: f64) -> bool {
        if self.inside(a) || self.inside(b) {
            return false;
        }
        (0..self.hull.len()).all(|i| {
            segment_distance(a, b, self.hull[i], self.hull[(i + 1) % self.hull.len()])
                > self.offset + r + EPS
        })
    }
    pub(super) fn point_clear(&self, p: Point2Dto) -> bool {
        self.distance(p) > self.offset + EPS
    }

    /// Supporting half-planes give a superset of the rounded stock bound.
    /// Their angular intersection can overestimate corner engagement, but
    /// never hides remaining stock from the fallback's engagement checks.
    pub(super) fn clip_contact(&self, c: Point2Dto, r: f64, ranges: &mut Vec<(f64, f64)>) {
        for (a, n) in self.hull.iter().zip(&self.normals) {
            let cosine = (n.x * (a.x - c.x) + n.y * (a.y - c.y) + self.offset) / r;
            if cosine <= -1.0 {
                ranges.clear();
                break;
            }
            if cosine < 1.0 {
                subtract_arc(ranges, n.y.atan2(n.x), cosine.acos());
            }
        }
    }

    pub(super) fn clear_exterior(
        &self,
        builder: &mut ProgramBuilder,
        setup: &CamSetupDto,
        r: f64,
        floor_r: f64,
        depth: f64,
        p: &CamAdaptiveParametersDto,
        feed: f64,
        plunge: f64,
        work: &mut Work,
    ) -> Result<usize, CamPlanError> {
        let corners = [
            Point2Dto::new(setup.stock.min.x, setup.stock.min.y),
            Point2Dto::new(setup.stock.max.x, setup.stock.min.y),
            Point2Dto::new(setup.stock.max.x, setup.stock.max.y),
            Point2Dto::new(setup.stock.min.x, setup.stock.max.y),
        ];
        // Distance to a convex set is convex: its maximum over the stock
        // bounding rectangle is bounded by its four corners. This also
        // bounds cylinder/hex/modeled stock contained by that rectangle.
        let mut bound = corners
            .iter()
            .map(|&c| self.distance(c))
            .fold(0.0, f64::max)
            + CLEARANCE_GUARD;
        if bound <= self.offset + EPS {
            return Ok(0);
        }
        // All axial sections advance by e between equal-offset loops. The
        // smallest radius sees the largest angle: e <= f*(1-cos(phi_R)).
        let advance = p.optimal_load * (floor_r / r);
        let passes = ((bound - self.offset) / advance).ceil() as usize;
        if passes > MAX_PASSES {
            return Err(CamPlanError("High Speed Roughing exterior exceeds its pass budget; split the stock or increase optimal load.".into()));
        }
        super::ensure_program_budget(
            builder.commands.len(),
            passes.saturating_mul(2 * self.hull.len() + 8),
            "High Speed Roughing exterior",
        )?;
        work.spend(passes.saturating_mul(self.hull.len() * 8), 1)?;
        let edge = if let Some(hint) = builder
            .linking
            .as_ref()
            .and_then(|l| l.entry_positions.first())
        {
            (0..self.hull.len())
                .min_by(|&a, &b| {
                    point_segment(*hint, self.hull[a], self.hull[(a + 1) % self.hull.len()])
                        .total_cmp(&point_segment(
                            *hint,
                            self.hull[b],
                            self.hull[(b + 1) % self.hull.len()],
                        ))
                })
                .unwrap()
        } else {
            (0..self.hull.len())
                .max_by(|&a, &b| {
                    dist(self.hull[a], self.hull[(a + 1) % self.hull.len()])
                        .total_cmp(&dist(self.hull[b], self.hull[(b + 1) % self.hull.len()]))
                })
                .unwrap()
        };
        let a = self.hull[edge];
        let b = self.hull[(edge + 1) % self.hull.len()];
        let n = self.normals[edge];
        let tangent = Point2Dto::new(n.y, -n.x); // clockwise external climb (M3)
        let project = |p: Point2Dto| p.x * tangent.x + p.y * tangent.y;
        let low = corners
            .iter()
            .map(|&p| project(p))
            .fold(f64::INFINITY, f64::min);
        let high = corners
            .iter()
            .map(|&p| project(p))
            .fold(f64::NEG_INFINITY, f64::max);
        let air_margin = p
            .minimum_cutting_radius
            .max(1.0)
            .max(builder.linking.as_ref().map_or(0.0, |l| l.safe_distance));
        let offset =
            |v: Point2Dto, n: Point2Dto, d: f64| Point2Dto::new(v.x + n.x * d, v.y + n.y * d);
        for _ in 0..passes {
            let next = (bound - advance).max(self.offset);
            let d = r + next;
            if d + EPS < p.minimum_cutting_radius {
                return Err(CamPlanError(
                    "High Speed Roughing exterior cannot meet minimum cutting radius.".into(),
                ));
            }
            let start = offset(Point2Dto::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5), n, d);
            let move_along = |amount: f64| {
                Point2Dto::new(start.x + tangent.x * amount, start.y + tangent.y * amount)
            };
            let entry = move_along((low - r - air_margin - project(start)).min(-air_margin));
            let exit = move_along((high + r + air_margin - project(start)).max(air_margin));
            // Axial entry/retraction happen beyond a supporting plane of
            // the *original stock* by more than a full cutter radius.
            let advanced = if builder.linking.is_some() {
                Some(super::super::linking_planner::air_leads(
                    builder, entry, exit, r,
                )?)
            } else {
                None
            };
            if let Some((leads, tin, _)) = &advanced {
                let link = builder.linking.clone().unwrap();
                super::super::linking_planner::entry(
                    builder,
                    leads.start,
                    *tin,
                    depth,
                    if link.lead_in.enabled {
                        link.lead_in.vertical_radius
                    } else {
                        0.0
                    },
                    plunge,
                    link.lead_in_feed,
                )?;
                builder.linear(
                    Point3Dto::new(leads.line_end.x, leads.line_end.y, depth),
                    link.lead_in_feed,
                );
                if let Some(arc) = &leads.start_arc {
                    builder.circular(
                        Point3Dto::new(entry.x, entry.y, depth),
                        arc.center,
                        arc.clockwise,
                        link.lead_in_feed,
                    );
                }
            } else {
                builder.approach(entry, depth, plunge);
            }
            builder.linear(Point3Dto::new(start.x, start.y, depth), feed);
            for step in 0..self.hull.len() {
                let i = (edge + self.hull.len() - step) % self.hull.len();
                let prev = (i + self.hull.len() - 1) % self.hull.len();
                let v = self.hull[i];
                let from = offset(v, self.normals[i], d);
                let to = offset(v, self.normals[prev], d);
                builder.linear(Point3Dto::new(from.x, from.y, depth), feed);
                // Each convex turn is < pi. Very nearly collinear hull
                // edges still retain their tiny outward arc, not a shortcut.
                builder.circular(Point3Dto::new(to.x, to.y, depth), v, true, feed);
            }
            builder.linear(Point3Dto::new(start.x, start.y, depth), feed);
            builder.linear(Point3Dto::new(exit.x, exit.y, depth), p.linking_feed);
            if let Some((leads, _, tout)) = &advanced {
                let link = builder.linking.clone().unwrap();
                if let Some(arc) = &leads.end_arc {
                    builder.circular(
                        Point3Dto::new(arc.arc_end.x, arc.arc_end.y, depth),
                        arc.center,
                        arc.clockwise,
                        link.lead_out_feed,
                    );
                }
                builder.linear(
                    Point3Dto::new(leads.end.x, leads.end.y, depth),
                    link.lead_out_feed,
                );
                super::super::linking_planner::exit(
                    builder,
                    leads.end,
                    *tout,
                    depth,
                    if link.exit().enabled {
                        link.exit().vertical_radius
                    } else {
                        0.0
                    },
                    link.lead_out_feed,
                )?;
            }
            if builder.linking.as_ref().is_none_or(|l| {
                !l.keep_tool_down
                    && l.retraction_policy == crate::linking::CamRetractionPolicy::Full
            }) {
                builder.retract_to_clearance();
            }
            bound = next;
        }
        Ok(passes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;
    fn square() -> ConvexStock {
        ConvexStock::from_points(
            vec![
                Point2Dto::new(0.0, 0.0),
                Point2Dto::new(4.0, 0.0),
                Point2Dto::new(4.0, 4.0),
                Point2Dto::new(0.0, 4.0),
            ],
            0.2,
        )
        .unwrap()
    }
    #[test]
    fn stock_certificate_checks_whole_segments_and_round_corners() {
        let s = square();
        assert!(s.capsule_clear(Point2Dto::new(-2.0, -2.0), Point2Dto::new(-2.0, 6.0), 1.0));
        assert!(!s.capsule_clear(Point2Dto::new(-2.0, 2.0), Point2Dto::new(6.0, 2.0), 1.0));
        assert!(!s.point_clear(Point2Dto::new(2.0, 2.0)));
        assert!(!s.point_clear(Point2Dto::new(-0.1, -0.1)));
        assert!(s.point_clear(Point2Dto::new(-0.15, -0.15)));
    }
    #[test]
    fn offset_engagement_bound_includes_only_advancing_material() {
        for r in [1.0_f64, 6.0, 12.0] {
            for fraction in [0.01_f64, 0.2, 0.8] {
                let e = r * fraction;
                let phi = (1.0 - fraction).acos();
                // At every C1 offset station, n=(1,0), t=(0,1) after rotation.
                // Possible material lies x <= -(R-e); backward y<0 was swept.
                let mut engaged = 0;
                const N: usize = 100_000;
                for i in 0..N {
                    let theta = 2.0 * PI * (i as f64 + 0.5) / N as f64;
                    if r * theta.cos() <= -(r - e) && theta.sin() >= 0.0 {
                        engaged += 1;
                    }
                }
                assert!((engaged as f64 * 2.0 * PI / N as f64 - phi).abs() < 2.0 * PI / N as f64);
            }
        }
    }

    #[test]
    fn corner_exterior_contact_and_advance_bound_every_cutter_section() {
        let mut floor = square();
        floor.offset = 2.2; // nominal allowance .2 plus R-f = 2
        for x in [-2., 2., 6., 9.] {
            for y in [-2., 2., 6., 9.] {
                let c = Point2Dto::new(x, y);
                let mut intervals = vec![(0., 2. * PI)];
                floor.clip_contact(c, 4., &mut intervals);
                let upper = super::super::angle_with_guard(&intervals);
                let n = 2048;
                let count = (0..n).filter(|&i| (0..=32).any(|j| {
                    let delta = 2. * j as f64 / 32.;
                    let angle = 2. * PI * (i as f64 + 0.5) / n as f64;
                    let p = Point2Dto::new(c.x + (4. + delta) * angle.cos(), c.y + (4. + delta) * angle.sin());
                    floor.distance(p) <= floor.offset - delta
                })).count();
                assert!(upper + 0.005 >= count as f64 * 2. * PI / n as f64);
            }
        }
        for f in [0.5_f64, 2., 4., 6.] {
            let (r, ae) = (6., 1.2);
            let advance = ae * f / r;
            for j in 0..=100 {
                let s = f + (r - f) * j as f64 / 100.;
                assert!((1. - advance / s).acos() <= (1. - ae / r).acos() + EPS);
            }
        }
    }
}
