import { Blame } from '../models/Blame';

export interface IBlameReader {
    /**
     * `path` is absolute. `contents`, when given, is blamed in place of the
     * file on disk — an editor's unsaved buffer.
     */
    read(path: string, contents?: string): Promise<Blame>;
}
