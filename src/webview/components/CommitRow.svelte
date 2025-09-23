<script lang="ts">
  export let commit: CommitDTO;
  export let index: number;
  export let graphRow: any;
  export let isSelected: boolean = false;

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  function handleClick() {
    dispatch('click', commit);
  }

  type CommitDTO = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
  };

  function formatDate(dateStr?: string): string {
    if (!dateStr) {
      return 'Unknown';
    }
    return '2 hours ago';
  }

  function createGraphSVG(commit: CommitDTO, graphRow: any): string {
    if (!graphRow) {
      return `<svg width="120" height="35" style="display: block;">
        <circle cx="15" cy="17.5" r="4" fill="#007ACC" stroke="#fff" stroke-width="1"/>
      </svg>`;
    }
    
    const width = Math.max(150, (graphRow.commitX || 15) + 50);
    const height = 35;
    const scaledCommitX = Math.min(graphRow.commitX || 15, width - 20);
    
    let svg = `<svg width="${width}" height="${height}" style="display: block;">
      <defs>
        <marker id="arrowhead" markerWidth="6" markerHeight="4" 
                refX="5" refY="2" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 6 2, 0 4" fill="currentColor" opacity="0.6" />
        </marker>
      </defs>`;
    
    // Draw branch lines
    graphRow.branchLines.forEach((line: any) => {
      svg += `<line x1="${line.x}" y1="${line.startY}" x2="${line.x}" y2="${line.endY}" 
              stroke="${line.color}" stroke-width="1.5" opacity="${line.opacity}"/>`;
    });
    
    // Draw connection lines
    graphRow.connectionLines.forEach((line: any) => {
      const markerEnd = line.hasArrow ? 'marker-end="url(#arrowhead)"' : '';
      svg += `<line x1="${line.startX}" y1="${line.startY}" x2="${line.endX}" y2="${line.endY}" 
              stroke="${line.color}" stroke-width="1.5" ${markerEnd} opacity="0.7"/>`;
    });
    
    // Draw the commit dot
    const radius = commit.parents.length > 1 ? 5 : (commit.parents.length === 0 ? 5 : 4);
    const strokeWidth = commit.parents.length === 0 ? 2 : 1;
    
    svg += `<circle cx="${graphRow.commitX}" cy="${graphRow.commitY}" r="${radius}" 
            fill="${graphRow.commitColor}" stroke="#fff" stroke-width="${strokeWidth}"/>`;
    
    svg += '</svg>';
    return svg;
  }
</script>

<div class="commit-row" class:selected={isSelected} on:click={handleClick} role="button" tabindex="0" on:keydown={(e) => e.key === 'Enter' && handleClick()}>
  <div class="commit-graph">
    {@html createGraphSVG(commit, graphRow)}
  </div>
  
  <div class="commit-hash">
    {commit.hash.slice(0, 8)}
  </div>
  
  <div class="commit-message">
    {commit.message}
    {#each commit.refs as ref}
      <span class="branch-ref">{ref}</span>
    {/each}
  </div>
  
  <div class="commit-author">
    {commit.author || 'Unknown'}
  </div>
  
  <div class="commit-date">
    {formatDate()}
  </div>
</div>

<style>
  .commit-row {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-widget-border);
    cursor: pointer;
    min-height: 35px;
  }

  .commit-row:hover {
    background-color: var(--vscode-list-hoverBackground);
  }

  .commit-row.selected {
    background-color: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .commit-graph {
    flex-shrink: 0;
    margin-right: 8px;
  }

  .commit-hash {
    flex-shrink: 0;
    width: 80px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .commit-message {
    flex: 1;
    min-width: 0;
    padding: 0 8px;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .branch-ref {
    display: inline-block;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    margin-left: 8px;
  }

  .commit-author {
    flex-shrink: 0;
    width: 120px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    text-align: right;
    padding-right: 8px;
  }

  .commit-date {
    flex-shrink: 0;
    width: 100px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    text-align: right;
  }
</style>