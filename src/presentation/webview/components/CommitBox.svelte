<script lang="ts">
    import type { WorkingTreeStatus } from '../../../domain/models/WorkingTreeStatus';

    interface Props {
        status: WorkingTreeStatus;
        /** Tools that can write a message, in setting order. Empty hides the row. */
        tools: string[];
        selectedTool: string | null;
        /**
         * Text the host wants in the box. Applied whenever `draftVersion`
         * changes, and only then — see below.
         */
        draft: string;
        draftVersion: number;
        busy: boolean;
        onDraft: (message: string) => void;
        onSelectTool: (tool: string) => void;
        onGenerate: (tool: string) => void;
        onCommit: (message: string) => void;
        onStageAll: () => void;
    }

    let {
        status,
        tools,
        selectedTool,
        draft,
        draftVersion,
        busy,
        onDraft,
        onSelectTool,
        onGenerate,
        onCommit,
        onStageAll,
    }: Props = $props();

    /*
     * The textarea owns the text while the reader types. The host's draft
     * replaces it only when the host has something new to say — the text a
     * rebuilt box should start with, a generated message, an empty box after
     * a commit — and says so by bumping the version. Comparing the strings
     * instead would either clobber typing with a state message that is a
     * keystroke behind, or fail to empty a box whose host-side draft was
     * already empty.
     */
    let message = $state('');
    let appliedVersion = $state(-1);
    $effect(() => {
        if (draftVersion !== appliedVersion) {
            appliedVersion = draftVersion;
            message = draft;
        }
    });

    let tool = $state<string | null>(null);
    $effect(() => {
        if (selectedTool && tools.includes(selectedTool)) {
            tool = selectedTool;
        } else {
            tool = tools[0] ?? null;
        }
    });

    let textarea = $state<HTMLTextAreaElement | null>(null);

    const subject = $derived(message.split('\n')[0] ?? '');
    const canCommit = $derived(
        !busy &&
            message.trim().length > 0 &&
            status.conflicted === 0 &&
            status.staged + status.unstaged + status.untracked > 0
    );

    /**
     * What pressing Commit will do, said before it is pressed. The two cases
     * differ in what they promise, and the button's label says which.
     */
    const commitLabel = $derived(
        status.staged > 0
            ? `Commit ${status.staged} staged ${status.staged === 1 ? 'file' : 'files'}`
            : 'Commit all changes'
    );
    const scopeNote = $derived(
        status.conflicted > 0
            ? `${status.conflicted} conflicted — resolve and stage first`
            : status.staged > 0
              ? status.unstaged + status.untracked > 0
                  ? `${status.unstaged + status.untracked} more not staged`
                  : 'everything is staged'
              : status.unstaged + status.untracked > 0
                ? 'nothing staged — Commit stages everything first, and asks'
                : 'nothing to commit'
    );

    const edit = (value: string) => {
        message = value;
        onDraft(value);
    };

    const submit = () => {
        if (canCommit) {
            onCommit(message);
        }
    };

    const generate = () => {
        if (tool && !busy) {
            onGenerate(tool);
        }
    };

    /** Cmd/Ctrl+Enter commits, as it does in VS Code's own box. */
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
        }
    };

    /** Focuses the textarea; the host calls this when a message arrives. */
    export function focusMessage(): void {
        textarea?.focus();
    }
</script>

<!--
    Every control is allowed to shrink to nothing (`min-w-0`) and the rows
    wrap: the sidebar can be dragged to a couple of hundred pixels, and a
    box that scrolled sideways there would hide its own Commit button.
-->
<div class="flex min-w-0 flex-col gap-2 p-2 text-fg" data-testid="commit-box">
    <textarea
        bind:this={textarea}
        class="block min-h-[4.5rem] w-full min-w-0 max-w-full resize-y rounded-sm border border-input-line bg-input px-2 py-1.5 font-sans text-[13px] leading-snug text-input-fg placeholder:text-input-placeholder focus:border-focus focus:outline-none"
        placeholder="Message ({navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Enter to commit)"
        aria-label="Commit message"
        data-testid="commit-message"
        value={message}
        oninput={(event) => edit(event.currentTarget.value)}
        onkeydown={onKeyDown}
        disabled={busy}
        rows="3"
        spellcheck="true"
    ></textarea>

    {#if subject.length > 72}
        <p class="text-[11px] text-warn-soft" data-testid="subject-warning">
            {`The first line is ${subject.length} characters; git tools show 72.`}
        </p>
    {/if}

    {#if tools.length > 0}
        <!--
            One row: which tool, and the button that runs it. The select is
            the choice the reader made once; the button is the thing they
            press every time.
        -->
        <div class="flex flex-wrap items-stretch gap-1.5">
            <select
                class="min-w-0 flex-1 basis-28 truncate rounded-sm border border-input-line bg-dropdown px-1.5 py-1 text-xs text-dropdown-fg focus:border-focus focus:outline-none"
                aria-label="Write the message with"
                data-testid="commit-tool"
                value={tool ?? ''}
                onchange={(event) => {
                    tool = event.currentTarget.value;
                    onSelectTool(tool);
                }}
                disabled={busy}
            >
                {#each tools as name (name)}
                    <option value={name}>{name}</option>
                {/each}
            </select>
            <button
                type="button"
                class="flex flex-shrink-0 flex-grow items-center justify-center gap-1 rounded-sm border border-line-strong bg-control px-2 py-1 text-xs font-medium text-fg-soft hover:bg-control-hover disabled:cursor-default disabled:opacity-50"
                data-testid="generate-message"
                title="Ask {tool} to write the message from the diff. It runs once, non-interactively; the result lands here for you to edit."
                onclick={generate}
                disabled={busy || tool === null}
            >
                <span aria-hidden="true">✦</span>
                {busy ? 'Working…' : 'Generate'}
            </button>
        </div>
    {/if}

    <div class="flex flex-wrap items-center gap-2">
        <button
            type="button"
            class="min-w-0 flex-1 truncate rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
            data-testid="commit-button"
            onclick={submit}
            disabled={!canCommit}
        >
            {commitLabel}
        </button>
        {#if status.staged === 0 && status.unstaged + status.untracked > 0}
            <button
                type="button"
                class="rounded-sm border border-line-strong bg-control px-2 py-1.5 text-xs text-fg-soft hover:bg-control-hover disabled:opacity-50"
                data-testid="stage-all"
                title="Stage every change, untracked files included"
                onclick={onStageAll}
                disabled={busy}
            >
                Stage all
            </button>
        {/if}
    </div>
    <p class="text-[11px] text-fg-dim" data-testid="commit-scope">{scopeNote}</p>
</div>
