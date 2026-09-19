/**
 * Verify that noBS CAD's product-owned icon registry and provenance inventory
 * remain synchronized. This intentionally uses only Node built-ins so it can
 * run in local development and release CI before dependencies are installed.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = resolve(root, 'src/components/icons.tsx');
const camSourcePath = resolve(root, 'src/components/cam/CamToolIcon.tsx');
const brandPath = resolve(root, 'public/app-icon.svg');
const provenancePath = resolve(root, 'docs/ICON_PROVENANCE.md');
const [source, camSource, brand, provenance] = await Promise.all([
  readFile(sourcePath, 'utf8').then(text => text.replaceAll('\r\n', '\n')),
  readFile(camSourcePath, 'utf8').then(text => text.replaceAll('\r\n', '\n')),
  readFile(brandPath, 'utf8').then(text => text.replaceAll('\r\n', '\n')),
  readFile(provenancePath, 'utf8').then(text => text.replaceAll('\r\n', '\n')),
]);

const glyphBlock = source.match(
  /const GLYPHS: Record<string, ReactNode> = \{([\s\S]*?)\n\};\n\n\/\*\* Stable inventory/,
);
if (!glyphBlock) {
  throw new Error('Could not locate the product-owned GLYPHS registry.');
}
const camGlyphBlock = camSource.match(
  /const CAM_GLYPHS: Record<CamIconId, ReactNode> = \{([\s\S]*?)\n\};\n\n\/\*\* Stable inventory/,
);
if (!camGlyphBlock) {
  throw new Error('Could not locate the product-owned CAM_GLYPHS registry.');
}

const inventoryBlock = provenance.match(
  /<!-- custom-icon-inventory:start -->([\s\S]*?)<!-- custom-icon-inventory:end -->/,
);
if (!inventoryBlock) {
  throw new Error('Could not locate the documented custom-icon inventory.');
}

const sourceIds = [
  // A glyph may be a JSX component as well as a parenthesized fragment.
  ...glyphBlock[1].matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm),
  ...camGlyphBlock[1].matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm),
].map((match) => match[1]);
const documentedIds = [
  ...inventoryBlock[1].matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g),
].map((match) => match[1]);

const unique = (ids) => [...new Set(ids)].sort();
const sourceSet = unique(sourceIds);
const documentedSet = unique(documentedIds);
const undocumented = sourceSet.filter((id) => !documentedSet.includes(id));
const stale = documentedSet.filter((id) => !sourceSet.includes(id));
const duplicates = sourceIds.filter((id, index) => sourceIds.indexOf(id) !== index);

const forbiddenAssetPatterns = [
  [/<image\b/i, 'embedded <image> element'],
  [/\b(?:href|xlinkHref)\s*=/i, 'external image reference'],
  [/\bdata:image\//i, 'embedded raster data'],
  [/\bfrom\s+['"][^'"]+\.(?:svg|png|jpe?g|webp)['"]/i, 'imported image asset'],
];
const forbiddenAssets = forbiddenAssetPatterns
  .filter(([pattern]) => pattern.test(glyphBlock[1]) || pattern.test(camSource))
  .map(([, description]) => description);

const problems = [];
// Shared vector sources are rendered by both React and Rust. Inspect the
// actual sources as well as the registry so moving a glyph cannot bypass this audit.
const sharedDir = resolve(root, 'src/assets/ribbon-icons');
for (const name of await readdir(sharedDir)) {
  const svg = await readFile(resolve(sharedDir, name), 'utf8');
  if (!name.endsWith('.svg') || !svg.includes('viewBox="0 0 24 24"')) {
    problems.push(`Invalid shared ribbon vector: ${name}`);
  }
  if (/<(?:image|script|foreignObject)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=|data:image\//i.test(svg)) {
    problems.push(`Shared ribbon vector contains executable or external content: ${name}`);
  }
}
if (undocumented.length) problems.push(`Undocumented custom icons: ${undocumented.join(', ')}`);
if (stale.length) problems.push(`Documented icons absent from source: ${stale.join(', ')}`);
if (duplicates.length) problems.push(`Duplicate source icon IDs: ${unique(duplicates).join(', ')}`);
if (forbiddenAssets.length) problems.push(`Disallowed custom-icon assets: ${forbiddenAssets.join(', ')}`);
if (!brand.includes('noBS CAD NB monogram')) {
  problems.push('The canonical product mark is missing its noBS CAD NB provenance title.');
}
if (/<image\b|(?:href|xlink:href)\s*=|data:image\//i.test(brand)) {
  problems.push('The canonical product mark embeds or references an external image asset.');
}

if (problems.length) {
  throw new Error(problems.join('\n'));
}

const glyphDigest = createHash('sha256').update(source).digest('hex');
const camGlyphDigest = createHash('sha256').update(camSource).digest('hex');
const brandDigest = createHash('sha256').update(brand).digest('hex');
console.log(
  [
    `Icon provenance OK: ${sourceSet.length} custom glyphs`,
    `${relative(root, sourcePath)} sha256 ${glyphDigest}`,
    `${relative(root, camSourcePath)} sha256 ${camGlyphDigest}`,
    `${relative(root, brandPath)} sha256 ${brandDigest}`,
  ].join('; '),
);
