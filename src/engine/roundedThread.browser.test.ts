// Persisted definitions enter the real editors; capture their native edit requests.
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { HoleDialog } from '../components/HoleDialog';
import { BodyFeatureDialog } from '../components/BodyFeatureDialog';
import { useAppStore } from '../store/appStore';
import { threadDtoFromPreset, type ThreadPreset } from '../lib/threadStandards';
import { BrowserOcctKernel } from './occtBrowser';
import type { BodyDto, HoleDefinitionDto, HoleThreadDto, RecomputePlanDto } from './types';

export async function checkRoundedThreadEditors() {
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const initial = useAppStore.getState();
  const thread: HoleThreadDto = JSON.parse(JSON.stringify({
    standard: 'custom_trapezoidal', series: 'rounded', designation: 'Custom rounded 24 x 4',
    class: 'custom', nominal_diameter: 24, pitch: 4, threads_per_inch: null,
    hand: 'right', depth: null, representation: 'modeled', tap_drill_designation: null,
    rounded_profile: { radial_depth: 2, corner_radius: 0.3, radial_clearance: 0.25, axial_clearance: 0.2 },
  }));
  const preset: ThreadPreset = {
    id: 'persisted-custom', label: thread.designation, standard: thread.standard,
    series: thread.series, designation: thread.designation, class: thread.class,
    nominalDiameterMm: 24, pitchMm: 4, threadsPerInch: null, tapDrillDiameterMm: 20.5,
    tapDrillDesignation: null, roundedProfile: thread.rounded_profile,
  };
  const plane = {origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1]};
  const body = {id: 1, name: 'Thread stock', edges: [], mesh: {positions: [], normals: [], indices: []},
    faces: [
      {id: 10, first_index: 0, index_count: 0, plane, cylinder: null},
      {id: 11, first_index: 0, index_count: 0, plane: null,
        cylinder: {origin: {x: 0, y: 0, z: 0}, axis: {x: 0, y: 0, z: 1}, radius: 12}},
    ]} as unknown as BodyDto;
  const hole: HoleDefinitionDto = {feature_id: 2, name: 'Rounded internal', body_id: 1, face_id: 10,
    face_basis: plane as HoleDefinitionDto['face_basis'],
    position: {x: 0, y: 0}, position_reference: null, positions: [], diameter: 20.5,
    extent: {type: 'distance', depth: 12}, style: 'simple', counterbore_diameter: 0,
    counterbore_depth: 0, countersink_diameter: 0, countersink_angle_deg: 90,
    bottom_style: 'flat', drill_point_angle_deg: 118, thread, flip: false};
  const external = {type: 'external_thread', feature_id: 3, name: 'Rounded external',
    body_id: 1, face_id: 11, thread, flip: false};
  const scene = {bodies: [body], errors: []};
  const model = {name: 'Reopened custom threads', settings: {units: 'mm' as const},
    rollback_index: 0, features: [], browser: []};
  const calls: {command: string; payload: Record<string, unknown>}[] = [];
  const w = window as typeof window & {__TAURI_INTERNALS__?: {invoke(command: string, args?: Record<string, unknown>): Promise<unknown>}};
  const native = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = {async invoke(command, args = {}) {
    const payload = args.payload ? JSON.parse(args.payload as string) : {};
    let value: unknown;
    if (command === 'engine_hole_definitions') value = [hole];
    else if (command === 'engine_body_feature_definitions') value = [external];
    else if (['engine_solid_edit_hole', 'engine_solid_edit_body_feature',
      'engine_solid_hole', 'engine_solid_body_feature'].includes(command)) {
      calls.push({command, payload}); value = {document: model, scene};
    } else throw new Error(`Unexpected custom thread editor command: ${command}`);
    return JSON.stringify({ok: true, value});
  }};
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const until = async (predicate: () => boolean, message: string) => {
    const end = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() >= end) throw new Error(`${message}: ${container.textContent}`);
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
  };
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const input = async (testId: string, value: string) => {
    const element = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    check(element, `The actual editor must expose ${testId}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element!.dispatchEvent(new Event('input', {bubbles: true}));
    await frame();
  };
  try {
    for (const {kind, mode} of (['preserve', 'profile-edit', 'create'] as const).flatMap(mode =>
      (['hole', 'external'] as const).map(kind => ({kind, mode})))) {
      const create = mode === 'create';
      const beforeCalls = calls.length;
      useAppStore.setState({...initial, document: model, solidScene: scene, historyEdit: null,
        solidBusy: false, projectBusy: false, selectedBody: 1, selectedBodies: [1],
        selectedFace: kind === 'hole' ? 10 : 11, selectedFaces: [kind === 'hole' ? 10 : 11],
        holeDialogFeature: kind === 'hole' ? (create ? 0 : 2) : null,
        bodyFeatureDialog: kind === 'external' ? {kind: 'external_thread', featureId: create ? 0 : 3} : null});
      flushSync(() => root.render(createElement(kind === 'hole' ? HoleDialog : BodyFeatureDialog)));
      const submitId = kind === 'hole' ? 'hole-ok' : 'body-feature-ok';
      await until(() => !!container.querySelector<HTMLButtonElement>(`[data-testid="${submitId}"]`)
        && !container.querySelector<HTMLButtonElement>(`[data-testid="${submitId}"]`)!.disabled,
      `${kind} saved custom feature should be editable`);
      if (create && kind === 'hole') {
        container.querySelector<HTMLInputElement>('[data-testid="hole-threaded"]')!.click();
        await frame();
      }
      const standard = container.querySelector<HTMLSelectElement>(`[data-testid="${kind === 'hole' ? 'hole' : 'external'}-thread-standard"]`)!;
      if (create) {
        standard.value = 'custom_trapezoidal';
        standard.dispatchEvent(new Event('change', {bubbles: true})); await frame();
        await input(`${kind}-thread-nominal`, '24');
        await input(`${kind}-thread-pitch`, '4');
        if (kind === 'hole') await input('hole-diameter', '20.5');
        for (const [field, value] of Object.entries(thread.rounded_profile!)) {
          await input(`${kind}-${field}`, String(value));
        }
        await input(`${kind}-thread-nominal`, '1e309');
        check(container.querySelector<HTMLButtonElement>(`[data-testid="${submitId}"]`)!.disabled,
          'An overflowing nominal diameter must not reach native JSON as null');
        check(calls.length === beforeCalls, 'Invalid drafts must not submit a modeling request');
        await input(`${kind}-thread-nominal`, '24');
      } else if (mode === 'profile-edit') {
        await input(`${kind}-corner_radius`, '0.4');
        await input(`${kind}-axial_clearance`, '0.25');
      }
      const correctLabel = standard.value === 'custom_trapezoidal'
        && standard.selectedOptions[0]?.textContent === 'Custom rounded trapezoidal';
      const disclosedProfile = container.querySelector<HTMLInputElement>(`[data-testid="${kind}-radial_clearance"]`)
        ?.value === '0.25';
      const hand = [...container.querySelectorAll('select')].find(select =>
        [...select.options].some(option => option.value === 'left'))!;
      hand.value = 'left'; hand.dispatchEvent(new Event('change', {bubbles: true}));
      await frame();
      check(!container.querySelector<HTMLButtonElement>(`[data-testid="${submitId}"]`)!.disabled,
        `Custom ${kind}/${mode} parameters must be submittable`);
      container.querySelector<HTMLButtonElement>(`[data-testid="${submitId}"]`)!.click();
      await until(() => calls.length === beforeCalls + 1 && !useAppStore.getState().solidBusy,
        'Editing the hand should reach native edit and finish publication');
      const payload = calls[calls.length - 1].payload;
      const request = kind === 'hole' ? (create ? payload : payload.hole)
        : create ? payload.request : (payload.feature as {request: unknown}).request;
      const submitted = (request as {thread: HoleThreadDto}).thread;
      const expected = {...thread, hand: 'left',
        ...(create ? {designation: 'Custom rounded trapezoidal'} : {}),
        ...(mode === 'profile-edit' ? {rounded_profile: {...thread.rounded_profile!,
          corner_radius: 0.4, axial_clearance: 0.25}} : {})};
      check(JSON.stringify(submitted) === JSON.stringify(expected),
        `${kind}/${mode} lost requested thread metadata: ${JSON.stringify(submitted)}`);
      check(correctLabel, 'The saved custom standard must never display ISO or Unified');
      check(disclosedProfile, 'The actual editor must disclose retained profile clearances');
      check(create ? payload.feature_id === undefined : payload.feature_id === (kind === 'hole' ? 2 : 3),
        'Creation and edit must use their existing native request paths');
      flushSync(() => root.render(null));
    }
    for (const fit of ['internal', 'external'] as const) {
      check(JSON.stringify(threadDtoFromPreset(preset, thread, fit)) === JSON.stringify(thread),
        `${fit} preset conversion must preserve custom class, designation and profile`);
    }
    // Exercise the real browser dispatch with a kernel that traps any OCCT use.
    // Rejection must happen before looking up a target or creating a 60-degree cutter.
    const oc = new Proxy({}, {get() { throw new Error('Unexpected geometry access'); }});
    const kernel = Reflect.construct(BrowserOcctKernel, [oc]) as BrowserOcctKernel;
    try {
      for (const kind of ['hole', 'external_thread'] as const) {
        for (const representation of ['modeled', 'simplified'] as const) {
          const result = kernel.recompute({jobs: [{kind, job: {feature_id: 9, target_body_id: 1,
            thread: {...thread, representation}}}], errors: []} as unknown as RecomputePlanDto);
          check(result.bodies.length === 0 && result.errors.length === 1
            && result.errors[0].feature_id === 9
            && result.errors[0].message.includes('require the native desktop kernel'),
          `${kind}/${representation} must reject unsupported geometry explicitly`);
        }
      }
    } finally { kernel.dispose(); }
    return {presetRoundtrip: true, holeEdit: true, externalEdit: true,
      holeCreate: true, externalCreate: true, profileEdit: true, browserRejectsBothForms: true};
  } finally {
    root.unmount(); container.remove(); useAppStore.setState(initial);
    if (native) w.__TAURI_INTERNALS__ = native; else delete w.__TAURI_INTERNALS__;
  }
}
