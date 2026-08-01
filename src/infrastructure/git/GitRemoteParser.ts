import { Remote } from '../../domain/models/Remote';

/**
 * Parses `git remote -v`, which prints one line per direction:
 *
 *     origin\tgit@github.com:owner/repo.git (fetch)
 *     origin\tgit@github.com:owner/repo.git (push)
 *
 * So a remote is two lines, and the two URLs can differ. The name and the URL
 * are tab-separated, but the direction is separated by a space — and a URL
 * cannot contain whitespace, so the last parenthesised word is the direction
 * however odd the rest of the line is.
 */
export class GitRemoteParser {
    static parse(output: string): Remote[] {
        const fetchUrls = new Map<string, string>();
        const pushUrls = new Map<string, string>();
        // Insertion order, so remotes come back in the order git listed them
        // (alphabetical) rather than in whichever direction appeared first.
        const names: string[] = [];

        for (const line of output.split('\n')) {
            const parsed = parseLine(line);
            if (!parsed) {
                continue;
            }

            const { name, url, direction } = parsed;
            if (!names.includes(name)) {
                names.push(name);
            }
            (direction === 'push' ? pushUrls : fetchUrls).set(name, url);
        }

        return names.map((name) => {
            // A remote with only one direction listed is not something git
            // produces, but reading it as "both are this one" is better than
            // reporting an empty URL.
            const fetch = fetchUrls.get(name) ?? pushUrls.get(name) ?? '';
            return new Remote(name, fetch, pushUrls.get(name) ?? fetch);
        });
    }
}

function parseLine(
    line: string
): { name: string; url: string; direction: string } | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    const match = /^(\S+)\s+(.*?)\s+\((fetch|push)\)$/.exec(trimmed);
    return match
        ? { name: match[1], url: match[2], direction: match[3] }
        : undefined;
}
