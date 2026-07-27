export type ToolbarAction = 'refresh' | 'fetch' | 'pull' | 'push';

export interface ToolbarActionSpec {
    id: ToolbarAction;
    label: string;
    icon: string;
    primary: boolean;
}

export const toolbarActions: ToolbarActionSpec[] = [
    { id: 'refresh', label: 'Refresh', icon: '↻', primary: true },
    { id: 'fetch', label: 'Fetch', icon: '⇣', primary: false },
    { id: 'pull', label: 'Pull', icon: '⇣', primary: false },
    { id: 'push', label: 'Push', icon: '⇡', primary: false },
];
