import type { CamDocumentDto, CamOperationDto, CamSetupDto } from '../engine/types';

/** Capture the programming destination when the dialog opens. Viewport picks
 * and library navigation must not move a new path's eventual insertion point. */
export interface CamOperationPlacement {
  setupId: number;
  beforeOperationId: number | null;
}

export function camOperationPlacement(
  cam: CamDocumentDto,
  selectedOperationId: number | null,
): CamOperationPlacement | undefined {
  const owner = selectedOperationId === null ? undefined
    : cam.setups.find(s => s.operations.some(o => o.id === selectedOperationId));
  const setup = owner ?? cam.setups.find(s => s.id === cam.active_setup_id);
  return setup ? { setupId: setup.id, beforeOperationId: owner ? selectedOperationId : null } : undefined;
}

/** Do not silently append if an explicitly chosen destination was deleted. */
export function insertCamOperation(
  cam: CamDocumentDto,
  operation: CamOperationDto,
  placement?: CamOperationPlacement,
): CamSetupDto {
  const setup = cam.setups.find(s => s.id === (placement?.setupId ?? cam.active_setup_id));
  if (!setup) throw new Error('The destination setup no longer exists. Reopen the toolpath dialog.');
  const before = placement?.beforeOperationId;
  const index = before == null ? setup.operations.length : setup.operations.findIndex(o => o.id === before);
  if (index < 0) throw new Error('The selected insertion toolpath no longer exists. Reopen the toolpath dialog.');
  setup.operations.splice(index, 0, operation);
  return setup;
}

function nextId(counter: number, used: number[]): number {
  const id = used.reduce((next, value) => Math.max(next, value + 1), Math.max(1, counter));
  if (!Number.isSafeInteger(id) || id >= Number.MAX_SAFE_INTEGER) throw new Error('CAM identity space is exhausted.');
  return id;
}

function copyName(name: string, taken: string[]): string {
  const names = new Set(taken);
  let suffix = ' (copy)', n = 2;
  while (names.has(name + suffix)) suffix = ` (copy ${n++})`;
  return name + suffix;
}

function copyOperationRecords(next: CamDocumentDto, source: CamDocumentDto, ids: Map<number, number>): void {
  for (const record of source.height_expressions ?? []) {
    const id = ids.get(record.operation_id);
    if (id !== undefined) (next.height_expressions ??= []).push({ ...structuredClone(record), operation_id: id });
  }
  for (const record of source.linking ?? []) {
    const id = ids.get(record.operation_id);
    if (id !== undefined) (next.linking ??= []).push({ ...structuredClone(record), operation_id: id });
  }
  // Generation/verification records are not intent and are never cloned.
  // Shared project tools and referenced CAD bodies keep their existing IDs.
}

export function duplicatedCamOperation(cam: CamDocumentDto, operationId: number) {
  const next = structuredClone(cam);
  const setup = next.setups.find(s => s.operations.some(o => o.id === operationId));
  if (!setup) throw new Error('The toolpath no longer exists.');
  const index = setup.operations.findIndex(o => o.id === operationId);
  const operation = structuredClone(setup.operations[index]);
  operation.id = nextId(next.next_operation_id, next.setups.flatMap(s => s.operations.map(o => o.id)));
  operation.name = copyName(operation.name, setup.operations.map(o => o.name));
  setup.operations.splice(index + 1, 0, operation);
  copyOperationRecords(next, cam, new Map([[operationId, operation.id]]));
  next.next_operation_id = operation.id + 1;
  next.active_setup_id = setup.id;
  return { document: next, setupId: setup.id, operationId: operation.id };
}

export function duplicatedCamSetup(cam: CamDocumentDto, setupId: number) {
  const next = structuredClone(cam);
  const index = next.setups.findIndex(s => s.id === setupId);
  if (index < 0) throw new Error('The setup no longer exists.');
  const setup = structuredClone(next.setups[index]);
  setup.id = nextId(next.next_setup_id, next.setups.map(s => s.id));
  setup.name = copyName(setup.name, next.setups.map(s => s.name));
  const ids = new Map<number, number>();
  let id = nextId(next.next_operation_id, next.setups.flatMap(s => s.operations.map(o => o.id)));
  for (const operation of setup.operations) {
    if (id >= Number.MAX_SAFE_INTEGER) throw new Error('CAM identity space is exhausted.');
    ids.set(operation.id, id);
    operation.id = id++;
  }
  // Retain the same incoming stock, WCS, machine snapshot and work offsets.
  // Existing rest-source links still point at their original source, not this
  // copy; placing it immediately after its source preserves their ordering.
  next.setups.splice(index + 1, 0, setup);
  copyOperationRecords(next, cam, ids);
  next.next_setup_id = setup.id + 1;
  next.next_operation_id = id;
  next.active_setup_id = setup.id;
  return { document: next, setupId: setup.id };
}
