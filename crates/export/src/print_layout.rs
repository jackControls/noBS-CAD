//! Conservative print-layout diagnostics and non-destructive arrangement proposals.
use crate::{ExportError, TriangleMesh};
use nbcad_assembly::{
    AssemblySolutionDto, AssemblyTransformDto, ComponentStructureDto, OccurrenceId,
};
use nbcad_core::{BodyId, PrintBedDto};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutIssue {
    pub code: String,
    pub message: String,
    pub occurrence_ids: Vec<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutTranslation {
    pub occurrence_id: u64,
    /// Additional world-axis translation; add to the saved view's current offset.
    pub translation: [f64; 3],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintLayoutReport {
    pub bed: PrintBedDto,
    pub printable_instances: usize,
    pub printable_groups: usize,
    pub excluded_instances: usize,
    pub issues: Vec<LayoutIssue>,
    pub proposed_translations: Vec<LayoutTranslation>,
    pub proposal_fits: bool,
    pub clearance_mm: f64,
    pub overlap_check: String,
}
#[derive(Clone, Copy)]
struct Bounds {
    min: [f64; 3],
    max: [f64; 3],
}
impl Bounds {
    fn empty() -> Self {
        Self {
            min: [f64::INFINITY; 3],
            max: [f64::NEG_INFINITY; 3],
        }
    }
    fn add(&mut self, point: [f64; 3]) {
        for axis in 0..3 {
            self.min[axis] = self.min[axis].min(point[axis]);
            self.max[axis] = self.max[axis].max(point[axis]);
        }
    }
    fn size(self) -> [f64; 3] {
        std::array::from_fn(|i| self.max[i] - self.min[i])
    }
}

pub fn analyze_print_layout(
    meshes: &[TriangleMesh],
    structure: &ComponentStructureDto,
    solution: &AssemblySolutionDto,
    bed: &PrintBedDto,
) -> Result<PrintLayoutReport, ExportError> {
    bed.validate().map_err(ExportError)?;
    structure.validate().map_err(ExportError)?;
    if !solution.solved {
        return Err(ExportError(
            "Resolve assembly errors before checking the print layout.".into(),
        ));
    }
    let sources: HashMap<BodyId, _> = meshes.iter().map(|m| (m.body_id, m)).collect();
    let parents: HashMap<_, _> = structure
        .occurrences
        .iter()
        .map(|o| (o.id, o.parent_occurrence_id))
        .collect();
    let root = |mut id: OccurrenceId| {
        while let Some(parent) = parents.get(&id).copied().flatten() {
            id = parent;
        }
        id.0
    };
    let mut report = PrintLayoutReport {
        bed: bed.clone(), printable_instances: 0, printable_groups: 0, excluded_instances: 0,
        issues: vec![], proposed_translations: vec![], proposal_fits: true, clearance_mm: 2.,
        overlap_check: "Conservative transformed mesh bounds; warnings are possible intersections, not exact solid collisions.".into(),
    };
    let mut groups = BTreeMap::<u64, Bounds>::new();
    let mut parts = Vec::new();
    for pose in &solution.instance_body_poses {
        let Some(mesh) = sources.get(&pose.body_id) else {
            report.excluded_instances += 1;
            continue;
        };
        if !pose.visible {
            report.excluded_instances += 1;
            continue;
        }
        crate::mesh_weld::validate_mesh_buffers(mesh)?;
        if mesh.positions.is_empty() {
            return Err(ExportError(
                "Print layout contains an empty body mesh".into(),
            ));
        }
        if pose
            .translation
            .iter()
            .chain(pose.rotation.iter())
            .any(|v| !v.is_finite())
            || pose.rotation.iter().map(|v| v * v).sum::<f64>() < 1e-12
        {
            return Err(ExportError(
                "Invalid occurrence transform in print layout".into(),
            ));
        }
        let transform = AssemblyTransformDto {
            translation: pose.translation,
            rotation: pose.rotation,
        };
        let mut bounds = Bounds::empty();
        for v in mesh.positions.chunks_exact(3) {
            bounds.add(transform.transform_point([
                f64::from(v[0]),
                f64::from(v[1]),
                f64::from(v[2]),
            ]));
        }
        let group = groups
            .entry(root(pose.occurrence_id))
            .or_insert_with(Bounds::empty);
        group.add(bounds.min);
        group.add(bounds.max);
        parts.push((pose.occurrence_id.0, pose.body_id.0, bounds));
        report.printable_instances += 1;
        if bounds.min[2] < -1e-5 {
            report.issues.push(issue(
                "below_bed",
                format!(
                    "{} (occurrence {}) extends below the bed.",
                    mesh.name, pose.occurrence_id.0
                ),
                vec![pose.occurrence_id.0],
            ));
        } else if bounds.min[2] > 1e-5 {
            // Elevated parts inside a multipart group can be intentional.
            report.issues.push(issue("above_bed", format!("{} (occurrence {}) starts above the bed; check whether other parts or slicer supports carry it.", mesh.name, pose.occurrence_id.0), vec![pose.occurrence_id.0]));
        }
        if !bed.contains_xy_bounds(
            [bounds.min[0], bounds.min[1]],
            [bounds.max[0], bounds.max[1]],
        ) || bounds.max[2] > bed.size_mm[2] + 1e-5
        {
            report.issues.push(issue(
                "outside_bed",
                format!(
                    "{} (occurrence {}) exceeds the configured usable envelope.",
                    mesh.name, pose.occurrence_id.0
                ),
                vec![pose.occurrence_id.0],
            ));
        }
    }
    report.printable_groups = groups.len();
    if report.printable_instances == 0 {
        report.issues.push(issue(
            "empty_layout",
            "No visible occurrences are included in this export.".into(),
            vec![],
        ));
        report.proposal_fits = false;
    }
    if report.excluded_instances > 0 {
        report.issues.push(issue("excluded_instances", format!("{} body occurrences are excluded by visibility or body selection. Repeated included occurrences are all preserved.", report.excluded_instances), vec![]));
    }
    for (i, (id_a, body_a, a)) in parts.iter().enumerate() {
        for (id_b, body_b, b) in &parts[i + 1..] {
            if (0..3).all(|axis| a.max[axis].min(b.max[axis]) - a.min[axis].max(b.min[axis]) > 1e-5)
            {
                report.issues.push(issue("possible_overlap", format!("Bounds overlap for body {body_a} / occurrence {id_a} and body {body_b} / occurrence {id_b}; this may be intentional multipart geometry."), vec![*id_a, *id_b]));
            }
        }
    }
    // Deterministic shelf packing moves whole CAD-root groups, preserving every
    // internal pose, rotation, part and repetition. It never changes quantities.
    let mut ordered: Vec<_> = groups.into_iter().collect();
    ordered
        .sort_by(|(a_id, a), (b_id, b)| b.size()[1].total_cmp(&a.size()[1]).then(a_id.cmp(b_id)));
    let margin = bed.margin_mm;
    let start = [bed.origin_mm[0] + margin, bed.origin_mm[1] + margin];
    let end = [
        bed.origin_mm[0] + bed.size_mm[0] - margin,
        bed.origin_mm[1] + bed.size_mm[1] - margin,
    ];
    let (mut x, mut y, mut row_depth) = (start[0], start[1], 0f64);
    let mut placed: Vec<Bounds> = vec![];
    for (id, bounds) in ordered {
        let size = bounds.size();
        if x + size[0] > end[0] + 1e-5 {
            x = start[0];
            y += row_depth + report.clearance_mm;
            row_depth = 0.;
        }
        if size[0] > bed.size_mm[0] - 2. * margin
            || y + size[1] > end[1]
            || size[2] > bed.size_mm[2]
        {
            report.proposal_fits = false;
            report.issues.push(issue("arrangement_does_not_fit", "All groups do not fit this bed in their current orientations. Change orientation or split the layout into additional named views.".into(), vec![id]));
            continue;
        }
        let fits = |x: f64, y: f64| {
            bed.contains_xy_bounds([x, y], [x + size[0], y + size[1]])
                && placed.iter().all(|p| {
                    x + size[0] + report.clearance_mm <= p.min[0] + 1e-5
                        || x >= p.max[0] + report.clearance_mm - 1e-5
                        || y + size[1] + report.clearance_mm <= p.min[1] + 1e-5
                        || y >= p.max[1] + report.clearance_mm - 1e-5
                })
        };
        if !fits(x, y) {
            // Search obstacle edges and a bounded grid. Conservative proposals
            // may fail even when another orientation or tighter packing fits.
            let mut xs = vec![start[0]];
            let mut ys = vec![start[1]];
            for p in &bed.excluded_regions {
                xs.push(p.iter().map(|v| v[0]).fold(f64::NEG_INFINITY, f64::max) + margin);
                ys.push(p.iter().map(|v| v[1]).fold(f64::NEG_INFINITY, f64::max) + margin);
            }
            for p in &placed {
                xs.push(p.max[0] + report.clearance_mm);
                ys.push(p.max[1] + report.clearance_mm);
            }
            let step = (bed.size_mm[0].max(bed.size_mm[1]) / 256.).max(1.);
            for i in 0..=256 {
                xs.push(start[0] + i as f64 * step);
                ys.push(start[1] + i as f64 * step);
            }
            xs.sort_by(f64::total_cmp);
            ys.sort_by(f64::total_cmp);
            let candidate = ys
                .into_iter()
                .filter(|y| *y + size[1] <= end[1] + 1e-5)
                .find_map(|y| {
                    xs.iter()
                        .copied()
                        .filter(|x| *x + size[0] <= end[0] + 1e-5)
                        .find(|x| fits(*x, y))
                        .map(|x| (x, y))
                });
            if let Some((nx, ny)) = candidate {
                x = nx;
                y = ny;
            } else {
                report.proposal_fits = false;
                report.issues.push(issue("arrangement_does_not_fit","A conservative arrangement could not fit all groups within the printable regions and exclusions. Change orientation or use additional named views.".into(),vec![id]));
                continue;
            }
        }
        let translation = [x - bounds.min[0], y - bounds.min[1], -bounds.min[2]];
        if translation.iter().any(|v| v.abs() > 1e-5) {
            report.proposed_translations.push(LayoutTranslation {
                occurrence_id: id,
                translation,
            });
        }
        placed.push(Bounds {
            min: [x, y, 0.],
            max: [x + size[0], y + size[1], size[2]],
        });
        x += size[0] + report.clearance_mm;
        row_depth = row_depth.max(size[1]);
    }
    if !report.proposal_fits {
        report.proposed_translations.clear();
    }
    Ok(report)
}
fn issue(code: &str, message: String, occurrence_ids: Vec<u64>) -> LayoutIssue {
    LayoutIssue {
        code: code.into(),
        message,
        occurrence_ids,
    }
}
