<script lang="ts">
    import CommitBox from './components/CommitBox.svelte';
    import {
        cleanWorkingTree,
        type WorkingTreeStatus,
    } from '../../domain/models/WorkingTreeStatus';
    import { onHostMessage, postToHost } from './vscodeApi';

    /**
     * The commit box's page. Everything on it is the host's state, echoed:
     * the box is rebuilt whenever the sidebar hides and shows it, so it asks
     * for its state on arrival and keeps nothing the host does not also have.
     */
    let status = $state<WorkingTreeStatus>(cleanWorkingTree);
    let tools = $state<string[]>([]);
    let selectedTool = $state<string | null>(null);
    let draft = $state('');
    /**
     * Bumped whenever the host means to replace the text: once on the first
     * state, so a rebuilt box starts with the draft the host kept, and then
     * for a generated message or an emptied box. Later state messages carry
     * the draft the reader is typing, a keystroke behind — applying those
     * would fight the caret.
     */
    let draftVersion = $state(0);
    let hasDraft = $state(false);
    let busy = $state(false);
    let box = $state<CommitBox | null>(null);

    const replaceDraft = (text: string) => {
        draft = text;
        draftVersion += 1;
    };

    $effect(() => {
        const stop = onHostMessage((message) => {
            switch (message.type) {
                case 'commit:state':
                    status = message.status;
                    tools = message.tools;
                    selectedTool = message.selectedTool;
                    busy = message.busy;
                    if (!hasDraft) {
                        hasDraft = true;
                        replaceDraft(message.draft);
                    }
                    break;
                case 'commit:generated':
                    replaceDraft(message.message);
                    box?.focusMessage();
                    break;
                case 'commit:committed':
                    replaceDraft('');
                    break;
            }
        });
        postToHost({ type: 'commit:ready' });
        return stop;
    });
</script>

<!--
    app.css gives the body a 320px floor, which suits a graph panel and not a
    sidebar view that can be dragged narrower than that: below it the box
    scrolled sideways and hid its own Commit button.
-->
<svelte:head>
    <style>
        body {
            min-width: 0;
            background-color: var(--vscode-sideBar-background, #1a1a1a);
        }
    </style>
</svelte:head>

<div class="min-w-0 bg-pane font-sans">
    <CommitBox
        bind:this={box}
        {status}
        {tools}
        {selectedTool}
        {draft}
        {draftVersion}
        {busy}
        onDraft={(message) => postToHost({ type: 'commit:draft', message })}
        onSelectTool={(tool) => postToHost({ type: 'commit:selectTool', tool })}
        onGenerate={(tool) => postToHost({ type: 'commit:generate', tool })}
        onCommit={(message) => postToHost({ type: 'commit:submit', message })}
        onStageAll={() => postToHost({ type: 'commit:stageAll' })}
    />
</div>
