console.log('[DEBUG] main.ts - Starting webview initialization');

import App from './App.svelte';
import { mount } from 'svelte';

console.log('[DEBUG] main.ts - Svelte App imported');

const container = document.getElementById('root');
console.log('[DEBUG] main.ts - Container element:', container);

if (!container) {
  console.error('[ERROR] main.ts - Could not find #root element');
} else {
  console.log('[DEBUG] main.ts - Initializing Svelte app');
  try {
    // Initialize the Svelte app (Svelte 5 syntax)
    const app = mount(App, {
      target: container
    });
    console.log('[DEBUG] main.ts - Svelte app initialized successfully:', app);
  } catch (error) {
    console.error('[ERROR] main.ts - Failed to initialize Svelte app:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[ERROR] main.ts - Error details:', errorMessage, errorStack);
    // Fallback: show error in the UI
    container.innerHTML = `<div style="color: red; padding: 20px;">
      <h3>Svelte Initialization Error</h3>
      <p>${errorMessage}</p>
      <pre>${errorStack}</pre>
    </div>`;
  }
}