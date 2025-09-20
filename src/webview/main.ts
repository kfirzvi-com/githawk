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

type BranchDTO = {
    name: string;
    type: 'local' | 'remote';
    current: boolean;
    commit: string;
};

const container = document.getElementById('root')!;
let selectedCommit: CommitDTO | null = null;
let selectedBranch: string = 'main';
let commits: CommitDTO[] = [];
let branches: BranchDTO[] = [];

function createSimpleGraph(commit: CommitDTO, index: number, allCommits: CommitDTO[]): string {
    // Create a simple but effective graph representation
    const hasMultipleParents = commit.parents.length > 1;
    const isFirst = index === 0;
    const isLast = index === allCommits.length - 1;
    
    let graph = '<div style="display: flex; flex-direction: column; align-items: center; height: 100%; font-family: monospace;">';
    
    // Add vertical line from previous commit (top part)
    if (!isFirst) {
        graph += '<div style="width: 2px; height: 8px; background: #007ACC; flex-shrink: 0;"></div>';
    }
    
    // Add the commit dot
    if (hasMultipleParents) {
        // Merge commit - diamond shape
        graph += '<div style="width: 8px; height: 8px; background: #FD7E14; transform: rotate(45deg); margin: 2px 0; flex-shrink: 0;"></div>';
    } else {
        // Regular commit - circle
        graph += '<div style="width: 8px; height: 8px; background: #28A745; border-radius: 50%; margin: 2px 0; flex-shrink: 0;"></div>';
    }
    
    // Add vertical line to next commit (bottom part)
    if (!isLast) {
        graph += '<div style="width: 2px; height: 8px; background: #007ACC; flex-shrink: 0;"></div>';
    }
    
    graph += '</div>';
    return graph;
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
        
        // Graph visualization column
        const graphCell = document.createElement('div');
        graphCell.className = 'commit-graph';
        graphCell.innerHTML = createSimpleGraph(commit, index, commits);
        
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

function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'toolbar-button';
    refreshBtn.textContent = '↻ Refresh';
    refreshBtn.onclick = () => vscode.postMessage({ type: 'refresh' });
    
    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'toolbar-button secondary';
    fetchBtn.textContent = '⇣ Fetch';
    fetchBtn.onclick = () => vscode.postMessage({ type: 'fetch' });
    
    const pullBtn = document.createElement('button');
    pullBtn.className = 'toolbar-button secondary';
    pullBtn.textContent = '⇣ Pull';
    pullBtn.onclick = () => vscode.postMessage({ type: 'pull' });
    
    const pushBtn = document.createElement('button');
    pushBtn.className = 'toolbar-button secondary';
    pushBtn.textContent = '⇡ Push';
    pushBtn.onclick = () => vscode.postMessage({ type: 'push' });
    
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(fetchBtn);
    toolbar.appendChild(pullBtn);
    toolbar.appendChild(pushBtn);
    
    return toolbar;
}

function createBranchList() {
    const branchList = document.createElement('div');
    branchList.className = 'branch-list';
    
    // Local branches section
    const localSection = document.createElement('div');
    localSection.className = 'branch-section';
    
    const localTitle = document.createElement('div');
    localTitle.className = 'branch-section-title';
    localTitle.textContent = 'Local';
    localSection.appendChild(localTitle);
    
    const localBranches = branches.filter(b => b.type === 'local');
    localBranches.forEach(branch => {
        const item = document.createElement('div');
        item.className = 'branch-item';
        if (branch.current) {
            item.classList.add('active');
        }
        
        const icon = document.createElement('span');
        icon.className = 'branch-icon';
        icon.textContent = branch.current ? '★' : '○';
        
        const name = document.createElement('span');
        name.className = 'branch-name';
        name.textContent = branch.name;
        
        item.appendChild(icon);
        item.appendChild(name);
        
        item.onclick = () => {
            selectedBranch = branch.name;
            vscode.postMessage({ type: 'switchBranch', branch: branch.name });
            updateBranchSelection();
        };
        
        localSection.appendChild(item);
    });
    
    // Remote branches section
    const remoteSection = document.createElement('div');
    remoteSection.className = 'branch-section';
    
    const remoteTitle = document.createElement('div');
    remoteTitle.className = 'branch-section-title';
    remoteTitle.textContent = 'Remote';
    remoteSection.appendChild(remoteTitle);
    
    const remoteBranches = branches.filter(b => b.type === 'remote');
    remoteBranches.forEach(branch => {
        const item = document.createElement('div');
        item.className = 'branch-item';
        
        const icon = document.createElement('span');
        icon.className = 'branch-icon';
        icon.textContent = '◊';
        
        const name = document.createElement('span');
        name.className = 'branch-name';
        name.textContent = branch.name;
        
        item.appendChild(icon);
        item.appendChild(name);
        
        item.onclick = () => {
            vscode.postMessage({ type: 'checkoutRemote', branch: branch.name });
        };
        
        remoteSection.appendChild(item);
    });
    
    branchList.appendChild(localSection);
    branchList.appendChild(remoteSection);
    
    return branchList;
}

