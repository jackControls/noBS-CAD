//! feature reference acquisition from the same camera and geometry as rendering.
use super::*;
use crate::native_viewport::NativePickPurpose;
use crate::session_bridge::native_interface::controller::NativeServices;
use nbcad_core::FaceId;
use nbcad_solid::Point2Dto;

pub(crate) fn hover_references(
    world: &mut World,
    services: &NativeServices,
    owner: &DocumentContext,
    point: Option<[f32; 2]>,
) -> Result<bool, String> {
    let mut state = world.remove_resource::<NativeFeature>().unwrap_or_default();
    let result = (|| {
        let Some(editor) = state.editor.as_mut().filter(|e| {
            matches!(e.pick_target, Some(SolidField::Edges | SolidField::Faces))
                && !e.form.is_busy()
        }) else {
            return Ok(false);
        };
        with_receipt(&services.bridge, &services.engine, owner, |receipt| {
            check_revision(editor, &receipt)?;
            let hit = point
                .map(|p| {
                    native_viewport::interface_pick(
                        world,
                        &owner.document_id,
                        p,
                        if editor.pick_target == Some(SolidField::Edges) {
                            NativePickPurpose::RefinableEdge
                        } else {
                            NativePickPurpose::Geometry
                        },
                    )
                })
                .transpose()?
                .flatten();
            if editor.pick_target == Some(SolidField::Faces) {
                let next = hit
                    .filter(|hit| editor.snapshot.source_local(hit.body_id, hit.occurrence_id))
                    .map(|hit| (BodyId(hit.body_id), FaceId(hit.face_id)));
                if next != editor.hovered_face
                    || native_viewport::interface_preview_revision(world) != editor.preview_revision
                {
                    editor.hovered_face = next;
                    update_preview(editor, world)?;
                }
                return Ok(true);
            }
            let next = hit
                .filter(|hit| editor.snapshot.source_local(hit.body_id, hit.occurrence_id))
                .and_then(|hit| {
                    let body = BodyId(hit.body_id);
                    let edge = nbcad_core::EdgeId(hit.edge_id?);
                    editor
                        .snapshot
                        .viewport
                        .scene
                        .bodies
                        .iter()
                        .find(|b| b.id == body)?
                        .edges
                        .iter()
                        .find(|e| e.id == edge && e.refinable)?;
                    Some((body, edge))
                });
            if next == editor.hovered_edge
                && native_viewport::interface_preview_revision(world) == editor.preview_revision
            {
                return Ok(true);
            }
            editor.hovered_edge = next;
            update_preview(editor, world)?;
            Ok(true)
        })
    })();
    world.insert_resource(state);
    result
}

fn inside(point: nbcad_sketch::Vec2, polygon: &[Point2Dto]) -> bool {
    if polygon.len() < 3 {
        return false;
    }
    let mut inside = false;
    for (a, b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        if (a.y > point.y) != (b.y > point.y)
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
        {
            inside = !inside;
        }
    }
    inside
}

