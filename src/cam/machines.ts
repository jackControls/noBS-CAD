import type { CamMachineAssignmentDto, CamMachineToolBindingDto, CamPostConfigDto, CamPostDialect } from '../engine/types';

export const MACHINE_PRESETS: { dialect: CamPostDialect; label: string }[] = [
  { dialect: 'siemens828d', label: 'Siemens 828D · native · 3-axis' },
  { dialect: 'fanuc', label: 'Generic FANUC-style · 3-axis' },
  { dialect: 'haas', label: 'Haas NGC · 3-axis' },
  { dialect: 'mitsubishi', label: 'Mitsubishi M80/M800 · 3-axis' },
  { dialect: 'mazak', label: 'Mazak EIA milling · 3-axis' },
  { dialect: 'syntec', label: 'Syntec milling · 3-axis' },
  { dialect: 'okuma', label: 'Okuma OSP milling · 3-axis' },
  { dialect: 'heidenhain', label: 'Heidenhain TNC · 3-axis' },
  { dialect: 'hermle_heidenhain', label: 'Hermle / Heidenhain · fixed 3-axis' },
  { dialect: 'linux_cnc', label: 'LinuxCNC · 3-axis' },
  { dialect: 'grbl', label: 'GRBL · 3-axis' },
];

/** Starter data, never inferred from a controller brand or a magazine style.
 * A chosen machine is embedded in the project, not linked to mutable presets. */
export function createMachineAssignment(dialect: CamPostDialect): CamMachineAssignmentDto {
  const controllers: Record<CamPostDialect, CamMachineAssignmentDto['profile']['controller']> = {
    siemens828d: { family: 'siemens', language: 'siemens_native', model: '828D', software_version: null },
    fanuc: { family: 'fanuc', language: 'fanuc_style', model: 'Generic FANUC-style', software_version: null },
    haas: { family: 'haas', language: 'fanuc_style', model: 'Haas NGC', software_version: null },
    mitsubishi: { family: 'mitsubishi', language: 'fanuc_style', model: 'Mitsubishi M80/M800', software_version: null },
    mazak: { family: 'mazak', language: 'fanuc_style', model: 'Mazak EIA milling', software_version: null },
    syntec: { family: 'syntec', language: 'fanuc_style', model: 'Syntec milling', software_version: null },
    okuma: { family: 'okuma', language: 'okuma_osp', model: 'Okuma OSP milling', software_version: null },
    heidenhain: { family: 'heidenhain', language: 'heidenhain_conversational', model: 'Heidenhain TNC', software_version: null },
    hermle_heidenhain: { family: 'heidenhain', language: 'heidenhain_conversational', model: 'Hermle / Heidenhain TNC — fixed axis', software_version: null },
    linux_cnc: { family: 'linux_cnc', language: 'linux_cnc', model: 'LinuxCNC', software_version: null },
    grbl: { family: 'grbl', language: 'grbl', model: 'GRBL', software_version: null },
  };
  return {
    tool_calls: [],
    profile: {
      schema_version: 1, id: crypto.randomUUID(), revision: 1,
      name: MACHINE_PRESETS.find(p => p.dialect === dialect)!.label,
      process: 'milling',
      axes: ['X', 'Y', 'Z'].map((id, i) => ({
        id, kind: 'linear', parent_axis_id: null,
        direction: { x: +(i === 0), y: +(i === 1), z: +(i === 2) },
        origin: { x: 0, y: 0, z: 0 }, limits: null,
      })),
      spindles: [{ id: 'tool-spindle', role: 'tool', parent_axis_id: 'Z' }],
      channels: [{ id: 'main', axis_ids: ['X', 'Y', 'Z'], spindle_ids: ['tool-spindle'] }],
      controller: controllers[dialect],
      post: {
        dialect, program_number: 1001, sequence_numbers: ['siemens828d', 'heidenhain', 'hermle_heidenhain'].includes(dialect),
        tool_call_mode: 'automatic', machine_retract_z: null,
        siemens_828d: dialect === 'siemens828d' ? {
          atc_style: 'double_arm', tool_change_positioning: 'supa_z', supa_retract_z: 0,
          station_x: null, station_y: null, tool_length_offset: 1,
          optional_stop_on_tool_change: false, preload_next_tool: false,
        } : null,
      },
    },
    mode: 'fixed3_axis', channel_id: 'main', tool_spindle_id: 'tool-spindle', workpiece_spindle_id: null, workpiece_mount_axis_id: null,
  };
}

export function reviseMachine(
  machine: CamMachineAssignmentDto, name: string, post = machine.profile.post,
  toolCalls: CamMachineToolBindingDto[] = machine.tool_calls ?? [],
): CamMachineAssignmentDto {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give this machine a shop name.');
  const result = structuredClone(machine);
  if (post.siemens_828d?.spindle_stop_subprogram) result.profile.schema_version = 2;
  if (trimmed !== result.profile.name || JSON.stringify(post) !== JSON.stringify(result.profile.post)
    || JSON.stringify(toolCalls) !== JSON.stringify(result.tool_calls ?? [])) {
    result.profile.revision += 1;
    result.profile.name = trimmed;
    result.profile.post = structuredClone(post);
    result.tool_calls = structuredClone(toolCalls);
  }
  return result;
}

/** Per-device convenience only. Saved projects never consult this preference.
 * Keep it small and fail to generic when the local preference is malformed;
 * the Rust model remains authoritative for imported machine validation. */
