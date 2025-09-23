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

  // Pure graph renderer - minimal SVG generation
  const createGraphSVG = (commit: GitCommit, graphRow: any): string => {
    if (!graphRow) {
      return `<svg width="120" height="40" class="block">
        <circle cx="15" cy="20" r="4" fill="#3b82f6" stroke="#fff" stroke-width="1"/>
      </svg>`;
    }
    
    const TARGET_HEIGHT = 40;
    const SOURCE_ROW_HEIGHT = 50;
    const SCALE_Y = TARGET_HEIGHT / SOURCE_ROW_HEIGHT;
    
    const scaledCommitX = graphRow.commitX || 15;
    const scaledCommitY = TARGET_HEIGHT / 2;
    const width = Math.max(150, scaledCommitX + 50);
    
    let svg = `<svg width="${width}" height="${TARGET_HEIGHT}" class="block">
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="4" 
                refX="5" refY="2" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 6 2, 0 4" fill="currentColor" opacity="0.6" />
        </marker>
      </defs>`;
    
    // Branch lines
    graphRow.branchLines?.forEach((line: any) => {
      const scaledStartY = Math.max(0, Math.min(TARGET_HEIGHT, line.startY * SCALE_Y));
      const scaledEndY = Math.max(0, Math.min(TARGET_HEIGHT, line.endY * SCALE_Y));
      svg += `<line x1="${line.x}" y1="${scaledStartY}" x2="${line.x}" y2="${scaledEndY}" 
              stroke="${line.color}" stroke-width="2" opacity="${line.opacity}"/>`;
    });
    
    // Connection lines
    graphRow.connectionLines?.forEach((line: any) => {
      const markerEnd = line.hasArrow ? 'marker-end="url(#arrowhead)"' : '';
      const scaledStartY = Math.max(0, Math.min(TARGET_HEIGHT, line.startY * SCALE_Y));
      const scaledEndY = Math.max(0, Math.min(TARGET_HEIGHT, line.endY * SCALE_Y));
      svg += `<line x1="${line.startX}" y1="${scaledStartY}" x2="${line.endX}" y2="${scaledEndY}" 
              stroke="${line.color}" stroke-width="2" ${markerEnd} opacity="0.8"/>`;
    });
    
    // Commit dot
    const radius = commit.parents.length > 1 ? 6 : 5;
    const strokeWidth = commit.parents.length === 0 ? 2 : 1;
    svg += `<circle cx="${scaledCommitX}" cy="${scaledCommitY}" r="${radius}" 
            fill="${graphRow.commitColor}" stroke="#fff" stroke-width="${strokeWidth}"/>`;
    
    svg += '</svg>';
    return svg;
  };
</script>

<!-- Modern Commit Row -->
<button 
  class={`
    w-full flex items-center gap-4 px-4 py-3 border-b border-gray-700/50
    transition-all duration-200 hover:bg-gray-700/30 text-left group
    ${isSelected ? 'bg-blue-600/20 border-blue-500/30' : ''}
  `}
  on:click={handleClick}
>
  <!-- Graph Visualization -->
  <div class="flex-shrink-0">
    {@html createGraphSVG(commit, graphRow)}
  </div>
  
  <!-- Commit Hash -->
  <div class="flex-shrink-0 w-20">
    <code class="text-xs text-blue-300 font-mono bg-gray-800/50 px-2 py-1 rounded">
      {formatHash(commit.hash)}
    </code>
  </div>
  
  <!-- Message & Refs -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="text-sm text-gray-200 truncate font-medium">
        {commit.message}
      </span>
      {#each commit.refs as ref}
        <span class="px-2 py-0.5 bg-green-600/20 border border-green-500/30 rounded text-xs text-green-300 font-medium">
          {ref}
        </span>
      {/each}
    </div>
  </div>
  
  <!-- Author -->
  <div class="flex-shrink-0 w-32 text-right">
    <div class="flex items-center justify-end gap-2">
      <div class="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
        <span class="text-white text-xs font-medium">
          {(commit.author || 'U').charAt(0).toUpperCase()}
        </span>
      </div>
      <span class="text-xs text-gray-400 truncate">
        {commit.author || 'Unknown'}
      </span>
    </div>
  </div>
  
  <!-- Date -->
  <div class="flex-shrink-0 w-24 text-right">
    <span class="text-xs text-gray-500">
      {formatDate()}
    </span>
  </div>
</button>