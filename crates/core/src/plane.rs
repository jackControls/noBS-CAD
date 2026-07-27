use std::fmt;

use serde::{Deserialize, Serialize};

use crate::FaceId;

/// One of the three origin datum planes of a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginPlane {
    Xy,
    Xz,
    Yz,
}

/// Persistent reference to the plane a sketch lives on.
///
/// `PlanarFace` is resolved by the solid document because only it owns the
/// current face table. `DatumPlane` is resolved by the document manager from
/// construction-plane history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlaneRef {
    OriginPlane { plane: OriginPlane },
    PlanarFace { face_id: FaceId },
    DatumPlane { datum_id: FaceId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaneError {
    Unsupported,
}

impl fmt::Display for PlaneError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlaneError::Unsupported => write!(f, "plane reference is not currently resolvable"),
        }
    }
}

impl std::error::Error for PlaneError {}

/// Concrete placement of a sketch or planar B-rep face in Z-up world space.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PlaneBasis {
    pub origin: [f64; 3],
    pub u: [f64; 3],
    pub v: [f64; 3],
    pub normal: [f64; 3],
}

impl PlaneBasis {
    pub fn to_3d(&self, p: [f64; 2]) -> [f64; 3] {
        [
            self.origin[0] + self.u[0] * p[0] + self.v[0] * p[1],
            self.origin[1] + self.u[1] * p[0] + self.v[1] * p[1],
            self.origin[2] + self.u[2] * p[0] + self.v[2] * p[1],
        ]
    }

    pub fn to_2d(&self, p: [f64; 3]) -> [f64; 2] {
        let d = [
            p[0] - self.origin[0],
            p[1] - self.origin[1],
            p[2] - self.origin[2],
        ];
        [
            d[0] * self.u[0] + d[1] * self.u[1] + d[2] * self.u[2],
            d[0] * self.v[0] + d[1] * self.v[1] + d[2] * self.v[2],
        ]
    }
}

impl PlaneRef {
    pub const ORIGIN_PLANES: [PlaneRef; 3] = [
        PlaneRef::OriginPlane {
            plane: OriginPlane::Xy,
        },
        PlaneRef::OriginPlane {
            plane: OriginPlane::Xz,
        },
        PlaneRef::OriginPlane {
            plane: OriginPlane::Yz,
        },
    ];

    /// Resolve an origin plane. Body-face resolution belongs to the solid
    /// document so missing topology can be reported as a broken reference.
    pub fn origin_basis(&self) -> Result<PlaneBasis, PlaneError> {
        let PlaneRef::OriginPlane { plane } = *self else {
            return Err(PlaneError::Unsupported);
        };
        let (u, v, normal) = match plane {
            OriginPlane::Xy => ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
            OriginPlane::Xz => ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]),
            OriginPlane::Yz => ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]),
        };
        Ok(PlaneBasis {
            origin: [0.0; 3],
            u,
            v,
            normal,
        })
    }

    /// Backward-compatible name used by the M1 sketch code.
    pub fn basis(&self) -> Result<PlaneBasis, PlaneError> {
        self.origin_basis()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
        a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    }

    fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    }

    #[test]
    fn origin_bases_are_orthonormal_and_right_handed() {
        for plane in PlaneRef::ORIGIN_PLANES {
            let b = plane.origin_basis().unwrap();
            assert_eq!(dot(b.u, b.u), 1.0);
            assert_eq!(dot(b.v, b.v), 1.0);
            assert_eq!(dot(b.u, b.v), 0.0);
            assert_eq!(cross(b.u, b.v), b.normal);
        }
    }

    #[test]
    fn mapping_roundtrips() {
        let b = PlaneRef::OriginPlane {
            plane: OriginPlane::Xz,
        }
        .origin_basis()
        .unwrap();
        let p = [12.5, -3.0];
        let w = b.to_3d(p);
        assert_eq!(w, [12.5, 0.0, -3.0]);
        assert_eq!(b.to_2d(w), p);
    }
}
