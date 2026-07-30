//! Export-time vertex welding for indexed triangle meshes.
//!
//! OCCT tessellation emits three fresh positions per triangle with no shared
//! vertex indices. Slicers and 3MF `type="model"` expect welded/indexed meshes.

use std::collections::HashMap;

use crate::TriangleMesh;

/// Default position tolerance for welding tessellated mm geometry (1e-5 mm).
pub const DEFAULT_WELD_EPSILON: f32 = 1e-5;

/// Merge vertices whose positions fall within `epsilon` of each other.
///
/// Rebuilds `positions`/`indices` while preserving `body_id` and `name`.
/// Out-of-range triangle indices are dropped (malformed input stays non-panicking).
pub fn weld_triangle_mesh(mesh: &TriangleMesh, epsilon: f32) -> TriangleMesh {
    if mesh.positions.is_empty() || mesh.indices.is_empty() {
        return mesh.clone();
    }

    let vertex_count = mesh.positions.len() / 3;
    let epsilon = epsilon.max(f32::EPSILON);
    let scale = 1.0 / epsilon;
    let mut weld_map: HashMap<(i64, i64, i64), u32> = HashMap::new();
    let mut welded_positions: Vec<f32> = Vec::new();
    let mut index_remap: Vec<u32> = Vec::with_capacity(vertex_count);

    for old_idx in 0..vertex_count {
        let base = old_idx * 3;
        let x = mesh.positions[base];
        let y = mesh.positions[base + 1];
        let z = mesh.positions[base + 2];
        let key = (
            (x * scale).round() as i64,
            (y * scale).round() as i64,
            (z * scale).round() as i64,
        );
        let new_idx = *weld_map.entry(key).or_insert_with(|| {
            let idx = (welded_positions.len() / 3) as u32;
            welded_positions.extend_from_slice(&[x, y, z]);
            idx
        });
        index_remap.push(new_idx);
    }

    let mut welded_indices = Vec::with_capacity(mesh.indices.len());
    for tri in mesh.indices.chunks_exact(3) {
        let (a, b, c) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
        if a >= vertex_count || b >= vertex_count || c >= vertex_count {
            continue;
        }
        welded_indices.push(index_remap[a]);
        welded_indices.push(index_remap[b]);
        welded_indices.push(index_remap[c]);
    }

    TriangleMesh {
        body_id: mesh.body_id,
        name: mesh.name.clone(),
        positions: welded_positions,
        indices: welded_indices,
    }
}

/// Count undirected edges referenced by exactly one triangle.
///
/// A closed manifold solid has zero boundary edges; unwelded OCCT soup does not.
pub fn boundary_edge_count(mesh: &TriangleMesh) -> usize {
    let mut edge_counts: HashMap<(u32, u32), usize> = HashMap::new();
    for tri in mesh.indices.chunks_exact(3) {
        let (a, b, c) = (tri[0], tri[1], tri[2]);
        for (v0, v1) in [(a, b), (b, c), (a, c)] {
            let edge = if v0 <= v1 { (v0, v1) } else { (v1, v0) };
            *edge_counts.entry(edge).or_insert(0) += 1;
        }
    }
    edge_counts.values().filter(|&&count| count == 1).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use nbcad_core::BodyId;

    #[test]
    fn weld_drops_out_of_range_triangle_indices() {
        let mesh = TriangleMesh {
            body_id: BodyId(1),
            name: "bad".into(),
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            indices: vec![0, 1, 2, 0, 1, 99],
        };
        let welded = weld_triangle_mesh(&mesh, DEFAULT_WELD_EPSILON);
        assert_eq!(welded.triangle_count(), 1);
        assert_eq!(welded.positions.len() / 3, 3);
    }
}
