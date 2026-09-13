import { getEngine } from '../engine';
import type { CamPostConfigDto, CamPostResultDto } from '../engine/types';
import { chooseSaveTarget, writeSaveTarget, type SaveType } from '../files/fileIO';
import { useAppStore } from '../store/appStore';

function safeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'program';
}

/** Prepare and verify, then let the operator review warnings before saving.
 * Captured identity is rechecked even after the asynchronous save picker. */
export async function prepareActiveCamProgram(
  post: CamPostConfigDto,
  programName: string | null,
): Promise<{ result: CamPostResultDto; save: () => Promise<boolean> }> {
  const state = useAppStore.getState();
  const setupId = state.camDocument.active_setup_id;
  if (setupId === null) throw new Error('Create a CAM setup before posting NC code.');
  const setup = state.camDocument.setups.find((candidate) => candidate.id === setupId);
  if (!setup) throw new Error('The active CAM setup no longer exists.');

  const result = await (await getEngine()).camPost({
    setup_id: setupId,
    post,
    program_name: programName,
  });
  const ensureCurrent = () => {
    const now = useAppStore.getState();
    if (now.camDocument !== state.camDocument || now.solidScene !== state.solidScene
      || now.document !== state.document) {
      throw new Error('The project or machine settings changed. Review and verify NC output again before saving.');
    }
  };
  ensureCurrent();
  const extension = `.${result.extension.replace(/^\./, '')}`;
  const saveType: SaveType = {
    description: `${post.dialect.toUpperCase()} CNC program`,
    extension,
    mime: 'text/plain',
  };
  const projectName = state.document?.name ?? 'Untitled';
  return {
    result,
    save: async () => {
      ensureCurrent();
      const target = await chooseSaveTarget(
        `${safeFileStem(projectName)}-${safeFileStem(programName ?? setup.name)}${extension}`,
        saveType,
      );
      if (!target) return false;
      ensureCurrent();
      await writeSaveTarget(target, new TextEncoder().encode(result.nc));
      return true;
    },
  };
}

export async function exportPostEvents(): Promise<boolean> {
  const state = useAppStore.getState();
  const setupId = state.camDocument.active_setup_id;
  if (setupId === null) throw new Error('Create a CAM setup before exporting post events.');
  const setup = state.camDocument.setups.find((candidate) => candidate.id === setupId);
  if (!setup) throw new Error('The active CAM setup no longer exists.');
  const events = await (await getEngine()).camPostEvents(setupId);
  const target = await chooseSaveTarget(
    `${safeFileStem(state.document?.name ?? 'Untitled')}-${safeFileStem(setup.name)}-post-events.json`,
    {
      description: 'noBS CAM post event stream',
      extension: '.json',
      mime: 'application/json',
    },
  );
  if (!target) return false;
  await writeSaveTarget(
    target,
    new TextEncoder().encode(`${JSON.stringify(events, null, 2)}\n`),
  );
  return true;
}
