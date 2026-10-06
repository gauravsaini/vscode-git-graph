const NULL_VERTEX_ID = -1;


/* Types */

interface Point {
	readonly x: number;
	readonly y: number;
}

interface Line {
	readonly p1: Point;
	readonly p2: Point;
	readonly lockedFirst: boolean; // TRUE => The line is locked to p1, FALSE => The line is locked to p2
}

interface Pixel {
	x: number;
	y: number;
}

interface PlacedLine {
	readonly p1: Pixel;
	readonly p2: Pixel;
	readonly isCommitted: boolean;
	readonly lockedFirst: boolean;
}

interface UnavailablePoint {
	readonly connectsTo: VertexOrNull;
	readonly onBranch: Branch;
}

type VertexOrNull = Vertex | null;

interface PathDrawData {
	readonly d: string;
	readonly isCommitted: boolean;
	readonly colour: string;
	readonly stroke: string;
	readonly isDashed: boolean;
}

interface NodeDrawData {
	readonly id: number;
	readonly cx: string;
	readonly cy: string;
	readonly r: string;
	readonly colour: string;
	readonly isCurrent: boolean;
	readonly isStash: boolean;
	readonly stashInner?: {
		readonly cx: string;
		readonly cy: string;
		readonly r: string;
	};
}

interface GraphLayoutData {
	readonly paths: ReadonlyArray<PathDrawData>;
	readonly nodes: ReadonlyArray<NodeDrawData>;
	readonly circles: ReadonlyArray<NodeDrawData>;
	readonly contentWidth: number;
	readonly height: number;
}


/* Branch Class */

class Branch {
	private readonly colour: number;
	private end: number = 0;
	private lines: Line[] = [];
	private numUncommitted: number = 0;

	constructor(colour: number) {
		this.colour = colour;
	}

	public addLine(p1: Point, p2: Point, isCommitted: boolean, lockedFirst: boolean): void {
		this.lines.push({ p1: p1, p2: p2, lockedFirst: lockedFirst });
		if (isCommitted) {
			if (p2.x === 0 && p2.y < this.numUncommitted) this.numUncommitted = p2.y;
		} else {
			this.numUncommitted++;
		}
	}

	public getColour(): number {
		return this.colour;
	}

	public getEnd(): number {
		return this.end;
	}

	public setEnd(end: number): void {
		this.end = end;
	}

	public getLines(): ReadonlyArray<Line> {
		return this.lines;
	}