pub(crate) fn handle_canvas_pick(
    world: &mut World,
    services: &NativeServices,
    owner: &DocumentContext,
    point: [f32; 2],
) -> Result<Option<Value>, String> {
    let Some(panel) = panel(world) else {
        return Ok(None);
    };
    let Some(target) = panel.pick_target else {
        return Ok(None);
    };
    if panel.busy {
        return Err("Wait for the feature to finish".into());
    }
    let pick =
        services
            .bridge
            .with_native_document_receipt(&services.engine, owner, |revision| {
                let editor = world
                    .resource::<NativeFeature>()
                    .editor
                    .as_ref()
                    .ok_or("The feature form is closed")?;
                if editor.id != panel.form_id
                    || editor.snapshot.receipt.owner != *owner
                    || editor.snapshot.receipt.revision != revision
                {
                    return Err(
                        "The model changed; reopen the feature before selecting references".into(),
                    );
                }
                let hit = native_viewport::interface_pick(
                    world,
                    &owner.document_id,
                    point,
                    if target == SolidField::Edges {
                        NativePickPurpose::RefinableEdge
                    } else {
                        NativePickPurpose::Geometry
                    },
                )?;
                if target == SolidField::Edges {
                    let hit = hit.ok_or("Pick an edge on a visible body")?;
                    if !editor.snapshot.source_local(hit.body_id, hit.occurrence_id) {
                        return Err("Open the component before selecting its edges".into());
                    }
                    let id =
                        nbcad_core::EdgeId(hit.edge_id.ok_or("Pick an edge, rather than a face")?);
                    let body = BodyId(hit.body_id);
                    let mut edges = editor
                        .form
                        .selected_edges()
                        .filter(|(selected, _)| *selected == body)
                        .map(|(_, e)| e.to_vec())
                        .unwrap_or_default();
                    if let Some(index) = edges.iter().position(|e| *e == id) {
                        edges.remove(index);
                    } else {
                        edges.push(id);
                    }
                    return Ok(FeaturePick::Edges {
                        body: Some(body),
                        edges,
                    });
                }
                let (_, camera, presentation, _) = native_viewport::interface_view_snapshot(world);
                let camera = bevy::math::DVec3::from_array(camera.position.map(f64::from));
                let mut nearest = hit
                    .as_ref()
                    .map(|hit| f64::from(hit.distance))
                    .unwrap_or(f64::INFINITY);
                if matches!(target, SolidField::Path | SolidField::Guide) {
                    let mut candidate = None;
                    let mut distance = f64::INFINITY;
                    for sketch in &editor.snapshot.viewport.finished_sketches {
                        if presentation.hidden_sketch_names.contains(&sketch.name) {
                            continue;
                        }
                        let Some(catalog) = editor
                            .snapshot
                            .viewport
                            .profile_catalog
                            .iter()
                            .find(|s| s.sketch_name == sketch.name)
                        else {
                            continue;
                        };
                        let entities: Vec<_> = sketch
                            .entities
                            .iter()
                            .filter(|entity| {
                                catalog
                                    .path_curves
                                    .iter()
                                    .any(|c| c.entity_id() == entity.id().0)
                            })
                            .cloned()
                            .collect();
                        let Some(id) =
                            crate::native_editor::selection::hit(&entities, point, false, |p| {
                                native_viewport::interface_world_point(
                                    world,
                                    &owner.document_id,
                                    sketch.basis.to_3d([p.x, p.y]),
                                )
                                .ok()
                                .flatten()
                            })
                        else {
                            continue;
                        };
                        let Some(local) = native_viewport::interface_sketch_point(
                            world,
                            &owner.document_id,
                            point,
                            sketch.basis,
                        )?
                        else {
                            continue;
                        };
                        let depth = camera.distance(bevy::math::DVec3::from_array(
                            sketch.basis.to_3d([local.x, local.y]),
                        ));
                        if depth < distance {
                            distance = depth;
                            candidate = Some((sketch.name.clone(), id.0));
                        }
                    }
                    let (name, id) =
                        candidate.ok_or("Pick a visible sketch curve for this path")?;
                    let mut path = editor
                        .form
                        .path(target)
                        .filter(|p| p.sketch_name == name)
                        .cloned()
                        .unwrap_or(PathRefDto {
                            sketch_name: name,
                            entity_ids: vec![],
                        });
                    if let Some(index) = path.entity_ids.iter().position(|item| *item == id) {
                        path.entity_ids.remove(index);
                    } else {
                        path.entity_ids.push(id);
                    }
                    return Ok(FeaturePick::Path(path));
                }
                if target == SolidField::AxisLine {
                    let model = editor.snapshot.model(editor.form.parameter_sketch());
                    let cursor = bevy::math::Vec2::from_array(point);
                    let mut candidate = None;
                    for sketch in &editor.snapshot.viewport.profile_catalog {
                        if presentation
                            .hidden_sketch_names
                            .contains(&sketch.sketch_name)
                        {
                            continue;
                        }
                        for line in &sketch.lines {
                            if !editor.form.accepts_axis(
                                &sketch.sketch_name,
                                line.entity_id,
                                &model,
                            ) {
                                continue;
                            }
                            let Some(a) = native_viewport::interface_world_point(
                                world,
                                &owner.document_id,
                                sketch.basis.to_3d([line.start.x, line.start.y]),
                            )?
                            else {
                                continue;
                            };
                            let Some(b) = native_viewport::interface_world_point(
                                world,
                                &owner.document_id,
                                sketch.basis.to_3d([line.end.x, line.end.y]),
                            )?
                            else {
                                continue;
                            };
                            let a = bevy::math::Vec2::from_array(a);
                            let b = bevy::math::Vec2::from_array(b);
                            let delta = b - a;
                            let t = if delta.length_squared() > 1e-10 {
                                ((cursor - a).dot(delta) / delta.length_squared()).clamp(0., 1.)
                            } else {
                                0.
                            };
                            let distance = cursor.distance(a + delta * t);
                            if distance <= 7.
                                && candidate
                                    .as_ref()
                                    .is_none_or(|(best, _, _)| distance < *best)
                            {
                                candidate =
                                    Some((distance, sketch.sketch_name.clone(), line.entity_id));
                            }
                        }
                    }
                    return candidate
                        .map(|(_, sketch_name, entity_id)| FeaturePick::AxisLine {
                            sketch_name,
                            entity_id,
                        })
                        .ok_or_else(|| "Pick a straight line on the profile's plane".into());
                }
                let mut profile = None;
                if target == SolidField::Source {
                    for sketch in &editor.snapshot.viewport.profile_catalog {
                        if presentation
                            .hidden_sketch_names
                            .contains(&sketch.sketch_name)
                        {
                            continue;
                        }
                        let Some(local) = native_viewport::interface_sketch_point(
                            world,
                            &owner.document_id,
                            point,
                            sketch.basis,
                        )?
                        else {
                            continue;
                        };
                        let distance = camera.distance(bevy::math::DVec3::from_array(
                            sketch.basis.to_3d([local.x, local.y]),
                        ));
                        if distance > nearest + 1e-5 {
                            continue;
                        }
                        for region in &sketch.profiles {
                            if region.nesting_depth % 2 != 0 || !inside(local, &region.points) {
                                continue;
                            }
                            if sketch.profiles.iter().any(|hole| {
                                hole.parent_index == Some(region.index)
                                    && inside(local, &hole.points)
                            }) {
                                continue;
                            }
                            nearest = distance;
                            profile = Some(ProfileRefDto {
                                sketch_name: sketch.sketch_name.clone(),
                                profile_index: region.index,
                            });
                        }
                    }
                }
                if let Some(profile) = profile {
                    let mut profiles = editor.form.selected_profiles();
                    if editor.form.kind() != SolidFormKind::Loft {
                        profiles.retain(|p| p.sketch_name == profile.sketch_name);
                    }
                    if editor.form.kind() == SolidFormKind::Sweep
                        && profiles.first() != Some(&profile)
                    {
                        profiles.clear();
                    }
                    if let Some(index) = profiles.iter().position(|p| p == &profile) {
                        profiles.remove(index);
                    } else {
                        profiles.push(profile);
                    }
                    return Ok(FeaturePick::Profiles(profiles));
                }
                let hit = hit.ok_or("No selectable feature reference at this point")?;
                if !editor.snapshot.source_local(hit.body_id, hit.occurrence_id) {
                    return Err("Open the component before selecting its references".into());
                }
                match target {
                    SolidField::Faces => {
                        let body = BodyId(hit.body_id);
                        let id = FaceId(hit.face_id);
                        let mut faces = editor
                            .form
                            .selected_faces()
                            .filter(|(selected, _)| *selected == body)
                            .map(|(_, f)| f.to_vec())
                            .unwrap_or_default();
                        if let Some(index) = faces.iter().position(|f| *f == id) {
                            faces.remove(index);
                        } else {
                            faces.push(id);
                        }
                        Ok(FeaturePick::Faces {
                            body: Some(body),
                            faces,
                        })
                    }
                    SolidField::Targets => {
                        let mut targets = editor.form.targets().to_vec();
                        let id = BodyId(hit.body_id);
                        if let Some(index) = targets.iter().position(|item| *item == id) {
                            targets.remove(index);
                        } else {
                            targets.push(id);
                        }
                        Ok(FeaturePick::Bodies(targets))
                    }
                    SolidField::Source | SolidField::StopFace => {
                        Ok(FeaturePick::Face(PlanarFaceSourceDto {
                            body_id: BodyId(hit.body_id),
                            face_id: FaceId(hit.face_id),
                        }))
                    }
                    _ => Err("This feature field does not accept canvas references".into()),
                }
            })?;
    accept_pick(
        &services.engine,
        &services.bridge,
        world,
        owner,
        panel.form_id,
        pick,
        || Ok(()),
    )
    .map(|mut value| {
        value["handled"] = json!(true);
        Some(value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_hit_test_handles_both_windings_and_concavity() {
        let mut polygon = vec![
            Point2Dto::new(0., 0.),
            Point2Dto::new(4., 0.),
            Point2Dto::new(4., 1.),
            Point2Dto::new(1., 1.),
            Point2Dto::new(1., 4.),
            Point2Dto::new(0., 4.),
        ];
        for _ in 0..2 {
            assert!(inside(nbcad_sketch::Vec2::new(0.5, 3.), &polygon));
            assert!(!inside(nbcad_sketch::Vec2::new(3., 3.), &polygon));
            polygon.reverse();
        }
    }
}
