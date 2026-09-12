/** Semantic automation of the controls users actually see. No CSS selectors,
 * script evaluation, or per-dialog copies of business logic cross this API. */
export interface UiControl {
  id: string;
  surface: string;
  label: string;
  role: string;
  disabled: boolean;
  expanded?: boolean;
  selected?: boolean;
  value?: string | boolean;
  /** Long text is an excerpt around the caret; offsets use UTF-16 code units. */
  value_truncated?: true;
  value_length?: number;
  value_start?: number;
  selection?: { start: number; end: number };
  options?: Array<{ value: string; label: string; disabled: boolean }>;
}

const selector = 'button,details > summary,input:not([type="hidden"]),select,textarea,a[href],[role="button"],[role="tab"],[role="treeitem"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="checkbox"],[role="radio"],[contenteditable="true"],[tabindex="0"]';
const dialogSelector = '[role="dialog"],[role="alertdialog"],.feature-dialog';
let snapshot = 0;
let inspectedContext: unknown;
let current = new Map<string, { element: HTMLElement; label: string; surface: string }>();

function disclosureDetails(element: HTMLElement): HTMLDetailsElement | null {
  const parent = element.parentElement;
  return element.tagName === 'SUMMARY' && parent instanceof HTMLDetailsElement
    && [...parent.children].find(child => child.tagName === 'SUMMARY') === element ? parent : null;
}

export function visible(element: HTMLElement): boolean {
  // A closed disclosure exposes only its first summary, including any controls
  // inside that summary. CSS boxes alone do not capture this native UI state.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement && !parent.open) {
      const summary = [...parent.children].find(child => child.tagName === 'SUMMARY');
      if (!summary?.contains(element)) return false;
    }
  }
  const style = getComputedStyle(element);
  return element.isConnected && !element.closest('[hidden],[inert],[aria-hidden="true"]')
    && style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function label(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby');
  const linked = labelledBy?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
  const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map(l => {
    const copy = l.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('input,select,textarea,button').forEach(control => control.remove());
    return copy.textContent;
  }).join(' ') : '';
  return (element.getAttribute('aria-label') || linked || labels || element.title
    || element.getAttribute('placeholder') || (element instanceof HTMLInputElement ? '' : element.textContent) || '')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

function surface(element: HTMLElement): string {
  const menu = element.closest('[role="menu"]');
  if (menu) return `menus/${menu.getAttribute('data-testid') || menu.getAttribute('aria-label') || 'context-menu'}`;
  const dialog = element.closest(dialogSelector);
  if (dialog) return `dialogs/${dialog.getAttribute('data-testid') || dialog.getAttribute('aria-label') || dialog.querySelector('header')?.textContent?.trim() || 'dialog'}`;
  return element.closest('[data-interface-group]')?.getAttribute('data-interface-group')
    || element.closest('[data-mcp-surface]')?.getAttribute('data-mcp-surface') || 'application';
}

function dialogText(element: HTMLElement): { text: string; text_truncated?: true } {
  const limit = 4096;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !visible(parent) || (parent instanceof HTMLDetailsElement && !parent.open)
      || parent.closest('input,textarea,select,script,style,[contenteditable]:not([contenteditable="false"]),[data-mcp-presentation]')) continue;
    const part = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!part) continue;
    const remaining = limit - text.length - (text ? 1 : 0);
    if (part.length > remaining) return {text: (text + (text ? ' ' : '') + part.slice(0, Math.max(0, remaining))).slice(0, limit), text_truncated: true};
    text += (text ? ' ' : '') + part;
  }
  return {text};
}

