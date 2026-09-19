import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from '../../engine';
import { importPrivatePost, openPrivatePostFolder, privatePosts, type PrivatePostCatalog } from '../../cam/posts';
import { useTranslation } from '../../i18n';

export function CamPostSettings() {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<PrivatePostCatalog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = isTauriRuntime();
  useEffect(() => {
    let cancelled = false;
    privatePosts().then(value => { if (!cancelled) setCatalog(value); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const button = 'rounded border border-edge px-2.5 py-1.5 text-[11px] text-ink hover:bg-edge disabled:opacity-40';
  return <div className="mt-3 space-y-2 rounded-lg border border-edge bg-header/55 p-3" data-testid="cam-post-settings" aria-busy={busy}>
    <div className="flex items-center gap-2"><FolderOpen size={15} className="text-mute" />
      <h4 className="text-xs font-semibold">{t('cam.post.customPosts')}</h4>
      {busy && <LoaderCircle size={14} className="animate-spin text-mute" aria-label={t('cam.post.workingOnPostStorage')} />}
    </div>
    <p className="text-[10px] leading-relaxed text-mute">{t('cam.post.customPostsHelp')}</p>
    {available ? <>
      {catalog && <p className="break-all select-text font-mono text-[10px]" data-testid="cam-post-location">{catalog.directory}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void run(async () => {
          const source = await open({ multiple: false, title: t('cam.post.importPrivatePost'), filters: [{ name: t('cam.post.filterName'), extensions: ['nbpost', 'cps'] }] });
          if (typeof source === 'string') setCatalog(await importPrivatePost(source));
        })}>{t('cam.post.importPost')}</button>
        <button className={button} disabled={busy} onClick={() => void run(openPrivatePostFolder)}>{t('cam.post.openPostFolder')}</button>
        <button className={button} disabled={busy} onClick={() => void run(async () => setCatalog(await privatePosts()))}>{t('cam.post.refreshPosts')}</button>
      </div>
      {catalog && <ul className="max-h-40 space-y-2 overflow-y-auto text-[10px]">{catalog.entries.map(entry => <li key={entry.file_name}>
        <div className="flex justify-between gap-2"><span className="break-all">{entry.file_name}</span><span className="shrink-0 text-mute">{entry.kind === 'native_profile' ? t('cam.post.kindProfile') : entry.kind === 'invalid' ? t('cam.post.kindNeedsAttention') : t('cam.post.kindReferenceOnly')}</span></div>
        <p className="text-mute">{entry.message}</p>
      </li>)}</ul>}
    </> : <p className="text-[10px] text-mute">{t('cam.post.desktopOnly')}</p>}
    <p className="text-[10px] leading-relaxed text-mute">{t('cam.post.nativeProfilesHelp')}</p>
    {error && <p role="alert" className="text-[10px] text-warn">{error}</p>}
  </div>;
}
