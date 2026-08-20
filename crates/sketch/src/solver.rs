//! Newton-based sketch constraint solver.
//!
//! Unknown layout: each `Point` contributes (x, y); each `Circle`
//! (cx, cy, r); each `Arc` (cx, cy, r, a0, a1); `Line`s contribute nothing
//! (their geometry lives in the shared endpoint points). Constraints
//! contribute residual equations with analytical Jacobians. The solver is
//! Levenberg–Marquardt damped Newton with an adaptive damping factor and
//! step acceptance by residual decrease; convergence tolerance is ~1e-9
//! (max |residual|), iteration-capped.
//!
//! DOF tracking: `unknowns − rank(J)` where the rank is computed by
//! Gaussian elimination with partial pivoting; non-pivot columns are the
//! free variables, which also yields the per-entity fully-defined flags
//! used for constraint-state coloring (an entity is fully defined when none
//! of its unknowns are free).

use std::collections::HashMap;

use crate::constraint::{ArcEndpoint, Constraint, ConstraintId};
use crate::entity::{Entity, EntityId, AXIS_SENTINEL};
use crate::geometry::Vec2;
use crate::geomops::fillet;
use crate::sketch::Sketch;

/// Convergence tolerance on max |residual| (mm / rad mixed residuals).
const TOL: f64 = 1e-9;
const MAX_ITERS: usize = 80;
/// Below 0.1 micrometre a trimmed finite edge is treated as its persistent
/// support line. This avoids singular direction derivatives at the exact
/// fillet/chamfer consumption boundary while remaining far below modeling
/// and display tolerances.
const DEGENERATE_LINE_EPS: f64 = 1e-4;
// One micron in the sketch's millimetre base unit. Exact trim boundaries can
// settle with sub-micron endpoint noise, so a subsequent edit should still
// start in support-line mode. The smaller threshold above remains the live
// equation-switch tolerance while an ordinary finite edge is closing.
const CONSUMED_CARRIER_EPS: f64 = 1e-3;

/// Outcome of one solve/analysis pass.
#[derive(Debug, Clone)]
pub struct Analysis {
    pub converged: bool,
    pub iterations: usize,
    /// max |residual| at the final state.
    pub residual: f64,
    pub unknowns: usize,
    pub equations: usize,
    pub rank: usize,
    /// `unknowns − rank` (≥ 0 by construction).
    pub dof: i32,
    /// Free (non-pivot) variable count per entity — 0 ⇔ fully defined.
    pub entity_free: HashMap<EntityId, usize>,
}

impl Analysis {
    pub fn fully_defined(&self, entity: EntityId) -> bool {
        self.entity_free.get(&entity).copied().unwrap_or(0) == 0
    }
}

/// Variable indices of one point: `(x_var, y_var)`.
type Pt = (usize, usize);

/// A difference of two points: d = p2 − p1.
#[derive(Clone, Copy)]
struct Diff {
    x1: usize,
    y1: usize,
    x2: usize,
    y2: usize,
}

impl Diff {
    fn val(&self, x: &[f64]) -> (f64, f64) {
        (x[self.x2] - x[self.x1], x[self.y2] - x[self.y1])
    }
    /// Push the chain-rule expansion of `coef · d(dx)` and `coef · d(dy)`.
    fn push_deriv(&self, dx_coef: f64, dy_coef: f64, out: &mut Vec<(usize, f64)>) {
        out.push((self.x2, dx_coef));
        out.push((self.x1, -dx_coef));
        out.push((self.y2, dy_coef));
        out.push((self.y1, -dy_coef));
    }
}

/// One residual equation F(x) = 0 with an analytical Jacobian row.
enum Eq {
    /// Σ aᵢ·xᵢ + c = 0 (H/V/Fix/Midpoint/Concentric/Equal-radius).
    Lin { terms: Vec<(usize, f64)>, c: f64 },
    /// cross(a, b) = a.x·b.y − a.y·b.x = 0 (Parallel, Collinear).
    Cross { a: Diff, b: Diff },
    /// dot(a, b) = 0 (Perpendicular, Symmetry legs).
    Dot { a: Diff, b: Diff },
    /// cross(d, p − base) = 0 (point-on-line incidence). A consumed fillet
    /// carrier uses its persistent support direction for the whole solve,
    /// just like line-circle tangency.
    CrossPt {
        d: Diff,
        p: Pt,
        base: Pt,
        support: (f64, f64),
        support_mode: bool,
    },
    /// T/|d| − sign·r = 0 with T = cross(d, center − line start) — signed
    /// perpendicular center-to-line distance (mm units), single-sided. The
    /// previous squared form (T² − r²|d|²) had two-sided phantom minima and
    /// mixed mm⁴/mm residual scales that stalled LM on coupled trims
    /// (2026-07-19 second-fillet false rejection). `sign` (+1/−1) is the
    /// center's side of the line at equation-build time.
    LineCircleTangent {
        d: Diff,
        c: Pt,
        base: Pt,
        r: usize,
        sign: f64,
        /// Last meaningful direction of the finite carrier segment. A
        /// fillet pair may consume an edge exactly (R1 + R2 == L), leaving
        /// coincident endpoint variables while its infinite support line is
        /// still geometrically well-defined.
        support: (f64, f64),
        /// Keep the support-line form for an entire solve that starts with a
        /// consumed carrier. Switching back to the finite-segment form as
        /// soon as an iteration separates the endpoints makes the Jacobian
        /// discontinuous exactly while a radius edit is reopening the edge.
        support_mode: bool,
    },
    /// |a|² − |b|² = 0 (Equal line lengths).
    DiffLen2 { a: Diff, b: Diff },
    /// |c1 − c2|² − (r1 + sign·r2)² = 0 (circle/arc↔circle/arc tangency;
    /// sign = +1 external, −1 internal, chosen from current geometry).
    CircleCircle {
        c1: Pt,
        r1: usize,
        c2: Pt,
        r2: usize,
        sign: f64,
    },
    /// |p − c|² − r² = 0 (point on circle/arc).
    PointOnCircle { p: Pt, c: Pt, r: usize },
    /// p.x − c.x − r·cos a = 0 (arc-endpoint trim anchor, x component;
    /// Constraint::ArcEndpointCoincident).
    ArcEndX { p: Pt, c: Pt, r: usize, a: usize },
    /// p.y − c.y − r·sin a = 0 (arc-endpoint trim anchor, y component).
    ArcEndY { p: Pt, c: Pt, r: usize, a: usize },
    /// |a − b| − target = 0 (Distance between two points).
    DistPt { a: Pt, b: Pt, target: f64 },
    /// Signed perpendicular distance from q to the line through base with
    /// direction d, minus target (line↔line / point↔line distance).
    LineDist {
        d: Diff,
        q: Pt,
        base: Pt,
        target: f64,
    },
    /// r − target = 0 (Radius/Diameter).
    Radius { r: usize, target: f64 },
    /// Angle between two line directions in radians, wrapped to (−π, π].
    AngleLines { a: Diff, b: Diff, target: f64 },
    /// Angle between a line direction and the +u axis (auto axis dims).
    AngleAxis { a: Diff, target: f64 },
    /// cross(dax, (a+b)/2 − a1) = 0 (Symmetry: midpoint on the axis).
    SymmetryMid { a: Pt, b: Pt, axis: Diff },
}

