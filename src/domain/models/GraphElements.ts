import { Color } from './Color';

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export abstract class GraphElement {
    constructor(
        public readonly id: string,
        public readonly bounds: BoundingBox
    ) {}

    abstract render(): string; // Returns SVG string
}

export class CommitNode extends GraphElement {
    constructor(
        id: string,
        bounds: BoundingBox,
        public readonly commitHash: string,
        public readonly color: Color,
        public readonly radius: number = 4,
        public readonly strokeWidth: number = 1
    ) {
        super(id, bounds);
    }

    get centerX(): number {
        return this.bounds.x + this.bounds.width / 2;
    }

    get centerY(): number {
        return this.bounds.y + this.bounds.height / 2;
    }

    render(): string {
        return `<circle cx="${this.centerX}" cy="${this.centerY}" r="${this.radius}" 
                fill="${this.color.value}" stroke="#fff" stroke-width="${this.strokeWidth}"/>`;
    }
}

export class BranchLine extends GraphElement {
    constructor(
        id: string,
        bounds: BoundingBox,
        public readonly color: Color,
        public readonly strokeWidth: number = 1.5,
        public readonly opacity: number = 0.4
    ) {
        super(id, bounds);
    }

    render(): string {
        return `<line x1="${this.bounds.x}" y1="${this.bounds.y}" 
                x2="${this.bounds.x}" y2="${this.bounds.y + this.bounds.height}" 
                stroke="${this.color.value}" stroke-width="${this.strokeWidth}" opacity="${this.opacity}"/>`;
    }
}

export class ConnectionLine extends GraphElement {
    constructor(
        id: string,
        bounds: BoundingBox,
        public readonly startPoint: Point,
        public readonly endPoint: Point,
        public readonly color: Color,
        public readonly strokeWidth: number = 1.5,
        public readonly opacity: number = 0.6,
        public readonly hasArrow: boolean = false
    ) {
        super(id, bounds);
    }

    render(): string {
        const markerEnd = this.hasArrow ? 'marker-end="url(#arrowhead)"' : '';
        return `<line x1="${this.startPoint.x}" y1="${this.startPoint.y}" 
                x2="${this.endPoint.x}" y2="${this.endPoint.y}" 
                stroke="${this.color.value}" stroke-width="${this.strokeWidth}" 
                opacity="${this.opacity}" ${markerEnd}/>`;
    }
}

export class CommitRow {
    constructor(
        public readonly index: number,
        public readonly commitNode: CommitNode,
        public readonly branchLines: BranchLine[] = [],
        public readonly connectionLines: ConnectionLine[] = []
    ) {}

    get bounds(): BoundingBox {
        return this.commitNode.bounds;
    }

    render(): string {
        const elements = [
            ...this.branchLines.map(line => line.render()),
            ...this.connectionLines.map(line => line.render()),
            this.commitNode.render()
        ];
        
        return `<g id="commit-row-${this.index}">${elements.join('')}</g>`;
    }
}