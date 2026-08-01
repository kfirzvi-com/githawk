/**
 * A named repository this one exchanges commits with.
 *
 * Fetch and push URLs are separate because git keeps them separate: a fork
 * workflow commonly fetches from upstream and pushes to a personal remote, and
 * showing one URL for a remote that has two is how someone pushes somewhere
 * they did not mean to.
 */
export class Remote {
    constructor(
        readonly name: string,
        readonly fetchUrl: string,
        readonly pushUrl: string
    ) {}

    /** True when fetch and push disagree, which is worth saying out loud. */
    get hasSeparatePushUrl(): boolean {
        return this.pushUrl !== this.fetchUrl;
    }
}
