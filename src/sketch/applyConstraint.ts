/**
 * Constraint application from the CONSTRAIN panel (M1b): validate the
 * current selection for the chosen constraint, call the engine, and surface
 * invalid combos / D4.2 over-constraint conflicts in a modal dialog.
 */
import { EngineError, getEngine } from '../engine';
import type { ConstraintPayload, EntityDto } from '../engine/types';
import { translate } from '../i18n';
import { useAppStore } from '../store/appStore';

type Kind = EntityDto['kind'];

interface ConstraintRule {
  count: number | number[] | { min: number };
  kinds?: (kinds: Kind[]) => boolean;
  build: (ids: number[]) => ConstraintPayload[];
  fix?: boolean;
}

const CURVE_KINDS: ReadonlySet<Kind> = new Set(['circle', 'arc']);
const ALL_ENTITY_KINDS: readonly Kind[] = ['point', 'line', 'arc', 'circle', 'spline'];

const isCurve = (kind: Kind): boolean => CURVE_KINDS.has(kind);

/** Client-side selection requirements per constraint icon id. */
const RULES = {
  hv: {
    count: { min: 1 },
    kinds: (ks) =>
      ks.every((kind) => kind === 'line') ||
      (ks.length === 2 && ks.every((kind) => kind === 'point')),
    // Apply H to near-horizontal lines and V to near-vertical ones.
    build: () => [],
  },
  coincident: {
    count: 2,
    kinds: ([a, b]) =>
      (a === 'point' && ['point', 'line', 'circle', 'arc'].includes(b)) ||
      (b === 'point' && ['line', 'circle', 'arc'].includes(a)) ||
      (isCurve(a) && isCurve(b)),
    build: ([a, b]) => [{ type: 'coincident', a, b }],
  },
  tangent: {
    count: 2,
    kinds: ([a, b]) =>
      (a === 'line' && isCurve(b)) ||
      (b === 'line' && isCurve(a)) ||
      (isCurve(a) && isCurve(b)),
    build: ([a, b]) => [{ type: 'tangent', a, b }],
  },
  equal: {
    count: 2,
    kinds: ([a, b]) =>
      (a === 'line' && b === 'line') || (isCurve(a) && isCurve(b)),
    build: ([a, b]) => [{ type: 'equal', a, b }],
  },
  parallel: {
    count: 2,
    kinds: (ks) => ks.every((k) => k === 'line'),
    build: ([a, b]) => [{ type: 'parallel', a, b }],
  },
  perpendicular: {
    count: 2,
    kinds: (ks) => ks.every((k) => k === 'line'),
    build: ([a, b]) => [{ type: 'perpendicular', a, b }],
  },
  fixUnfix: { count: { min: 1 }, fix: true, build: () => [] },
  midpoint: {
    count: 2,
    kinds: (ks) => ks.filter((kind) => kind === 'point').length === 1 && ks.filter((kind) => kind === 'line').length === 1,
    build: ([a, b]) => [{ type: 'midpoint', a, b }],
  },
  concentric: {
    count: 2,
    kinds: ([a, b]) => isCurve(a) && isCurve(b),
    build: ([a, b]) => [{ type: 'concentric', a, b }],
  },
  collinear: {
    count: 2,
    kinds: (ks) => ks.every((k) => k === 'line'),
    build: ([a, b]) => [{ type: 'collinear', a, b }],
  },
  symmetry: {
    count: 3,
    kinds: (ks) =>
      (ks.filter((kind) => kind === 'point').length === 2 &&
        ks.filter((kind) => kind === 'line').length === 1) ||
      ks.every((kind) => kind === 'line'),
    build: ([a, b, axis]) => [{ type: 'symmetry', a, b, axis }],
  },
} satisfies Record<string, ConstraintRule>;

export type ConstraintToolId = keyof typeof RULES;

function selectedEntityIds(): number[] {
  const state = useAppStore.getState();
  return [
    ...new Set([
      ...state.selectedEntities,
      ...(state.selectedEntity !== null && !state.selectedEntities.includes(state.selectedEntity)
        ? [state.selectedEntity]
        : []),
    ]),
  ];
}

function countIsValid(rule: ConstraintRule, count: number): boolean {
  return typeof rule.count === 'number'
    ? count === rule.count
    : Array.isArray(rule.count)
      ? rule.count.includes(count)
      : count >= rule.count.min;
}

