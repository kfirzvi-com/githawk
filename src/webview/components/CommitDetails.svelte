<script lang="ts">
  export let selectedCommit: CommitDTO | null = null;

  type CommitDTO = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
  };
</script>

<div class="commit-details">
  {#if selectedCommit}
    <div class="details-section">
      <div class="details-title">Commit</div>
      <div class="details-content">{selectedCommit.hash}</div>
    </div>
    <div class="details-section">
      <div class="details-title">Message</div>
      <div class="details-content">{selectedCommit.message}</div>
    </div>
    <div class="details-section">
      <div class="details-title">Author</div>
      <div class="details-content">{selectedCommit.author || 'Unknown'}</div>
    </div>
    <div class="details-section">
      <div class="details-title">Parents</div>
      <div class="details-content">
        {selectedCommit.parents.length > 0 ? selectedCommit.parents.map(p => p.slice(0, 8)).join(', ') : 'None'}
      </div>
    </div>
    <div class="details-section">
      <div class="details-title">Branches</div>
      <div class="details-content">
        {selectedCommit.refs.length > 0 ? selectedCommit.refs.join(', ') : 'None'}
      </div>
    </div>
  {:else}
    <div class="details-content">Select a commit to see details</div>
  {/if}
  
  <div class="resize-handle-left"></div>
</div>

<style>
  .commit-details {
    width: 300px;
    background: var(--vscode-sideBar-background);
    border-left: 1px solid var(--vscode-widget-border);
    padding: 12px;
    overflow-y: auto;
    position: relative;
  }

  .details-section {
    margin-bottom: 16px;
  }

  .details-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .details-content {
    font-size: 13px;
    color: var(--vscode-foreground);
    word-break: break-word;
    line-height: 1.4;
  }

  .resize-handle-left {
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background: transparent;
  }

  .resize-handle-left:hover {
    background: var(--vscode-focusBorder);
  }
</style>