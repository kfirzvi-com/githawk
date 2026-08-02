/**
 * Which sections of the branch list are open.
 *
 * There are four now — local, remote, worktrees, stashes — and a repository
 * with thirty branches pushes the other three off the bottom of a panel that is
 * already short. Collapsing is what makes four sections usable in the space
 * three were already crowding.
 */
export type Section = 'local' | 'remote' | 'worktrees' | 'stashes';

export type SectionState = Record<Section, boolean>;

export const ALL_SECTIONS: Section[] = [
    'local',
    'remote',
    'worktrees',
    'stashes',
];

/** Everything open, which is how the list behaved before it could collapse. */
export const defaultSections: SectionState = {
    local: true,
    remote: true,
    worktrees: true,
    stashes: true,
};

/**
 * Persisted state is whatever a previous version of this webview wrote, so it
 * is untrusted input. Anything unrecognised falls back to open: a section that
 * is missing for no visible reason is a much harder puzzle than one that is
 * showing.
 */
export function readSections(stored: unknown): SectionState {
    if (typeof stored !== 'object' || stored === null) {
        return { ...defaultSections };
    }

    const candidate = stored as Partial<Record<Section, unknown>>;
    return {
        local: candidate.local !== false,
        remote: candidate.remote !== false,
        worktrees: candidate.worktrees !== false,
        stashes: candidate.stashes !== false,
    };
}

export function withSection(
    state: SectionState,
    section: Section,
    open: boolean
): SectionState {
    return { ...state, [section]: open };
}
