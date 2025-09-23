<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import BranchList from './components/BranchList.svelte';
  import CommitRow from './components/CommitRow.svelte';
  import CommitDetails from './components/CommitDetails.svelte';

  declare function acquireVsCodeApi(): { postMessage(msg: any): void };
  const vscode = acquireVsCodeApi();

  type CommitDTO = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
  };

  type BranchDTO = {
    name: string;
    type: 'local' | 'remote';
    current: boolean;
    commit: string;
  };

  let commits: CommitDTO[] = [];
  let branches: BranchDTO[] = [];
  let graphRows: any[] = [];
  let selectedCommit: CommitDTO | null = null;
  let isLoading = true;

  function handleToolbarAction(event: CustomEvent) {
    vscode.postMessage({ type: event.detail.type });
  }

  function handleCommitSelect(commit: CommitDTO) {
    selectedCommit = commit;
    vscode.postMessage({ type: 'selectCommit', hash: commit.hash });
  }

  function handleSwitchBranch(event: CustomEvent) {
    vscode.postMessage({ type: 'switchBranch', branch: event.detail.branch });
  }

  function handleCheckoutRemote(event: CustomEvent) {
    vscode.postMessage({ type: 'checkoutRemote', branch: event.detail.branch });
  }

  // Listen for messages from the extension
  function handleMessage(event: MessageEvent) {
    const message = event.data;
    console.log('[DEBUG] App.svelte - Received message:', message.type);
    console.log('[DEBUG] App.svelte - Commits count:', message.commits?.length);
    console.log('[DEBUG] App.svelte - Graph rows count:', message.graphRows?.length);
    console.log('[DEBUG] App.svelte - Full message:', message);
    
    switch (message.type) {
      case 'init':
      case 'append':
        console.log('[DEBUG] App.svelte - Updating data...');
        commits = message.commits || [];
        branches = message.branches || [];
        graphRows = message.graphRows || [];
        isLoading = false;
        console.log('[DEBUG] App.svelte - Data updated. Commits:', commits.length, 'Branches:', branches.length);
        break;
    }
  }

  // Set up message listener
  if (typeof window !== 'undefined') {
    console.log('[DEBUG] App.svelte - Setting up message listener');
    window.addEventListener('message', handleMessage);
  }

  // Component lifecycle
  import { onMount } from 'svelte';
  
  onMount(() => {
    console.log('[DEBUG] App.svelte - Component mounted successfully');
    console.log('[DEBUG] App.svelte - Initial state - commits:', commits.length, 'branches:', branches.length);
  });
</script>

<div class="git-container">
  {#if isLoading}
    <div class="loading-container">
      <div class="loading-message">Loading Git log...</div>
      <div class="loading-details">Initializing Svelte components...</div>
    </div>
  {:else}
    <Toolbar on:action={handleToolbarAction} />
    
    <div class="main-content">
      <BranchList 
        {branches} 
        on:switch-branch={handleSwitchBranch}
        on:checkout-remote={handleCheckoutRemote}
      />
      
      <div class="commit-area">
        <div class="commit-list">
          {#each commits as commit, index}
            <CommitRow 
              {commit} 
              {index} 
              graphRow={graphRows[index]}
              isSelected={selectedCommit?.hash === commit.hash}
              on:click={() => handleCommitSelect(commit)}
            />
          {/each}
        </div>
        
        <CommitDetails {selectedCommit} />
      </div>
    </div>
  {/if}
</div>

<style>
  .git-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--vscode-font-family);
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
  }

  .main-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .commit-area {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .commit-list {
    flex: 1;
    overflow-y: auto;
    background: var(--vscode-editor-background);
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    text-align: center;
  }

  .loading-message {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--vscode-foreground);
  }

  .loading-details {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
</style>