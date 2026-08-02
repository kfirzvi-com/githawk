import { Stash } from '../models/Stash';

export interface IStashReader {
    /** Most recent first, as git lists them. */
    list(): Promise<Stash[]>;
}
