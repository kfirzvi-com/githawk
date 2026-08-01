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
                badge: 'border-blue-400 bg-blue-500/25 text-blue-100 font-semibold',
                marker: 'bg-blue-300',
                shape: 'rounded-full ring-1 ring-blue-200/60',
                label: 'checked out branch',
            };
        }
        switch (ref.kind) {
            case 'localBranch':
                return {
                    badge: 'border-blue-500/40 bg-blue-500/15 text-blue-200',
                    marker: 'bg-blue-400',
                    shape: 'rounded-sm',
                    label: 'branch',
                };
            case 'remoteBranch':
                return {
                    badge: 'border-gray-600 bg-gray-700/40 text-gray-400',
                    marker: 'bg-gray-500',
                    shape: 'rounded-full',
                    label: 'remote branch',
                };
            case 'tag':
                return {
                    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
                    marker: 'bg-amber-400',
                    // Rotated square reads as a tag without needing an icon font.
                    shape: 'rotate-45',
                    label: 'tag',
                };
            case 'head':
                return {
                    badge: 'border-purple-400/50 bg-purple-500/20 text-purple-200',
                    marker: 'bg-purple-300',
                    shape: 'rounded-full ring-1 ring-purple-200/60',
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