	public generatePaths(config: GG.GraphConfig, expandAt: number): PathDrawData[] {
		const colour = config.colours[this.colour % config.colours.length];
		let i: number;
		let x1: number;
		let y1: number;
		let x2: number;
		let y2: number;
		const lines: PlacedLine[] = [];
		let curPath = '';
		const d = config.grid.y * (config.style === GG.GraphStyle.Angular ? 0.38 : 0.8);
		let line: Line;
		let nextLine: PlacedLine;
		let placedLine: PlacedLine;
		const paths: PathDrawData[] = [];

		// Convert branch lines into pixel coordinates, respecting expanded commit extensions
		for (i = 0; i < this.lines.length; i++) {
			line = this.lines[i];
			x1 = line.p1.x * config.grid.x + config.grid.offsetX;
			y1 = line.p1.y * config.grid.y + config.grid.offsetY;
			x2 = line.p2.x * config.grid.x + config.grid.offsetX;
			y2 = line.p2.y * config.grid.y + config.grid.offsetY;

			// If a commit is expanded, we need to stretch the graph for the height of the commit details view
			if (expandAt > -1) {
				if (line.p1.y > expandAt) { // If the line starts after the expansion, move the whole line lower
					y1 += config.grid.expandY;
					y2 += config.grid.expandY;
				} else if (line.p2.y > expandAt) { // If the line crosses the expansion
					if (x1 === x2) { // The line is vertical, extend the endpoint past the expansion
						y2 += config.grid.expandY;
					} else if (line.lockedFirst) { // If the line is locked to the first point, the transition stays in its normal position
						lines.push({ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, isCommitted: i >= this.numUncommitted, lockedFirst: line.lockedFirst }); // Display the normal transition
						lines.push({ p1: { x: x2, y: y1 + config.grid.y }, p2: { x: x2, y: y2 + config.grid.expandY }, isCommitted: i >= this.numUncommitted, lockedFirst: line.lockedFirst }); // Extend the line over the expansion from the transition end point
						continue;
					} else { // If the line is locked to the second point, the transition moves to after the expansion
						lines.push({ p1: { x: x1, y: y1 }, p2: { x: x1, y: y2 - config.grid.y + config.grid.expandY }, isCommitted: i >= this.numUncommitted, lockedFirst: line.lockedFirst }); // Extend the line over the expansion to the new transition start point
						y1 += config.grid.expandY;
						y2 += config.grid.expandY;
					}
				}
			}
			lines.push({ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, isCommitted: i >= this.numUncommitted, lockedFirst: line.lockedFirst });
		}

		// Simplify consecutive lines that are straight by removing the 'middle' point
		i = 0;
		while (i < lines.length - 1) {
			placedLine = lines[i];
			nextLine = lines[i + 1];
			if (placedLine.p1.x === placedLine.p2.x && placedLine.p2.x === nextLine.p1.x && nextLine.p1.x === nextLine.p2.x && placedLine.p2.y === nextLine.p1.y && placedLine.isCommitted === nextLine.isCommitted) {
				placedLine.p2.y = nextLine.p2.y;
				lines.splice(i + 1, 1);
			} else {
				i++;
			}
		}

		const addPathSegment = (pathStr: string, isCommitted: boolean) => {
			const isDashed = !isCommitted && config.uncommittedChanges === GG.GraphUncommittedChangesStyle.OpenCircleAtTheCheckedOutCommit;
			const stroke = isCommitted ? colour : '#808080';
			paths.push({
				d: pathStr,
				isCommitted: isCommitted,
				colour: colour,
				stroke: stroke,
				isDashed: isDashed
			});
		};

		// Iterate through all lines, producing svg paths
		for (i = 0; i < lines.length; i++) {
			placedLine = lines[i];
			x1 = placedLine.p1.x;
			y1 = placedLine.p1.y;
			x2 = placedLine.p2.x;
			y2 = placedLine.p2.y;

			// If the new point belongs to a different path, render the current path and reset it for the new path
			if (curPath !== '' && i > 0 && placedLine.isCommitted !== lines[i - 1].isCommitted) {
				addPathSegment(curPath, lines[i - 1].isCommitted);
				curPath = '';
			}

			// If the path hasn't been started or the new point belongs to a different path, move to p1
			if (curPath === '' || (i > 0 && (x1 !== lines[i - 1].p2.x || y1 !== lines[i - 1].p2.y))) curPath += 'M' + x1.toFixed(0) + ',' + y1.toFixed(1);

			if (x1 === x2) { // If the path is vertical, draw a straight line
				curPath += 'L' + x2.toFixed(0) + ',' + y2.toFixed(1);
			} else { // If the path moves horizontal, draw the appropriate transition
				if (config.style === GG.GraphStyle.Angular) {
					curPath += 'L' + (placedLine.lockedFirst ? (x2.toFixed(0) + ',' + (y2 - d).toFixed(1)) : (x1.toFixed(0) + ',' + (y1 + d).toFixed(1))) + 'L' + x2.toFixed(0) + ',' + y2.toFixed(1);
				} else {
					curPath += 'C' + x1.toFixed(0) + ',' + (y1 + d).toFixed(1) + ' ' + x2.toFixed(0) + ',' + (y2 - d).toFixed(1) + ' ' + x2.toFixed(0) + ',' + y2.toFixed(1);
				}
			}
		}

		if (curPath !== '') {
			addPathSegment(curPath, lines[lines.length - 1].isCommitted);
		}

		return paths;
	}
}


