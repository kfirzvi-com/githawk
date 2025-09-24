<script lang="ts">
    // Input: newest-first commit list
    export let commits: Array<{
        id?: string;
        hash?: string;
        parents: string[];
        refs?: string[];
        branchHint?: string;
        [k: string]: any;
    }> = [];

    export let colW = 24; // px per lane
    export let rowH = 36; // px per row

    type Node = { id: string; row: number; lane: number };
    type Seg = {
        row: number;
        fromLane: number;
        toLane: number;
        colorLane: number;
    };

    let nodes: Node[] = [];
    let segments: Seg[] = [];
    let maxLane = 0;

    const idOf = (c: { id?: string; hash?: string }) => (c.id ?? c.hash)!;

    // --- Detect "main": choose a tip with refs.includes('main') or branchHint==='main', else top.
    //     Then follow first-parent chain to build the set.
    function computeMainSet(list: Array<any>) {
        const byId = new Map(list.map((c) => [idOf(c), c]));
        const mainTip =
            list.find(
                (c) =>
                    (c.refs ?? []).includes("main") || c.branchHint === "main",
            ) ?? list[0];
        const set = new Set<string>();
        let cur: any = mainTip;
        while (cur) {
            const cid = idOf(cur);
            if (set.has(cid)) break;
            set.add(cid);
            const p0 = (cur.parents ?? [])[0];
            cur = p0 ? byId.get(p0) : undefined;
        }
        return set;
    }

    // find first free lane index >= startLane (0 or 1)
    function firstFree(lanes: (string | null)[], startLane = 0) {
        for (let i = Math.max(0, startLane); i < lanes.length; i++)
            if (lanes[i] === null) return i;
        return Math.max(lanes.length, startLane);
    }

    // Geometry
    function xy(lane: number, row: number) {
        return [lane * colW + colW / 2, row * rowH + rowH / 2] as const;
    }
    function segmentPath(seg: Seg) {
        const [x0, y0] = xy(seg.fromLane, seg.row);
        const [x1, y1] = xy(seg.toLane, seg.row + 1);
        if (seg.fromLane === seg.toLane) return `M ${x0} ${y0} L ${x1} ${y1}`; // vertical carry
        const c1y = y0 + rowH * 0.4,
            c2y = y1 - rowH * 0.4;
        return `M ${x0} ${y0} C ${x0} ${c1y}, ${x1} ${c2y}, ${x1} ${y1}`;
    }
    function laneColor(lane: number) {
        const colors = [
            "#3b82f6",
            "#10b981",
            "#f59e42",
            "#e11d48",
            "#a21caf",
            "#fbbf24",
            "#6366f1",
            "#14b8a6",
        ];
        return colors[lane % colors.length];
    }

    // --- Core reactive computation
    $: {
        nodes = [];
        segments = [];
        maxLane = 0;

        if (commits.length > 0) {
            // Maps & helpers
            const mainSet = computeMainSet(commits);
            const isMain = (id: string) => mainSet.has(id);
            const rowOf = new Map<string, number>(
                commits.map((c, i) => [idOf(c), i]),
            );

            // ---------- PASS 1: assign lanes to commit NODES ----------
            const lanes: (string | null)[] = []; // occupant commit id or null
            const reserved = new Map<string, number>(); // future commit id -> lane (for node placement)
            const nodeLane = new Map<string, number>(); // commit id -> lane

            commits.forEach((c, row) => {
                const cid = idOf(c);

                // choose lane for this node
                let lane: number;
                if (isMain(cid)) {
                    lane = 0; // pin main to lane 0
                } else if (reserved.has(cid)) {
                    lane = reserved.get(cid)!;
                    reserved.delete(cid);
                } else {
                    lane = firstFree(lanes, 1); // non-main: prefer lanes >=1
                }
                while (lane >= lanes.length) lanes.push(null);
                lanes[lane] = cid;
                nodeLane.set(cid, lane);

                // reserve lanes for parents' nodes (so they appear where we intend later)
                const parents = c.parents ?? [];
                if (parents.length > 0) {
                    const p0 = parents[0];
                    if (!reserved.has(p0))
                        reserved.set(p0, isMain(p0) ? 0 : lane); // first-parent vertical (except main pinned)
                    for (let i = 1; i < parents.length; i++) {
                        const p = parents[i];
                        if (!reserved.has(p))
                            reserved.set(
                                p,
                                isMain(p) ? 0 : firstFree(lanes, 1),
                            );
                    }
                }

                // release lanes that have no reserved future (compact columns a bit)
                for (let k = 0; k < lanes.length; k++) {
                    const occ = lanes[k];
                    if (occ && occ !== cid && !reserved.has(occ))
                        lanes[k] = null;
                }
            });

            // Prepare nodes array for rendering
            nodes = commits.map((c, row) => ({
                id: idOf(c),
                row,
                lane: nodeLane.get(idOf(c))!,
            }));
            maxLane = Math.max(0, ...nodes.map((n) => n.lane));

            // ---------- PASS 2: build EDGE THREADS with span-aware lane allocation ----------
            // We keep an occupancy grid for edge threads only: key = `${row}:${lane}`
            const occ = new Set<string>();
            const mark = (row: number, lane: number) => {
                occ.add(`${row}:${lane}`);
                if (lane > maxLane) maxLane = lane;
            };
            const spanFree = (lane: number, start: number, end: number) => {
                // end is exclusive
                for (let r = start; r < end; r++)
                    if (occ.has(`${r}:${lane}`)) return false;
                return true;
            };
            const chooseThreadLane = (
                preferred: number,
                startRow: number,
                endRow: number,
                disallow0: boolean,
            ) => {
                let cand = preferred;
                if (disallow0 && cand === 0) cand = 1;
                // Try preferred, then 1..∞ (skipping 0 if disallowed)
                for (let tries = 0; tries < 4096; tries++) {
                    const lane =
                        tries === 0
                            ? cand
                            : disallow0
                              ? Math.max(1, tries)
                              : tries;
                    while (lane >= maxLane + 1) {
                        /* allow growth */ break;
                    }
                    if (disallow0 && lane === 0) continue;
                    if (spanFree(lane, startRow, endRow)) return lane;
                }
                return disallow0 ? 1 : 0; // fallback
            };

            // For each commit, create edges to parents
            commits.forEach((c) => {
                const cid = idOf(c);
                const cRow = rowOf.get(cid)!;
                const cLane = nodeLane.get(cid)!;
                for (let i = 0; i < (c.parents ?? []).length; i++) {
                    const pid = c.parents[i];
                    const pRow = rowOf.get(pid);
                    if (pRow == null) continue; // parent not in list -> skip
                    const pLane = nodeLane.get(pid) ?? (isMain(pid) ? 0 : 1);

                    // pick a thread lane for the whole span [cRow .. pRow)
                    const disallow0 = pLane === 0 && !isMain(cid);
                    const threadLane = chooseThreadLane(
                        cLane,
                        cRow,
                        pRow,
                        disallow0,
                    );

                    // mark occupancy and emit segments:
                    //  - vertical carries on [cRow .. pRow-1)
                    //  - final bend at row pRow-1 into pLane
                    for (let r = cRow; r < pRow - 1; r++) {
                        mark(r, threadLane);
                        segments.push({
                            row: r,
                            fromLane: threadLane,
                            toLane: threadLane,
                            colorLane: threadLane,
                        });
                    }
                    // final curve one row above the parent
                    mark(pRow - 1, threadLane);
                    segments.push({
                        row: pRow - 1,
                        fromLane: threadLane,
                        toLane: pLane,
                        colorLane: threadLane,
                    });
                }
            });
        }
    }
</script>

<div
    style="position:relative; width:100%; min-width:180px; height:{commits.length *
        rowH}px;"
>
    <svg
        style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;"
    >
        {#each segments as seg}
            <path
                d={segmentPath(seg)}
                stroke={laneColor(seg.colorLane)}
                stroke-width="2"
                fill="none"
                opacity="0.9"
            />
        {/each}
        {#each nodes as node}
            <circle
                cx={xy(node.lane, node.row)[0]}
                cy={xy(node.lane, node.row)[1]}
                r="7"
                fill={laneColor(node.lane)}
                stroke="#222"
                stroke-width="2"
            />
        {/each}
    </svg>

    <div id="rows" style="position:relative; z-index:1;">
        {#each commits as commit, row}
            <div class="flex items-center" style="height:{rowH}px;">
                <div
                    style="width:{(maxLane + 1) * colW}px; min-width:60px;"
                ></div>
                <div class="flex-1 pl-2">
                    <slot name="row" {commit} {row}></slot>
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    #rows {
        width: 100%;
    }
</style>
