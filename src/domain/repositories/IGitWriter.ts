import { GitAction } from '../models/GitAction';

/**
 * The port for mutating a repository. Separate from IGitRepository so that a
 * read-only consumer — the dev harness, the visual tests — cannot reach a
 * destructive operation even by accident.
 */
export interface IGitWriter {
    perform(action: GitAction): Promise<void>;
}