/* Vertex Class */

class Vertex {
	public readonly id: number;
	public readonly isStash: boolean;

	private x: number = 0;
	private children: Vertex[] = [];
	private parents: Vertex[] = [];
	private nextParent: number = 0;
	private onBranch: Branch | null = null;
	private isCommitted: boolean = true;
	private isCurrent: boolean = false;
	private nextX: number = 0;
	private connections: UnavailablePoint[] = [];

	constructor(id: number, isStash: boolean) {
		this.id = id;
		this.isStash = isStash;
	}

	public addChild(vertex: Vertex): void {
		this.children.push(vertex);
	}

	public getChildren(): ReadonlyArray<Vertex> {
		return this.children;
	}

	public addParent(vertex: Vertex): void {
		this.parents.push(vertex);
	}

	public getParents(): ReadonlyArray<Vertex> {
		return this.parents;
	}

	public hasParents(): boolean {
		return this.parents.length > 0;
	}

	public getNextParent(): Vertex | null {
		if (this.nextParent < this.parents.length) return this.parents[this.nextParent];
		return null;
	}

	public getLastParent(): Vertex | null {
		if (this.nextParent < 1) return null;
		return this.parents[this.nextParent - 1];
	}

	public registerParentProcessed(): void {
		this.nextParent++;
	}

	public isMerge(): boolean {
		return this.parents.length > 1;
	}

	public addToBranch(branch: Branch, x: number): void {
		if (this.onBranch === null) {
			this.onBranch = branch;
			this.x = x;
		}
	}

	public isNotOnBranch(): boolean {
		return this.onBranch === null;
	}

	public isOnThisBranch(branch: Branch): boolean {
		return this.onBranch === branch;
	}

	public getBranch(): Branch | null {
		return this.onBranch;
	}

	public getPoint(): Point {
		return { x: this.x, y: this.id };
	}

	public getNextPoint(): Point {
		return { x: this.nextX, y: this.id };
	}

	public getPointConnectingTo(vertex: VertexOrNull, onBranch: Branch): Point | null {
		for (let i = 0; i < this.connections.length; i++) {
			if (this.connections[i].connectsTo === vertex && this.connections[i].onBranch === onBranch) {
				return { x: i, y: this.id };
			}
		}
		return null;
	}

	public registerUnavailablePoint(x: number, connectsToVertex: VertexOrNull, onBranch: Branch): void {
		if (x === this.nextX) {
			this.nextX = x + 1;
			this.connections[x] = { connectsTo: connectsToVertex, onBranch: onBranch };
		}
	}

	public getColour(): number {
		return this.onBranch !== null ? this.onBranch.getColour() : 0;
	}

	public getIsCommitted(): boolean {
		return this.isCommitted;
	}

	public setNotCommitted(): void {
		this.isCommitted = false;
	}

	public setCurrent(): void {
		this.isCurrent = true;
	}

	public getIsCurrent(): boolean {
		return this.isCurrent;
	}

	public getX(): number {
		return this.x;
	}

	public generateNodeData(config: GG.GraphConfig, expandOffset: boolean): NodeDrawData | null {
		if (this.onBranch === null) return null;

		const colour = this.isCommitted ? config.colours[this.onBranch.getColour() % config.colours.length] : '#808080';
		const cx = (this.x * config.grid.x + config.grid.offsetX).toString();
		const cy = (this.id * config.grid.y + config.grid.offsetY + (expandOffset ? config.grid.expandY : 0)).toString();

		let stashInner: { readonly cx: string; readonly cy: string; readonly r: string } | undefined;
		if (this.isStash && !this.isCurrent) {
			stashInner = {
				cx: cx,
				cy: cy,
				r: '2'
			};
		}

		return {
			id: this.id,
			cx: cx,
			cy: cy,
			r: this.isStash && !this.isCurrent ? '4.5' : '4',
			colour: colour,
			isCurrent: this.isCurrent,
			isStash: this.isStash,
			stashInner: stashInner
		};
	}
}


