//! Slicer / ecosystem export targets for 3MF packages.
//!
//! Standard 3MF (consortium materials extension) is always written when
//! appearance is included. Brand targets add *compatible metadata* so
//! Bambu Studio, Orca, and PrusaSlicer pick up filament slots/colors.
//! Cura primarily uses consortium `basematerials` plus an optional
//! `Metadata/cura_materials.json` hint list — not a full Cura project.

use serde::{Deserialize, Serialize};

/// Which slicer ecosystem to optimize 3MF metadata for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SlicerTarget {
    /// Consortium 3MF only (`basematerials` + displaycolor).
    Standard,
    /// Bambu Studio / MakerWorld-friendly Metadata (filament arrays).
    #[default]
    BambuStudio,
    /// Orca Slicer (same Metadata shape as Bambu for filament colours).
    OrcaSlicer,
    /// PrusaSlicer / SuperSlicer Slic3r_PE model config hints.
    PrusaSlicer,
    /// UltiMaker Cura — basematerials + cura_materials.json hints.
    Cura,
}
impl SlicerTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::BambuStudio => "bambu_studio",
            Self::OrcaSlicer => "orca_slicer",
            Self::PrusaSlicer => "prusa_slicer",
            Self::Cura => "cura",
        }
    }

    pub fn application_metadata(self) -> &'static str {
        match self {
            Self::Standard => "noBS CAD",
            Self::BambuStudio => "noBS CAD (Bambu-compatible)",
            Self::OrcaSlicer => "noBS CAD (Orca-compatible)",
            Self::PrusaSlicer => "noBS CAD (PrusaSlicer-compatible)",
            Self::Cura => "noBS CAD (Cura-compatible)",
        }
    }

    pub fn all() -> &'static [SlicerTarget] {
        &[
            Self::Standard,
            Self::BambuStudio,
            Self::OrcaSlicer,
            Self::PrusaSlicer,
            Self::Cura,
        ]
    }
}
