import { Blame } from '../models/Blame';

export interface BlameRequest {
    /** Absolute for a file on disk, repository-relative for a revision. */
    path: string;
    /** Blamed in place of the file on disk — an editor's unsaved buffer. */
    contents?: string;
    /** Blamed as of this revision rather than the working tree. */
    rev?: string;
}

export interface IBlameReader {
    read(request: BlameRequest): Promise<Blame>;
}
