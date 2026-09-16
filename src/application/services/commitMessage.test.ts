import { describe, expect, test } from 'vitest';
import {
    PATCH_LIMIT_CHARS,
    cleanGeneratedMessage,
    commitMessagePrompt,
} from './commitMessage';

describe('commitMessagePrompt', () => {
    test('states the rules, says which scope the diff is, and appends it', () => {
        const prompt = commitMessagePrompt('diff --git a/x b/x\n+hello', 'staged');

        expect(prompt).toContain('72 characters');
        expect(prompt).toContain('exactly what will be committed');
        expect(prompt.endsWith('+hello')).toBe(true);
    });

    test('says so when nothing is staged and everything would be committed', () => {
        expect(commitMessagePrompt('x', 'all')).toContain('Nothing is staged yet');
    });

    test('truncates an enormous diff and says how much was cut', () => {
        const prompt = commitMessagePrompt('x'.repeat(PATCH_LIMIT_CHARS + 500), 'all');

        expect(prompt).toContain('[diff truncated: 500 more characters not shown]');
        // The limit plus the instructions and the note, not the extra 500.
        expect(prompt.length).toBeLessThan(PATCH_LIMIT_CHARS + 1000);
    });
});

/**
 * What a tool prints is rarely exactly a message. Each case here is a shape
 * one of them produced.
 */
describe('cleanGeneratedMessage', () => {
    test('leaves a clean message alone', () => {
        const message = 'Add a commit box\n\nA body.';
        expect(cleanGeneratedMessage(message)).toBe(message);
    });

    test('unwraps a fenced block, with or without a language', () => {
        expect(cleanGeneratedMessage('```\nSubject\n\nBody\n```')).toBe(
            'Subject\n\nBody'
        );
        expect(cleanGeneratedMessage('```text\nSubject\n```\n')).toBe('Subject');
    });

    test('drops a "Commit message:" label', () => {
        expect(cleanGeneratedMessage('Commit message:\nSubject line')).toBe(
            'Subject line'
        );
    });

    test('removes one pair of surrounding quotes, but not quotes inside', () => {
        expect(cleanGeneratedMessage('"Fix the thing"')).toBe('Fix the thing');
        expect(cleanGeneratedMessage('"Say "hi" to the user"')).toBe(
            '"Say "hi" to the user"'
        );
    });

    test('normalises line endings, trailing spaces and runs of blank lines', () => {
        expect(cleanGeneratedMessage('Subject  \r\n\r\n\r\n\r\nBody \r\n')).toBe(
            'Subject\n\nBody'
        );
    });

    test('is empty when the tool printed nothing usable', () => {
        expect(cleanGeneratedMessage('```\n```')).toBe('');
        expect(cleanGeneratedMessage('   \n  ')).toBe('');
    });
});