function kindsAreValid(rule: ConstraintRule, kinds: Kind[]): boolean {
  return !rule.kinds || rule.kinds(kinds);
}

/** True when the command is one of the relations completed by exactly two picks. */
export function isTwoFeatureConstraint(iconId: string | null): iconId is ConstraintToolId {
  if (!iconId || !(iconId in RULES)) return false;
  return RULES[iconId as ConstraintToolId].count === 2;
}

function isPendingSelectionConstraint(iconId: string | null): iconId is ConstraintToolId {
  return iconId === 'hv' || isTwoFeatureConstraint(iconId);
}

/**
 * Validate an incomplete prefix without prematurely rejecting a useful first
 * pick (for example either the point or the line may be picked first for
 * Midpoint). The finite entity-kind set keeps this policy identical to the
 * final two-feature validation.
 */
function canCompleteTwoFeatureSelection(rule: ConstraintRule, kinds: Kind[]): boolean {
  if (rule.count !== 2 || kinds.length > 2) return false;
  if (kinds.length === 2) return kindsAreValid(rule, kinds);
  if (kinds.length === 0 || !rule.kinds) return true;
  return ALL_ENTITY_KINDS.some((candidate) => rule.kinds!([...kinds, candidate]));
}

function showSelectionError(iconId: string): void {
  useAppStore.getState().setConstraintDialog({
    titleKey: 'constraints.invalidTitle',
    message: translate(`constraints.needs.${iconId}`),
  });
}

/**
 * Consume a normal viewport click while a relation-selection command is
 * armed. The final valid pick applies the constraint automatically; no Shift
 * key is required because the command owns the temporary multi-selection.
 * H/V completes after one line or after a pair of points.
 */
export function selectForPendingConstraint(entityId: number): boolean {
  const state = useAppStore.getState();
  const iconId = state.pendingConstraintTool;
  const sketch = state.activeSketch;
  if (!sketch || !isPendingSelectionConstraint(iconId)) return false;

  const rule = RULES[iconId];
  const byId = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  const ids = selectedEntityIds().filter((id) => byId.has(id));
  if (ids.includes(entityId)) return true;

  const candidateIds = [...ids, entityId];
  const candidateKinds = candidateIds.map((id) => byId.get(id)?.kind).filter(
    (kind): kind is Kind => kind !== undefined,
  );
  if (iconId === 'hv') {
    const valid =
      (candidateIds.length === 1 && candidateKinds[0] === 'line') ||
      (candidateIds.length <= 2 && candidateKinds.every((kind) => kind === 'point'));
    if (candidateKinds.length !== candidateIds.length || !valid) {
      showSelectionError(iconId);
      return true;
    }
    state.setSelectedEntities(candidateIds);
    state.setSelectedEntity(entityId);
    state.setSelectedDimension(null);
    state.setSelectedConstraint(null);
    if (candidateKinds[0] === 'line' || candidateIds.length === 2) {
      state.setPendingConstraintTool(null);
      void applyConstraintById(iconId, { armIfIncomplete: false });
    }
    return true;
  }
  if (
    candidateKinds.length !== candidateIds.length ||
    !canCompleteTwoFeatureSelection(rule, candidateKinds)
  ) {
    showSelectionError(iconId);
    return true;
  }

  state.setSelectedEntities(candidateIds);
  state.setSelectedEntity(entityId);
  state.setSelectedDimension(null);
  state.setSelectedConstraint(null);

  if (candidateIds.length === 2) {
    // Retire the mode before the async solve so rapid extra clicks cannot
    // accidentally start a second relation with a stale selection.
    state.setPendingConstraintTool(null);
    void applyConstraintById(iconId, { armIfIncomplete: false });
  }
  return true;
}

