/**
 * Prints one version's section of CHANGELOG.md, for use as GitHub Release notes.
 *
 * The changelog is the release notes — generating them from commit subjects
 * instead would describe the work rather than the change, and would drift from
 * what the Marketplace shows for the same version.
 *
 *   node scripts/changelogSection.mjs 0.3.0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
    console.error('usage: changelogSection.mjs <version>');
    process.exit(1);
}

const path = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));
const lines = readFileSync(path, 'utf8').split('\n');

// Headings look like `## [0.2.0] — 2026-07-31`. Only the bracketed version is
// matched, so the date separator and format stay free to change.
const isHeading = (line) => /^## \[/.test(line);
const start = lines.findIndex(
    (line) => isHeading(line) && line.startsWith(`## [${version}]`)
);

if (start === -1) {
    console.error(`CHANGELOG.md has no section for ${version}`);
    process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex(isHeading);

const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
console.log(body);
