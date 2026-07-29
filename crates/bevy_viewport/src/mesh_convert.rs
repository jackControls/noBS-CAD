//! Convert host-neutral soups into Bevy meshes.

use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::render::mesh::Indices;
use bevy::render::render_resource::PrimitiveTopology;

use crate::soup::TessellatedTriangleSoup;

pub fn triangle_soup_to_mesh(soup: &TessellatedTriangleSoup) -> Mesh {
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );

    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(soup.positions.len() / 3);
    for chunk in soup.positions.chunks_exact(3) {
        positions.push([chunk[0], chunk[1], chunk[2]]);
    }

    let mut normals = vec![[0.0_f32, 0.0, 0.0]; positions.len()];
    for tri in soup.indices.chunks_exact(3) {
        let (i0, i1, i2) = (tri[0] as usize, tri[1] as usize, tri[2] as usize);
        let a = Vec3::from(positions[i0]);
        let b = Vec3::from(positions[i1]);
        let c = Vec3::from(positions[i2]);
        let n = (b - a).cross(c - a).normalize_or_zero();
        for index in [i0, i1, i2] {
            normals[index][0] += n.x;
            normals[index][1] += n.y;
            normals[index][2] += n.z;
        }
    }
    for normal in &mut normals {
        let v = Vec3::from(*normal).normalize_or_zero();
        *normal = [v.x, v.y, v.z];
    }

    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_indices(Indices::U32(soup.indices.clone()));
    mesh
}
