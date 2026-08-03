/**
 * Settings shared by the Vite dev server, Playwright, and the integration
 * runner, so that several checkouts of this repository can run their tests at
 * the same time without reading each other's state.
 *
 * Everything here has a default that reproduces the single-checkout behaviour
 * exactly. A worktree opts in by exporting the environment variables.
 */
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DEFAULT_DEV_PORT = 5173;

/**
 * The port the webview dev server listens on, and the one Playwright points
 * at. Both read this, because a disagreement between them is not a failure —
 * it is a pass against the wrong code.
 */
export function devServerPort(): number {
    const raw = process.env.GITHAWK_DEV_PORT;
    if (raw === undefined || raw === '') {
        return DEFAULT_DEV_PORT;
    }

    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(
            `GITHAWK_DEV_PORT must be a port number between 1 and 65535, got "${raw}"`
        );
    }

    return port;
}

/**
 * A name for this checkout, stable across runs and different for every
 * directory. The basename alone is readable but collides between
 * `~/a/githawk` and `~/b/githawk`; the hash alone is unique but says nothing.
 */
export function checkoutId(root: string): string {
    const hash = createHash('sha1').update(root).digest('hex').slice(0, 8);
    return `${basename(root)}-${hash}`;
}

/**
 * Where the integration tier builds its throwaway repositories. These are
 * wiped and rebuilt at the start of every session, so two checkouts sharing
 * one path would pull the ground out from under each other's running VS Code.
 */
export function integrationWorkspaceDir(root: string): string {
    return (
        process.env.GITHAWK_INTEGRATION_DIR ??
        join(tmpdir(), `githawk-integration-${checkoutId(root)}`)
    );
}

/**
 * Where `@vscode/test-electron` keeps its downloaded VS Code. Unlike the two
 * above this is safe to share — it is read-only once populated, and a copy of
 * VS Code per checkout is ~1.9 GB. Defaults to the historical
 * `.vscode-test` inside the checkout so nothing changes for a single one.
 */
/**
 * Where the integration tier puts VS Code's user profile.
 *
 * Under the OS temp directory rather than inside the checkout, because macOS
 * caps a unix socket path at 103 characters and VS Code builds one from this
 * directory: a checkout a few characters too deep fails to launch at all, with
 * `listen EINVAL` rather than anything that names the cause. A worktree called
 * `githawk-blamefix` was enough to cross it.
 */
export function integrationProfileDir(root: string): string {
    return join(tmpdir(), `ghwk-${checkoutId(root)}`);
}

export function vscodeCacheDir(root: string): string {
    const shared = process.env.GITHAWK_VSCODE_CACHE;
    if (shared === undefined || shared === '') {
        return join(root, '.vscode-test');
    }

    return shared.startsWith('~/')
        ? join(homedir(), shared.slice(2))
        : shared;
}
