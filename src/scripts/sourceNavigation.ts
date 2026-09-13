/** Locate a validated steps[stepIndex - 1].note string without executing source.
 * Metadata uses one-based step positions; matching text elsewhere is not a chapter. */
export function findNoteRange(source: string, text: string, stepIndex: number | undefined): [number, number] | null {
  if (!Number.isInteger(stepIndex) || stepIndex! < 1) return null;
  type Frame = {kind: 'object' | 'array'; path: Array<string | number>; key: string | null; expectingKey: boolean; index: number};
  const stack: Frame[] = [];
  let range: [number, number] | null = null;
  const valuePath = () => {
    const parent = stack[stack.length - 1];
    return parent ? [...parent.path, parent.kind === 'array' ? parent.index : parent.key!] : [];
  };
  const tokens = source.matchAll(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[{}\[\],:]/g);
  for (const token of tokens) {
    const raw = token[0];
    if (raw.startsWith('/')) continue;
    if (raw === '{' || raw === '[') {
      const path = valuePath();
      // serde_json uses the last duplicate object property. Match that same
      // source when a document repeats its top-level steps or a note field.
      if (path.length === 1 && path[0] === 'steps') range = null;
      stack.push({kind: raw === '{' ? 'object' : 'array', path, key: null, expectingKey: raw === '{', index: 0});
      continue;
    }
    if (raw === '}' || raw === ']') { stack.pop(); continue; }
    const frame = stack[stack.length - 1];
    if (raw === ',') {
      if (frame?.kind === 'array') frame.index++;
      else if (frame) { frame.key = null; frame.expectingKey = true; }
      continue;
    }
    if (!raw.startsWith('"')) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    if (frame?.kind === 'object' && frame.expectingKey) {
      frame.key = value as string;
      frame.expectingKey = false;
      continue;
    }
    const path = valuePath();
    if (path.length === 3 && path[0] === 'steps' && path[1] === stepIndex! - 1 && path[2] === 'note') {
      range = value === text ? [token.index!, token.index! + raw.length] : null;
    }
  }
  return range;
}
