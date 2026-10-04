//! Preserve the CAD occurrence tree and reuse source meshes in portable 3MF.
use crate::threemf::{build_3mf_model_xml, xml_escape};
use crate::{ExportError, MeshExportRequest, SlicerTarget, TriangleMesh};
use nbcad_assembly::{AssemblySolutionDto, AssemblyTransformDto, ComponentStructureDto};
use nbcad_core::{BodyAppearance, BodyId};
use std::collections::{HashMap, HashSet};

pub fn write_3mf_scene(
    meshes: &[TriangleMesh],
    appearances: &[BodyAppearance],
    request: &MeshExportRequest,
    structure: &ComponentStructureDto,
    solution: &AssemblySolutionDto,
) -> Result<Vec<u8>, ExportError> {
    let included: HashSet<_> = solution
        .instance_body_poses
        .iter()
        .filter(|p| p.visible)
        .map(|p| p.body_id)
        .collect();
    let meshes: Vec<_> = meshes
        .iter()
        .filter(|m| included.contains(&m.body_id))
        .cloned()
        .collect();
    crate::threemf::write_package(
        &meshes,
        appearances,
        request.include_appearance,
        request.slicer_target,
        Some((structure, solution)),
    )
}

pub(crate) fn build_scene_xml(
    meshes: &[TriangleMesh],
    appearances: &[BodyAppearance],
    include_appearance: bool,
    target: SlicerTarget,
    structure: &ComponentStructureDto,
    solution: &AssemblySolutionDto,
) -> Result<String, ExportError> {
    structure.validate().map_err(ExportError)?;
    if !solution.solved {
        return Err(ExportError(
            "Resolve assembly errors before mesh export.".into(),
        ));
    }
    let bodies: HashMap<BodyId, usize> = meshes
        .iter()
        .enumerate()
        .map(|(i, m)| (m.body_id, i + 2))
        .collect();
    if bodies.len() != meshes.len() {
        return Err(ExportError(
            "Scene export needs one source mesh per body".into(),
        ));
    }
    let occurrences: HashMap<_, _> = structure.occurrences.iter().map(|o| (o.id, o)).collect();
    let poses: HashMap<_, _> = solution
        .occurrence_poses
        .iter()
        .map(|p| {
            (
                p.occurrence_id,
                AssemblyTransformDto {
                    translation: p.translation,
                    rotation: p.rotation,
                },
            )
        })
        .collect();
    let mut included = HashSet::new();
    for pose in solution
        .instance_body_poses
        .iter()
        .filter(|p| p.visible && bodies.contains_key(&p.body_id))
    {
        let mut id = Some(pose.occurrence_id);
        while let Some(current) = id {
            if !included.insert(current) {
                break;
            }
            id = occurrences
                .get(&current)
                .ok_or_else(|| ExportError("Missing export occurrence".into()))?
                .parent_occurrence_id;
        }
    }
    if included.is_empty() {
        return Err(ExportError(
            "There are no visible occurrences to export.".into(),
        ));
    }
    let mut rows: Vec<_> = structure
        .occurrences
        .iter()
        .filter(|o| included.contains(&o.id))
        .collect();
    rows.sort_by_key(|o| o.id.0);
    let ids: HashMap<_, _> = rows
        .iter()
        .enumerate()
        .map(|(i, o)| (o.id, meshes.len() + 2 + i))
        .collect();
    let mut xml = build_3mf_model_xml(meshes, appearances, include_appearance, target)?;
    let resource_end = xml
        .find("  </resources>")
        .ok_or_else(|| ExportError("Missing model resources".into()))?;
    xml.truncate(resource_end);
    // Bambu's standard-model importer consumes Materials Extension color groups.
    // Keep core base material names as portable chemistry hints alongside colors.
    if include_appearance && target != SlicerTarget::PrusaSlicer {
        let colors_id = meshes.len() + rows.len() + 2;
        xml = xml.replace("xml:lang=\"en-US\"", "xml:lang=\"en-US\" xmlns:m=\"http://schemas.microsoft.com/3dmanufacturing/material/2015/02\"");
        xml = xml.replace("pid=\"1\"", &format!("pid=\"{colors_id}\""));
        let mut colors = format!("    <m:colorgroup id=\"{colors_id}\">\n");
        for mesh in meshes {
            let app = crate::threemf::appearance_for(appearances, mesh.body_id);
            colors.push_str(&format!(
                "      <m:color color=\"{}\"/>\n",
                app.color.opaque_rgb().to_hex_rgb()
            ));
        }
        colors.push_str("    </m:colorgroup>\n");
        let first_object = xml
            .find("    <object ")
            .ok_or_else(|| ExportError("Missing source objects".into()))?;
        xml.insert_str(first_object, &colors);
    }
    // Core 3MF forbids forward references. Emit deepest occurrences first;
    // resource IDs remain stable regardless of the serialization order.
    let mut resource_rows = rows.clone();
    resource_rows.sort_by_key(|row| {
        let mut depth = 0;
        let mut parent = row.parent_occurrence_id;
        while let Some(id) = parent {
            depth += 1;
            parent = occurrences[&id].parent_occurrence_id;
        }
        (std::cmp::Reverse(depth), row.id.0)
    });
    for row in &resource_rows {
        let id = ids[&row.id];
        let pose = *poses
            .get(&row.id)
            .ok_or_else(|| ExportError(format!("Occurrence {} has no solved pose", row.id.0)))?;
        xml.push_str(&format!(
            "    <object id=\"{id}\" type=\"model\" name=\"{}\"><components>\n",
            xml_escape(&row.name)
        ));
        for part in solution
            .instance_body_poses
            .iter()
            .filter(|p| p.occurrence_id == row.id && p.visible)
        {
            if let Some(body_id) = bodies.get(&part.body_id) {
                let local = pose.inverse().compose(AssemblyTransformDto {
                    translation: part.translation,
                    rotation: part.rotation,
                });
                xml.push_str(&format!(
                    "      <component objectid=\"{body_id}\" transform=\"{}\"/>\n",
                    matrix(local)?
                ));
            }
        }
        for child in rows
            .iter()
            .filter(|child| child.parent_occurrence_id == Some(row.id))
        {
            let child_pose = *poses
                .get(&child.id)
                .ok_or_else(|| ExportError("Missing child occurrence pose".into()))?;
            xml.push_str(&format!(
                "      <component objectid=\"{}\" transform=\"{}\"/>\n",
                ids[&child.id],
                matrix(pose.inverse().compose(child_pose))?
            ));
        }
        xml.push_str("    </components></object>\n");
    }
    xml.push_str("  </resources>\n  <build>\n");
    for root in rows.iter().filter(|o| o.parent_occurrence_id.is_none()) {
        xml.push_str(&format!(
            "    <item objectid=\"{}\" transform=\"{}\"/>\n",
            ids[&root.id],
            matrix(poses[&root.id])?
        ));
    }
    xml.push_str("  </build>\n</model>\n");
    Ok(xml)
}