impl Eq {
    /// Residual plus sparse Jacobian row entries (var index, ∂F/∂xᵢ).
    fn eval(&self, x: &[f64]) -> (f64, Vec<(usize, f64)>) {
        match *self {
            Eq::Lin { ref terms, c } => {
                let mut r = c;
                for &(i, a) in terms {
                    r += a * x[i];
                }
                (r, terms.clone())
            }
            Eq::Cross { a, b } => {
                const SCALE: f64 = 100.0;
                let (ax, ay) = a.val(x);
                let (bx, by) = b.val(x);
                let la = (ax * ax + ay * ay).sqrt().max(1e-12);
                let lb = (bx * bx + by * by).sqrt().max(1e-12);
                let denom = la * lb;
                let cross = ax * by - ay * bx;
                let mut out = Vec::with_capacity(8);
                // Normalize the cross product to sin(angle). The previous
                // mm² residual dwarfed distance equations and made editable
                // Offset dimensions stall in the LM solver.
                a.push_deriv(
                    SCALE * (by / denom - cross * ax / (la * la * la * lb)),
                    SCALE * (-bx / denom - cross * ay / (la * la * la * lb)),
                    &mut out,
                );
                b.push_deriv(
                    SCALE * (-ay / denom - cross * bx / (la * lb * lb * lb)),
                    SCALE * (ax / denom - cross * by / (la * lb * lb * lb)),
                    &mut out,
                );
                (SCALE * cross / denom, out)
            }
            Eq::Dot { a, b } => {
                let (ax, ay) = a.val(x);
                let (bx, by) = b.val(x);
                let la = (ax * ax + ay * ay).sqrt().max(1e-12);
                let lb = (bx * bx + by * by).sqrt().max(1e-12);
                let denom = la * lb;
                let dot = ax * bx + ay * by;
                let mut out = Vec::with_capacity(8);
                // Normalize to cos(angle). Raw mm2 residuals dwarf pin/H/V
                // (~30 mm) and stall a chained right-angle drag so
                // move_point reverts. Cross already uses the same shape.
                a.push_deriv(
                    bx / denom - dot * ax / (la * la * la * lb),
                    by / denom - dot * ay / (la * la * la * lb),
                    &mut out,
                );
                b.push_deriv(
                    ax / denom - dot * bx / (la * lb * lb * lb),
                    ay / denom - dot * by / (la * lb * lb * lb),
                    &mut out,
                );
                (dot / denom, out)
            }
            Eq::CrossPt {
                d,
                p,
                base,
                support,
                support_mode,
            } => {
                let (dx, dy) = d.val(x);
                let (px, py) = (x[p.0], x[p.1]);
                let (bx, by) = (x[base.0], x[base.1]);
                if support_mode || (dx * dx + dy * dy).sqrt() < DEGENERATE_LINE_EPS {
                    let (ux, uy) = support;
                    let t = ux * (py - by) - uy * (px - bx);
                    return (t, vec![(p.0, -uy), (p.1, ux), (base.0, uy), (base.1, -ux)]);
                }
                let t = dx * (py - by) - dy * (px - bx);
                let mut out = Vec::with_capacity(8);
                d.push_deriv(py - by, -(px - bx), &mut out);
                out.push((p.0, -dy));
                out.push((p.1, dx));
                out.push((base.0, dy));
                out.push((base.1, -dx));
                (t, out)
            }
            Eq::LineCircleTangent {
                d,
                c,
                base,
                r,
                sign,
                support,
                support_mode,
            } => {
                let (dx, dy) = d.val(x);
                let (cx, cy) = (x[c.0], x[c.1]);
                let (bx, by) = (x[base.0], x[base.1]);
                let raw_len = (dx * dx + dy * dy).sqrt();
                if support_mode || raw_len < DEGENERATE_LINE_EPS {
                    // At the exact trim boundary the visible line segment
                    // has no direction, but the carrier line does. Evaluate
                    // signed point-to-support-line distance with that stable
                    // direction. This also lets a later smaller radius
                    // separate the two endpoint variables and reopen the
                    // edge, so the topology transition remains reversible.
                    let (ux, uy) = support;
                    let t = ux * (cy - by) - uy * (cx - bx);
                    let f = t - sign * x[r];
                    return (
                        f,
                        vec![
                            (c.0, -uy),
                            (c.1, ux),
                            (base.0, uy),
                            (base.1, -ux),
                            (r, -sign),
                        ],
                    );
                }
                let t = dx * (cy - by) - dy * (cx - bx);
                let len = raw_len;
                // f = T/|d| − sign·r (mm, single-sided)
                let f = t / len - sign * x[r];
                let inv = 1.0 / len;
                let mut out = Vec::with_capacity(12);
                // ∂T/|d|
                let mut t_terms = Vec::with_capacity(12);
                d.push_deriv(cy - by, -(cx - bx), &mut t_terms);
                t_terms.push((c.0, -dy));
                t_terms.push((c.1, dx));
                t_terms.push((base.0, dy));
                t_terms.push((base.1, -dx));
                for (i, v) in t_terms {
                    out.push((i, v * inv));
                }
                // −T·∂|d|/|d|²
                let s = -t / (len * len * len);
                d.push_deriv(s * dx, s * dy, &mut out);
                out.push((r, -sign));
                (f, out)
            }
            Eq::ArcEndX { p, c, r, a } => {
                let (ca, sa) = (x[a].cos(), x[a].sin());
                let f = x[p.0] - x[c.0] - x[r] * ca;
                (f, vec![(p.0, 1.0), (c.0, -1.0), (r, -ca), (a, x[r] * sa)])
            }
            Eq::ArcEndY { p, c, r, a } => {
                let (ca, sa) = (x[a].cos(), x[a].sin());
                let f = x[p.1] - x[c.1] - x[r] * sa;
                (f, vec![(p.1, 1.0), (c.1, -1.0), (r, -sa), (a, -x[r] * ca)])
            }
            Eq::DiffLen2 { a, b } => {
                let (ax, ay) = a.val(x);
                let (bx, by) = b.val(x);
                let mut out = Vec::with_capacity(8);
                a.push_deriv(2.0 * ax, 2.0 * ay, &mut out);
                b.push_deriv(-2.0 * bx, -2.0 * by, &mut out);
                (ax * ax + ay * ay - bx * bx - by * by, out)
            }
            Eq::CircleCircle {
                c1,
                r1,
                c2,
                r2,
                sign,
            } => {
                let dx = x[c1.0] - x[c2.0];
                let dy = x[c1.1] - x[c2.1];
                let s = x[r1] + sign * x[r2];
                let f = dx * dx + dy * dy - s * s;
                (
                    f,
                    vec![
                        (c1.0, 2.0 * dx),
                        (c2.0, -2.0 * dx),
                        (c1.1, 2.0 * dy),
                        (c2.1, -2.0 * dy),
                        (r1, -2.0 * s),
                        (r2, -2.0 * sign * s),
                    ],
                )
            }
            Eq::PointOnCircle { p, c, r } => {
                let dx = x[p.0] - x[c.0];
                let dy = x[p.1] - x[c.1];
                let f = dx * dx + dy * dy - x[r] * x[r];
                (
                    f,
                    vec![
                        (p.0, 2.0 * dx),
                        (c.0, -2.0 * dx),
                        (p.1, 2.0 * dy),
                        (c.1, -2.0 * dy),
                        (r, -2.0 * x[r]),
                    ],
                )
            }
            Eq::DistPt { a, b, target } => {
                let dx = x[a.0] - x[b.0];
                let dy = x[a.1] - x[b.1];
                let d = (dx * dx + dy * dy).sqrt();
                if d < 1e-12 {
                    // Degenerate configuration; report residual with zero
                    // gradient and let damping walk away.
                    return (-target, Vec::new());
                }
                (
                    d - target,
                    vec![(a.0, dx / d), (b.0, -dx / d), (a.1, dy / d), (b.1, -dy / d)],
                )
            }
            Eq::Radius { r, target } => (x[r] - target, vec![(r, 1.0)]),
            Eq::LineDist { d, q, base, target } => {
                let (dx, dy) = d.val(x);
                let len = (dx * dx + dy * dy).sqrt();
                let (qx, qy) = (x[q.0], x[q.1]);
                let (bx, by) = (x[base.0], x[base.1]);
                let cross = dx * (qy - by) - dy * (qx - bx);
                if len < 1e-12 {
                    return (0.0, Vec::new()); // degenerate guide line; skip
                }
                let f = cross / len - target;
                // ∂(cross/len): (∂cross)/len − cross·∂len/len²
                let mut out = Vec::with_capacity(10);
                d.push_deriv((qy - by) / len, -(qx - bx) / len, &mut out);
                out.push((q.0, -dy / len));
                out.push((q.1, dx / len));
                out.push((base.0, dy / len));
                out.push((base.1, -dx / len));
                d.push_deriv(
                    -cross * dx / (len * len * len),
                    -cross * dy / (len * len * len),
                    &mut out,
                );
                (f, out)
            }
            Eq::AngleLines { a, b, target } => {
                let (ax, ay) = a.val(x);
                let (bx, by) = b.val(x);
                let cross = ax * by - ay * bx;
                let dot = ax * bx + ay * by;
                let r2 = (cross * cross + dot * dot).max(1e-24);
                let f = wrap_angle(cross.atan2(dot) - target);
                let dc = dot / r2; // ∂F/∂cross
                let dd = -cross / r2; // ∂F/∂dot
                let mut out = Vec::with_capacity(16);
                // cross = ax·by − ay·bx; dot = ax·bx + ay·by
                a.push_deriv(dc * by + dd * bx, -dc * bx + dd * by, &mut out);
                b.push_deriv(-dc * ay + dd * ax, dc * ax + dd * ay, &mut out);
                (f, out)
            }
            Eq::AngleAxis { a, target } => {
                let (ax, ay) = a.val(x);
                // Angle from +u: atan2(ay, ax) (cross((1,0), d) = dy).
                let r2 = (ax * ax + ay * ay).max(1e-24);
                let f = wrap_angle(ay.atan2(ax) - target);
                let mut out = Vec::with_capacity(4);
                // ∂atan2(ay,ax)/∂ax = −ay/r², ∂/∂ay = ax/r²
                a.push_deriv(-ay / r2, ax / r2, &mut out);
                (f, out)
            }
            Eq::SymmetryMid { a, b, axis } => {
                let (ux, uy) = axis.val(x);
                let mx = (x[a.0] + x[b.0]) / 2.0;
                let my = (x[a.1] + x[b.1]) / 2.0;
                let (a1x, a1y) = (x[axis.x1], x[axis.y1]);
                let f = ux * (my - a1y) - uy * (mx - a1x);
                let mut out = Vec::with_capacity(10);
                // ∂F/∂(axis diff): (my − a1y, −(mx − a1x))
                axis.push_deriv(my - a1y, -(mx - a1x), &mut out);
                // ∂F/∂m = (−uy, ux) with m = (a + b)/2
                out.push((a.0, -0.5 * uy));
                out.push((b.0, -0.5 * uy));
                out.push((a.1, 0.5 * ux));
                out.push((b.1, 0.5 * ux));
                // ∂F/∂a1 (axis start, beyond the diff chain above)
                out.push((axis.x1, uy));
                out.push((axis.y1, -ux));
                (f, out)
            }
        }
    }
}

