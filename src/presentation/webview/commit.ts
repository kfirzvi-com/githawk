import { mount } from 'svelte';
import './app.css';
import CommitApp from './CommitApp.svelte';
import { isHostedInVsCode } from './vscodeApi';

/**
 * The sidebar's commit box: a second, much smaller page than the graph, built
 * from the same sources and served from the same bundle directory.
 */
const app = mount(CommitApp, {
    target: document.getElementById('app')!,
});

// Standalone in a browser: a fake host, so the box renders and can be driven
// by Playwright. Dropped from the production bundle with the harness.
if (import.meta.env.DEV && !isHostedInVsCode) {
    void import('./devCommitHost').then(({ startCommitHost }) =>
        startCommitHost()
    );
}

export default app;
