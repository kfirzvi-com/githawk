import { GitRepository } from '../models/GitRepository';

/**
 * The port every git source implements: fixtures today, the git CLI next.
 *
 * Intentionally one method. Paging (`{ limit, skip }`) arrives alongside
 * GitCliRepository, once there is a real history large enough to need it.
 */
export interface IGitRepository {
    getRepository(): Promise<GitRepository>;
}