/// Unknown-index map for a sketch.
struct VarMap {
    points: HashMap<EntityId, Pt>,
    circles: HashMap<EntityId, (Pt, usize)>,
    arcs: HashMap<EntityId, (Pt, usize, usize, usize)>,
    /// Every fit point contributes an `(x, y)` pair. Splines do not yet
    /// participate in incidence/tangent constraints, but they must still
    /// carry real DOF so Fix/Unfix and transform solving are truthful.
    splines: HashMap<EntityId, Vec<Pt>>,
    n: usize,
}

fn build_var_map(sketch: &Sketch) -> VarMap {
    let mut map = VarMap {
        points: HashMap::new(),
        circles: HashMap::new(),
        arcs: HashMap::new(),
        splines: HashMap::new(),
        n: 0,
    };
    let mut alloc = |count: usize| {
        let start = map.n;
        map.n += count;
        start
    };
    for (id, entity) in sketch.entities() {
        match entity {
            Entity::Point { .. } => {
                let i = alloc(2);
                map.points.insert(id, (i, i + 1));
            }
            Entity::Circle { .. } => {
                let i = alloc(3);
                map.circles.insert(id, ((i, i + 1), i + 2));
            }
            Entity::Arc { .. } => {
                let i = alloc(5);
                map.arcs.insert(id, ((i, i + 1), i + 2, i + 3, i + 4));
            }
            Entity::Line { .. } => {}
            Entity::Spline { points } => {
                let mut vars = Vec::with_capacity(points.len());
                for _ in points {
                    let i = alloc(2);
                    vars.push((i, i + 1));
                }
                map.splines.insert(id, vars);
            }
        }
    }
    map
}

fn read_values(sketch: &Sketch, map: &VarMap) -> Vec<f64> {
    let mut x = vec![0.0; map.n];
    for (id, entity) in sketch.entities() {
        match entity {
            Entity::Point { position } => {
                let p = map.points[&id];
                x[p.0] = position.x;
                x[p.1] = position.y;
            }
            Entity::Circle { center, radius } => {
                let (c, r) = map.circles[&id];
                x[c.0] = center.x;
                x[c.1] = center.y;
                x[r] = *radius;
            }
            Entity::Arc {
                center,
                radius,
                start_angle,
                end_angle,
            } => {
                let (c, r, a0, a1) = map.arcs[&id];
                x[c.0] = center.x;
                x[c.1] = center.y;
                x[r] = *radius;
                x[a0] = *start_angle;
                x[a1] = *end_angle;
            }
            Entity::Line { .. } => {}
            Entity::Spline { points } => {
                if let Some(vars) = map.splines.get(&id) {
                    for (point, var) in points.iter().zip(vars) {
                        x[var.0] = point.x;
                        x[var.1] = point.y;
                    }
                }
            }
        }
    }
    x
}

fn write_values(sketch: &mut Sketch, map: &VarMap, x: &[f64]) {
    let ids: Vec<EntityId> = sketch.entities().map(|(id, _)| id).collect();
    for id in ids {
        match sketch.entity_mut(id) {
            Some(Entity::Point { position }) => {
                let p = map.points[&id];
                *position = Vec2::new(x[p.0], x[p.1]);
            }
            Some(Entity::Circle { center, radius }) => {
                let (c, r) = map.circles[&id];
                *center = Vec2::new(x[c.0], x[c.1]);
                *radius = x[r];
            }
            Some(Entity::Arc {
                center,
                radius,
                start_angle,
                end_angle,
            }) => {
                let (c, r, a0, a1) = map.arcs[&id];
                *center = Vec2::new(x[c.0], x[c.1]);
                *radius = x[r];
                *start_angle = x[a0];
                *end_angle = x[a1];
            }
            Some(Entity::Spline { points }) => {
                if let Some(vars) = map.splines.get(&id) {
                    for (point, var) in points.iter_mut().zip(vars) {
                        *point = Vec2::new(x[var.0], x[var.1]);
                    }
                }
            }
            _ => {}
        }
    }
}

impl VarMap {
    fn pt(&self, sketch: &Sketch, id: EntityId) -> Option<Pt> {
        self.points.get(&id).copied().or_else(|| {
            // Circles/arcs expose their center as a point for incidence
            // equations (Coincident center, Concentric building blocks).
            match sketch.entity(id) {
                Some(Entity::Circle { .. }) => self.circles.get(&id).map(|(c, _)| *c),
                Some(Entity::Arc { .. }) => self.arcs.get(&id).map(|(c, ..)| *c),
                _ => None,
            }
        })
    }

    fn line_diff(&self, sketch: &Sketch, id: EntityId) -> Option<Diff> {
        let (start, end) = sketch.line_endpoint_ids(id)?;
        let s = self.points.get(&start)?;
        let e = self.points.get(&end)?;
        Some(Diff {
            x1: s.0,
            y1: s.1,
            x2: e.0,
            y2: e.1,
        })
    }

    fn radius_var(&self, sketch: &Sketch, id: EntityId) -> Option<usize> {
        match sketch.entity(id) {
            Some(Entity::Circle { .. }) => self.circles.get(&id).map(|(_, r)| *r),
            Some(Entity::Arc { .. }) => self.arcs.get(&id).map(|(_, r, ..)| *r),
            _ => None,
        }
    }
}