/* GraphLayout Class */

class GraphLayout {
	private readonly config: GG.GraphConfig;
	private readonly muteConfig: GG.MuteCommitsConfig;
	private vertices: Vertex[] = [];
	private branches: Branch[] = [];
	private availableColours: number[] = [];

	private commits: ReadonlyArray<GG.GitCommit> = [];
	private commitHead: string | null = null;
	private commitLookup: { [hash: string]: number } = {};
	private onlyFollowFirstParent: boolean = false;

	constructor(config: GG.GraphConfig, muteConfig: GG.MuteCommitsConfig) {
		this.config = config;
		this.muteConfig = muteConfig;
	}

	public initCommits(commits: ReadonlyArray<GG.GitCommit>, commitHead: string | null, commitLookup: { [hash: string]: number }, onlyFollowFirstParent: boolean): void {
		this.commits = commits;
		this.commitHead = commitHead;
		this.commitLookup = commitLookup;
		this.onlyFollowFirstParent = onlyFollowFirstParent;
		this.vertices = [];
		this.branches = [];
		this.availableColours = [];
		if (commits.length === 0) return;

		const nullVertex = new Vertex(NULL_VERTEX_ID, false);
		let i: number;
		let j: number;
		for (i = 0; i < commits.length; i++) {
			this.vertices.push(new Vertex(i, commits[i].stash !== null));
		}
		for (i = 0; i < commits.length; i++) {
			for (j = 0; j < commits[i].parents.length; j++) {
				const parentHash = commits[i].parents[j];
				if (typeof commitLookup[parentHash] === 'number') {
					this.vertices[i].addParent(this.vertices[commitLookup[parentHash]]);
					this.vertices[commitLookup[parentHash]].addChild(this.vertices[i]);
				} else if (!this.onlyFollowFirstParent || j === 0) {
					this.vertices[i].addParent(nullVertex);
				}
			}
		}

		if (commits[0].hash === UNCOMMITTED) {
			this.vertices[0].setNotCommitted();
		}

		if (commits[0].hash === UNCOMMITTED && this.config.uncommittedChanges === GG.GraphUncommittedChangesStyle.OpenCircleAtTheUncommittedChanges) {
			this.vertices[0].setCurrent();
		} else if (commitHead !== null && typeof commitLookup[commitHead] === 'number') {
			this.vertices[commitLookup[commitHead]].setCurrent();
		}
	}

	public computePureLayout(): void {
		let i = 0;
		while (i < this.vertices.length) {
			if (this.vertices[i].getNextParent() !== null || this.vertices[i].isNotOnBranch()) {
				this.determinePath(i);
			} else {
				i++;
			}
		}
	}

	public applyWasmLayout(layout: GG.WasmGraphLayout): void {
		const branchMap: { [color: number]: Branch } = {};
		const getBranch = (colour: number) => {
			if (!branchMap[colour]) {
				const b = new Branch(colour);
				branchMap[colour] = b;
				this.branches.push(b);
			}
			return branchMap[colour];
		};

		for (let r = 0; r < layout.rows.length; r++) {
			const row = layout.rows[r];
			const vertex = this.vertices[r];
			if (!vertex) continue;

			const nodeBranch = getBranch(row.node.color);
			vertex.addToBranch(nodeBranch, row.node.column);

			let maxCol = row.node.column;

			for (let j = 0; j < row.routes.length; j++) {
				const route = row.routes[j];
				const routeBranch = getBranch(route.color);
				routeBranch.addLine(
					{ x: route.from_col, y: r },
					{ x: route.to_col, y: r + 1 },
					vertex.getIsCommitted(),
					route.from_col < route.to_col
				);
				if (route.from_col > maxCol) maxCol = route.from_col;
				if (route.to_col > maxCol) maxCol = route.to_col;
			}

			for (let c = 0; c <= maxCol; c++) {
				vertex.registerUnavailablePoint(c, null, nodeBranch);
			}
		}
	}

