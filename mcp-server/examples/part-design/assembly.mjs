import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, resolveArguments } from './run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outIndex = process.argv.indexOf('--out');
const output = outIndex < 0 ? null : resolve(process.argv[outIndex + 1], 'parametric-assembly');
const client = new Client();
let restored;
const transcript = [];
async function call(name, args = {}) {
  const result = await client.call(name, args);
  transcript.push({ name, arguments: args });
  return result;
}
function connector(body, normal, origin) {
  const face = body.faces.find(f => f.plane
    && Math.abs(Math.abs(f.plane.normal.reduce((sum, n, i) => sum + n * normal[i], 0)) - 1) < 1e-6
    && Math.abs(f.plane.normal.reduce((sum, n, i) => sum + n * (origin[i] - f.plane.origin[i]), 0)) < 1e-6);
  assert(face, `planar connector ${body.id}: ${normal}; faces=${JSON.stringify(body.faces.map(f => ({id:f.id,plane:f.plane})))}`);
  return { body_id: body.id, face_id: face.id, face_key: face.key, kind: 'planar_face',
    frame: { origin, primary_axis: normal, secondary_axis: [1, 0, 0] },
    source_surface_frame: { origin: face.plane.origin, primary_axis: face.plane.normal, secondary_axis: face.plane.u } };
}
function height(body) {
  const z = body.mesh.positions.filter((_, i) => i % 3 === 2);
  return Math.max(...z) - Math.min(...z);
}
async function check(c, expectedHeight) {
  const model = JSON.parse(await c.call('cad_project_model'));
  assert.equal(model.sketches.length, 3);
  assert(!model.document.history.features.some(f => f.kind === 'import_step'));
  const assembly = await c.call('assembly_document');
  assert.equal(assembly.component_structure.definitions.length, 3);
  assert.equal(assembly.component_structure.occurrences.length, 4);
  assert.equal(assembly.joints.length, 3);
  const scene = await c.call('solid_scene');
  assert.equal(scene.errors.length, 0);
  assert.equal(scene.bodies.length, 3);
  const bracket = assembly.component_structure.definitions.find(d => d.name === 'angle-bracket');
  const instances = assembly.component_structure.occurrences.filter(o => o.component_id === bracket.id);
  assert.equal(instances.length, 2);
  assert(Math.abs(height(scene.bodies.find(b => b.id === bracket.body_ids[0])) - expectedHeight) < 1e-5);
  const solution = await c.call('assembly_solution');
  assert.equal(solution.solved, true);
  assert.equal(solution.instance_body_poses.filter(p => p.body_id === bracket.body_ids[0]).length, 2);
  const poses = solution.instance_body_poses.filter(p => p.body_id === bracket.body_ids[0]);
  for (const [i, expected] of [[0, [-25, -15, 5]], [1, [25, 15, 5]]]) {
    assert(poses[i].translation.every((n, axis) => Math.abs(n - expected[axis]) < 1e-5), JSON.stringify(poses));
    assert(Math.abs(poses[i].rotation[2]) > 0.999 || Math.abs(poses[i].rotation[3]) > 0.999, 'brackets stay upright');
  }
  assert.equal(solution.diagnostics.length, 0, JSON.stringify(solution.diagnostics));
  return { model, assembly, solution, bracket_height_mm: expectedHeight };
}
try {
  await client.start();
  await call('cad_set_document_name', { name: 'Parametric assembly golden' });
  const parts = [];
  for (const [index, name] of ['mounting-plate', 'spacer', 'angle-bracket'].entries()) {
    const fixture = JSON.parse(await readFile(resolve(here, `${name}.json`), 'utf8'));
    const before = await client.call('solid_scene');
    for (const step of fixture.calls) {
      const scene = await client.call('solid_scene');
      const args = resolveArguments(step.arguments, scene);
      if (args.sketch_name) args.sketch_name = `Sketch${index + 1}`;
      await call(step.name, args);
    }
    const scene = await client.call('solid_scene');
    const body = scene.bodies.find(b => !before.bodies.some(old => old.id === b.id));
    assert(body, `${name} creates a new body`);
    const component = await call('assembly_create_component', { name, body_ids: [body.id], absorb_promoted_bodies: true });
    const assembly = await client.call('assembly_document');
    const occurrence = assembly.component_structure.occurrences.find(o => o.component_id === component.id);
    parts.push({ body, component, occurrence });
  }
  const [plate, spacer, bracket] = parts;
  const copy = await call('assembly_create_occurrence', { component_id: bracket.component.id, name: 'angle-bracket-2' });
  await call('assembly_set_occurrence_grounded', { occurrence_id: plate.occurrence.id, grounded: true });
  for (const [name, part, occurrence, origin, normal] of [
    ['Spacer to plate', spacer, spacer.occurrence, [0, 0, 5], [0, -1, 0]],
    ['Bracket 1 to plate', bracket, bracket.occurrence, [-25, -15, 5], [0, 0, -1]],
    ['Bracket 2 to plate', bracket, copy, [25, 15, 5], [0, 0, -1]],
  ]) {
    const isBracket = part === bracket;
    const second = occurrence === copy;
    const bottom = bracket.body.faces.find(f => f.plane && f.plane.normal[2] < -0.99);
    const centre = [bottom.signature.centroid.x, bottom.signature.centroid.y, bottom.signature.centroid.z];
    assert(!isBracket || centre, JSON.stringify(bottom));
    const angle = second ? 180 : 0;
    const dx = origin[0] + (second ? -1 : 1) * (centre?.[0] ?? 0);
    const dy = origin[1] + (second ? -1 : 1) * (centre?.[1] ?? 0);
    await call('assembly_create_joint', { name, kind: isBracket ? 'planar' : 'rigid',
      // Planar motion already supplies the picked offset. Use the canonical
      // surface anchors so preserving explicit connector frames does not
      // apply that offset twice (also compatible with pre-anchor-fix builds).
      connector_a: connector(plate.body, [0, 0, 1], isBracket ? [0, 0, 5] : origin),
      connector_b: connector(part.body, normal, isBracket ? centre : [0, 0, 0]),
      flipped: !isBracket, grounded_occurrence_id: plate.occurrence.id,
      ...(isBracket ? { angle_offset_deg: angle, angle_limits: { min: angle, max: angle },
        linear_offset_mm: dx, linear_limits: { min: dx, max: dx } } : {}),
      advanced: { connector_a_occurrence_id: plate.occurrence.id, connector_b_occurrence_id: occurrence.id,
        ...(isBracket ? { secondary_linear_offset_mm: dy, secondary_linear_limits: { min: dy, max: dy } } : {}) } });
  }
  await check(client, 20);
  const baseline = await client.call('cad_project_model');
  const model = JSON.parse(baseline);
  const feature = model.document.history.features.filter(f => f.kind === 'extrude').at(-1);
  const fixture = JSON.parse(await readFile(resolve(here, 'angle-bracket.json'), 'utf8'));
  const extrude = fixture.calls.find(c => c.name === 'solid_extrude').arguments;
  await call('solid_edit_extrude', { feature_id: feature.id, extrude: { ...extrude, sketch_name: 'Sketch3', extent: { type: 'distance', distance: 25 } } });
  await check(client, 25);
  const edited = await client.call('cad_project_model');
  restored = new Client();
  await restored.start();
  await restored.call('cad_load_project_model', { model_json: edited });
  const checks = await check(restored, 25);
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, 'baseline.json'), baseline);
    await writeFile(resolve(output, 'model.json'), edited);
    await writeFile(resolve(output, 'calls.json'), JSON.stringify(transcript, null, 2));
    await writeFile(resolve(output, 'checks.json'), JSON.stringify(checks, null, 2));
  }
  console.log('PASS parametric assembly: 3 native sketches, 3 components, 4 instances, rigid spacer and 2 locked planar joints; bracket edit 20→25 mm and fresh-process restore');
} finally { client.close(); restored?.close(); }

