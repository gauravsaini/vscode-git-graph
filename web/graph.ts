const CLASS_GRAPH_VERTEX_ACTIVE = 'graphVertexActive';


/* SVG Element Pool */

class SvgElementPool {
	private readonly pathPool: SVGPathElement[] = [];
	private readonly circlePool: SVGCircleElement[] = [];
	private static readonly MAX_POOL_SIZE = 1000;

	public getPath(): SVGPathElement {
		return this.pathPool.pop() || <SVGPathElement>document.createElementNS(SVG_NAMESPACE, 'path');
	}

	public getCircle(): SVGCircleElement {
		return this.circlePool.pop() || <SVGCircleElement>document.createElementNS(SVG_NAMESPACE, 'circle');
	}

	public recycle(group: SVGGElement | null): void {
		if (group === null) return;
		const children: any = group.children || (group as any).childNodes || [];
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			const tag = child.tagName || child.tag;
			if (typeof child.removeAttribute === 'function') {
				if (tag === 'path' && this.pathPool.length < SvgElementPool.MAX_POOL_SIZE) {
					child.removeAttribute('class');
					child.removeAttribute('d');
					child.removeAttribute('stroke');
					child.removeAttribute('stroke-dasharray');
					this.pathPool.push(child);
				} else if (tag === 'circle' && this.circlePool.length < SvgElementPool.MAX_POOL_SIZE) {
					child.removeAttribute('class');
					child.removeAttribute('stroke');
					child.removeAttribute('fill');
					this.circlePool.push(child);
				}
			}
		}
	}
}


/* Graph Class */

class Graph {
	private readonly config: GG.GraphConfig;
	public readonly layout: GraphLayout;
	private readonly elementPool: SvgElementPool;
	private maxWidth: number = -1;
	private expandedCommitIndex: number = -1;

	private readonly viewElem: HTMLElement;
	private readonly contentElem: HTMLElement;
	private readonly svg: SVGElement;
	private readonly maskRect: SVGRectElement;
	private readonly gradientStop1: SVGStopElement;
	private readonly gradientStop2: SVGStopElement;
	public group: SVGGElement | null = null;

	private tooltipId: number = -1;
	private tooltipElem: HTMLElement | null = null;
	private tooltipTimeout: NodeJS.Timer | null = null;
	private tooltipVertex: HTMLElement | null = null;

	constructor(id: string, viewElem: HTMLElement, config: GG.GraphConfig, muteConfig: GG.MuteCommitsConfig) {
		this.viewElem = viewElem;
		this.config = config;
		this.layout = new GraphLayout(config, muteConfig);
		this.elementPool = new SvgElementPool();

		const elem = document.getElementById(id)!;
		this.contentElem = elem.parentElement!;
		this.svg = document.createElementNS(SVG_NAMESPACE, 'svg');
		const defs = this.svg.appendChild(document.createElementNS(SVG_NAMESPACE, 'defs'));

		const linearGradient = defs.appendChild(document.createElementNS(SVG_NAMESPACE, 'linearGradient'));
		linearGradient.setAttribute('id', 'GraphGradient');
		this.gradientStop1 = linearGradient.appendChild(document.createElementNS(SVG_NAMESPACE, 'stop'));
		this.gradientStop1.setAttribute('stop-color', 'white');
		this.gradientStop2 = linearGradient.appendChild(document.createElementNS(SVG_NAMESPACE, 'stop'));
		this.gradientStop2.setAttribute('stop-color', 'black');

		const mask = defs.appendChild(document.createElementNS(SVG_NAMESPACE, 'mask'));
		mask.setAttribute('id', 'GraphMask');
		this.maskRect = mask.appendChild(document.createElementNS(SVG_NAMESPACE, 'rect'));
		this.maskRect.setAttribute('fill', 'url(#GraphGradient)');

		this.setDimensions(0, 0);
		elem.appendChild(this.svg);
	}


	/* Graph Operations */

	public loadCommits(commits: ReadonlyArray<GG.GitCommit>, commitHead: string | null, commitLookup: { [hash: string]: number }, onlyFollowFirstParent: boolean, wasmCommitsInput?: ReadonlyArray<any>): void {
		GraphWasmBridge.loadCommits(
			this.layout,
			commits,
			commitHead,
			commitLookup,
			onlyFollowFirstParent,
			this.config,
			wasmCommitsInput
		);
	}

