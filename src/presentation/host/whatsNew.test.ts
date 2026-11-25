import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isNewsworthyUpdate, notesToHtml, releaseNotes } from './whatsNew';

describe('isNewsworthyUpdate', () => {
    it('is true for a newer minor or major', () => {
        expect(isNewsworthyUpdate('0.11.0', '0.12.0')).toBe(true);
        expect(isNewsworthyUpdate('0.11.3', '1.0.0')).toBe(true);
    });

    it('is false for a fresh install, a patch, the same version, or a downgrade', () => {
        expect(isNewsworthyUpdate(undefined, '0.12.0')).toBe(false);
        expect(isNewsworthyUpdate('0.12.0', '0.12.1')).toBe(false);
        expect(isNewsworthyUpdate('0.12.0', '0.12.0')).toBe(false);
        expect(isNewsworthyUpdate('0.12.0', '0.11.0')).toBe(false);
        expect(isNewsworthyUpdate('garbage', '0.12.0')).toBe(false);
    });
});

describe('releaseNotes', () => {
    const changelog = `# Changelog

## [Unreleased]

## [0.11.0] — 2026-11-24

### Changed

- One.

## [0.10.0] — 2026-11-23

- Two.
`;

    it('takes only that version section, without its heading', () => {
        expect(releaseNotes(changelog, '0.11.0')).toBe('### Changed\n\n- One.');
    });

    it('is undefined for a version the changelog does not list', () => {
        expect(releaseNotes(changelog, '9.9.9')).toBeUndefined();
    });

    it("has a section in the real changelog for package.json's version", () => {
        const real = readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
        const { version } = JSON.parse(
            readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
        ) as { version: string };
        expect(releaseNotes(real, version)).toBeDefined();
    });
});

describe('notesToHtml', () => {
    it('renders headings, wrapped list items, bold, code and links', () => {
        const html = notesToHtml(
            '### Added\n\n- **Bold** and `code`,\n  wrapped. [Docs](https://example.com)\n- Two.'
        );
        expect(html).toBe(
            '<h2>Added</h2>\n<ul>\n' +
                '<li><strong>Bold</strong> and <code>code</code>, wrapped. <a href="https://example.com">Docs</a></li>\n' +
                '<li>Two.</li>\n</ul>'
        );
    });

    it('escapes HTML and drops non-https links', () => {
        const html = notesToHtml('- <script>x</script> [bad](javascript:alert(1))');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('href="javascript');
    });
});