	public loadCommits(commits: ReadonlyArray<GG.GitCommit>, commitHead: string | null, commitLookup: { [hash: string]: number }, onlyFollowFirstParent: boolean, wasmLayout?: GG.WasmGraphLayout | null): void {
		this.initCommits(commits, commitHead, commitLookup, onlyFollowFirstParent);
		if (commits.length === 0) return;

		if (wasmLayout && wasmLayout.rows && wasmLayout.rows.length === commits.length) {
			this.applyWasmLayout(wasmLayout);
		} else {
			this.computePureLayout();
		}
	}

	public generateDrawData(configOrExpandAt?: any, expandAtParam?: number): GraphLayoutData {
		let config: GG.GraphConfig;
		let expandAt: number;

		if (typeof configOrExpandAt === 'number') {
			config = this.config;
			expandAt = configOrExpandAt;
		} else if (configOrExpandAt && typeof configOrExpandAt === 'object' && configOrExpandAt.grid) {
			config = configOrExpandAt;
			expandAt = typeof expandAtParam === 'number' ? expandAtParam : -1;
		} else {
			config = this.config;
			expandAt = -1;
		}

		const paths: PathDrawData[] = [];
		for (let b = 0; b < this.branches.length; b++) {
			const branchPaths = this.branches[b].generatePaths(config, expandAt);
			for (let p = 0; p < branchPaths.length; p++) {
				paths.push(branchPaths[p]);
			}
		}

		const nodes: NodeDrawData[] = [];
		for (let v = 0; v < this.vertices.length; v++) {
			const nodeData = this.vertices[v].generateNodeData(config, expandAt > -1 && v > expandAt);
			if (nodeData !== null) {
				nodes.push(nodeData);
			}
		}

		const contentWidth = this.getContentWidth();
		const height = this.getHeight(expandAt);

		return {
			paths: paths,
			nodes: nodes,
			circles: nodes,
			contentWidth: contentWidth,
			height: height
		};
	}

	public getContentWidth(): number {
		let x = 0;
		let i: number;
		let p: Point;
		for (i = 0; i < this.vertices.length; i++) {
			p = this.vertices[i].getNextPoint();
			if (p.x > x) x = p.x;
		}
		return 2 * this.config.grid.offsetX + (x - 1) * this.config.grid.x;
	}

	public getHeight(expandedCommit: ExpandedCommit | null | number): number {
		let expandOffset = 0;
		if (typeof expandedCommit === 'number') {
			expandOffset = expandedCommit > -1 ? this.config.grid.expandY : 0;
		} else if (expandedCommit !== null && typeof expandedCommit === 'object') {
			expandOffset = this.config.grid.expandY;
		}
		return this.vertices.length * this.config.grid.y + this.config.grid.offsetY - this.config.grid.y / 2 + expandOffset;
	}

	public getVertexColours(): number[] {
		const colours = [];
		let i: number;
		for (i = 0; i < this.vertices.length; i++) {
			colours[i] = this.vertices[i].getColour() % this.config.colours.length;
		}
		return colours;
	}

	public getWidthsAtVertices(): number[] {
		const widths = [];
		let i: number;
		for (i = 0; i < this.vertices.length; i++) {
			widths[i] = this.config.grid.offsetX + this.vertices[i].getNextPoint().x * this.config.grid.x - 2;
		}
		return widths;
	}

	public dropCommitPossible(i: number): boolean {
		if (!this.vertices[i].hasParents()) {
			return false; // No parents
		}

		const isPossible = (v: Vertex): boolean | null => {
			if (v.isMerge()) {
				// Commit is a merge - fails topological test
				return null;
			}

			const children = v.getChildren();
			if (children.length > 1) {
				// Commit has multiple children - fails topological test
				return null;
			} else if (children.length === 1) {
				const recursivelyPossible = isPossible(children[0]);
				if (recursivelyPossible !== false) {
					// Topological tests failed (recursivelyPossible === NULL), or the HEAD has already been found (recursivelyPossible === TRUE)
					return recursivelyPossible;
				}
			}

			// Check if the current vertex is the HEAD if it has no children, or the HEAD has not been found in its recursive children.
			return this.commits[v.id].hash === this.commitHead;
		};

		return isPossible(this.vertices[i]) || false;
	}

