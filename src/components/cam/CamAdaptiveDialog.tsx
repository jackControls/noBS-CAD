import { useCallback, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { CamToolIcon } from './CamToolIcon';
import {
  activeCamSetup, addCamOperation, camToolCompatible, regenerateCamOperation,
  replaceCamOperation, type CamOperationHeightExpressionsInput, type CamOperationInput,
} from '../../cam/document';
import { commitLength, displayLength } from '../../cam/units';
import { modelBottomZInSetup, modelTopZInSetup } from '../../cam/geometry';
import type { CamCoolantMode, CamOperationDto, CamToolDto } from '../../engine/types';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { CamOperationPlacement } from '../../cam/editing';
import {
  CAM_DIALOG_INPUT, CAM_DIALOG_LABEL, DialogSection, DraftNumber,
  lengthUnit, parseDraft,
} from './camFields';
import { openCamToolPicker, useCamToolPickResult } from './opShared';
import { CamOperationTabs, HeightField, type HeightFrom, type OpTab } from './camOperationFields';
import { CamLinkingFields, useCamLinking } from './camLinkingFields';
import { CamCuttingPair, CamCuttingHint, useCamCutting } from './camCuttingFields';

type Adaptive = Extract<CamOperationDto, { kind: 'adaptive3d' }>;
const compatible = (tool: CamToolDto) => camToolCompatible('adaptive3d', tool);
type HeightKey = 'bottom' | 'top' | 'feed' | 'retract' | 'clearance';
/** Title-case height-plane labels used as the label prefix of height errors. */
const HEIGHT_LABEL_KEYS: Record<HeightKey, string> = {
  bottom: 'cam.operation.heightBottom',
  top: 'cam.operation.heightTop',
  feed: 'cam.operation.heightFeed',
  retract: 'cam.operation.heightRetract',
  clearance: 'cam.operation.heightClearance',
};
const HEIGHT_ROWS: Array<{ key: HeightKey; labelKey: string; below: HeightFrom[] }> = [
  { key: 'clearance', labelKey: 'cam.operation.sectionClearanceHeight', below: ['bottom', 'top', 'feed', 'retract'] },
  { key: 'retract', labelKey: 'cam.operation.sectionRetractHeight', below: ['bottom', 'top', 'feed'] },
  { key: 'feed', labelKey: 'cam.operation.sectionFeedHeight', below: ['bottom', 'top'] },
  { key: 'top', labelKey: 'cam.operation.sectionTopHeight', below: ['bottom'] },
  { key: 'bottom', labelKey: 'cam.operation.sectionBottomHeight', below: [] },
];

/** Only parameter editing lives here. Rust captures current target meshes,
 * resolves their conservative envelope, and computes every roughing move. */
export function CamAdaptiveDialog({ editing, insertion }: { editing?: Adaptive; insertion?: CamOperationPlacement }) {
  const { t } = useTranslation();
  const cam = useAppStore((state) => state.camDocument);
  const scene = useAppStore((state) => state.solidScene);
  const setup = editing
    ? cam.setups.find((s) => s.operations.some((o) => o.id === editing.id))
    : insertion ? cam.setups.find(s => s.id === insertion.setupId) : activeCamSetup(cam);
  const units = cam.units;
  const length = lengthUnit(units);
  const seed = (mm: number) => String(Number(displayLength(mm, units).toFixed(5)));
  const heightSeed = (mm: number) => String(Number(displayLength(mm, units).toFixed(8)));
  const initialTool = cam.tools.find((t) => t.id === editing?.tool_id)
    ?? cam.tools.find(compatible);
  const diameter = initialTool?.diameter ?? 6;
  const p = editing?.parameters;
  const [tab, setTab] = useState<OpTab>('tool');
  const [name, setName] = useState(editing?.name ?? t('cam.operation.defaultHighSpeedRoughingName'));
  const [toolId, setToolId] = useState<number | null>(initialTool?.id ?? null);
  const feeds = useCamCutting({ units, tool: cam.tools.find(t => t.id === toolId) }, editing?.cutting ?? initialTool?.cutting);
  const [operationId, setOperationId] = useState<number | null>(editing?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cavities, setCavities] = useState(p?.machine_cavities ?? true);
  const [coolant, setCoolant] = useState<CamCoolantMode>(editing?.cutting.coolant ?? initialTool?.cutting.coolant ?? 'flood');
  const [heightDrafts, setHeightDrafts] = useState(() => {
    const stored = cam.height_expressions?.find((item) => item.operation_id === editing?.id);
    const seedHeight = (key: HeightKey, absolute: number | undefined, reference: HeightFrom, offset: number) => {
      const expression = stored?.[key];
      return expression
        ? { from: expression.reference, offset: heightSeed(expression.offset) }
        : absolute !== undefined
          ? { from: 'origin' as HeightFrom, offset: heightSeed(absolute) }
          : { from: reference, offset: heightSeed(offset) };
    };
    return {
      bottom: seedHeight('bottom', editing?.bottom_z, 'stock_bottom', 0),
      top: seedHeight('top', editing?.top_z, 'stock_top', 0),
      feed: seedHeight('feed', editing?.feed_height_z, 'stock_top', 2),
      retract: seedHeight('retract', editing?.retract_z, 'stock_top', 5),
      clearance: seedHeight('clearance', editing?.clearance_z, 'retract', 5),
    };
  });
  const [draft, setDraft] = useState({
    load: seed(p?.optimal_load ?? diameter * 0.2),
    stepdown: seed(p?.maximum_stepdown ?? Math.min(diameter, (initialTool?.flute_length ?? diameter * 2) / 2)),
    radius: seed(p?.minimum_cutting_radius ?? diameter * 0.2),
    radial: seed(p?.radial_stock_to_leave ?? 0.2),
    axial: seed(p?.axial_stock_to_leave ?? 0.2),
    tolerance: seed(p?.tolerance ?? 0.2),
    angle: String(p?.ramp_angle_degrees ?? 3),
    rampStep: seed(p?.maximum_ramp_stepdown ?? Math.min(1, diameter / 4)),
    rampFeed: seed(p?.ramp_feed ?? initialTool?.cutting.feed_z ?? 0),
    linkFeed: seed(p?.linking_feed ?? initialTool?.cutting.feed_xy ?? 0),
    stayDown: seed(p?.stay_down_distance ?? diameter * 5),
  });
  const chooseTool = useCallback((tool: CamToolDto) => {
    setToolId(tool.id);
    setCoolant(tool.cutting.coolant);
    feeds.reset(tool.cutting);
    const display = (mm: number) => String(Number(displayLength(mm, units).toFixed(5)));
    setDraft((d) => ({ ...d, rampFeed: display(tool.cutting.feed_z), linkFeed: display(tool.cutting.feed_xy),
      load: display(tool.diameter * 0.2), radius: display(tool.diameter * 0.2),
      stepdown: display(Math.min(tool.diameter, tool.flute_length / 2)), rampStep: display(Math.min(1, tool.diameter / 4)),
    }));
  }, [units]);
  useCamToolPickResult(compatible, chooseTool);
  const tool = cam.tools.find((t) => t.id === toolId);
  const linking = useCamLinking('adaptive3d', units, tool, editing);
  const close = () => { if (!busy) useAppStore.getState().setCamDialog(null); };
  const field = (key: keyof typeof draft, label: string, unit = length, integer = false) => (
    <DraftNumber key={key} label={label} value={draft[key]} unit={unit} integer={integer}
      onChange={(value) => setDraft((d) => ({ ...d, [key]: value }))} />
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!setup || busy) return;
    setError(null);
    try {
      if (!tool || !compatible(tool)) throw new Error(t('cam.operation.errorAdaptiveTool'));
      const links = linking.read();
      if (!setup.body_ids.length) throw new Error(t('cam.operation.errorSelectTargetBodies'));
      if (setup.resolved_stock.shape === 'rest') throw new Error(t('cam.operation.errorAdaptiveStock'));
      const mm = (key: keyof typeof draft) => commitLength(parseDraft(draft[key], key), units);
      const resolved: Partial<Record<HeightKey, number>> = {};
      const heightExpression = (key: HeightKey) => ({
        reference: heightDrafts[key].from,
        offset: commitLength(parseDraft(heightDrafts[key].offset, t('cam.operation.labelOffset').replace('{label}', t(HEIGHT_LABEL_KEYS[key]))), units),
      });
      const heights: CamOperationHeightExpressionsInput = {
        top: heightExpression('top'), bottom: heightExpression('bottom'),
        feed: heightExpression('feed'), retract: heightExpression('retract'), clearance: heightExpression('clearance'),
      };
      const bases: Partial<Record<HeightFrom, number>> = {
        model_top: modelTopZInSetup(scene, setup) ?? setup.stock.max.z,
        model_bottom: modelBottomZInSetup(scene, setup) ?? setup.stock.min.z,
        stock_top: setup.stock.max.z, stock_bottom: setup.stock.min.z, origin: 0,
      };
      for (const key of ['bottom', 'top', 'feed', 'retract', 'clearance'] as const) {
        const row = heightDrafts[key];
        const offset = heights[key]!.offset;
        const base = bases[row.from] ?? resolved[row.from as keyof typeof resolved];
        if (base === undefined) throw new Error(t('cam.operation.errorHeightUnavailableRef').replace('{key}', key));
        resolved[key] = base + offset;
      }
      const input: CamOperationInput = {
        kind: 'adaptive3d', name: name.trim(), enabled: editing?.enabled ?? true, tool_id: tool.id,
        top_z: resolved.top!, bottom_z: resolved.bottom!, clearance_z: resolved.clearance!,
        retract_z: resolved.retract!, feed_height_z: resolved.feed!,
        cutting: feeds.read(coolant),
        parameters: {
          optimal_load: mm('load'), maximum_stepdown: mm('stepdown'), minimum_cutting_radius: mm('radius'),
          radial_stock_to_leave: mm('radial'), axial_stock_to_leave: mm('axial'), tolerance: mm('tolerance'),
          ramp_angle_degrees: links.ramp_angle, maximum_ramp_stepdown: links.ramp_stepdown,
          ramp_feed: links.ramp_feed, linking_feed: links.no_engagement_feed, stay_down_distance: links.maximum_stay_down, machine_cavities: cavities,
        },
        // No browser mesh serialization. Regeneration replaces the snapshot
        // inside the engine's document transaction before certifying it.
        geometry: null,
      };
      setBusy(true);
      let id = operationId;
      if (id === null) {
        id = await addCamOperation(input, heights, links, insertion);
        setOperationId(id); // Failed generation retries this draft, not a duplicate.
      } else await replaceCamOperation(id, input, heights, links);
      if (input.enabled) await regenerateCamOperation(id);
      useAppStore.getState().setCamDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  if (!setup) return null;
  return (
    <div data-native-viewport-dim="0.15" className="pointer-events-none fixed inset-0 z-[70] bg-black/15">
      <form onSubmit={submit} data-testid="cam-adaptive-dialog"
        className="feature-dialog pointer-events-auto absolute right-5 top-[160px] flex max-h-[calc(100vh-218px)] w-[340px] flex-col overflow-hidden rounded border border-edge bg-panel shadow-2xl">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-3">
          <CamToolIcon id="camAdaptive" size={18} />
          <span className="flex-1 text-xs font-semibold text-ink">{editing ? t('cam.operation.editOperationTitle').replace('{name}', editing.name) : t('cam.operation.newOperationTitle').replace('{name}', t('cam.operation.defaultHighSpeedRoughingName'))}</span>
          <button type="button" aria-label={t('cam.operation.closeOperation')} disabled={busy} onClick={close} className="rounded p-1 text-mute hover:bg-edge hover:text-ink"><X size={14} /></button>
        </header>
        <fieldset disabled={busy} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-[10px] text-warn">
            {t('cam.operation.adaptiveExperimentalNote')}
          </p>
          {error && <p role="alert" className="text-xs text-warn">{error}</p>}
          <label className="block"><span className={CAM_DIALOG_LABEL}>{t('cam.operation.operationName')}</span>
            <input className={CAM_DIALOG_INPUT} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <CamOperationTabs value={tab} onChange={setTab} />
          {tab === 'tool' && <DialogSection title={t('cam.operation.sectionCutterFeeds')}>
            <p className="text-xs text-ink">{tool?.name ?? t('cam.operation.noCompatibleToolSelected')}</p>
            <button type="button" onClick={() => openCamToolPicker('adaptive3d')} className="text-xs text-accent">{t('cam.operation.chooseFromToolLibrary')}</button>
            <p className="text-[10px] text-mute">{t('cam.operation.adaptiveToolHint')}</p>
            {tool && !compatible(tool) && <p role="alert" className="text-xs text-warn">{t('cam.operation.assignedToolIncompatibleEndMill')}</p>}
            <div className="grid grid-cols-2 gap-2">
              <CamCuttingPair feeds={feeds} pair="speed" />
              <CamCuttingPair feeds={feeds} pair="cutting" primaryLabel={t('cam.operation.labelCuttingFeed')} />
              <CamCuttingPair feeds={feeds} pair="plunge" primaryLabel={t('cam.operation.labelPlungeFeed')} />
              <CamCuttingHint />
            </div>
            <label className="block"><span className={CAM_DIALOG_LABEL}>{t('cam.operation.coolant')}</span>
              <select className={CAM_DIALOG_INPUT} value={coolant} onChange={(e) => setCoolant(e.target.value as CamCoolantMode)}>
                <option value="off">{t('cam.operation.coolantOff')}</option><option value="flood">{t('cam.operation.coolantFlood')}</option><option value="mist">{t('cam.operation.coolantMist')}</option>
              </select></label>
          </DialogSection>}
          {tab === 'geometry' && <DialogSection title={t('cam.operation.sectionSetupTargetStock')}>
            <p className="text-xs text-ink">{(setup.body_ids.length === 1 ? t('cam.operation.setupTargetBody') : t('cam.operation.setupTargetBodies')).replace('{name}', setup.name).replace('{count}', String(setup.body_ids.length))}</p>
            <p className="text-[11px] text-mute">{t('cam.operation.adaptiveGeometryNote1')}</p>
            <p className="text-[11px] text-mute">{t('cam.operation.adaptiveGeometryNote2')}</p>
          </DialogSection>}
          {tab === 'heights' && <>
            {HEIGHT_ROWS.map(({ key, labelKey, below }) => <DialogSection key={key} title={t(labelKey)}>
              <HeightField from={heightDrafts[key].from} offset={heightDrafts[key].offset} unit={length} chainBelow={below}
                onFrom={(from) => setHeightDrafts((all) => ({ ...all, [key]: { ...all[key], from } }))}
                onOffset={(offset) => setHeightDrafts((all) => ({ ...all, [key]: { ...all[key], offset } }))} />
            </DialogSection>)}
            <p className="text-[10px] text-mute">{t('cam.operation.adaptiveHeightsNote')}</p>
          </>}
          {tab === 'passes' && <DialogSection title={t('cam.operation.sectionEngagementAllowances')}>
            {field('load', t('cam.operation.labelOptimalRadialLoad'))}{field('stepdown', t('cam.operation.labelMaximumRoughingStepdown'))}
            {field('radius', t('cam.operation.labelMinimumCuttingRadius'))}{field('radial', t('cam.operation.labelRadialStockToLeave'))}{field('axial', t('cam.operation.labelAxialStockToLeave'))}
            {field('tolerance', t('cam.operation.labelTargetEnvelopeCellWidth'))}
            <p className="text-[10px] text-mute">{t('cam.operation.adaptivePassesNote')}</p>
          </DialogSection>}
          {tab === 'linking' && <>
            <label className="flex gap-2 text-xs text-ink"><input type="checkbox" checked={cavities} onChange={(e) => setCavities(e.target.checked)} />{t('cam.operation.machineEnclosedCavities')}</label>
            <CamLinkingFields value={linking} setup={setup} />
          </>}
        </fieldset>
        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-edge px-3">
          <button type="button" disabled={busy} onClick={close} className="h-7 rounded border border-edge px-3 text-[10px] font-semibold text-mute hover:text-ink">{t('cam.operation.cancel')}</button>
          <button type="submit" disabled={busy} className="h-7 rounded border border-accent/50 bg-accent/15 px-3 text-[10px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">
            {busy ? t('cam.operation.generating') : t('cam.operation.saveAndGenerate')}
          </button>
        </footer>
      </form>
    </div>
  );
}
