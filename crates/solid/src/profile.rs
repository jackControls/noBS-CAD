use std::cmp::Ordering;
use std::fmt;

use crate::Point2Dto;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Segment2 {
    pub id: u64,
    pub a: Point2Dto,
    pub b: Point2Dto,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProfileError {
    Empty,
    OpenChain(u64),
    Branch(Point2Dto),
    Degenerate,
    SelfIntersecting,
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProfileError::Empty => write!(f, "sketch contains no closed profile curves"),
            ProfileError::OpenChain(id) => write!(f, "profile curve {id} belongs to an open chain"),
            ProfileError::Branch(p) => {
                write!(f, "profile branches near ({:.4}, {:.4})", p.x, p.y)
            }
            ProfileError::Degenerate => write!(f, "profile is degenerate"),
            ProfileError::SelfIntersecting => write!(f, "profile is self-intersecting"),
        }
    }
}

impl std::error::Error for ProfileError {}

fn dist2(a: Point2Dto, b: Point2Dto) -> f64 {
    (a.x - b.x).powi(2) + (a.y - b.y).powi(2)
}

fn point_cmp(a: Point2Dto, b: Point2Dto) -> Ordering {
    a.x.total_cmp(&b.x).then_with(|| a.y.total_cmp(&b.y))
}

fn signed_area(points: &[Point2Dto]) -> f64 {
    points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .map(|(a, b)| a.x * b.y - b.x * a.y)
        .sum::<f64>()
        * 0.5
}

fn orientation(a: Point2Dto, b: Point2Dto, c: Point2Dto) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

fn on_segment(a: Point2Dto, b: Point2Dto, p: Point2Dto, eps: f64) -> bool {
    orientation(a, b, p).abs() <= eps
        && p.x >= a.x.min(b.x) - eps
        && p.x <= a.x.max(b.x) + eps
        && p.y >= a.y.min(b.y) - eps
        && p.y <= a.y.max(b.y) + eps
}

fn segments_intersect(a: Point2Dto, b: Point2Dto, c: Point2Dto, d: Point2Dto, eps: f64) -> bool {
    let o1 = orientation(a, b, c);
    let o2 = orientation(a, b, d);
    let o3 = orientation(c, d, a);
    let o4 = orientation(c, d, b);
    (o1 * o2 < -eps && o3 * o4 < -eps)
        || (o1.abs() <= eps && on_segment(a, b, c, eps))
        || (o2.abs() <= eps && on_segment(a, b, d, eps))
        || (o3.abs() <= eps && on_segment(c, d, a, eps))
        || (o4.abs() <= eps && on_segment(c, d, b, eps))
}

fn validate_simple(points: &[Point2Dto], eps: f64) -> Result<(), ProfileError> {
    let n = points.len();
    for i in 0..n {
        let a = points[i];
        let b = points[(i + 1) % n];
        for j in (i + 1)..n {
            if j == i || j == (i + 1) % n || (i == 0 && j == n - 1) {
                continue;
            }
            let c = points[j];
            let d = points[(j + 1) % n];
            if segments_intersect(a, b, c, d, eps) {
                return Err(ProfileError::SelfIntersecting);
            }
        }
    }
    Ok(())
}

