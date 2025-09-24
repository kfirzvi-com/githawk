<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  export let branches: GitBranch[] = [];

  type GitBranch = {
    name: string;
    type: 'local' | 'remote';
    current: boolean;
    commit: string;
  };

  const dispatch = createEventDispatcher();

  // Pure reactive computations
  $: localBranches = branches.filter(b => b.type === 'local');
  $: remoteBranches = branches.filter(b => b.type === 'remote');

  // Pure event handlers
  const handleBranchSelect = (branchName: string, isRemote: boolean = false) => {
    const eventType = isRemote ? 'checkout-remote' : 'switch-branch';
    dispatch(eventType, { branch: branchName });
  };
</script>

<!-- Modern Branch Panel -->
<div class="flex flex-col h-full bg-gray-850 overflow-hidden">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-gray-700">
    <h2 class="text-sm font-semibold text-gray-200 uppercase tracking-wide">Branches</h2>
  </div>
  
  <!-- Scrollable Branch List -->
  <div class="flex-1 overflow-y-auto">
    <!-- Local Branches -->
    <div class="px-2 py-3">
      <div class="flex items-center gap-2 px-2 py-1 mb-2">
        <div class="w-2 h-2 rounded-full bg-green-400"></div>
        <span class="text-xs font-medium text-gray-300 uppercase tracking-wider">Local</span>
      </div>
      
      <div class="space-y-1">
        {#each localBranches as branch}
          <button 
            class={`
              w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
              transition-all duration-200 group
              ${branch.current 
                ? 'bg-blue-600/20 border border-blue-500/30 text-blue-200' 
                : 'hover:bg-gray-700 text-gray-300'
              }
            `}
            on:click={() => handleBranchSelect(branch.name)}
          >
            <span class={`text-sm ${branch.current ? 'text-yellow-400' : 'text-gray-500'}`}>
              {branch.current ? '★' : '○'}
            </span>
            <span class="flex-1 text-sm font-medium truncate">
              {branch.name}
            </span>
            {#if branch.current}
              <span class="text-xs text-blue-300 bg-blue-600/30 px-2 py-0.5 rounded">
                current
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Remote Branches -->
    {#if remoteBranches.length > 0}
      <div class="px-2 py-3 border-t border-gray-700">
        <div class="flex items-center gap-2 px-2 py-1 mb-2">
          <div class="w-2 h-2 rounded-full bg-orange-400"></div>
          <span class="text-xs font-medium text-gray-300 uppercase tracking-wider">Remote</span>
        </div>
        
        <div class="space-y-1">
          {#each remoteBranches as branch}
            <button 
              class="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left
                     hover:bg-gray-700 text-gray-300 transition-all duration-200"
              on:click={() => handleBranchSelect(branch.name, true)}
            >
              <span class="text-sm text-orange-400">◊</span>
              <span class="flex-1 text-sm truncate">{branch.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>