import { Commit } from '../domain/models/Commit';
import { Branch } from '../domain/models/Branch';
import { GitRepository } from '../domain/models/GitRepository';
import { IGitRepository } from '../domain/repositories/IGitRepository';

export class MockGitRepository implements IGitRepository {
    async getCommits(): Promise<Commit[]> {
        return [
            new Commit(
                'a1b2c3d4e5f6g7h8',
                'Merge pull request #89 from hotfix/critical-security-fix',
                'GitHub',
                ['b2c3d4e5f6g7h8i9', 'z9y8x7w6v5u4t3s2'],
                ['main', 'origin/main', 'HEAD'],
                'main'
            ),
            new Commit(
                'b2c3d4e5f6g7h8i9',
                'Merge branch \'develop\' into main',
                'Release Bot',
                ['c3d4e5f6g7h8i9j0', 'p0o9n8m7l6k5j4i3'],
                [],
                'main'
            ),
            new Commit(
                'z9y8x7w6v5u4t3s2',
                'fix: patch critical security vulnerability in auth',
                'Security Team',
                ['c3d4e5f6g7h8i9j0'],
                ['hotfix/critical-security-fix'],
                'hotfix/critical-security-fix'
            ),
            new Commit(
                'c3d4e5f6g7h8i9j0',
                'feat: add user dashboard with analytics',
                'John Doe',
                ['d4e5f6g7h8i9j0k1'],
                [],
                'main'
            ),
            new Commit(
                'p0o9n8m7l6k5j4i3',
                'Merge feature/notification-system into develop',
                'Lead Developer',
                ['q1w2e3r4t5y6u7i8', 'l2m3n4o5p6q7r8s9'],
                ['develop', 'origin/develop'],
                'develop'
            ),
            new Commit(
                'd4e5f6g7h8i9j0k1',
                'refactor: improve database connection pooling',
                'Alice Johnson',
                ['e5f6g7h8i9j0k1l2'],
                [],
                'main'
            ),
            new Commit(
                'q1w2e3r4t5y6u7i8',
                'Merge feature/user-profiles into develop',
                'Diana Prince',
                ['r1s2t3u4v5w6x7y8', 'g7h8i9j0k1l2m3n4'],
                [],
                'develop'
            ),
            new Commit(
                'l2m3n4o5p6q7r8s9',
                'feat: add real-time push notifications',
                'Mike Chen',
                ['m3n4o5p6q7r8s9t0'],
                ['feature/notification-system'],
                'feature/notification-system'
            ),
            new Commit(
                'e5f6g7h8i9j0k1l2',
                'docs: update API documentation for v2.0',
                'Technical Writer',
                ['f6g7h8i9j0k1l2m3'],
                [],
                'main'
            ),
            new Commit(
                'g7h8i9j0k1l2m3n4',
                'feat: implement user profile avatar upload',
                'Diana Prince',
                ['h8i9j0k1l2m3n4o5'],
                ['feature/user-profiles'],
                'feature/user-profiles'
            ),
            new Commit(
                'f6g7h8i9j0k1l2m3',
                'test: add comprehensive integration tests',
                'Charlie Brown',
                ['h8i9j0k1l2m3n4o5'],
                [],
                'main'
            ),
            new Commit(
                'm3n4o5p6q7r8s9t0',
                'feat: add notification preferences UI',
                'Sarah Wilson',
                ['n4o5p6q7r8s9t0u1'],
                [],
                'feature/notification-system'
            ),
            new Commit(
                'h8i9j0k1l2m3n4o5',
                'feat: add basic user profile management',
                'Diana Prince',
                ['i9j0k1l2m3n4o5p6'],
                [],
                'feature/user-profiles'
            ),
            new Commit(
                'n4o5p6q7r8s9t0u1',
                'feat: implement WebSocket notification service',
                'Mike Chen',
                ['i9j0k1l2m3n4o5p6'],
                [],
                'feature/notification-system'
            ),
            new Commit(
                'r1s2t3u4v5w6x7y8',
                'feat: improve error handling in API layer',
                'Bob Smith',
                ['i9j0k1l2m3n4o5p6'],
                [],
                'develop'
            ),
            new Commit(
                'i9j0k1l2m3n4o5p6',
                'chore: update dependencies to latest versions',
                'Dependabot',
                ['j0k1l2m3n4o5p6q7'],
                [],
                'main'
            ),
            new Commit(
                'j0k1l2m3n4o5p6q7',
                'Initial commit with project structure',
                'Project Lead',
                [],
                [],
                'main'
            )
        ];
    }

    async getBranches(): Promise<Branch[]> {
        return [
            new Branch('main', 'local', 'a1b2c3d4e5f6g7h8', true),
            new Branch('develop', 'local', 'p0o9n8m7l6k5j4i3'),
            new Branch('feature/user-profiles', 'local', 'g7h8i9j0k1l2m3n4'),
            new Branch('feature/notification-system', 'local', 'l2m3n4o5p6q7r8s9'),
            new Branch('hotfix/critical-security-fix', 'local', 'z9y8x7w6v5u4t3s2'),
            new Branch('origin/main', 'remote', 'b2c3d4e5f6g7h8i9'),
            new Branch('origin/develop', 'remote', 'q1w2e3r4t5y6u7i8'),
            new Branch('origin/feature/user-profiles', 'remote', 'h8i9j0k1l2m3n4o5'),
        ];
    }

    async getRepository(): Promise<GitRepository> {
        const [commits, branches] = await Promise.all([
            this.getCommits(),
            this.getBranches()
        ]);
        return new GitRepository(commits, branches);
    }
}