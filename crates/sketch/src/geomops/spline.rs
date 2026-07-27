//! Centripetal Catmull-Rom (alpha = 0.5) fit-point spline tessellation,
//! Barry-Goldman scheme with reflection phantom endpoints.
//!
//! The module-local `Pt` aliases the crate's `Vec2` so sketch operations share
//! the engine's geometry type.

pub type Pt = crate::geometry::Vec2;

impl Pt {
    fn add(self, other: Pt) -> Pt {
        Pt {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }

    fn sub(self, other: Pt) -> Pt {
        Pt {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }

    fn mul(self, scalar: f64) -> Pt {
        Pt {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

fn dist(a: Pt, b: Pt) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    (dx * dx + dy * dy).sqrt()
}

pub fn tessellate_spline(points: &[Pt], segments_per_span: usize) -> Vec<Pt> {
    let n = points.len();
    if n < 2 {
        return Vec::new();
    }
    if n == 2 {
        return points.to_vec();
    }

    let segs = segments_per_span.clamp(4, 96);

    let p_minus = points[0].add(points[0].sub(points[1]));
    let p_plus = points[n - 1].add(points[n - 1].sub(points[n - 2]));

    let mut output = Vec::new();
    output.push(points[0]);

    for i in 0..n - 1 {
        let p0 = if i == 0 { p_minus } else { points[i - 1] };
        let p1 = points[i];
        let p2 = points[i + 1];
        let p3 = if i == n - 2 { p_plus } else { points[i + 2] };

        let alpha = 0.5;
        let t0 = 0.0;
        let d01 = dist(p0, p1);
        let d12 = dist(p1, p2);
        let d23 = dist(p2, p3);

        let t1 = t0 + d01.powf(alpha);
        let t2 = t1 + d12.powf(alpha);
        let t3 = t2 + d23.powf(alpha);

        let denom1 = t1 - t0;
        let denom2 = t2 - t1;
        let denom3 = t3 - t2;
        let denom4 = t2 - t0;
        let denom5 = t3 - t1;
        let denom6 = t2 - t1;

        let eps = 1e-9;
        let d1 = if denom1.abs() < eps { 1e-9 } else { denom1 };
        let d2 = if denom2.abs() < eps { 1e-9 } else { denom2 };
        let d3 = if denom3.abs() < eps { 1e-9 } else { denom3 };
        let d4 = if denom4.abs() < eps { 1e-9 } else { denom4 };
        let d5 = if denom5.abs() < eps { 1e-9 } else { denom5 };
        let d6 = if denom6.abs() < eps { 1e-9 } else { denom6 };

        for j in 1..=segs {
            let t = t1 + (t2 - t1) * (j as f64 / segs as f64);

            let w1 = (t1 - t) / d1;
            let w2 = (t - t0) / d1;
            let w3 = (t2 - t) / d2;
            let w4 = (t - t1) / d2;
            let w5 = (t3 - t) / d3;
            let w6 = (t - t2) / d3;

            let a1 = p0.mul(w1).add(p1.mul(w2));
            let a2 = p1.mul(w3).add(p2.mul(w4));
            let a3 = p2.mul(w5).add(p3.mul(w6));

            let w7 = (t2 - t) / d4;
            let w8 = (t - t0) / d4;
            let w9 = (t3 - t) / d5;
            let w10 = (t - t1) / d5;

            let b1 = a1.mul(w7).add(a2.mul(w8));
            let b2 = a2.mul(w9).add(a3.mul(w10));

            let w11 = (t2 - t) / d6;
            let w12 = (t - t1) / d6;

            let c = b1.mul(w11).add(b2.mul(w12));
            output.push(c);
        }
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_eq(a: Pt, b: Pt, tol: f64) -> bool {
        (a.x - b.x).abs() < tol && (a.y - b.y).abs() < tol
    }

    #[test]
    fn test_empty_and_single_and_two_points() {
        assert!(tessellate_spline(&[], 4).is_empty());
        assert!(tessellate_spline(&[Pt { x: 1.0, y: 2.0 }], 4).is_empty());

        let pts = vec![Pt { x: 1.0, y: 2.0 }, Pt { x: 3.0, y: 4.0 }];
        let res = tessellate_spline(&pts, 4);
        assert_eq!(res.len(), 2);
        assert!(approx_eq(res[0], pts[0], 1e-9));
        assert!(approx_eq(res[1], pts[1], 1e-9));
    }

    #[test]
    fn test_collinear_three_points() {
        let pts = vec![
            Pt { x: 0.0, y: 0.0 },
            Pt { x: 10.0, y: 0.0 },
            Pt { x: 20.0, y: 0.0 },
        ];
        let res = tessellate_spline(&pts, 4);
        assert_eq!(res.len(), 9);
        let expected_x = [0.0, 2.5, 5.0, 7.5, 10.0, 12.5, 15.0, 17.5, 20.0];
        for (i, &ex) in expected_x.iter().enumerate() {
            assert!((res[i].x - ex).abs() < 1e-9, "x mismatch at index {}", i);
            assert!(res[i].y.abs() < 1e-9, "y mismatch at index {}", i);
        }
    }

    #[test]
    fn test_four_points_all_input_points_present() {
        let pts = vec![
            Pt { x: 0.0, y: 0.0 },
            Pt { x: 10.0, y: 10.0 },
            Pt { x: 20.0, y: 0.0 },
            Pt { x: 30.0, y: 10.0 },
        ];
        let res = tessellate_spline(&pts, 8);
        for p in &pts {
            assert!(
                res.iter().any(|r| approx_eq(*r, *p, 1e-9)),
                "Input point {:?} not found in output",
                p
            );
        }
    }

    #[test]
    fn test_three_points_symmetry() {
        let pts = vec![
            Pt { x: 0.0, y: 0.0 },
            Pt { x: 10.0, y: 10.0 },
            Pt { x: 20.0, y: 0.0 },
        ];
        let res = tessellate_spline(&pts, 8);
        assert_eq!(res.len(), 17);
        for i in 0..17 {
            let j = 16 - i;
            let sum_x = res[i].x + res[j].x;
            assert!(
                (sum_x - 20.0).abs() < 1e-9,
                "Symmetry x failed at index {}: {} + {} != 20",
                i,
                res[i].x,
                res[j].x
            );
            assert!(
                (res[i].y - res[j].y).abs() < 1e-9,
                "Symmetry y failed at index {}: {} != {}",
                i,
                res[i].y,
                res[j].y
            );
        }
    }

    #[test]
    fn test_segments_per_span_clamp() {
        let pts = vec![
            Pt { x: 0.0, y: 0.0 },
            Pt { x: 10.0, y: 0.0 },
            Pt { x: 20.0, y: 0.0 },
        ];
        let res = tessellate_spline(&pts, 0);
        let num_spans = pts.len() - 1;
        assert_eq!(res.len(), num_spans * 4 + 1);
    }
}
