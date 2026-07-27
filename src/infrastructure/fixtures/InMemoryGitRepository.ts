import { GitRepository } from '../../domain/models/GitRepository';
import { IGitRepository } from '../../domain/repositories/IGitRepository';
import { Topology, defaultTopology } from './topologies';

/**
 * Serves a fixture topology through the same port the git CLI adapter will use,
 * so the webview, the dev harness, and the tests all exercise one code path.
 */
export class InMemoryGitRepository implements IGitRepository {
    constructor(private readonly topology: Topology = defaultTopology) {}

    async getRepository(): Promise<GitRepository> {
        return this.topology.build();
    }
}