export function inspectUi(context?: unknown) {
  inspectedContext = context;
  snapshot++;
  const controls: UiControl[] = [];
  current = new Map();
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (!visible(element) || element.closest('[data-mcp-presentation]')) continue;
    const details = disclosureDetails(element);
    if (element.tagName === 'SUMMARY' && !details) continue;
    const id = `control-${snapshot}-${current.size + 1}`;
    current.set(id, { element, label: label(element), surface: surface(element) });
    const disabled = element.matches(':disabled,[aria-disabled="true"]') || element.closest('[aria-disabled="true"]') !== null;
    const control: UiControl = { id, surface: surface(element), label: label(element),
      role: element.getAttribute('role') || (details ? 'button' : element instanceof HTMLInputElement ? element.type : element.tagName.toLowerCase()), disabled };
    if (details) control.expanded = details.open;
    else if (element.hasAttribute('aria-expanded')) control.expanded = element.getAttribute('aria-expanded') === 'true';
    if (element.hasAttribute('aria-selected')) control.selected = element.getAttribute('aria-selected') === 'true';
    if (element instanceof HTMLInputElement && element.type !== 'password' && element.type !== 'file') {
      control.value = ['checkbox', 'radio'].includes(element.type) ? element.checked : element.value;
    } else if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) control.value = element.value;
    if (element instanceof HTMLTextAreaElement) {
      control.selection = {start: element.selectionStart, end: element.selectionEnd};
    }
    // Inspecting a long recipe must not copy megabytes into every UI reply.
    // Keep the actual field intact and expose the selected chapter's vicinity.
    if (typeof control.value === 'string' && control.value.length > 4096) {
      const value = control.value;
      let start = Math.max(0, Math.min((control.selection?.start ?? 0) - 512, value.length - 4096));
      // Skip a bisected pair at the start rather than shifting left: a caret
      // at EOF must still see the final character of its document.
      if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start])) start++;
      let end = Math.min(value.length, start + 4096);
      if (/[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      control.value = value.slice(start, end);
      control.value_truncated = true;
      control.value_length = value.length;
      control.value_start = start;
    }
    if (element instanceof HTMLSelectElement) control.options = Array.from(element.options).map(o => ({ value: o.value, label: o.text, disabled: o.disabled }));
    controls.push(control);
  }
  const dialogs = [...document.querySelectorAll<HTMLElement>(dialogSelector)]
    .filter(element => visible(element) && !element.closest('[data-mcp-presentation]'));
  return {
    canvases: [...document.querySelectorAll<HTMLElement>('[data-mcp-canvas]')].filter(visible).map(element => {
      const {x,y,width,height} = element.getBoundingClientRect();
      return {name:element.getAttribute('data-mcp-canvas'),x,y,width,height};
    }),
    surfaces: [...new Set([...controls.map(c => c.surface), ...dialogs.map(surface)])].map(name => {
      const messages = dialogs.filter(element => surface(element) === name).map(dialogText);
      const text = messages.map(message => message.text).filter(Boolean).join('\n\n');
      return {name, controls: controls.filter(c => c.surface === name),
        ...(messages.length ? {text: text.slice(0, 4096), ...(text.length > 4096 || messages.some(message => message.text_truncated) ? {text_truncated: true} : {})} : {})};
    }),
    unlabeled_controls: controls.filter(c => !c.label).map(c => ({ id: c.id, surface: c.surface, role: c.role })),
    document_visible: document.visibilityState === 'visible',
    focused_control: [...current].find(([, value]) => value.element === document.activeElement)?.[0] ?? null,
  };
}

export interface UiAction { action: 'inspect' | 'click' | 'double_click' | 'context_menu' | 'set_value' | 'key'; target?: string; value?: string; key?: string }

export function operateUi(request: UiAction, context?: unknown): HTMLElement | null {
  if (request.action === 'inspect') return null;
  const observed = request.target ? current.get(request.target) : null;
  const element = observed?.element;
  if (inspectedContext !== context) throw new Error('Document changed; inspect the UI again');
  if (!element || !visible(element)) throw new Error('Control is stale or unavailable; inspect the UI again');
  if (observed.label !== label(element) || observed.surface !== surface(element)) throw new Error('Control changed; inspect the UI again');
  if (element.matches(':disabled,[aria-disabled="true"]') || element.closest('[aria-disabled="true"]')) throw new Error('Control is disabled');
  const modals = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter(visible);
  const modal = modals[modals.length - 1];
  if (modal && !modal.contains(element)) throw new Error('A modal dialog blocks this control');
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // HTMLElement.click() does not perform the browser's normal focus default.
  // Focus first so fields with onBlur commits behave like an actual UI click.
  element.focus({preventScroll:true});
  if (request.action === 'click') {
    element.click();
  } else if (request.action === 'double_click' || request.action === 'context_menu') {
    const rect = element.getBoundingClientRect();
    if (request.action === 'double_click') element.click();
    element.dispatchEvent(new MouseEvent(request.action === 'double_click' ? 'dblclick' : 'contextmenu', {
      bubbles: true, cancelable: true, button: request.action === 'context_menu' ? 2 : 0,
      detail: request.action === 'double_click' ? 2 : 1, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
    }));
  } else if (request.action === 'set_value') {
    if (typeof request.value !== 'string') throw new Error('set_value requires a string value');
    if (element instanceof HTMLInputElement && ['file','password','checkbox','radio','button','submit'].includes(element.type)) throw new Error('This control does not accept text; use its appropriate UI action');
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Control is not an editable field');
    if ('readOnly' in element && element.readOnly) throw new Error('Field is read-only');
    if (element instanceof HTMLSelectElement && ![...element.options].some(o => o.value === request.value && !o.disabled)) throw new Error('Option is unavailable');
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, request.value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (request.action === 'key') {
    if (!['Enter','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','Delete','Backspace'].includes(request.key ?? '')) throw new Error('Unsupported key');
    element.focus();
    const accepted = element.dispatchEvent(new KeyboardEvent('keydown', { key: request.key, bubbles: true, cancelable: true }));
    // Synthetic key events do not trigger the browser's native form default.
    if (accepted && request.key === 'Enter' && element instanceof HTMLInputElement) element.form?.requestSubmit();
    if (accepted && request.key === 'Enter' && disclosureDetails(element)) element.click();
    element.dispatchEvent(new KeyboardEvent('keyup', { key: request.key, bubbles: true }));
  } else throw new Error('Unsupported UI action');
  return element;
}
