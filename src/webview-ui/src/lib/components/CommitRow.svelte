<script lang="ts">
  export let commit: GitCommit;
  export let graphRow: any;
  export let isSelected: boolean = false;

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  type GitCommit = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
  };

  // Pure event handler
  const handleClick = () => dispatch('click', commit);

  // Pure display formatters
  const formatHash = (hash: string) => hash.slice(0, 8);
  const formatDate = () => '2 hours ago'; // TODO: Get from commit data

  // Simplified graph data processing - keep it simple and clear
  const getGraphData = (commit: GitCommit, graphRow: any) => {
    if (!graphRow) {
      return {
        commitDot: { color: '#3b82f6', type: 'normal' },
        branches: [],
        connections: [],
        maxColumn: 1
      };
    }

    const commitDot = {
      color: graphRow.commitColor || '#3b82f6',
      type: commit.parents.length > 1 ? 'merge' : commit.parents.length === 0 ? 'root' : 'normal'
    };

    // Convert raw positions to simple column indices
    const COLUMN_WIDTH = 20;
    
    const branches = (graphRow.branchLines || []).map((line: any, index: number) => ({
      column: Math.floor(line.x / COLUMN_WIDTH) + 1, // Offset by 1 to leave space for commit dots
      color: line.color || '#6b7280',
      opacity: line.opacity || 0.8
    }));

    const connections = (graphRow.connectionLines || []).map((line: any) => {
      const startCol = Math.floor(line.startX / COLUMN_WIDTH) + 1;
      const endCol = Math.floor(line.endX / COLUMN_WIDTH) + 1;
      
      return {
        startColumn: startCol,
        endColumn: endCol,
        color: line.color || '#6b7280',
        hasArrow: line.hasArrow || false,
        type: startCol === endCol ? 'straight' : 'diagonal'
      };
    });

    // Calculate max column needed
    const maxColumn = Math.max(
      2, // Minimum columns
      ...branches.map(b => b.column),
      ...connections.flatMap(c => [c.startColumn, c.endColumn])
    );

    return { commitDot, branches, connections, maxColumn };
  };

  $: graphData = getGraphData(commit, graphRow);
</script>

<!-- Modern Commit Row -->
<button 
  class={`
    w-full flex items-center gap-1 sm:gap-2 lg:gap-4 px-1 sm:px-2 lg:px-4 py-2 sm:py-3 border-b border-gray-700/50
    transition-all duration-200 hover:bg-gray-700/30 text-left group text-xs sm:text-sm
    ${isSelected ? 'bg-blue-600/20 border-blue-500/30' : ''}
  `}
  on:click={handleClick}
>
  <!-- Graph Visualization - Clean and Simple -->
  <div class="flex-shrink-0 w-20 sm:w-28 lg:w-36 h-8 sm:h-10 lg:h-12 overflow-x-auto">
    <div 
      class="h-full relative flex items-center git-graph-container"
      style="width: {Math.max(4, graphData.maxColumn) * 1}rem;"
    >
      <!-- Branch lines (vertical) -->
      {#each graphData.branches as branch}
        <div 
          class="absolute top-0 bottom-0 w-0.5 bg-current branch-line"
          style="left: {branch.column}rem; color: {branch.color}; opacity: {branch.opacity};"
        ></div>
      {/each}
      
      <!-- Connection lines -->
      {#each graphData.connections as connection}
        {#if connection.type === 'straight'}
          <!-- Horizontal line -->
          <div 
            class="absolute top-1/2 h-0.5 bg-current transform -translate-y-0.5"
            style="left: {Math.min(connection.startColumn, connection.endColumn)}rem; width: {Math.abs(connection.endColumn - connection.startColumn)}rem; color: {connection.color};"
          >
            {#if connection.hasArrow}
              <div class="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-1">
                <div class="w-0 h-0 border-l-[4px] border-t-[2px] border-b-[2px] border-current border-t-transparent border-b-transparent"></div>
              </div>
            {/if}
          </div>
        {:else}
          <!-- Curved connection using simple CSS -->
          <div 
            class="absolute top-1/2 h-0.5 bg-current transform -translate-y-0.5 opacity-80"
            style="left: {Math.min(connection.startColumn, connection.endColumn)}rem; width: {Math.abs(connection.endColumn - connection.startColumn)}rem; color: {connection.color}; border-radius: 2px;"
          >
            {#if connection.hasArrow}
              <div class="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-1">
                <div class="w-0 h-0 border-l-[4px] border-t-[2px] border-b-[2px] border-current border-t-transparent border-b-transparent"></div>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
      
      <!-- Commit dot - Always at left edge for perfect alignment -->
      <div 
        class="absolute top-1/2 left-4 transform -translate-y-1/2 -translate-x-1/2 rounded-full border border-gray-900 z-20"
        class:w-2={graphData.commitDot.type === 'normal'}
        class:h-2={graphData.commitDot.type === 'normal'}
        class:w-3={graphData.commitDot.type === 'merge'}
        class:h-3={graphData.commitDot.type === 'merge'}
        class:sm:w-3={graphData.commitDot.type === 'normal'}
        class:sm:h-3={graphData.commitDot.type === 'normal'}
        class:sm:w-4={graphData.commitDot.type === 'merge'}
        class:sm:h-4={graphData.commitDot.type === 'merge'}
        class:ring-1={graphData.commitDot.type === 'root'}
        class:ring-white={graphData.commitDot.type === 'root'}
        style="background-color: {graphData.commitDot.color};"
      ></div>
    </div>
  </div>
  
  <!-- Commit Hash - Compact -->
  <div class="flex-shrink-0 w-12 sm:w-16 lg:w-20">
    <code class="text-xs text-blue-300 font-mono bg-gray-800/50 px-1 py-0.5 sm:py-1 rounded block truncate">
      {formatHash(commit.hash)}
    </code>
  </div>
  
  <!-- Message & Refs - Flexible -->
  <div class="flex-1 min-w-0 mr-1">
    <div class="flex items-center gap-1">
      <span class="text-xs sm:text-sm text-gray-200 truncate font-medium leading-tight">
        {commit.message}
      </span>
      {#each commit.refs.slice(0, 2) as ref}
        <span class="hidden lg:inline px-1.5 py-0.5 bg-green-600/20 border border-green-500/30 rounded text-xs text-green-300 font-medium whitespace-nowrap">
          {ref}
        </span>
      {/each}
      {#if commit.refs.length > 2}
        <span class="hidden lg:inline text-xs text-gray-500">+{commit.refs.length - 2}</span>
      {/if}
    </div>
    <!-- Mobile refs indicator -->
    {#if commit.refs.length > 0}
      <div class="lg:hidden mt-0.5">
        <span class="text-xs text-green-400">
          {commit.refs.length} ref{commit.refs.length > 1 ? 's' : ''}
        </span>
      </div>
    {/if}
  </div>
  
  <!-- Author Avatar - Compact -->
  <div class="flex-shrink-0 w-6 sm:w-8 lg:w-auto lg:flex lg:items-center lg:gap-2">
    <div class="w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
      <span class="text-white text-xs font-medium">
        {(commit.author || 'U').charAt(0).toUpperCase()}
      </span>
    </div>
    <span class="hidden lg:inline text-xs text-gray-400 truncate max-w-20">
      {commit.author || 'Unknown'}
    </span>
  </div>
  
  <!-- Date - Compact -->
  <div class="flex-shrink-0 w-12 sm:w-16 lg:w-20 text-right">
    <span class="text-xs text-gray-500 leading-tight">
      {formatDate()}
    </span>
  </div>
</button>