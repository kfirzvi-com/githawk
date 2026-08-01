<script lang="ts">
    import type { Pane } from '../viewmodels/panes';
    import { paneToggleLabel } from '../viewmodels/panes';

    interface Props {
        pane: Pane;
        /** Which side of the graph this handle sits on. */
        side: 'left' | 'right';
        visible: boolean;
        onToggle: (pane: Pane) => void;
    }

    let { pane, side, visible, onToggle }: Props = $props();

    const label = $derived(paneToggleLabel(pane, visible));

    /*
     * The arrow points where the pane is about to go, so the control describes
     * its effect rather than its state — the same reason the tooltip says
     * "Hide" rather than "Shown".
     *
     * A CSS triangle rather than a glyph, for the reason the ref badges use
     * shapes: ‹ › and the arrow characters render differently across platforms
     * and made the screenshot baselines differ by thousands of pixels.
     */
    const pointsLeft = $derived(side === 'left' ? visible : !visible);
</script>

<button
    type="button"
    class="group flex w-3 flex-shrink-0 cursor-pointer items-center justify-center border-gray-700 bg-gray-850 hover:bg-gray-700 {side ===
    'left'
        ? 'border-r'
        : 'border-l'}"
    title={label}
    aria-label={label}
    aria-expanded={visible}
    data-testid={`pane-handle-${pane}`}
    onclick={() => onToggle(pane)}
>
    <span
        aria-hidden="true"
        class="h-0 w-0 border-y-[3px] border-y-transparent {pointsLeft
            ? 'border-r-[4px] border-r-gray-600 group-hover:border-r-gray-200'
            : 'border-l-[4px] border-l-gray-600 group-hover:border-l-gray-200'}"
    ></span>
</button>
