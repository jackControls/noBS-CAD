//! Move, copy, scale, rotate, and mirror transforms for sketch geometry.
//!
//! The module-local `Pt` aliases the crate's `Vec2` so sketch operations share
//! the engine's geometry type.

pub type Pt = crate::geometry::Vec2;

use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineSeg {
    pub a: Pt,
    pub b: Pt,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Circle {
    pub center: Pt,
    pub radius: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArcSeg {
    pub circle: Circle,
    pub start_angle: f64,
    pub end_angle: f64,
    pub ccw: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    Line(LineSeg),
    Circle(Circle),
    Arc(ArcSeg),
}

/// Normalize angle to (-pi, pi]
fn normalize_angle(angle: f64) -> f64 {
    let mut a = angle % (2.0 * PI);
    if a > PI {
        a -= 2.0 * PI;
    } else if a <= -PI {
        a += 2.0 * PI;
    }
    a
}

/// Reflect point p across the infinite line defined by axis.
pub fn mirror_point(p: Pt, axis: &LineSeg) -> Pt {
    let dx = axis.b.x - axis.a.x;
    let dy = axis.b.y - axis.a.y;

    // If axis is a point, return p (degenerate case)
    if dx == 0.0 && dy == 0.0 {
        return p;
    }

    let len_sq = dx * dx + dy * dy;

    // Project p onto the line
    // t = ((p - a) . (b - a)) / |b - a|^2
    let t = ((p.x - axis.a.x) * dx + (p.y - axis.a.y) * dy) / len_sq;

    // Projection point
    let proj_x = axis.a.x + t * dx;
    let proj_y = axis.a.y + t * dy;

    // Reflection: p' = 2 * proj - p
    Pt {
        x: 2.0 * proj_x - p.x,
        y: 2.0 * proj_y - p.y,
    }
}

/// Reflect curve across the infinite line defined by axis.
pub fn mirror_curve(c: &Curve, axis: &LineSeg) -> Curve {
    match c {
        Curve::Line(line) => {
            let a = mirror_point(line.a, axis);
            let b = mirror_point(line.b, axis);
            Curve::Line(LineSeg { a, b })
        }
        Curve::Circle(circle) => {
            let center = mirror_point(circle.center, axis);
            Curve::Circle(Circle {
                center,
                radius: circle.radius,
            })
        }
        Curve::Arc(arc) => {
            let center = mirror_point(arc.circle.center, axis);

            // Calculate the angle of the axis line
            let dx = axis.b.x - axis.a.x;
            let dy = axis.b.y - axis.a.y;
            let phi = dy.atan2(dx);

            // Reflection maps angle theta -> 2*phi - theta
            // The reflected arc has:
            // - reflected_start = reflect(end_angle) = 2*phi - end_angle
            // - reflected_end = reflect(start_angle) = 2*phi - start_angle
            // - ccw flips

            let reflected_start = 2.0 * phi - arc.end_angle;
            let reflected_end = 2.0 * phi - arc.start_angle;

            Curve::Arc(ArcSeg {
                circle: Circle {
                    center,
                    radius: arc.circle.radius,
                },
                start_angle: normalize_angle(reflected_start),
                end_angle: normalize_angle(reflected_end),
                ccw: !arc.ccw,
            })
        }
    }
}

/// Translate curve by (dx, dy).
pub fn translate_curve(c: &Curve, dx: f64, dy: f64) -> Curve {
    match c {
        Curve::Line(line) => Curve::Line(LineSeg {
            a: Pt {
                x: line.a.x + dx,
                y: line.a.y + dy,
            },
            b: Pt {
                x: line.b.x + dx,
                y: line.b.y + dy,
            },
        }),
        Curve::Circle(circle) => Curve::Circle(Circle {
            center: Pt {
                x: circle.center.x + dx,
                y: circle.center.y + dy,
            },
            radius: circle.radius,
        }),
        Curve::Arc(arc) => Curve::Arc(ArcSeg {
            circle: Circle {
                center: Pt {
                    x: arc.circle.center.x + dx,
                    y: arc.circle.center.y + dy,
                },
                radius: arc.circle.radius,
            },
            start_angle: arc.start_angle,
            end_angle: arc.end_angle,
            ccw: arc.ccw,
        }),
    }
}

/// Scale curve relative to origin by factor. Factor must be > 0.
#[cfg(test)]
pub fn scale_curve(c: &Curve, origin: Pt, factor: f64) -> Curve {
    debug_assert!(factor > 0.0);

    match c {
        Curve::Line(line) => {
            let a = Pt {
                x: origin.x + factor * (line.a.x - origin.x),
                y: origin.y + factor * (line.a.y - origin.y),
            };
            let b = Pt {
                x: origin.x + factor * (line.b.x - origin.x),
                y: origin.y + factor * (line.b.y - origin.y),
            };
            Curve::Line(LineSeg { a, b })
        }
        Curve::Circle(circle) => {
            let center = Pt {
                x: origin.x + factor * (circle.center.x - origin.x),
                y: origin.y + factor * (circle.center.y - origin.y),
            };
            Curve::Circle(Circle {
                center,
                radius: circle.radius * factor,
            })
        }
        Curve::Arc(arc) => {
            let center = Pt {
                x: origin.x + factor * (arc.circle.center.x - origin.x),
                y: origin.y + factor * (arc.circle.center.y - origin.y),
            };
            Curve::Arc(ArcSeg {
                circle: Circle {
                    center,
                    radius: arc.circle.radius * factor,
                },
                start_angle: arc.start_angle,
                end_angle: arc.end_angle,
                ccw: arc.ccw,
            })
        }
    }
}

/// Rotate curve about origin by angle (radians, CCW).
#[cfg(test)]
pub fn rotate_curve(c: &Curve, origin: Pt, angle: f64) -> Curve {
    let cos_a = angle.cos();
    let sin_a = angle.sin();

    fn rotate_point(p: Pt, origin: Pt, cos_a: f64, sin_a: f64) -> Pt {
        let dx = p.x - origin.x;
        let dy = p.y - origin.y;
        Pt {
            x: origin.x + cos_a * dx - sin_a * dy,
            y: origin.y + sin_a * dx + cos_a * dy,
        }
    }

    match c {
        Curve::Line(line) => {
            let a = rotate_point(line.a, origin, cos_a, sin_a);
            let b = rotate_point(line.b, origin, cos_a, sin_a);
            Curve::Line(LineSeg { a, b })
        }
        Curve::Circle(circle) => {
            let center = rotate_point(circle.center, origin, cos_a, sin_a);
            Curve::Circle(Circle {
                center,
                radius: circle.radius,
            })
        }
        Curve::Arc(arc) => {
            let center = rotate_point(arc.circle.center, origin, cos_a, sin_a);
            Curve::Arc(ArcSeg {
                circle: Circle {
                    center,
                    radius: arc.circle.radius,
                },
                start_angle: normalize_angle(arc.start_angle + angle),
                end_angle: normalize_angle(arc.end_angle + angle),
                ccw: arc.ccw,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f64 = 1e-9;

    fn approx_eq(a: f64, b: f64) -> bool {
        (a - b).abs() < EPS
    }

    fn approx_pt_eq(a: Pt, b: Pt) -> bool {
        approx_eq(a.x, b.x) && approx_eq(a.y, b.y)
    }

    #[test]
    fn test_mirror_point() {
        let p = Pt { x: 3.0, y: 2.0 };
        let axis = LineSeg {
            a: Pt { x: 0.0, y: -1.0 },
            b: Pt { x: 0.0, y: 1.0 },
        };
        let result = mirror_point(p, &axis);
        let expected = Pt { x: -3.0, y: 2.0 };
        assert!(
            approx_pt_eq(result, expected),
            "mirror_point failed: got {:?}, expected {:?}",
            result,
            expected
        );
    }

    #[test]
    fn test_mirror_line() {
        let line = LineSeg {
            a: Pt { x: 1.0, y: 0.0 },
            b: Pt { x: 2.0, y: 2.0 },
        };
        let axis = LineSeg {
            a: Pt { x: 0.0, y: -1.0 },
            b: Pt { x: 0.0, y: 1.0 },
        };
        let result = mirror_curve(&Curve::Line(line), &axis);
        let expected = Curve::Line(LineSeg {
            a: Pt { x: -1.0, y: 0.0 },
            b: Pt { x: -2.0, y: 2.0 },
        });
        assert_eq!(result, expected, "mirror_line failed");
    }

    #[test]
    fn test_mirror_circle() {
        let circle = Circle {
            center: Pt { x: 4.0, y: 1.0 },
            radius: 2.0,
        };
        let axis = LineSeg {
            a: Pt { x: 0.0, y: -1.0 },
            b: Pt { x: 0.0, y: 1.0 },
        };
        let result = mirror_curve(&Curve::Circle(circle), &axis);
        let expected = Curve::Circle(Circle {
            center: Pt { x: -4.0, y: 1.0 },
            radius: 2.0,
        });
        assert_eq!(result, expected, "mirror_circle failed");
    }

    #[test]
    fn test_mirror_arc() {
        let arc = ArcSeg {
            circle: Circle {
                center: Pt { x: 0.0, y: 0.0 },
                radius: 1.0,
            },
            start_angle: 0.0,
            end_angle: std::f64::consts::FRAC_PI_2,
            ccw: true,
        };
        let axis = LineSeg {
            a: Pt { x: 0.0, y: -1.0 },
            b: Pt { x: 0.0, y: 1.0 },
        };
        let result = mirror_curve(&Curve::Arc(arc), &axis);

        if let Curve::Arc(result_arc) = result {
            assert!(
                approx_pt_eq(result_arc.circle.center, Pt { x: 0.0, y: 0.0 }),
                "center mismatch"
            );
            assert!(approx_eq(result_arc.circle.radius, 1.0), "radius mismatch");
            assert!(
                approx_eq(result_arc.start_angle, std::f64::consts::FRAC_PI_2),
                "start_angle mismatch: got {}",
                result_arc.start_angle
            );
            assert!(
                approx_eq(result_arc.end_angle, std::f64::consts::PI),
                "end_angle mismatch: got {}",
                result_arc.end_angle
            );
            assert!(!result_arc.ccw, "ccw should be false");
        } else {
            panic!("Expected Arc");
        }
    }

    #[test]
    fn test_translate_line() {
        let line = LineSeg {
            a: Pt { x: 1.0, y: 1.0 },
            b: Pt { x: 2.0, y: 2.0 },
        };
        let result = translate_curve(&Curve::Line(line), 3.0, -1.0);
        let expected = Curve::Line(LineSeg {
            a: Pt { x: 4.0, y: 0.0 },
            b: Pt { x: 5.0, y: 1.0 },
        });
        assert_eq!(result, expected, "translate_line failed");
    }

    #[test]
    fn test_scale_line() {
        let line = LineSeg {
            a: Pt { x: 1.0, y: 0.0 },
            b: Pt { x: 3.0, y: 0.0 },
        };
        let origin = Pt { x: 0.0, y: 0.0 };
        let result = scale_curve(&Curve::Line(line), origin, 2.0);
        let expected = Curve::Line(LineSeg {
            a: Pt { x: 2.0, y: 0.0 },
            b: Pt { x: 6.0, y: 0.0 },
        });
        assert_eq!(result, expected, "scale_line failed");
    }

    #[test]
    fn test_scale_circle() {
        let circle = Circle {
            center: Pt { x: 1.0, y: 1.0 },
            radius: 2.0,
        };
        let origin = Pt { x: 1.0, y: 1.0 };
        let result = scale_curve(&Curve::Circle(circle), origin, 3.0);
        let expected = Curve::Circle(Circle {
            center: Pt { x: 1.0, y: 1.0 },
            radius: 6.0,
        });
        assert_eq!(result, expected, "scale_circle failed");
    }

    #[test]
    fn test_rotate_line() {
        let line = LineSeg {
            a: Pt { x: 1.0, y: 0.0 },
            b: Pt { x: 2.0, y: 0.0 },
        };
        let origin = Pt { x: 0.0, y: 0.0 };
        let angle = std::f64::consts::FRAC_PI_2;
        let result = rotate_curve(&Curve::Line(line), origin, angle);

        if let Curve::Line(result_line) = result {
            assert!(
                approx_pt_eq(result_line.a, Pt { x: 0.0, y: 1.0 }),
                "a mismatch"
            );
            assert!(
                approx_pt_eq(result_line.b, Pt { x: 0.0, y: 2.0 }),
                "b mismatch"
            );
        } else {
            panic!("Expected Line");
        }
    }

    #[test]
    fn test_rotate_arc() {
        let arc = ArcSeg {
            circle: Circle {
                center: Pt { x: 1.0, y: 0.0 },
                radius: 2.0,
            },
            start_angle: 0.0,
            end_angle: 1.0,
            ccw: true,
        };
        let origin = Pt { x: 0.0, y: 0.0 };
        let angle = std::f64::consts::PI;
        let result = rotate_curve(&Curve::Arc(arc), origin, angle);

        if let Curve::Arc(result_arc) = result {
            assert!(
                approx_pt_eq(result_arc.circle.center, Pt { x: -1.0, y: 0.0 }),
                "center mismatch"
            );
            assert!(approx_eq(result_arc.circle.radius, 2.0), "radius mismatch");
            assert!(
                approx_eq(result_arc.start_angle, std::f64::consts::PI),
                "start_angle mismatch: got {}",
                result_arc.start_angle
            );
            // end_angle should be pi + 1.0 = 4.141592653589793
            // Or normalized: 4.141592653589793 - 2*pi = -2.141592653589793
            let expected_end = 4.141592653589793;
            let normalized_end = normalize_angle(expected_end);
            assert!(
                approx_eq(result_arc.end_angle, normalized_end),
                "end_angle mismatch: got {}, expected {}",
                result_arc.end_angle,
                normalized_end
            );
            assert!(result_arc.ccw, "ccw should be true");
        } else {
            panic!("Expected Arc");
        }
    }
}
