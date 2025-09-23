<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let branches: BranchDTO[] = [];

  type BranchDTO = {
    name: string;
    type: 'local' | 'remote';
    current: boolean;
    commit: string;
  };

  const dispatch = createEventDispatcher();

  $: localBranches = branches.filter(b => b.type === 'local');
  $: remoteBranches = branches.filter(b => b.type === 'remote');

  function handleBranchSelect(branchName: string, isRemote: boolean = false) {
    if (isRemote) {
      dispatch('checkout-remote', { branch: branchName });
    } else {
      dispatch('switch-branch', { branch: branchName });
    }
  }
</script>

<div class="branch-list">
  <div class="branch-section">
    <div class="branch-section-title">Local</div>
    {#each localBranches as branch}
      <div 
        class="branch-item" 
        class:active={branch.current}
        on:click={() => handleBranchSelect(branch.name)}
        role="button"
        tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && handleBranchSelect(branch.name)}
      >
        <span class="branch-icon">
          {branch.current ? '★' : '○'}
        </span>
        <span class="branch-name">{branch.name}</span>
      </div>
    {/each}
  </div>

  <div class="branch-section">
    <div class="branch-section-title">Remote</div>
    {#each remoteBranches as branch}
      <div 
        class="branch-item"
        on:click={() => handleBranchSelect(branch.name, true)}
        role="button"
        tabindex="0"
        on:keydown={(e) => e.key === 'Enter' && handleBranchSelect(branch.name, true)}
      >
        <span class="branch-icon">◊</span>
        <span class="branch-name">{branch.name}</span>
      </div>
    {/each}
  </div>

  <div class="resize-handle-right"></div>
</div>

<style>
  .branch-list {
    width: 250px;
    background: var(--vscode-sideBar-background);
    border-right: 1px solid var(--vscode-widget-border);
    overflow-y: auto;
    position: relative;
  }

  .branch-section {
    padding: 8px 0;
  }

  .branch-section-title {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
    user-select: none;
  }

  .branch-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .branch-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
    font-weight: 600;
  }

  .branch-icon {
    margin-right: 8px;
    font-size: 12px;
    width: 12px;
    text-align: center;
  }

  .branch-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .resize-handle-right {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background: transparent;
  }

  .resize-handle-right:hover {
    background: var(--vscode-focusBorder);
  }
</style>