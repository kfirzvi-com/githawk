import * as vscode from 'vscode';
import { readFile, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';
import { parseAgentReplies } from '../../application/services/reviewHandoff';
import type { Review } from '../../domain/models/Review';
import { log } from './log';
import type { ReviewController } from './ReviewController';

/** A whole second is plenty for an answer, and costs one stat a second per repository. */
const POLL_MS = 1000;

/**
 * Watches each repository's replies file, where an agent handed a review
 * writes back, and takes what it wrote into the review's threads.
 *
 * Polled rather than watched with events: the file lives in the git
 * directory, which VS Code's own watcher is told to leave alone, it may not
 * exist until the agent's first reply, and an agent appending to it from a
 * terminal is exactly the kind of write event watchers miss.
 *
 * Watched for as long as the repository has a review — answers can arrive
 * after a reload, and the file is read on start for any that did.
 */
export class AgentRepliesWatcher implements vscode.Disposable {
    private readonly watched = new Map<string, string>();

    constructor(
        private readonly reviews: ReviewController,
        private readonly deps: {
            gitDirectory: (root: string) => Promise<string>;
            /** Told when an agent's answer has landed in a review. */
            onAnswered: (review: Review, answered: string[]) => void;
        }
    ) {}

    dispose(): void {
        this.watched.forEach((path) => unwatchFile(path));
        this.watched.clear();
    }

    /** Watches every repository with a review in progress; stops for those without. */
    async sync(): Promise<void> {
        const roots = new Set(this.reviews.entries().map((entry) => entry.root));
        for (const [root, path] of this.watched) {
            if (!roots.has(root)) {
                unwatchFile(path);
                this.watched.delete(root);
            }
        }
        for (const root of roots) {
            if (!this.watched.has(root)) {
                try {
                    this.watch(root, join(await this.deps.gitDirectory(root), 'githawk', 'replies.jsonl'));
                } catch (error) {
                    log.warn(`replies: cannot find the git directory of ${root}: ${String(error)}`);
                }
            }
        }
    }

    /** Watches one file, now — the handoff just named it. */
    watch(root: string, path: string): void {
        if (this.watched.get(root) === path) {
            return;
        }
        const previous = this.watched.get(root);
        if (previous) {
            unwatchFile(previous);
        }
        this.watched.set(root, path);
        watchFile(path, { interval: POLL_MS }, (now, before) => {
            if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) {
                this.read(root, path);
            }
        });
        this.read(root, path);
    }

    private read(root: string, path: string): void {
        readFile(path, 'utf8', (error, text) => {
            if (error) {
                return; // Not written yet: no answers to take.
            }
            void this.reviews.takeAgentReplies(root, parseAgentReplies(text)).then((results) => {
                for (const { review, answered } of results) {
                    log.info(`replies: ${answered.length} answered in "${review.label}" from ${path}`);
                    this.deps.onAnswered(review, answered);
                }
            });
        });
    }
}
