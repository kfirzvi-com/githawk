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
let selectedCommit: CommitDTO | null = null;
let commits: CommitDTO[] = [];

function createSimpleGraph(commit: CommitDTO, index: number): string {
    // Simple ASCII-style graph representation
    const isFirst = index === 0;
    const hasParents = commit.parents.length > 0;
    
    if (isFirst) {
        return '● ';
    } else if (commit.parents.length > 1) {
        return '◉ '; // Merge commit
    } else {
        return '● ';
    }
}

function formatDate(dateStr?: string): string {
    if (!dateStr) {
        return 'Unknown';
    }
    // For now, return a mock date - in real implementation, parse the date
    return '2 hours ago';
}

function renderCommitList(commitData: CommitDTO[]) {
    const commitList = document.createElement('div');
    commitList.className = 'commit-list';
    
    commitData.forEach((commit, index) => {
        const row = document.createElement('div');
        row.className = 'commit-row';
        if (selectedCommit?.hash === commit.hash) {
            row.classList.add('selected');
        }
        
        // Graph column
        const graphCell = document.createElement('div');
        graphCell.className = 'commit-graph';
        graphCell.textContent = createSimpleGraph(commit, index);
        
        // Hash column
        const hashCell = document.createElement('div');
        hashCell.className = 'commit-hash';
        hashCell.textContent = commit.hash.slice(0, 8);
        
        // Message column
        const messageCell = document.createElement('div');
        messageCell.className = 'commit-message';
        messageCell.textContent = commit.message;
        
        // Add branch refs if any
        commit.refs.forEach(ref => {
            const refSpan = document.createElement('span');
            refSpan.className = 'branch-ref';
            refSpan.textContent = ref;
            messageCell.appendChild(refSpan);
        });
        
        // Author column
        const authorCell = document.createElement('div');
        authorCell.className = 'commit-author';
        authorCell.textContent = commit.author || 'Unknown';
        
        // Date column
        const dateCell = document.createElement('div');
        dateCell.className = 'commit-date';
        dateCell.textContent = formatDate();
        
        row.appendChild(graphCell);
        row.appendChild(hashCell);
        row.appendChild(messageCell);
        row.appendChild(authorCell);
        row.appendChild(dateCell);
        
        row.addEventListener('click', () => {
            // Remove previous selection
            document.querySelectorAll('.commit-row').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            selectedCommit = commit;
            renderCommitDetails(commit);
            vscode.postMessage({ type: 'selectCommit', hash: commit.hash });
        });
        
        commitList.appendChild(row);
    });
    
    return commitList;
}

function renderCommitDetails(commit: CommitDTO) {
    const detailsPanel = document.querySelector('.commit-details') as HTMLElement;
    if (!detailsPanel) {
        return;
    }
    
    detailsPanel.innerHTML = `
        <div class="details-section">
            <div class="details-title">Commit</div>
            <div class="details-content">${commit.hash}</div>
        </div>
        <div class="details-section">
            <div class="details-title">Message</div>
            <div class="details-content">${commit.message}</div>
        </div>
        <div class="details-section">
            <div class="details-title">Author</div>
            <div class="details-content">${commit.author || 'Unknown'}</div>
        </div>
        <div class="details-section">
            <div class="details-title">Parents</div>
            <div class="details-content">${commit.parents.length > 0 ? commit.parents.map(p => p.slice(0, 8)).join(', ') : 'None'}</div>
        </div>
        <div class="details-section">
            <div class="details-title">Branches</div>
            <div class="details-content">${commit.refs.length > 0 ? commit.refs.join(', ') : 'None'}</div>
        </div>
    `;
}

function render(commitData: CommitDTO[]) {
    commits = commitData;
    
    // Clear container
    container.innerHTML = '';
    
    // Create main layout
    const mainContainer = document.createElement('div');
    mainContainer.className = 'git-log-container';
    
    // Create commit list
    const commitListEl = renderCommitList(commitData);
    
    // Create details panel
    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'commit-details';
    detailsPanel.innerHTML = '<div class="details-content">Select a commit to see details</div>';
    
    mainContainer.appendChild(commitListEl);
    mainContainer.appendChild(detailsPanel);
    container.appendChild(mainContainer);
    
    // Auto-select first commit
    if (commitData.length > 0) {
        selectedCommit = commitData[0];
        const firstRow = document.querySelector('.commit-row');
        if (firstRow) {
            firstRow.classList.add('selected');
            renderCommitDetails(commitData[0]);
        }
    }
}

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