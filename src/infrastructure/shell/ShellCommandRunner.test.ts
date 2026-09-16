import { describe, expect, test } from 'vitest';
import { CommandFailedError, ShellCommandRunner } from './ShellCommandRunner';

/**
 * Against a real shell, because the point of this adapter is "works like the
 * terminal": pipes, quoting and exit codes are the shell's, not ours.
 */
const shell = process.platform === 'win32' ? undefined : '/bin/sh';

describe('ShellCommandRunner', () => {
    test('feeds the input on stdin and returns stdout', async () => {
        const output = await new ShellCommandRunner(shell).run({
            command: 'cat',
            input: 'hello from stdin',
            cwd: process.cwd(),
        });

        expect(output).toBe('hello from stdin');
    });

    test('runs a real command line — a pipeline, with quoting', async () => {
        const output = await new ShellCommandRunner(shell).run({
            command: `tr 'a-z' 'A-Z' | sed 's/WORLD/THERE/'`,
            input: 'hello world',
            cwd: process.cwd(),
        });

        expect(output.trim()).toBe('HELLO THERE');
    });

    test('a non-zero exit is a failure carrying stderr', async () => {
        await expect(
            new ShellCommandRunner(shell).run({
                command: 'echo "not installed" >&2; exit 127',
                input: '',
                cwd: process.cwd(),
            })
        ).rejects.toMatchObject({
            name: 'CommandFailedError',
            exitCode: 127,
            stderr: 'not installed',
        } satisfies Partial<CommandFailedError>);
    });

    test('can be cancelled', async () => {
        const controller = new AbortController();
        const pending = new ShellCommandRunner(shell).run({
            command: 'sleep 30',
            input: '',
            cwd: process.cwd(),
            signal: controller.signal,
        });
        controller.abort();

        await expect(pending).rejects.toMatchObject({ stderr: 'cancelled' });
    });

    test('gives up after the timeout', async () => {
        await expect(
            new ShellCommandRunner(shell, 200).run({
                command: 'sleep 30',
                input: '',
                cwd: process.cwd(),
            })
        ).rejects.toThrow(/gave up/);
    });

    test('does not tell the child it is inside a Claude Code session', async () => {
        const output = await new ShellCommandRunner(shell).run({
            command: 'echo "[${CLAUDECODE:-unset}]"',
            input: '',
            cwd: process.cwd(),
        });

        expect(output.trim()).toBe('[unset]');
    });
});
