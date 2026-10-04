//! Retained lines and cutter poses from the shared physical simulation timeline.
use super::*;
use crate::native_viewport::{ViewportCamPathProgress, ViewportLinePattern, ViewportLinePlayback};
use nbcad_cam::{CamSimulationStepDto, CamSimulationStepKind};

pub(super) fn paths(
    result: &CamSimulationResultDto,
    id: u64,
    first_command: usize,
) -> Result<Vec<ViewportLineLayer>, String> {
    let layer = |color, pattern| ViewportLineLayer {
        color,
        width: 2.,
        pattern,
        playback: Some(ViewportLinePlayback {
            path_id: id,
            completed_color: [0.18, 0.48, 1., 1.],
            segment_times: Vec::new(),
        }),
        ..default()
    };
    let mut rapid = layer([0.94, 0.67, 0.29, 0.8], ViewportLinePattern::Dotted);
    let mut cutting = layer([0.34, 0.84, 0.64, 0.95], ViewportLinePattern::Solid);
    let mut count = 0;
    for step in result
        .steps
        .iter()
        .filter(|s| s.command_index >= first_command)
    {
        if step.from.is_none()
            || step.to.is_none()
            || matches!(
                step.kind,
                CamSimulationStepKind::Dwell | CamSimulationStepKind::Position
            )
        {
            continue;
        }
        let segments = if step.kind == CamSimulationStepKind::Circular {
            32
        } else {
            1
        };
        count += segments;
        if count > 65_000 {
            return Err(
                "Simulation path exceeds 65,000 display segments; use a smaller NC program or select one CAM operation".into(),
            );
        }
        let target = if step.kind == CamSimulationStepKind::Rapid {
            &mut rapid
        } else {
            &mut cutting
        };
        let start = step.cumulative_seconds - step.duration_seconds;
        let mut from = step
            .point_at_fraction(0.)
            .map_err(|e| e.to_string())?
            .unwrap();
        for segment in 1..=segments {
            let to = step
                .point_at_fraction(segment as f64 / segments as f64)
                .map_err(|e| e.to_string())?
                .unwrap();
            target
                .segments
                .extend(geometry::model_point(from, result.wcs));
            target
                .segments
                .extend(geometry::model_point(to, result.wcs));
            target.playback.as_mut().unwrap().segment_times.extend([
                start + step.duration_seconds * (segment - 1) as f64 / segments as f64,
                start + step.duration_seconds * segment as f64 / segments as f64,
            ]);
            from = to;
        }
    }
    Ok([rapid, cutting]
        .into_iter()
        .filter(|layer| !layer.segments.is_empty())
        .collect())
}

pub(super) fn step_at(result: &CamSimulationResultDto, time: f64) -> Option<&CamSimulationStepDto> {
    let index = result
        .steps
        .partition_point(|step| step.cumulative_seconds <= time + 1e-9);
    result
        .steps
        .get(index.min(result.steps.len().saturating_sub(1)))
}

/// Match the existing desktop's previous/next physical move controls, bounded
/// to the selected operation. Several zero-duration commands can share a time.
pub(super) fn adjacent_move(
    result: &CamSimulationResultDto,
    time: f64,
    forward: bool,
    start: f64,
) -> f64 {
    if forward {
        let next = result
            .steps
            .partition_point(|step| step.cumulative_seconds <= time + 1e-6);
        result
            .steps
            .get(next)
            .map_or(result.estimated_seconds, |step| {
                step.cumulative_seconds.min(result.estimated_seconds)
            })
    } else {
        let previous = result
            .steps
            .partition_point(|step| step.cumulative_seconds < time - 1e-6);
        previous.checked_sub(1).map_or(start, |index| {
            result.steps[index].cumulative_seconds.max(start)
        })
    }
}

pub(super) fn pose(
    document: &CamDocumentDto,
    result: &CamSimulationResultDto,
    id: u64,
    time: f64,
) -> Result<(Option<ViewportCamTool>, Option<ViewportCamPathProgress>), String> {
    let Some(step) = step_at(result, time) else {
        return Ok((None, None));
    };
    let start = step.cumulative_seconds - step.duration_seconds;
    let fraction = if step.duration_seconds > 1e-9 {
        ((time - start) / step.duration_seconds).clamp(0., 1.)
    } else {
        1.
    };
    let Some(point) = step
        .point_at_fraction(fraction)
        .map_err(|e| e.to_string())?
    else {
        return Ok((None, None));
    };
    let tip = geometry::model_point(point, result.wcs);
    let tool = step
        .tool_id
        .and_then(|id| document.tool(id))
        .map(|tool| ViewportCamTool {
            tip,
            axis: result.wcs.z_axis.map(|v| v as f32),
            geometry: tool.into(),
        });
    Ok((
        tool,
        Some(ViewportCamPathProgress {
            path_id: id,
            time_seconds: time,
            position: tip,
        }),
    ))
}
