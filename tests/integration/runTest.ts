/**
 * Runs the extension inside a real VS Code, against real repositories.
 *
 * This tier exists because a comparison silently produced nothing in VS Code
 * while working correctly in Node and in the browser harness. Neither of the
 * other two test tiers could see it: one has no extension host, the other has no
 * git. Only running the actual host against actual git finds that class of bug.
 *
 * Two sessions, because the two things being tested need different workspaces:
 * one repository with an interesting history, and a folder holding several
 * repositories at different depths.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';
import {
    integrationProfileDir,
    integrationWorkspaceDir,
    vscodeCacheDir,
} from '../../scripts/harness';

const extensionDevelopmentPath = fileURLToPath(new URL('../..', import.meta.url));

/*
 * Derived from this checkout rather than a fixed /tmp path. Each session wipes
 * and rebuilds its workspace, so two checkouts sharing one would rebuild the
 * repository the other's VS Code is midway through reading.
 */
const workspaces = integrationWorkspaceDir(extensionDevelopmentPath);

interface Session {
    name: string;
    /** Script that builds the workspace, relative to the repository root. */
    setup: string;
    workspace: string;
    suite: string;
}

const SESSIONS: Session[] = [
    {
        name: 'single repository',
        setup: 'scripts/makeSampleRepo.sh',
        workspace: join(workspaces, 'sample'),
        suite: './suite/index.cjs',
    },
    {
        name: 'multiple repositories',
        setup: 'scripts/makeMultiRepoSample.sh',
        workspace: join(workspaces, 'multi'),
        suite: './multiRepo/index.cjs',
    },
];

async function main(): Promise<void> {
    for (const session of SESSIONS) {
        console.log(`\n=== integration: ${session.name} ===`);

        // A fresh workspace, so the assertions describe a known state.
        execFileSync(
            fileURLToPath(new URL(`../../${session.setup}`, import.meta.url)),
            [session.workspace],
            { stdio: 'inherit' }
        );

        await runTests({
            extensionDevelopmentPath,
            // Read-only once populated, and ~1.9 GB, so several checkouts
            // should share one rather than each downloading VS Code.
            cachePath: vscodeCacheDir(extensionDevelopmentPath),
            extensionTestsPath: fileURLToPath(
                new URL(session.suite, import.meta.url)
            ),
            launchArgs: [
                session.workspace,
                // Short, for the reason integrationProfileDir explains.
                `--user-data-dir=${integrationProfileDir(extensionDevelopmentPath)}`,
                // Other extensions are irrelevant here and slow startup down.
                '--disable-extensions',
                '--disable-gpu',
            ],
        });
    }
}

main().catch((error) => {
    console.error('integration tests failed:', error);
    process.exit(1);
});