const DEFAULT_KEY = 'nbcad.cam.default-machine.v1';
// Native/WASM JSON may order object fields differently from the UI. Compare
// data, not insertion order, while retaining array order and unknown fields.
function machineDataKey(value: unknown): string {
  return JSON.stringify(value, (_key, node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const record = node as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
}
function validDefaultPost(post: CamPostConfigDto): boolean {
  if (post.tool_call_mode !== undefined && !['automatic', 'number', 'name'].includes(post.tool_call_mode)) return false;
  if (post.machine_retract_z != null && (typeof post.machine_retract_z !== 'number' || !Number.isFinite(post.machine_retract_z))) return false;
  if (typeof post.sequence_numbers !== 'boolean'
    || (post.program_number !== null && (!Number.isSafeInteger(post.program_number) || post.program_number < 0))) return false;
  if (post.dialect !== 'siemens828d') return post.siemens_828d === null;
  const s = post.siemens_828d;
  if (s?.spindle_stop_subprogram != null && (typeof s.spindle_stop_subprogram !== 'string'
    || !/^[A-Za-z][A-Za-z0-9_]{2,30}$/.test(s.spindle_stop_subprogram) || !s.spindle_stop_subprogram.includes('_'))) return false;
  return !!s && ['double_arm', 'umbrella', 'carousel_chain', 'other'].includes(s.atc_style)
    && ['supa_z', 'controller_managed', 'supa_z_then_xy'].includes(s.tool_change_positioning)
    && typeof s.supa_retract_z === 'number' && Number.isFinite(s.supa_retract_z)
    && [s.station_x, s.station_y].every(v => v === null || (typeof v === 'number' && Number.isFinite(v)))
    && Number.isSafeInteger(s.tool_length_offset) && s.tool_length_offset >= 1 && s.tool_length_offset <= 999
    && typeof s.optional_stop_on_tool_change === 'boolean' && typeof s.preload_next_tool === 'boolean';
}
export function readDefaultMachine(): CamMachineAssignmentDto | null {
  try {
    const raw = localStorage.getItem(DEFAULT_KEY);
    if (!raw || raw.length > 16_384) return null;
    const m = JSON.parse(raw) as CamMachineAssignmentDto;
    if (!m?.profile || ![1, 2].includes(m.profile.schema_version) || !m.profile.id || !m.profile.name
      || (m.profile.post?.siemens_828d?.spindle_stop_subprogram != null && m.profile.schema_version < 2)
      || !Number.isSafeInteger(m.profile.revision) || m.profile.revision < 1
      || !MACHINE_PRESETS.some(p => p.dialect === m.profile.post?.dialect)
      || !validDefaultPost(m.profile.post)
      || m.mode !== 'fixed3_axis' || m.profile.process !== 'milling'
      || m.workpiece_mount_axis_id != null
      || !Array.isArray(m.profile.axes) || m.profile.axes.length !== 3
      || !Array.isArray(m.profile.spindles) || m.profile.spindles.length !== 1
      || !Array.isArray(m.profile.channels) || m.profile.channels.length !== 1) return null;
    // Round-trip only our current UI's supported starter topology. Future
    // definitions stay in project snapshots, not in this lightweight store.
    const starter = createMachineAssignment(m.profile.post.dialect);
    if (machineDataKey([m.profile.axes, m.profile.spindles, m.profile.channels, m.channel_id, m.tool_spindle_id, m.workpiece_spindle_id])
      !== machineDataKey([starter.profile.axes, starter.profile.spindles, starter.profile.channels, starter.channel_id, starter.tool_spindle_id, starter.workpiece_spindle_id])
      || machineDataKey(m.profile.controller) !== machineDataKey(starter.profile.controller)) return null;
    // Tool ids belong to the saved project, never to a device preset.
    return { ...m, tool_calls: [] };
  } catch { return null; }
}

export function saveDefaultMachine(machine: CamMachineAssignmentDto | null): void {
  if (machine) localStorage.setItem(DEFAULT_KEY, JSON.stringify({ ...machine, tool_calls: [] }));
  else localStorage.removeItem(DEFAULT_KEY);
}

/** Explain the built-in policy without implying that a brand guarantees
 * machine settings. Numerical checks use the actual generated blocks in Rust. */
export function compensationGuidance(dialect: CamPostConfigDto['dialect']): string {
  switch (dialect) {
    case 'siemens828d': return 'Native Siemens: G1 engagement/cancellation with XY travel, NORM approach and explicit G451 intersection corners (outside turns up to 90°). Rounded leads are optional. Verify the machine-data corner-switch limit; Z-only startup and G450 transitions are not supported.';
    case 'fanuc': case 'haas': case 'mitsubishi': case 'mazak': case 'syntec': return 'Fixed-axis ISO milling: G1 XY compensation entry/exit at least the project tool radius, explicit G43 H from the tool number and machine-coordinate G53 retracts. No probing, rotary or builder macros.';
    case 'okuma': return 'OSP milling: G15 H1–H6 work offsets, G56 H tool length and G16 H0 machine-coordinate retracts. Compensation uses G1 XY entry/exit at least the tool radius. NC replay is not supported for OSP.';
    case 'heidenhain': case 'hermle_heidenhain': return 'Fixed-axis TNC: TOOL CALL, preset rows 1–6 (cycle 247), L/CC/C and M91 retracts. Compensation entry/exit at least the tool radius. No rotary or builder macros; conversational NC replay is not supported.';
    case 'linux_cnc': return 'LinuxCNC: G1 XY entry at least the project tool radius; cancellation exit longer than the diameter.';
    case 'grbl': return 'GRBL requires in-computer cutter compensation; G41/G42 output is blocked.';
  }
}
