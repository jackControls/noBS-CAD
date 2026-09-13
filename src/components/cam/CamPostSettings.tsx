import { useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from '../../engine';
import { importPrivatePost, openPrivatePostFolder, privatePosts, type PrivatePostCatalog } from '../../cam/posts';

export function CamPostSettings() {
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
      <h4 className="text-xs font-semibold">Custom posts</h4>
      {busy && <LoaderCircle size={14} className="animate-spin text-mute" aria-label="Working on post storage" />}
    </div>
    <p className="text-[10px] leading-relaxed text-mute">Private to this OS user, outside the app and project. Independent of the central tool library folder, so changing libraries or installing a new build does not move your posts.</p>
    {available ? <>
      {catalog && <p className="break-all select-text font-mono text-[10px]" data-testid="cam-post-location">{catalog.directory}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void run(async () => {
          const source = await open({ multiple: false, title: 'Import private post', filters: [{ name: 'Post profiles and references', extensions: ['nbpost', 'cps'] }] });
          if (typeof source === 'string') setCatalog(await importPrivatePost(source));
        })}>Import post…</button>
        <button className={button} disabled={busy} onClick={() => void run(openPrivatePostFolder)}>Open post folder</button>
        <button className={button} disabled={busy} onClick={() => void run(async () => setCatalog(await privatePosts()))}>Refresh posts</button>
      </div>
      {catalog && <ul className="max-h-40 space-y-2 overflow-y-auto text-[10px]">{catalog.entries.map(entry => <li key={entry.file_name}>
        <div className="flex justify-between gap-2"><span className="break-all">{entry.file_name}</span><span className="shrink-0 text-mute">{entry.kind === 'native_profile' ? 'Profile' : entry.kind === 'invalid' ? 'Needs attention' : 'Reference only'}</span></div>
        <p className="text-mute">{entry.message}</p>
      </li>)}</ul>}
    </> : <p className="text-[10px] text-mute">Private post storage is available in the desktop app.</p>}
    <p className="text-[10px] leading-relaxed text-mute">Native .nbpost profiles select a built-in renderer with your machine settings. Imported scripts are kept byte-for-byte, including rights notices, for reference only; they are not executable post plug-ins. Existing files are never overwritten on import.</p>
    {error && <p role="alert" className="text-[10px] text-warn">{error}</p>}
  </div>;
}
