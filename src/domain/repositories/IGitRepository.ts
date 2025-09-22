import { Commit } from '../models/Commit';
import { Branch } from '../models/Branch';
import { GitRepository } from '../models/GitRepository';

export interface IGitRepository {
    getCommits(): Promise<Commit[]>;
    getBranches(): Promise<Branch[]>;
    getRepository(): Promise<GitRepository>;
}