/// Build the equation set: one row per residual, tagged by constraint.
fn build_equations(
    sketch: &Sketch,
    map: &VarMap,
    pins: &[(EntityId, Vec2)],
) -> Vec<(Option<ConstraintId>, Eq)> {
    fn push_lin(
        eqs: &mut Vec<(Option<ConstraintId>, Eq)>,
        cid: ConstraintId,
        terms: Vec<(usize, f64)>,
        c: f64,
    ) {
        eqs.push((Some(cid), Eq::Lin { terms, c }));
    }

    let mut eqs: Vec<(Option<ConstraintId>, Eq)> = Vec::new();

    for (cid, constraint) in sketch.constraints() {
        match *constraint {
            Constraint::Horizontal { entity } => {
                if let Some(d) = map.line_diff(sketch, entity) {
                    push_lin(&mut eqs, cid, vec![(d.y2, 1.0), (d.y1, -1.0)], 0.0);
                }
            }
            Constraint::Vertical { entity } => {
                if let Some(d) = map.line_diff(sketch, entity) {
                    push_lin(&mut eqs, cid, vec![(d.x2, 1.0), (d.x1, -1.0)], 0.0);
                }
            }
            Constraint::HorizontalPoints { a, b } => {
                if let (Some(a), Some(b)) = (map.pt(sketch, a), map.pt(sketch, b)) {
                    push_lin(&mut eqs, cid, vec![(b.1, 1.0), (a.1, -1.0)], 0.0);
                }
            }
            Constraint::VerticalPoints { a, b } => {
                if let (Some(a), Some(b)) = (map.pt(sketch, a), map.pt(sketch, b)) {
                    push_lin(&mut eqs, cid, vec![(b.0, 1.0), (a.0, -1.0)], 0.0);
                }
            }
            Constraint::Fix { entity } => {
                if let Some(targets) = sketch.fix_targets(&cid) {
                    let mut vars: Vec<usize> = Vec::new();
                    match sketch.entity(entity) {
                        Some(Entity::Point { .. }) => {
                            let p = map.points[&entity];
                            vars.extend([p.0, p.1]);
                        }
                        // A fixed line is pinned through its shared
                        // endpoint points (lines own no unknowns).
                        Some(Entity::Line { start, end }) => {
                            for pid in [start, end] {
                                let p = map.points[&pid];
                                vars.extend([p.0, p.1]);
                            }
                        }
                        Some(Entity::Circle { .. }) => {
                            let (c, r) = map.circles[&entity];
                            vars.extend([c.0, c.1, r]);
                        }
                        Some(Entity::Arc { .. }) => {
                            let (c, r, a0, a1) = map.arcs[&entity];
                            vars.extend([c.0, c.1, r, a0, a1]);
                        }
                        Some(Entity::Spline { .. }) => {
                            if let Some(points) = map.splines.get(&entity) {
                                for point in points {
                                    vars.extend([point.0, point.1]);
                                }
                            }
                        }
                        None => {}
                    }
                    for (var, target) in vars.into_iter().zip(targets.iter()) {
                        push_lin(&mut eqs, cid, vec![(var, 1.0)], -*target);
                    }
                }
            }
            Constraint::Coincident { a, b } => {
                let pa = map.pt(sketch, a);
                let pb = map.pt(sketch, b);
                match (sketch.entity(a), sketch.entity(b)) {
                    (Some(Entity::Point { .. }), Some(Entity::Point { .. })) => {
                        if let (Some(pa), Some(pb)) = (pa, pb) {
                            push_lin(&mut eqs, cid, vec![(pa.0, 1.0), (pb.0, -1.0)], 0.0);
                            push_lin(&mut eqs, cid, vec![(pa.1, 1.0), (pb.1, -1.0)], 0.0);
                        }
                    }
                    (Some(Entity::Point { .. }), Some(Entity::Line { .. })) => {
                        if let (Some(p), Some(d)) = (pa, map.line_diff(sketch, b)) {
                            eqs.push((
                                Some(cid),
                                Eq::CrossPt {
                                    d,
                                    p,
                                    base: (d.x1, d.y1),
                                    support: line_support(sketch, b).unwrap_or((1.0, 0.0)),
                                    support_mode: line_is_degenerate(sketch, b),
                                },
                            ));
                        }
                    }
                    (Some(Entity::Line { .. }), Some(Entity::Point { .. })) => {
                        if let (Some(p), Some(d)) = (pb, map.line_diff(sketch, a)) {
                            eqs.push((
                                Some(cid),
                                Eq::CrossPt {
                                    d,
                                    p,
                                    base: (d.x1, d.y1),
                                    support: line_support(sketch, a).unwrap_or((1.0, 0.0)),
                                    support_mode: line_is_degenerate(sketch, a),
                                },
                            ));
                        }
                    }
                    (
                        Some(Entity::Point { .. }),
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                    ) => {
                        if let (Some(p), Some(c), Some(r)) =
                            (pa, map.pt(sketch, b), map.radius_var(sketch, b))
                        {
                            eqs.push((Some(cid), Eq::PointOnCircle { p, c, r }));
                        }
                    }
                    (
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                        Some(Entity::Point { .. }),
                    ) => {
                        if let (Some(p), Some(c), Some(r)) =
                            (pb, map.pt(sketch, a), map.radius_var(sketch, a))
                        {
                            eqs.push((Some(cid), Eq::PointOnCircle { p, c, r }));
                        }
                    }
                    // Center-to-center coincidence of two circles/arcs.
                    (
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                    ) => {
                        if let (Some(ca), Some(cb)) = (pa, pb) {
                            push_lin(&mut eqs, cid, vec![(ca.0, 1.0), (cb.0, -1.0)], 0.0);
                            push_lin(&mut eqs, cid, vec![(ca.1, 1.0), (cb.1, -1.0)], 0.0);
                        }
                    }
                    _ => {}
                }
            }
            Constraint::Midpoint { a, b } => {
                if let (Some(p), Some(d)) = (map.pt(sketch, a), map.line_diff(sketch, b)) {
                    push_lin(
                        &mut eqs,
                        cid,
                        vec![(p.0, 1.0), (d.x1, -0.5), (d.x2, -0.5)],
                        0.0,
                    );
                    push_lin(
                        &mut eqs,
                        cid,
                        vec![(p.1, 1.0), (d.y1, -0.5), (d.y2, -0.5)],
                        0.0,
                    );
                }
            }
            Constraint::ReferenceMidpoint {
                point, position, ..
            } => {
                if let Some(p) = map.pt(sketch, point) {
                    push_lin(&mut eqs, cid, vec![(p.0, 1.0)], -position.x);
                    push_lin(&mut eqs, cid, vec![(p.1, 1.0)], -position.y);
                }
            }
            Constraint::SpanMidpoint { point, start, end } => {
                if let (Some(p), Some(a), Some(b)) = (
                    map.pt(sketch, point),
                    map.pt(sketch, start),
                    map.pt(sketch, end),
                ) {
                    push_lin(
                        &mut eqs,
                        cid,
                        vec![(p.0, 1.0), (a.0, -0.5), (b.0, -0.5)],
                        0.0,
                    );
                    push_lin(
                        &mut eqs,
                        cid,
                        vec![(p.1, 1.0), (a.1, -0.5), (b.1, -0.5)],
                        0.0,
                    );
                }
            }
            Constraint::Equal { a, b } => match (sketch.entity(a), sketch.entity(b)) {
                (Some(Entity::Line { .. }), Some(Entity::Line { .. })) => {
                    if let (Some(da), Some(db)) =
                        (map.line_diff(sketch, a), map.line_diff(sketch, b))
                    {
                        eqs.push((Some(cid), Eq::DiffLen2 { a: da, b: db }));
                    }
                }
                _ => {
                    if let (Some(ra), Some(rb)) =
                        (map.radius_var(sketch, a), map.radius_var(sketch, b))
                    {
                        push_lin(&mut eqs, cid, vec![(ra, 1.0), (rb, -1.0)], 0.0);
                    }
                }
            },
            Constraint::Parallel { a, b } => {
                if let (Some(da), Some(db)) = (map.line_diff(sketch, a), map.line_diff(sketch, b)) {
                    eqs.push((Some(cid), Eq::Cross { a: da, b: db }));
                }
            }
            Constraint::Perpendicular { a, b } => {
                if let (Some(da), Some(db)) = (map.line_diff(sketch, a), map.line_diff(sketch, b)) {
                    eqs.push((Some(cid), Eq::Dot { a: da, b: db }));
                }
            }
            Constraint::Tangent { a, b } => {
                let kinds = (sketch.entity(a), sketch.entity(b));
                match kinds {
                    (
                        Some(Entity::Line { .. }),
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                    ) => {
                        if let (Some(d), Some(c), Some(r)) = (
                            map.line_diff(sketch, a),
                            map.pt(sketch, b),
                            map.radius_var(sketch, b),
                        ) {
                            let support = tangent_support(sketch, a, b);
                            let sign = tangent_sign(sketch, map, a, c, support);
                            let base = tangent_base(sketch, map, a, b, d);
                            let support_mode = line_is_degenerate(sketch, a);
                            eqs.push((
                                Some(cid),
                                Eq::LineCircleTangent {
                                    d,
                                    c,
                                    base,
                                    r,
                                    sign,
                                    support,
                                    support_mode,
                                },
                            ));
                        }
                    }
                    (
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                        Some(Entity::Line { .. }),
                    ) => {
                        if let (Some(d), Some(c), Some(r)) = (
                            map.line_diff(sketch, b),
                            map.pt(sketch, a),
                            map.radius_var(sketch, a),
                        ) {
                            let support = tangent_support(sketch, b, a);
                            let sign = tangent_sign(sketch, map, b, c, support);
                            let base = tangent_base(sketch, map, b, a, d);
                            let support_mode = line_is_degenerate(sketch, b);
                            eqs.push((
                                Some(cid),
                                Eq::LineCircleTangent {
                                    d,
                                    c,
                                    base,
                                    r,
                                    sign,
                                    support,
                                    support_mode,
                                },
                            ));
                        }
                    }
                    (
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                    ) => {
                        if let (Some(c1), Some(r1), Some(c2), Some(r2)) = (
                            map.pt(sketch, a),
                            map.radius_var(sketch, a),
                            map.pt(sketch, b),
                            map.radius_var(sketch, b),
                        ) {
                            // External vs. internal from current geometry.
                            let d = sketch_point(sketch, map, c1)
                                .distance(sketch_point(sketch, map, c2));
                            let sign = if d >= current_r(sketch, a) + current_r(sketch, b) {
                                1.0
                            } else {
                                -1.0
                            };
                            eqs.push((
                                Some(cid),
                                Eq::CircleCircle {
                                    c1,
                                    r1,
                                    c2,
                                    r2,
                                    sign,
                                },
                            ));
                        }
                    }
                    _ => {}
                }
            }
            Constraint::ArcEndpointCoincident { point, arc, end } => {
                if let (Some(p), Some((c, r, a0, a1))) =
                    (map.points.get(&point).copied(), map.arcs.get(&arc).copied())
                {
                    let a = match end {
                        crate::constraint::ArcEndpoint::Start => a0,
                        crate::constraint::ArcEndpoint::End => a1,
                    };
                    eqs.push((Some(cid), Eq::ArcEndX { p, c, r, a }));
                    eqs.push((Some(cid), Eq::ArcEndY { p, c, r, a }));
                }
            }
            Constraint::EqualDistance { origin, a, b } => {
                if let (Some(o), Some(pa), Some(pb)) = (
                    map.points.get(&origin).copied(),
                    map.points.get(&a).copied(),
                    map.points.get(&b).copied(),
                ) {
                    eqs.push((
                        Some(cid),
                        Eq::DiffLen2 {
                            a: Diff {
                                x1: o.0,
                                y1: o.1,
                                x2: pa.0,
                                y2: pa.1,
                            },
                            b: Diff {
                                x1: o.0,
                                y1: o.1,
                                x2: pb.0,
                                y2: pb.1,
                            },
                        },
                    ));
                }
            }
            Constraint::Concentric { a, b } => {
                if let (Some(ca), Some(cb)) = (map.pt(sketch, a), map.pt(sketch, b)) {
                    push_lin(&mut eqs, cid, vec![(ca.0, 1.0), (cb.0, -1.0)], 0.0);
                    push_lin(&mut eqs, cid, vec![(ca.1, 1.0), (cb.1, -1.0)], 0.0);
                }
            }
            Constraint::Collinear { a, b } => {
                if let (Some(da), Some(db)) = (map.line_diff(sketch, a), map.line_diff(sketch, b)) {
                    eqs.push((Some(cid), Eq::Cross { a: da, b: db }));
                    eqs.push((
                        Some(cid),
                        Eq::CrossPt {
                            d: da,
                            p: (db.x1, db.y1),
                            base: (da.x1, da.y1),
                            support: line_support(sketch, a).unwrap_or((1.0, 0.0)),
                            support_mode: line_is_degenerate(sketch, a),
                        },
                    ));
                }
            }
            Constraint::Symmetry { a, b, axis } => {
                if let Some(axd) = map.line_diff(sketch, axis) {
                    match (sketch.entity(a), sketch.entity(b)) {
                        (Some(Entity::Point { .. }), Some(Entity::Point { .. })) => {
                            if let (Some(pa), Some(pb)) = (map.pt(sketch, a), map.pt(sketch, b)) {
                                eqs.push((
                                    Some(cid),
                                    Eq::SymmetryMid {
                                        a: pa,
                                        b: pb,
                                        axis: axd,
                                    },
                                ));
                                eqs.push((
                                    Some(cid),
                                    Eq::Dot {
                                        a: Diff {
                                            x1: pa.0,
                                            y1: pa.1,
                                            x2: pb.0,
                                            y2: pb.1,
                                        },
                                        b: axd,
                                    },
                                ));
                            }
                        }
                        (Some(Entity::Line { .. }), Some(Entity::Line { .. })) => {
                            if let (Some(da), Some(db)) =
                                (map.line_diff(sketch, a), map.line_diff(sketch, b))
                            {
                                // Symmetric endpoint pairs: start↔start, end↔end.
                                for (p, q) in [
                                    ((da.x1, da.y1), (db.x1, db.y1)),
                                    ((da.x2, da.y2), (db.x2, db.y2)),
                                ] {
                                    eqs.push((
                                        Some(cid),
                                        Eq::SymmetryMid {
                                            a: p,
                                            b: q,
                                            axis: axd,
                                        },
                                    ));
                                    eqs.push((
                                        Some(cid),
                                        Eq::Dot {
                                            a: Diff {
                                                x1: p.0,
                                                y1: p.1,
                                                x2: q.0,
                                                y2: q.1,
                                            },
                                            b: axd,
                                        },
                                    ));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            Constraint::Distance { from, to, value } => {
                let target = sketch.dim_value(&cid, value);
                match (sketch.entity(from), to.map(|t| sketch.entity(t))) {
                    // Line length (line endpoints are shared points).
                    (Some(Entity::Line { .. }), None) => {
                        if let Some(d) = map.line_diff(sketch, from) {
                            eqs.push((
                                Some(cid),
                                Eq::DistPt {
                                    a: (d.x1, d.y1),
                                    b: (d.x2, d.y2),
                                    target,
                                },
                            ));
                        }
                    }
                    // Point ↔ point.
                    (Some(Entity::Point { .. }), Some(Some(Entity::Point { .. }))) => {
                        if let (Some(pa), Some(pb)) =
                            (map.pt(sketch, from), to.and_then(|t| map.pt(sketch, t)))
                        {
                            eqs.push((
                                Some(cid),
                                Eq::DistPt {
                                    a: pa,
                                    b: pb,
                                    target,
                                },
                            ));
                        }
                    }
                    // Point ↔ line (signed perpendicular distance).
                    (Some(Entity::Point { .. }), Some(Some(Entity::Line { .. }))) => {
                        if let (Some(p), Some(d)) = (
                            map.pt(sketch, from),
                            to.and_then(|t| map.line_diff(sketch, t)),
                        ) {
                            eqs.push((
                                Some(cid),
                                Eq::LineDist {
                                    d,
                                    q: p,
                                    base: (d.x1, d.y1),
                                    target,
                                },
                            ));
                        }
                    }
                    (Some(Entity::Line { .. }), Some(Some(Entity::Point { .. }))) => {
                        if let (Some(p), Some(d)) = (
                            to.and_then(|t| map.pt(sketch, t)),
                            map.line_diff(sketch, from),
                        ) {
                            eqs.push((
                                Some(cid),
                                Eq::LineDist {
                                    d,
                                    q: p,
                                    base: (d.x1, d.y1),
                                    target,
                                },
                            ));
                        }
                    }
                    // Two lines: perpendicular distance (parallel lines).
                    // The equation keeps the SIDE the geometry is on now:
                    // the target is the param's magnitude with the sign of
                    // the current signed distance (offset sides, M1c-ii).
                    (Some(Entity::Line { .. }), Some(Some(Entity::Line { .. }))) => {
                        if let (Some(da), Some(db)) = (
                            map.line_diff(sketch, from),
                            to.and_then(|t| map.line_diff(sketch, t)),
                        ) {
                            let target = {
                                let x = read_values(sketch, map);
                                let (dx, dy) = da.val(&x);
                                let len = (dx * dx + dy * dy).sqrt().max(1e-12);
                                let qx = x[db.x1] - x[da.x1];
                                let qy = x[db.y1] - x[da.y1];
                                let cur = (dx * qy - dy * qx) / len;
                                if cur < 0.0 {
                                    -target.abs()
                                } else {
                                    target.abs()
                                }
                            };
                            eqs.push((
                                Some(cid),
                                Eq::LineDist {
                                    d: da,
                                    q: (db.x1, db.y1),
                                    base: (da.x1, da.y1),
                                    target,
                                },
                            ));
                        }
                    }
                    // Concentric circle/arc offset: radial separation. The
                    // caller orders `from`/`to` so the positive driving
                    // parameter always means the requested offset amount.
                    (
                        Some(Entity::Circle { .. } | Entity::Arc { .. }),
                        Some(Some(Entity::Circle { .. } | Entity::Arc { .. })),
                    ) => {
                        if let (Some(r_from), Some(r_to)) = (
                            map.radius_var(sketch, from),
                            to.and_then(|id| map.radius_var(sketch, id)),
                        ) {
                            push_lin(&mut eqs, cid, vec![(r_to, 1.0), (r_from, -1.0)], -target);
                        }
                    }
                    _ => {}
                }
            }
            Constraint::Radius { entity, value } => {
                if let Some(r) = map.radius_var(sketch, entity) {
                    let target = sketch.dim_value(&cid, value);
                    eqs.push((Some(cid), Eq::Radius { r, target }));
                }
            }
            Constraint::Diameter { entity, value } => {
                if let Some(r) = map.radius_var(sketch, entity) {
                    let target = sketch.dim_value(&cid, value);
                    eqs.push((
                        Some(cid),
                        Eq::Radius {
                            r,
                            target: target / 2.0,
                        },
                    ));
                }
            }
            Constraint::Angle { a, b, value } => {
                // `b == AXIS_SENTINEL` measures from the plane's +u axis
                // (auto-created axis angle dimensions, D9).
                let target = sketch.dim_value(&cid, value).to_radians();
                if b.0 == AXIS_SENTINEL.0 {
                    if let Some(d) = map.line_diff(sketch, a) {
                        eqs.push((Some(cid), Eq::AngleAxis { a: d, target }));
                    }
                } else if let (Some(da), Some(db)) =
                    (map.line_diff(sketch, a), map.line_diff(sketch, b))
                {
                    eqs.push((
                        Some(cid),
                        Eq::AngleLines {
                            a: da,
                            b: db,
                            target,
                        },
                    ));
                }
            }
        }
    }

    // Drag pins: the dragged point is pinned to the cursor for this solve.
    for (id, target) in pins {
        if let Some(p) = map.points.get(id) {
            eqs.push((
                None,
                Eq::Lin {
                    terms: vec![(p.0, 1.0)],
                    c: -target.x,
                },
            ));
            eqs.push((
                None,
                Eq::Lin {
                    terms: vec![(p.1, 1.0)],
                    c: -target.y,
                },
            ));
        }
    }

    eqs
}

fn sketch_point(sketch: &Sketch, map: &VarMap, p: Pt) -> Vec2 {
    let x = read_values(sketch, map);
    Vec2::new(x[p.0], x[p.1])
}

fn has_point_line_incidence(sketch: &Sketch, point: EntityId, line: EntityId) -> bool {
    sketch.constraints().any(|(_, constraint)| {
        matches!(
            constraint,
            Constraint::Coincident { a, b }
                if (*a == point && *b == line) || (*a == line && *b == point)
        )
    })
}

/// Recover the persistent pre-trim corner associated with one finite carrier
/// endpoint. Chamfer stores it directly as `EqualDistance::origin`; Fillet
/// stores enough topology to recover it as the point incident to the carrier
/// and the arc's other tangent line.
fn trim_origin_for_endpoint(
    sketch: &Sketch,
    carrier: EntityId,
    endpoint: EntityId,
) -> Option<Vec2> {
    for (_, constraint) in sketch.constraints() {
        match *constraint {
            Constraint::EqualDistance { origin, a, b } if a == endpoint || b == endpoint => {
                return sketch.point_position(origin);
            }
            Constraint::ArcEndpointCoincident { point, arc, .. } if point == endpoint => {
                let adjacent_lines: Vec<EntityId> = sketch
                    .constraints()
                    .filter_map(|(_, tangent)| match *tangent {
                        Constraint::Tangent { a, b } if a == arc && b != carrier => Some(b),
                        Constraint::Tangent { a, b } if b == arc && a != carrier => Some(a),
                        _ => None,
                    })
                    .filter(|id| matches!(sketch.entity(*id), Some(Entity::Line { .. })))
                    .collect();
                for adjacent in adjacent_lines {
                    for (candidate, entity) in sketch.entities() {
                        if matches!(entity, Entity::Point { .. })
                            && has_point_line_incidence(sketch, candidate, carrier)
                            && has_point_line_incidence(sketch, candidate, adjacent)
                        {
                            return sketch.point_position(candidate);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// Directed support from the line's original start-side trim corner toward
/// its original end-side trim corner. This preserves all four rectangle edge
/// orientations when a zero-span carrier later reopens.
fn trimmed_carrier_direction(sketch: &Sketch, line: EntityId) -> Option<Vec2> {
    let (start, end) = sketch.line_endpoint_ids(line)?;
    // A carrier can be consumed by one trim exactly at its opposite endpoint
    // just as legitimately as by two opposing trims.  For an untrimmed end,
    // its current point is still the original support reference; a trimmed
    // end recovers its pre-trim corner from the persistent topology.
    let start_origin =
        trim_origin_for_endpoint(sketch, line, start).or_else(|| sketch.point_position(start))?;
    let end_origin =
        trim_origin_for_endpoint(sketch, line, end).or_else(|| sketch.point_position(end))?;
    let direction = end_origin - start_origin;
    (direction.length() >= DEGENERATE_LINE_EPS).then_some(direction)
}

fn line_is_degenerate(sketch: &Sketch, line: EntityId) -> bool {
    sketch
        .resolved_line(line)
        .is_some_and(|(start, end)| start.distance(end) < CONSUMED_CARRIER_EPS)
}

/// Choose the carrier endpoint owned by this fillet as the support-line
/// origin. When two fillets exactly consume a line, using the line's start
/// for both tangent equations makes the opposite drawing orientation
/// asymmetric and can pin the zero-span edge closed. Ordinary, untrimmed
/// line-circle tangencies retain the historical line-start origin.
fn tangent_base(sketch: &Sketch, map: &VarMap, line: EntityId, curve: EntityId, d: Diff) -> Pt {
    if let Some((start, end)) = sketch.line_endpoint_ids(line) {
        for (_, constraint) in sketch.constraints() {
            if let Constraint::ArcEndpointCoincident { point, arc, .. } = *constraint {
                if arc == curve && (point == start || point == end) {
                    if let Some(base) = map.pt(sketch, point) {
                        return base;
                    }
                }
            }
        }
    }
    (d.x1, d.y1)
}

/// Stable unit direction for a finite line or a fully consumed trim carrier.
/// Axis constraints are a compatibility fallback for older sketches that do
/// not carry the persistent corner topology needed to recover orientation.
fn line_support(sketch: &Sketch, line: EntityId) -> Option<(f64, f64)> {
    let (a, b) = sketch.resolved_line(line)?;
    let direction = b - a;
    let length = direction.length();
    if length >= CONSUMED_CARRIER_EPS {
        return Some((direction.x / length, direction.y / length));
    }

    if let Some(direction) = trimmed_carrier_direction(sketch, line) {
        let length = direction.length();
        return Some((direction.x / length, direction.y / length));
    }

    if length >= DEGENERATE_LINE_EPS {
        return Some((direction.x / length, direction.y / length));
    }

    if sketch.has_constraint_on(
        line,
        |constraint| matches!(constraint, Constraint::Horizontal { entity } if *entity == line),
    ) {
        return Some((1.0, 0.0));
    }
    if sketch.has_constraint_on(
        line,
        |constraint| matches!(constraint, Constraint::Vertical { entity } if *entity == line),
    ) {
        return Some((0.0, 1.0));
    }

    None
}

/// Which side of `line` the circle/arc center `c` sits on (for the signed
/// tangent residual): cross(line_dir, center − line_start) ≥ 0 → +1, else −1.
fn tangent_support(sketch: &Sketch, line: EntityId, curve: EntityId) -> (f64, f64) {
    if let Some(support) = line_support(sketch, line) {
        return support;
    }

    if let Some((a, _)) = sketch.resolved_line(line) {
        // For an arbitrary consumed edge, the radius at its anchored arc
        // endpoint determines the carrier tangent. Either endpoint is fine
        // here because a degenerate line has coincident endpoint positions.
        let center = match sketch.entity(curve) {
            Some(Entity::Circle { center, .. }) | Some(Entity::Arc { center, .. }) => *center,
            _ => Vec2::ZERO,
        };
        let tangent = (a - center).perp();
        let tangent_length = tangent.length();
        if tangent_length >= DEGENERATE_LINE_EPS {
            return (tangent.x / tangent_length, tangent.y / tangent_length);
        }
    }

    // Defensive fallback for malformed/legacy geometry. Direction sign is
    // immaterial because `tangent_sign` is derived from the same support.
    (1.0, 0.0)
}

fn tangent_sign(sketch: &Sketch, map: &VarMap, line: EntityId, c: Pt, support: (f64, f64)) -> f64 {
    let t = sketch
        .resolved_line(line)
        .map(|(a, b)| {
            let raw = b - a;
            let d = if raw.length() < CONSUMED_CARRIER_EPS {
                Vec2::new(support.0, support.1)
            } else {
                raw
            };
            let cc = sketch_point(sketch, map, c);
            d.x * (cc.y - a.y) - d.y * (cc.x - a.x)
        })
        .unwrap_or(1.0);
    if t >= 0.0 {
        1.0
    } else {
        -1.0
    }
}

fn current_r(sketch: &Sketch, id: EntityId) -> f64 {
    match sketch.entity(id) {
        Some(Entity::Circle { radius, .. }) | Some(Entity::Arc { radius, .. }) => *radius,
        _ => 0.0,
    }
}

fn eval_all(
    eqs: &[(Option<ConstraintId>, Eq)],
    x: &[f64],
    n: usize,
) -> (Vec<f64>, Vec<Vec<(usize, f64)>>) {
    let mut f = Vec::with_capacity(eqs.len());
    let mut rows = Vec::with_capacity(eqs.len());
    for (_, eq) in eqs {
        let (r, mut row) = eq.eval(x);
        // Merge duplicate var entries (shared points produce them).
        row.sort_by_key(|(i, _)| *i);
        let mut merged: Vec<(usize, f64)> = Vec::with_capacity(row.len());
        for (i, v) in row {
            if let Some(last) = merged.last_mut() {
                if last.0 == i {
                    last.1 += v;
                    continue;
                }
            }
            merged.push((i, v));
        }
        debug_assert!(merged.iter().all(|(i, _)| *i < n));
        f.push(r);
        rows.push(merged);
    }
    (f, rows)
}

fn max_abs(f: &[f64]) -> f64 {
    f.iter().fold(0.0_f64, |m, v| m.max(v.abs()))
}

/// Wrap an angle residual to (−π, π] (branch-safe for Newton steps).
fn wrap_angle(a: f64) -> f64 {
    const TAU: f64 = std::f64::consts::TAU;
    let mut w = a % TAU;
    if w <= -std::f64::consts::PI {
        w += TAU;
    } else if w > std::f64::consts::PI {
        w -= TAU;
    }
    w
}

/// Distance between two points given their variable pairs.
fn a2dist(x: &[f64], a: Pt, b: Pt) -> f64 {
    ((x[b.0] - x[a.0]).powi(2) + (x[b.1] - x[a.1]).powi(2)).sqrt()
}

/// Solve A·x = b with Gaussian elimination + partial pivoting.
/// Returns false on singularity.
fn solve_square(a: &mut [Vec<f64>], b: &mut [f64]) -> bool {
    let n = a.len();
    for col in 0..n {
        let mut pivot = col;
        for r in col + 1..n {
            if a[r][col].abs() > a[pivot][col].abs() {
                pivot = r;
            }
        }
        if a[pivot][col].abs() < 1e-14 {
            return false;
        }
        if pivot != col {
            a.swap(pivot, col);
            b.swap(pivot, col);
        }
        let d = a[col][col];
        for r in col + 1..n {
            let factor = a[r][col] / d;
            if factor == 0.0 {
                continue;
            }
            for c in col..n {
                a[r][c] -= factor * a[col][c];
            }
            b[r] -= factor * b[col];
        }
    }
    for col in (0..n).rev() {
        let mut s = b[col];
        for c in col + 1..n {
            s -= a[col][c] * b[c];
        }
        b[col] = s / a[col][col];
    }
    true
}

/// Rank + pivot columns of the Jacobian via Gaussian elimination.
fn rank_of(jac: &[Vec<(usize, f64)>], n: usize) -> (usize, Vec<bool>) {
    let m = jac.len();
    if m == 0 || n == 0 {
        return (0, vec![false; n]);
    }
    let mut a: Vec<Vec<f64>> = jac
        .iter()
        .map(|row| {
            let mut r = vec![0.0; n];
            for &(i, v) in row {
                r[i] = v;
            }
            r
        })
        .collect();
    let max_el = a
        .iter()
        .flat_map(|r| r.iter())
        .fold(0.0_f64, |acc, v| acc.max(v.abs()));
    let eps = 1e-9 * max_el.max(1.0);
    let mut pivot_col = vec![false; n];
    let mut rank = 0;
    for col in 0..n {
        if rank >= m {
            break;
        }
        let mut pivot = rank;
        for r in rank + 1..m {
            if a[r][col].abs() > a[pivot][col].abs() {
                pivot = r;
            }
        }
        if a[pivot][col].abs() <= eps {
            continue;
        }
        a.swap(pivot, rank);
        let d = a[rank][col];
        for r in rank + 1..m {
            let factor = a[r][col] / d;
            if factor == 0.0 {
                continue;
            }
            for c in col..n {
                a[r][c] -= factor * a[rank][c];
            }
        }
        pivot_col[col] = true;
        rank += 1;
    }
    (rank, pivot_col)
}

fn trim_reference_segment(sketch: &Sketch, line: EntityId) -> Option<fillet::LineSeg> {
    let (start, end) = sketch.line_endpoint_ids(line)?;
    let a =
        trim_origin_for_endpoint(sketch, line, start).or_else(|| sketch.point_position(start))?;
    let b = trim_origin_for_endpoint(sketch, line, end).or_else(|| sketch.point_position(end))?;
    (a.distance(b) >= DEGENERATE_LINE_EPS).then_some(fillet::LineSeg { a, b })
}

/// A consumed fillet carrier starts from a singular zero-span configuration.
/// When its radius changes, reconstruct the exact local fillet from the
/// persistent pre-trim corners before LM begins. This is only an initial
/// guess; the complete constraint system still determines the final geometry
/// and the crossed-carrier guard rejects values beyond the topology boundary.
fn seed_consumed_radius_edit(sketch: &Sketch, map: &VarMap, x: &mut [f64]) {
    let radius_edits = sketch
        .constraints()
        .filter_map(|(cid, constraint)| match *constraint {
            Constraint::Radius { entity, value } => {
                let radius_var = map.radius_var(sketch, entity)?;
                let current = x[radius_var].abs();
                let target = sketch.dim_value(&cid, value).abs();
                ((current - target).abs() > TOL).then_some((entity, radius_var, target))
            }
            _ => None,
        })
        .collect::<Vec<_>>();

    for (arc, radius_var, target) in radius_edits {
        let mut tangent_lines = sketch
            .constraints()
            .filter_map(|(_, constraint)| match *constraint {
                Constraint::Tangent { a, b }
                    if a == arc && matches!(sketch.entity(b), Some(Entity::Line { .. })) =>
                {
                    Some(b)
                }
                Constraint::Tangent { a, b }
                    if b == arc && matches!(sketch.entity(a), Some(Entity::Line { .. })) =>
                {
                    Some(a)
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        tangent_lines.sort_unstable();
        tangent_lines.dedup();
        if tangent_lines.len() != 2
            || !tangent_lines
                .iter()
                .any(|line| line_is_degenerate(sketch, *line))
        {
            continue;
        }

        let (Some(first), Some(second)) = (
            trim_reference_segment(sketch, tangent_lines[0]),
            trim_reference_segment(sketch, tangent_lines[1]),
        ) else {
            continue;
        };
        let Ok(result) = fillet::fillet_lines(&first, &second, target) else {
            continue;
        };
        let Some(&(center, _, start_angle, end_angle)) = map.arcs.get(&arc) else {
            continue;
        };
        x[center.0] = result.arc.center.x;
        x[center.1] = result.arc.center.y;
        x[radius_var] = target;

        for (line, tangent) in tangent_lines
            .into_iter()
            .zip([result.tangent_on_l1, result.tangent_on_l2])
        {
            let endpoint = sketch.constraints().find_map(|(_, constraint)| {
                let Constraint::ArcEndpointCoincident {
                    point,
                    arc: owner,
                    end,
                } = *constraint
                else {
                    return None;
                };
                (owner == arc
                    && sketch
                        .line_endpoint_ids(line)
                        .is_some_and(|(start, finish)| point == start || point == finish))
                .then_some((point, end))
            });
            let Some((point, end)) = endpoint else {
                continue;
            };
            let point_vars = map.points[&point];
            x[point_vars.0] = tangent.x;
            x[point_vars.1] = tangent.y;
            let angle = (tangent.y - result.arc.center.y).atan2(tangent.x - result.arc.center.x);
            match end {
                ArcEndpoint::Start => x[start_angle] = angle,
                ArcEndpoint::End => x[end_angle] = angle,
            }
        }
    }
}

/// Damped Newton (LM) solve; writes the solution back into the sketch.
pub fn solve(sketch: &mut Sketch, pins: &[(EntityId, Vec2)]) -> Analysis {
    let map = build_var_map(sketch);
    let eqs = build_equations(sketch, &map, pins);
    let n = map.n;
    let m = eqs.len();

    if n == 0 {
        return Analysis {
            converged: true,
            iterations: 0,
            residual: 0.0,
            unknowns: 0,
            equations: m,
            rank: 0,
            dof: 0,
            entity_free: HashMap::new(),
        };
    }

    let mut x = read_values(sketch, &map);
    seed_consumed_radius_edit(sketch, &map, &mut x);
    let (mut f, mut jac) = eval_all(&eqs, &x, n);
    let mut residual = max_abs(&f);
    // Pre-solve line lengths + radii for the collapse guard (see below).
    let pre_line_len: Vec<(usize, usize, usize, usize, f64, bool)> = sketch
        .entities()
        .filter_map(|(id, e)| match e {
            Entity::Line { start, end } => {
                let a = map.points[&start];
                let b = map.points[&end];
                Some((
                    a.0,
                    a.1,
                    b.0,
                    b.1,
                    a2dist(&x, a, b),
                    line_has_trimmed_endpoint(sketch, id, *start, *end),
                ))
            }
            _ => None,
        })
        .collect();
    let pre_radius: Vec<(usize, f64)> = sketch
        .entities()
        .filter_map(|(id, e)| match e {
            Entity::Circle { .. } => {
                let r = map.circles[&id].1;
                Some((r, x[r].abs()))
            }
            Entity::Arc { .. } => {
                let r = map.arcs[&id].1;
                Some((r, x[r].abs()))
            }
            _ => None,
        })
        .collect();
    let mut lambda = 1e-3;
    let mut iterations = 0;

    while residual > TOL && iterations < MAX_ITERS {
        iterations += 1;
        // Normal equations (JᵀJ + λ·diag(JᵀJ)) Δ = −Jᵀf.
        let mut ata = vec![vec![0.0; n]; n];
        let mut jtf = vec![0.0; n];
        for (row, &fr) in jac.iter().zip(f.iter()) {
            for &(i, vi) in row {
                jtf[i] -= vi * fr;
                for &(j, vj) in row {
                    ata[i][j] += vi * vj;
                }
            }
        }
        for i in 0..n {
            ata[i][i] += lambda * ata[i][i].max(1e-12);
        }
        let mut rhs = jtf;
        if !solve_square(&mut ata, &mut rhs) {
            lambda *= 8.0;
            continue;
        }
        let mut x_new = x.clone();
        for i in 0..n {
            x_new[i] += rhs[i];
        }
        let (f_new, jac_new) = eval_all(&eqs, &x_new, n);
        let res_new = max_abs(&f_new);
        if res_new < residual {
            x = x_new;
            f = f_new;
            jac = jac_new;
            lambda = (lambda / 4.0).max(1e-12);
            residual = res_new;
        } else {
            lambda *= 6.0;
        }
    }

    let converged = residual <= TOL;

    // Final undamped polish: the damped steps that first dip below TOL can
    // leave ~1e-9 wobble; one pure Newton step sharpens the solution.
    if converged {
        let mut ata = vec![vec![0.0; n]; n];
        let mut jtf = vec![0.0; n];
        for (row, &fr) in jac.iter().zip(f.iter()) {
            for &(i, vi) in row {
                jtf[i] -= vi * fr;
                for &(j, vj) in row {
                    ata[i][j] += vi * vj;
                }
            }
        }
        let mut rhs = jtf;
        if solve_square(&mut ata, &mut rhs) {
            let mut x_new = x.clone();
            for i in 0..n {
                x_new[i] += rhs[i];
            }
            let (f_new, jac_new) = eval_all(&eqs, &x_new, n);
            let res_new = max_abs(&f_new);
            if res_new < residual {
                x = x_new;
                f = f_new;
                jac = jac_new;
                residual = res_new;
            }
        }
    }

    let converged = residual <= TOL;

    // Degenerate-geometry guard: homogeneous direction equations (cross/
    // dot) have the trivial root d = 0 — LM happily collapses lines toward
    // points to satisfy e.g. Parallel+Perpendicular. That is not a valid
    // CAD outcome; treat a collapse (>99% shrinkage, capped at 0.1 mm) as
    // non-convergence so callers reject/revert. The intentional exception
    // is a carrier intentionally trimmed by a fillet/chamfer operation. Two
    // opposing trims may consume it at R1 + R2 == L; one trim may consume it
    // when its cutback equals the complete carrier length. In either case its
    // persistent corner topology preserves the support direction and makes a
    // later dimension edit reopen the span.
    let crossed_trimmed_carrier = sketch.entities().any(|(id, entity)| {
        let Entity::Line { start, end } = *entity else {
            return false;
        };
        if !line_has_trimmed_endpoint(sketch, id, start, end) {
            return false;
        }
        let Some(support) = trimmed_carrier_direction(sketch, id) else {
            return false;
        };
        let a = map.points[&start];
        let b = map.points[&end];
        let post = Vec2::new(x[b.0] - x[a.0], x[b.1] - x[a.1]);
        post.dot(support) / support.length() < -DEGENERATE_LINE_EPS
    });

    let invalid_geometry = crossed_trimmed_carrier
        || pre_line_len
            .iter()
            .any(|&(x1, y1, x2, y2, pre, intentional_trim)| {
                let post = ((x[x2] - x[x1]).powi(2) + (x[y2] - x[y1]).powi(2)).sqrt();
                !intentional_trim && (post < (pre * 0.01).min(0.1) || post < 1e-9)
            })
        || pre_radius
            .iter()
            .any(|&(r, pre)| x[r].abs() < (pre * 0.01).min(0.1) || x[r].abs() < 1e-9);
    let converged = converged && !invalid_geometry;
    if converged {
        write_values(sketch, &map, &x);
    }

    finish_analysis(
        sketch, &map, &eqs, &x, &f, &jac, converged, iterations, residual,
    )
}

/// Whether one endpoint is owned by a modify-tool trim. Fillets mark the
/// endpoint with `ArcEndpointCoincident`; chamfers mark it as one of the two
/// `EqualDistance` targets.
fn endpoint_is_trimmed(sketch: &Sketch, line: EntityId, point: EntityId) -> bool {
    sketch
        .constraints()
        .any(|(_, constraint)| match *constraint {
            Constraint::ArcEndpointCoincident { point: p, arc, .. } if p == point => {
                sketch.constraints().any(|(_, tangent)| {
                    matches!(
                        tangent,
                        Constraint::Tangent { a, b }
                            if (*a == line && *b == arc) || (*a == arc && *b == line)
                    )
                })
            }
            Constraint::EqualDistance { a, b, .. } => a == point || b == point,
            _ => false,
        })
}

/// Internal trim ownership distinguishes a valid topology transition from an
/// accidental solver collapse of an ordinary line. One owned endpoint is
/// sufficient: an exact one-sided fillet/chamfer can consume the full edge.
fn line_has_trimmed_endpoint(
    sketch: &Sketch,
    line: EntityId,
    start: EntityId,
    end: EntityId,
) -> bool {
    endpoint_is_trimmed(sketch, line, start) || endpoint_is_trimmed(sketch, line, end)
}

/// Presentation predicate for a stable carrier whose visible span is fully
/// consumed. Keeping the entity lets later dimension edits reopen it.
pub(crate) fn line_is_consumed_trim_carrier(sketch: &Sketch, line: EntityId) -> bool {
    let Some((start, end)) = sketch.line_endpoint_ids(line) else {
        return false;
    };
    line_has_trimmed_endpoint(sketch, line, start, end)
        && sketch
            .resolved_line(line)
            .is_some_and(|(a, b)| a.distance(b) < CONSUMED_CARRIER_EPS)
}

/// Analysis without mutation (residual at the current state).
pub fn analyze(sketch: &Sketch) -> Analysis {
    let map = build_var_map(sketch);
    let eqs = build_equations(sketch, &map, &[]);
    let x = read_values(sketch, &map);
    let (f, jac) = eval_all(&eqs, &x, map.n);
    let residual = max_abs(&f);
    finish_analysis(
        sketch,
        &map,
        &eqs,
        &x,
        &f,
        &jac,
        residual <= TOL,
        0,
        residual,
    )
}

/// Residual of one constraint's own equations at the sketch's current
/// state — used by over-constraint rejection (D4.2).
pub fn constraint_residual(sketch: &Sketch, cid: ConstraintId) -> f64 {
    let map = build_var_map(sketch);
    let eqs = build_equations(sketch, &map, &[]);
    let x = read_values(sketch, &map);
    eqs.iter()
        .filter(|(owner, _)| *owner == Some(cid))
        .map(|(_, eq)| eq.eval(&x).0.abs())
        .fold(0.0_f64, |a, b| a.max(b))
}

fn finish_analysis(
    sketch: &Sketch,
    map: &VarMap,
    eqs: &[(Option<ConstraintId>, Eq)],
    x: &[f64],
    _f: &[f64],
    jac: &[Vec<(usize, f64)>],
    converged: bool,
    iterations: usize,
    residual: f64,
) -> Analysis {
    let _ = x;
    let (rank, pivot_col) = rank_of(jac, map.n);
    let mut entity_free: HashMap<EntityId, usize> = HashMap::new();
    for (id, entity) in sketch.entities() {
        let vars: Vec<usize> = match entity {
            Entity::Point { .. } => {
                let p = map.points[&id];
                vec![p.0, p.1]
            }
            Entity::Circle { .. } => {
                let (c, r) = map.circles[&id];
                vec![c.0, c.1, r]
            }
            Entity::Arc { .. } => {
                let (c, r, a0, a1) = map.arcs[&id];
                vec![c.0, c.1, r, a0, a1]
            }
            Entity::Line { .. } => vec![],
            Entity::Spline { .. } => map
                .splines
                .get(&id)
                .into_iter()
                .flatten()
                .flat_map(|point| [point.0, point.1])
                .collect(),
        };
        let free = vars.iter().filter(|v| !pivot_col[**v]).count();
        entity_free.insert(id, free);
        // Lines inherit the free state of their endpoints for coloring:
        // a line is fully defined iff both endpoint points are.
        if let Entity::Line { start, end } = entity {
            let s = entity_free.get(start).copied().unwrap_or(0);
            let e = entity_free.get(end).copied().unwrap_or(0);
            entity_free.insert(id, s + e);
        }
    }
    Analysis {
        converged,
        iterations,
        residual,
        unknowns: map.n,
        equations: eqs.len(),
        rank,
        dof: map.n.saturating_sub(rank) as i32,
        entity_free,
    }
}
