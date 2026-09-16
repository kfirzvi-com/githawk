import { describe, expect, test } from 'vitest';
import {
    EmptyMessageError,
    GenerateCommitMessageUseCase,
    NothingToDescribeError,
} from './GenerateCommitMessageUseCase';
import type {
    IWorkingTreeReader,
    PatchScope,
} from '../../domain/repositories/IWorkingTreeReader';
import type {
    ITextCommandRunner,
    TextCommandRequest,
} from '../../domain/repositories/ITextCommandRunner';
import { cleanWorkingTree } from '../../domain/models/WorkingTreeStatus';

const workingTree = (patches: Partial<Record<PatchScope, string>>): IWorkingTreeReader => ({
    read: async () => cleanWorkingTree,
    patch: async (scope) => patches[scope] ?? '',
});

/** Records what it was asked, and answers with a script. */
const runner = (answer: string) => {
    const requests: TextCommandRequest[] = [];
    const fake: ITextCommandRunner = {
        run: async (request) => {
            requests.push(request);
            return answer;
        },
    };
    return { fake, requests };
};

describe('GenerateCommitMessageUseCase', () => {
    test('runs the configured command with the prompt on stdin, in the repository', async () => {
        const { fake, requests } = runner('Add the thing\n');

        const message = await new GenerateCommitMessageUseCase(
            workingTree({ staged: '+staged line' }),
            fake
        ).execute({ command: 'claude -p', cwd: '/repo', scope: 'staged' });

        expect(message).toBe('Add the thing');
        expect(requests).toHaveLength(1);
        expect(requests[0].command).toBe('claude -p');
        expect(requests[0].cwd).toBe('/repo');
        // The diff is in the input, never on the command line.
        expect(requests[0].input).toContain('+staged line');
    });

    test('cleans what the tool printed before handing it back', async () => {
        const { fake } = runner('```\nSubject\n```\n');

        const message = await new GenerateCommitMessageUseCase(
            workingTree({ all: 'x' }),
            fake
        ).execute({ command: 'x', cwd: '/', scope: 'all' });

        expect(message).toBe('Subject');
    });

    test('refuses to run the tool over an empty diff', async () => {
        const { fake, requests } = runner('never');

        await expect(
            new GenerateCommitMessageUseCase(workingTree({}), fake).execute({
                command: 'x',
                cwd: '/',
                scope: 'staged',
            })
        ).rejects.toBeInstanceOf(NothingToDescribeError);
        expect(requests).toHaveLength(0);
    });

    test('reports a tool that printed nothing usable', async () => {
        const { fake } = runner('   \n');

        await expect(
            new GenerateCommitMessageUseCase(workingTree({ all: 'x' }), fake).execute(
                { command: 'x', cwd: '/', scope: 'all' }
            )
        ).rejects.toBeInstanceOf(EmptyMessageError);
    });
});