function updateBranchSelection() {
    document.querySelectorAll('.branch-item').forEach(item => {
        item.classList.remove('active');
        const nameEl = item.querySelector('.branch-name') as HTMLElement;
        if (nameEl && nameEl.textContent === selectedBranch) {
            item.classList.add('active');
        }
    });
}

function render(commitData: CommitDTO[], branchData?: BranchDTO[]) {
    commits = commitData;
    if (branchData) {
        branches = branchData;
    }
    
    // Clear container
    container.innerHTML = '';
    
    // Create main layout
    const mainContainer = document.createElement('div');
    mainContainer.className = 'git-container';
    
    // Create toolbar
    const toolbar = createToolbar();
    
    // Create main content area
    const mainContent = document.createElement('div');
    mainContent.className = 'main-content';
    
    // Create branch list with resize handle
    const branchListEl = createBranchList();
    const branchResizeHandle = document.createElement('div');
    branchResizeHandle.className = 'resize-handle-right';
    branchListEl.appendChild(branchResizeHandle);
    
    // Create commit area
    const commitArea = document.createElement('div');
    commitArea.className = 'commit-area';
    
    // Create commit list
    const commitListEl = renderCommitList(commitData);
    
    // Create details panel with resize handle
    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'commit-details';
    detailsPanel.innerHTML = '<div class="details-content">Select a commit to see details</div>';
    const detailsResizeHandle = document.createElement('div');
    detailsResizeHandle.className = 'resize-handle-left';
    detailsPanel.appendChild(detailsResizeHandle);
    
    commitArea.appendChild(commitListEl);
    commitArea.appendChild(detailsPanel);
    
    mainContent.appendChild(branchListEl);
    mainContent.appendChild(commitArea);
    
    mainContainer.appendChild(toolbar);
    mainContainer.appendChild(mainContent);
    container.appendChild(mainContainer);
}



function initResizers() {
    // Initialize all resize handles
    setupResizer('.branch-list', '.resize-handle-right', 'width', 150, 400, 1);
    setupResizer('.commit-details', '.resize-handle-left', 'width', 200, 500, -1);
}

function setupResizer(containerSelector: string, handleSelector: string, property: string, min: number, max: number, direction: number) {
    const container = document.querySelector(containerSelector) as HTMLElement;
    const handle = container?.querySelector(handleSelector) as HTMLElement;
    
    if (!container || !handle) {
        return;
    }
    
    let isResizing = false;
    let startX = 0;
    let startValue = 0;
    
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startValue = container.offsetWidth;
        e.preventDefault();
        document.body.style.cursor = 'ew-resize';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isResizing) {
            const delta = (e.clientX - startX) * direction;
            const newValue = startValue + delta;
            
            if (newValue >= min && newValue <= max) {
                container.style[property as any] = newValue + 'px';
            }
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
        }
    });
}

// Receive messages from extension
window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
        case 'init':
            render(message.commits as CommitDTO[], message.branches as BranchDTO[]);
            initResizers();
            break;
        case 'append':
            render(message.commits as CommitDTO[], message.branches as BranchDTO[]);
            break;
    }
});