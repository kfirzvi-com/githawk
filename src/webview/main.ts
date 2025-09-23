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
    
    // Predefined colors for main branches, then additional colors for feature branches
    const mainColors = ['#007ACC', '#28A745', '#FD7E14', '#DC3545'];  // Blue, Green, Orange, Red
    const featureColors = ['#6F42C1', '#17A2B8', '#FFC107', '#E83E8C', '#20C997', '#6C757D'];
    let mainColorIndex = 0;
    let featureColorIndex = 0;
    let nextPosition = 0;
    
    // Assign main/develop branches to leftmost positions first
    const mainBranches = ['main', 'develop', 'master'];
    commits.forEach(commit => {
        const branchHint = commit.branchHint || 'main';
        if (mainBranches.includes(branchHint) && !branchPositions.has(branchHint)) {
            branchPositions.set(branchHint, nextPosition++);
            branchColors.set(branchHint, mainColors[mainColorIndex % mainColors.length]);
            mainColorIndex++;
        }
    });
    
    // Then assign feature branches
    commits.forEach(commit => {
        const branchHint = commit.branchHint || 'main';
        if (!branchPositions.has(branchHint)) {
            branchPositions.set(branchHint, nextPosition++);
            branchColors.set(branchHint, featureColors[featureColorIndex % featureColors.length]);
            featureColorIndex++;
        }
    });
    
    maxBranches = nextPosition;
}

function getBranchLifetime(branchName: string, commits: any[]): { start: number, end: number } {
    let start = commits.length;
    let end = -1;
    
    commits.forEach((commit, index) => {
        if (commit.branchHint === branchName || commit.refs.includes(branchName)) {
            start = Math.min(start, index);
            end = Math.max(end, index);
        }
    });
    
    // If no commits found, return invalid range
    if (start === commits.length) {
        return { start: -1, end: -1 };
    }
    
    return { start, end };
}

function shouldDrawBranchLineAt(branchName: string, commitIndex: number, commits: any[]): boolean {
    const commit = commits[commitIndex];
    
    // Always draw for the commit's own branch (but we'll handle spacing in the drawing code)
    if (commit.branchHint === branchName) {
        return true;
    }
    
    // Get basic branch lifetime
    const branchLifetime = getBranchLifetime(branchName, commits);
    if (branchLifetime.start === -1) {
        return false; // Branch doesn't exist
    }
    
    // Find where this branch gets merged (if it does)
    let branchMergePoint = -1;
    for (let i = 0; i < commits.length; i++) {
        const mergeCommit = commits[i];
        if (mergeCommit.parents.length > 1) {
            const mergesFromThisBranch = mergeCommit.parents.some((parentHash: string) => {
                const parentCommit = commits.find(c => c.hash === parentHash);
                return parentCommit && parentCommit.branchHint === branchName;
            });
            if (mergesFromThisBranch) {
                branchMergePoint = i;
                break; // Take the first (topmost) merge point
            }
        }
    }
    
    // Determine the range where we should draw lines
    let startPoint = branchLifetime.start;
    let endPoint = branchLifetime.end;
    
    // If this branch gets merged, extend the line to the merge point
    if (branchMergePoint !== -1 && branchMergePoint < startPoint) {
        startPoint = branchMergePoint;
    }
    
    // Draw line if we're within the extended range and there are commits above
    const withinRange = commitIndex >= startPoint && commitIndex <= endPoint;
    const hasCommitAbove = commitIndex > startPoint;
    
    return withinRange && hasCommitAbove;
}

