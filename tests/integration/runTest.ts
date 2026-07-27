/**
 * Runs the extension inside a real VS Code, against a real repository.
 *
 * This tier exists because a comparison silently produced nothing in VS Code
 * while working correctly in Node and in the browser harness. Neither of the
 * other two test tiers could see it: one has no extension host, the other has no
 * git. Only running the actual host against actual git finds that class of bug.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
    const extensionDevelopmentPath = fileURLToPath(new URL('../..', import.meta.url));
    const extensionTestsPath = fileURLToPath(new URL('./suite/index.cjs', import.meta.url));

    // A fresh sample repository, so the assertions describe a known history.
    const workspace = '/tmp/githawk-integration-sample';
    execFileSync(
        fileURLToPath(new URL('../../scripts/makeSampleRepo.sh', import.meta.url)),
        [workspace],
        { stdio: 'inherit' }
    );

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [
            workspace,
            // Other extensions are irrelevant here and slow startup down.
            '--disable-extensions',
            '--disable-gpu',
        ],
    });
}

main().catch((error) => {
    console.error('integration tests failed:', error);
    process.exit(1);
});
