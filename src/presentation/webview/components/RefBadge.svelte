<script lang="ts">
    import type { Ref } from '../../../domain/models/Ref';

    interface Props {
        ref: Ref;
        /**
         * Opens this ref's menu. Only branches have one, so a tag or a detached
         * HEAD badge is left inert rather than given an action that does
         * nothing.
         */
        onActivate?: (ref: Ref) => void;
    }

    let { ref, onActivate }: Props = $props();

    /*
     * role="button" rather than a real one: the badge is rendered inside the
     * commit row's <button>, and a nested button is invalid HTML that browsers
     * silently restructure — which moves the badge out of the row.
     *
     * The click is stopped from reaching the row, so opening a branch's menu
     * does not also re-select the commit underneath it.
     */
    const activate = (event: Event) => {
        if (!onActivate) {
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        onActivate(ref);
    };

    /*
     * Markers are CSS shapes, not glyphs. Emoji and the rarer Unicode symbols
     * (⎇, ☁, 🏷) load asynchronously, fall back to boxes on some platforms, and
     * made the screenshot tests differ by thousands of pixels between runs.
     * A square, a circle, and a rotated square are unambiguous and free.
     */
    const style = $derived.by(() => {
        if (ref.isHead) {
            return {
                badge: 'border-info-strong bg-accent-hover/25 text-info font-semibold',
                marker: 'bg-info',
                shape: 'rounded-full ring-1 ring-info/60',
                label: 'checked out branch',
            };
        }
        switch (ref.kind) {
            case 'localBranch':
                return {
                    badge: 'border-info-strong/40 bg-accent-hover/15 text-info',
                    marker: 'bg-info-strong',
                    shape: 'rounded-sm',
                    label: 'branch',
                };
            case 'remoteBranch':
                return {
                    badge: 'border-line-strong bg-hover text-fg-dim',
                    marker: 'bg-fg-faint',
                    shape: 'rounded-full',
                    label: 'remote branch',
                };
            case 'tag':
                return {
                    badge: 'border-warn/40 bg-warn/15 text-warn-soft',
                    marker: 'bg-warn',
                    // Rotated square reads as a tag without needing an icon font.
                    shape: 'rotate-45',
                    label: 'tag',
                };
            case 'stash':
                return {
                    badge: 'border-warn/40 bg-warn/15 text-warn-soft',
                    marker: 'bg-warn',
                    // A half-height bar: work set down rather than a point in
                    // history, and unmistakable next to the dot and the square.
                    shape: 'rounded-[1px] scale-y-50',
                    label: 'stash entry',
                };
            case 'head':
                return {
                    badge: 'border-special/50 bg-special/20 text-special',
                    marker: 'bg-special',
                    shape: 'rounded-full ring-1 ring-special/60',
                    label: 'detached HEAD',
                };
        }
    });
</script>

<span
    class="inline-flex max-w-[13rem] flex-shrink-0 items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap {style.badge} {onActivate
        ? 'cursor-pointer hover:brightness-125'
        : ''}"
    title={onActivate
        ? `${style.label}: ${ref.name} — click for its actions`
        : `${style.label}: ${ref.name}`}
    data-testid={onActivate ? 'ref-badge-action' : undefined}
    role={onActivate ? 'button' : undefined}
    tabindex={onActivate ? 0 : undefined}
    onclick={activate}
    onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            activate(event);
        }
    }}
>
    <span
        aria-hidden="true"
        class="h-1.5 w-1.5 flex-shrink-0 {style.marker} {style.shape}"
    ></span>
    <span class="truncate">{ref.name}</span>
</span>
