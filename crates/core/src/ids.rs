use serde::{Deserialize, Serialize};

/// Stable identifier of a solid body for the lifetime of a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct BodyId(pub u64);

/// Stable identifier of a B-rep face for the lifetime of a topology match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct FaceId(pub u64);

/// Stable identifier of a B-rep edge for the lifetime of a topology match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct EdgeId(pub u64);
