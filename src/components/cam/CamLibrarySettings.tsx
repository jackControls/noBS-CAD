import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { CamPostSettings } from './CamPostSettings';
import { centralLibraryAvailable, centralLibraryLocation, inspectCentralLibraryLocation,
  setCentralLibraryLocation, type CentralLibraryLocation } from '../../cam/library';
import { useTranslation } from '../../i18n';

/** This preference lives on the device. Choosing a folder never updates
 * project tool snapshots or silently merges/copies library collections. */
export function CamLibrarySettings() {
  const { t } = useTranslation();
  const available = centralLibraryAvailable();
  const [location, setLocation] = useState<CentralLibraryLocation | null>(null);
  const [pending, setPending] = useState<{ directory: string | null; location: CentralLibraryLocation } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    setBusy(true);
    centralLibraryLocation().then(value => { if (!cancelled) setLocation(value); })
      .catch(cause => { if (!cancelled) setError(String(cause)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [available]);
  const choose = async (useDefault = false) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const directory = useDefault ? null : await open({ directory: true, multiple: false,
        title: t('cam.library.folderDialogTitle'), defaultPath: location?.directory });
      if (!useDefault && !directory) return;
      if (Array.isArray(directory)) throw new Error(t('cam.library.errorChooseOneFolder'));
      setPending({ directory, location: await inspectCentralLibraryLocation(directory) });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const apply = async (action: 'use_existing' | 'copy_current') => {
    if (!pending) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const value = await setCentralLibraryLocation(pending.directory, action);
      setLocation(value); setPending(null);
      setNotice(action === 'copy_current' ? t('cam.library.noticeCopied')
        : t('cam.library.noticeUpdated'));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const button = 'rounded border border-edge px-2.5 py-1.5 text-[11px] text-ink hover:bg-edge disabled:opacity-40';
  return <section className="mt-4 border-t border-edge pt-4" data-testid="cam-library-settings" aria-busy={busy}>
    <h3 className="mb-2 text-[10px] font-semibold tracking-widest text-mute">{t('cam.library.sectionCam')}</h3>
    <div className="space-y-2 rounded-lg border border-edge bg-header/55 p-3">
      <div className="flex items-center gap-2"><FolderOpen size={15} className="text-mute" />
        <h4 className="text-xs font-semibold">{t('cam.library.title')}</h4>
        {busy && <LoaderCircle size={14} className="animate-spin text-mute" aria-label={t('cam.library.workingOnStorage')} />}
      </div>
      <p className="text-[10px] leading-relaxed text-mute">{t('cam.library.help')}</p>
      {!available ? <p className="text-[10px] text-mute">{t('cam.library.desktopOnly')}</p> : <>
        {location && <div>
          <p className="text-[10px] text-mute">{location.is_default ? t('cam.library.defaultLocation') : t('cam.library.customLocation')} · {location.tool_count} {location.tool_count === 1 ? t('cam.library.toolSingular') : t('cam.library.toolPlural')}</p>
          <p className="mt-1 break-all select-text font-mono text-[10px] text-ink" data-testid="cam-library-location">{location.path}</p>
        </div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void choose()}>{t('cam.library.chooseFolder')}</button>
          <button type="button" className={button} disabled={busy || location?.is_default} onClick={() => void choose(true)}>{t('cam.library.useDefaultLocation')}</button>
        </div>
        {pending && <div className="space-y-2 rounded border border-edge p-2" data-testid="cam-library-location-review">
          <p className="break-all font-mono text-[10px]">{pending.location.path}</p>
          <p className="text-[10px] leading-relaxed text-mute">{pending.location.exists
            ? t('cam.library.existingLibraryInfo').replace('{count}', String(pending.location.tool_count))
            : t('cam.library.noLibraryInfo')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy} onClick={() => void apply('use_existing')}>{pending.location.exists ? t('cam.library.useThisLibrary') : t('cam.library.useEmptyFolder')}</button>
            {!pending.location.exists && <button type="button" className={button} disabled={busy || !location} onClick={() => void apply('copy_current')}>{t('cam.library.copyCurrentHere')}</button>}
            <button type="button" className={button} disabled={busy} onClick={() => setPending(null)}>{t('cam.library.cancel')}</button>
          </div>
        </div>}
        <p className="text-[10px] leading-relaxed text-mute">{t('cam.library.reconnectHelp')}</p>
      </>}
      {error && <p role="alert" className="break-words text-[10px] text-warn">{error}</p>}
      {notice && <p role="status" className="text-[10px] text-mute">{notice}</p>}
    </div>
    <CamPostSettings />
  </section>;
}
