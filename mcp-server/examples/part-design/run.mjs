import assert from 'node:assert/strict';
import {Client as StdioClient} from '../../client.mjs';

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const binary = option('--server') ?? process.env.NBCAD_MCP_BIN;
assert(binary, 'Use --server /path/to/nbcad-mcp or set NBCAD_MCP_BIN');
const output = option('--out');

export class Client extends StdioClient {
  constructor() { super(binary); }
}

function geometry(scene, expected) {
  assert.equal(scene.errors.length, 0, 'recompute errors');
  assert.equal(scene.bodies.length, 1, 'one solid body');
  const { positions, indices } = scene.bodies[0].mesh;
  assert(indices.length > 0 && indices.length % 3 === 0, 'nonempty triangle mesh');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    assert(Number.isFinite(positions[i]), 'finite vertex');
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const points = indices.slice(i, i + 3).map(index => {
      assert(Number.isInteger(index) && index >= 0 && index * 3 + 2 < positions.length, 'valid mesh index');
      return positions.slice(index * 3, index * 3 + 3);
    });
    const [a, b, c] = points;
    volume += (a[0] * (b[1]*c[2]-b[2]*c[1]) + a[1] * (b[2]*c[0]-b[0]*c[2]) + a[2] * (b[0]*c[1]-b[1]*c[0])) / 6;
  }
  volume = Math.abs(volume);
  for (let i = 0; i < 3; i++) {
    assert(Math.abs(min[i] - expected.min[i]) < 0.1, `bbox min ${i}: ${min}`);
    assert(Math.abs(max[i] - expected.max[i]) < 0.1, `bbox max ${i}: ${max}`);
  }
  assert(Math.abs(volume - expected.volume) / expected.volume < expected.volume_relative_tolerance, `volume ${volume}, expected ${expected.volume} mm³`);
  return { min, max, volume_mm3: volume, triangles: indices.length / 3 };
}

export function resolveArguments(value, scene) {
  const body = scene?.bodies[0];
  const top = () => {
    assert(body, 'body required for face selection');
    const faces = body.faces.filter(face => face.plane?.normal[2] > 0.99);
    assert.equal(faces.length, 1, 'exactly one upward planar face required');
    return faces[0];
  };
  if (value === '$body_id') { assert(body); return body.id; }
  if (value === '$top_face_id') return top().id;
  if (value?.$top_uv) {
    const { origin, u, v } = top().plane;
    const delta = value.$top_uv.map((n, i) => n - origin[i]);
    return { x: delta.reduce((sum, n, i) => sum + n*u[i], 0), y: delta.reduce((sum, n, i) => sum + n*v[i], 0) };
  }
  if (Array.isArray(value)) return value.map(item => resolveArguments(item, scene));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveArguments(item, scene)]));
  return value;
}

async function run(file) {
  const example = JSON.parse(await readFile(resolve(here, file), 'utf8'));
  const client = new Client();
  let replay, restored, imported;
  try {
    await client.start();
    let scene;
    const transcript = [];
    for (const step of example.calls) {
      const arguments_ = resolveArguments(step.arguments, scene);
      await client.call(step.name, arguments_);
      transcript.push({ name: step.name, arguments: arguments_ });
      scene = await client.call('solid_scene');
    }
    const measured = geometry(scene, example.expected);
    const project = await client.call('cad_project_model');
    const script = await client.call('cad_script');
    replay = new Client();
    await replay.start();
    for (const call of script.calls) await replay.call(call.name, call.arguments);
    geometry(await replay.call('solid_scene'), example.expected);
    restored = new Client();
    await restored.start();
    await restored.call('cad_load_project_model', { model_json: project });
    geometry(await restored.call('solid_scene'), example.expected);

    const files = {};
    for (const format of ['step', 'stl', '3mf']) {
      const exported = await client.call(`solid_export_${format}`, format === '3mf' ? { slicer_target: 'standard' } : {});
      assert.equal(exported.format, format);
      assert.equal(exported.encoding, 'base64');
      const bytes = Buffer.from(exported.bytes_base64, 'base64');
      assert(bytes.length > 100, `${format} payload`);
      if (format === 'step') assert(bytes.toString().includes('ISO-10303-21;') && bytes.toString().includes('END-ISO-10303-21;'), 'STEP envelope');
      if (format === '3mf') assert(bytes.readUInt32LE(0) === 0x04034b50 && bytes.includes(Buffer.from('3D/3dmodel.model')), '3MF package model');
      if (format === 'stl') assert.equal(bytes.length, 84 + 50 * bytes.readUInt32LE(80), 'binary STL triangle length');
      files[format] = bytes;
    }
    imported = new Client();
    await imported.start();
    await imported.call('solid_import_step', { file_name: `${example.id}.step`, data_base64: files.step.toString('base64') });
    geometry(await imported.call('solid_scene'), example.expected);
    if (output) {
      const folder = resolve(output, example.id);
      await mkdir(folder, { recursive: true });
      await writeFile(resolve(folder, 'model.json'), project);
      await writeFile(resolve(folder, 'calls.json'), JSON.stringify(transcript, null, 2));
      await writeFile(resolve(folder, 'script.json'), JSON.stringify(script, null, 2));
      await writeFile(resolve(folder, 'checks.json'), JSON.stringify(measured, null, 2));
      for (const [extension, bytes] of Object.entries(files)) await writeFile(resolve(folder, `${example.id}.${extension}`), bytes);
    }
    console.log(`PASS ${example.id}: ${measured.volume_mm3.toFixed(2)} mm³; replay, model restore, STEP round trip, STL/3MF`);
  } finally { client.close(); replay?.close(); restored?.close(); imported?.close(); }
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of ['mounting-plate.json', 'spacer.json', 'angle-bracket.json']) await run(file);
}
