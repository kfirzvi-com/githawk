import { Blame } from '../models/Blame';

export interface IBlameReader {
    /** `path` is absolute; the adapter makes it relative to the repository. */
    read(path: string): Promise<Blame>;
}
