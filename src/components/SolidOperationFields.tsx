import { useEffect } from 'react';
import type { ExtrudeOperation } from '../engine/types';
import { useTranslation } from '../i18n';
import {
  useAppStore,
  type ModelingPickTarget,
} from '../store/appStore';
import { ViewportSelectionField } from './ViewportSelectionField';

const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

interface Props {
  operation: ExtrudeOperation;
  setOperation: (operation: ExtrudeOperation) => void;
  targetBodies: number[];
  setTargetBodies: (ids: number[]) => void;
  pickTarget: Extract<
    ModelingPickTarget,
    | 'extrude_targets'
    | 'revolve_targets'
    | 'sweep_targets'
    | 'loft_targets'
    | 'rib_targets'
  >;
}

/** Shared boolean-operation controls for all sketch-driven solid tools. */
export function SolidOperationFields({
  operation,
  setOperation,
  targetBodies,
  setTargetBodies,
  pickTarget,
}: Props) {
  const { t } = useTranslation();
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const selectedBodies = useAppStore((state) => state.selectedBodies);
  const modelingPickTarget = useAppStore((state) => state.modelingPickTarget);
  const setModelingPickTarget = useAppStore((state) => state.setModelingPickTarget);
  const replaceSelectedBodies = useAppStore((state) => state.replaceSelectedBodies);
  const targetSelectionTestId = `${pickTarget.replace(/_/g, '-')}-selection`;

  useEffect(() => {
    if (modelingPickTarget !== pickTarget) return;
    const valid = selectedBodies.filter((id) => bodies.some((body) => body.id === id));
    if (valid.join(',') !== targetBodies.join(',')) setTargetBodies(valid);
  }, [bodies, modelingPickTarget, pickTarget, selectedBodies, setTargetBodies, targetBodies]);

  const activateTargets = () => {
    replaceSelectedBodies(targetBodies);
    setModelingPickTarget(pickTarget);
  };

  return (
    <>
      <label>
        <span className={LABEL_CLASS}>{t('extrude.operation')}</span>
        <select
          data-testid="solid-operation"
          value={operation}
          onChange={(event) => {
            const next = event.target.value as ExtrudeOperation;
            setOperation(next);
            if (next === 'new_body') {
              if (modelingPickTarget === pickTarget) setModelingPickTarget(null);
            } else {
              activateTargets();
            }
          }}
          className={INPUT_CLASS}
        >
          <option value="new_body">{t('extrude.newBody')}</option>
          <option value="join">{t('extrude.join')}</option>
          <option value="cut">{t('extrude.cut')}</option>
          <option value="intersect">{t('extrude.intersect')}</option>
        </select>
      </label>

      {operation !== 'new_body' && (
        <ViewportSelectionField
          testId={targetSelectionTestId}
          label={t('extrude.targetBodies')}
          status={targetBodies.length > 0
            ? `${targetBodies.length} ${targetBodies.length === 1 ? 'body' : 'bodies'} selected`
            : bodies.length === 0
              ? t('extrude.noTargetBodies')
              : 'Click target bodies in the viewport'}
          hint="Use Shift/Ctrl/Cmd or continue clicking to select more than one body."
          active={modelingPickTarget === pickTarget}
          hasSelection={targetBodies.length > 0}
          onActivate={activateTargets}
          onClear={() => {
            setTargetBodies([]);
            replaceSelectedBodies([]);
            setModelingPickTarget(pickTarget);
          }}
        />
      )}
    </>
  );
}