export async function applyConstraintById(
  iconId: string | undefined,
  options: { armIfIncomplete?: boolean } = {},
): Promise<void> {
  const s = useAppStore.getState();
  const sketch = s.activeSketch;
  if (!sketch || !iconId) return;
  const rule = RULES[iconId as ConstraintToolId] as ConstraintRule | undefined;
  if (!rule) {
    s.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: translate('constraints.unsupported'),
    });
    return;
  }

  const ids = selectedEntityIds();
  const byId = new Map(sketch.entities.map((e) => [e.id, e]));
  const kinds = ids.map((id) => byId.get(id)?.kind).filter(
    (kind): kind is Kind => kind !== undefined,
  );

  const canArmTwoFeature =
    rule.count === 2 &&
    ids.length < 2 &&
    canCompleteTwoFeatureSelection(rule, kinds);
  const canArmPointAlignment =
    iconId === 'hv' &&
    (ids.length === 0 || (ids.length === 1 && kinds[0] === 'point'));
  if (
    (canArmTwoFeature || canArmPointAlignment) &&
    (options.armIfIncomplete ?? true) &&
    kinds.length === ids.length
  ) {
    // Constraint picking is a selection mode, not a sketch creation tool.
    // Preserve any valid first entity, but retire incompatible tool state.
    s.setActiveTool(null);
    const armed = useAppStore.getState();
    armed.setPendingConstraintTool(iconId);
    armed.setSelectedDimension(null);
    armed.setSelectedConstraint(null);
    return;
  }

  if (
    kinds.length !== ids.length ||
    !countIsValid(rule, ids.length) ||
    !kindsAreValid(rule, kinds)
  ) {
    showSelectionError(iconId);
    return;
  }

  s.setPendingConstraintTool(null);

  // Normalize order-sensitive engine payloads from entity kinds. For
  // all-line Symmetry, the most recently selected (primary) line is the
  // explicit axis; point/line combinations are fully inferable.
  let orderedIds = [...ids];
  if (iconId === 'midpoint') {
    const point = ids.find((id) => byId.get(id)?.kind === 'point');
    const line = ids.find((id) => byId.get(id)?.kind === 'line');
    if (point !== undefined && line !== undefined) orderedIds = [point, line];
  } else if (iconId === 'symmetry') {
    const points = ids.filter((id) => byId.get(id)?.kind === 'point');
    const lines = ids.filter((id) => byId.get(id)?.kind === 'line');
    if (points.length === 2 && lines.length === 1) {
      orderedIds = [points[0], points[1], lines[0]];
    } else if (lines.length === 3) {
      const axis =
        s.selectedEntity !== null && lines.includes(s.selectedEntity)
          ? s.selectedEntity
          : lines[lines.length - 1];
      orderedIds = [...lines.filter((id) => id !== axis), axis];
    }
  }

  const engine = await getEngine();
  const acceptSketch = (nextSketch: typeof sketch) => {
    const current = useAppStore.getState();
    current.setActiveSketch(nextSketch);
    current.setPendingConstraintTool(null);
    current.setSelectedEntities([]);
    current.setSelectedEntity(null);
  };
  try {
    if (rule.fix) {
      const result = await engine.toggleFixEntities(orderedIds);
      acceptSketch(result.sketch);
      return;
    }
    if (iconId === 'hv') {
      const constraints: ConstraintPayload[] = kinds.every((kind) => kind === 'point')
        ? (() => {
            const first = byId.get(orderedIds[0]);
            const second = byId.get(orderedIds[1]);
            if (!first || first.kind !== 'point' || !second || second.kind !== 'point') return [];
            const horizontal = Math.abs(second.position.x - first.position.x) >=
              Math.abs(second.position.y - first.position.y);
            return [{
              type: horizontal ? 'horizontal_points' : 'vertical_points',
              a: orderedIds[0],
              b: orderedIds[1],
            }];
          })()
        : orderedIds.flatMap((id) => {
            const entity = byId.get(id);
            if (!entity || entity.kind !== 'line') return [];
            const horizontal =
              Math.abs(entity.end.x - entity.start.x) >= Math.abs(entity.end.y - entity.start.y);
            return [{
              type: horizontal ? 'horizontal' : 'vertical',
              entity: id,
            } as const];
          });
      const result = await engine.addConstraints(constraints);
      acceptSketch(result.sketch);
      return;
    }
    const result = await engine.addConstraints(rule.build(orderedIds));
    acceptSketch(result.sketch);
  } catch (err) {
    if (err instanceof EngineError) {
      const report = err.data as
        | { rejected: { kind: string; entities: Array<{ label: string }> }; conflicts_with: Array<{ kind: string; entities: Array<{ label: string }> }> }
        | undefined;
      s.setConstraintDialog({
        titleKey: report ? 'constraints.conflictTitle' : 'constraints.invalidTitle',
        message: err.message,
        conflicts: report,
      });
    } else {
      s.setConstraintDialog({
        titleKey: 'constraints.invalidTitle',
        message: err instanceof Error ? err.message : 'Cannot apply constraint',
      });
    }
  }
}
