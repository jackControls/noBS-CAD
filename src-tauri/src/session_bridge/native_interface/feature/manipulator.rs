//! Offset drags edit only the typed draft, using the current camera projection.
use super::super::controller::NativeServices;
use super::*;
use bevy::math::Vec2;

#[derive(Clone, Copy)]
pub(super) struct Drag {
    start: Vec2,
    direction: Vec2,
    pixels_per_mm: f32,
    distance: f64,
}
#[derive(Clone, Copy)]
pub(crate) enum Pointer {
    Press,
    Move,
    Release,
    Cancel,
}

fn projection(world: &World, editor: &Editor) -> Option<(Vec2, Vec2, f32, f64)> {
    let model = editor.snapshot.model(None);
    let (basis, distance) = editor.form.plane_offset(&model)?;
    let tip = std::array::from_fn(|i| basis.origin[i] + basis.normal[i] * distance);
    let next = std::array::from_fn(|i| tip[i] + basis.normal[i]);
    let project = |p| {
        native_viewport::interface_world_point(world, &model.owner.document_id, p)
            .ok()
            .flatten()
            .map(Vec2::from_array)
    };
    let tip = project(tip)?;
    let delta = project(next)? - tip;
    let pixels = delta.length();
    let (direction, pixels) = if pixels < 0.15 {
        (Vec2::new(0., -1.), 4.)
    } else {
        (delta / pixels, pixels)
    };
    Some((tip, direction, pixels, distance))
}
pub(super) fn anchor(world: &World) -> Option<[f32; 2]> {
    let editor = world.get_resource::<NativeFeature>()?.editor.as_ref()?;
    let (tip, _, _, _) = projection(world, editor)?;
    Some(tip.to_array())
}
pub(crate) fn pointer(
    world: &mut World,
    services: &NativeServices,
    owner: &DocumentContext,
    event: Pointer,
    point: Option<[f32; 2]>,
) -> Result<bool, String> {
    let mut state = world.remove_resource::<NativeFeature>().unwrap_or_default();
    let result = (|| {
        let Some(editor) = state.editor.as_mut() else {
            return Ok(false);
        };
        if editor.form.kind() != SolidFormKind::OffsetPlane {
            return Ok(false);
        }
        if matches!(event, Pointer::Cancel) {
            return Ok(editor.offset_drag.take().is_some());
        }
        if editor.form.is_busy() {
            editor.offset_drag = None;
            return Ok(false);
        }
        let Some(point) = point.map(Vec2::from_array).filter(|p| p.is_finite()) else {
            return Ok(false);
        };
        with_receipt(&services.bridge, &services.engine, owner, |receipt| {
            check_revision(editor, &receipt)?;
            if matches!(event, Pointer::Press) {
                let Some((tip, direction, pixels_per_mm, distance)) = projection(world, editor)
                else {
                    return Ok(false);
                };
                if point.distance(tip) > 12. {
                    return Ok(false);
                }
                editor.offset_drag = Some(Drag {
                    start: point,
                    direction,
                    pixels_per_mm,
                    distance,
                });
                return Ok(true);
            }
            let Some(drag) = editor.offset_drag else {
                return Ok(false);
            };
            let distance = drag.distance
                + f64::from((point - drag.start).dot(drag.direction) / drag.pixels_per_mm);
            // As in the original control, 0.01 mm avoids noisy pointer decimals.
            editor.form.drag_plane_offset(
                (distance * 100.).round() / 100.,
                &editor.snapshot.model(None),
            )?;
            update_preview(editor, world)?;
            if matches!(event, Pointer::Release) {
                editor.offset_drag = None;
            }
            Ok(true)
        })
    })();
    world.insert_resource(state);
    result
}
