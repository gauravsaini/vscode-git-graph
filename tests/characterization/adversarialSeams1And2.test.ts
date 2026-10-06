import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';

import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });
jest.mock('../../src/askpass/askpassManager');
jest.mock('../../src/logger');

import {
	GIT_LOG_SEPARATOR,
	GitCommitRecord,
	GitLogParser,
	GitRefData,
	ParseLogOptions
} from '../../src/gitLogParser';
import { GitStash } from '../../src/types';

describe('Adversarial Empirical Stress Harness: Seams 1 & 2', () => {
	// =========================================================================
	// SEAM 1 ADVERSARIAL STRESS TESTS: GitLogParser
	// =========================================================================
	describe('Seam 1: GitLogParser Adversarial Edge Cases', () => {
		describe('1. Malformed and Boundary Inputs in parseLogLines', () => {
			it('should handle completely empty string, whitespace, and CRLF gracefully', () => {
				expect(GitLogParser.parseLogLines('')).toEqual([]);
				expect(GitLogParser.parseLogLines('\n\n\r\n   \t\n')).toEqual([]);
			});

			it('should reject lines with wrong separator counts (0, 1, 4, 6 separators)', () => {
				const malformedLines = [
					'not_a_valid_git_log_line',
					`hash1${GIT_LOG_SEPARATOR}parent1`,
					`hash2${GIT_LOG_SEPARATOR}parent2${GIT_LOG_SEPARATOR}author2${GIT_LOG_SEPARATOR}email2`,
					// 6 separators (7 fields)
					`hash3${GIT_LOG_SEPARATOR}parent3${GIT_LOG_SEPARATOR}author3${GIT_LOG_SEPARATOR}email3${GIT_LOG_SEPARATOR}12345${GIT_LOG_SEPARATOR}msg3${GIT_LOG_SEPARATOR}extra`
				].join('\n');

				const commits = GitLogParser.parseLogLines(malformedLines);
				expect(commits).toEqual([]);
			});

			it('should handle non-numeric, negative, and missing timestamps safely', () => {
				const log = [
					// Non-numeric timestamp "not-a-number" -> should fallback to 0
					[
						'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
						'bbbb1111bbbb1111bbbb1111bbbb1111bbbb1111',
						'Author',
						'author@test.com',
						'not-a-number',
						'Subject'
					].join(GIT_LOG_SEPARATOR),
					// Empty timestamp -> fallback to 0
					[
						'aaaa2222aaaa2222aaaa2222aaaa2222aaaa2222',
						'',
						'Author',
						'author@test.com',
						'',
						'Subject'
					].join(GIT_LOG_SEPARATOR),
					// Negative timestamp (pre-1970) -> parseInt handles negative numbers correctly
					[
						'aaaa3333aaaa3333aaaa3333aaaa3333aaaa3333',
						'',
						'Author',
						'author@test.com',
						'-3600',
						'Subject'
					].join(GIT_LOG_SEPARATOR)
				].join('\n') + '\n';

				const commits = GitLogParser.parseLogLines(log);
				expect(commits.length).toBe(3);
				expect(commits[0].date).toBe(0);
				expect(commits[1].date).toBe(0);
				expect(commits[2].date).toBe(-3600);
			});

			it('should handle non-ASCII, RTL, complex emojis, and special Unicode punctuation', () => {
				const unicodeLog = [
					// Japanese, Chinese, Korean
					[
						'h1',
						'',
						'山田 太郎 (Yamada)',
						'yamada@example.co.jp',
						'1700000001',
						'【機能追加】日本語コミットメッセージ / 简体中文 / 한국어'
					].join(GIT_LOG_SEPARATOR),
					// Right-to-Left (Arabic, Hebrew)
					[
						'h2',
						'h1',
						'مستخدم عربي',
						'user@arab.org',
						'1700000002',
						'رسالة تأكيد commit بالعربية مع עברית'
					].join(GIT_LOG_SEPARATOR),
					// Complex emojis: ZWJ family, flag, skin tone
					[
						'h3',
						'h2',
						'Emoji Master 👨‍👩‍👧‍👦 🏳️‍🌈 👍🏽',
						'emoji@test.com',
						'1700000003',
						'🚀 Feature: Added support for 🧑‍💻 developers & 🍕 pizza!'
					].join(GIT_LOG_SEPARATOR),
					// Zero-width space, BOM, tabs, quotes, backslashes
					[
						'h4',
						'h3',
						'Quote "Master" \\ Backslash',
						'punct@test.com',
						'1700000004',
						'Message with \u200B zero-width \t tabs and "double quotes" and \'single quotes\''
					].join(GIT_LOG_SEPARATOR)
				].join('\n') + '\n';

				const commits = GitLogParser.parseLogLines(unicodeLog);
				expect(commits.length).toBe(4);
				expect(commits[0].author).toBe('山田 太郎 (Yamada)');
				expect(commits[0].message).toBe('【機能追加】日本語コミットメッセージ / 简体中文 / 한국어');
				expect(commits[1].author).toBe('مستخدم عربي');
				expect(commits[2].author).toBe('Emoji Master 👨‍👩‍👧‍👦 🏳️‍🌈 👍🏽');
				expect(commits[3].message).toContain('zero-width');
				expect(commits[3].author).toBe('Quote "Master" \\ Backslash');
			});

			it('should handle extreme octopus merges with 20 parents in parseLogLines', () => {
				const twentyParents = Array.from({ length: 20 }, (_, i) => `parent_${i.toString().padStart(2, '0')}`).join(' ');
				const octopusLine = `octo_hash${GIT_LOG_SEPARATOR}${twentyParents}${GIT_LOG_SEPARATOR}OctoAuthor${GIT_LOG_SEPARATOR}octo@test.com${GIT_LOG_SEPARATOR}1700000000${GIT_LOG_SEPARATOR}Giant Octopus Merge\n`;

				const commits = GitLogParser.parseLogLines(octopusLine);
				expect(commits.length).toBe(1);
				expect(commits[0].parents.length).toBe(20);
				expect(commits[0].parents[0]).toBe('parent_00');
				expect(commits[0].parents[19]).toBe('parent_19');
			});
		});

		describe('2. parseRefs Edge Cases', () => {
			it('should handle empty refs output and noise lines gracefully', () => {
				const emptyRefData = GitLogParser.parseRefs('');
				expect(emptyRefData).toEqual({ head: null, heads: [], tags: [], remotes: [] });

				const noisyRefs = 'singleword\n \n\t\nhash_with_no_space\n';
				const noisyRefData = GitLogParser.parseRefs(noisyRefs);
				expect(noisyRefData).toEqual({ head: null, heads: [], tags: [], remotes: [] });
			});

			it('should handle peeled tags appearing before unpeeled tags in refs output', () => {
				// Sometimes git show-ref might return peeled tag right before or after
				const refs = [
					'commit_hash refs/tags/v2.0.0^{}',
					'tag_object_hash refs/tags/v2.0.0'
				].join('\n') + '\n';

				const refData = GitLogParser.parseRefs(refs, [], false);
				expect(refData.tags.length).toBe(2);

				const peeled = refData.tags.find((t) => t.annotated);
				const unpeeled = refData.tags.find((t) => !t.annotated);

				expect(peeled).toBeDefined();
				expect(peeled!.hash).toBe('commit_hash');
				expect(peeled!.name).toBe('v2.0.0');

				expect(unpeeled).toBeDefined();
				expect(unpeeled!.hash).toBe('tag_object_hash');
				expect(unpeeled!.name).toBe('v2.0.0');
			});

			it('should accurately isolate hidden remotes with similar prefixes', () => {
				const refs = [
					'h1 refs/remotes/upstream/feat',
					'h2 refs/remotes/upstream-fork/feat',
					'h3 refs/remotes/upstream_other/feat',
					'h4 refs/remotes/up/feat'
				].join('\n') + '\n';

				// Only 'upstream' is hidden
				const refData = GitLogParser.parseRefs(refs, ['upstream'], false);
				const remoteNames = refData.remotes.map((r) => r.name);

				expect(remoteNames).not.toContain('upstream/feat');
				expect(remoteNames).toContain('upstream-fork/feat');
				expect(remoteNames).toContain('upstream_other/feat');
				expect(remoteNames).toContain('up/feat');
			});
		});

		describe('3. assembleCommits Edge Cases', () => {
			const options: ParseLogOptions = {
				remotes: ['origin'],
				hideRemotes: [],
				showRemoteHeads: false,
				showTags: true,
				maxCommits: 10
			};

			it('should handle empty commits array cleanly without throwing', () => {
				const emptyRefData: GitRefData = { head: null, heads: [], tags: [], remotes: [] };
				const result = GitLogParser.assembleCommits([], emptyRefData, [], options);

				expect(result.commits).toEqual([]);
				expect(result.head).toBeNull();
				expect(result.tags).toEqual([]);
				expect(result.moreCommitsAvailable).toBe(false);
			});

			it('should handle uncommitted changes when HEAD commit is not present in commits list', () => {
				const commits: GitCommitRecord[] = [
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: 'm1' }
				];
				const refData: GitRefData = { head: 'non_existent_head', heads: [], tags: [], remotes: [] };
				const uncommittedOptions: ParseLogOptions = {
					...options,
					showUncommittedChanges: true,
					uncommittedChanges: 5
				};

				// When HEAD is not in commits, uncommitted changes must not be injected
				const result = GitLogParser.assembleCommits(commits.slice(), refData, [], uncommittedOptions);
				expect(result.commits.length).toBe(1);
				expect(result.commits[0].hash).toBe('c1');
			});

			it('should ignore stashes whose base commit is not in the commits list', () => {
				const commits: GitCommitRecord[] = [
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: 'm1' }
				];
				const refData: GitRefData = { head: 'c1', heads: [], tags: [], remotes: [] };
				const orphanStash: GitStash = {
					hash: 's_orphan',
					baseHash: 'c_non_existent',
					untrackedFilesHash: null,
					selector: 'refs/stash@{0}',
					author: 'A',
					email: 'a@a.com',
					date: 200,
					message: 'Stash on older commit'
				};

				const result = GitLogParser.assembleCommits(commits.slice(), refData, [orphanStash], options);
				expect(result.commits.length).toBe(1);
				expect(result.commits[0].hash).toBe('c1');
			});

			it('should attach stash metadata directly if stash hash itself is already in commits', () => {
				const commits: GitCommitRecord[] = [
					{ hash: 's1', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: 'stash commit' },
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: 'base commit' }
				];
				const refData: GitRefData = { head: 'c1', heads: [], tags: [], remotes: [] };
				const existingStash: GitStash = {
					hash: 's1',
					baseHash: 'c1',
					untrackedFilesHash: null,
					selector: 'refs/stash@{0}',
					author: 'A',
					email: 'a@a.com',
					date: 200,
					message: 'stash commit'
				};

				const result = GitLogParser.assembleCommits(commits.slice(), refData, [existingStash], options);
				expect(result.commits.length).toBe(2);
				expect(result.commits[0].stash).toEqual({
					selector: 'refs/stash@{0}',
					baseHash: 'c1',
					untrackedFilesHash: null
				});
			});
		});
	});

	// =========================================================================
	// SEAM 2 ADVERSARIAL STRESS TESTS: web/graph.ts Layout
	// =========================================================================
	describe('Seam 2: web/graph.ts Layout Adversarial Edge Cases', () => {
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
				style: sandbox.GG.GraphStyle.Rounded,
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

		it('should survive empty commits array: loadCommits([]) and render(null) without exceptions', () => {
			const { graph } = createGraph();
			expect(() => {
				graph.loadCommits([], null, {}, false);
				graph.render(null);
			}).not.toThrow();

			expect(graph.getContentWidth()).toBe(0);
			expect(graph.getHeight(null)).toBe(0);
			expect(graph.getVertexColours()).toEqual([]);
		});

		it('should handle single commit history correctly', () => {
			const { graph } = createGraph();
			const commits = [makeCommit('root', [])];
			const lookup = { root: 0 };

			graph.loadCommits(commits, 'root', lookup, false);
			graph.render(null);

			expect(graph.getVertexColours()).toEqual([0]);
			expect(graph.getContentWidth()).toBe(16);
			expect(graph.getFirstParentIndex(0)).toBe(-1);
			expect(graph.getAlternativeParentIndex(0)).toBe(-1);
			expect(graph.getFirstChildIndex(0)).toBe(-1);
			expect(graph.getAlternativeChildIndex(0)).toBe(-1);
			expect(graph.dropCommitPossible(0)).toBe(false);

			// Exactly 1 circle rendered
			const circles = graph.group.children.filter((c: MockElement) => c.tag === 'circle');
			expect(circles.length).toBe(1);
		});

		it('should handle massive 6-way octopus merge across 6 columns without crashing', () => {
			const { graph } = createGraph();
			// Root, 5 parallel branches, and 1 merge commit merging all 5
			const commits = [
				makeCommit('merge', ['b1', 'b2', 'b3', 'b4', 'b5']),
				makeCommit('b1', ['root']),
				makeCommit('b2', ['root']),
				makeCommit('b3', ['root']),
				makeCommit('b4', ['root']),
				makeCommit('b5', ['root']),
				makeCommit('root', [])
			];
			const lookup = { merge: 0, b1: 1, b2: 2, b3: 3, b4: 4, b5: 5, root: 6 };

			expect(() => {
				graph.loadCommits(commits, 'merge', lookup, false);
				graph.render(null);
			}).not.toThrow();

			const colours = graph.getVertexColours();
			expect(colours.length).toBe(7);

			// Content width accommodates multi-column routing
			expect(graph.getContentWidth()).toBeGreaterThan(16);

			// Rendering produces path lines for branches
			const lines = graph.group.children.filter(
				(c: MockElement) => c.tag === 'path' && c.attributes.class === 'line'
			);
			expect(lines.length).toBeGreaterThanOrEqual(5);
		});

		it('should handle disconnected graph components (multiple roots) properly', () => {
			const { graph } = createGraph();
			// Component A: c2 -> c1
			// Component B: o2 -> o1
			const commits = [
				makeCommit('c2', ['c1']),
				makeCommit('o2', ['o1']),
				makeCommit('c1', []),
				makeCommit('o1', [])
			];
			const lookup = { c2: 0, o2: 1, c1: 2, o1: 3 };

			expect(() => {
				graph.loadCommits(commits, 'c2', lookup, false);
				graph.render(null);
			}).not.toThrow();

			expect(graph.getFirstParentIndex(0)).toBe(2);
			expect(graph.getFirstParentIndex(1)).toBe(3);
			expect(graph.getFirstParentIndex(2)).toBe(-1);
			expect(graph.getFirstParentIndex(3)).toBe(-1);
		});

		it('should handle extreme grid dimensions and offsets', () => {
			const { graph } = createGraph({
				grid: { x: 120, y: 160, offsetX: 50, offsetY: 75, expandY: 500 }
			});
			const commits = [
				makeCommit('c2', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { c2: 0, c1: 1 };

			graph.loadCommits(commits, 'c2', lookup, false);
			graph.render(null);

			expect(graph.getContentWidth()).toBe(100); // 2 * 50 + (1 - 1) * 120 = 100
			expect(graph.getHeight(null)).toBe(2 * 160 + 75 - 160 / 2); // 320 + 75 - 80 = 315
		});

		it('should handle commit expansion at boundary indices (first row, last row, and out of bounds)', () => {
			const { graph } = createGraph();
			const commits = [
				makeCommit('c3', ['c2']),
				makeCommit('c2', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { c3: 0, c2: 1, c1: 2 };

			graph.loadCommits(commits, 'c3', lookup, false);

			// Expand at row 0 (top)
			expect(() => graph.render({ index: 0, commitHash: 'c3' })).not.toThrow();
			// Expand at row 2 (bottom)
			expect(() => graph.render({ index: 2, commitHash: 'c1' })).not.toThrow();
			// Expand with negative index (-1)
			expect(() => graph.render({ index: -1, commitHash: '' })).not.toThrow();
			// Expand with out of bounds index (100)
			expect(() => graph.render({ index: 100, commitHash: '' })).not.toThrow();
		});

		it('should handle parent commits that are not present in commitLookup (nullVertex)', () => {
			const { graph } = createGraph();
			// Shallow history: c1's parent 'missing_parent' is not in lookup
			const commits = [
				makeCommit('c1', ['missing_parent'])
			];
			const lookup = { c1: 0 };

			expect(() => {
				graph.loadCommits(commits, 'c1', lookup, false);
				graph.render(null);
			}).not.toThrow();

			expect(graph.getFirstParentIndex(0)).toBe(-1); // NULL_VERTEX_ID is -1
		});

		it('should respect onlyFollowFirstParent flag for missing parents', () => {
			const { graph: graphDefault } = createGraph();
			const commits = [
				makeCommit('m', ['parent1', 'missing_parent2'])
			];
			const lookup = { m: 0 };

			graphDefault.loadCommits(commits, 'm', lookup, false);
			// Under default (onlyFollowFirstParent: false), missing_parent2 is added as nullVertex
			expect(graphDefault.getAlternativeParentIndex(0)).toBe(-1);

			const { graph: graphFirstOnly } = createGraph();
			graphFirstOnly.loadCommits(commits, 'm', lookup, true);
			// Under onlyFollowFirstParent: true, missing_parent2 is skipped
			expect(graphFirstOnly.getAlternativeParentIndex(0)).toBe(-1);
		});

		it('should handle getMutedCommits with null currentHash or unknown currentHash', () => {
			const { graph } = createGraph({}, { commitsNotAncestorsOfHead: true });
			const commits = [
				makeCommit('c2', ['c1']),
				makeCommit('c1', [])
			];
			const lookup = { c2: 0, c1: 1 };

			graph.loadCommits(commits, 'c2', lookup, false);

			// Null currentHash: no commits are muted by ancestor check
			expect(graph.getMutedCommits(null)).toEqual([false, false]);

			// Unknown hash: no commits are muted by ancestor check
			expect(graph.getMutedCommits('unknown_hash')).toEqual([false, false]);
		});

		it('should scale without crashing or stack overflow on a 50-commit complex branching DAG', () => {
			const { graph } = createGraph();
			const commits: any[] = [];
			const lookup: { [hash: string]: number } = {};

			// Generate 50 commits alternating between main branch, feature branch, and merges
			for (let i = 0; i < 50; i++) {
				const hash = `c_${i}`;
				lookup[hash] = i;
				if (i === 49) {
					// Root commit
					commits.push(makeCommit(hash, []));
				} else if (i % 5 === 0 && i + 2 < 50) {
					// Merge commit: merges previous commit and another branch
					commits.push(makeCommit(hash, [`c_${i + 1}`, `c_${i + 2}`]));
				} else {
					// Linear commit
					commits.push(makeCommit(hash, [`c_${i + 1}`]));
				}
			}

			expect(() => {
				graph.loadCommits(commits, 'c_0', lookup, false);
				graph.render(null);
			}).not.toThrow();

			expect(graph.getVertexColours().length).toBe(50);
			expect(graph.getHeight(null)).toBe(50 * 24 + 12 - 12);
			expect(graph.getContentWidth()).toBeGreaterThan(16);
		});
	});
});

