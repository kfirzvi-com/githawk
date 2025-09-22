import { CommitRow } from '../domain/models/GraphElements';

export class GitGraphRenderer {
    private static readonly SVG_DEFS = `
        <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="4" 
                    refX="0" refY="2" orient="auto">
                <polygon points="0 0, 6 2, 0 4" fill="currentColor" opacity="0.6" />
            </marker>
        </defs>
    `;

    renderGraph(commitRows: CommitRow[], containerWidth: number = 800): string {
        const height = commitRows.length * 50;
        const svgElements = commitRows.map(row => row.render()).join('');
        
        return `
            <svg width="${containerWidth}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                ${GitGraphRenderer.SVG_DEFS}
                ${svgElements}
            </svg>
        `;
    }

    renderCommitTable(commitRows: CommitRow[]): string {
        const rows = commitRows.map((row, index) => {
            const commit = this.extractCommitFromRow(row);
            return `
                <div class="commit-row" data-index="${index}">
                    <div class="commit-graph">
                        ${this.renderGraph([row], 120)}
                    </div>
                    <div class="commit-hash">${commit.shortHash}</div>
                    <div class="commit-message">${commit.message}</div>
                    <div class="commit-author">${commit.author}</div>
                    <div class="commit-date">${this.formatDate(commit.timestamp)}</div>
                    ${commit.refs.map((ref: string) => `<span class="branch-ref">${ref}</span>`).join('')}
                </div>
            `;
        }).join('');

        return `<div class="commit-list">${rows}</div>`;
    }

    private extractCommitFromRow(row: CommitRow): any {
        // This is a simplified extraction - in a real implementation,
        // you'd want to pass the commit data alongside the rendered row
        return {
            shortHash: row.commitNode.commitHash.substring(0, 8),
            message: 'Commit message', // Would need to be passed from domain
            author: 'Author', // Would need to be passed from domain
            timestamp: new Date(),
            refs: []
        };
    }

    private formatDate(date?: Date): string {
        if (!date) {
            return '';
        }
        return date.toLocaleDateString();
    }
}