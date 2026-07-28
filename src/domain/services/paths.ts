/**
 * Path arithmetic on plain strings.
 *
 * Not `node:path`, because this tier is bundled into the webview too and must
 * stay runnable in a browser. Both separators are accepted so a Windows path
 * behaves the same as a POSIX one.
 *
 * These operate on text only. Nothing here touches a filesystem, so nothing here
 * resolves a symlink or checks that anything exists — callers comparing two paths
 * must make sure both came from the same source. Git's own output is canonical
 * (`/private/tmp` rather than `/tmp` on macOS) and a workspace folder's is not,
 * so the two are never compared directly.
 */

const SEPARATORS = /[\\/]/;

/** Strips trailing separators so `/a/b` and `/a/b/` compare equal. */
export function normalizePath(path: string): string {
    let end = path.length;
    while (end > 1 && SEPARATORS.test(path.charAt(end - 1))) {
        end--;
    }
    return path.slice(0, end);
}

export function baseName(path: string): string {
    const segments = normalizePath(path).split(SEPARATORS);
    return segments[segments.length - 1] || normalizePath(path);
}

/** The containing directory. A filesystem root is its own parent. */
export function parentPath(path: string): string {
    const normalized = normalizePath(path);
    const lastSeparator = Math.max(
        normalized.lastIndexOf('/'),
        normalized.lastIndexOf('\\')
    );

    if (lastSeparator < 0) {
        return normalized;
    }
    // Keep the separator for a root child, so /a becomes / rather than "".
    return lastSeparator === 0 ? normalized.slice(0, 1) : normalized.slice(0, lastSeparator);
}

/** Joins with `/`, which every platform's git and Node both accept. */
export function joinPath(parent: string, child: string): string {
    return `${normalizePath(parent)}/${child}`;
}

/** True when `child` is `parent` or sits underneath it. */
export function isInside(parent: string, child: string): boolean {
    const from = normalizePath(parent);
    const to = normalizePath(child);

    if (to === from) {
        return true;
    }
    // A filesystem root normalizes to "/" and already ends in a separator.
    if (SEPARATORS.test(from.charAt(from.length - 1))) {
        return to.startsWith(from);
    }
    // The separator check matters: without it /a/bc reads as inside /a/b.
    return to.startsWith(from) && SEPARATORS.test(to.charAt(from.length));
}

/** `undefined` when `child` is not underneath `parent`. Always `/`-joined. */
export function relativePathFrom(
    parent: string,
    child: string
): string | undefined {
    if (!isInside(parent, child)) {
        return undefined;
    }

    const rest = normalizePath(child).slice(normalizePath(parent).length);
    return rest.split(SEPARATORS).filter(Boolean).join('/');
}
