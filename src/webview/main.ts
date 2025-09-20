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

// Global graph state to maintain consistency across rows
let branchPositions: Map<string, number> = new Map();
let branchColors: Map<string, string> = new Map();
let maxBranches = 0;

function initializeGraphState(commits: CommitDTO[]) {
    branchPositions.clear();
    branchColors.clear();
    
    const colors = ['#007ACC', '#28A745', '#FD7E14', '#DC3545', '#6F42C1', '#17A2B8', '#FFC107'];
    let colorIndex = 0;
    let nextPosition = 0;
    
    // Assign positions and colors to branches
    commits.forEach(commit => {
        const branchHint = commit.branchHint || 'main';
        if (!branchPositions.has(branchHint)) {
            branchPositions.set(branchHint, nextPosition++);
            branchColors.set(branchHint, colors[colorIndex % colors.length]);
            colorIndex++;
        }
    });
    
    maxBranches = nextPosition;
}

function createSimpleGraph(commit: CommitDTO, index: number, allCommits: CommitDTO[]): string {
    const branchHint = commit.branchHint || 'main';
    const branchPosition = branchPositions.get(branchHint) || 0;
    const branchColor = branchColors.get(branchHint) || '#007ACC';
    
    const width = Math.max(120, maxBranches * 25 + 20);
    const height = 35;
    const centerY = height / 2;
    
    let svg = `<svg width="${width}" height="${height}" style="display: block;">`;
    
    // Draw vertical lines for all active branches at this point
    for (let i = 0; i < maxBranches; i++) {
        const x = i * 25 + 15;
        
        // Check if this branch should have a line at this commit
        let shouldDrawLine = false;
        const branchName = Array.from(branchPositions.keys())[i];
        
        if (branchName) {
            // Draw line if this branch has commits before and after this point
            const hasBefore = index < allCommits.length - 1 && 
                            allCommits.slice(index + 1).some(c => (c.branchHint || 'main') === branchName);
            const hasAfter = index > 0 && 
                           allCommits.slice(0, index).some(c => (c.branchHint || 'main') === branchName);
            
            shouldDrawLine = hasBefore || hasAfter || branchName === branchHint;
        }
        
        if (shouldDrawLine) {
            const color = branchColors.get(branchName) || '#666';
            svg += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" 
                    stroke="${color}" stroke-width="2" opacity="0.3"/>`;
        }
    }
    
    // Draw merge lines if this is a merge commit
    if (commit.parents.length > 1) {
        commit.parents.forEach(parentHash => {
            const parentCommit = allCommits.find(c => c.hash === parentHash);
            if (parentCommit) {
                const parentBranch = parentCommit.branchHint || 'main';
                const parentPosition = branchPositions.get(parentBranch) || 0;
                const parentX = parentPosition * 25 + 15;
                const currentX = branchPosition * 25 + 15;
                
                if (parentX !== currentX) {
                    svg += `<line x1="${parentX}" y1="${centerY}" x2="${currentX}" y2="${centerY}" 
                            stroke="#FD7E14" stroke-width="3" opacity="0.8"/>`;
                }
            }
        });
    }
    
    // Draw the commit dot
    const commitX = branchPosition * 25 + 15;
    
    if (commit.parents.length > 1) {
        // Merge commit - diamond
        svg += `<rect x="${commitX-5}" y="${centerY-5}" width="10" height="10" 
                transform="rotate(45 ${commitX} ${centerY})" 
                fill="#FD7E14" stroke="#fff" stroke-width="1"/>`;
    } else if (commit.parents.length === 0) {
        // Initial commit - larger circle
        svg += `<circle cx="${commitX}" cy="${centerY}" r="6" 
                fill="${branchColor}" stroke="#fff" stroke-width="2"/>`;
    } else {
        // Regular commit - circle
        svg += `<circle cx="${commitX}" cy="${centerY}" r="4" 
                fill="${branchColor}" stroke="#fff" stroke-width="1"/>`;
    }
    
    svg += '</svg>';
    return svg;
}

function formatDate(dateStr?: string): string {
    if (!dateStr) {
        return 'Unknown';
    }
    // For now, return a mock date - in real implementation, parse the date
    return '2 hours ago';
}

function renderCommitList(commitData: CommitDTO[]) {
    // Initialize the graph state for consistent positioning
    initializeGraphState(commitData);
    
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

function setupResizerVertical(containerSelector: string, handleSelector: string, property: string, min: number, max: number, direction: number) {
    const container = document.querySelector(containerSelector) as HTMLElement;
    const handle = container?.querySelector(handleSelector) as HTMLElement;
    
    if (!container || !handle) {
        return;
    }
    
    let isResizing = false;
    let startY = 0;
    let startValue = 0;
    
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startValue = container.offsetHeight;
        e.preventDefault();
        document.body.style.cursor = 'ns-resize';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isResizing) {
            const delta = (e.clientY - startY) * direction;
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