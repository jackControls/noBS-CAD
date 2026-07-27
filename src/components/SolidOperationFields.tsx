import type { ExtrudeOperation } from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';

const INPUT_CLASS =
  'h-7 w-full rounded border border-edge bg-header px-2 text-xs text-ink outline-none focus:border-accent';
const LABEL_CLASS = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-mute';

interface Props {
  operation: ExtrudeOperation;
  setOperation: (operation: ExtrudeOperation) => void;
  targetBodies: number[];
  setTargetBodies: (ids: number[]) => void;
}

/** Shared boolean-operation controls for all sketch-driven solid tools. */
export function SolidOperationFields({
  operation,
  setOperation,
  targetBodies,
  setTargetBodies,
}: Props) {
  const { t } = useTranslation();
  const bodies = useAppStore((state) => state.solidScene.bodies);
  const toggleBody = (id: number) => {
    setTargetBodies(
      targetBodies.includes(id)
        ? targetBodies.filter((candidate) => candidate !== id)
        : [...targetBodies, id],
    );
  };

  return (
    <>
      <label>
        <span className={LABEL_CLASS}>{t('extrude.operation')}</span>
        <select
          data-testid="solid-operation"
          value={operation}
          onChange={(event) => setOperation(event.target.value as ExtrudeOperation)}
          className={INPUT_CLASS}
        >
          <option value="new_body">{t('extrude.newBody')}</option>
          <option value="join">{t('extrude.join')}</option>
          <option value="cut">{t('extrude.cut')}</option>
          <option value="intersect">{t('extrude.intersect')}</option>
        </select>
      </label>

      {operation !== 'new_body' && (
        <fieldset>
          <legend className={LABEL_CLASS}>{t('extrude.targetBodies')}</legend>
          <div className="space-y-1 rounded border border-edge bg-header p-2">
            {bodies.length === 0 ? (
              <p className="text-xs text-mute">{t('extrude.noTargetBodies')}</p>
            ) : (
              bodies.map((body) => (
                <label
                  key={body.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-ink hover:bg-edge"
                >
                  <input
                    type="checkbox"
                    checked={targetBodies.includes(body.id)}
                    onChange={() => toggleBody(body.id)}
                    className="accent-accent"
                  />
                  {body.name}
                </label>
              ))
            )}
          </div>
        </fieldset>
      )}
    </>
  );
}
