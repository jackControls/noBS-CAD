//! Print-in-place demo meshes for slicer smoke fixtures.
//!
//! Captive T-slot latch: housing + slider with ~0.4 mm FDM clearance so the
//! parts print nested, then the bolt slides after the print.

use nbcad_core::{BodyAppearance, BodyId, Rgba8};

use crate::{find_preset, TriangleMesh};

const CLEAR_MM: f32 = 0.4;

/// Axis-aligned box as a watertight triangle mesh fragment (local coords).
fn box_solid(xmin: f32, xmax: f32, ymin: f32, ymax: f32, zmin: f32, zmax: f32) -> (Vec<f32>, Vec<u32>) {
    debug_assert!(xmax > xmin && ymax > ymin && zmax > zmin);
    let positions = vec![
        xmin, ymin, zmin, // 0
        xmax, ymin, zmin, // 1
        xmax, ymax, zmin, // 2
        xmin, ymax, zmin, // 3
        xmin, ymin, zmax, // 4
        xmax, ymin, zmax, // 5
        xmax, ymax, zmax, // 6
        xmin, ymax, zmax, // 7
    ];
    let indices = vec![
        0, 2, 1, 0, 3, 2, // -Z
        4, 5, 6, 4, 6, 7, // +Z
        0, 1, 5, 0, 5, 4, // -Y
        3, 7, 6, 3, 6, 2, // +Y
        0, 4, 7, 0, 7, 3, // -X
        1, 2, 6, 1, 6, 5, // +X
    ];
    (positions, indices)
}

fn mesh_from_boxes(body_id: BodyId, name: &str, boxes: &[[f32; 6]]) -> TriangleMesh {
    let mut positions = Vec::new();
    let mut indices = Vec::new();
    for &[xmin, xmax, ymin, ymax, zmin, zmax] in boxes {
        let (p, i) = box_solid(xmin, xmax, ymin, ymax, zmin, zmax);
        let base = (positions.len() / 3) as u32;
        positions.extend(p);
        indices.extend(i.into_iter().map(|v| v + base));
    }
    TriangleMesh {
        body_id,
        name: name.to_string(),
        positions,
        indices,
    }
}

/// Housing (body 1) + captive sliding bolt (body 2).
///
/// Printed as two objects on one plate. After printing, the red bolt slides
/// along Y inside the black T-channel (~15 mm travel) and the tip can poke
/// out the front aperture.
pub fn print_in_place_latch() -> (Vec<TriangleMesh>, Vec<BodyAppearance>) {
    // --- Housing envelope ---
    // X: 0..30  Y: 0..56  Z: 0..9.5
    let floor = [0.0, 30.0, 0.0, 56.0, 0.0, 2.5];
    let left_rail = [0.0, 4.0, 0.0, 56.0, 2.5, 7.0];
    let right_rail = [26.0, 30.0, 0.0, 56.0, 2.5, 7.0];
    // Lips leave a 8 mm neck (x 11..19) for the stem.
    let left_lip = [0.0, 11.0, 0.0, 56.0, 7.0, 9.5];
    let right_lip = [19.0, 30.0, 0.0, 56.0, 7.0, 9.5];
    // Front cap with bolt aperture (open x 11..19, z 2.5..7).
    let front_cap_l = [0.0, 11.0, 0.0, 3.5, 2.5, 9.5];
    let front_cap_r = [19.0, 30.0, 0.0, 3.5, 2.5, 9.5];
    let front_cap_top = [11.0, 19.0, 0.0, 3.5, 7.0, 9.5];
    // Closed back so the bolt stays captive.
    let back_cap = [0.0, 30.0, 52.5, 56.0, 2.5, 9.5];

    let housing = mesh_from_boxes(
        BodyId(1),
        "PIP Latch Housing",
        &[
            floor,
            left_rail,
            right_rail,
            left_lip,
            right_lip,
            front_cap_l,
            front_cap_r,
            front_cap_top,
            back_cap,
        ],
    );

    // --- Slider / bolt (clearance CLEAR_MM from housing) ---
    let x0 = 4.0 + CLEAR_MM;
    let x1 = 26.0 - CLEAR_MM;
    let neck0 = 11.0 + CLEAR_MM;
    let neck1 = 19.0 - CLEAR_MM;
    let z_flange0 = 2.5 + CLEAR_MM;
    let z_flange1 = 7.0 - CLEAR_MM;
    let z_stem1 = 9.5 + CLEAR_MM;
    // As-printed mid-stroke pose (captive, tip near the aperture).
    let y0 = 14.0;
    let y1 = 38.0;
    let flange = [x0, x1, y0, y1, z_flange0, z_flange1];
    let stem = [neck0, neck1, y0, y1, z_flange1, z_stem1];
    let handle = [9.0, 21.0, y0, y1, z_stem1, 14.0];
    // Tip aims at the front aperture; sliding −Y makes it protrude.
    let tip = [neck0, neck1, 5.0, y0, z_flange0, z_flange1];

    let slider = mesh_from_boxes(
        BodyId(2),
        "PIP Latch Bolt",
        &[flange, stem, handle, tip],
    );

    let mut housing_app = find_preset("bambu.pla.basic.black")
        .unwrap()
        .to_appearance(BodyId(1));
    housing_app.color = Rgba8::opaque(20, 20, 20);
    housing_app.color_name = "Black".into();

    let mut bolt_app = find_preset("bambu.pla.basic.red")
        .unwrap()
        .to_appearance(BodyId(2));
    bolt_app.color = Rgba8::opaque(200, 40, 40);
    bolt_app.color_name = "Red".into();

    (vec![housing, slider], vec![housing_app, bolt_app])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latch_has_two_bodies_and_volume() {
        let (meshes, apps) = print_in_place_latch();
        assert_eq!(meshes.len(), 2);
        assert_eq!(apps.len(), 2);
        for mesh in &meshes {
            assert!(mesh.positions.len() >= 8 * 3);
            assert_eq!(mesh.indices.len() % 3, 0);
            assert!(mesh.indices.len() / 3 >= 12);
        }
        // Slider must sit above the bed gap (not fused to floor).
        let slider = &meshes[1];
        let min_z = slider
            .positions
            .chunks_exact(3)
            .map(|p| p[2])
            .fold(f32::MAX, f32::min);
        assert!(min_z >= 2.5 + CLEAR_MM - 1e-3);
    }
}
