import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

describe('Seam 2 Characterization: Web Graph DAG Routing & Layout', () => {
	// Mock DOM element implementation for Node vm execution
	class MockElement {
		public tag: string;
		public attributes: { [key: string]: string } = {};
		public dataset: { [key: string]: string } = {};
		public children: MockElement[] = [];
		public parentElement: MockElement | null = null;

		constructor(tag: string) {
			this.tag = tag;
		}

		public setAttribute(name: string, value: string | number) {
			this.attributes[name] = String(value);
		}

		public getAttribute(name: string): string | undefined {
			return this.attributes[name];
		}

		public appendChild(child: MockElement): MockElement {
			this.children.push(child);
			child.parentElement = this;
			return child;
		}

		public removeChild(child: MockElement): MockElement {
			const index = this.children.indexOf(child);
			if (index !== -1) {
				this.children.splice(index, 1);
				child.parentElement = null;
			}
			return child;
		}

		public addEventListener() {}
		public removeEventListener() {}
	}

	let sandbox: any;

	beforeAll(() => {
		const container = new MockElement('div');
		const mockDoc = {
			createElementNS: (_ns: string, tag: string) => new MockElement(tag),
			getElementById: (_id: string) => container
		};

		sandbox = {
			document: mockDoc,
			SVG_NAMESPACE: 'http://www.w3.org/2000/svg',
			UNCOMMITTED: '*',
			GG: {
				GraphStyle: {
					Rounded: 0,
					Angular: 1
				},
				GraphUncommittedChangesStyle: {
					OpenCircleAtTheUncommittedChanges: 0,
					OpenCircleAtTheCheckedOutCommit: 1
				}
			},
			console: console
		};

		vm.createContext(sandbox);

		const graphLayoutTsPath = path.join(__dirname, '../../web/graphLayout.ts');
		if (fs.existsSync(graphLayoutTsPath)) {
			const graphLayoutTsCode = fs.readFileSync(graphLayoutTsPath, 'utf8');
			const transpiledLayout = ts.transpileModule(graphLayoutTsCode, {
				compilerOptions: {
					target: ts.ScriptTarget.ES5,
					module: ts.ModuleKind.None
				}
			}).outputText;
			vm.runInContext(transpiledLayout, sandbox);
		}

		const graphWasmBridgeTsPath = path.join(__dirname, '../../web/graphWasmBridge.ts');
		if (fs.existsSync(graphWasmBridgeTsPath)) {
			const graphWasmBridgeTsCode = fs.readFileSync(graphWasmBridgeTsPath, 'utf8');
			const transpiledBridge = ts.transpileModule(graphWasmBridgeTsCode, {
				compilerOptions: {
					target: ts.ScriptTarget.ES5,
					module: ts.ModuleKind.None
				}
			}).outputText;
			vm.runInContext(transpiledBridge, sandbox);
		}

		const graphTsPath = path.join(__dirname, '../../web/graph.ts');
		const graphTsCode = fs.readFileSync(graphTsPath, 'utf8');

		const transpiled = ts.transpileModule(graphTsCode, {
			compilerOptions: {
				target: ts.ScriptTarget.ES5,
				module: ts.ModuleKind.None
			}
		}).outputText;

		vm.runInContext(transpiled, sandbox);
	});

	const createGraph = (configOverrides: any = {}, muteOverrides: any = {}) => {
		const container = new MockElement('div');
		const parent = new MockElement('div');
		parent.appendChild(container);

		const config = {
			colours: ['#0088cc', '#ff8800', '#00cc88', '#cc0088', '#8800cc'],
			style: sandbox.GG.GraphStyle.Rounded, // 0 = Rounded, 1 = Angular
			grid: { x: 16, y: 24, offsetX: 8, offsetY: 12, expandY: 250 },
			uncommittedChanges: sandbox.GG.GraphUncommittedChangesStyle.OpenCircleAtTheCheckedOutCommit,
			...configOverrides
		};

		const muteConfig = {
			commitsNotAncestorsOfHead: true,
			...muteOverrides
		};

		const graph = new sandbox.Graph('graph', container, config, muteConfig);
		return { graph, container, config, muteConfig };
	};

	const makeCommit = (hash: string, parents: string[], message: string = hash, extra: any = {}) => ({
		hash,
		parents,
		author: 'Dev',
		email: 'dev@test.com',
		date: 1000,
		message,
		heads: [],
		tags: [],
		remotes: [],
		stash: null,
		...extra
	});

	describe('DAG Routing', () => {
		it('should route linear histories along a single column with shared branch colour', () => {
			const { graph } = createGraph();
			const commits = [
				makeCommit('c3', ['c2']),
				makeCommit('c2', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { c3: 0, c2: 1, c1: 2 };

			graph.loadCommits(commits, 'c3', lookup, false);

			// All 3 vertices must have the same branch colour (index 0)
			expect(graph.getVertexColours()).toEqual([0, 0, 0]);

			// All vertices are positioned at column 0 (width = offsetX + 0 * grid.x - 2 = 8 + 0 - 2 = 6, but nextPoint is 1 => width 22)
			const widths = graph.getWidthsAtVertices();
			expect(widths.length).toBe(3);
			expect(widths[0]).toBe(widths[1]);
			expect(widths[1]).toBe(widths[2]);

			// Content width for single column
			expect(graph.getContentWidth()).toBe(16);

			// Parent and child navigation
			expect(graph.getFirstParentIndex(0)).toBe(1);
			expect(graph.getFirstParentIndex(1)).toBe(2);
			expect(graph.getFirstParentIndex(2)).toBe(-1); // root

			expect(graph.getFirstChildIndex(2)).toBe(1);
			expect(graph.getFirstChildIndex(1)).toBe(0);
			expect(graph.getFirstChildIndex(0)).toBe(-1); // tip
		});

		it('should route forks and branches into separate columns with distinct colors', () => {
			const { graph } = createGraph();
			// Fork: root has two children: branch A (a1) and branch B (b1)
			const commits = [
				makeCommit('b1', ['root']),
				makeCommit('a1', ['root']),
				makeCommit('root', [])
			];
			const lookup = { b1: 0, a1: 1, root: 2 };

			graph.loadCommits(commits, 'b1', lookup, false);

			const colours = graph.getVertexColours();
			expect(colours[0]).toBe(0); // Branch B gets colour 0
			expect(colours[1]).toBe(1); // Branch A gets colour 1
			expect(colours[2]).toBe(0); // Root continues branch B (colour 0)

			// Total content width expands to accommodate 2 columns
			expect(graph.getContentWidth()).toBeGreaterThan(16);

			// Children navigation for root with multiple children
			expect(graph.getFirstChildIndex(2)).toBe(0); // child on same branch (b1)
			expect(graph.getAlternativeChildIndex(2)).toBe(1); // alternative child (a1)
		});

		it('should route merge commits connecting two parents across columns', () => {
			const { graph } = createGraph();
			// Merge: m merges b and a
			const commits = [
				makeCommit('m', ['b', 'a']),
				makeCommit('b', ['root']),
				makeCommit('a', ['root']),
				makeCommit('root', [])
			];
			const lookup = { m: 0, b: 1, a: 2, root: 3 };

			graph.loadCommits(commits, 'm', lookup, false);

			expect(graph.getFirstParentIndex(0)).toBe(1); // first parent is b
			expect(graph.getAlternativeParentIndex(0)).toBe(2); // second parent is a

			// Merge commit cannot be dropped topologically
			expect(graph.dropCommitPossible(0)).toBe(false);

			// Ancestors of merge commits also cannot be dropped because their child is a merge
			expect(graph.dropCommitPossible(1)).toBe(false);
			expect(graph.dropCommitPossible(2)).toBe(false);
		});

		it('should allow dropping linear commits that are direct ancestors of HEAD without branches or merges', () => {
			const { graph } = createGraph();
			const commits = [
				makeCommit('c3', ['c2']),
				makeCommit('c2', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { c3: 0, c2: 1, c1: 2 };
			graph.loadCommits(commits, 'c3', lookup, false);

			// c2 has single parent (c1) and single child (c3 === HEAD) -> can be dropped
			expect(graph.dropCommitPossible(1)).toBe(true);

			// c1 has no parents (root) -> cannot be dropped
			expect(graph.dropCommitPossible(2)).toBe(false);
		});

		it('should route octopus merge commits with 3 or more parents', () => {
			const { graph } = createGraph();
			// Octopus merge: m merges p1, p2, p3
			const commits = [
				makeCommit('m', ['p1', 'p2', 'p3']),
				makeCommit('p1', ['root']),
				makeCommit('p2', ['root']),
				makeCommit('p3', ['root']),
				makeCommit('root', [])
			];
			const lookup = { m: 0, p1: 1, p2: 2, p3: 3, root: 4 };

			graph.loadCommits(commits, 'm', lookup, false);

			expect(graph.getFirstParentIndex(0)).toBe(1);
			expect(graph.getAlternativeParentIndex(0)).toBe(2);
			expect(graph.dropCommitPossible(0)).toBe(false);

			graph.render(null);

			// Renders lines for all 3 branches spanning column 0, 1, and 2
			const lines = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);
			expect(lines.length).toBe(3);

			// Colors match palette sequence
			expect(lines[0].attributes.stroke).toBe('#0088cc');
			expect(lines[1].attributes.stroke).toBe('#ff8800');
			expect(lines[2].attributes.stroke).toBe('#00cc88');
		});

		it('should accurately calculate muted commits for non-ancestors of HEAD', () => {
			const { graph } = createGraph({}, { commitsNotAncestorsOfHead: true });
			// Fork: HEAD is at feature (f1). main (m1) is on an independent branch.
			const commits = [
				makeCommit('m1', ['root']),
				makeCommit('f1', ['root']),
				makeCommit('root', [])
			];
			const lookup = { m1: 0, f1: 1, root: 2 };

			graph.loadCommits(commits, 'f1', lookup, false);

			const muted = graph.getMutedCommits('f1');
			// m1 is not an ancestor of f1 -> muted
			expect(muted[0]).toBe(true);
			// f1 is HEAD -> not muted
			expect(muted[1]).toBe(false);
			// root is an ancestor of f1 -> not muted
			expect(muted[2]).toBe(false);
		});
	});

	describe('Line Simplification', () => {
		it('should simplify collinear vertical segments along the same column into a single segment', () => {
			const { graph } = createGraph();
			// 4 linear commits: row 0 -> 1 -> 2 -> 3
			const commits = [
				makeCommit('c4', ['c3']),
				makeCommit('c3', ['c2']),
				makeCommit('c2', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { c4: 0, c3: 1, c2: 2, c1: 3 };

			graph.loadCommits(commits, 'c4', lookup, false);
			graph.render(null);

			const linePaths = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);

			// Without simplification there would be 3 separate lines.
			// With simplification, all 3 consecutive vertical segments merge into 1 continuous path.
			expect(linePaths.length).toBe(1);

			// Path starts at row 0: (x=8, y=12.0) and extends straight to row 3: (x=8, y=84.0)
			expect(linePaths[0].attributes.d).toBe('M8,12.0L8,84.0');
		});

		it('should not merge segments across uncommitted boundaries with different committed states', () => {
			const { graph } = createGraph();
			// Commit 0 is uncommitted changes (*), commit 1 is c1
			const commits = [
				makeCommit('*', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { '*': 0, c1: 1 };

			graph.loadCommits(commits, '*', lookup, false);
			graph.render(null);

			const linePaths = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);

			// Uncommitted line path rendered
			expect(linePaths.length).toBe(1);
			expect(linePaths[0].attributes.stroke).toBe('#808080'); // Grey stroke for uncommitted line
		});
	});

	describe('Path Curves: Curved Bézier vs Angular Elbow Calculation', () => {
		const commits = [
			makeCommit('m', ['b', 'a']),
			makeCommit('b', ['root']),
			makeCommit('a', ['root']),
			makeCommit('root', [])
		];
		const lookup = { m: 0, b: 1, a: 2, root: 3 };

		it('should compute cubic Bézier curve paths (C...) in Rounded style', () => {
			const { graph } = createGraph({ style: sandbox.GG.GraphStyle.Rounded });
			graph.loadCommits(commits, 'm', lookup, false);
			graph.render(null);

			const linePaths = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);

			// Main branch line (col 0): straight line from row 0 to row 3
			expect(linePaths[0].attributes.d).toBe('M8,12.0L8,84.0');

			// Transition branch line (col 0 -> col 1 -> col 0):
			// d = 24 * 0.8 = 19.2
			// Transition: C8,31.2 24,16.8 24,36.0 (p1: (8,12), p2: (24,36))
			// Straight segment: L24,60.0
			// Return curve: C24,79.2 8,64.8 8,84.0
			const curvedPath = linePaths[1].attributes.d;
			expect(curvedPath).toContain('C8,31.2 24,16.8 24,36.0');
			expect(curvedPath).toContain('L24,60.0');
			expect(curvedPath).toContain('C24,79.2 8,64.8 8,84.0');
		});

		it('should compute angular elbow paths (L...) in Angular style', () => {
			const { graph } = createGraph({ style: sandbox.GG.GraphStyle.Angular });
			graph.loadCommits(commits, 'm', lookup, false);
			graph.render(null);

			const linePaths = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);

			// Main branch straight line
			expect(linePaths[0].attributes.d).toBe('M8,12.0L8,84.0');

			// Transition branch elbow path:
			// d = 24 * 0.38 = 9.12
			// lockedFirst = true: L24,26.9L24,36.0
			const angularPath = linePaths[1].attributes.d;
			expect(angularPath).toContain('L24,26.9L24,36.0');
			expect(angularPath).toContain('L24,60.0');
			expect(angularPath).toContain('L24,69.1L8,84.0');
			// Must NOT contain Bézier 'C' commands
			expect(angularPath).not.toContain('C');
		});
	});

	describe('Commit Expansion Row Offset (expandY)', () => {
		const commits = [
			makeCommit('c3', ['c2']),
			makeCommit('c2', ['c1']),
			makeCommit('c1', [])
		];
		const lookup = { c3: 0, c2: 1, c1: 2 };

		it('should extend height by expandY and stretch crossing lines when commit is expanded', () => {
			const { graph, config } = createGraph();
			graph.loadCommits(commits, 'c3', lookup, false);

			const unexpandedHeight = graph.getHeight(null);
			expect(unexpandedHeight).toBe(3 * config.grid.y + config.grid.offsetY - config.grid.y / 2); // 3 * 24 + 12 - 12 = 72

			// Render unexpanded
			graph.render(null);
			const unexpandedLines = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);
			expect(unexpandedLines[0].attributes.d).toBe('M8,12.0L8,60.0');

			// Expand commit at index 0
			const expandedCommit = { index: 0, commitHash: 'c3' };
			const expandedHeight = graph.getHeight(expandedCommit);
			expect(expandedHeight).toBe(unexpandedHeight + config.grid.expandY); // 72 + 250 = 322

			graph.render(expandedCommit);
			const expandedLines = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);

			// Vertical line crossing expansion has its lower endpoint stretched by expandY
			// 60.0 + 250 = 310.0
			expect(expandedLines[0].attributes.d).toBe('M8,12.0L8,310.0');
		});

		it('should offset circle node positions below the expanded commit', () => {
			const { graph } = createGraph();
			graph.loadCommits(commits, 'c3', lookup, false);

			const expandedCommit = { index: 0, commitHash: 'c3' };
			graph.render(expandedCommit);

			const circles = graph.group.children.filter((c: MockElement) => c.tag === 'circle');
			expect(circles.length).toBe(3);

			// Circle 0 (expanded commit itself) is at unshifted row position y=12
			expect(circles[0].attributes.cy).toBe('12');

			// Circle 1 (below expansion) is shifted down by expandY (row 1 is 36 + 250 = 286)
			expect(circles[1].attributes.cy).toBe('286');

			// Circle 2 (below expansion) is shifted down by expandY (row 2 is 60 + 250 = 310)
			expect(circles[2].attributes.cy).toBe('310');
		});
	});
});
