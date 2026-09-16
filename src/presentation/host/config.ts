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

export const AUTO_REFRESH_SETTING = 'autoRefresh';

export const BLAME_STYLE_SETTING = 'blame.style';

/**
 * Where a blame annotation is drawn. Three, because VS Code has no way to put
 * text beside the line numbers — see BlameDecorator — and which compromise is
 * least bad is a matter of taste.
 */
/**
 * Two, not the four the spike carried.
 *
 * The gutter is gone because it cannot hold text: `gutterIconPath` takes an
 * image, and VS Code scales it to icon size, so a label there renders as a
 * smudge. A `before` attachment placed without a fixed width is gone too —
 * `column` occupies the same position and holds its edge.
 */
export type BlameStyle = 'off' | 'column' | 'endOfLine';

const BLAME_STYLES: BlameStyle[] = ['off', 'column', 'endOfLine'];

/**
 * Flips blame between off and the column.
 *
 * Two states rather than three: the toggle is a switch, and a switch that
 * lands somewhere different depending on what you last had is not one. The
 * column is what it turns on, because it is the reading of history the feature
 * is for — `endOfLine` stays available by setting `gitHawk.blame.style`
 * directly, and this will overwrite that choice, which is the price of the
 * toggle being predictable.
 *
 * Written back to whichever scope the setting is already defined in — a
 * workspace that has chosen a style should not be silently overridden by a
 * global toggle, and a user with no workspace setting should not have one
 * created for them.
 */
export async function toggleBlame(): Promise<BlameStyle> {
    const next: BlameStyle = blameStyle() === 'off' ? 'column' : 'off';

    const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const defined = configuration.inspect<string>(BLAME_STYLE_SETTING);
    const target =
        defined?.workspaceFolderValue !== undefined
            ? vscode.ConfigurationTarget.WorkspaceFolder
            : defined?.workspaceValue !== undefined
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.Global;

    await configuration.update(BLAME_STYLE_SETTING, next, target);
    return next;
}

export function blameStyle(): BlameStyle {
    const configured = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>(BLAME_STYLE_SETTING, 'off');

    // Hand-edited settings are untrusted input; an unknown value means off
    // rather than a crash on every editor change.
    return (BLAME_STYLES as string[]).includes(configured)
        ? (configured as BlameStyle)
        : 'off';
}

/**
 * On by default: a graph that does not match the repository is worse than no
 * graph, because it looks authoritative. The setting exists for the case the
 * watcher cannot serve well — a repository on a network filesystem, where every
 * event costs a round trip.
 */
export function autoRefreshEnabled(): boolean {
    return vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>(AUTO_REFRESH_SETTING, true);
}

export interface AiTool {
    /** Shown in the picker and used as the terminal's name. */
    name: string;
    /** Typed into the terminal verbatim. */
    command: string;
    /**
     * The same tool run once, non-interactively, to write a commit message:
     * the prompt and diff arrive on stdin, the message is whatever it prints.
     * Absent for a tool that has no such mode, which keeps it out of the
     * commit box's picker without keeping it out of the terminal.
     */
    commitMessageCommand?: string;
}

/**
 * The coding agents worth one keystroke from a worktree.
 *
 * A setting rather than a fixed list because the binary is what varies: people
 * alias these, install them per-project, or run them through `npx`. The names
 * are the tools' own.
 *
 * Each one's non-interactive form is the one its own documentation gives for
 * piping a prompt in: `claude -p` prints and exits, `codex exec -` reads the
 * prompt from stdin, and `gemini` and `opencode run` do so when stdin is not
 * a terminal. Only Claude Code is exercised here; the rest are the documented
 * shapes, and the setting exists for the day one of them changes.
 */
export const DEFAULT_AI_TOOLS: AiTool[] = [
    { name: 'Claude Code', command: 'claude', commitMessageCommand: 'claude -p' },
    { name: 'Codex', command: 'codex', commitMessageCommand: 'codex exec -' },
    { name: 'Gemini CLI', command: 'gemini', commitMessageCommand: 'gemini' },
    { name: 'opencode', command: 'opencode', commitMessageCommand: 'opencode run' },
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
    const valid = configured.filter(isAiTool).map(normaliseAiTool);
    return valid.length > 0 ? valid : DEFAULT_AI_TOOLS;
}

/** The tools that can write a commit message, in the order the setting lists them. */
export function commitMessageTools(): (AiTool & {
    commitMessageCommand: string;
})[] {
    return aiTools().filter(
        (tool): tool is AiTool & { commitMessageCommand: string } =>
            typeof tool.commitMessageCommand === 'string' &&
            tool.commitMessageCommand.trim().length > 0
    );
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

/** A blank or non-string generate command means "none", not "run nothing". */
function normaliseAiTool(tool: AiTool): AiTool {
    const generate =
        typeof tool.commitMessageCommand === 'string'
            ? tool.commitMessageCommand.trim()
            : '';
    return generate.length > 0
        ? { name: tool.name, command: tool.command, commitMessageCommand: generate }
        : { name: tool.name, command: tool.command };
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
