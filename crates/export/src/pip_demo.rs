//! Print-in-place demo meshes for slicer smoke fixtures.
//!
//! Three-body captive **drawer clip**: housing rail + sliding drawer + side
//! latch bar. Every inter-body **box pair** keeps ≥ [`CLEAR_MM`] AABB
//! separation (no fused solids, no intentional interference). Printed flat.

use nbcad_core::{BodyAppearance, BodyId, Rgba8};

use crate::{find_preset, TriangleMesh};

/// Minimum FDM clearance between distinct print-in-place bodies (mm).
pub const CLEAR_MM: f32 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq)]
struct Aabb {
    min: [f32; 3],
    max: [f32; 3],
}

impl Aabb {
    fn from_box(b: [f32; 6]) -> Self {
        Self {
            min: [b[0], b[2], b[4]],
            max: [b[1], b[3], b[5]],
        }
    }

    /// Euclidean gap when AABBs are separated; `0.0` when overlapping.
    fn separation(self, other: Self) -> f32 {
        let mut gap = [0.0f32; 3];
        for i in 0..3 {
            if self.max[i] < other.min[i] {
                gap[i] = other.min[i] - self.max[i];
            } else if other.max[i] < self.min[i] {
                gap[i] = self.min[i] - other.max[i];
            }
        }
        if gap[0] > 0.0 || gap[1] > 0.0 || gap[2] > 0.0 {
            (gap[0] * gap[0] + gap[1] * gap[1] + gap[2] * gap[2]).sqrt()
        } else {
            0.0
        }
    }
}