	public getAllChildren(i: number): number[] {
		const visited: { [id: string]: number } = {};
		const rec = (vertex: Vertex) => {
			const idStr = vertex.id.toString();
			if (typeof visited[idStr] !== 'undefined') return;

			visited[idStr] = vertex.id;
			const children = vertex.getChildren();
			for (let c = 0; c < children.length; c++) rec(children[c]);
		};
		rec(this.vertices[i]);
		return Object.keys(visited).map((key) => visited[key]).sort((a, b) => a - b);
	}

	public getMutedCommits(currentHash: string | null): boolean[] {
		const muted: boolean[] = [];
		for (let i = 0; i < this.commits.length; i++) {
			muted[i] = false;
		}

		// Mute any merge commits if the Extension Setting is enabled
		if (this.muteConfig.mergeCommits) {
			for (let i = 0; i < this.commits.length; i++) {
				if (this.vertices[i].isMerge() && this.commits[i].stash === null) {
					// The commit is a merge, and is not a stash
					muted[i] = true;
				}
			}
		}

		// Mute any commits that are not ancestors of the commit head if the Extension Setting is enabled, and the head commit is in the graph
		if (this.muteConfig.commitsNotAncestorsOfHead && currentHash !== null && typeof this.commitLookup[currentHash] === 'number') {
			const ancestor: boolean[] = [];
			for (let i = 0; i < this.commits.length; i++) {
				ancestor[i] = false;
			}

			// Recursively discover ancestors of commit head
			const rec = (vertex: Vertex) => {
				if (vertex.id === NULL_VERTEX_ID || ancestor[vertex.id]) return;
				ancestor[vertex.id] = true;

				const parents = vertex.getParents();
				for (let p = 0; p < parents.length; p++) rec(parents[p]);
			};
			rec(this.vertices[this.commitLookup[currentHash]]);

			for (let i = 0; i < this.commits.length; i++) {
				if (!ancestor[i] && (this.commits[i].stash === null || typeof this.commitLookup[this.commits[i].stash!.baseHash] !== 'number' || !ancestor[this.commitLookup[this.commits[i].stash!.baseHash]])) {
					// Commit i is not an ancestor of currentHash, or a stash based on an ancestor of currentHash
					muted[i] = true;
				}
			}
		}

		return muted;
	}

	public getFirstParentIndex(i: number): number {
		const parents = this.vertices[i].getParents();
		return parents.length > 0 ? parents[0].id : -1;
	}

	public getAlternativeParentIndex(i: number): number {
		const parents = this.vertices[i].getParents();
		return parents.length > 1
			? parents[1].id
			: parents.length === 1
				? parents[0].id
				: -1;
	}

	public getFirstChildIndex(i: number): number {
		const children = this.vertices[i].getChildren();
		if (children.length > 1) {
			const branch = this.vertices[i].getBranch();
			let childOnSameBranch: Vertex | undefined;
			if (branch !== null && (childOnSameBranch = children.find((child) => child.isOnThisBranch(branch)))) {
				return childOnSameBranch.id;
			} else {
				return Math.max(...children.map((child) => child.id));
			}
		} else if (children.length === 1) {
			return children[0].id;
		} else {
			return -1;
		}
	}

	public getAlternativeChildIndex(i: number): number {
		const children = this.vertices[i].getChildren();
		if (children.length > 1) {
			const branch = this.vertices[i].getBranch();
			let childOnSameBranch: Vertex | undefined;
			if (branch !== null && (childOnSameBranch = children.find((child) => child.isOnThisBranch(branch)))) {
				return Math.max(...children.filter((child) => child !== childOnSameBranch).map((child) => child.id));
			} else {
				const childIndexes = children.map((child) => child.id).sort();
				return childIndexes[childIndexes.length - 2];
			}
		} else if (children.length === 1) {
			return children[0].id;
		} else {
			return -1;
		}
	}

