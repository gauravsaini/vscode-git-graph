import { GitCommit } from '../../src/types';
import { DataStoreHarness, createDataStoreHarness, createSampleCommit } from './fixtures/webHarness';

const UNCOMMITTED = '*';

describe('Commit Data Store Characterization Suite', () => {
	let harness: DataStoreHarness;

	const commitA = createSampleCommit({
		hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
		parents: [],
		author: 'Alice Developer',
		email: 'alice@example.com',
		date: 1767225600, // 2026-01-01T00:00:00.000Z
		message: 'feat: add user authentication\n\nFull oauth2 flow with PKCE.',
		heads: ['main'],
		tags: [{ name: 'v1.0.0', annotated: true }],
		remotes: [{ name: 'origin/main', remote: 'origin' }],
		stash: null
	});

	const commitB = createSampleCommit({
		hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
		parents: [commitA.hash],
		author: 'Bob Engineer',
		email: 'bob@example.com',
		date: 1767312000, // 2026-01-02T00:00:00.000Z
		message: 'fix: resolve race condition in token cache',
		heads: ['feature/tokens'],
		tags: [],
		remotes: [{ name: 'origin/feature/tokens', remote: 'origin' }],
		stash: null
	});

	const commitC = createSampleCommit({
		hash: 'cccccccccccccccccccccccccccccccccccccccc',
		parents: [commitA.hash, commitB.hash],
		author: 'Alice Developer',
		email: 'alice@example.com',
		date: 1767398400, // 2026-01-03T00:00:00.000Z
		message: 'Merge branch feature/tokens into main',
		heads: ['develop'],
		tags: [{ name: 'v1.1.0', annotated: false }],
		remotes: [{ name: 'upstream/develop', remote: 'upstream' }],
		stash: null
	});

	const commitStash = createSampleCommit({
		hash: 'dddddddddddddddddddddddddddddddddddddddd',
		parents: [commitC.hash],
		author: 'Alice Developer',
		email: 'alice@example.com',
		date: 1767484800,
		message: 'WIP on graph layout optimization',
		heads: [],
		tags: [],
		remotes: [],
		stash: {
			selector: 'stash@{0}',
			baseHash: commitC.hash,
			untrackedFilesHash: null
		}
	});

	const commitUncommitted = createSampleCommit({
		hash: UNCOMMITTED,
		parents: [commitC.hash],
		author: '*',
		email: '',
		date: 1767571200,
		message: 'Uncommitted Changes (3 files modified)',
		heads: [],
		tags: [],
		remotes: [],
		stash: null
	});

	beforeEach(() => {
		harness = createDataStoreHarness({ combineLocalAndRemoteBranchLabels: true });
	});

	describe('1. Array Equality Core Helpers (arraysEqual & arraysStrictlyEqual)', () => {
		it('should verify arraysStrictlyEqual with identical primitive elements', () => {
			expect(harness.arraysStrictlyEqual(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
			expect(harness.arraysStrictlyEqual([], [])).toBe(true);
		});

		it('should detect differences in arraysStrictlyEqual when elements differ or order changes', () => {
			expect(harness.arraysStrictlyEqual(['a', 'b'], ['a', 'c'])).toBe(false);
			expect(harness.arraysStrictlyEqual(['a', 'b'], ['b', 'a'])).toBe(false);
			expect(harness.arraysStrictlyEqual(['a'], ['a', 'b'])).toBe(false);
			expect(harness.arraysStrictlyEqual(['a', 'b'], ['a'])).toBe(false);
		});

		it('should verify arraysEqual with custom element equality function', () => {
			const arr1 = [{ id: 1, val: 'x' }, { id: 2, val: 'y' }];
			const arr2 = [{ id: 1, val: 'x' }, { id: 2, val: 'y' }];
			const arr3 = [{ id: 1, val: 'x' }, { id: 2, val: 'z' }];

			const eq = (a: { id: number; val: string }, b: { id: number; val: string }) => a.id === b.id && a.val === b.val;

			expect(harness.arraysEqual(arr1, arr2, eq)).toBe(true);
			expect(harness.arraysEqual(arr1, arr3, eq)).toBe(false);
			expect(harness.arraysEqual(arr1, arr1.slice(0, 1), eq)).toBe(false);
		});
	});

	describe('2. Commit Array Equality Diffing (areCommitArraysEqual)', () => {
		it('should return true for identical commit arrays', () => {
			const commits = [commitA, commitB, commitC];
			const copy = [
				{ ...commitA, heads: [...commitA.heads], tags: [...commitA.tags], remotes: [...commitA.remotes] },
				{ ...commitB, heads: [...commitB.heads], tags: [...commitB.tags], remotes: [...commitB.remotes] },
				{ ...commitC, heads: [...commitC.heads], tags: [...commitC.tags], remotes: [...commitC.remotes] }
			];

			expect(harness.areCommitArraysEqual(commits, copy)).toBe(true);
		});

		it('should return false when commit hashes differ', () => {
			const modified = [{ ...commitA, hash: '1234567890123456789012345678901234567890' }];
			expect(harness.areCommitArraysEqual([commitA], modified)).toBe(false);
		});

		it('should return false when branch heads differ in content or order', () => {
			const differentHeads = [{ ...commitA, heads: ['main', 'feature'] }];
			expect(harness.areCommitArraysEqual([commitA], differentHeads)).toBe(false);

			const multiHeadA = { ...commitA, heads: ['head1', 'head2'] };
			const multiHeadReordered = { ...commitA, heads: ['head2', 'head1'] };
			expect(harness.areCommitArraysEqual([multiHeadA], [multiHeadReordered])).toBe(false);
		});

		it('should return false when tags differ in name or annotated status', () => {
			const diffTagName = [{ ...commitA, tags: [{ name: 'v2.0.0', annotated: true }] }];
			expect(harness.areCommitArraysEqual([commitA], diffTagName)).toBe(false);

			const diffTagAnnotated = [{ ...commitA, tags: [{ name: 'v1.0.0', annotated: false }] }];
			expect(harness.areCommitArraysEqual([commitA], diffTagAnnotated)).toBe(false);
		});

		it('should return false when remotes differ in name or remote target', () => {
			const diffRemoteName = [{ ...commitA, remotes: [{ name: 'upstream/main', remote: 'origin' }] }];
			expect(harness.areCommitArraysEqual([commitA], diffRemoteName)).toBe(false);

			const diffRemoteTarget = [{ ...commitA, remotes: [{ name: 'origin/main', remote: 'upstream' }] }];
			expect(harness.areCommitArraysEqual([commitA], diffRemoteTarget)).toBe(false);
		});

		it('should return false when parent hashes differ or are reordered', () => {
			const diffParents = [{ ...commitC, parents: [commitB.hash, commitA.hash] }];
			expect(harness.areCommitArraysEqual([commitC], diffParents)).toBe(false);

			const extraParent = [{ ...commitC, parents: [commitA.hash, commitB.hash, 'parent3'] }];
			expect(harness.areCommitArraysEqual([commitC], extraParent)).toBe(false);
		});

		it('should correctly diff stash objects by selector', () => {
			// Both null -> true
			expect(harness.areCommitArraysEqual([commitA], [commitA])).toBe(true);

			// One null and one not null -> false
			expect(harness.areCommitArraysEqual([commitA], [commitStash])).toBe(false);

			// Both not null with same selector -> true
			const sameStash = { ...commitStash, stash: { selector: 'stash@{0}', baseHash: 'other', untrackedFilesHash: null } };
			expect(harness.areCommitArraysEqual([commitStash], [sameStash])).toBe(true);

			// Both not null with different selector -> false
			const diffStash = { ...commitStash, stash: { selector: 'stash@{1}', baseHash: commitC.hash, untrackedFilesHash: null } };
			expect(harness.areCommitArraysEqual([commitStash], [diffStash])).toBe(false);
		});

		it('should return false when commit array lengths differ', () => {
			expect(harness.areCommitArraysEqual([commitA, commitB], [commitA])).toBe(false);
			expect(harness.areCommitArraysEqual([], [commitA])).toBe(false);
		});
	});

	describe('3. Uncommitted Changes Fast-Path Mutation', () => {
		it('should mutate commit 0 in-place when commit[0] is UNCOMMITTED and remaining commits equal', () => {
			const currentCommits: GitCommit[] = [commitUncommitted, commitC, commitB, commitA];

			const updatedUncommitted = {
				...commitUncommitted,
				message: 'Uncommitted Changes (4 files modified, 1 added)'
			};
			const incomingCommits: GitCommit[] = [updatedUncommitted, commitC, commitB, commitA];

			// Simulate fast-path condition from web/main.ts line 325-337:
			const commitsEqual = harness.areCommitArraysEqual(currentCommits, incomingCommits);
			expect(commitsEqual).toBe(true); // Equal according to areCommitArraysEqual because messages are not compared

			if (currentCommits[0].hash === UNCOMMITTED) {
				currentCommits[0] = incomingCommits[0];
			}

			// In-place mutation verified:
			expect(currentCommits[0].message).toBe('Uncommitted Changes (4 files modified, 1 added)');
			// Remainder of array maintains exact references:
			expect(currentCommits[1]).toBe(commitC);
			expect(currentCommits[2]).toBe(commitB);
			expect(currentCommits[3]).toBe(commitA);
		});

		it('should NOT apply in-place fast path when commit[0] is not UNCOMMITTED', () => {
			const currentCommits: GitCommit[] = [commitC, commitB, commitA];
			const isUncommittedHead = currentCommits[0].hash === UNCOMMITTED;
			expect(isUncommittedHead).toBe(false);
		});
	});

	describe('4. Commit Lookup Dictionary Mapping (commitLookup)', () => {
		it('should map empty commits array to empty dictionary', () => {
			expect(harness.buildCommitLookup([])).toEqual({});
		});

		it('should map every commit hash to its 0-based array index', () => {
			const commits = [commitA, commitB, commitC, commitStash];
			const lookup = harness.buildCommitLookup(commits);

			expect(lookup[commitA.hash]).toBe(0);
			expect(lookup[commitB.hash]).toBe(1);
			expect(lookup[commitC.hash]).toBe(2);
			expect(lookup[commitStash.hash]).toBe(3);
			expect(lookup['nonexistent-hash']).toBeUndefined();
		});

		it('should correctly map UNCOMMITTED node hash to index 0', () => {
			const commits = [commitUncommitted, commitC, commitB];
			const lookup = harness.buildCommitLookup(commits);

			expect(lookup[UNCOMMITTED]).toBe(0);
			expect(lookup[commitC.hash]).toBe(1);
			expect(lookup[commitB.hash]).toBe(2);
		});
	});

	describe('5. Wasm Commits Format Projection', () => {
		it('should project GitCommit into the exact Wasm commit structure', () => {
			const wasmCommits = harness.projectWasmCommits([commitA]);
			expect(wasmCommits.length).toBe(1);

			const projected = wasmCommits[0];
			expect(projected.hash).toBe(commitA.hash);
			expect(projected.abbreviated_hash).toBe('aaaaaaa'); // exactly 7 characters
			expect(projected.parents).toEqual([]);
			expect(projected.author).toEqual({ name: 'Alice Developer', email: 'alice@example.com' });
			// Characterization check: committer copies author properties in web/main.ts
			expect(projected.committer).toEqual({ name: 'Alice Developer', email: 'alice@example.com' });
			expect(projected.message).toBe(commitA.message);
			expect(projected.summary).toBe('feat: add user authentication');
			expect(projected.date).toBe('2026-01-01T00:00:00.000Z');
		});

		it('should extract summary as first line before newline for multiline messages', () => {
			const projected = harness.projectWasmCommits([commitA, commitB]);
			// commitA has message with \n\n
			expect(projected[0].summary).toBe('feat: add user authentication');
			// commitB has single line message
			expect(projected[1].summary).toBe('fix: resolve race condition in token cache');
		});

		it('should project parent hashes for merge commits', () => {
			const projected = harness.projectWasmCommits([commitC]);
			expect(projected[0].parents).toEqual([commitA.hash, commitB.hash]);
		});

		it('should handle epoch timestamp zero and leap years', () => {
			const epochCommit = createSampleCommit({
				hash: '0000000000000000000000000000000000000000',
				date: 0,
				message: 'Initial root'
			});
			const leapYearCommit = createSampleCommit({
				hash: '9999999999999999999999999999999999999999',
				date: 1709164800, // 2024-02-29T00:00:00.000Z (leap year)
				message: 'Leap test'
			});

			const projected = harness.projectWasmCommits([epochCommit, leapYearCommit]);
			expect(projected[0].date).toBe('1970-01-01T00:00:00.000Z');
			expect(projected[1].date).toBe('2024-02-29T00:00:00.000Z');
		});
	});

	describe('6. Avatar Needed Aggregation', () => {
		it('should aggregate needed avatars by author email when fetchAvatars is true', () => {
			const existingAvatars: { [email: string]: string } = {};
			const commits = [commitA, commitB, commitC]; // Alice, Bob, Alice

			const needed = harness.aggregateAvatarsNeeded(commits, existingAvatars, true);

			expect(Object.keys(needed).sort()).toEqual(['alice@example.com', 'bob@example.com']);
			expect(needed['alice@example.com']).toEqual([commitA.hash, commitC.hash]);
			expect(needed['bob@example.com']).toEqual([commitB.hash]);
		});

		it('should exclude authors whose email is already cached in existingAvatars', () => {
			const existingAvatars = { 'alice@example.com': 'data:image/png;base64,...' };
			const commits = [commitA, commitB, commitC];

			const needed = harness.aggregateAvatarsNeeded(commits, existingAvatars, true);

			expect(needed['alice@example.com']).toBeUndefined();
			expect(needed['bob@example.com']).toEqual([commitB.hash]);
		});

		it('should exclude commits with empty email address', () => {
			const commits = [commitUncommitted]; // email is ''
			const needed = harness.aggregateAvatarsNeeded(commits, {}, true);

			expect(needed).toEqual({});
		});

		it('should return empty dictionary when fetchAvatars is false', () => {
			const commits = [commitA, commitB, commitC];
			const needed = harness.aggregateAvatarsNeeded(commits, {}, false);

			expect(needed).toEqual({});
		});
	});

	describe('7. Branch Label Grouping (getBranchLabels)', () => {
		describe('With combineLocalAndRemoteBranchLabels = true', () => {
			beforeEach(() => {
				harness = createDataStoreHarness({ combineLocalAndRemoteBranchLabels: true });
			});

			it('should attach remote tracking branch to matching local branch head', () => {
				const heads = ['main'];
				const remotes = [{ name: 'origin/main', remote: 'origin' }];

				const result = harness.getBranchLabels(heads, remotes);

				expect(result.heads).toEqual([
					{ name: 'main', remotes: ['origin'] }
				]);
				expect(result.remotes).toEqual([]);
			});

			it('should attach multiple remotes to the same local branch head', () => {
				const heads = ['develop'];
				const remotes = [
					{ name: 'origin/develop', remote: 'origin' },
					{ name: 'upstream/develop', remote: 'upstream' },
					{ name: 'backup/develop', remote: 'backup' }
				];

				const result = harness.getBranchLabels(heads, remotes);

				expect(result.heads).toEqual([
					{ name: 'develop', remotes: ['origin', 'upstream', 'backup'] }
				]);
				expect(result.remotes).toEqual([]);
			});

			it('should keep unmapped remote tracking branches in remotes array', () => {
				const heads = ['main'];
				const remotes = [
					{ name: 'origin/main', remote: 'origin' },
					{ name: 'origin/feature-login', remote: 'origin' }
				];

				const result = harness.getBranchLabels(heads, remotes);

				expect(result.heads).toEqual([
					{ name: 'main', remotes: ['origin'] }
				]);
				expect(result.remotes).toEqual([
					{ name: 'origin/feature-login', remote: 'origin' }
				]);
			});

			it('should keep remotes with remote === null in remotes array', () => {
				const heads = ['main'];
				const remotes = [
					{ name: 'origin/main', remote: 'origin' },
					{ name: 'detached-ref', remote: null }
				];

				const result = harness.getBranchLabels(heads, remotes);

				expect(result.heads).toEqual([
					{ name: 'main', remotes: ['origin'] }
				]);
				expect(result.remotes).toEqual([
					{ name: 'detached-ref', remote: null }
				]);
			});

			it('should correctly handle branch names containing slashes', () => {
				const heads = ['feature/user/profile'];
				const remotes = [
					{ name: 'origin/feature/user/profile', remote: 'origin' }
				];

				const result = harness.getBranchLabels(heads, remotes);

				expect(result.heads).toEqual([
					{ name: 'feature/user/profile', remotes: ['origin'] }
				]);
				expect(result.remotes).toEqual([]);
			});
		});

		describe('With combineLocalAndRemoteBranchLabels = false', () => {
			beforeEach(() => {
				harness = createDataStoreHarness({ combineLocalAndRemoteBranchLabels: false });
			});

			it('should keep local heads with empty remotes and preserve all remotes separate', () => {
				const heads = ['main', 'develop'];
				const remotes = [
					{ name: 'origin/main', remote: 'origin' },
					{ name: 'upstream/develop', remote: 'upstream' }
				];

				const result = harness.getBranchLabels(heads, remotes);

				expect(result.heads).toEqual([
					{ name: 'main', remotes: [] },
					{ name: 'develop', remotes: [] }
				]);
				expect(result.remotes).toEqual(remotes);
			});
		});
	});

	describe('8. UI Abbreviated Hash (8 chars) vs Wasm Hash (7 chars) Parity', () => {
		it('should demonstrate UI abbrevCommit is 8 chars while wasm abbreviated_hash is 7 chars', () => {
			const hash = '0123456789abcdef0123456789abcdef01234567';
			const uiAbbrev = harness.abbrevCommit(hash);
			const wasmProjected = harness.projectWasmCommits([createSampleCommit({ hash })])[0];

			expect(uiAbbrev).toBe('01234567');
			expect(uiAbbrev.length).toBe(8);

			expect(wasmProjected.abbreviated_hash).toBe('0123456');
			expect(wasmProjected.abbreviated_hash.length).toBe(7);

			expect(uiAbbrev.startsWith(wasmProjected.abbreviated_hash)).toBe(true);
		});
	});
});
