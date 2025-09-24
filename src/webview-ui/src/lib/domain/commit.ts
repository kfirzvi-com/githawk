export type Commit = {
    hash: string;
    parentHashes: string[];
    refs: string[];
    message: string;
    timestamp: string;
}