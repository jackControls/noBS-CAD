//! Host-neutral triangle soup for viewport backends.

/// Tessellation handed across the OCCT → viewport boundary.
///
/// Positions are flat XYZ in millimetres (document default). This type must
/// stay free of Bevy and OCCT types so MCP/UI/kernel adapters can share it.
#[derive(Debug, Clone, PartialEq)]
pub struct TessellatedTriangleSoup {
    pub name: String,
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

impl TessellatedTriangleSoup {
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }

    /// Axis-aligned unit cube centered at origin (spike fixture).
    pub fn unit_cube() -> Self {
        let positions = vec![
            -0.5, -0.5, -0.5, // 0
            0.5, -0.5, -0.5, // 1
            0.5, 0.5, -0.5, // 2
            -0.5, 0.5, -0.5, // 3
            -0.5, -0.5, 0.5, // 4
            0.5, -0.5, 0.5, // 5
            0.5, 0.5, 0.5, // 6
            -0.5, 0.5, 0.5, // 7
        ];
        let indices = vec![
            0, 2, 1, 0, 3, 2, // -Z
            4, 5, 6, 4, 6, 7, // +Z
            0, 1, 5, 0, 5, 4, // -Y
            3, 7, 6, 3, 6, 2, // +Y
            0, 4, 7, 0, 7, 3, // -X
            1, 2, 6, 1, 6, 5, // +X
        ];
        Self {
            name: "FixtureCube".into(),
            positions,
            indices,
        }
    }
}