/// Axis-aligned box as a watertight triangle mesh fragment (local coords).
fn box_solid(xmin: f32, xmax: f32, ymin: f32, ymax: f32, zmin: f32, zmax: f32) -> (Vec<f32>, Vec<u32>) {
    debug_assert!(xmax > xmin && ymax > ymin && zmax > zmin);
    let positions = vec![
        xmin, ymin, zmin, xmax, ymin, zmin, xmax, ymax, zmin, xmin, ymax, zmin, xmin, ymin, zmax,
        xmax, ymin, zmax, xmax, ymax, zmax, xmin, ymax, zmax,
    ];
    let indices = vec![
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3,
        1, 2, 6, 1, 6, 5,
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

/// Pairwise box clearance across bodies (nested PIP parts need this, not hull AABBs).
pub fn assert_box_clearances(bodies: &[(&str, &[[f32; 6]])], min_clear_mm: f32) {
    assert!(bodies.len() >= 2);
    for (name, boxes) in bodies {
        for b in *boxes {
            assert!(
                b[4] >= -1e-4,
                "body {name} box penetrates bed (z_min={})",
                b[4]
            );
            assert!(b[1] > b[0] && b[3] > b[2] && b[5] > b[4], "degenerate box on {name}");
        }
    }
    for i in 0..bodies.len() {
        for j in (i + 1)..bodies.len() {
            for a in bodies[i].1 {
                for b in bodies[j].1 {
                    let gap = Aabb::from_box(*a).separation(Aabb::from_box(*b));
                    assert!(
                        gap + 1e-3 >= min_clear_mm,
                        "bodies '{}' and '{}' violate {} mm clearance (gap={gap})",
                        bodies[i].0,
                        bodies[j].0,
                        min_clear_mm
                    );
                }
            }
        }
    }
}

/// Three-body captive drawer clip (housing + drawer + side latch).
///
/// Layout (mm), printed as separate objects on one plate:
/// - **Housing** — T-rail with rear stop and latch pocket on +X
/// - **Drawer** — notched T-section slider (~14 mm Y travel, mid-stroke pose)
/// - **Latch** — captive side bar that can slide −X into the drawer notch
///
/// Clearance rule: every inter-body box pair is ≥ [`CLEAR_MM`] apart.
pub fn print_in_place_clip() -> (Vec<TriangleMesh>, Vec<BodyAppearance>) {
    let housing_boxes: &[[f32; 6]] = &[
        [0.0, 50.0, 0.0, 42.0, 0.0, 2.5],       // floor
        [0.0, 4.0, 0.0, 42.0, 2.5, 7.5],        // left rail
        [28.0, 32.0, 0.0, 42.0, 2.5, 7.5],      // right rail
        [0.0, 11.0, 0.0, 42.0, 7.5, 10.0],      // left lip
        [21.0, 32.0, 0.0, 42.0, 7.5, 10.0],     // right lip
        [0.0, 32.0, 38.5, 42.0, 2.5, 10.0],     // back
        [0.0, 11.0, 0.0, 3.5, 2.5, 10.0],       // front L
        [21.0, 32.0, 0.0, 3.5, 2.5, 10.0],      // front R
        [11.0, 21.0, 0.0, 3.5, 7.5, 10.0],      // front top
        [32.0, 50.0, 10.0, 32.0, 0.0, 2.5],     // pocket floor
        [32.0, 50.0, 30.4, 32.0, 2.5, 8.5],     // pocket back
        [32.0, 50.0, 10.0, 11.6, 2.5, 8.5],     // pocket front
        [48.6, 50.0, 11.6, 30.4, 2.5, 8.5],     // pocket outer
        [32.0, 50.0, 10.0, 32.0, 8.5, 10.0],    // pocket lid
    ];

    let x0 = 4.0 + CLEAR_MM;
    let x1 = 28.0 - CLEAR_MM;
    let neck0 = 11.0 + CLEAR_MM;
    let neck1 = 21.0 - CLEAR_MM;
    let z0 = 2.5 + CLEAR_MM;
    let z1 = 7.5 - CLEAR_MM;
    let z_stem = 10.0 + CLEAR_MM;
    let y0 = 12.0;
    let y1 = 34.0;

    let drawer_boxes: &[[f32; 6]] = &[
        [x0, x1, y0, 18.0, z0, z1],             // flange front
        [x0, x1, 22.0, y1, z0, z1],             // flange back
        [x0, x1 - 3.0, 18.0, 22.0, z0, z1],     // flange inner (notch recess)
        [neck0, neck1, y0, y1, z1, z_stem],     // stem
        [8.0, 24.0, y0, y1, z_stem, 13.5],      // handle
        [neck0, neck1, 5.5, y0, z0, z1],        // tip
    ];

    let latch_boxes: &[[f32; 6]] = &[[
        32.0 + CLEAR_MM,
        48.6 - CLEAR_MM,
        12.0 + CLEAR_MM,
        30.0 - CLEAR_MM,
        2.5 + CLEAR_MM,
        8.5 - CLEAR_MM,
    ]];

    assert_box_clearances(
        &[
            ("PIP Clip Housing", housing_boxes),
            ("PIP Clip Drawer", drawer_boxes),
            ("PIP Clip Latch", latch_boxes),
        ],
        CLEAR_MM,
    );

    let housing = mesh_from_boxes(BodyId(1), "PIP Clip Housing", housing_boxes);
    let drawer = mesh_from_boxes(BodyId(2), "PIP Clip Drawer", drawer_boxes);
    let latch = mesh_from_boxes(BodyId(3), "PIP Clip Latch", latch_boxes);

    let mut housing_app = find_preset("bambu.pla.basic.black")
        .unwrap()
        .to_appearance(BodyId(1));
    housing_app.color = Rgba8::opaque(20, 20, 20);
    housing_app.color_name = "Black".into();

    let mut drawer_app = find_preset("bambu.pla.basic.red")
        .unwrap()
        .to_appearance(BodyId(2));
    drawer_app.color = Rgba8::opaque(200, 40, 40);
    drawer_app.color_name = "Red".into();

    let mut latch_app = find_preset("bambu.pla.basic.blue")
        .unwrap()
        .to_appearance(BodyId(3));
    latch_app.color = Rgba8::opaque(40, 90, 200);
    latch_app.color_name = "Blue".into();

    (
        vec![housing, drawer, latch],
        vec![housing_app, drawer_app, latch_app],
    )
}

/// Backward-compatible alias used by older docs/fixture names.
pub fn print_in_place_latch() -> (Vec<TriangleMesh>, Vec<BodyAppearance>) {
    print_in_place_clip()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clip_has_three_bodies_and_dfm_clearance() {
        let (meshes, apps) = print_in_place_clip();
        assert_eq!(meshes.len(), 3);
        assert_eq!(apps.len(), 3);
        for mesh in &meshes {
            assert!(mesh.positions.len() >= 8 * 3);
            assert_eq!(mesh.indices.len() % 3, 0);
            assert!(mesh.indices.len() / 3 >= 12);
        }
        let drawer = &meshes[1];
        let min_z = drawer
            .positions
            .chunks_exact(3)
            .map(|p| p[2])
            .fold(f32::MAX, f32::min);
        assert!(min_z >= 2.5 + CLEAR_MM - 1e-3);
    }

    #[test]
    fn overlapping_aabbs_report_zero_gap() {
        let a = Aabb {
            min: [0.0, 0.0, 0.0],
            max: [10.0, 10.0, 10.0],
        };
        let b = Aabb {
            min: [5.0, 5.0, 5.0],
            max: [15.0, 15.0, 15.0],
        };
        assert_eq!(a.separation(b), 0.0);
        let c = Aabb {
            min: [10.4, 0.0, 0.0],
            max: [20.0, 10.0, 10.0],
        };
        assert!((a.separation(c) - 0.4).abs() < 1e-4);
    }
}
