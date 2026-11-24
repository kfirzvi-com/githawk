/**
 * The "What's New" page shown after an update: when to show it, and what it says.
 *
 * Shown after a minor or major update only. A patch is a fix, not news, and a
 * fresh install has nothing to compare against. The notes are the version's
 * own section of CHANGELOG.md, which ships inside the package.
 *
 * Kept free of `vscode` so it can be unit-tested; `WhatsNewPanel` connects it
 * to the editor.
 */

/** `major.minor.patch` as numbers; undefined for anything else. */
function parts(version: string): [number, number, number] | undefined {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** True when `current` is a newer minor or major than `previous`. */
export function isNewsworthyUpdate(previous: string | undefined, current: string): boolean {
    if (previous === undefined) {
        return false;
    }
    const before = parts(previous);
    const after = parts(current);
    if (before === undefined || after === undefined) {
        return false;
    }
    return after[0] > before[0] || (after[0] === before[0] && after[1] > before[1]);
}

/** The body of `## [version]` in the changelog, without its heading; undefined when absent. */
export function releaseNotes(changelog: string, version: string): string | undefined {
    const lines = changelog.split(/\r?\n/);
    const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
    if (start === -1) {
        return undefined;
    }
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith('## '));
    const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
    return body === '' ? undefined : body;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** `**bold**`, `` `code` `` and `[text](https://…)`, on already-escaped text. */
function inline(text: string): string {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * The small part of Markdown the changelog uses: `###` headings, flat `-`
 * lists (with wrapped lines), paragraphs, bold, code and https links.
 * Anything else shows as plain text; CHANGELOG.md's header says so.
 * Everything is escaped first.
 */
export function notesToHtml(markdown: string): string {
    const html: string[] = [];
    let item: string[] | undefined;
    let paragraph: string[] | undefined;
    let inList = false;

    const flushItem = () => {
        if (item) {
            html.push(`<li>${inline(item.join(' '))}</li>`);
            item = undefined;
        }
    };
    const flushParagraph = () => {
        if (paragraph) {
            html.push(`<p>${inline(paragraph.join(' '))}</p>`);
            paragraph = undefined;
        }
    };
    const closeList = () => {
        flushItem();
        if (inList) {
            html.push('</ul>');
            inList = false;
        }
    };

    for (const raw of markdown.split('\n')) {
        const line = raw.trimEnd();
        if (line.trim() === '') {
            flushItem();
            flushParagraph();
        } else if (line.startsWith('### ')) {
            closeList();
            flushParagraph();
            html.push(`<h2>${inline(line.slice(4))}</h2>`);
        } else if (line.startsWith('- ')) {
            flushParagraph();
            flushItem();
            if (!inList) {
                html.push('<ul>');
                inList = true;
            }
            item = [line.slice(2)];
        } else if (item && raw.startsWith('  ')) {
            item.push(line.trim());
        } else {
            closeList();
            (paragraph ??= []).push(line.trim());
        }
    }
    closeList();
    flushParagraph();
    return html.join('\n');
}
