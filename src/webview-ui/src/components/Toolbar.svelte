<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();

  function handleRefresh() {
    dispatch('action', { type: 'refresh' });
  }

  function handleFetch() {
    dispatch('action', { type: 'fetch' });
  }

  function handlePull() {
    dispatch('action', { type: 'pull' });
  }

  function handlePush() {
    dispatch('action', { type: 'push' });
  }
</script>

<div class="toolbar">
  <button class="toolbar-button" on:click={handleRefresh}>
    ↻ Refresh
  </button>
  <button class="toolbar-button secondary" on:click={handleFetch}>
    ⇣ Fetch
  </button>
  <button class="toolbar-button secondary" on:click={handlePull}>
    ⇣ Pull
  </button>
  <button class="toolbar-button secondary" on:click={handlePush}>
    ⇡ Push
  </button>
</div>

<style>
  .toolbar {
    display: flex;
    gap: 8px;
    padding: 8px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border);
    align-items: center;
  }

  .toolbar-button {
    padding: 6px 12px;
    border: 1px solid var(--vscode-button-border);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
    white-space: nowrap;
  }

  .toolbar-button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .toolbar-button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .toolbar-button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
</style>