	public render(expandedCommit: ExpandedCommit | null): void {
		this.expandedCommitIndex = expandedCommit !== null ? expandedCommit.index : -1;
		const drawData = this.layout.generateDrawData(this.expandedCommitIndex);

		const group = <SVGGElement>document.createElementNS(SVG_NAMESPACE, 'g');
		group.setAttribute('mask', 'url(#GraphMask)');

		// 1. Render Path Lines (Shadow + Colored Line)
		for (let i = 0; i < drawData.paths.length; i++) {
			const pathData = drawData.paths[i];

			const shadow = this.elementPool.getPath();
			shadow.setAttribute('class', 'shadow');
			shadow.setAttribute('d', pathData.d);
			group.appendChild(shadow);

			const line = this.elementPool.getPath();
			line.setAttribute('class', 'line');
			line.setAttribute('d', pathData.d);
			line.setAttribute('stroke', pathData.stroke);
			if (pathData.isDashed) {
				line.setAttribute('stroke-dasharray', '2px');
			} else if (typeof line.removeAttribute === 'function') {
				line.removeAttribute('stroke-dasharray');
			}
			group.appendChild(line);
		}

		// 2. Render Node Circles with Tooltip Event Listeners
		const overListener = (e: MouseEvent) => this.vertexOver(e);
		const outListener = (e: MouseEvent) => this.vertexOut(e);

		for (let i = 0; i < drawData.nodes.length; i++) {
			const nodeData = drawData.nodes[i];

			const circle = this.elementPool.getCircle();
			circle.dataset.id = nodeData.id.toString();
			circle.setAttribute('cx', nodeData.cx);
			circle.setAttribute('cy', nodeData.cy);
			circle.setAttribute('r', nodeData.r);

			if (nodeData.isCurrent) {
				circle.setAttribute('class', 'current');
				circle.setAttribute('stroke', nodeData.colour);
				if (typeof circle.removeAttribute === 'function') {
					circle.removeAttribute('fill');
				}
			} else {
				circle.setAttribute('fill', nodeData.colour);
				if (typeof circle.removeAttribute === 'function') {
					circle.removeAttribute('class');
					circle.removeAttribute('stroke');
				}
			}

			circle.addEventListener('mouseover', overListener);
			circle.addEventListener('mouseout', outListener);
			group.appendChild(circle);

			if (nodeData.stashInner) {
				circle.setAttribute('class', 'stashOuter');
				const innerCircle = this.elementPool.getCircle();
				innerCircle.setAttribute('cx', nodeData.stashInner.cx);
				innerCircle.setAttribute('cy', nodeData.stashInner.cy);
				innerCircle.setAttribute('r', nodeData.stashInner.r);
				innerCircle.setAttribute('class', 'stashInner');
				group.appendChild(innerCircle);
			}
		}

		if (this.group !== null) {
			this.elementPool.recycle(this.group);
			this.svg.removeChild(this.group);
		}
		this.svg.appendChild(group);
		this.group = group;

		this.setDimensions(drawData.contentWidth, drawData.height);
		this.applyMaxWidth(drawData.contentWidth);
		this.closeTooltip();
	}


	/* Get */

	public getContentWidth(): number {
		return this.layout.getContentWidth();
	}

	public getHeight(expandedCommit: ExpandedCommit | null): number {
		return this.layout.getHeight(expandedCommit);
	}

	public getVertexColours(): number[] {
		return this.layout.getVertexColours();
	}

	public getWidthsAtVertices(): number[] {
		return this.layout.getWidthsAtVertices();
	}


	/* Graph Queries */

	public dropCommitPossible(i: number): boolean {
		return this.layout.dropCommitPossible(i);
	}

	public getMutedCommits(currentHash: string | null): boolean[] {
		return this.layout.getMutedCommits(currentHash);
	}

	public getFirstParentIndex(i: number): number {
		return this.layout.getFirstParentIndex(i);
	}

	public getAlternativeParentIndex(i: number): number {
		return this.layout.getAlternativeParentIndex(i);
	}

	public getFirstChildIndex(i: number): number {
		return this.layout.getFirstChildIndex(i);
	}

	public getAlternativeChildIndex(i: number): number {
		return this.layout.getAlternativeChildIndex(i);
	}


	/* Width Adjustment Methods */

	public limitMaxWidth(maxWidth: number): void {
		this.maxWidth = maxWidth;
		this.applyMaxWidth(this.getContentWidth());
	}

