import { getEngine } from '../engine';
import type { CamCutterGeometryDto, CamCutterMeshDto, CamToolDto } from '../engine/types';

export function cutterGeometry(tool: CamToolDto): CamCutterGeometryDto {
  return {
    kind: tool.kind, diameter: tool.diameter, flute_length: tool.flute_length,
    overall_length: tool.overall_length, point_angle_degrees: tool.point_angle_degrees,
    corner_radius: tool.corner_radius, corner_chamfer: tool.corner_chamfer ?? null,
  };
}

// Browser/overlay fallback only. Desktop Bevy calls the same Rust mesher
// directly, keeps two GPU meshes, and changes only transforms during playback.
// Bounded small geometry cache: no poses, stock or project data are retained.
const meshes = new Map<string, { mesh: CamCutterMeshDto | null }>();
export function cachedCutterMesh(tool: CamToolDto): CamCutterMeshDto | null {
  const geometry = cutterGeometry(tool), key = JSON.stringify(geometry);
  const old = meshes.get(key);
  if (old) { meshes.delete(key); meshes.set(key, old); return old.mesh; }
  const entry = { mesh: null as CamCutterMeshDto | null };
  meshes.set(key, entry);
  while (meshes.size > 8) meshes.delete(meshes.keys().next().value!);
  void getEngine().then(e => e.camCutterMesh(geometry)).then(mesh => {
    if (meshes.get(key) !== entry) return;
    entry.mesh = mesh;
    window.dispatchEvent(new Event('cam-cutter-mesh-ready'));
  }, () => { /* Invalid geometry never falls back to a misleading cylinder. */ });
  return null;
}
