/**
 * Stands in for an AI CLI in the review screenshots: prints what it was
 * handed, then the review document the prompt points at — which is exactly
 * what a real agent would read first.
 */
import { readFileSync } from 'node:fs';

const prompt = process.argv.slice(2).join(' ');
console.log('\x1b[1;36mdemo-agent\x1b[0m received:\n');
console.log(`  ${prompt}\n`);
const path = /in (\S+review\.md)/.exec(prompt)?.[1];
if (path) {
    console.log(`\x1b[2m── ${path} ──\x1b[0m`);
    console.log(readFileSync(path, 'utf8'));
}
