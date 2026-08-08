import { useEffect, useState, type FormEvent } from 'react';
import { Crosshair, LoaderCircle, X } from 'lucide-react';
import { cancelPlanePick, confirmPlanarFaceSketch } from '../engine/controller';
import type { FaceSketchOrigin } from '../engine/types';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';

export function SketchPlaneOriginDialog() {
  const { t } = useTranslation();
  const faceId = useAppStore((state) => state.sketchPlaneFace);
  const [origin, setOrigin] = useState<FaceSketchOrigin>('face_center');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOrigin('face_center');
  }, [faceId]);

  if (faceId === null) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    void confirmPlanarFaceSketch(origin).finally(() => setBusy(false));
  };

  return (
    <div
      data-native-viewport-dim="0.35"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35"
    >
      <form
        data-testid="sketch-plane-origin-dialog"
        onSubmit={submit}
        className="feature-dialog relative w-[360px] overflow-hidden border border-edge bg-panel"
      >
        <header className="feature-dialog-header flex h-10 items-center gap-2 border-b border-edge px-3">
          <Crosshair size={15} className="text-accent" />
          <span className="flex-1 text-xs font-semibold text-ink">
            {t('sketchOrigin.title')}
          </span>
          <button
            type="button"
            title={t('sketchOrigin.cancel')}
            disabled={busy}
            onClick={cancelPlanePick}
            className="rounded p-1 text-mute hover:bg-edge hover:text-ink disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </header>
        <div className="space-y-3 p-4">
          <p className="text-xs leading-5 text-mute">
            {t('sketchOrigin.description').replace('{face}', String(faceId))}
          </p>
          <label className="flex cursor-pointer items-start gap-2 rounded border border-edge bg-header p-2.5 hover:border-accent/60">
            <input
              type="radio"
              name="sketch-origin"
              checked={origin === 'face_center'}
              onChange={() => setOrigin('face_center')}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block text-xs font-medium text-ink">
                {t('sketchOrigin.faceCenter')}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-mute">
                {t('sketchOrigin.faceCenterHint')}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded border border-edge bg-header p-2.5 hover:border-accent/60">
            <input
              type="radio"
              name="sketch-origin"
              checked={origin === 'global_origin_projection'}
              onChange={() => setOrigin('global_origin_projection')}
              className="mt-0.5 accent-accent"
            />
            <span>
              <span className="block text-xs font-medium text-ink">
                {t('sketchOrigin.globalProjection')}
              </span>
              <span className="mt-0.5 block text-[10px] leading-4 text-mute">
                {t('sketchOrigin.globalProjectionHint')}
              </span>
            </span>
          </label>
        </div>
        <footer className="flex h-11 items-center justify-end gap-2 border-t border-edge bg-header px-3">
          <button
            type="button"
            disabled={busy}
            onClick={cancelPlanePick}
            className="h-7 rounded border border-edge px-3 text-xs text-ink hover:bg-edge disabled:opacity-40"
          >
            {t('sketchOrigin.cancel')}
          </button>
          <button
            data-testid="sketch-plane-origin-ok"
            type="submit"
            disabled={busy}
            className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy && <LoaderCircle size={12} className="animate-spin" />}
            {t('sketchOrigin.ok')}
          </button>
        </footer>
      </form>
    </div>
  );
}
