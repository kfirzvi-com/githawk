import { createGitgraph, TemplateName, templateExtend } from '@gitgraph/js';

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
const vscode = acquireVsCodeApi();

type CommitDTO = {
    hash: string;
    message: string;
    author?: string;
    parents: string[];
    refs: string[];
    branchHint?: string;
};

const container = document.getElementById('root')!;
let gitgraph = createGitgraph(container, {
    template: templateExtend(TemplateName.Metro, {
        branch: { label: { display: true } },
        commit: { message: { displayAuthor: false, displayHash: true } },
    }),
});

const branches = new Map<string, ReturnType<typeof gitgraph.branch>>();

function getBranch(name: string) {
    if (!branches.has(name)) {
        branches.set(name, gitgraph.branch(name));
    }
    return branches.get(name)!;
}

function render(commits: CommitDTO[]) {
    // Clear existing graph
    container.innerHTML = '';
    branches.clear();
    
    // Recreate gitgraph
    const newGitgraph = createGitgraph(container, {
        template: templateExtend(TemplateName.Metro, {
            branch: { label: { display: true } },
            commit: { message: { displayAuthor: false, displayHash: true } },
        }),
    });
    
    // Update branch getter to use new instance
    const newBranches = new Map<string, ReturnType<typeof newGitgraph.branch>>();
    function getNewBranch(name: string) {
        if (!newBranches.has(name)) {
            newBranches.set(name, newGitgraph.branch(name));
        }
        return newBranches.get(name)!;
    }

    // Order commits: oldest → newest for replay
    const ordered = [...commits].reverse();
    const laneOf = new Map<string, string>(); // commit hash -> branch name

    // Prime branches from refs at heads
    for (const c of ordered) {
        for (const ref of c.refs) {
            getNewBranch(ref);
        }
    }

    // Replay commits
    for (const c of ordered) {
        const laneName = (c.refs[0] ?? c.branchHint ?? laneOf.get(c.parents[0] ?? '')) ?? 'main';
        const lane = getNewBranch(laneName);

        if (c.parents.length <= 1) {
            // Linear commit
            lane.commit({
                hash: c.hash.slice(0, 7),
                subject: c.message,
                onClick: () => vscode.postMessage({ type: 'openCommit', hash: c.hash }),
            });
            laneOf.set(c.hash, laneName);
        } else {
            // Merge commit - first create the merge commit on the target lane
            lane.commit({
                hash: c.hash.slice(0, 7),
                subject: c.message,
                onClick: () => vscode.postMessage({ type: 'openCommit', hash: c.hash }),
            });
            laneOf.set(c.hash, laneName);
        }
    }
}

// Handle resize
new ResizeObserver(() => {
    // Trigger re-render with cached commits if needed
}).observe(container);

// Receive messages from extension
window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'init':
            render(message.commits as CommitDTO[]);
            break;
        case 'append':
            render(message.commits as CommitDTO[]);
            break;
    }
});