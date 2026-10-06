import * as vm from 'vm';
import { GitCommit } from '../../src/types';
import {
	createDataStoreHarness,
	createSampleCommit,
	getTranspiledWebScript,
	webScriptExists
} from './fixtures/webHarness';

const UNCOMMITTED = '*';

function createDirectDataStore(initialAvatars?: { [email: string]: string }) {
	const sandbox: any = {
		UNCOMMITTED: '*',
		exports: {}
	};
	vm.createContext(sandbox);
	const code = getTranspiledWebScript('commitDataStore.ts');
	vm.runInContext(code, sandbox);
	const StoreClass = sandbox.CommitDataStore || sandbox.exports.CommitDataStore;
	return new StoreClass(initialAvatars);
}

function getCommitFilterFallbackClass() {
	const sandbox: any = {
		UNCOMMITTED: '*',
		exports: {}
	};
	vm.createContext(sandbox);
	if (webScriptExists('commitDataStore.ts')) {
		vm.runInContext(getTranspiledWebScript('commitDataStore.ts'), sandbox);
	}
	const code = getTranspiledWebScript('commitFilterFallback.ts');
	vm.runInContext(code, sandbox);
	return sandbox.CommitFilterFallback || sandbox.exports.CommitFilterFallback;
}

describe('Empirical Challenger: CommitDataStore & CommitFilterFallback Adversarial Stress Suite', () => {

	describe('A. CommitDataStore Empirical Stress Battery', () => {

		describe('1. Rapid Sequential Updates & State Synchronization', () => {
			it('handles 1,000 rapid sequential setCommits calls maintaining perfect internal consistency', () => {
				const store = createDirectDataStore();

				const setA: GitCommit[] = Array.from({ length: 50 }, (_, i) =>
					createSampleCommit({
						hash: `a${i.toString().padStart(39, '0')}`,
						message: `Set A commit ${i}`,
						author: `Author A${i % 5}`,
						email: `authorA${i % 5}@example.com`
					})
				);

				const setB: GitCommit[] = Array.from({ length: 30 }, (_, i) =>
					createSampleCommit({
						hash: `b${i.toString().padStart(39, '0')}`,
						message: `Set B commit ${i}`,
						author: `Author B${i % 3}`,
						email: `authorB${i % 3}@example.com`
					})
				);

				const startTime = Date.now();

				for (let round = 0; round < 1000; round++) {
					const useA = round % 2 === 0;
					const currentSet = useA ? setA : setB;
					const head = useA ? 'a000000000000000000000000000000000000000' : 'b000000000000000000000000000000000000000';
					const more = round % 4 === 0;
					const firstParent = round % 3 === 0;

					store.setCommits(currentSet, head, more, firstParent);

					expect(store.size()).toBe(currentSet.length);
					expect(store.getCommitHead()).toBe(head);
					expect(store.isMoreCommitsAvailable()).toBe(more);
					expect(store.getOnlyFollowFirstParent()).toBe(firstParent);
					expect(store.getWasmCommits().length).toBe(currentSet.length);

					// Spot-check lookup integrity
					const probeIndex = round % currentSet.length;
					const probeCommit = currentSet[probeIndex];
					expect(store.getCommitId(probeCommit.hash)).toBe(probeIndex);
					expect(store.getCommit(probeCommit.hash)).toBe(probeCommit);
					expect(store.getCommitByIndex(probeIndex)).toBe(probeCommit);
				}

				const duration = Date.now() - startTime;
				// 1,000 full updates of 30-50 commits with Wasm projection and lookup generation must be fast (< 2000ms)
				expect(duration).toBeLessThan(2000);
			});
		});

		describe('2. Uncommitted Changes Mutations Under Stress', () => {
			it('handles 1,000 rapid sequential in-place mutations of UNCOMMITTED node at index 0', () => {
				const store = createDirectDataStore();

				const baseCommits: GitCommit[] = [
					createSampleCommit({
						hash: UNCOMMITTED,
						author: '*',
						email: '',
						message: 'Uncommitted Changes (initial)'
					}),
					createSampleCommit({
						hash: '1111111111111111111111111111111111111111',
						message: 'Committed baseline'
					})
				];

				store.setCommits(baseCommits, null, false, false);
				expect(store.size()).toBe(2);

				for (let i = 0; i < 1000; i++) {
					const updated = createSampleCommit({
						hash: UNCOMMITTED,
						author: '*',
						email: '',
						date: 1767225600 + i,
						message: `Uncommitted Changes (${i + 1} files modified)\nSummary line`
					});

					const mutated = store.updateUncommittedChanges(updated);
					expect(mutated).toBe(true);

					// Verify in-place mutation of commits array
					expect(store.getCommits()[0].message).toBe(updated.message);
					expect(store.getCommits()[0].date).toBe(updated.date);

					// Verify synchronized mutation of wasmCommits projection
					const wasm0 = store.getWasmCommits()[0];
					expect(wasm0.hash).toBe(UNCOMMITTED);
					expect(wasm0.message).toBe(updated.message);
					expect(wasm0.summary).toBe(`Uncommitted Changes (${i + 1} files modified)`);

					// Verify commit 1 reference is untouched
					expect(store.getCommits()[1].hash).toBe('1111111111111111111111111111111111111111');
				}
			});

			it('fails gracefully without mutation when commit[0] is not UNCOMMITTED', () => {
				const store = createDirectDataStore();
				const regularCommit = createSampleCommit({ hash: 'regular-hash', message: 'Regular commit' });
				store.setCommits([regularCommit]);

				const uncommittedCandidate = createSampleCommit({ hash: UNCOMMITTED, message: 'Uncommitted attempt' });
				const result = store.updateUncommittedChanges(uncommittedCandidate);

				expect(result).toBe(false);
				expect(store.getCommits()[0].hash).toBe('regular-hash');
			});

			it('fails gracefully without mutation when store is empty', () => {
				const store = createDirectDataStore();
				expect(store.size()).toBe(0);

				const uncommittedCandidate = createSampleCommit({ hash: UNCOMMITTED, message: 'Uncommitted attempt' });
				const result = store.updateUncommittedChanges(uncommittedCandidate);

				expect(result).toBe(false);
				expect(store.size()).toBe(0);
			});

			it('handles uncommitted changes mutation when wasmCommits is empty', () => {
				const store = createDirectDataStore();
				store.setCommits([createSampleCommit({ hash: UNCOMMITTED, message: 'Uncommitted' })]);
				store.setWasmCommits([]); // empty wasmCommits artificially

				const updated = createSampleCommit({ hash: UNCOMMITTED, message: 'Updated uncommitted' });
				const result = store.updateUncommittedChanges(updated);

				expect(result).toBe(true);
				expect(store.getCommits()[0].message).toBe('Updated uncommitted');
				expect(store.getWasmCommits().length).toBe(0);
			});
		});

		describe('3. Invalidation and Cache Consistency (Re-ordering, Truncation, Clear)', () => {
			it('re-indexes commitLookup consistently when commits are reversed', () => {
				const store = createDirectDataStore();
				const commits = Array.from({ length: 200 }, (_, i) =>
					createSampleCommit({ hash: `hash-${i.toString().padStart(4, '0')}`, message: `Commit ${i}` })
				);

				store.setCommits(commits);
				expect(store.getCommitId('hash-0000')).toBe(0);
				expect(store.getCommitId('hash-0199')).toBe(199);

				// Reverse commits
				const reversed = [...commits].reverse();
				store.setCommits(reversed);

				expect(store.size()).toBe(200);
				for (let i = 0; i < 200; i++) {
					const expectedIndex = 199 - i;
					const hash = `hash-${i.toString().padStart(4, '0')}`;
					expect(store.getCommitId(hash)).toBe(expectedIndex);
					expect(store.getCommit(hash)).toBe(commits[i]);
					expect(store.getCommitByIndex(expectedIndex)).toBe(commits[i]);
				}
			});

			it('purges stale hashes completely when commit array is truncated', () => {
				const store = createDirectDataStore();
				const commits = Array.from({ length: 300 }, (_, i) =>
					createSampleCommit({ hash: `hash-${i.toString().padStart(4, '0')}`, message: `Commit ${i}` })
				);

				store.setCommits(commits);
				expect(store.size()).toBe(300);
				expect(store.getCommitId('hash-0250')).toBe(250);

				// Truncate to first 100 commits
				const truncated = commits.slice(0, 100);
				store.setCommits(truncated);

				expect(store.size()).toBe(100);
				// Verify active commits
				expect(store.getCommitId('hash-0099')).toBe(99);
				expect(store.getCommit('hash-0099')).not.toBeNull();

				// Verify purged commits return null
				for (let i = 100; i < 300; i++) {
					const hash = `hash-${i.toString().padStart(4, '0')}`;
					expect(store.getCommitId(hash)).toBeNull();
					expect(store.getCommit(hash)).toBeNull();
					expect(store.getCommitByIndex(i)).toBeNull();
				}
			});

			it('completely resets store state on clear() while preserving onlyFollowFirstParent setting', () => {
				const store = createDirectDataStore();
				const commits = [
					createSampleCommit({ hash: 'c1' }),
					createSampleCommit({ hash: 'c2' })
				];

				store.setCommits(commits, 'c1', true, true);
				expect(store.size()).toBe(2);
				expect(store.getCommitHead()).toBe('c1');
				expect(store.isMoreCommitsAvailable()).toBe(true);
				expect(store.getOnlyFollowFirstParent()).toBe(true);

				store.clear();

				expect(store.size()).toBe(0);
				expect(store.getCommits()).toEqual([]);
				expect(store.getWasmCommits()).toEqual([]);
				expect(store.getCommitLookup()).toEqual({});
				expect(store.getCommitHead()).toBeNull();
				expect(store.isMoreCommitsAvailable()).toBe(false);
				expect(store.getCommit('c1')).toBeNull();
				expect(store.getCommitId('c1')).toBeNull();
				// Characterization: onlyFollowFirstParent is a persistent view setting, not cleared
				expect(store.getOnlyFollowFirstParent()).toBe(true);
			});
		});

		describe('4. Avatar Aggregation at Scale (Thousands of Authors & Duplicate Emails)', () => {
			it('aggregates avatars efficiently across 5,000 commits with duplicate and unique authors', () => {
				const store = createDirectDataStore();

				// 5,000 commits:
				// - 50 authors with 80 commits each = 4,000 commits
				// - 800 unique authors with 1 commit each = 800 commits
				// - 100 commits with empty string email ""
				// - 100 commits with null/undefined email
				const commits: GitCommit[] = [];

				for (let a = 0; a < 50; a++) {
					const email = `popular${a}@enterprise.com`;
					for (let c = 0; c < 80; c++) {
						commits.push(createSampleCommit({
							hash: `dup_${a}_${c}`.padEnd(40, '0'),
							author: `Popular Author ${a}`,
							email: email
						}));
					}
				}

				for (let u = 0; u < 800; u++) {
					commits.push(createSampleCommit({
						hash: `uniq_${u}`.padEnd(40, '0'),
						author: `Unique Author ${u}`,
						email: `unique${u}@company.org`
					}));
				}

				for (let e = 0; e < 100; e++) {
					commits.push(createSampleCommit({
						hash: `empty_${e}`.padEnd(40, '0'),
						author: 'Empty Email Author',
						email: ''
					}));
				}

				for (let n = 0; n < 100; n++) {
					commits.push(createSampleCommit({
						hash: `null_${n}`.padEnd(40, '0'),
						author: 'Null Email Author',
						email: (n % 2 === 0 ? null : undefined) as any
					}));
				}

				expect(commits.length).toBe(5000);
				store.setCommits(commits);

				// 1. fetchAvatars = false must return empty immediately
				const neededWhenDisabled = store.aggregateAvatarsNeeded(false);
				expect(neededWhenDisabled).toEqual({});

				// 2. fetchAvatars = true with empty existing avatars
				const start = Date.now();
				const needed = store.aggregateAvatarsNeeded(true);
				const elapsed = Date.now() - start;

				expect(elapsed).toBeLessThan(100); // Linear O(N) performance on 5,000 commits

				// Verify popular authors have exactly 80 hashes aggregated
				for (let a = 0; a < 50; a++) {
					const email = `popular${a}@enterprise.com`;
					expect(needed[email]).toBeDefined();
					expect(needed[email].length).toBe(80);
				}

				// Verify unique authors have exactly 1 hash aggregated
				for (let u = 0; u < 800; u++) {
					const email = `unique${u}@company.org`;
					expect(needed[email]).toBeDefined();
					expect(needed[email].length).toBe(1);
				}

				// Verify empty email "" is NEVER included
				expect(needed['']).toBeUndefined();

				// 3. Pre-cached avatars exclusion
				const existingAvatars: { [email: string]: string } = {};
				// Cache first 25 popular authors
				for (let a = 0; a < 25; a++) {
					existingAvatars[`popular${a}@enterprise.com`] = 'data:image/png;base64,...';
				}
				store.setAvatars(existingAvatars);

				const neededWithCache = store.aggregateAvatarsNeeded(true);

				// First 25 popular authors must be excluded
				for (let a = 0; a < 25; a++) {
					expect(neededWithCache[`popular${a}@enterprise.com`]).toBeUndefined();
				}
				// Remaining 25 popular authors must still be present
				for (let a = 25; a < 50; a++) {
					expect(neededWithCache[`popular${a}@enterprise.com`].length).toBe(80);
				}
			});

			it('safely handles setAvatar and getAvatar operations with duplicate updates', () => {
				const store = createDirectDataStore();

				expect(store.getAvatar('alice@example.com')).toBeNull();

				store.setAvatar('alice@example.com', 'image-v1');
				expect(store.getAvatar('alice@example.com')).toBe('image-v1');

				store.setAvatar('alice@example.com', 'image-v2');
				expect(store.getAvatar('alice@example.com')).toBe('image-v2');

				// Defensive copy in setAvatars
				const externalMap = { 'bob@example.com': 'bob-img' };
				store.setAvatars(externalMap);
				externalMap['bob@example.com'] = 'mutated-externally';
				expect(store.getAvatar('bob@example.com')).toBe('bob-img');
			});
		});

		describe('5. Boundary Conditions, Out-of-Bounds & Prototype Keys', () => {
			let store: any;

			beforeEach(() => {
				store = createDirectDataStore();
				store.setCommits([
					createSampleCommit({ hash: 'c0', message: 'Commit 0' }),
					createSampleCommit({ hash: 'c1', message: 'Commit 1' })
				]);
			});

			it('returns null for out-of-bounds indexing in getCommitByIndex', () => {
				expect(store.getCommitByIndex(-1)).toBeNull();
				expect(store.getCommitByIndex(-999)).toBeNull();
				expect(store.getCommitByIndex(2)).toBeNull(); // length is 2, index 2 is out of bounds
				expect(store.getCommitByIndex(100)).toBeNull();
				expect(store.getCommitByIndex(NaN)).toBeNull();
			});

			it('empirically reveals float index behavior in getCommitByIndex', () => {
				// 0.5 >= 0 && 0.5 < 2 is TRUE, but this.commits[0.5] evaluates to undefined
				const floatResult = store.getCommitByIndex(0.5);
				expect(floatResult).toBeUndefined();
			});

			it('returns null for missing, null, and undefined hashes in getCommitId and getCommit', () => {
				expect(store.getCommitId('')).toBeNull();
				expect(store.getCommitId('nonexistent')).toBeNull();
				expect(store.getCommitId(null as any)).toBeNull();
				expect(store.getCommitId(undefined as any)).toBeNull();

				expect(store.getCommit('')).toBeNull();
				expect(store.getCommit('nonexistent')).toBeNull();
				expect(store.getCommit(null as any)).toBeNull();
				expect(store.getCommit(undefined as any)).toBeNull();
			});

			it('is safe against JavaScript prototype properties in commitLookup', () => {
				// Object.prototype keys: toString, valueOf, constructor, __proto__, hasOwnProperty
				expect(store.getCommitId('toString')).toBeNull();
				expect(store.getCommitId('valueOf')).toBeNull();
				expect(store.getCommitId('constructor')).toBeNull();
				expect(store.getCommitId('hasOwnProperty')).toBeNull();
				expect(store.getCommitId('__proto__')).toBeNull();

				expect(store.getCommit('toString')).toBeNull();
				expect(store.getCommit('constructor')).toBeNull();
				expect(store.getCommit('__proto__')).toBeNull();
			});

			it('evaluates areCommitArraysEqual with boundary conditions', () => {
				const harness = createDataStoreHarness();

				// Empty arrays
				expect(harness.areCommitArraysEqual([], [])).toBe(true);

				const c1 = createSampleCommit({ hash: 'c1' });
				const c2 = createSampleCommit({ hash: 'c2' });

				// Truncated / mismatched lengths
				expect(harness.areCommitArraysEqual([c1], [c1, c2])).toBe(false);
				expect(harness.areCommitArraysEqual([c1, c2], [c1])).toBe(false);

				// Identical single element
				expect(harness.areCommitArraysEqual([c1], [c1])).toBe(true);
			});
		});
	});

	describe('B. CommitFilterFallback Empirical Stress Battery', () => {
		const FilterClass = getCommitFilterFallbackClass();

		const defaultColVis = { author: true, commit: true, date: true };

		const sampleCommits: GitCommit[] = [
			createSampleCommit({
				hash: '1111111122223333444455556666777788889999',
				author: 'Alice Engineer',
				email: 'alice@example.com',
				date: 1767225600, // 2026-01-01
				message: 'feat(core): initial architecture setup\nDetailed description.',
				heads: ['main'],
				tags: [{ name: 'v1.0.0', annotated: true }],
				remotes: [{ name: 'origin/main', remote: 'origin' }],
				stash: null
			}),
			createSampleCommit({
				hash: '2222222233334444555566667777888899990000',
				author: 'Bob Developer (Contractor)',
				email: 'bob@contractor.net',
				date: 1767312000,
				message: 'fix(auth): resolve oauth token expiration bug',
				heads: ['feature/tokens'],
				tags: [],
				remotes: [{ name: 'origin/feature/tokens', remote: 'origin' }],
				stash: null
			}),
			createSampleCommit({
				hash: '3333333344445555666677778888999900001111',
				author: 'Charlie Stash',
				email: 'charlie@company.org',
				date: 1767398400,
				message: 'WIP on stash test',
				heads: [],
				tags: [],
				remotes: [],
				stash: {
					selector: 'stash@{0}',
					baseHash: '1111111122223333444455556666777788889999',
					untrackedFilesHash: null
				}
			})
		];

		describe('1. Malformed Regex Patterns', () => {
			const malformedPatterns = [
				'[',
				'([a-z]',
				'*dangling',
				'+dangling',
				'?dangling',
				'{1,2',
				'\\',
				'(?',
				'(?<=',
				'[z-a]',
				'\\x',
				'\\u',
				'\\c',
				'*?',
				'+?'
			];

			it.each(malformedPatterns)('safely returns error without crashing for malformed pattern "%s"', (pattern) => {
				const result = FilterClass.filter(sampleCommits, {
					query: pattern,
					isRegex: true,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});

				expect(result.matches).toEqual([]);
				expect(result.error).not.toBeNull();
				expect(typeof result.error).toBe('string');
			});

			it('treats malformed regexes as literal strings without error when isRegex is false', () => {
				for (const pattern of malformedPatterns) {
					const result = FilterClass.filter(sampleCommits, {
						query: pattern,
						isRegex: false,
						isCaseSensitive: false,
						columnVisibility: defaultColVis
					});

					expect(result.error).toBeNull();
				}
			});
		});

		describe('2. Regex ReDoS Safety Checks & Plain-Text Immunity', () => {
			it('empirically proves plain-text mode escapes regex metacharacters and prevents ReDoS', () => {
				const targetCommit = createSampleCommit({
					hash: '9999999999999999999999999999999999999999',
					message: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa!' // 28 'a's
				});

				const start = Date.now();
				const result = FilterClass.filter([targetCommit], {
					query: '(a+)+$', // Classic ReDoS pattern
					isRegex: false, // Escaped in plain-text mode
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				const elapsed = Date.now() - start;

				expect(result.error).toBeNull();
				expect(result.matches).toEqual([]);
				// Plain-text mode matches literally in < 5ms
				expect(elapsed).toBeLessThan(20);
			});

			it('empirically profiles ReDoS catastrophic backtracking behavior in regex mode', () => {
				// ReDoS pattern (a+)+$ against 18 'a's followed by '!'
				const shortTarget = createSampleCommit({
					hash: 'h1',
					message: 'aaaaaaaaaaaaaaaaaa!' // 18 'a's
				});

				const startShort = Date.now();
				FilterClass.filter([shortTarget], {
					query: '(a+)+$',
					isRegex: true,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				const shortElapsed = Date.now() - startShort;

				// Demonstrates execution succeeds for bounded input
				expect(shortElapsed).toBeLessThan(1000);
			});
		});

		describe('3. Special Characters, Unicode Strings & Empty Queries', () => {
			const unicodeCommit = createSampleCommit({
				hash: '4444444455556666777788889999000011112222',
				author: '佐藤健 (Ken Sato) 🚀',
				email: 'ken@example.jp',
				date: 1767484800,
				message: 'feat(ui): 🎨 support dark mode & RTL בדיקה العربية\nSecond line with emoji 🎉',
				heads: ['feature/🌟-star'],
				tags: [{ name: 'v2.0-💎', annotated: true }],
				remotes: [{ name: 'origin/feature/🌟-star', remote: 'origin' }],
				stash: null
			});

			const testSet = [...sampleCommits, unicodeCommit];

			it('returns empty matches with null error on empty search term', () => {
				const result = FilterClass.filter(testSet, {
					query: '',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});

				expect(result.error).toBeNull();
				expect(result.matches).toEqual([]);
			});

			it('matches whitespace and newlines correctly', () => {
				const wsResult = FilterClass.filter(testSet, {
					query: '   ',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(wsResult.error).toBeNull();

				const nlResult = FilterClass.filter(testSet, {
					query: '\n',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(nlResult.error).toBeNull();
				// sampleCommits[0] and unicodeCommit both have multiline messages
				expect(nlResult.matches.length).toBeGreaterThanOrEqual(2);
			});

			it('matches Japanese CJK, Arabic, Hebrew, and Emojis', () => {
				expect(FilterClass.filter(testSet, {
					query: '佐藤健',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				}).matches).toEqual([{ hash: unicodeCommit.hash, index: 3 }]);

				expect(FilterClass.filter(testSet, {
					query: 'בדיקה',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				}).matches).toEqual([{ hash: unicodeCommit.hash, index: 3 }]);

				expect(FilterClass.filter(testSet, {
					query: 'العربية',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				}).matches).toEqual([{ hash: unicodeCommit.hash, index: 3 }]);

				expect(FilterClass.filter(testSet, {
					query: '🎨',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				}).matches).toEqual([{ hash: unicodeCommit.hash, index: 3 }]);

				expect(FilterClass.filter(testSet, {
					query: '🌟-star',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				}).matches).toEqual([{ hash: unicodeCommit.hash, index: 3 }]);
			});

			it('handles regex unicode property escapes when isRegex is true', () => {
				const result = FilterClass.filter(testSet, {
					query: '\\p{Script=Han}+',
					isRegex: true,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});

				expect(result.error).toBeNull();
				expect(result.matches).toEqual([{ hash: unicodeCommit.hash, index: 3 }]);
			});
		});

		describe('4. Multi-Field Search Parity & Column Visibility Gating', () => {
			it('matches commit hash by full 40-char hash and by prefix when commit column is visible', () => {
				const fullHash = sampleCommits[0].hash;
				const fullResult = FilterClass.filter(sampleCommits, {
					query: fullHash,
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(fullResult.matches).toEqual([{ hash: fullHash, index: 0 }]);

				// Prefix match
				const prefixResult = FilterClass.filter(sampleCommits, {
					query: '111111112222',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(prefixResult.matches).toEqual([{ hash: fullHash, index: 0 }]);
			});

			it('matches 8-character abbreviated commit hash', () => {
				const abbrev = sampleCommits[0].hash.substring(0, 8); // '11111111'
				const abbrevResult = FilterClass.filter(sampleCommits, {
					query: abbrev,
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(abbrevResult.matches).toEqual([{ hash: sampleCommits[0].hash, index: 0 }]);
			});

			it('rejects non-prefix substring in commit hash beyond 8 characters', () => {
				// Characters 20..28 are '55556666', not at index 0 and not in first 8 characters
				const nonPrefixResult = FilterClass.filter(sampleCommits, {
					query: '55556666',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(nonPrefixResult.matches).toEqual([]);
			});

			it('respects columnVisibility for author and date columns', () => {
				// Author search with author visible
				expect(FilterClass.filter(sampleCommits, {
					query: 'Alice Engineer',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: { author: true, commit: false, date: false }
				}).matches).toEqual([{ hash: sampleCommits[0].hash, index: 0 }]);

				// Author search with author hidden
				expect(FilterClass.filter(sampleCommits, {
					query: 'Alice Engineer',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: { author: false, commit: true, date: true }
				}).matches).toEqual([]);

				// Date search with date visible
				expect(FilterClass.filter(sampleCommits, {
					query: '2026-01-01',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: { author: false, commit: false, date: true }
				}).matches).toEqual([{ hash: sampleCommits[0].hash, index: 0 }]);

				// Date search with date hidden
				expect(FilterClass.filter(sampleCommits, {
					query: '2026-01-01',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: { author: false, commit: false, date: false }
				}).matches).toEqual([]);
			});

			it('always matches message regardless of column visibility', () => {
				const result = FilterClass.filter(sampleCommits, {
					query: 'oauth token expiration',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: { author: false, commit: false, date: false }
				});
				expect(result.matches).toEqual([{ hash: sampleCommits[1].hash, index: 1 }]);
			});

			it('matches stash selector', () => {
				const result = FilterClass.filter(sampleCommits, {
					query: 'stash@{0}',
					isRegex: false,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});
				expect(result.matches).toEqual([{ hash: sampleCommits[2].hash, index: 2 }]);
			});

			it('documents committer field parity: GitCommit lacks committer, Wasm projects author as committer', () => {
				// In Git Graph data model, GitCommit has no committer field.
				const store = createDirectDataStore();
				store.setCommits([sampleCommits[0]]);
				const projected = store.getWasmCommits();
				expect(projected[0].committer).toEqual({
					name: sampleCommits[0].author,
					email: sampleCommits[0].email
				});
			});
		});

		describe('5. Zero-Length Regex Rejection Matrix', () => {
			const zeroLengthPatterns = [
				'^',
				'$',
				'.*',
				'a*',
				'\\b',
				'\\B',
				'(?=feat)',
				'(?<=feat)',
				'()',
				'|',
				'a{0}'
			];

			it.each(zeroLengthPatterns)('rejects zero-length matching regex pattern "%s"', (pattern) => {
				const result = FilterClass.filter(sampleCommits, {
					query: pattern,
					isRegex: true,
					isCaseSensitive: false,
					columnVisibility: defaultColVis
				});

				expect(result.error).toBe('Cannot use a regular expression which has zero length matches');
				expect(result.matches).toEqual([]);
			});
		});
	});
});
