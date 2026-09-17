import { compensationGuidance, createMachineAssignment, MACHINE_PRESETS } from '../../cam/machines';
import type { CamMachineAssignmentDto, CamPostDialect } from '../../engine/types';
import { CAM_DIALOG_INPUT, CAM_DIALOG_LABEL, DialogSection } from './camFields';
import { useEffect, useState } from 'react';
import { isTauriRuntime } from '../../engine';
import { privatePosts, savePrivatePostProfile, type PrivatePostEntry } from '../../cam/posts';
import { useTranslation } from '../../i18n';

export function CamMachineFields({ machine, onChange }: {
  machine: CamMachineAssignmentDto | null;
  onChange: (machine: CamMachineAssignmentDto | null) => void;
}) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<PrivatePostEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    privatePosts().then(c => { if (!cancelled) setProfiles(c?.entries.filter(e => e.kind === 'native_profile' && e.machine) ?? []); })
      .catch(e => { if (!cancelled) setNotice(String(e)); });
    return () => { cancelled = true; };
  }, []);
  return <DialogSection title={t('cam.machine.sectionMachineController')}>
    <label className="block">
      <span className={CAM_DIALOG_LABEL}>{t('cam.machine.setupTarget')}</span>
      <select data-testid="cam-machine-select" className={CAM_DIALOG_INPUT}
        value={machine ? 'snapshot' : 'generic'}
        onChange={event => {
          const value = event.target.value;
          if (value.startsWith('private:')) {
            const profile = profiles.find(p => `private:${p.file_name}` === value);
            if (profile?.machine) onChange(structuredClone(profile.machine));
            return;
          }
          if (value !== 'snapshot') onChange(value === 'generic' ? null : createMachineAssignment(value as CamPostDialect));
        }}>
        <option value="generic">{t('cam.machine.genericOption')}</option>
        {machine && <option value="snapshot">{t('cam.machine.projectSnapshot').replace('{name}', machine.profile.name)}</option>}
        <optgroup label={t('cam.machine.newFromStarter')}>
          {MACHINE_PRESETS.map(p => <option key={p.dialect} value={p.dialect}>{t(p.labelKey)}</option>)}
        </optgroup>
        {profiles.length > 0 && <optgroup label={t('cam.machine.privateProfiles')}>
          {profiles.map(p => <option key={p.file_name} value={`private:${p.file_name}`}>{p.machine!.profile.name} · {p.file_name}</option>)}
        </optgroup>}
      </select>
    </label>
    {machine && <>
      <label className="block">
        <span className={CAM_DIALOG_LABEL}>{t('cam.machine.shopMachineName')}</span>
        <input data-testid="cam-machine-name" className={CAM_DIALOG_INPUT}
          value={machine.profile.name} maxLength={128}
          onChange={event => onChange({ ...machine, profile: { ...machine.profile, name: event.target.value } })} />
      </label>
      <p className="text-[10px] leading-relaxed text-mute">
        {machine.profile.controller.model} · {machine.profile.controller.language.replace(/_/g, ' ')} · {t('cam.machine.revision')} {machine.profile.revision}
      </p>
      <p className="text-[10px] leading-relaxed text-mute">{compensationGuidance(machine.profile.post.dialect)}</p>
      {machine.profile.post.siemens_828d?.spindle_stop_subprogram && <p className="text-[10px] leading-relaxed text-warn">
        {t('cam.machine.privateSpindleStop').replace('{program}', machine.profile.post.siemens_828d.spindle_stop_subprogram)}
      </p>}
      {isTauriRuntime() && <button type="button" disabled={saving} className="self-start rounded border border-edge px-2 py-1 text-[10px] hover:bg-edge disabled:opacity-40"
        onClick={() => {
          setSaving(true); setNotice(null);
          const stem = machine.profile.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'machine';
          void savePrivatePostProfile(`${stem}.nbpost`, machine).then(c => {
            setProfiles(c.entries.filter(e => e.kind === 'native_profile' && e.machine));
            setNotice(t('cam.machine.savedNotice'));
          }).catch(e => setNotice(String(e))).finally(() => setSaving(false));
        }}>{t('cam.machine.saveAsPrivatePost')}</button>}
    </>}
    {notice && <p role="status" className="text-[10px] text-mute">{notice}</p>}
    <p className="text-[10px] leading-relaxed text-mute">
      {machine ? t('cam.machine.starterHelp')
        : t('cam.machine.noMachineHelp')}
      {' '}{t('cam.machine.currentExecutionHelp')}
    </p>
  </DialogSection>;
}
