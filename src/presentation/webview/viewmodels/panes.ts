/**
 * Which of the two side panes are showing.
 *
 * The graph lives in the bottom panel, which is short and shares its width with
 * a branch list on the left and commit details on the right. On a laptop that
 * leaves the thing the panel exists to draw with the least room of the three.
 * Either side can be folded away, and the choice is remembered — a preference
 * that resets every time the window reloads is not a preference.
 */
export type Pane = 'branches' | 'details';

export type PaneVisibility = Record<Pane, boolean>;

export const ALL_PANES: Pane[] = ['branches', 'details'];

/** Both showing, which is what GitHawk did before either could be folded. */
export const defaultPaneVisibility: PaneVisibility = {
    branches: true,
    details: true,
};

/**
 * Reads persisted state, which is whatever a previous version of this webview
 * wrote — so it is untrusted input, not a value with a type. Anything
 * unrecognised falls back to showing the pane, because a missing pane is much
 * harder to explain than a visible one.
 */
export function readPaneVisibility(stored: unknown): PaneVisibility {
    if (typeof stored !== 'object' || stored === null) {
        return { ...defaultPaneVisibility };
    }

    const candidate = stored as Partial<Record<Pane, unknown>>;
    return {
        branches: candidate.branches !== false,
        details: candidate.details !== false,
    };
}

export function withPane(
    visibility: PaneVisibility,
    pane: Pane,
    visible: boolean
): PaneVisibility {
    return { ...visibility, [pane]: visible };
}

/** What the handle's tooltip says, and what a screen reader announces. */
export function paneToggleLabel(pane: Pane, visible: boolean): string {
    const name = pane === 'branches' ? 'the branch list' : 'commit details';
    return visible ? `Hide ${name}` : `Show ${name}`;
}