	public getVertexPoint(i: number): Point {
		return this.vertices[i].getPoint();
	}

	public getVertexColour(i: number): number {
		return this.vertices[i].getColour();
	}

	public getVertex(i: number): Vertex | undefined {
		return this.vertices[i];
	}

	public getVerticesCount(): number {
		return this.vertices.length;
	}

	public getCommits(): ReadonlyArray<GG.GitCommit> {
		return this.commits;
	}

	public getCommitHead(): string | null {
		return this.commitHead;
	}

	public getCommitLookup(): { [hash: string]: number } {
		return this.commitLookup;
	}

	public getBranches(): ReadonlyArray<Branch> {
		return this.branches;
	}

	private determinePath(startAt: number): void {
		let i = startAt;
		let vertex = this.vertices[i];
		let parentVertex = this.vertices[i].getNextParent();
		let curVertex: Vertex;
		let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
		let curPoint: Point | null;

		if (parentVertex !== null && parentVertex.id !== NULL_VERTEX_ID && vertex.isMerge() && !vertex.isNotOnBranch() && !parentVertex.isNotOnBranch()) {
			// Branch is a merge between two vertices already on branches
			let foundPointToParent = false;
			const parentBranch = parentVertex.getBranch()!;
			for (i = startAt + 1; i < this.vertices.length; i++) {
				curVertex = this.vertices[i];
				curPoint = curVertex.getPointConnectingTo(parentVertex, parentBranch);
				if (curPoint !== null) {
					foundPointToParent = true;
				} else {
					curPoint = curVertex.getNextPoint();
				}
				parentBranch.addLine(lastPoint, curPoint, vertex.getIsCommitted(), !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true);
				curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
				lastPoint = curPoint;

				if (foundPointToParent) {
					vertex.registerParentProcessed();
					break;
				}
			}
		} else {
			// Branch is normal
			const branch = new Branch(this.getAvailableColour(startAt));
			vertex.addToBranch(branch, lastPoint.x);
			vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);
			for (i = startAt + 1; i < this.vertices.length; i++) {
				curVertex = this.vertices[i];
				curPoint = parentVertex === curVertex && !parentVertex.isNotOnBranch() ? curVertex.getPoint() : curVertex.getNextPoint();
				branch.addLine(lastPoint, curPoint, vertex.getIsCommitted(), lastPoint.x < curPoint.x);
				curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
				lastPoint = curPoint;

				if (parentVertex === curVertex) {
					// The parent of <vertex> has been reached, progress <vertex> and <parentVertex> to continue building the branch
					vertex.registerParentProcessed();
					const parentVertexOnBranch = !parentVertex.isNotOnBranch();
					parentVertex.addToBranch(branch, curPoint.x);
					vertex = parentVertex;
					parentVertex = vertex.getNextParent();
					if (parentVertex === null || parentVertexOnBranch) {
						// There are no more parent vertices, or the parent was already on a branch
						break;
					}
				}
			}
			if (i === this.vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
				// Vertex is the last in the graph, so no more branch can be formed to the parent
				vertex.registerParentProcessed();
			}
			branch.setEnd(i);
			this.branches.push(branch);
			this.availableColours[branch.getColour()] = i;
		}
	}

	private getAvailableColour(startAt: number): number {
		for (let i = 0; i < this.availableColours.length; i++) {
			if (startAt > this.availableColours[i]) {
				return i;
			}
		}
		this.availableColours.push(0);
		return this.availableColours.length - 1;
	}
}

if (typeof exports !== 'undefined') {
	exports.NULL_VERTEX_ID = NULL_VERTEX_ID;
	exports.Branch = Branch;
	exports.Vertex = Vertex;
	exports.GraphLayout = GraphLayout;
}