	private setDimensions(contentWidth: number, height: number): void {
		this.setSvgWidth(contentWidth);
		this.svg.setAttribute('height', height.toString());
		this.maskRect.setAttribute('width', contentWidth.toString());
		this.maskRect.setAttribute('height', height.toString());
	}

	private applyMaxWidth(contentWidth: number): void {
		this.setSvgWidth(contentWidth);
		const offset1 = this.maxWidth > -1 ? (this.maxWidth - 12) / contentWidth : 1;
		const offset2 = this.maxWidth > -1 ? this.maxWidth / contentWidth : 1;
		this.gradientStop1.setAttribute('offset', offset1.toString());
		this.gradientStop2.setAttribute('offset', offset2.toString());
	}

	private setSvgWidth(contentWidth: number): void {
		const width = this.maxWidth > -1 ? Math.min(contentWidth, this.maxWidth) : contentWidth;
		this.svg.setAttribute('width', width.toString());
	}


	/* Vertex Info */

	private vertexOver(event: MouseEvent): void {
		if (event.target === null) return;
		this.closeTooltip();

		const vertexElem = <HTMLElement>event.target;
		const id = parseInt(vertexElem.dataset.id!);
		this.tooltipId = id;
		const commitElem = findCommitElemWithId(getCommitElems(), id);
		if (commitElem !== null) commitElem.classList.add(CLASS_GRAPH_VERTEX_ACTIVE);

		const commits = this.layout.getCommits();
		if (id < commits.length && commits[id].hash !== UNCOMMITTED) { // Only show tooltip for commits (not the uncommitted changes)
			this.tooltipTimeout = setTimeout(() => {
				this.tooltipTimeout = null;
				const vertexScreenY = vertexElem.getBoundingClientRect().top + 4; // Get center of the circle
				if (vertexScreenY >= 5 && vertexScreenY <= this.viewElem.clientHeight - 5) {
					// Vertex is completely visible on the screen (not partially off)
					this.tooltipVertex = vertexElem;
					closeDialogAndContextMenu();
					this.showTooltip(id, vertexScreenY);
				}
			}, 100);
		}
	}

	private vertexOut(event: MouseEvent): void {
		if (event.target === null) return;
		this.closeTooltip();
	}

