<script lang="ts">
  import Toolbar from './lib/components/Toolbar.svelte';
  import BranchList from './lib/components/BranchList.svelte';
  import CommitDetails from './lib/components/CommitDetails.svelte';
  import GitGraph from './lib/components/GitGraph.svelte';

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


  // TEMP: Use mock data for default view
  import { mockCommits, mockBranches, mockGraphRows } from './mock-git-data';
  let commits: GitCommit[] = [...mockCommits].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  let branches: GitBranch[] = mockBranches;
  let graphRows: any[] = mockGraphRows;
  let selectedCommit: GitCommit | null = null;
  let isLoading = false;

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
          <GitGraph {commits} colW={28} rowH={40}>
            <svelte:fragment slot="row" let:commit let:row>
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs text-blue-300">{commit.hash.slice(0,8)}</span>
                <span class="truncate text-sm text-gray-100 font-medium">{commit.message}</span>
                <span class="text-xs text-gray-400">{commit.author}</span>
                <span class="text-xs text-gray-500">{commit.date ? (new Date(commit.date)).toLocaleDateString() : ''}</span>
              </div>
            </svelte:fragment>
          </GitGraph>
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