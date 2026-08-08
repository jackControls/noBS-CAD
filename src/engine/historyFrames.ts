import type {
  DatumPlaneDefinitionDto,
  DatumPlaneSourceDto,
  SolidUpdateDto,
} from './types';

interface DatumHistoryEngine {
  datumPlaneDefinitions(): Promise<DatumPlaneDefinitionDto[]>;
  setRollback(rollbackIndex: number): Promise<SolidUpdateDto>;
}

const NON_TOPOLOGY_FEATURES = new Set(['sketch', 'construction_plane']);

function sourceReadsSolidTopology(source: DatumPlaneSourceDto): boolean {
  if (source.type === 'at_angle') return true;
  if (source.type === 'offset') return source.reference.type === 'planar_face';
  return source.first.type === 'planar_face' || source.second.type === 'planar_face';
}

/**
 * Repair and normalize creation-time datum frames while opening a project.
 *
 * A saved model can predate the history-stage fence and therefore contain a
 * datum basis that was accidentally re-resolved against downstream boolean
 * topology. Replaying each affected datum's history landmark reconstructs its
 * basis against the exact upstream OCCT scene. Returning to the saved marker
 * then keeps that frame frozen while later solid features replay.
 */
export async function restoreLoadedDatumHistoryFrames(
  engine: DatumHistoryEngine,
  initial: SolidUpdateDto,
): Promise<SolidUpdateDto> {
  const finalRollback = initial.document.rollback_index;
  if (finalRollback === 0) return initial;

  const planes = await engine.datumPlaneDefinitions();
  const features = initial.document.features;
  const positions = new Map(
    features.map((feature, index) => [feature.id, index] as const),
  );
  const landmarks = [
    ...new Set(
      planes.flatMap((plane) => {
        if (!sourceReadsSolidTopology(plane.source)) return [];
        const position = positions.get(plane.feature_id);
        if (position === undefined || position >= finalRollback) return [];
        const landmark = position + 1;
        const hasDownstreamTopology = features
          .slice(landmark, finalRollback)
          .some(
            (feature) =>
              !feature.suppressed && !NON_TOPOLOGY_FEATURES.has(feature.kind),
          );
        return hasDownstreamTopology ? [landmark] : [];
      }),
    ),
  ].sort((left, right) => left - right);

  if (landmarks.length === 0) return initial;
  let update = initial;
  for (const landmark of landmarks) {
    update = await engine.setRollback(landmark);
  }
  if (update.document.rollback_index !== finalRollback) {
    update = await engine.setRollback(finalRollback);
  }
  return update;
}
