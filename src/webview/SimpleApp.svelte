<script lang="ts">
  console.log('[DEBUG] SimpleApp.svelte - Script block executing');
  
  import { onMount } from 'svelte';
  
  onMount(() => {
    console.log('[DEBUG] SimpleApp.svelte - Component mounted successfully');
  });
</script>

<div class="simple-container">
  <h1>Svelte Test Component</h1>
  <p>If you see this, Svelte is working!</p>
</div>

<style>
  .simple-container {
    padding: 20px;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
  }
  
  h1 {
    color: #007ACC;
    margin-bottom: 10px;
  }
</style>