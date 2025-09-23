# Svelte Integration

This webview now uses Svelte for better component organization and maintainability.

## Component Structure

- `App.svelte` - Main application component
- `components/Toolbar.svelte` - Top toolbar with git actions
- `components/BranchList.svelte` - Left sidebar with branch list
- `components/CommitRow.svelte` - Individual commit row with graph visualization
- `components/CommitDetails.svelte` - Right sidebar with commit details

## Benefits of Svelte

1. **Component-based architecture** - Better code organization
2. **Reactive updates** - Automatic UI updates when data changes
3. **Smaller bundle size** - Svelte compiles to vanilla JS
4. **TypeScript support** - Full type checking for components
5. **Better maintainability** - Easier to modify and extend

## Build Configuration

The esbuild configuration has been updated to include the `esbuild-svelte` plugin which:
- Compiles .svelte files to JavaScript
- Handles CSS injection
- Provides TypeScript support for Svelte components

## Graph Visualization

The graph visualization logic from the clean architecture is preserved in the `CommitRow.svelte` component, maintaining compatibility with the existing `GitGraphService`.