	private showTooltip(id: number, vertexScreenY: number): void {
		if (this.tooltipVertex !== null) {
			this.tooltipVertex.setAttribute('r', this.tooltipVertex.classList.contains('stashOuter') ? '5.5' : '5');
		}

		const commits = this.layout.getCommits();
		const commitHead = this.layout.getCommitHead();
		const commitLookup = this.layout.getCommitLookup();
		const children = this.layout.getAllChildren(id);
		const heads: string[] = [];
		const remotes: GG.GitCommitRemote[] = [];
		const stashes: string[] = [];
		const tags: string[] = [];
		let childrenIncludesHead = false;

		for (let i = 0; i < children.length; i++) {
			const commit = commits[children[i]];
			for (let j = 0; j < commit.heads.length; j++) heads.push(commit.heads[j]);
			for (let j = 0; j < commit.remotes.length; j++) remotes.push(commit.remotes[j]);
			for (let j = 0; j < commit.tags.length; j++) tags.push(commit.tags[j].name);
			if (commit.stash !== null) stashes.push(commit.stash.selector.substring(5));
			if (commit.hash === commitHead) childrenIncludesHead = true;
		}

		const getLimitedRefs = (htmlRefs: string[]) => {
			if (htmlRefs.length > 10) htmlRefs.splice(5, htmlRefs.length - 10, ' ' + ELLIPSIS + ' ');
			return htmlRefs.join('');
		};

		let html = '<div class="graphTooltipTitle">Commit ' + abbrevCommit(commits[id].hash) + '</div>';
		if (commitHead !== null && typeof commitLookup[commitHead] === 'number') {
			html += '<div class="graphTooltipSection">This commit is ' + (childrenIncludesHead ? '' : '<b><i>not</i></b> ') + 'included in <span class="graphTooltipRef">HEAD</span></div>';
		}
		if (heads.length > 0 || remotes.length > 0) {
			const branchLabels = getBranchLabels(heads, remotes);
			const htmlRefs: string[] = [];
			branchLabels.heads.forEach((head) => {
				const remotesHtml = head.remotes.reduce((prev, remote) => prev + '<span class="graphTooltipCombinedRef">' + escapeHtml(remote) + '</span>', '');
				htmlRefs.push('<span class="graphTooltipRef">' + escapeHtml(head.name) + remotesHtml + '</span>');
			});
			branchLabels.remotes.forEach((remote) => htmlRefs.push('<span class="graphTooltipRef">' + escapeHtml(remote.name) + '</span>'));
			html += '<div class="graphTooltipSection">Branches: ' + getLimitedRefs(htmlRefs) + '</div>';
		}
		if (tags.length > 0) {
			const htmlRefs = tags.map((tag) => '<span class="graphTooltipRef">' + escapeHtml(tag) + '</span>');
			html += '<div class="graphTooltipSection">Tags: ' + getLimitedRefs(htmlRefs) + '</div>';
		}
		if (stashes.length > 0) {
			const htmlRefs = stashes.map((stash) => '<span class="graphTooltipRef">' + escapeHtml(stash) + '</span>');
			html += '<div class="graphTooltipSection">Stashes: ' + getLimitedRefs(htmlRefs) + '</div>';
		}

		const point = this.layout.getVertexPoint(id);
		const color = 'var(--git-graph-color' + (this.layout.getVertexColour(id) % this.config.colours.length) + ')';
		const anchor = document.createElement('div');
		const pointer = document.createElement('div');
		const content = document.createElement('div');
		const shadow = document.createElement('div');
		const pixel: Pixel = {
			x: point.x * this.config.grid.x + this.config.grid.offsetX,
			y: point.y * this.config.grid.y + this.config.grid.offsetY + (this.expandedCommitIndex > -1 && id > this.expandedCommitIndex ? this.config.grid.expandY : 0)
		};

		anchor.setAttribute('id', 'graphTooltip');
		anchor.style.opacity = '0';
		pointer.setAttribute('id', 'graphTooltipPointer');
		pointer.style.backgroundColor = color;
		content.setAttribute('id', 'graphTooltipContent');
		content.style.borderColor = color;
		content.innerHTML = html;
		content.style.maxWidth = Math.min(this.contentElem.getBoundingClientRect().width - pixel.x - 35, 600) + 'px'; // Tooltip Offset [23px] + Tooltip Border [2 * 2px] + Right Page Margin [8px] = 35px
		shadow.setAttribute('id', 'graphTooltipShadow');
		anchor.appendChild(shadow);
		anchor.appendChild(pointer);
		anchor.appendChild(content);
		anchor.style.left = pixel.x + 'px';
		anchor.style.top = pixel.y + 'px';
		this.contentElem.appendChild(anchor);
		this.tooltipElem = anchor;

		const tooltipRect = content.getBoundingClientRect();
		let relativeOffset = -tooltipRect.height / 2; // Center the tooltip vertically on the vertex
		if (vertexScreenY + relativeOffset + tooltipRect.height > this.viewElem.clientHeight - 4) {
			// Not enough height below the vertex to fit the vertex, shift it up.
			relativeOffset = (this.viewElem.clientHeight - vertexScreenY - 4) - tooltipRect.height;
		}
		if (vertexScreenY + relativeOffset < 4) {
			// Not enough height above the vertex to fit the tooltip, shift it down.
			relativeOffset = -vertexScreenY + 4;
		}
		pointer.style.top = (-relativeOffset) + 'px';
		anchor.style.top = (pixel.y + relativeOffset) + 'px';
		shadow.style.width = tooltipRect.width + 'px';
		shadow.style.height = tooltipRect.height + 'px';
		anchor.style.opacity = '1';
	}

	private closeTooltip(): void {
		if (this.tooltipId > -1) {
			const commitElem = findCommitElemWithId(getCommitElems(), this.tooltipId);
			if (commitElem !== null) commitElem.classList.remove(CLASS_GRAPH_VERTEX_ACTIVE);
			this.tooltipId = -1;
		}

		if (this.tooltipElem !== null) {
			this.tooltipElem.remove();
			this.tooltipElem = null;
		}

		if (this.tooltipTimeout !== null) {
			clearTimeout(this.tooltipTimeout);
			this.tooltipTimeout = null;
		}

		if (this.tooltipVertex !== null) {
			this.tooltipVertex.setAttribute('r', this.tooltipVertex.classList.contains('stashOuter') ? '4.5' : '4');
			this.tooltipVertex = null;
		}
	}
}

if (typeof exports !== 'undefined') {
	exports.CLASS_GRAPH_VERTEX_ACTIVE = CLASS_GRAPH_VERTEX_ACTIVE;
	exports.SvgElementPool = SvgElementPool;
	exports.Graph = Graph;
}
