import { describe, expect, test } from 'vitest';
import { DiscoverRepositoriesUseCase } from './DiscoverRepositoriesUseCase';
import {
    IRepositoryLocator,
    RepositoryScanRequest,
    RepositoryScanResult,
} from '../../domain/repositories/IRepositoryLocator';

class RecordingLocator implements IRepositoryLocator {
    requests: RepositoryScanRequest[] = [];

    constructor(private readonly roots: string[] = []) {}

    discover(request: RepositoryScanRequest): Promise<RepositoryScanResult> {
        this.requests.push(request);
        return Promise.resolve({
            roots: this.roots,
            scannedDirectories: this.roots.length,
            reachedLimit: false,
        });
    }
}

describe('DiscoverRepositoriesUseCase', () => {
    test('labels what the locator found', async () => {
        const locator = new RecordingLocator(['/w/apps/api', '/w/web']);

        const result = await new DiscoverRepositoriesUseCase(locator).execute({
            workspaceFolders: ['/w'],
            maxDepth: 2,
        });

        expect(result.repositories).toEqual([
            { root: '/w/apps/api', name: 'api', description: 'apps/api' },
            { root: '/w/web', name: 'web', description: 'web' },
        ]);
    });

    test('passes the workspace folders and depth straight through', async () => {
        const locator = new RecordingLocator();

        await new DiscoverRepositoriesUseCase(locator).execute({
            workspaceFolders: ['/one', '/two'],
            maxDepth: 3,
        });

        expect(locator.requests).toEqual([
            { roots: ['/one', '/two'], maxDepth: 3 },
        ]);
    });

    test('does not touch the disk when no folder is open', async () => {
        const locator = new RecordingLocator(['/should-not-be-used']);

        const result = await new DiscoverRepositoriesUseCase(locator).execute({
            workspaceFolders: [],
            maxDepth: 2,
        });

        expect(locator.requests).toEqual([]);
        expect(result.repositories).toEqual([]);
    });
});
