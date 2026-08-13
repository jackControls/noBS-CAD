import { translate } from '../i18n';

export type UnsavedDecision = 'save' | 'discard' | 'cancel';
export type UnsavedPromptKind = 'close' | 'quit' | 'replace';

interface PendingUnsavedPrompt {
  kind: UnsavedPromptKind;
  projectName: string | null;
  resolve: (decision: UnsavedDecision) => void;
}

let pending: PendingUnsavedPrompt | null = null;

/**
 * Application-owned unsaved-work prompt. Keeping this above the native Bevy
 * viewport makes window close, Cmd/Ctrl+Q, tab close, and Open use one
 * observable decision path on macOS, Windows, and in browser development.
 */
export function requestUnsavedDecision(
  kind: UnsavedPromptKind,
  projectName: string | null = null,
): Promise<UnsavedDecision> {
  if (pending) return Promise.resolve('cancel');
  return new Promise((resolve) => {
    pending = { kind, projectName, resolve };
    window.dispatchEvent(new CustomEvent('nbcad:unsaved-prompt-change'));
  });
}

export function currentUnsavedPrompt(): Omit<PendingUnsavedPrompt, 'resolve'> | null {
  return pending ? { kind: pending.kind, projectName: pending.projectName } : null;
}

export function resolveUnsavedPrompt(decision: UnsavedDecision): void {
  const request = pending;
  if (!request) return;
  pending = null;
  window.dispatchEvent(new CustomEvent('nbcad:unsaved-prompt-change'));
  request.resolve(decision);
}

export function unsavedPromptMessage(kind: UnsavedPromptKind): string {
  if (kind === 'quit') return translate('file.quitSaveConfirm');
  if (kind === 'replace') return translate('file.replaceSaveConfirm');
  return translate('file.closeSaveConfirm');
}