function createSimpleGraph(commit: CommitDTO, index: number, allCommits: CommitDTO[]): string {
    const branchHint = commit.branchHint || 'main';
    const branchPosition = branchPositions.get(branchHint) || 0;
    const branchColor = branchColors.get(branchHint) || '#007ACC';
    
    const width = Math.max(120, maxBranches * 25 + 20);
    const height = 35;
    const centerY = height / 2;
    
    let svg = `<svg width="${width}" height="${height}" style="display: block;">
        <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" 
                    refX="5" refY="2" orient="auto" markerUnits="strokeWidth">
                <polygon points="0 0, 6 2, 0 4" fill="currentColor" opacity="0.6" />
            </marker>
        </defs>`;
    
    // Draw continuous vertical lines for branches that flow through this commit level
    for (let i = 0; i < maxBranches; i++) {
        const x = i * 25 + 15;
        const branchName = Array.from(branchPositions.keys())[i];
        
        if (branchName && shouldDrawBranchLineAt(branchName, index, allCommits)) {
            const color = branchColors.get(branchName) || '#666';
            
            if (branchName === branchHint) {
                // For the current commit's branch, draw line but leave space for the commit dot
                svg += `<line x1="${x}" y1="0" x2="${x}" y2="${centerY - 6}" 
                        stroke="${color}" stroke-width="1.5" opacity="0.6"/>`;
                svg += `<line x1="${x}" y1="${centerY + 6}" x2="${x}" y2="${height}" 
                        stroke="${color}" stroke-width="1.5" opacity="0.6"/>`;
            } else {
                // For other branches, draw continuous line
                svg += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" 
                        stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
            }
        }
    }
    
    // Draw subtle arrows only for branch splits and merges
    const nextCommit = index > 0 ? allCommits[index - 1] : null;
    if (nextCommit && nextCommit.parents.includes(commit.hash)) {
        const nextBranch = nextCommit.branchHint || 'main';
        const nextPosition = branchPositions.get(nextBranch) || 0;
        const nextX = nextPosition * 25 + 15;
        const commitX = branchPosition * 25 + 15;
        
        // Only show arrow if it's not a straight vertical line
        if (nextX !== commitX) {
            const startY = centerY - 2;
            const endY = 2;
            const color = branchColors.get(nextBranch) || '#007ACC';
            
            // Simple diagonal line with small arrow
            svg += `<line x1="${commitX}" y1="${startY}" x2="${nextX}" y2="${endY}" 
                    stroke="${color}" stroke-width="1.5" 
                    marker-end="url(#arrowhead)" opacity="0.7"/>`;
        }
    }
    
    // Show merge arrows for merge commits
    if (commit.parents.length > 1) {
        commit.parents.forEach(parentHash => {
            const parentIndex = allCommits.findIndex(c => c.hash === parentHash);
            if (parentIndex > index) { // Parent is below in the list
                const parentCommit = allCommits[parentIndex];
                const parentBranch = parentCommit.branchHint || 'main';
                const parentPosition = branchPositions.get(parentBranch) || 0;
                const parentX = parentPosition * 25 + 15;
                const commitX = branchPosition * 25 + 15;
                
                if (parentX !== commitX) {
                    const startY = height - 2;
                    const endY = centerY + 2;
                    
                    // Use the color of the branch being merged FROM (the source branch)
                    const sourceBranchColor = branchColors.get(parentBranch) || '#FD7E14';
                    
                    svg += `<line x1="${parentX}" y1="${startY}" x2="${commitX}" y2="${endY}" 
                            stroke="${sourceBranchColor}" stroke-width="1.5" 
                            marker-end="url(#arrowhead)" opacity="0.7"/>`;
                }
            }
        });
    }
    
    // Draw the commit dot - always a circle
    const commitX = branchPosition * 25 + 15;
    
    // Determine commit color based on branch column position
    let commitColor = branchColor;
    
    if (commit.parents.length > 1) {
        // Merge commit - use the target branch color (the branch being merged INTO)
        // This commit's branchHint represents the target branch
        commitColor = branchColor;
        
        // Merge commit - larger circle
        svg += `<circle cx="${commitX}" cy="${centerY}" r="5" 
                fill="${commitColor}" stroke="#fff" stroke-width="1"/>`;
    } else if (commit.parents.length === 0) {
        // Initial commit - larger circle with branch color
        svg += `<circle cx="${commitX}" cy="${centerY}" r="5" 
                fill="${commitColor}" stroke="#fff" stroke-width="2"/>`;
    } else {
        // Regular commit - circle with branch color
        svg += `<circle cx="${commitX}" cy="${centerY}" r="4" 
                fill="${commitColor}" stroke="#fff" stroke-width="1"/>`;
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