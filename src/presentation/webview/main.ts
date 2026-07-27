import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { isHostedInVsCode } from './vscodeApi';

const app = mount(App, {
    target: document.getElementById('app')!,
});

// Standalone in a browser: stand up a fake host so the page renders fixtures.
// The dynamic import keeps the fixtures out of the production bundle entirely.
if (import.meta.env.DEV && !isHostedInVsCode) {
    void import('./devFixtureHost').then(({ startFixtureHost }) =>
        startFixtureHost()
    );
}

export default app;