fn matrix(pose: AssemblyTransformDto) -> Result<String, ExportError> {
    if pose
        .translation
        .iter()
        .chain(pose.rotation.iter())
        .any(|v| !v.is_finite())
        || pose.rotation.iter().map(|v| v * v).sum::<f64>() < 1e-12
    {
        return Err(ExportError(
            "Invalid occurrence transform in 3MF export".into(),
        ));
    }
    let origin = pose.transform_point([0.; 3]);
    let mut values = Vec::with_capacity(12);
    for axis in [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]] {
        let point = pose.transform_point(axis);
        values.extend((0..3).map(|i| point[i] - origin[i]));
    }
    values.extend(origin);
    Ok(values
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (
        Vec<TriangleMesh>,
        Vec<BodyAppearance>,
        ComponentStructureDto,
        AssemblySolutionDto,
    ) {
        let (mut meshes, appearances) = crate::print_in_place_clip();
        meshes.truncate(1);
        let body = meshes[0].body_id;
        let structure = serde_json::from_value(json!({
            "definitions": [{"id":1,"name":"Assembly"},{"id":2,"name":"Part","body_ids":[body]}],
            "occurrences": [
                {"id":1,"name":"Multipart & rotated","component_id":1},
                {"id":2,"name":"First","component_id":2,"parent_occurrence_id":1},
                {"id":3,"name":"Repeated","component_id":2,"parent_occurrence_id":1},
                {"id":4,"name":"Independent","component_id":2}],
            "next_component_id":3,"next_occurrence_id":5
        }))
        .unwrap();
        let half = std::f64::consts::FRAC_1_SQRT_2;
        let poses = [
            (1, 1, [50., 50., 0.], [0., 0., half, half]),
            (2, 2, [50., 50., 0.], [0., 0., half, half]),
            (3, 2, [50., 90., 0.], [0., 0., half, half]),
            (4, 2, [150., 50., 0.], [0., 0., 0., 1.]),
        ];
        let solution = serde_json::from_value(json!({"solved":true,"body_poses":[],"diagnostics":[],
            "occurrence_poses":poses.iter().map(|(id,comp,t,r)|json!({"occurrence_id":id,"component_id":comp,"translation":t,"rotation":r})).collect::<Vec<_>>(),
            "instance_body_poses":poses.iter().skip(1).map(|(id,comp,t,r)|json!({"occurrence_id":id,"component_id":comp,"body_id":body,"translation":t,"rotation":r,"visible":true})).collect::<Vec<_>>()
        })).unwrap();
        (meshes, appearances, structure, solution)
    }
    #[test]
    fn portable_scene_preserves_nested_parts_repeats_and_world_transforms() {
        let (meshes, apps, structure, solution) = fixture();
        for target in [
            SlicerTarget::Standard,
            SlicerTarget::BambuStudio,
            SlicerTarget::OrcaSlicer,
        ] {
            let xml = build_scene_xml(&meshes, &apps, true, target, &structure, &solution).unwrap();
            let doc = roxmltree::Document::parse(&xml).unwrap();
            assert_eq!(
                doc.descendants().filter(|n| n.has_tag_name("mesh")).count(),
                1
            );
            assert_eq!(
                doc.descendants().filter(|n| n.has_tag_name("item")).count(),
                2
            );
            // Every property and object reference must resolve to an earlier resource.
            let mut defined = HashSet::new();
            let resources = doc
                .descendants()
                .find(|n| n.has_tag_name("resources"))
                .unwrap();
            for resource in resources.children().filter(|n| n.is_element()) {
                for node in resource.descendants() {
                    for name in ["pid", "objectid"] {
                        if let Some(id) = node.attribute(name) {
                            assert!(defined.contains(id), "Forward reference {id}");
                        }
                    }
                }
                defined.insert(resource.attribute("id").unwrap());
            }
            let expanded = crate::test_reader::read_build(&xml).unwrap();
            assert_eq!(expanded.len(), 3);
            for (actual, pose) in expanded.iter().zip(&solution.instance_body_poses) {
                let transform = AssemblyTransformDto {
                    translation: pose.translation,
                    rotation: pose.rotation,
                };
                for (actual, source) in actual
                    .vertices
                    .iter()
                    .zip(meshes[0].positions.chunks_exact(3))
                {
                    let expected = transform.transform_point([
                        source[0] as f64,
                        source[1] as f64,
                        source[2] as f64,
                    ]);
                    assert!(
                        (0..3).all(|i| (actual[i] - expected[i]).abs() < 1e-5),
                        "{actual:?} != {expected:?}"
                    );
                }
            }
            assert!(xml.contains("Multipart &amp; rotated"));
        }
        if let Ok(path) = std::env::var("NBCAD_3MF_FIXTURE") {
            std::fs::write(
                path,
                write_3mf_scene(
                    &meshes,
                    &apps,
                    &MeshExportRequest::default(),
                    &structure,
                    &solution,
                )
                .unwrap(),
            )
            .unwrap();
        }
    }
    #[test]
    fn excluded_occurrences_are_absent_without_deduplicating_visible_repeats() {
        let (meshes, apps, structure, mut solution) = fixture();
        solution.instance_body_poses[2].visible = false;
        let xml = build_scene_xml(
            &meshes,
            &apps,
            false,
            SlicerTarget::Standard,
            &structure,
            &solution,
        )
        .unwrap();
        assert_eq!(crate::test_reader::read_build(&xml).unwrap().len(), 2);
        assert_eq!(xml.matches("<item ").count(), 1);
        assert!(!xml.contains("Independent"));
    }
    #[test]
    fn arrangement_is_atomic_and_moves_whole_hierarchy_groups() {
        let (meshes, _, structure, solution) = fixture();
        let report =
            crate::analyze_print_layout(&meshes, &structure, &solution, &Default::default())
                .unwrap();
        assert_eq!(report.printable_instances, 3);
        assert_eq!(report.printable_groups, 2);
        assert!(report.proposal_fits);
        assert!(report
            .proposed_translations
            .iter()
            .all(|m| m.occurrence_id == 1 || m.occurrence_id == 4));
        let tiny = nbcad_core::PrintBedDto {
            size_mm: [1., 1., 1.],
            ..Default::default()
        };
        let report = crate::analyze_print_layout(&meshes, &structure, &solution, &tiny).unwrap();
        assert!(!report.proposal_fits);
        assert!(report.proposed_translations.is_empty());
    }
    #[test]
    fn arrangement_respects_dual_origin_and_exclusions() {
        let (meshes, _, structure, solution) = fixture();
        let mut bed = nbcad_core::embedded_printer_catalog().profiles[0]
            .dual
            .clone();
        bed.excluded_regions = vec![vec![[20.5, 0.], [60., 0.], [60., 60.], [20.5, 60.]]];
        let report = crate::analyze_print_layout(&meshes, &structure, &solution, &bed).unwrap();
        assert!(report.proposal_fits);
        let offsets = report
            .proposed_translations
            .iter()
            .map(|m| nbcad_assembly::ViewOccurrenceOffsetDto {
                occurrence_id: nbcad_assembly::OccurrenceId(m.occurrence_id),
                translation: m.translation,
                rotation: [0., 0., 0., 1.],
            })
            .collect::<Vec<_>>();
        let corrected =
            nbcad_assembly::resolve_view_layout(&structure, &solution, &offsets).unwrap();
        let checked = crate::analyze_print_layout(&meshes, &structure, &corrected, &bed).unwrap();
        assert!(!checked
            .issues
            .iter()
            .any(|i| i.code == "outside_bed" || i.code == "below_bed"));
        assert_eq!(checked.printable_instances, 3);
    }
    #[test]
    #[ignore = "Requires installed slicer CLI roundtrip artifacts"]
    fn installed_slicer_roundtrips_preserve_every_transformed_vertex() {
        let folder = std::env::var("NBCAD_SLICER_RESULTS")
            .expect("Set NBCAD_SLICER_RESULTS to roundtrip folder");
        let source = std::fs::read(format!("{folder}/../multipart-acceptance.3mf")).unwrap();
        let expected = crate::test_reader::read_package(&source).unwrap();
        for slicer in ["bambu", "orca"] {
            let bytes = std::fs::read(format!("{folder}/{slicer}-roundtrip.3mf")).unwrap();
            let actual = crate::test_reader::read_package(&bytes).unwrap();
            assert_eq!(actual.len(), expected.len());
            let mut groups = std::collections::BTreeMap::<usize, usize>::new();
            for mesh in &actual {
                *groups.entry(mesh.build_item).or_default() += 1;
            }
            let mut quantities: Vec<_> = groups.values().copied().collect();
            quantities.sort();
            assert_eq!(quantities, [1, 2], "{slicer} changed multipart grouping");
            let sorted_points = |meshes: Vec<crate::test_reader::ModelMesh>| {
                let mut points: Vec<_> = meshes.into_iter().flat_map(|m| m.vertices).collect();
                points.sort_by(|a, b| {
                    a[0].total_cmp(&b[0])
                        .then(a[1].total_cmp(&b[1]))
                        .then(a[2].total_cmp(&b[2]))
                });
                points
            };
            // Importers may weld/reorder vertices: compare distinct quantized
            // world points, including every occurrence's placement.
            let points = |meshes| {
                sorted_points(meshes)
                    .into_iter()
                    .map(|p| p.map(|v| (v * 1000.).round() as i64))
                    .collect::<std::collections::BTreeSet<_>>()
            };
            assert_eq!(
                points(actual),
                points(crate::test_reader::read_package(&source).unwrap()),
                "{slicer} changed placement"
            );
        }
    }
}
