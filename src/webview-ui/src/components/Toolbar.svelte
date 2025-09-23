<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  
  const dispatch = createEventDispatcher();

  // Pure event handlers - just dispatch actions
  const actions = [
    { id: 'refresh', label: 'Refresh', icon: '↻', primary: true },
    { id: 'fetch', label: 'Fetch', icon: '⇣', primary: false },
    { id: 'pull', label: 'Pull', icon: '⇣', primary: false },
    { id: 'push', label: 'Push', icon: '⇡', primary: false },
  ];

  const handleAction = (type: string) => {
    dispatch('action', { type });
  };
</script>

<!-- Modern Toolbar with Tailwind -->
<div class="flex items-center gap-3 px-4 py-3 bg-gray-800 border-b border-gray-600">
  <div class="flex items-center gap-2">
    <div class="w-2 h-2 rounded-full bg-green-400"></div>
    <span class="text-sm font-medium text-gray-200">Git Repository</span>
  </div>
  
  <div class="flex-1"></div>
  
  <div class="flex items-center gap-2">
    {#each actions as action}
      <button 
        class={`
          flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md
          transition-all duration-200 hover:scale-105
          ${action.primary 
            ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md' 
            : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600'
          }
        `}
        on:click={() => handleAction(action.id)}
      >
        <span class="text-sm">{action.icon}</span>
        <span>{action.label}</span>
      </button>
    {/each}
  </div>
</div>