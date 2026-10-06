import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { TextDecoder, TextEncoder } from 'util';
import * as vm from 'vm';

if (typeof (global as any).TextDecoder === 'undefined') {
	(global as any).TextDecoder = TextDecoder;
	(global as any).TextEncoder = TextEncoder;
}

describe('Empirical Adversarial Stress Testing: Web Graph Layout & Wasm Bridge Seam', () => {
	let sandbox: any;
	let configRounded: any;
	let configAngular: any;
	let muteConfig: any;

	beforeAll(() => {
		sandbox = {
			TextDecoder: TextDecoder,
			TextEncoder: TextEncoder,
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
		const graphLayoutTsCode = fs.readFileSync(graphLayoutTsPath, 'utf8');
		const transpiledLayout = ts.transpileModule(graphLayoutTsCode, {
			compilerOptions: {
				target: ts.ScriptTarget.ES5,
				module: ts.ModuleKind.None
			}
		}).outputText;
		vm.runInContext(transpiledLayout, sandbox);

		const graphWasmBridgeTsPath = path.join(__dirname, '../../web/graphWasmBridge.ts');
		const graphWasmBridgeTsCode = fs.readFileSync(graphWasmBridgeTsPath, 'utf8');
		const transpiledBridge = ts.transpileModule(graphWasmBridgeTsCode, {
			compilerOptions: {
				target: ts.ScriptTarget.ES5,
				module: ts.ModuleKind.None
			}
		}).outputText;
		vm.runInContext(transpiledBridge, sandbox);

		configRounded = {
			colours: ['#0088cc', '#ff8800', '#00cc88', '#cc0088', '#8800cc', '#e6194b', '#3cb44b', '#ffe119'],
			style: sandbox.GG.GraphStyle.Rounded,
			grid: { x: 16, y: 24, offsetX: 8, offsetY: 12, expandY: 250 },
			uncommittedChanges: sandbox.GG.GraphUncommittedChangesStyle.OpenCircleAtTheCheckedOutCommit
		};

		configAngular = {
			...configRounded,
			style: sandbox.GG.GraphStyle.Angular
		};

		muteConfig = {
			commitsNotAncestorsOfHead: false,
			mergeCommits: false
		};
	});

	const makeCommit = (hash: string, parents: string[], extra: any = {}) => ({
		hash: hash,
		parents: parents,
		author: 'Dev',
		email: 'dev@test.com',
		date: 1000,
		message: hash,
		heads: [],
		tags: [],
		remotes: [],
		stash: null,
		...extra
	});

	const assertStrictlyFinite = (drawData: any, label: string) => {
		expect(label).toBeDefined();
		expect(Number.isFinite(drawData.contentWidth)).toBe(true);
		expect(drawData.contentWidth).toBeGreaterThanOrEqual(0);
		expect(Number.isFinite(drawData.height)).toBe(true);
		expect(drawData.height).toBeGreaterThanOrEqual(0);

		for (let i = 0; i < drawData.nodes.length; i++) {
			const node = drawData.nodes[i];
			const cx = parseFloat(node.cx);
			const cy = parseFloat(node.cy);
			const r = parseFloat(node.r);
			expect(Number.isFinite(cx)).toBe(true);
			expect(Number.isFinite(cy)).toBe(true);
			expect(Number.isFinite(r)).toBe(true);

			if (node.stashInner) {
				const scx = parseFloat(node.stashInner.cx);
				const scy = parseFloat(node.stashInner.cy);
				const sr = parseFloat(node.stashInner.r);
				expect(Number.isFinite(scx)).toBe(true);
				expect(Number.isFinite(scy)).toBe(true);
				expect(Number.isFinite(sr)).toBe(true);
			}
		}

		for (let p = 0; p < drawData.paths.length; p++) {
			const d = drawData.paths[p].d;
			expect(d).not.toContain('NaN');
			expect(d).not.toContain('undefined');
			expect(d).not.toContain('null');
			expect(d).not.toContain('Infinity');

			const extractedNums = d.match(/-?[0-9]+(\.[0-9]+)?/g) || [];
			for (let n = 0; n < extractedNums.length; n++) {
				const val = parseFloat(extractedNums[n]);
				expect(Number.isFinite(val)).toBe(true);
			}
		}
	};

	describe('1. Boundary Conditions: Empty & Single-Commit Graphs', () => {
		it('should handle empty graph (0 commits) safely with zero dimensions and empty draw data', () => {
			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits([], null, {}, false);

			const drawData = layout.generateDrawData();
			expect(drawData.paths).toEqual([]);
			expect(drawData.nodes).toEqual([]);
			expect(drawData.circles).toEqual([]);
			expect(drawData.contentWidth).toBe(0);
			expect(drawData.height).toBe(0);
			expect(layout.getVertexColours()).toEqual([]);
			expect(layout.getWidthsAtVertices()).toEqual([]);
			expect(layout.getMutedCommits(null)).toEqual([]);
			expect(layout.getVerticesCount()).toBe(0);
		});

		it('should handle single commit graph without throwing, rendering 1 node and 0 paths', () => {
			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			const commit = makeCommit('c1', []);
			layout.loadCommits([commit], 'c1', { c1: 0 }, false);

			const drawData = layout.generateDrawData();
			expect(drawData.paths.length).toBe(0);
			expect(drawData.nodes.length).toBe(1);
			expect(drawData.contentWidth).toBe(16);
			expect(drawData.height).toBe(24);

			const node = drawData.nodes[0];
			expect(node.cx).toBe('8');
			expect(node.cy).toBe('12');
			expect(node.colour).toBe('#0088cc');
			expect(node.isCurrent).toBe(true);
			assertStrictlyFinite(drawData, 'Single commit');
		});

		it('should handle single stash commit with nested stash circle geometry', () => {
			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			const stashCommit = makeCommit('s1', [], {
				stash: { selector: 'stash@{0}', baseHash: 'c0', untrackedFilesHash: null }
			});
			layout.loadCommits([stashCommit], null, { s1: 0 }, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(1);
			const node = drawData.nodes[0];
			expect(node.isStash).toBe(true);
			expect(node.r).toBe('4.5');
			expect(node.stashInner).toBeDefined();
			expect(node.stashInner!.r).toBe('2');
			assertStrictlyFinite(drawData, 'Single stash');
		});

		it('should handle single uncommitted changes pseudo-commit with open circle style', () => {
			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			const uncommittedCommit = makeCommit('*', []);
			layout.loadCommits([uncommittedCommit], '*', { '*': 0 }, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(1);
			const node = drawData.nodes[0];
			expect(node.colour).toBe('#808080');
			assertStrictlyFinite(drawData, 'Single uncommitted');
		});
	});

	describe('2. Scale Stress Test: 10,000 Linear Commits', () => {
		it('should process 10,000 linear commits with line simplification under 2 seconds', () => {
			const N = 10000;
			const commits: any[] = [];
			const lookup: { [hash: string]: number } = {};

			for (let i = 0; i < N; i++) {
				const hash = 'c_' + i;
				lookup[hash] = i;
				commits.push(makeCommit(hash, i < N - 1 ? ['c_' + (i + 1)] : []));
			}

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);

			const t0 = Date.now();
			layout.loadCommits(commits, 'c_0', lookup, false);
			const drawData = layout.generateDrawData();
			const tDraw = Date.now();

			expect(tDraw - t0).toBeLessThan(2000);
			expect(drawData.nodes.length).toBe(N);
			// Line simplification merges all 9,999 vertical lines into 1 single path segment
			expect(drawData.paths.length).toBe(1);
			expect(drawData.paths[0].d).toBe('M8,12.0L8,239988.0');
			expect(drawData.contentWidth).toBe(16);
			expect(drawData.height).toBe(N * 24);

			assertStrictlyFinite(drawData, '10k linear commits');
		});
	});

	describe('3. Complex Adversarial DAG Topologies', () => {
		it('should route multi-parent octopus merge with 8 parents and assign correct branch lanes', () => {
			const octoParents: string[] = [];
			const commits: any[] = [];
			for (let p = 0; p < 8; p++) {
				octoParents.push('p' + p);
			}
			commits.push(makeCommit('octo_head', octoParents));
			for (let p = 0; p < 8; p++) {
				commits.push(makeCommit('p' + p, ['root']));
			}
			commits.push(makeCommit('root', []));

			const lookup: { [hash: string]: number } = {};
			commits.forEach((c, idx) => { lookup[c.hash] = idx; });

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'octo_head', lookup, false);

			const drawData = layout.generateDrawData();
			expect(layout.getBranches().length).toBe(8);
			expect(drawData.paths.length).toBe(8);
			expect(drawData.nodes.length).toBe(10);
			expect(drawData.contentWidth).toBe(128);

			assertStrictlyFinite(drawData, '8-parent octopus');
		});

		it('should route extreme octopus merge with 20 parents without lane collision or non-finite values', () => {
			const P_COUNT = 20;
			const parents: string[] = [];
			const commits: any[] = [];
			for (let p = 0; p < P_COUNT; p++) {
				parents.push('p' + p);
			}
			commits.push(makeCommit('big_octo', parents));
			for (let p = 0; p < P_COUNT; p++) {
				commits.push(makeCommit('p' + p, ['root']));
			}
			commits.push(makeCommit('root', []));

			const lookup: { [hash: string]: number } = {};
			commits.forEach((c, idx) => { lookup[c.hash] = idx; });

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'big_octo', lookup, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(P_COUNT + 2);
			assertStrictlyFinite(drawData, '20-parent octopus');
		});

		it('should route deep criss-cross merges connecting interdependent branch tips', () => {
			const commits = [
				makeCommit('m3', ['m1', 'm2']),
				makeCommit('m2', ['b', 'a']),
				makeCommit('m1', ['a', 'b']),
				makeCommit('b', ['root']),
				makeCommit('a', ['root']),
				makeCommit('root', [])
			];
			const lookup: { [hash: string]: number } = {};
			commits.forEach((c, idx) => { lookup[c.hash] = idx; });

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'm3', lookup, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(6);
			expect(drawData.paths.length).toBeGreaterThan(0);
			assertStrictlyFinite(drawData, 'Criss-cross merge');
		});

		it('should route disconnected subgraphs and independent orphan branches gracefully', () => {
			const commits = [
				makeCommit('c1_2', ['c1_1']),
				makeCommit('c2_2', ['c2_1']),
				makeCommit('c1_1', ['c1_root']),
				makeCommit('c2_1', ['c2_root']),
				makeCommit('c3_solo', []),
				makeCommit('c1_root', []),
				makeCommit('c2_root', [])
			];
			const lookup: { [hash: string]: number } = {};
			commits.forEach((c, idx) => { lookup[c.hash] = idx; });

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'c1_2', lookup, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(7);
			expect(drawData.paths.length).toBe(3);
			assertStrictlyFinite(drawData, 'Disconnected subgraphs');
		});

		it('should handle shallow clone / missing parent hashes without throwing unhandled exceptions', () => {
			const commits = [
				makeCommit('head', ['missing_parent_1', 'missing_parent_2']),
				makeCommit('solo', ['missing_parent_3'])
			];
			const lookup = { head: 0, solo: 1 };

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'head', lookup, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(2);
			expect(drawData.paths.length).toBe(2);
			assertStrictlyFinite(drawData, 'Missing parent shallow clone');
		});
	});

	describe('4. Path Geometry: Bézier Curves & Angular Paths Verification', () => {
		const commits = [
			makeCommit('m', ['b', 'a']),
			makeCommit('b', ['root']),
			makeCommit('a', ['root']),
			makeCommit('root', [])
		];
		const lookup = { m: 0, b: 1, a: 2, root: 3 };

		it('should generate valid cubic Bézier control points in Rounded style', () => {
			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'm', lookup, false);

			const drawData = layout.generateDrawData();
			assertStrictlyFinite(drawData, 'Rounded geometry');

			const bezierPaths = drawData.paths.filter((p: any) => p.d.includes('C'));
			expect(bezierPaths.length).toBeGreaterThan(0);

			for (let i = 0; i < bezierPaths.length; i++) {
				const matches = bezierPaths[i].d.match(/C(-?[0-9.]+),(-?[0-9.]+)\s+(-?[0-9.]+),(-?[0-9.]+)\s+(-?[0-9.]+),(-?[0-9.]+)/g);
				expect(matches).not.toBeNull();
				for (let m = 0; m < matches.length; m++) {
					const parts = matches[m].replace('C', '').split(/[\s,]+/);
					expect(parts.length).toBe(6);
					for (let c = 0; c < parts.length; c++) {
						const num = parseFloat(parts[c]);
						expect(Number.isFinite(num)).toBe(true);
					}
				}
			}
		});

		it('should generate valid angular elbow segments in Angular style without Bézier C commands', () => {
			const layout = new sandbox.GraphLayout(configAngular, muteConfig);
			layout.loadCommits(commits, 'm', lookup, false);

			const drawData = layout.generateDrawData();
			assertStrictlyFinite(drawData, 'Angular geometry');

			for (let i = 0; i < drawData.paths.length; i++) {
				expect(drawData.paths[i].d).not.toContain('C');
			}
		});

		it('should maintain finite coordinates when commit expansion offset (expandAt) is applied', () => {
			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'm', lookup, false);

			for (let exp = 0; exp < commits.length; exp++) {
				const drawData = layout.generateDrawData(exp);
				assertStrictlyFinite(drawData, 'Expand at ' + exp);
				expect(drawData.height).toBe(commits.length * 24 + configRounded.grid.expandY);
			}
		});
	});

	describe('5. Column Reservation & Lane Non-Collision Logic', () => {
		it('should allocate distinct non-overlapping columns for interleaved concurrent branches', () => {
			const BRANCH_COUNT = 10;
			const DEPTH = 5;
			const commits: any[] = [];

			for (let d = DEPTH - 1; d >= 0; d--) {
				for (let b = 0; b < BRANCH_COUNT; b++) {
					const hash = 'br_' + b + '_d_' + d;
					const parent = d > 0 ? ['br_' + b + '_d_' + (d - 1)] : [];
					commits.push(makeCommit(hash, parent));
				}
			}

			const lookup: { [hash: string]: number } = {};
			commits.forEach((c, idx) => { lookup[c.hash] = idx; });

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, commits[0].hash, lookup, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(BRANCH_COUNT * DEPTH);
			expect(drawData.contentWidth).toBeGreaterThanOrEqual(16 * BRANCH_COUNT);
			assertStrictlyFinite(drawData, 'Interleaved concurrent branches');
		});

		it('should reserve columns and prevent lane collision in wide fan-out (16 parallel branches)', () => {
			const B_COUNT = 16;
			const branchTips: string[] = [];
			const commits: any[] = [];
			for (let b = 0; b < B_COUNT; b++) {
				branchTips.push('b_' + b);
			}
			commits.push(makeCommit('merge_all', branchTips));
			for (let b = 0; b < B_COUNT; b++) {
				commits.push(makeCommit('b_' + b, ['root']));
			}
			commits.push(makeCommit('root', []));

			const lookup: { [hash: string]: number } = {};
			commits.forEach((c, idx) => { lookup[c.hash] = idx; });

			const layout = new sandbox.GraphLayout(configRounded, muteConfig);
			layout.loadCommits(commits, 'merge_all', lookup, false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(B_COUNT + 2);
			assertStrictlyFinite(drawData, 'Fan out 16');
		});
	});

	describe('6. GraphWasmBridge Fallback Resilience', () => {
		const commits = [
			makeCommit('c2', ['c1']),
			makeCommit('c1', [])
		];
		const lookup = { c2: 0, c1: 1 };

		const createIsolatedBridge = (wasmBindgenMock: any): any => {
			const sb: any = {
				TextDecoder: TextDecoder,
				TextEncoder: TextEncoder,
				UNCOMMITTED: '*',
				GG: {
					GraphStyle: { Rounded: 0, Angular: 1 },
					GraphUncommittedChangesStyle: { OpenCircleAtTheUncommittedChanges: 0, OpenCircleAtTheCheckedOutCommit: 1 }
				},
				wasm_bindgen: wasmBindgenMock,
				console: console
			};
			vm.createContext(sb);

			const graphLayoutTsPath = path.join(__dirname, '../../web/graphLayout.ts');
			const graphLayoutTsCode = fs.readFileSync(graphLayoutTsPath, 'utf8');
			const transpiledLayout = ts.transpileModule(graphLayoutTsCode, {
				compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None }
			}).outputText;
			vm.runInContext(transpiledLayout, sb);

			const graphWasmBridgeTsPath = path.join(__dirname, '../../web/graphWasmBridge.ts');
			const graphWasmBridgeTsCode = fs.readFileSync(graphWasmBridgeTsPath, 'utf8');
			const transpiledBridge = ts.transpileModule(graphWasmBridgeTsCode, {
				compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None }
			}).outputText;
			vm.runInContext(transpiledBridge, sb);

			return sb;
		};

		it('should gracefully and synchronously fall back to TypeScript when wasm_bindgen is undefined', () => {
			const sb = createIsolatedBridge(undefined);
			expect(sb.GraphWasmBridge.isAvailable()).toBe(false);
			expect(sb.GraphWasmBridge.isWasmAvailable()).toBe(false);
			expect(sb.GraphWasmBridge.generateLayout(commits, 'c2', configRounded)).toBeNull();

			const layout = new sb.GraphLayout(configRounded, muteConfig);
			const usedWasm = sb.GraphWasmBridge.loadCommits(layout, commits, 'c2', lookup, false, configRounded);
			expect(usedWasm).toBe(false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(2);
			expect(drawData.paths.length).toBe(1);
			expect(sb.GraphWasmBridge.renderLanesSvg({}, configRounded)).toBeNull();
		});

		it('should catch runtime exceptions during generate_layout_js and fall back to TypeScript', () => {
			const throwingWasm = {
				generate_layout_js: () => {
					throw new Error('Rust Wasm Panic: memory allocation failed');
				},
				render_lanes_svg_js: () => {
					throw new Error('Rust Wasm Panic: render failed');
				}
			};
			const sb = createIsolatedBridge(throwingWasm);
			expect(sb.GraphWasmBridge.isAvailable()).toBe(true);

			const layout = new sb.GraphLayout(configRounded, muteConfig);
			const usedWasm = sb.GraphWasmBridge.loadCommits(layout, commits, 'c2', lookup, false, configRounded);
			expect(usedWasm).toBe(false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(2);
			expect(drawData.paths.length).toBe(1);
			expect(sb.GraphWasmBridge.renderLanesSvg({}, configRounded)).toBeNull();
		});

		it('should catch corrupt return values (null, empty, or mismatched rows) and fall back to TypeScript', () => {
			const corruptWasm = {
				generate_layout_js: () => ({
					rows: [] // 0 rows returned for 2 commits!
				})
			};
			const sb = createIsolatedBridge(corruptWasm);

			const layout = new sb.GraphLayout(configRounded, muteConfig);
			const usedWasm = sb.GraphWasmBridge.loadCommits(layout, commits, 'c2', lookup, false, configRounded);
			expect(usedWasm).toBe(false);

			const drawData = layout.generateDrawData();
			expect(drawData.nodes.length).toBe(2);
			expect(drawData.paths.length).toBe(1);
		});

		it('should safely format commit dates falling back to 1970 ISO date on NaN, Infinity, or negative dates', () => {
			const corruptDateCommits = [
				makeCommit('b1', [], { date: NaN }),
				makeCommit('b2', [], { date: Infinity }),
				makeCommit('b3', [], { date: -1e15 })
			];

			const formatted = sandbox.GraphWasmBridge.formatCommits(corruptDateCommits);
			expect(formatted.length).toBe(3);
			for (let i = 0; i < formatted.length; i++) {
				expect(formatted[i].date).toBe('1970-01-01T00:00:00.000Z');
				expect(formatted[i].abbreviated_hash).toBe(corruptDateCommits[i].hash.substring(0, 7));
				expect(formatted[i].author.name).toBe('Dev');
			}
		});

		it('should successfully interface with real Wasm binary when available', () => {
			const wasmJsPath = path.join(__dirname, '../../media/git_graph_wasm.js');
			const wasmBgPath = path.join(__dirname, '../../media/git_graph_wasm_bg.wasm');

			if (fs.existsSync(wasmJsPath) && fs.existsSync(wasmBgPath)) {
				const wasmJsCode = fs.readFileSync(wasmJsPath, 'utf8');
				const wasmBgBytes = fs.readFileSync(wasmBgPath);

				const getWasmBindgen = new Function(wasmJsCode + '; return wasm_bindgen;');
				const realWasm = getWasmBindgen();
				realWasm.initSync({ module: wasmBgBytes });

				const sb = createIsolatedBridge(realWasm);
				expect(sb.GraphWasmBridge.isAvailable()).toBe(true);

				const layout = new sb.GraphLayout(configRounded, muteConfig);
				const usedWasm = sb.GraphWasmBridge.loadCommits(layout, commits, 'c2', lookup, false, configRounded);
				expect(usedWasm).toBe(true);

				const drawData = layout.generateDrawData();
				expect(drawData.nodes.length).toBe(2);
				expect(drawData.paths.length).toBe(1);
				assertStrictlyFinite(drawData, 'Real Wasm bridge');
			}
		});
	});
});
