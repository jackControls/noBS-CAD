//! Form strings are disposable; commits preserve the complete shared DTO and
//! use the shared drawing_set_document engine command.
use super::tables::{self, Table};
use nbcad_sketch::*;
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Selection {
    Sheet(u64),
    View(u64),
    Table(u64, Table),
    Row(u64, Table, u64),
    NewRow(u64, Table),
}
#[derive(Clone, Copy)]
pub(super) enum Kind {
    Text,
    Number,
    Body,
    Choice(&'static [(&'static str, &'static str)]),
}
pub(super) struct Field {
    pub path: &'static str,
    pub label: &'static str,
    pub kind: Kind,
    pub original: String,
    pub text: String,
}
pub(super) struct Draft {
    pub selection: Selection,
    pub fields: Vec<Field>,
    original: Value,
    baseline: Value,
}
const FORMATS: &[(&str, &str)] = &[
    ("a0", "A0"),
    ("a1", "A1"),
    ("a2", "A2"),
    ("a3", "A3"),
    ("a4", "A4"),
    ("letter", "Letter / ANSI A"),
    ("ansi_b", "ANSI B"),
    ("ansi_c", "ANSI C"),
    ("ansi_d", "ANSI D"),
    ("ansi_e", "ANSI E"),
];
fn record(document: &DrawingDocumentDto, selection: Selection) -> Result<Value, String> {
    match selection {
        Selection::Sheet(id) => serde_json::to_value(
            document
                .sheets
                .iter()
                .find(|s| s.id == id)
                .ok_or("Sheet was removed")?,
        ),
        Selection::View(id) => serde_json::to_value(
            document
                .sheets
                .iter()
                .flat_map(|s| &s.views)
                .find(|v| v.id == id)
                .ok_or("View was removed")?,
        ),
        selection => return tables::record(document, selection),
    }
    .map_err(|e| e.to_string())
}
impl Draft {
    pub fn new(document: &DrawingDocumentDto, selection: Selection) -> Result<Self, String> {
        let baseline = record(document, selection)?;
        let original = if tables::context(selection).is_some() {
            tables::seed(document, selection, &baseline)?
        } else {
            baseline.clone()
        };
        let descriptors: Vec<(&'static str, &'static str, Kind)> = match selection {
            Selection::Sheet(_) => vec![
                ("/name", "Sheet name", Kind::Text),
                ("/format", "Format", Kind::Choice(FORMATS)),
                (
                    "/orientation",
                    "Orientation",
                    Kind::Choice(&[("landscape", "Landscape"), ("portrait", "Portrait")]),
                ),
                (
                    "/standard",
                    "Standard",
                    Kind::Choice(&[("iso", "ISO"), ("ansi", "ANSI")]),
                ),
                (
                    "/projection_method",
                    "Projection",
                    Kind::Choice(&[
                        ("first_angle", "First angle"),
                        ("third_angle", "Third angle"),
                    ]),
                ),
                (
                    "/tolerance_note/preset",
                    "General tolerance",
                    Kind::Choice(&[
                        ("none", "None"),
                        ("iso2768_fine", "ISO 2768-f"),
                        ("iso2768_medium", "ISO 2768-m"),
                        ("iso2768_coarse", "ISO 2768-c"),
                        ("iso2768_very_coarse", "ISO 2768-v"),
                        ("ansi_decimal", "ANSI decimal"),
                        ("custom", "Custom"),
                    ]),
                ),
                ("/tolerance_note/custom", "Tolerance note", Kind::Text),
                ("/title_block/title", "Title", Kind::Text),
                ("/title_block/drawing_number", "Drawing number", Kind::Text),
                ("/title_block/revision", "Revision", Kind::Text),
                ("/title_block/author", "Drawn by", Kind::Text),
                ("/title_block/checked_by", "Checked by", Kind::Text),
                ("/title_block/approved_by", "Approved by", Kind::Text),
                ("/title_block/company", "Company", Kind::Text),
                ("/title_block/material", "Material", Kind::Text),
                ("/title_block/finish", "Finish", Kind::Text),
            ],
            Selection::View(_) => vec![
                ("/name", "View name", Kind::Text),
                ("/scale", "Scale (paper mm / model mm)", Kind::Number),
                ("/position/0", "Paper X (mm)", Kind::Number),
                ("/position/1", "Paper Y (mm)", Kind::Number),
            ],
            selection => tables::descriptors(selection),
        };
        let fields = descriptors
            .into_iter()
            .map(|(path, label, kind)| {
                let value = original.pointer(path).ok_or("Drawing field was removed")?;
                let text = match kind {
                    Kind::Number => value.as_f64().ok_or("Invalid drawing number")?.to_string(),
                    Kind::Body => value.as_u64().map(|id| id.to_string()).unwrap_or_default(),
                    _ => value.as_str().ok_or("Invalid drawing text")?.to_owned(),
                };
                Ok(Field {
                    path,
                    label,
                    kind,
                    original: text.clone(),
                    text,
                })
            })
            .collect::<Result<_, String>>()?;
        Ok(Self {
            selection,
            fields,
            original,
            baseline,
        })
    }
    pub fn dirty(&self) -> bool {
        matches!(self.selection, Selection::NewRow(..))
            || self.fields.iter().any(|f| f.original != f.text)
    }
    pub fn read_only(&self) -> bool {
        tables::immutable(self.selection, &self.original)
    }
    pub fn committed_selection(&self) -> Selection {
        match self.selection {
            Selection::NewRow(sheet, table) => {
                Selection::Row(sheet, table, self.original["id"].as_u64().unwrap_or(0))
            }
            selection => selection,
        }
    }
    pub fn set(&mut self, index: usize, text: String) -> Result<(), String> {
        if self.read_only() {
            return Err("Released revisions cannot be edited".into());
        }
        let field = self
            .fields
            .get_mut(index)
            .ok_or("Drawing field was removed")?;
        if let Kind::Choice(options) = field.kind {
            if !options.iter().any(|(value, _)| *value == text) {
                return Err(format!("Choose a valid {}", field.label));
            }
        }
        let standard_changed = field.path == "/standard" && field.text != text;
        let table_shown = field.path == "/visibility" && field.text == "hidden" && text == "shown";
        field.text = text.clone();
        if table_shown {
            let (_, table) = tables::context(self.selection).ok_or("Select a table")?;
            for (path, value) in ["/x", "/y"]
                .into_iter()
                .zip(tables::default_position(table))
            {
                self.fields
                    .iter_mut()
                    .find(|f| f.path == path)
                    .ok_or("Table position was removed")?
                    .text = value.to_string();
            }
        }
        if standard_changed {
            // Preserve the coupled sheet defaults. Applying
            // these now keeps any subsequent explicit form overrides.
            let ansi = text == "ansi";
            for (path, value) in [
                ("/format", if ansi { "letter" } else { "a4" }),
                (
                    "/projection_method",
                    if ansi { "third_angle" } else { "first_angle" },
                ),
                (
                    "/tolerance_note/preset",
                    if ansi {
                        "ansi_decimal"
                    } else {
                        "iso2768_medium"
                    },
                ),
                ("/tolerance_note/custom", ""),
            ] {
                self.fields
                    .iter_mut()
                    .find(|f| f.path == path)
                    .ok_or("Sheet standard field was removed")?
                    .text = value.into();
            }
        }
        Ok(())
    }
    pub fn apply(&self, document: &DrawingDocumentDto) -> Result<DrawingDocumentDto, String> {
        if record(document, self.selection)? != self.baseline {
            return Err("Drawing changed; reset the form before applying".into());
        }
        if !self.dirty() {
            return Ok(document.clone());
        }
        if self.read_only() {
            return Err("Released revisions cannot be edited".into());
        }
        let mut edited = self.original.clone();
        for field in self.fields.iter().filter(|f| f.text != f.original) {
            let value = match field.kind {
                Kind::Number => {
                    let n: f64 = field
                        .text
                        .trim()
                        .parse()
                        .map_err(|_| format!("Enter a number for {}", field.label))?;
                    if !n.is_finite() {
                        return Err(format!("{} must be finite", field.label));
                    }
                    if field.path == "/scale" && n <= 0. {
                        return Err("Scale must be greater than zero".into());
                    }
                    json!(n)
                }
                Kind::Choice(options) => {
                    if !options.iter().any(|(value, _)| *value == field.text) {
                        return Err(format!("Choose a valid {}", field.label));
                    }
                    json!(field.text)
                }
                Kind::Text => json!(field.text),
                Kind::Body => {
                    if field.text.trim().is_empty() {
                        Value::Null
                    } else {
                        let id = field
                            .text
                            .trim()
                            .parse::<u64>()
                            .map_err(|_| "Choose a valid body")?;
                        if id == 0 {
                            return Err("Choose a valid body".into());
                        }
                        json!(id)
                    }
                }
            };
            *edited
                .pointer_mut(field.path)
                .ok_or("Drawing field was removed")? = value;
        }
        if tables::context(self.selection).is_some() {
            return tables::apply(document, self.selection, edited);
        }
        let mut next = document.clone();
        match self.selection {
            Selection::Sheet(id) => {
                *next
                    .sheets
                    .iter_mut()
                    .find(|s| s.id == id)
                    .ok_or("Sheet was removed")? =
                    serde_json::from_value(edited).map_err(|e| e.to_string())?;
            }
            Selection::View(id) => {
                let sheet = next
                    .sheets
                    .iter_mut()
                    .find(|s| s.views.iter().any(|v| v.id == id))
                    .ok_or("View was removed")?;
                let scale_changed = self
                    .fields
                    .iter()
                    .any(|f| f.path == "/scale" && f.text != f.original);
                let position_changed = self
                    .fields
                    .iter()
                    .any(|f| f.path.starts_with("/position/") && f.text != f.original);
                apply_view(
                    sheet,
                    serde_json::from_value(edited).map_err(|e| e.to_string())?,
                    scale_changed,
                    position_changed,
                )?;
            }
            _ => unreachable!(),
        }
        return_released_sheets_to_draft(document, &mut next);
        next.validate()?;
        Ok(next)
    }
}

/// Same content-change rule as document.ts. Release metadata is retained; the
/// shared setter stays untouched so history can restore a released snapshot.
pub(super) fn return_released_sheets_to_draft(
    before: &DrawingDocumentDto,
    next: &mut DrawingDocumentDto,
) {
    for prior in before
        .sheets
        .iter()
        .filter(|s| s.release.status == DrawingReleaseStatus::Released)
    {
        let Some(current) = next.sheets.iter_mut().find(|s| s.id == prior.id) else {
            continue;
        };
        if current.release.status != DrawingReleaseStatus::Released {
            continue;
        }
        let mut comparable = current.clone();
        comparable.release = prior.release.clone();
        if comparable != *prior {
            current.release.status = DrawingReleaseStatus::Draft;
        }
    }
}

fn root(sheet: &DrawingSheetDto, mut id: u64) -> Option<u64> {
    let mut visited = std::collections::HashSet::new();
    while visited.insert(id) {
        let view = sheet.views.iter().find(|v| v.id == id)?;
        if let Some(parent) = view.parent_view_id {
            if sheet.views.iter().any(|v| v.id == parent) {
                id = parent;
                continue;
            }
        }
        return Some(id);
    }
    None
}
/// Same group-scale and aligned-placement rules as document.ts updateDrawingView.
fn apply_view(
    sheet: &mut DrawingSheetDto,
    mut edited: DrawingViewDto,
    scale_changed: bool,
    position_changed: bool,
) -> Result<(), String> {
    let index = sheet
        .views
        .iter()
        .position(|v| v.id == edited.id)
        .ok_or("View was removed")?;
    let before = sheet.views[index].position;
    if position_changed {
        if let Some(parent) = edited
            .parent_view_id
            .and_then(|id| sheet.views.iter().find(|v| v.id == id))
        {
            match edited.alignment {
                DrawingViewAlignment::Horizontal => edited.position[1] = parent.position[1],
                DrawingViewAlignment::Vertical => edited.position[0] = parent.position[0],
                DrawingViewAlignment::Free => (),
            }
        }
        let delta = [
            edited.position[0] - before[0],
            edited.position[1] - before[1],
        ];
        for child in sheet
            .views
            .iter_mut()
            .filter(|v| v.parent_view_id == Some(edited.id))
        {
            match child.alignment {
                DrawingViewAlignment::Horizontal => child.position[1] += delta[1],
                DrawingViewAlignment::Vertical => child.position[0] += delta[0],
                DrawingViewAlignment::Free => (),
            }
        }
    }
    let id = edited.id;
    let scale = edited.scale;
    sheet.views[index] = edited;
    if scale_changed {
        let root_id = root(sheet, id).ok_or("Drawing view group has a cycle")?;
        let members: Vec<_> = sheet
            .views
            .iter()
            .filter(|v| root(sheet, v.id) == Some(root_id))
            .map(|v| v.id)
            .collect();
        for member in &mut sheet.views {
            if members.contains(&member.id) {
                member.scale = scale;
            }
        }
    }
    Ok(())
}

/// Paginated selectors use the complete document, including sheet7 through64.
pub(super) fn sheets(document: &DrawingDocumentDto) -> Vec<(u64, String)> {
    document
        .sheets
        .iter()
        .map(|s| (s.id, s.name.clone()))
        .collect()
}
pub(super) fn views(document: &DrawingDocumentDto) -> Vec<(u64, String)> {
    document
        .sheets
        .iter()
        .find(|s| Some(s.id) == document.active_sheet_id)
        .map_or_else(Vec::new, |s| {
            s.views.iter().map(|v| (v.id, v.name.clone())).collect()
        })
}
pub(super) fn sheet_size(
    format: DrawingSheetFormat,
    orientation: DrawingSheetOrientation,
) -> [f64; 2] {
    let [short, long] = match format {
        DrawingSheetFormat::A0 => [841., 1189.],
        DrawingSheetFormat::A1 => [594., 841.],
        DrawingSheetFormat::A2 => [420., 594.],
        DrawingSheetFormat::A3 => [297., 420.],
        DrawingSheetFormat::A4 => [210., 297.],
        DrawingSheetFormat::Letter => [215.9, 279.4],
        DrawingSheetFormat::AnsiB => [279.4, 431.8],
        DrawingSheetFormat::AnsiC => [431.8, 558.8],
        DrawingSheetFormat::AnsiD => [558.8, 863.6],
        DrawingSheetFormat::AnsiE => [863.6, 1117.6],
    };
    if orientation == DrawingSheetOrientation::Landscape {
        [long, short]
    } else {
        [short, long]
    }
}
fn suggested_scale(scene: &nbcad_solid::SolidSceneDto, width: f64, height: f64) -> f64 {
    let mut minimum = [f64::INFINITY; 3];
    let mut maximum = [f64::NEG_INFINITY; 3];
    for point in scene
        .bodies
        .iter()
        .flat_map(|b| b.mesh.positions.chunks_exact(3))
    {
        for axis in 0..3 {
            let value = f64::from(point[axis]);
            minimum[axis] = minimum[axis].min(value);
            maximum[axis] = maximum[axis].max(value);
        }
    }
    let largest = (0..3)
        .map(|axis| maximum[axis] - minimum[axis])
        .fold(f64::NEG_INFINITY, f64::max);
    if !largest.is_finite() || largest <= 0. {
        return 1.;
    }
    let target = (width * 0.2).min(height * 0.23) / largest;
    [10., 5., 2., 1., 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]
        .into_iter()
        .find(|v| *v <= target)
        .unwrap_or(0.01)
}
pub(super) fn auto_layout(
    document: &DrawingDocumentDto,
    scene: &nbcad_solid::SolidSceneDto,
) -> Result<DrawingDocumentDto, String> {
    document.validate()?;
    let mut next = document.clone();
    let sheet = next
        .sheets
        .iter_mut()
        .find(|s| Some(s.id) == document.active_sheet_id)
        .ok_or("Create a sheet first")?;
    if !sheet.views.is_empty() {
        return Err("Auto-layout requires an empty sheet".into());
    }
    let [width, height] = sheet_size(sheet.format, sheet.orientation);
    let scale = suggested_scale(scene, width, height);
    let front = [width * 0.39, height * 0.47];
    let sign = if sheet.projection_method == DrawingProjectionMethod::ThirdAngle {
        1.
    } else {
        -1.
    };
    let first = next.next_view_id;
    next.next_view_id = first
        .checked_add(4)
        .ok_or("Drawing view identities exhausted")?;
    for (index, (kind, name, position, direction, up, alignment)) in [
        (
            DrawingViewKind::Front,
            "Front",
            front,
            [0., -1., 0.],
            [0., 0., 1.],
            DrawingViewAlignment::Free,
        ),
        (
            DrawingViewKind::Top,
            "Top",
            [front[0], front[1] - sign * (height * 0.28).min(70.)],
            [0., 0., 1.],
            [0., 1., 0.],
            DrawingViewAlignment::Vertical,
        ),
        (
            DrawingViewKind::Right,
            "Right",
            [front[0] + sign * (width * 0.24).min(90.), front[1]],
            [1., 0., 0.],
            [0., 0., 1.],
            DrawingViewAlignment::Horizontal,
        ),
        (
            DrawingViewKind::Isometric,
            "Isometric",
            [width * 0.74, height * 0.31],
            [1., -1., 1.],
            [0., 0., 1.],
            DrawingViewAlignment::Free,
        ),
    ]
    .into_iter()
    .enumerate()
    {
        sheet.views.push(DrawingViewDto {
            id: first + index as u64,
            name: name.into(),
            kind,
            direction,
            up,
            position,
            scale,
            body_ids: Vec::new(),
            show_hidden_lines: false,
            show_tangent_edges: false,
            parent_view_id: (index != 0).then_some(first),
            alignment,
            derivation: None,
            scope: Default::default(),
            occurrence_ids: Vec::new(),
        });
    }
    return_released_sheets_to_draft(document, &mut next);
    next.validate()?;
    Ok(next)
}
