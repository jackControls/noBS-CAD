import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { BodyDto, SketchDto } from '../engine/types';
import { useAppStore } from '../store/appStore';
import { BodyFeatureDialog } from './BodyFeatureDialog';
import { DimensionEditor } from './viewport/DimensionEditor';

/** Real controlled inputs/editor/store; geometry snapshots are fixture data.
 * The full input-selection E2E separately exercises real geometry and Undo. */
export function mountDimensionInputContract() {
  const initial = useAppStore.getState();
  const bodies: BodyDto[] = [6.15, 8.65].map((radius, i) => ({
    id: i + 1, feature_id: i + 1, name: `Shaft ${i + 1}`, edges: [],
    mesh: {positions: [], normals: [], indices: []},
    faces: [{id: 10 + i, key: `shaft-${i}`, first_index: 0, index_count: 0, plane: null,
      cylinder: {origin: {x: 0, y: 0, z: 0}, axis: {x: 0, y: 0, z: 1},
        reference: {x: 1, y: 0, z: 0}, radius}}],
  }));
  // Replace only the native transport. The production dialog still derives
  // the nominal diameter and selection key through its own effects.
  const w = window as typeof window & {
    __TAURI_INTERNALS__?: {invoke(command: string): Promise<unknown>};
  };
  const native = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = {async invoke(command) {
    if (command !== 'engine_body_feature_definitions') {
      throw new Error(`Unexpected dimension input contract command: ${command}`);
    }
    return JSON.stringify({ok: true, value: []});
  }};
  const sketch: SketchDto = {
    name: 'Input contract', plane: {type: 'origin_plane', plane: 'xy'},
    basis: {origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1]},
    entities: [], constraints: [], reference_midpoints: [], projected_edges: [],
    dimension_style: 'aligned',
    dimensions: [1, 2].map(id => ({
      constraint_id: id, mode: 'driving', kind: 'distance', entities: [],
      param_id: id, param_name: `d${id}`, param_expression: null,
      value: id === 1 ? 50 : 7, text: id === 1 ? '50.00' : '7.00',
      text_pos: {x: 0, y: 0},
    })),
    dof: {value: 0, fully_defined: true}, can_undo: true, can_redo: false,
  };
  useAppStore.setState({
    document: {name: 'Input contract', settings: {units: 'mm'}, rollback_index: 0,
      features: [], browser: []},
    solidScene: {bodies, errors: []}, activeSketch: sketch, dimEditor: null,
    selectedBody: 1, selectedBodies: [1], selectedFace: 10, selectedFaces: [10],
    bodyFeatureDialog: {kind: 'external_thread', featureId: 0},
  });
  const open = (id: number) => {
    const state = useAppStore.getState();
    state.closeBodyFeatureDialog();
    const dimension = state.activeSketch!.dimensions.find(d => d.constraint_id === id)!;
    // The viewport performs both updates in one pointer event. A transient
    // null does not necessarily unmount a same-ID editor when React batches.
    state.setActiveTool(null);
    state.setDimEditor({dimId: id, initial: String(dimension.value), x: 0, y: 120});
  };
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  root.render(<StrictMode>
    <BodyFeatureDialog />
    <button onClick={() => {
      const state = useAppStore.getState();
      state.setModelingPickTarget('external_thread_face');
      state.setSelectedBody(2);
      state.setSelectedFace(11);
    }}>Change support face</button>
    <button onClick={() => open(1)}>Open dimension</button>
    <button onClick={() => open(2)}>Open other dimension</button>
    <button onClick={() => {
      const state = useAppStore.getState();
      state.setActiveSketch({...state.activeSketch!});
    }}>Refresh sketch</button>
    <button onClick={() => {
      const state = useAppStore.getState();
      state.setActiveSketch({...state.activeSketch!, dimensions: sketch.dimensions.map(d =>
        d.constraint_id === 1 ? {...d, value: 25, text: '25.00'} : d)});
    }}>Restore 25 snapshot</button>
    <DimensionEditor />
  </StrictMode>);
  return () => {
    root.unmount();
    container.remove();
    useAppStore.setState(initial);
    if (native) w.__TAURI_INTERNALS__ = native;
    else delete w.__TAURI_INTERNALS__;
  };
}
