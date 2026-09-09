import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Client} from '../../mcp-server/client.mjs';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
assert(option('--server'), 'Use --server MCP_EXE [--desktop EXE] [--save FILE] [--out DIRECTORY]');
const client = new Client(option('--server'));
const report = {name: 'Crown garden bench', parts: [], calls: [], checks: []};
let tools, session;
async function call(name, args = {}) {
  const tool = tools.find(t => t.name === name);
  const result = await client.call('cad_interface', {action: 'execute', group: tool.group, operation: name, arguments: args});
  report.calls.push({name, arguments: args});
  return result;
}
const model = async () => JSON.parse(await call('cad_project_model'));
const scene = () => call('solid_scene');
const bodyById = async id => (await scene()).bodies.find(b => b.id === id);
function volume(body) {
  const p = body.mesh.positions, ids = body.mesh.indices;
  let sum = 0;
  for (let i = 0; i < ids.length; i += 3) {
    const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
    sum += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) +
      p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(sum / 6);
}
function nearVolume(actual, expected, context) {
  assert(Math.abs(actual - expected) < expected * .02, `${context}: ${actual} vs ${expected} mm³`);
}
const span = (body, axis) => {
  const values = body.mesh.positions.filter((_, i) => i % 3 === axis);
  return Math.max(...values) - Math.min(...values);
};
async function part(name, width, depth, height, {round = 3, crown = false, taper = 0, holes = false, notches = false} = {}) {
  const before = await scene();
  await call('sketch_begin', {plane: {type: 'origin_plane', plane: 'xy'}});
  await call('sketch_add_rectangle_locked', {mode: 'two_point', anchor: {x: 0, y: 0}, corner_hint: {x: width, y: depth}, width_mm: width, height_mm: depth, ctrl_held: true});
  const sketchState = await call('sketch_active');
  await call('sketch_finish');
  const sketch = (await model()).sketches.at(-1).name;
  const extrude = {sketch_name: sketch, profile_indices: [0], operation: 'new_body', extent: {type: 'distance', distance: height}, taper_angle_deg: taper, flip: false, target_body_ids: []};
  await call('solid_extrude', extrude);
  const feature = (await model()).document.history.features.at(-1);
  let body = (await scene()).bodies.find(b => !before.bodies.some(old => old.id === b.id));
  if (crown) {
    // Round the two top edges running through the board thickness. These
    // persisted edge features follow later edits of the extrusion height.
    const ids = body.edges.filter(e => e.points.length >= 2 &&
      e.points.every(p => Math.abs(p.z - height) < 1e-6) &&
      (e.points.every(p => Math.abs(p.x) < 1e-6) || e.points.every(p => Math.abs(p.x - width) < 1e-6))).map(e => e.id);
    assert.equal(ids.length, 2, 'Two crown shoulder edges');
    await call('solid_fillet', {body_id: body.id, edge_ids: ids, radius: 40, tangent_chain: false});
    body = await bodyById(body.id);
  }
  if (round) {
    const edges = body.edges.filter(e => e.refinable && (!crown ||
      e.points.every(p => Math.abs(p.y) < 1e-6) || e.points.every(p => Math.abs(p.y - depth) < 1e-6)));
    await call('solid_fillet', {body_id: body.id, edge_ids: edges.map(e => e.id), radius: round, tangent_chain: crown});
    body = await bodyById(body.id);
  }
  if (holes) {
    for (const x of [90, width - 90]) {
      body = await bodyById(body.id);
      const face = body.faces.find(f => f.plane?.normal[2] > .99);
      const delta = [x, depth / 2, height].map((n, i) => n - face.plane.origin[i]);
      const dot = v => v.reduce((sum, n, i) => sum + n * delta[i], 0);
      await call('solid_hole', {body_id: body.id, face_id: face.id, position: {x: dot(face.plane.u), y: dot(face.plane.v)}, diameter: 6, extent: {type: 'through_all'}, bottom_style: 'flat', drill_point_angle_deg: 118, flip: false});
    }
    body = await bodyById(body.id);
  }
  let relief;
  if (notches) {
    for (const x of [64, 1069]) {
      const beforePocket = volume(body);
      const face = body.faces.find(f => f.plane?.normal[2] > .99);
      await call('sketch_begin', {plane: {type: 'planar_face', face_id: face.id}, face_origin: 'global_origin_projection'});
      await call('sketch_add_rectangle_locked', {mode: 'two_point', anchor: {x, y: 19}, corner_hint: {x: x + 67, y: 90}, width_mm: 67, height_mm: 71, ctrl_held: true});
      const cutSketch = (await call('sketch_active')).name;
      await call('sketch_finish');
      await call('solid_extrude', {sketch_name: cutSketch, profile_indices: [0], operation: 'cut', extent: {type: 'through_all'}, taper_angle_deg: 0, flip: true, target_body_ids: [body.id]});
      body = await bodyById(body.id);
      nearVolume(beforePocket - volume(body), 67 * (depth - 19) * height, 'Post clearance pocket removes stock');
    }
  }
  if (crown) {
    const uncutVolume = volume(body);
    const face = body.faces.find(f => f.plane?.normal[1] < -.99);
    await call('sketch_begin', {plane: {type: 'planar_face', face_id: face.id}, face_origin: 'face_center'});
    await call('sketch_set_grid_snap', {enabled: false});
    await call('sketch_add_slot', {mode: 'center_to_center', p1: {x: 0, y: -50}, p2: {x: 0, y: 50}, cursor: {x: 9, y: 0}, width_mm: 18});
    const active = await call('sketch_active');
    const line = active.entities.find(e => e.kind === 'line');
    const arc = active.entities.find(e => e.kind === 'arc');
    await call('sketch_add_dimension', {entities: [line.id], text_pos: {x: -30, y: 0}, value_text: '100'});
    await call('sketch_add_constraint', {type: 'vertical', entity: line.id});
    await call('sketch_add_point', {position: {x: 0, y: -50}});
    const datum = (await call('sketch_active')).entities.at(-1).id;
    // Fix only the locating datum, leaving slot width and length editable.
    await call('sketch_add_constraints', {constraints: [{type: 'fix', entity: datum}, {type: 'center_coincident', point: datum, curve: arc.id}]});
    const constrained = await call('sketch_active');
    assert.equal(constrained.dof.value, 0, 'Relief slot must be fully constrained');
    relief = {sketch: constrained.name, width_constraint: active.dimensions[0].constraint_id};
    await call('sketch_finish');
    await call('solid_extrude', {sketch_name: relief.sketch, profile_indices: [0], operation: 'cut', extent: {type: 'through_all'}, taper_angle_deg: 0, flip: true, target_body_ids: [body.id]});
    body = await bodyById(body.id);
    nearVolume(uncutVolume - volume(body), (18 * 100 + Math.PI * 9 ** 2) * depth, 'Relief slot removes stock');
  }
  const light = holes || notches || crown || name.startsWith('Armrest');
  await call('set_body_appearance', {body_id: body.id, color: light ? {r: 187, g: 126, b: 68, a: 255} : {r: 65, g: 84, b: 77, a: 255}, material_name: light ? 'Oiled timber (visual designation)' : 'Painted timber (visual designation)', filament_type: '', brand: '', color_name: light ? 'Honey timber' : 'Deep green'});
  const component = await call('assembly_create_component', {name, body_ids: [body.id], absorb_promoted_bodies: true});
  const assembly = await call('assembly_document');
  const occurrence = assembly.component_structure.occurrences.find(o => o.component_id === component.id);
  const result = {name, width, depth, height, sketch, dimensions: sketchState.dimensions, extrude, feature, body, component, occurrence, relief};
  report.parts.push({name, sketch, dimensions: sketchState.dimensions, feature_id: feature.id, body_id: body.id, component_id: component.id, relief});
  console.log('Built', name);
  return result;
}
function anchor(body, top, origin) {
  const face = body.faces.find(f => f.plane && f.plane.normal[2] * (top ? 1 : -1) > .99);
  assert(face, `No horizontal datum face on ${body.id}`);
  return {body_id: body.id, face_id: face.id, face_key: face.key, kind: 'planar_face',
    frame: {origin, primary_axis: face.plane.normal, secondary_axis: [1, 0, 0]},
    source_surface_frame: {origin: face.plane.origin, primary_axis: face.plane.normal, secondary_axis: face.plane.u}};
}
let root;
const expected = [];
async function instances(part, positions) {
  for (const [index, position] of positions.entries()) {
    const occurrence = index === 0 ? part.occurrence : await call('assembly_create_occurrence', {component_id: part.component.id, name: `${part.name} ${index + 1}`});
    // Explicit mate-frame offsets are measured from the root seat datum.
    // All occurrences remain face-referenced rigid joints, not baked transforms.
    await call('assembly_create_joint', {name: `${part.name} / seat datum ${index + 1}`, kind: 'rigid',
      connector_a: anchor(root.body, true, [position[0], position[1], position[2] - 415]),
      connector_b: anchor(part.body, false, [0, 0, 0]), flipped: false,
      advanced: {connector_a_occurrence_id: root.occurrence.id, connector_b_occurrence_id: occurrence.id}});
    expected.push({id: occurrence.id, position, body_id: part.body.id});
  }
}
async function validate(c = client) {
  const s = await c.call('solid_scene');
  assert.deepEqual(s.errors, []);
  const solution = await c.call('assembly_solution');
  assert.equal(solution.solved, true);
  assert.deepEqual(solution.diagnostics, []);
  for (const item of expected) {
    const pose = solution.instance_body_poses.find(p => p.occurrence_id === item.id);
    assert(pose && pose.translation.every((n, i) => Math.abs(n - item.position[i]) < 1e-5), JSON.stringify({item, pose}));
  }
  const m = JSON.parse(await c.call('cad_project_model'));
  assert(!m.document.history.features.some(f => f.kind === 'import_step'));
  return m;
}
try {
  await client.start(); tools = await client.call('cad_list_all_tools');
  if (option('--desktop')) {
    const launched = await client.call('cad_interface', {action: 'launch', executable: option('--desktop')});
    assert.equal(launched.status, 'ready'); session = launched.session_id;
  }
  await call('cad_set_document_name', {name: 'Crown garden bench — editable native assembly'});
  root = await part('Seat slat — 1200 × 85, R3, drilled', 1200, 85, 35, {holes: true});
  await call('assembly_set_occurrence_pose', {occurrence_id: root.occurrence.id, local_pose: {translation: [0, 0, 415], rotation: [0, 0, 0, 1]}});
  await call('assembly_set_occurrence_grounded', {occurrence_id: root.occurrence.id, grounded: true});
  // Reuse the definition, leaving its original grounded occurrence untouched.
  const seatCopy = await call('assembly_create_occurrence', {component_id: root.component.id, name: 'Seat slat 2'});
  await instances({...root, occurrence: seatCopy}, [[0, 90, 415], [0, 180, 415], [0, 270, 415]]);
  await instances(await part('Rear seat slat — post clearance pockets', 1200, 85, 35, {notches: true}), [[0, 360, 415]]);
  await instances(await part('Front leg — softened edges', 65, 65, 415), [[65, 30, 0], [1070, 30, 0]]);
  await instances(await part('Long apron — between leg faces', 940, 28, 90), [[130, 45, 325], [130, 395, 325]]);
  await instances(await part('Side rail — upper and lower', 28, 285, 90), [[80, 95, 325], [1092, 95, 325], [80, 95, 130], [1092, 95, 130]]);
  await instances(await part('Lower stretcher — between side rails', 984, 45, 55), [[108, 202, 150]]);
  await instances(await part('Rear leg and back post', 65, 65, 790), [[65, 380, 0], [1070, 380, 0]]);
  await instances(await part('Back rail — upper and lower', 940, 32, 55), [[130, 395, 480], [130, 395, 735]]);
  const picket = await part('Back picket — editable height', 85, 25, 315, {crown: true, round: 3});
  await instances(picket, Array.from({length: 9}, (_, i) => [137.5 + i * 105, 427, 490]));
  await instances(await part('Arm support', 50, 50, 180), [[60, 30, 450], [1090, 30, 450]]);
  await instances(await part('Armrest — bullnose', 100, 405, 35, {round: 12}), [[35, -25, 630], [1065, -25, 630]]);
  await validate();
  const narrowSlotVolume = volume(await bodyById(picket.body.id));
  await call('sketch_edit', {name: picket.relief.sketch});
  await call('sketch_edit_dimension', {constraint_id: picket.relief.width_constraint, text: '20'});
  assert.equal((await call('sketch_active')).dof.value, 0);
  await call('sketch_finish');
  await call('solid_recompute');
  await validate();
  nearVolume(narrowSlotVolume - volume(await bodyById(picket.body.id)), (2 * 100 + Math.PI * (10 ** 2 - 9 ** 2)) * picket.depth, 'Width edit changes the cut');
  report.checks.push('fully constrained face slot, driving width 18 → 20');
  // Exercise downstream edge features and every repeated back-picket instance.
  await call('solid_edit_extrude', {feature_id: picket.feature.id, extrude: {...picket.extrude, extent: {type: 'distance', distance: 340}}});
  await validate();
  assert(Math.abs(span(await bodyById(picket.body.id), 2) - 340) < 1e-4);
  report.checks.push('native feature history', 'face-referenced assembly poses', 'picket height 315 → 340 with downstream fillets');
  const saved = await call('cad_project_model');
  const restored = new Client(option('--server'));
  try {
    await restored.start(); await restored.call('cad_load_project_model', {model_json: saved});
    await validate(restored);
    await restored.call('solid_edit_extrude', {feature_id: picket.feature.id, extrude: {...picket.extrude, extent: {type: 'distance', distance: 350}}});
    assert(Math.abs(span((await restored.call('solid_scene')).bodies.find(b => b.id === picket.body.id), 2) - 350) < 1e-4);
    await validate(restored);
    report.checks.push('fresh process restore and subsequent feature edit');
  } finally { restored.close(); }
  if (session) {
    await client.call('cad_interface', {action: 'view', view: 'isometric', fit: true});
    if (option('--save')) await client.call('cad_interface', {action: 'file', command: 'save', path: resolve(option('--save'))});
    await client.call('cad_interface', {action: 'window', mode: 'foreground'});
  }
  if (option('--out')) {
    await mkdir(resolve(option('--out')), {recursive: true});
    await writeFile(resolve(option('--out'), 'model.json'), saved);
    await writeFile(resolve(option('--out'), 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log('PASS Crown garden bench', report.checks);
} finally { client.close(); }
