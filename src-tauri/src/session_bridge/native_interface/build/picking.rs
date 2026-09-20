//! feature reference acquisition from the same camera and geometry as rendering.
use super::*;
use crate::native_viewport::NativePickPurpose;
use crate::session_bridge::native_interface::controller::NativeServices;
use nbcad_core::FaceId;
use nbcad_solid::Point2Dto;

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
    let pick = services.bridge.with_native_document_receipt(&services.engine, owner, |revision| {
        let editor = world.resource::<NativeBuild>().editor.as_ref().ok_or("The feature form is closed")?;
        if editor.id != panel.form_id || editor.snapshot.receipt.owner != *owner || editor.snapshot.receipt.revision != revision {
            return Err("The model changed; reopen the feature before selecting references".into());
        }
        let hit = native_viewport::interface_pick(world,&owner.document_id,point,NativePickPurpose::Geometry)?;
        let (_,camera,presentation,_) = native_viewport::interface_view_snapshot(world);
        let camera = bevy::math::DVec3::from_array(camera.position.map(f64::from));
        let mut nearest = hit.as_ref().map(|hit| f64::from(hit.distance)).unwrap_or(f64::INFINITY);
        if target==BuildField::AxisLine {
            let model=editor.snapshot.model(editor.form.source());
            let cursor=bevy::math::Vec2::from_array(point);
            let mut candidate=None;
            for sketch in &editor.snapshot.viewport.profile_catalog {
                if presentation.hidden_sketch_names.contains(&sketch.sketch_name) {continue;}
                for line in &sketch.lines {
                    if !editor.form.accepts_axis(&sketch.sketch_name,line.entity_id,&model) {continue;}
                    let Some(a)=native_viewport::interface_world_point(world,&owner.document_id,sketch.basis.to_3d([line.start.x,line.start.y]))? else {continue};
                    let Some(b)=native_viewport::interface_world_point(world,&owner.document_id,sketch.basis.to_3d([line.end.x,line.end.y]))? else {continue};
                    let a=bevy::math::Vec2::from_array(a);let b=bevy::math::Vec2::from_array(b);let delta=b-a;
                    let t=if delta.length_squared()>1e-10 {((cursor-a).dot(delta)/delta.length_squared()).clamp(0.,1.)} else {0.};
                    let distance=cursor.distance(a+delta*t);
                    if distance<=7. && candidate.as_ref().is_none_or(|(best,_,_)|distance<*best) {
                        candidate=Some((distance,sketch.sketch_name.clone(),line.entity_id));
                    }
                }
            }
            return candidate.map(|(_,sketch_name,entity_id)|BuildPick::AxisLine {sketch_name,entity_id})
                .ok_or_else(||"Pick a straight line on the profile's plane".into());
        }
        let mut profile = None;
        if target == BuildField::Source {
            for sketch in &editor.snapshot.viewport.profile_catalog {
                if presentation.hidden_sketch_names.contains(&sketch.sketch_name) { continue; }
                let Some(local) = native_viewport::interface_sketch_point(world,&owner.document_id,point,sketch.basis)? else { continue; };
                let distance = camera.distance(bevy::math::DVec3::from_array(sketch.basis.to_3d([local.x,local.y])));
                if distance > nearest+1e-5 { continue; }
                for region in &sketch.profiles {
                    if region.nesting_depth % 2 != 0 || !inside(local,&region.points) { continue; }
                    if sketch.profiles.iter().any(|hole| hole.parent_index == Some(region.index) && inside(local,&hole.points)) { continue; }
                    nearest = distance;
                    profile = Some(ProfileRefDto { sketch_name:sketch.sketch_name.clone(),profile_index:region.index });
                }
            }
        }
        if let Some(profile) = profile {
            let mut profiles=match editor.form.source() {
                ProfileSource::Profiles {sketch_name,indices} if *sketch_name==profile.sketch_name => indices.iter().map(|index|ProfileRefDto {sketch_name:sketch_name.clone(),profile_index:*index}).collect(),
                _=>Vec::new(),
            };
            if let Some(index)=profiles.iter().position(|p|p==&profile) {profiles.remove(index);} else {profiles.push(profile);}
            return Ok(BuildPick::Profiles(profiles));
        }
        let hit = hit.ok_or("No selectable feature reference at this point")?;
        if hit.occurrence_id.is_some() { return Err("Select a part-local reference; occurrence-local Extrude editing is not available yet".into()); }
        match target {
            BuildField::Targets => Ok(BuildPick::Bodies(vec![BodyId(hit.body_id)])),
            BuildField::Source | BuildField::StopFace => Ok(BuildPick::Face(PlanarFaceSourceDto {body_id:BodyId(hit.body_id),face_id:FaceId(hit.face_id)})),
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
