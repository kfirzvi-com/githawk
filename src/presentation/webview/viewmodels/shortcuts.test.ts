import { describe, expect, it } from 'vitest';
import {
    availableShortcuts,
    isTextFieldTarget,
    resolveShortcut,
    shortcutKey,
    shortcuts,
    type ShortcutAction,
    type ShortcutContext,
    type ShortcutKeyEvent,
} from './shortcuts';

const context = (overrides: Partial<ShortcutContext> = {}): ShortcutContext => ({
    panelReady: true,
    hasRepositories: false,
    branchesPaneVisible: true,
    selectionCount: 0,
    commitCount: 20,
    ...overrides,
});

const press = (
    key: string,
    overrides: Partial<ShortcutKeyEvent> = {}
): ShortcutKeyEvent => ({
    key,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    inTextField: false,
    ...overrides,
});

const everything = new Set<ShortcutAction>(shortcuts.map((s) => s.id));

describe('the shortcut table', () => {
    /**
     * Panes come and go, so two panes claiming one letter would work until both
     * were on screen — the normal case — and then silently hand the key to
     * whichever handler ran second.
     */
    it('gives every action a key of its own', () => {
        const keys = shortcuts.map((shortcut) => shortcut.key);

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('uses one lowercase letter per action', () => {
        for (const shortcut of shortcuts) {
            expect(shortcut.key).toMatch(/^[a-z]$/);
        }
    });

    it('shows the key as the capital the reader will be holding', () => {
        expect(shortcutKey('refresh')).toBe('R');
        expect(shortcutKey('toggleBranches')).toBe('B');
    });
});

describe('availableShortcuts', () => {
    it('always offers the toolbar actions and the pane toggles', () => {
        const available = availableShortcuts(context());

        expect(available).toContain('refresh');
        expect(available).toContain('fetch');
        expect(available).toContain('pull');
        expect(available).toContain('push');
        expect(available).toContain('toggleBranches');
        expect(available).toContain('toggleDetails');
        expect(available).toContain('toggleMaximized');
        // A repository always has a branch to check out, even before the host
        // has reported which repositories exist.
        expect(available).toContain('switchBranch');
    });

    /** Nothing to put a cursor on, or to pick from, in a repository with no
     *  commits — and the graph itself says so in place of rows. */
    it('withdraws the graph keys from a repository with no commits', () => {
        const empty = availableShortcuts(context({ commitCount: 0 }));

        expect(empty).not.toContain('focusGraph');
        expect(empty).not.toContain('selectionMode');
        expect(empty).toContain('refresh');
    });

    it('offers the changes shortcut from one selected commit upwards', () => {
        expect(availableShortcuts(context())).not.toContain(
            'showSelectionChanges'
        );
        expect(
            availableShortcuts(context({ selectionCount: 1 }))
        ).toContain('showSelectionChanges');
    });

    it('offers the repository picker only once there are repositories', () => {
        expect(availableShortcuts(context())).not.toContain('switchRepository');
        expect(
            availableShortcuts(context({ hasRepositories: true }))
        ).toContain('switchRepository');
    });

    /**
     * A badge is a promise that the key does something. Folded away, the branch
     * list's own controls are not on screen, so neither is the promise.
     */
    it('withdraws the branch list shortcuts when the pane is folded away', () => {
        const folded = availableShortcuts(
            context({ branchesPaneVisible: false })
        );

        expect(folded).not.toContain('filterBranches');
        expect(folded).not.toContain('manageRemotes');
        expect(folded).not.toContain('manageWorktrees');
        expect(folded).not.toContain('manageStashes');
        // The way back is still a shortcut, for the same reason the handle
        // stays on screen.
        expect(folded).toContain('toggleBranches');
    });

    /**
     * Loading and error states replace the whole panel, toolbar included. A
     * badge cannot be drawn on a control that is not there, and neither should
     * its key do anything.
     */
    it('offers nothing at all while the panel is not showing the graph', () => {
        expect(
            availableShortcuts(
                context({
                    panelReady: false,
                    hasRepositories: true,
                    selectionCount: 2,
                })
            ).size
        ).toBe(0);
    });

    it('offers Clear above one selected commit, and Diff at exactly two', () => {
        expect(availableShortcuts(context({ selectionCount: 1 }))).not.toContain(
            'clearSelection'
        );

        const two = availableShortcuts(context({ selectionCount: 2 }));
        expect(two).toContain('clearSelection');
        expect(two).toContain('diffTwo');

        const three = availableShortcuts(context({ selectionCount: 3 }));
        expect(three).toContain('clearSelection');
        expect(three).not.toContain('diffTwo');
    });
});

describe('resolveShortcut', () => {
    it('runs the action whose letter was pressed with Shift', () => {
        // Shift makes the browser report the capital.
        expect(resolveShortcut(press('R'), everything)).toBe('refresh');
        expect(resolveShortcut(press('b'), everything)).toBe('toggleBranches');
    });

    it('ignores the letter without Shift', () => {
        expect(resolveShortcut(press('r', { shiftKey: false }), everything)).toBe(
            null
        );
    });

    /**
     * Ctrl, Cmd and Alt combinations belong to VS Code and to the operating
     * system. Swallowing one here shadows a binding the reader chose.
     */
    it('leaves the other modifiers to VS Code', () => {
        expect(resolveShortcut(press('R', { ctrlKey: true }), everything)).toBe(
            null
        );
        expect(resolveShortcut(press('R', { metaKey: true }), everything)).toBe(
            null
        );
        expect(resolveShortcut(press('R', { altKey: true }), everything)).toBe(
            null
        );
    });

    /** Shift+K in the branch filter is a capital K, and must stay one. */
    it('does not fire while the reader is typing', () => {
        expect(
            resolveShortcut(press('K', { inTextField: true }), everything)
        ).toBe(null);
    });

    it('ignores named keys and unassigned letters', () => {
        expect(resolveShortcut(press('ArrowDown'), everything)).toBe(null);
        expect(resolveShortcut(press('Shift'), everything)).toBe(null);
        expect(resolveShortcut(press('z'), everything)).toBe(null);
    });

    /** The same predicate draws the badge, so an unbadged key does nothing. */
    it('refuses a key whose action is not currently available', () => {
        const available = availableShortcuts(context({ selectionCount: 0 }));

        expect(resolveShortcut(press('X'), available)).toBe(null);
        expect(
            resolveShortcut(
                press('X'),
                availableShortcuts(context({ selectionCount: 2 }))
            )
        ).toBe('diffTwo');
    });
});

describe('isTextFieldTarget', () => {
    it('recognises the controls a reader types into', () => {
        expect(isTextFieldTarget({ tagName: 'INPUT' })).toBe(true);
        expect(isTextFieldTarget({ tagName: 'textarea' })).toBe(true);
        expect(isTextFieldTarget({ tagName: 'SELECT' })).toBe(true);
        expect(isTextFieldTarget({ isContentEditable: true })).toBe(true);
    });

    it('is not fooled by a button, or by nothing at all', () => {
        expect(isTextFieldTarget({ tagName: 'BUTTON' })).toBe(false);
        expect(isTextFieldTarget({})).toBe(false);
        expect(isTextFieldTarget(null)).toBe(false);
    });
});
