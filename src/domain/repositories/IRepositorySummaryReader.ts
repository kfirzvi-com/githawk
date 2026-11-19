import type { RepositorySummary } from '../models/RepositorySummary';

/**
 * One repository's {@link RepositorySummary}.
 *
 * Its own port, and one call, because the Repositories view asks it of every
 * repository in the workspace on every refresh: it has to cost one cheap
 * process, not a log.
 */
export interface IRepositorySummaryReader {
    read(): Promise<RepositorySummary>;
}
