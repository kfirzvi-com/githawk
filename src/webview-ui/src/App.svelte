<script lang="ts">
  import Toolbar from './components/Toolbar.svelte';
  import BranchList from './components/BranchList.svelte';
  import CommitRow from './components/CommitRow.svelte';
  import CommitDetails from './components/CommitDetails.svelte';

  // @ts-ignore - acquireVsCodeApi is provided by VS Code webview context
  const vscode = window.acquireVsCodeApi?.() || { postMessage: () => {} };

  // Pure display data types - no business logic
  type GitCommit = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
  };

  type GitBranch = {
    name: string;
    type: 'local' | 'remote';
    current: boolean;
    commit: string;
  };

  // Display state - purely reactive
  let commits: GitCommit[] = [];
  let branches: GitBranch[] = [];
  let graphRows: any[] = [];
  let selectedCommit: GitCommit | null = null;
  let isLoading = true;

  // Pure event handlers - no business logic, just message passing
  const handleToolbarAction = (event: CustomEvent) => {
    vscode.postMessage({ type: event.detail.type });
  };

  const handleCommitSelect = (commit: GitCommit) => {
    selectedCommit = commit;
    vscode.postMessage({ type: 'selectCommit', hash: commit.hash });
  };

  const handleSwitchBranch = (event: CustomEvent) => {
    vscode.postMessage({ type: 'switchBranch', branch: event.detail.branch });
  };

  const handleCheckoutRemote = (event: CustomEvent) => {
    vscode.postMessage({ type: 'checkoutRemote', branch: event.detail.branch });
  };

  // Pure message handler - only updates display state
  const handleMessage = (event: MessageEvent) => {
    const message = event.data;
    
    // Ignore hot-reload messages
    if (message.type === 'hot-reload') return;
    
    // Pure data binding - no processing
    switch (message.type) {
      case 'init':
      case 'append':
        commits = message.commits || [];
        branches = message.branches || [];
        graphRows = message.graphRows || [];
        isLoading = false;
        break;
    }
  };

  // Setup - pure initialization
  if (typeof window !== 'undefined') {
    window.addEventListener('message', handleMessage);
  }
</script>

<!-- Pure Display Layer - Modern Git Graph Interface -->
<div class="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
  {#if isLoading}
    <!-- Loading State -->
    <div class="flex flex-col items-center justify-center h-full">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mb-4"></div>
      <div class="text-lg font-medium text-gray-200">Loading Git Repository</div>
      <div class="text-sm text-gray-400 mt-2">Analyzing commit history...</div>
    </div>
  {:else}
    <!-- Toolbar -->
    <div class="flex-shrink-0 border-b border-gray-700">
      <Toolbar on:action={handleToolbarAction} />
    </div>
    
    <!-- Main Content Area -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Panel: Branches -->
      <div class="w-64 flex-shrink-0 border-r border-gray-700 bg-gray-850">
        <BranchList 
          {branches} 
          on:switch-branch={handleSwitchBranch}
          on:checkout-remote={handleCheckoutRemote}
        />
      </div>
      
      <!-- Center: Commit Graph & List -->
      <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-y-auto bg-gray-800">
          {#each commits as commit, index}
            <CommitRow 
              {commit} 
              graphRow={graphRows[index]}
              isSelected={selectedCommit?.hash === commit.hash}
              on:click={() => handleCommitSelect(commit)}
            />
          {/each}
        </div>
      </div>
      
      <!-- Right Panel: Commit Details -->
      <div class="w-80 flex-shrink-0 border-l border-gray-700 bg-gray-850">
        <CommitDetails selectedCommit={selectedCommit} />
      </div>
    </div>
  {/if}
</div>

<!-- Pure Tailwind CSS - No custom styles needed for layout -->