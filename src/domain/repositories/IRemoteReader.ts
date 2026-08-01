import { Remote } from '../models/Remote';

export interface IRemoteReader {
    list(): Promise<Remote[]>;
}
