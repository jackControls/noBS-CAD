//! Persistent, host-neutral technical drawing document.
//!
//! Drawing sheets are part of the authoritative project model.  They store
//! view intent (camera, scale, placement and display options), not generated
//! line work: desktop OCCT HLR and the browser development fallback regenerate
//! projection geometry from the current solid bodies.

use std::collections::HashSet;

use nbcad_core::BodyId;
use serde::{Deserialize, Serialize};

const MAX_SHEETS: usize = 64;
const MAX_VIEWS_PER_SHEET: usize = 256;

fn first_id() -> u64 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DrawingDocumentDto {
    #[serde(default)]
    pub sheets: Vec<DrawingSheetDto>,
    #[serde(default)]
    pub active_sheet_id: Option<u64>,
    #[serde(default = "first_id")]
    pub next_sheet_id: u64,
    #[serde(default = "first_id")]
    pub next_view_id: u64,
}

impl Default for DrawingDocumentDto {
    fn default() -> Self {
        Self {
            sheets: Vec::new(),
            active_sheet_id: None,
            next_sheet_id: 1,
            next_view_id: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DrawingSheetDto {
    pub id: u64,
    pub name: String,
    pub format: DrawingSheetFormat,
    pub orientation: DrawingSheetOrientation,
    #[serde(default)]
    pub title_block: DrawingTitleBlockDto,
    #[serde(default)]
    pub views: Vec<DrawingViewDto>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingSheetFormat {
    A4,
    A3,
    Letter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingSheetOrientation {
    Landscape,
    Portrait,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawingTitleBlockDto {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub drawing_number: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub author: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DrawingViewDto {
    pub id: u64,
    pub name: String,
    pub kind: DrawingViewKind,
    /// Direction from the model toward the viewer, in model coordinates.
    pub direction: [f64; 3],
    /// Desired page-up direction before orthogonalization against `direction`.
    pub up: [f64; 3],
    /// View origin on the sheet, in millimetres from the upper-left paper edge.
    pub position: [f64; 2],
    /// Paper millimetres per model millimetre (1.0 is a 1:1 view).
    pub scale: f64,
    #[serde(default)]
    pub body_ids: Vec<BodyId>,
    #[serde(default)]
    pub show_hidden_lines: bool,
    #[serde(default)]
    pub show_tangent_edges: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawingViewKind {
    Front,
    Rear,
    Left,
    Right,
    Top,
    Bottom,
    Isometric,
    Custom,
}

impl DrawingDocumentDto {
    pub fn validate(&self) -> Result<(), String> {
        if self.sheets.len() > MAX_SHEETS {
            return Err(format!(
                "a project can contain at most {MAX_SHEETS} drawing sheets"
            ));
        }
        if self.next_sheet_id == 0 || self.next_view_id == 0 {
            return Err("drawing id counters must be non-zero".to_string());
        }

        let mut sheet_ids = HashSet::new();
        let mut view_ids = HashSet::new();
        let mut max_sheet_id = 0;
        let mut max_view_id = 0;
        for sheet in &self.sheets {
            if sheet.id == 0 || !sheet_ids.insert(sheet.id) {
                return Err(format!("duplicate or zero drawing sheet id {}", sheet.id));
            }
            max_sheet_id = max_sheet_id.max(sheet.id);
            if sheet.name.trim().is_empty() {
                return Err(format!("drawing sheet {} has an empty name", sheet.id));
            }
            if sheet.views.len() > MAX_VIEWS_PER_SHEET {
                return Err(format!(
                    "drawing sheet '{}' can contain at most {MAX_VIEWS_PER_SHEET} views",
                    sheet.name
                ));
            }

            for view in &sheet.views {
                if view.id == 0 || !view_ids.insert(view.id) {
                    return Err(format!("duplicate or zero drawing view id {}", view.id));
                }
                max_view_id = max_view_id.max(view.id);
                if view.name.trim().is_empty() {
                    return Err(format!("drawing view {} has an empty name", view.id));
                }
                if !view.scale.is_finite() || view.scale <= 0.0 || view.scale > 10_000.0 {
                    return Err(format!("drawing view '{}' has an invalid scale", view.name));
                }
                if view.position.iter().any(|value| !value.is_finite())
                    || view.direction.iter().any(|value| !value.is_finite())
                    || view.up.iter().any(|value| !value.is_finite())
                {
                    return Err(format!(
                        "drawing view '{}' contains non-finite coordinates",
                        view.name
                    ));
                }
                let direction_length_sq = squared_length(view.direction);
                let up_length_sq = squared_length(view.up);
                if direction_length_sq < 1.0e-12 || up_length_sq < 1.0e-12 {
                    return Err(format!(
                        "drawing view '{}' needs non-zero direction and up vectors",
                        view.name
                    ));
                }
                let cross = cross(view.direction, view.up);
                if squared_length(cross) < direction_length_sq * up_length_sq * 1.0e-12 {
                    return Err(format!(
                        "drawing view '{}' direction and up vectors are parallel",
                        view.name
                    ));
                }
                let mut body_ids = HashSet::new();
                for body_id in &view.body_ids {
                    if body_id.0 == 0 || !body_ids.insert(body_id.0) {
                        return Err(format!(
                            "drawing view '{}' has a duplicate or zero body id",
                            view.name
                        ));
                    }
                }
            }
        }

        match (self.sheets.is_empty(), self.active_sheet_id) {
            (true, Some(_)) => {
                return Err("an empty drawing cannot have an active sheet".to_string())
            }
            (false, None) => return Err("a drawing with sheets needs an active sheet".to_string()),
            (_, Some(id)) if !sheet_ids.contains(&id) => {
                return Err(format!("active drawing sheet {id} does not exist"));
            }
            _ => {}
        }
        if self.next_sheet_id <= max_sheet_id || self.next_view_id <= max_view_id {
            return Err("drawing id counters must be greater than existing ids".to_string());
        }
        Ok(())
    }
}

fn squared_length(vector: [f64; 3]) -> f64 {
    vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]
}

fn cross(left: [f64; 3], right: [f64; 3]) -> [f64; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_drawing_is_valid() {
        assert!(DrawingDocumentDto::default().validate().is_ok());
    }

    #[test]
    fn rejects_parallel_view_basis() {
        let drawing = DrawingDocumentDto {
            sheets: vec![DrawingSheetDto {
                id: 1,
                name: "Sheet 1".to_string(),
                format: DrawingSheetFormat::A4,
                orientation: DrawingSheetOrientation::Landscape,
                title_block: DrawingTitleBlockDto::default(),
                views: vec![DrawingViewDto {
                    id: 1,
                    name: "Front".to_string(),
                    kind: DrawingViewKind::Front,
                    direction: [0.0, 1.0, 0.0],
                    up: [0.0, 2.0, 0.0],
                    position: [100.0, 80.0],
                    scale: 1.0,
                    body_ids: vec![],
                    show_hidden_lines: false,
                    show_tangent_edges: false,
                }],
            }],
            active_sheet_id: Some(1),
            next_sheet_id: 2,
            next_view_id: 2,
        };
        assert!(drawing.validate().is_err());
    }
}
