//! Point transforms used by topology-preserving sketch copy operations.
//! Curves and shared handles are transformed together in session::mods.
use crate::geometry::Vec2;

pub struct LineSeg {
    pub a: Vec2,
    pub b: Vec2,
}

/// Reflect a point about an infinite axis. A zero-length axis is a no-op;
/// the session validates that user-picked mirror axes are non-degenerate.
pub fn mirror_point(p: Vec2, axis: &LineSeg) -> Vec2 {
    let d = axis.b - axis.a;
    let length_squared = d.dot(d);
    if length_squared == 0.0 {
        return p;
    }
    let projection = axis.a + d * ((p - axis.a).dot(d) / length_squared);
    projection * 2.0 - p
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reflection_is_an_involution_and_preserves_axis_points() {
        for (a, b) in [
            (Vec2::new(0., 0.), Vec2::new(1., 0.)),
            (Vec2::new(2., 3.), Vec2::new(-3., 9.)),
        ] {
            let axis = LineSeg { a, b };
            let p = Vec2::new(8., -7.);
            assert!(mirror_point(mirror_point(p, &axis), &axis).distance(p) < 1e-10);
            assert!(mirror_point(a + (b - a) * 0.37, &axis).distance(a + (b - a) * 0.37) < 1e-10);
        }
        let p = Vec2::new(3., 4.);
        assert_eq!(mirror_point(p, &LineSeg { a: p, b: p }), p);
    }
}
