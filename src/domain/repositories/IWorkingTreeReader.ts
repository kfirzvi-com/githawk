import { WorkingTreeStatus } from '../models/WorkingTreeStatus';

export interface IWorkingTreeReader {
    read(): Promise<WorkingTreeStatus>;
}
