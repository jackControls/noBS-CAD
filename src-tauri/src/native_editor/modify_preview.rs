//! Modification previews use the engine's exact curve construction. They do
//! not mutate a sketch, add history entries, or invent solver results.
use super::*;
use crate::native_viewport::ViewportLineLayer;
use nbcad_sketch::{FilletPreviewDto, OffsetPreviewDto, PreviewCurve, TrimPreviewDto};
use serde::de::DeserializeOwned;

fn query<T: DeserializeOwned>(
    engine: &AppState,
    method: &str,
    arguments: &Value,
) -> Result<T, String> {
    let result: Value = serde_json::from_str(&engine.engine_call(method, &arguments.to_string()))
        .map_err(|e| e.to_string())?;
    if result["ok"] != true {
        return Err(result["error"]
            .as_str()
            .unwrap_or("Cannot preview this operation")
            .into());
    }
    serde_json::from_value(result["value"].clone()).map_err(|e| e.to_string())
}

fn curve_points(curve: PreviewCurve) -> Vec<[SketchPoint; 2]> {
    let (center, radius, start, sweep) = match curve {
        PreviewCurve::Line { a, b } => return vec![[a, b]],
        PreviewCurve::Circle { center, radius } => (center, radius, 0., std::f64::consts::TAU),
        PreviewCurve::Arc {
            center,
            radius,
            start_angle,
            end_angle,
        } => {
            let sweep = (end_angle - start_angle).rem_euclid(std::f64::consts::TAU);
            (
                center,
                radius,
                start_angle,
                if sweep < 1e-12 {
                    std::f64::consts::TAU
                } else {
                    sweep
                },
            )
        }
    };
    let count = (sweep / std::f64::consts::TAU * 192.)
        .ceil()
        .clamp(12., 192.) as usize;
    let at = |i: usize| {
        let a = start + sweep * i as f64 / count as f64;
        center + SketchPoint::new(a.cos(), a.sin()) * radius
    };
    (0..count).map(|i| [at(i), at(i + 1)]).collect()
}

fn layer(
    basis: PlaneBasis,
    curves: impl IntoIterator<Item = PreviewCurve>,
    color: [f32; 4],
) -> Result<ViewportLineLayer, String> {
    let segments: Vec<_> = curves
        .into_iter()
        .flat_map(curve_points)
        .flatten()
        .flat_map(|p| basis.to_3d([p.x, p.y]).map(|v| v as f32))
        .collect();
    if segments.iter().any(|v| !v.is_finite()) {
        return Err("Preview is outside the renderer's coordinate range".into());
    }
    Ok(ViewportLineLayer {
        color,
        width: 2.,
        segments,
        ..default()
    })
}

fn color() -> [f32; 4] {
    let p = ViewportPalette::default().preview;
    [p[0], p[1], p[2], 1.]
}

pub(super) fn form(
    engine: &AppState,
    basis: PlaneBasis,
    command: &Prepared,
) -> Result<Option<ViewportPreview>, String> {
    let curve = match command.operation {
        "sketch_fillet" => {
            let p: FilletPreviewDto = query(engine, "fillet_preview", &command.arguments)?;
            let (start_angle, end_angle) = if p.ccw {
                (p.start_angle, p.end_angle)
            } else {
                (p.end_angle, p.start_angle)
            };
            PreviewCurve::Arc {
                center: p.center,
                radius: p.radius,
                start_angle,
                end_angle,
            }
        }
        "sketch_chamfer" => query(engine, "chamfer_preview", &command.arguments)?,
        "sketch_offset" => {
            query::<OffsetPreviewDto>(engine, "offset_preview", &command.arguments)?.curve
        }
        _ => return Ok(None),
    };
    Ok(Some(ViewportPreview {
        lines: vec![layer(basis, [curve], color())?],
        ..default()
    }))
}

pub(super) fn refresh_form(
    world: &mut World,
    engine: &AppState,
    owner: &DocumentContext,
    editor: &mut Editor,
    sketch: &SketchDto,
) -> Result<(), String> {
    let Some(draft) = &editor.interaction.form else {
        return Ok(());
    };
    if !matches!(
        draft.kind,
        FormKind::Fillet | FormKind::Chamfer | FormKind::Offset
    ) {
        return Ok(());
    }
    // Incomplete picks and partially typed expressions are valid editing states.
    let preview = match draft.request(
        sketch,
        &editor.interaction.selection,
        engine.document_snapshot().settings.units,
    ) {
        Ok(command) => match form(engine, sketch.basis, &command) {
            Ok(preview) => preview.unwrap_or_default(),
            Err(error) => {
                editor.error = error;
                ViewportPreview::default()
            }
        },
        Err(_) => ViewportPreview::default(),
    };
    native_viewport::apply_interface_preview(world, &owner.document_id, preview)
}

pub(super) fn trim(
    engine: &AppState,
    sketch: &SketchDto,
    id: nbcad_sketch::EntityId,
    point: SketchPoint,
) -> Result<ViewportPreview, String> {
    let p: TrimPreviewDto = query(engine, "trim_preview", &json!({"entity":id,"click":point}))?;
    Ok(ViewportPreview {
        lines: vec![
            layer(sketch.basis, p.kept, color())?,
            layer(sketch.basis, [p.removed], [0.88, 0.33, 0.33, 1.])?,
        ],
        ..default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrapped_arc_uses_its_short_sweep_and_closes_circles() {
        let lines = curve_points(PreviewCurve::Arc {
            center: SketchPoint::ZERO,
            radius: 10.,
            start_angle: 350_f64.to_radians(),
            end_angle: 10_f64.to_radians(),
        });
        assert!(lines.iter().flatten().all(|p| p.x > 9.8));
        let lines = curve_points(PreviewCurve::Circle {
            center: SketchPoint::ZERO,
            radius: 10.,
        });
        assert!(lines[0][0].distance(lines.last().unwrap()[1]) < 1e-10);
    }
}
