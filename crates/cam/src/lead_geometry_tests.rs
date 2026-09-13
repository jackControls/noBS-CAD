use super::*;

#[test]
fn continuous_arc_clearance_finds_a_thin_obstacle_between_old_sample_stations() {
    for clockwise in [false, true] {
        for phase in [0.0, 0.13, 1.7, 3.5] {
            let sign = if clockwise { -1.0 } else { 1.0 };
            let point = |angle: f64, radius: f64| {
                Point2Dto::new(123.4 + radius * angle.cos(), -55.3 + radius * angle.sin())
            };
            let from = point(phase, 100.0);
            let arc = LeadArc {
                center: Point2Dto::new(123.4, -55.3),
                clockwise,
                arc_end: point(phase + sign * std::f64::consts::FRAC_PI_2, 100.0),
            };
            let between = phase + sign * std::f64::consts::FRAC_PI_2 * 10.5 / 32.0;
            assert!(
                arc_segment_distance(from, &arc, point(between, 99.999), point(between, 100.001))
                    < 1e-7
            );
            assert!(
                (arc_segment_distance(from, &arc, point(between, 103.0), point(between, 104.0))
                    - 3.0)
                    .abs()
                    < 1e-7
            );
        }
    }
}

#[test]
fn continuous_arc_distance_matches_independent_dense_distance_search() {
    let from = Point2Dto::new(5.0, 0.0);
    let arc = LeadArc {
        center: Point2Dto::new(0.0, 0.0),
        clockwise: false,
        arc_end: Point2Dto::new(0.0, 5.0),
    };
    for (a, b) in [
        (Point2Dto::new(3.0, 3.0), Point2Dto::new(8.0, 3.0)),
        (Point2Dto::new(-2.0, -1.0), Point2Dto::new(-3.0, 9.0)),
        (Point2Dto::new(1.0, 6.0), Point2Dto::new(7.0, 7.0)),
    ] {
        let exact = arc_segment_distance(from, &arc, a, b);
        let sampled = (0..=10000)
            .map(|i| {
                let angle = std::f64::consts::FRAC_PI_2 * i as f64 / 10000.0;
                segment_distance(Point2Dto::new(5.0 * angle.cos(), 5.0 * angle.sin()), a, b)
            })
            .fold(f64::INFINITY, f64::min);
        assert!(exact <= sampled + 1e-9 && sampled - exact < 0.001);
    }
}