/// Split each carrier segment wherever another sketch-segment endpoint lies on
/// its interior. Sketch entities remain stable and unsplit; this is only the
/// planar graph used for profile discovery. Retaining the source segment ID on
/// every piece lets the caller recover the original analytic curve.
fn node_segments_at_endpoints(
    segments: &[Segment2],
    tolerance: f64,
) -> Result<Vec<Segment2>, ProfileError> {
    let tolerance = tolerance.max(1e-9);
    let tol2 = tolerance * tolerance;
    let candidate_points = segments
        .iter()
        .flat_map(|segment| [segment.a, segment.b])
        .collect::<Vec<_>>();
    let mut noded = Vec::new();

    for segment in segments {
        let dx = segment.b.x - segment.a.x;
        let dy = segment.b.y - segment.a.y;
        let length2 = dx * dx + dy * dy;
        if length2 <= tol2 {
            return Err(ProfileError::Degenerate);
        }
        let length = length2.sqrt();
        let parameter_tolerance = (tolerance / length).min(0.25);
        let mut parameters = vec![0.0, 1.0];
        for point in &candidate_points {
            let parameter = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / length2;
            if parameter <= parameter_tolerance || parameter >= 1.0 - parameter_tolerance {
                continue;
            }
            let projected =
                Point2Dto::new(segment.a.x + parameter * dx, segment.a.y + parameter * dy);
            if dist2(projected, *point) <= tol2 {
                parameters.push(parameter);
            }
        }
        parameters.sort_by(f64::total_cmp);
        parameters.dedup_by(|left, right| (*left - *right).abs() * length <= tolerance);

        for pair in parameters.windows(2) {
            let a = Point2Dto::new(segment.a.x + pair[0] * dx, segment.a.y + pair[0] * dy);
            let b = Point2Dto::new(segment.a.x + pair[1] * dx, segment.a.y + pair[1] * dy);
            if dist2(a, b) > tol2 {
                noded.push(Segment2 {
                    id: segment.id,
                    a,
                    b,
                });
            }
        }
    }

    // Partial overlaps become identical pieces after the endpoint split
    // above. Keep only one undirected copy for planar-face discovery:
    // coincident sketch curves do not bound a second material region. Without
    // this normalization, the two zero-width half-edge walks can consume the
    // carrier edges and hide a valid surrounding profile.
    let mut unique = Vec::<Segment2>::new();
    for segment in noded {
        let duplicate = unique.iter_mut().find(|candidate| {
            (dist2(candidate.a, segment.a) <= tol2 && dist2(candidate.b, segment.b) <= tol2)
                || (dist2(candidate.a, segment.b) <= tol2 && dist2(candidate.b, segment.a) <= tol2)
        });
        if let Some(existing) = duplicate {
            existing.id = existing.id.min(segment.id);
        } else {
            unique.push(segment);
        }
    }
    Ok(unique)
}

/// Extract deterministic CCW loops from unordered, possibly reversed curve
/// segments. Every clustered endpoint must have degree two.
pub fn extract_closed_loops(
    segments: &[Segment2],
    tolerance: f64,
) -> Result<Vec<Vec<Point2Dto>>, ProfileError> {
    if segments.is_empty() {
        return Err(ProfileError::Empty);
    }
    let tolerance = tolerance.max(1e-9);
    let tol2 = tolerance * tolerance;
    let mut ordered = node_segments_at_endpoints(segments, tolerance)?;
    ordered.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| point_cmp(left.a, right.a))
            .then_with(|| point_cmp(left.b, right.b))
    });
    if ordered
        .iter()
        .any(|segment| dist2(segment.a, segment.b) <= tol2)
    {
        return Err(ProfileError::Degenerate);
    }

    let mut vertices: Vec<Point2Dto> = Vec::new();
    let mut endpoints = Vec::with_capacity(ordered.len());
    for segment in &ordered {
        let mut ids = [0usize; 2];
        for (slot, point) in [segment.a, segment.b].into_iter().enumerate() {
            let index = vertices
                .iter()
                .position(|existing| dist2(*existing, point) <= tol2)
                .unwrap_or_else(|| {
                    vertices.push(point);
                    vertices.len() - 1
                });
            ids[slot] = index;
        }
        if ids[0] == ids[1] {
            return Err(ProfileError::Degenerate);
        }
        endpoints.push(ids);
    }

    let mut adjacency = vec![Vec::<usize>::new(); vertices.len()];
    for (segment_index, [a, b]) in endpoints.iter().copied().enumerate() {
        adjacency[a].push(segment_index);
        adjacency[b].push(segment_index);
    }
    for (vertex_index, incident) in adjacency.iter().enumerate() {
        match incident.len() {
            2 => {}
            0 => unreachable!(),
            1 => return Err(ProfileError::OpenChain(ordered[incident[0]].id)),
            _ => return Err(ProfileError::Branch(vertices[vertex_index])),
        }
    }

    let mut used = vec![false; ordered.len()];
    let mut loops = Vec::new();
    while let Some(first_segment) = used.iter().position(|value| !*value) {
        let [a, b] = endpoints[first_segment];
        let (start, mut current) = if point_cmp(vertices[a], vertices[b]).is_le() {
            (a, b)
        } else {
            (b, a)
        };
        let mut previous_segment = first_segment;
        used[first_segment] = true;
        let mut points = vec![vertices[start], vertices[current]];

        while current != start {
            let incident = &adjacency[current];
            let next_segment = if incident[0] == previous_segment {
                incident[1]
            } else {
                incident[0]
            };
            if used[next_segment] {
                return Err(ProfileError::Degenerate);
            }
            used[next_segment] = true;
            let [x, y] = endpoints[next_segment];
            current = if x == current { y } else { x };
            previous_segment = next_segment;
            if current != start {
                points.push(vertices[current]);
            }
        }

        if points.len() < 3 {
            return Err(ProfileError::Degenerate);
        }
        validate_simple(&points, tolerance)?;
        let area = signed_area(&points);
        if area.abs() <= tolerance * tolerance {
            return Err(ProfileError::Degenerate);
        }
        if area < 0.0 {
            points.reverse();
        }
        let first = (0..points.len())
            .min_by(|a, b| point_cmp(points[*a], points[*b]))
            .unwrap();
        points.rotate_left(first);
        loops.push(points);
    }
    loops.sort_by(|a, b| point_cmp(a[0], b[0]));
    Ok(loops)
}

