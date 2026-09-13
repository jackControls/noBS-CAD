import type { CamProgramDto, CamSimulationResultDto } from '../engine/types';

export function camPlaybackRange(program: CamProgramDto | null, timeline: CamSimulationResultDto | null, operationId: number | null) {
  const end = timeline?.estimated_seconds ?? 0;
  if (!timeline || operationId === null || !program) return { start: 0, end };
  const begin = program.commands.findIndex((command) => command.kind === 'section_start' && command.operation_id === operationId);
  if (begin < 0) return { start: end, end };
  const first = timeline.steps.find((step) => step.command_index > begin);
  return { start: first ? Math.max(0, first.cumulative_seconds - first.duration_seconds) : end, end };
}

export function adjacentCamMove(timeline: CamSimulationResultDto, time: number, direction: -1 | 1, start: number, end: number) {
  if (direction > 0) return Math.min(end, timeline.steps.find((step) => step.cumulative_seconds > time + 1e-6)?.cumulative_seconds ?? end);
  for (let index = timeline.steps.length - 1; index >= 0; index -= 1) {
    if (timeline.steps[index].cumulative_seconds < time - 1e-6) return Math.max(start, timeline.steps[index].cumulative_seconds);
  }
  return start;
}
