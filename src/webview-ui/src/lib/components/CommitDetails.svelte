<script lang="ts">
  export let selectedCommit: GitCommit | null = null;

  type GitCommit = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
  };

  // Pure display formatters
  const formatHash = (hash: string) => hash.slice(0, 8);
  const formatParents = (parents: string[]) => 
    parents.length > 0 ? parents.map(formatHash).join(', ') : 'None';
  const formatRefs = (refs: string[]) => 
    refs.length > 0 ? refs.join(', ') : 'None';
</script>

<!-- Modern Commit Details Panel -->
<div class="flex flex-col h-full bg-gray-850 overflow-hidden">
  {#if selectedCommit}
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-200 uppercase tracking-wide">Commit Details</h2>
    </div>
    
    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <!-- Commit Hash -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Hash</label>
        <div class="bg-gray-800 rounded-md p-3 border border-gray-700">
          <code class="text-sm text-blue-300 font-mono">{selectedCommit.hash}</code>
        </div>
      </div>

      <!-- Message -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Message</label>
        <div class="bg-gray-800 rounded-md p-3 border border-gray-700">
          <p class="text-sm text-gray-200 leading-relaxed">{selectedCommit.message}</p>
        </div>
      </div>

      <!-- Author -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Author</label>
        <div class="flex items-center gap-3 bg-gray-800 rounded-md p-3 border border-gray-700">
          <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <span class="text-white text-sm font-medium">
              {(selectedCommit.author || 'U').charAt(0).toUpperCase()}
            </span>
          </div>
          <span class="text-sm text-gray-200">{selectedCommit.author || 'Unknown'}</span>
        </div>
      </div>

      <!-- Parents -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Parents</label>
        <div class="bg-gray-800 rounded-md p-3 border border-gray-700">
          {#if selectedCommit.parents.length > 0}
            <div class="flex flex-wrap gap-2">
              {#each selectedCommit.parents as parent}
                <span class="px-2 py-1 bg-gray-700 rounded text-xs font-mono text-gray-300">
                  {formatHash(parent)}
                </span>
              {/each}
            </div>
          {:else}
            <span class="text-sm text-gray-400 italic">No parents (root commit)</span>
          {/if}
        </div>
      </div>

      <!-- Branches/Tags -->
      {#if selectedCommit.refs.length > 0}
        <div class="space-y-2">
          <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">References</label>
          <div class="bg-gray-800 rounded-md p-3 border border-gray-700">
            <div class="flex flex-wrap gap-2">
              {#each selectedCommit.refs as ref}
                <span class="px-2 py-1 bg-green-600/20 border border-green-500/30 rounded text-xs text-green-300">
                  {ref}
                </span>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <!-- Empty State -->
    <div class="flex flex-col items-center justify-center h-full text-center p-8">
      <div class="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mb-4">
        <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </div>
      <h3 class="text-lg font-medium text-gray-300 mb-2">No Commit Selected</h3>
      <p class="text-sm text-gray-400">Click on a commit to view its details</p>
    </div>
  {/if}
</div>