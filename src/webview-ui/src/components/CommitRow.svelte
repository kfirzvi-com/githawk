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

  // Improved graph data processing with better column mapping
  const getGraphData = (commit: GitCommit, graphRow: any) => {
    if (!graphRow) {
      return {
        commitDot: { column: 0, color: '#3b82f6', type: 'normal' },
        branches: [],
        connections: [],
        maxColumn: 0
      };
    }

    // More accurate column mapping - find unique X positions first
    const allXPositions = [
      graphRow.commitX || 20,
      ...(graphRow.branchLines || []).map((line: any) => line.x),
      ...(graphRow.connectionLines || []).flatMap((line: any) => [line.startX, line.endX])
    ].filter((x, i, arr) => arr.indexOf(x) === i).sort((a, b) => a - b);

    // Create column mapping
    const getColumn = (x: number) => allXPositions.indexOf(x);
    
    const commitDot = {
      column: getColumn(graphRow.commitX || 20),
      color: graphRow.commitColor || '#3b82f6',
      type: commit.parents.length > 1 ? 'merge' : commit.parents.length === 0 ? 'root' : 'normal'
    };

    const branches = (graphRow.branchLines || []).map((line: any) => ({
      column: getColumn(line.x),
      color: line.color || '#6b7280',
      opacity: line.opacity || 0.8
    }));

    const connections = (graphRow.connectionLines || []).map((line: any) => ({
      startColumn: getColumn(line.startX),
      endColumn: getColumn(line.endX),
      color: line.color || '#6b7280',
      hasArrow: line.hasArrow || false,
      type: Math.abs(line.startX - line.endX) < 5 ? 'straight' : 'diagonal'
    }));

    const maxColumn = Math.max(0, allXPositions.length - 1);

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
  <!-- Graph Visualization - Compact and Responsive -->
  <div 
    class="flex-shrink-0 h-8 sm:h-10 lg:h-12 relative flex items-center git-graph-container"
    style="width: {Math.max(3, graphData.maxColumn + 1) * 0.75}rem;"
  >
    <!-- Branch lines (vertical) -->
    {#each graphData.branches as branch}
      <div 
        class="absolute top-0 bottom-0 w-0.5 bg-current branch-line rounded-full"
        style="left: {branch.column * 0.75}rem; color: {branch.color}; opacity: {branch.opacity};"
      ></div>
    {/each}
    
    <!-- Connection lines (merge/branch lines) -->
    {#each graphData.connections as connection}
      {#if connection.type === 'straight'}
        <div 
          class="absolute top-1/2 h-0.5 bg-current transform -translate-y-0.5 connection-line"
          style="left: {Math.min(connection.startColumn, connection.endColumn) * 0.75}rem; width: {Math.abs(connection.endColumn - connection.startColumn) * 0.75}rem; color: {connection.color};"
        >
          {#if connection.hasArrow}
            <div class="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-0.5 connection-arrow">
              <div class="w-0 h-0 border-l-[4px] border-t-[2px] border-b-[2px] border-current border-t-transparent border-b-transparent"></div>
            </div>
          {/if}
        </div>
      {:else}
        <!-- Simplified diagonal connection -->
        <div 
          class="absolute top-1/2 h-0.5 bg-current transform -translate-y-0.5 connection-line opacity-60"
          style="left: {Math.min(connection.startColumn, connection.endColumn) * 0.75}rem; width: {Math.abs(connection.endColumn - connection.startColumn) * 0.75}rem; color: {connection.color}; transform-origin: left center; transform: translateY(-50%) skewY({connection.endColumn > connection.startColumn ? '-15deg' : '15deg'});"
        >
          {#if connection.hasArrow}
            <div class="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-0.5 connection-arrow">
              <div class="w-0 h-0 border-l-[4px] border-t-[2px] border-b-[2px] border-current border-t-transparent border-b-transparent"></div>
            </div>
          {/if}
        </div>
      {/if}
    {/each}
    
    <!-- Commit dot -->
    <div 
      class="absolute top-1/2 transform -translate-y-1/2 -translate-x-1/2 rounded-full border border-gray-900 z-10 commit-dot"
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
      class:ring-offset-1={graphData.commitDot.type === 'root'}
      class:ring-offset-gray-900={graphData.commitDot.type === 'root'}
      style="left: {graphData.commitDot.column * 0.75}rem; background-color: {graphData.commitDot.color};"
    ></div>
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