/// Extract bounded planar faces while permitting unrelated open sketch
/// geometry. Peeling vertices with degree below two removes line/path/rib
/// chains. The remaining embedded graph may still contain vertices of degree
/// three or more when adjacent regions share an edge or vertex, so each
/// directed half-edge is walked with the bounded face on its left.
pub fn extract_closed_loops_allow_open(
    segments: &[Segment2],
    tolerance: f64,
) -> Result<Vec<Vec<Point2Dto>>, ProfileError> {
    if segments.is_empty() {
        return Err(ProfileError::Empty);
    }
    let tolerance = tolerance.max(1e-9);
    let tol2 = tolerance * tolerance;
    let mut ordered = node_segments_at_endpoints(segments, tolerance)?;
    ordered.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| point_cmp(left.a, right.a))
            .then_with(|| point_cmp(left.b, right.b))
    });
    let mut vertices = Vec::<Point2Dto>::new();
    let mut endpoints = Vec::with_capacity(ordered.len());
    for segment in &ordered {
        if dist2(segment.a, segment.b) <= tol2 {
            return Err(ProfileError::Degenerate);
        }
        let mut ids = [0usize; 2];
        for (slot, point) in [segment.a, segment.b].into_iter().enumerate() {
            ids[slot] = vertices
                .iter()
                .position(|existing| dist2(*existing, point) <= tol2)
                .unwrap_or_else(|| {
                    vertices.push(point);
                    vertices.len() - 1
                });
        }
        endpoints.push(ids);
    }

    let mut active = vec![true; ordered.len()];
    loop {
        let mut degree = vec![0usize; vertices.len()];
        for (index, [a, b]) in endpoints.iter().copied().enumerate() {
            if active[index] {
                degree[a] += 1;
                degree[b] += 1;
            }
        }
        let mut changed = false;
        for (index, [a, b]) in endpoints.iter().copied().enumerate() {
            if active[index] && (degree[a] < 2 || degree[b] < 2) {
                active[index] = false;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    if !active.iter().any(|keep| *keep) {
        return Err(ProfileError::Empty);
    }

    // Half-edge 2n follows the stored endpoint order for segment n; 2n+1 is
    // its reverse. Sorting outgoing half-edges counter-clockwise gives a
    // deterministic planar embedding at every clustered endpoint.
    let half_endpoints = |half_edge: usize| {
        let [a, b] = endpoints[half_edge / 2];
        if half_edge % 2 == 0 {
            (a, b)
        } else {
            (b, a)
        }
    };
    let mut outgoing = vec![Vec::<usize>::new(); vertices.len()];
    for (segment_index, [a, b]) in endpoints.iter().copied().enumerate() {
        if active[segment_index] {
            outgoing[a].push(segment_index * 2);
            outgoing[b].push(segment_index * 2 + 1);
        }
    }
    for (vertex_index, incident) in outgoing.iter_mut().enumerate() {
        incident.sort_by(|left, right| {
            let (_, left_to) = half_endpoints(*left);
            let (_, right_to) = half_endpoints(*right);
            let left_angle = (vertices[left_to].y - vertices[vertex_index].y)
                .atan2(vertices[left_to].x - vertices[vertex_index].x);
            let right_angle = (vertices[right_to].y - vertices[vertex_index].y)
                .atan2(vertices[right_to].x - vertices[vertex_index].x);
            left_angle
                .total_cmp(&right_angle)
                .then_with(|| ordered[*left / 2].id.cmp(&ordered[*right / 2].id))
                .then_with(|| left.cmp(right))
        });
    }

    let mut visited = vec![false; ordered.len() * 2];
    let mut loops = Vec::new();
    for start in 0..visited.len() {
        if !active[start / 2] || visited[start] {
            continue;
        }
        let mut current = start;
        let mut points = Vec::new();
        for _ in 0..=visited.len() {
            if visited[current] {
                if current != start {
                    return Err(ProfileError::Degenerate);
                }
                break;
            }
            visited[current] = true;
            let (from, to) = half_endpoints(current);
            points.push(vertices[from]);

            // The reverse half-edge points back toward `from`. Taking the
            // immediately clockwise outgoing edge keeps the current face on
            // the left of the walk.
            let reverse = current ^ 1;
            let incident = &outgoing[to];
            let reverse_index = incident
                .iter()
                .position(|candidate| *candidate == reverse)
                .ok_or(ProfileError::Degenerate)?;
            current = incident[(reverse_index + incident.len() - 1) % incident.len()];
        }
        if current != start {
            return Err(ProfileError::Degenerate);
        }
        if points.len() < 3 {
            continue;
        }

        let area = signed_area(&points);
        // Bounded faces are CCW with this walk. The unbounded exterior face is
        // clockwise, and coincident duplicate edges produce zero-area walks.
        if area <= tol2 {
            continue;
        }
        validate_simple(&points, tolerance)?;
        let first = (0..points.len())
            .min_by(|a, b| point_cmp(points[*a], points[*b]))
            .unwrap();
        points.rotate_left(first);
        loops.push(points);
    }

    if loops.is_empty() {
        return Err(ProfileError::Empty);
    }
    loops.sort_by(|a, b| {
        point_cmp(a[0], b[0])
            .then_with(|| signed_area(b).total_cmp(&signed_area(a)))
            .then_with(|| a.len().cmp(&b.len()))
    });
    Ok(loops)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Point2Dto {
        Point2Dto::new(x, y)
    }

    fn s(id: u64, a: Point2Dto, b: Point2Dto) -> Segment2 {
        Segment2 { id, a, b }
    }

    #[test]
    fn shuffled_reversed_square_is_deterministic_ccw() {
        let loops = extract_closed_loops(
            &[
                s(4, p(1.0, 0.0), p(0.0, 0.0)),
                s(1, p(1.0, 1.0), p(1.0, 0.0)),
                s(3, p(0.0, 0.0), p(0.0, 1.0)),
                s(2, p(0.0, 1.0), p(1.0, 1.0)),
            ],
            1e-6,
        )
        .unwrap();
        assert_eq!(
            loops,
            vec![vec![p(0.0, 0.0), p(1.0, 0.0), p(1.0, 1.0), p(0.0, 1.0)]]
        );
    }

    #[test]
    fn two_loops_sort_and_invalid_graphs_fail() {
        let loops = extract_closed_loops(
            &[
                s(5, p(10.0, 0.0), p(11.0, 0.0)),
                s(6, p(11.0, 0.0), p(11.0, 1.0)),
                s(7, p(11.0, 1.0), p(10.0, 1.0)),
                s(8, p(10.0, 1.0), p(10.0, 0.0)),
                s(1, p(0.0, 0.0), p(1.0, 0.0)),
                s(2, p(1.0, 0.0), p(1.0, 1.0)),
                s(3, p(1.0, 1.0), p(0.0, 1.0)),
                s(4, p(0.0, 1.0), p(0.0, 0.0)),
            ],
            1e-6,
        )
        .unwrap();
        assert_eq!(loops.len(), 2);
        assert_eq!(loops[0][0], p(0.0, 0.0));
        assert_eq!(loops[1][0], p(10.0, 0.0));

        assert!(matches!(
            extract_closed_loops(&[s(1, p(0.0, 0.0), p(1.0, 0.0))], 1e-6),
            Err(ProfileError::OpenChain(1))
        ));
        assert!(matches!(
            extract_closed_loops(
                &[
                    s(1, p(0.0, 0.0), p(1.0, 0.0)),
                    s(2, p(1.0, 0.0), p(0.0, 1.0)),
                    s(3, p(0.0, 1.0), p(0.0, 0.0)),
                    s(4, p(0.0, 0.0), p(-1.0, 0.0)),
                ],
                1e-6,
            ),
            Err(ProfileError::Branch(_))
        ));
    }

    #[test]
    fn bow_tie_is_rejected() {
        let result = extract_closed_loops(
            &[
                s(1, p(0.0, 0.0), p(1.0, 1.0)),
                s(2, p(1.0, 1.0), p(0.0, 1.0)),
                s(3, p(0.0, 1.0), p(1.0, 0.0)),
                s(4, p(1.0, 0.0), p(0.0, 0.0)),
            ],
            1e-6,
        );
        assert_eq!(result, Err(ProfileError::SelfIntersecting));
    }

    #[test]
    fn closed_loop_survives_unrelated_open_axis_line() {
        let loops = extract_closed_loops_allow_open(
            &[
                s(1, p(1.0, 0.0), p(2.0, 0.0)),
                s(2, p(2.0, 0.0), p(2.0, 1.0)),
                s(3, p(2.0, 1.0), p(1.0, 1.0)),
                s(4, p(1.0, 1.0), p(1.0, 0.0)),
                s(5, p(0.0, -2.0), p(0.0, 2.0)),
            ],
            1e-6,
        )
        .unwrap();
        assert_eq!(loops.len(), 1);
        assert_eq!(loops[0][0], p(1.0, 0.0));
    }

    #[test]
    fn closed_loop_survives_a_partially_coincident_attached_chain() {
        // The second chain segment overlaps the lower half of the rectangle's
        // left carrier. This is redundant sketch geometry, but it must not
        // erase the otherwise unambiguous rectangular profile.
        let loops = extract_closed_loops_allow_open(
            &[
                s(1, p(0.0, 0.0), p(-15.0, 0.0)),
                s(2, p(-15.0, 0.0), p(-15.0, -7.5)),
                s(3, p(-15.0, -7.5), p(15.0, -7.5)),
                s(4, p(15.0, -7.5), p(15.0, 7.5)),
                s(5, p(15.0, 7.5), p(-15.0, 7.5)),
                s(6, p(-15.0, 7.5), p(-15.0, -7.5)),
            ],
            1e-6,
        )
        .unwrap();

        assert_eq!(loops.len(), 1);
        assert!((signed_area(&loops[0]) - 450.0).abs() < 1e-9);
    }

    #[test]
    fn adjacent_regions_sharing_an_edge_are_distinct_faces() {
        // Two bounded regions share edge 3. Their shared endpoints have degree
        // three, which is valid for a planar sketch even though it is not a
        // collection of disjoint degree-two loops.
        let loops = extract_closed_loops_allow_open(
            &[
                s(1, p(0.0, 1.0), p(1.0, 2.0)),
                s(2, p(1.0, 2.0), p(2.0, 1.0)),
                s(3, p(2.0, 1.0), p(0.0, 1.0)),
                s(4, p(0.0, 1.0), p(0.0, 0.0)),
                s(5, p(0.0, 0.0), p(2.0, 0.0)),
                s(6, p(2.0, 0.0), p(2.0, 1.0)),
            ],
            1e-6,
        )
        .unwrap();

        assert_eq!(loops.len(), 2);
        assert!(loops.iter().all(|points| signed_area(points) > 0.0));
        assert_eq!(
            loops
                .iter()
                .map(|points| signed_area(points))
                .collect::<Vec<_>>(),
            vec![2.0, 1.0],
        );
    }

    #[test]
    fn regions_touching_at_one_vertex_are_distinct_faces() {
        let loops = extract_closed_loops_allow_open(
            &[
                s(1, p(-2.0, -2.0), p(0.0, -2.0)),
                s(2, p(0.0, -2.0), p(0.0, 0.0)),
                s(3, p(0.0, 0.0), p(-2.0, 0.0)),
                s(4, p(-2.0, 0.0), p(-2.0, -2.0)),
                s(5, p(0.0, 0.0), p(2.0, 0.0)),
                s(6, p(2.0, 0.0), p(2.0, 2.0)),
                s(7, p(2.0, 2.0), p(0.0, 2.0)),
                s(8, p(0.0, 2.0), p(0.0, 0.0)),
            ],
            1e-6,
        )
        .unwrap();

        assert_eq!(loops.len(), 2);
        assert!(loops
            .iter()
            .all(|points| (signed_area(points) - 4.0).abs() < 1e-9));
    }

    #[test]
    fn endpoint_on_edge_junctions_subdivide_an_outer_profile() {
        // The two inner lines form an L whose endpoints lie in the interiors
        // of the top and right carrier edges. Profile discovery must node
        // those carrier edges even though the sketch entities remain whole.
        let loops = extract_closed_loops_allow_open(
            &[
                s(1, p(0.0, 0.0), p(4.0, 0.0)),
                s(2, p(4.0, 0.0), p(4.0, 4.0)),
                s(3, p(4.0, 4.0), p(0.0, 4.0)),
                s(4, p(0.0, 4.0), p(0.0, 0.0)),
                s(5, p(2.0, 4.0), p(2.0, 2.0)),
                s(6, p(2.0, 2.0), p(4.0, 2.0)),
            ],
            1e-6,
        )
        .unwrap();

        assert_eq!(loops.len(), 2);
        let mut areas = loops
            .iter()
            .map(|points| signed_area(points))
            .collect::<Vec<_>>();
        areas.sort_by(|a, b| a.total_cmp(b));
        assert_eq!(areas, vec![4.0, 12.0]);
    }
}
