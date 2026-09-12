<script lang="ts">
    import { shortcutKey, type ShortcutAction } from '../viewmodels/shortcuts';

    interface Props {
        action: ShortcutAction;
        /** Shift is down. Rendering nothing otherwise keeps the DOM quiet. */
        shown: boolean;
        /**
         * `corner` hangs off the top-right of the nearest positioned ancestor —
         * the usual case, a badge clipped to the control it belongs to.
         * `centre` covers a control too narrow to hang anything off, such as a
         * pane handle. `inside` tucks the badge within the control's own right
         * edge, for a field whose corners belong to whatever is above it.
         */
        placement?: 'corner' | 'centre' | 'inside';
    }

    let { action, shown, placement = 'corner' }: Props = $props();

    const key = $derived(shortcutKey(action));

    /*
     * Foreground colour as the background and vice versa. Every other option
     * is a claim about the theme: `bg-accent` disappears on the one button that
     * is already accent-coloured, and a fixed amber is unreadable on the light
     * themes. An inversion of two tokens the theme has already guaranteed
     * contrast between cannot be wrong.
     */
    const position = $derived(
        placement === 'corner'
            ? 'absolute -top-1.5 -right-1.5'
            : placement === 'centre'
              ? 'absolute top-1.5 left-1/2 -translate-x-1/2'
              : 'absolute top-1/2 right-1.5 -translate-y-1/2'
    );
</script>

{#if shown}
    <!-- Never clickable: the badge sits over the control it describes, and
         swallowing that click would make the mouse worse to buy the keyboard
         something it does not need. -->
    <span
        aria-hidden="true"
        data-testid={`shortcut-hint-${action}`}
        class="pointer-events-none z-20 select-none rounded-[3px] bg-fg px-1 py-px font-mono text-[10px] leading-none font-bold tracking-wide text-app shadow-sm {position}"
    >
        {key}
    </span>
{/if}
