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
