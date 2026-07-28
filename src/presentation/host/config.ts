import * as vscode from 'vscode';

/** Matches the `configuration` contribution in package.json. */
export const CONFIG_SECTION = 'gitHawk';

/**
 * Two levels covers the layout most people actually have — a folder of
 * projects, or a folder of buckets each holding projects — while still costing
 * only a handful of directory reads on a workspace that is a single repository.
 */
export const DEFAULT_SCAN_DEPTH = 2;

export const SCAN_DEPTH_SETTING = 'repositoryScanDepth';

export interface AiTool {
    /** Shown in the picker and used as the terminal's name. */
    name: string;
    /** Typed into the terminal verbatim. */
    command: string;
}

/**
 * The coding agents worth one keystroke from a worktree.
 *
 * A setting rather than a fixed list because the binary is what varies: people
 * alias these, install them per-project, or run them through `npx`. The names
 * are the tools' own.
 */
export const DEFAULT_AI_TOOLS: AiTool[] = [
    { name: 'Claude Code', command: 'claude' },
    { name: 'Codex', command: 'codex' },
    { name: 'Gemini CLI', command: 'gemini' },
    { name: 'opencode', command: 'opencode' },
];

export const AI_TOOLS_SETTING = 'aiTools';

export function aiTools(): AiTool[] {
    const configured = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<unknown>(AI_TOOLS_SETTING);

    if (!Array.isArray(configured)) {
        return DEFAULT_AI_TOOLS;
    }

    // Hand-edited settings are untrusted input: a malformed entry should cost
    // that entry, not the whole feature.
    const valid = configured.filter(isAiTool);
    return valid.length > 0 ? valid : DEFAULT_AI_TOOLS;
}

function isAiTool(value: unknown): value is AiTool {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<AiTool>;
    return (
        typeof candidate.name === 'string' &&
        candidate.name.trim().length > 0 &&
        typeof candidate.command === 'string' &&
        candidate.command.trim().length > 0
    );
}

export function repositoryScanDepth(): number {
    const configured = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<number>(SCAN_DEPTH_SETTING, DEFAULT_SCAN_DEPTH);

    // A negative or fractional value from settings.json would otherwise make the
    // scan loop behave unpredictably rather than obviously wrongly.
    return Number.isFinite(configured)
        ? Math.max(0, Math.floor(configured))
        : DEFAULT_SCAN_DEPTH;
}
