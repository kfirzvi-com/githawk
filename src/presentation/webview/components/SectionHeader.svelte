<script lang="ts">
    import type { Section } from '../viewmodels/sections';

    interface Props {
        section: Section;
        label: string;
        /** Shown beside the label, so a collapsed section still says how much is in it. */
        count?: number;
        /** Tailwind class for the section's dot. */
        dot: string;
        open: boolean;
        onToggle: (section: Section) => void;
    }

    let { section, label, count, dot, open, onToggle }: Props = $props();
</script>

<button
    type="button"
    class="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-control"
    aria-expanded={open}
    data-testid={`section-${section}`}
    title={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
    onclick={() => onToggle(section)}
>
    <!-- Rotated rather than swapped for a second glyph, so the two states are
         the same shape at the same size and only the direction changes. -->
    <span
        aria-hidden="true"
        class="text-[9px] text-fg-faint transition-transform duration-100 {open
            ? 'rotate-90'
            : ''}"
    >
        ▶
    </span>
    <div class="h-2 w-2 flex-shrink-0 rounded-full {dot}"></div>
    <span class="text-xs font-medium tracking-wider text-fg-muted uppercase">
        {label}
    </span>
    {#if count !== undefined}
        <span class="text-[10px] text-fg-faint">{count}</span>
    {/if}
</button>
