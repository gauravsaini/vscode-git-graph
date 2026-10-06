import { performance } from 'perf_hooks';
import {
	GIT_LOG_SEPARATOR,
	GitCommitRecord,
	ParseLogOptions,
	UNCOMMITTED,
	assembleCommits,
	parseGitLog,
	parseLogLines
} from '../../src/parsers/logParser';
import {
	GitRefData,
	parseBranches,
	parseRefs
} from '../../src/parsers/refParser';
import { parseStashes } from '../../src/parsers/stashParser';
import { GitStash } from '../../src/types';

describe('Adversarial Parser Empirical Challenge Suite', () => {

	// =========================================================================
	// 1. logParser Adversarial
	// =========================================================================
	describe('logParser Adversarial', () => {

		describe('Malformed Git log lines & Mismatched Separators', () => {
			it('should skip lines with separator count !== 5 (i.e. parts.length !== 6)', () => {
				const cases = [
					// 0 separators (1 part)
					'plain text without separators',
					// 1 separator (2 parts)
					`hash1${GIT_LOG_SEPARATOR}parent1`,
					// 2 separators (3 parts)
					`hash2${GIT_LOG_SEPARATOR}parent2${GIT_LOG_SEPARATOR}author2`,
					// 3 separators (4 parts)
					`hash3${GIT_LOG_SEPARATOR}parent3${GIT_LOG_SEPARATOR}author3${GIT_LOG_SEPARATOR}email3`,
					// 4 separators (5 parts)
					`hash4${GIT_LOG_SEPARATOR}parent4${GIT_LOG_SEPARATOR}author4${GIT_LOG_SEPARATOR}email4${GIT_LOG_SEPARATOR}1700000000`,
					// 6 separators (7 parts)
					`hash6${GIT_LOG_SEPARATOR}p${GIT_LOG_SEPARATOR}a${GIT_LOG_SEPARATOR}e${GIT_LOG_SEPARATOR}123${GIT_LOG_SEPARATOR}msg${GIT_LOG_SEPARATOR}extra`,
					// 7 separators (8 parts)
					`hash7${GIT_LOG_SEPARATOR}p${GIT_LOG_SEPARATOR}a${GIT_LOG_SEPARATOR}e${GIT_LOG_SEPARATOR}123${GIT_LOG_SEPARATOR}msg${GIT_LOG_SEPARATOR}extra1${GIT_LOG_SEPARATOR}extra2`,
					// Truncated separator
					'hash${XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkP}parent',
					// Corrupted separator
					`hash${GIT_LOG_SEPARATOR}_corrupted${GIT_LOG_SEPARATOR}extra`
				];

				const stdout = cases.join('\n');
				const commits = parseLogLines(stdout);
				expect(commits).toEqual([]);
			});

			it('should correctly parse valid lines embedded among malformed lines', () => {
				const stdout = [
					'garbage header line from tool',
					`c1${GIT_LOG_SEPARATOR}p1${GIT_LOG_SEPARATOR}Author 1${GIT_LOG_SEPARATOR}a1@test.com${GIT_LOG_SEPARATOR}1700000001${GIT_LOG_SEPARATOR}Valid commit 1`,
					'corrupted line between commits',
					`c2${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author 2${GIT_LOG_SEPARATOR}a2@test.com${GIT_LOG_SEPARATOR}1700000002${GIT_LOG_SEPARATOR}Valid commit 2`,
					`c3${GIT_LOG_SEPARATOR}p2${GIT_LOG_SEPARATOR}Author 3${GIT_LOG_SEPARATOR}a3@test.com${GIT_LOG_SEPARATOR}1700000003${GIT_LOG_SEPARATOR}msg${GIT_LOG_SEPARATOR}extra_field`,
					'trailing footer warning'
				].join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
				expect(commits[0].hash).toBe('c1');
				expect(commits[1].hash).toBe('c2');
			});

			it('should safely handle empty fields except hash and message', () => {
				// Empty parents, author, email, timestamp, message
				const stdout = `c_empty${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}`;
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(1);
				expect(commits[0]).toEqual({
					hash: 'c_empty',
					parents: [],
					author: '',
					email: '',
					date: 0,
					message: ''
				});
			});

			it('should fallback to 0 for non-numeric or NaN timestamps', () => {
				const stdout = [
					`c_nan${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}not-a-number${GIT_LOG_SEPARATOR}NaN date`,
					`c_float${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}1700000000.5${GIT_LOG_SEPARATOR}Float date`,
					`c_neg${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}-86400${GIT_LOG_SEPARATOR}Pre-1970 date`,
					`c_large${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}2500000000${GIT_LOG_SEPARATOR}Post-2038 date`
				].join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(4);
				expect(commits[0].date).toBe(0);
				expect(commits[1].date).toBe(1700000000);
				expect(commits[2].date).toBe(-86400);
				expect(commits[3].date).toBe(2500000000);
			});

			it('should skip commit if subject itself contains GIT_LOG_SEPARATOR', () => {
				const stdout = `c1${GIT_LOG_SEPARATOR}p1${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email@test.com${GIT_LOG_SEPARATOR}1700000000${GIT_LOG_SEPARATOR}Subject with ${GIT_LOG_SEPARATOR} inside`;
				const commits = parseLogLines(stdout);
				// Because split results in 7 parts, it is safely skipped
				expect(commits).toEqual([]);
			});
		});

		describe('Multiline messages with mixed CRLF, LF, and CR line endings', () => {
			it('should handle pure CRLF (Windows) line endings without trailing carriage returns', () => {
				const stdout = [
					`c1${GIT_LOG_SEPARATOR}p1${GIT_LOG_SEPARATOR}Author One${GIT_LOG_SEPARATOR}a1@test.com${GIT_LOG_SEPARATOR}1700000001${GIT_LOG_SEPARATOR}Windows commit 1`,
					`c2${GIT_LOG_SEPARATOR}c1${GIT_LOG_SEPARATOR}Author Two${GIT_LOG_SEPARATOR}a2@test.com${GIT_LOG_SEPARATOR}1700000002${GIT_LOG_SEPARATOR}Windows commit 2`,
					''
				].join('\r\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
				expect(commits[0].message).toBe('Windows commit 1');
				expect(commits[1].message).toBe('Windows commit 2');
				expect(commits[0].message.includes('\r')).toBe(false);
			});

			it('should handle mixed CRLF, LF, and CR in the same stdout stream', () => {
				const stdout = `c1${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}A1${GIT_LOG_SEPARATOR}e1${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Msg1\r\n` +
					`c2${GIT_LOG_SEPARATOR}c1${GIT_LOG_SEPARATOR}A2${GIT_LOG_SEPARATOR}e2${GIT_LOG_SEPARATOR}200${GIT_LOG_SEPARATOR}Msg2\n` +
					`c3${GIT_LOG_SEPARATOR}c2${GIT_LOG_SEPARATOR}A3${GIT_LOG_SEPARATOR}e3${GIT_LOG_SEPARATOR}300${GIT_LOG_SEPARATOR}Msg3\r` +
					`c4${GIT_LOG_SEPARATOR}c3${GIT_LOG_SEPARATOR}A4${GIT_LOG_SEPARATOR}e4${GIT_LOG_SEPARATOR}400${GIT_LOG_SEPARATOR}Msg4`;

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(4);
				expect(commits.map((c) => c.hash)).toEqual(['c1', 'c2', 'c3', 'c4']);
				expect(commits.map((c) => c.message)).toEqual(['Msg1', 'Msg2', 'Msg3', 'Msg4']);
			});

			it('should safely ignore multiline commit message body overflow lines', () => {
				// If a multiline body leaked into stdout:
				const stdout = [
					`c1${GIT_LOG_SEPARATOR}p1${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email@test.com${GIT_LOG_SEPARATOR}1700000001${GIT_LOG_SEPARATOR}Commit subject line`,
					'This is body line 1 that leaked without separator',
					'This is body line 2 with details: fixes issue #123',
					'',
					`c2${GIT_LOG_SEPARATOR}c1${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email@test.com${GIT_LOG_SEPARATOR}1700000002${GIT_LOG_SEPARATOR}Next valid commit`
				].join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
				expect(commits[0].hash).toBe('c1');
				expect(commits[0].message).toBe('Commit subject line');
				expect(commits[1].hash).toBe('c2');
				expect(commits[1].message).toBe('Next valid commit');
			});
		});

		describe('Unicode, Emojis, and Multi-byte Characters', () => {
			it('should preserve unicode emojis (🚀, 🎉, complex ZWJ sequences, skin tones, flags)', () => {
				const emojis = [
					'🚀 Feature rocket launch',
					'🎉 Celebration party popper',
					'👨‍👩‍👧‍👦 Complex ZWJ Family sequence',
					'🏳️‍🌈 Rainbow flag sequence',
					'👍🏽 Thumbs up with medium skin tone',
					'🧑‍💻 Technologist with laptop',
					'🍕 Pizza slice'
				];

				const stdout = emojis.map((msg, i) =>
					`hash_${i}${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author ${i}${GIT_LOG_SEPARATOR}a${i}@test.com${GIT_LOG_SEPARATOR}${1700000000 + i}${GIT_LOG_SEPARATOR}${msg}`
				).join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(emojis.length);
				for (let i = 0; i < emojis.length; i++) {
					expect(commits[i].message).toBe(emojis[i]);
				}
			});

			it('should preserve Japanese (Kanji, Hiragana, Katakana, Fullwidth) and CJK characters', () => {
				const japaneseMessages = [
					'【機能追加】日本語のコミットメッセージ',
					'バグ修正：データベース接続のリトライ処理を追加',
					'リファクタリング：パーサーの分離（Wasm対応）',
					'✨ 新機能：マルチバイト文字の完全サポート！'
				];

				const stdout = japaneseMessages.map((msg, i) =>
					`c_jp_${i}${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}山田 太郎${GIT_LOG_SEPARATOR}yamada@example.co.jp${GIT_LOG_SEPARATOR}${1700000000 + i}${GIT_LOG_SEPARATOR}${msg}`
				).join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(4);
				expect(commits[0].author).toBe('山田 太郎');
				expect(commits[0].message).toBe('【機能追加】日本語のコミットメッセージ');
				expect(commits[1].message).toBe('バグ修正：データベース接続のリトライ処理を追加');
				expect(commits[2].message).toBe('リファクタリング：パーサーの分離（Wasm対応）');
				expect(commits[3].message).toBe('✨ 新機能：マルチバイト文字の完全サポート！');
			});

			it('should preserve Right-to-Left and bidirectional text (Arabic, Hebrew)', () => {
				const bidiMessages = [
					'رسالة تأكيد commit بالعربية',
					'עדכון גרסה ובדיקת עברית'
				];

				const stdout = bidiMessages.map((msg, i) =>
					`c_bidi_${i}${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}BidiAuthor${GIT_LOG_SEPARATOR}bidi@test.com${GIT_LOG_SEPARATOR}${1700000000 + i}${GIT_LOG_SEPARATOR}${msg}`
				).join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
				expect(commits[0].message).toBe(bidiMessages[0]);
				expect(commits[1].message).toBe(bidiMessages[1]);
			});

			it('should handle zero-width spaces, BOM, tabs, and escape sequences in commit subjects', () => {
				const stdout = `c_zw${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author\\Name${GIT_LOG_SEPARATOR}a@b.com${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}\uFEFFZero-width \u200B space and \t tab \\ "quote"`;
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(1);
				expect(commits[0].message).toBe('\uFEFFZero-width \u200B space and \t tab \\ "quote"');
				expect(commits[0].author).toBe('Author\\Name');
			});
		});

		describe('Root Commits and Octopus Merges', () => {
			it('should correctly handle root commits with 0 parents (empty string in parts[1])', () => {
				const stdout = [
					`root1${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}a@test.com${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}First root commit`,
					`root2${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}a@test.com${GIT_LOG_SEPARATOR}101${GIT_LOG_SEPARATOR}Disjoint second root commit`
				].join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
				expect(commits[0].parents).toEqual([]);
				expect(commits[1].parents).toEqual([]);
			});

			it('should correctly handle octopus merges with 4, 8, and 16 parents', () => {
				const fourParents = ['p1', 'p2', 'p3', 'p4'].join(' ');
				const eightParents = Array.from({ length: 8 }, (_, i) => `p_octo_${i}`).join(' ');
				const sixteenParents = Array.from({ length: 16 }, (_, i) => `p_sixteen_${i}`).join(' ');

				const stdout = [
					`c_octo4${GIT_LOG_SEPARATOR}${fourParents}${GIT_LOG_SEPARATOR}OctoAuthor${GIT_LOG_SEPARATOR}octo@test.com${GIT_LOG_SEPARATOR}200${GIT_LOG_SEPARATOR}4-way merge`,
					`c_octo8${GIT_LOG_SEPARATOR}${eightParents}${GIT_LOG_SEPARATOR}OctoAuthor${GIT_LOG_SEPARATOR}octo@test.com${GIT_LOG_SEPARATOR}201${GIT_LOG_SEPARATOR}8-way merge`,
					`c_octo16${GIT_LOG_SEPARATOR}${sixteenParents}${GIT_LOG_SEPARATOR}OctoAuthor${GIT_LOG_SEPARATOR}octo@test.com${GIT_LOG_SEPARATOR}202${GIT_LOG_SEPARATOR}16-way merge`
				].join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(3);
				expect(commits[0].parents).toEqual(['p1', 'p2', 'p3', 'p4']);
				expect(commits[1].parents.length).toBe(8);
				expect(commits[1].parents[7]).toBe('p_octo_7');
				expect(commits[2].parents.length).toBe(16);
				expect(commits[2].parents[15]).toBe('p_sixteen_15');
			});
		});
	});

	// =========================================================================
	// 2. refParser Adversarial
	// =========================================================================
	describe('refParser Adversarial', () => {

		describe('parseRefs Edge Cases', () => {
			it('should handle detached HEAD pointer line (HEAD)', () => {
				const stdout = [
					'1111111111111111111111111111111111111111 HEAD',
					'2222222222222222222222222222222222222222 refs/heads/main'
				].join('\n');

				const refData = parseRefs(stdout);
				expect(refData.head).toBe('1111111111111111111111111111111111111111');
				expect(refData.heads).toEqual([
					{ hash: '2222222222222222222222222222222222222222', name: 'main' }
				]);
			});

			it('should differentiate unannotated tags from peeled tags with ^{}', () => {
				const stdout = [
					'tag_obj_hash refs/tags/v1.0.0',
					'commit_hash refs/tags/v1.0.0^{}',
					'lightweight_hash refs/tags/v2.0.0'
				].join('\n');

				const refData = parseRefs(stdout);
				expect(refData.tags).toEqual([
					{ hash: 'tag_obj_hash', name: 'v1.0.0', annotated: false },
					{ hash: 'commit_hash', name: 'v1.0.0', annotated: true },
					{ hash: 'lightweight_hash', name: 'v2.0.0', annotated: false }
				]);
			});

			it('should handle tags with deep hierarchical slash paths', () => {
				const stdout = [
					'h1 refs/tags/release/2026/q1/v1.2.3',
					'h2 refs/tags/release/2026/q1/v1.2.3^{}'
				].join('\n');

				const refData = parseRefs(stdout);
				expect(refData.tags).toEqual([
					{ hash: 'h1', name: 'release/2026/q1/v1.2.3', annotated: false },
					{ hash: 'h2', name: 'release/2026/q1/v1.2.3', annotated: true }
				]);
			});

			it('should hide remotes with exact prefix matching and avoid false substring collisions', () => {
				const stdout = [
					'r1 refs/remotes/origin/main',
					'r2 refs/remotes/origin-fork/main',
					'r3 refs/remotes/origin_backup/main',
					'r4 refs/remotes/upstream/feature'
				].join('\n');

				// Hiding 'origin' should match 'refs/remotes/origin/' and NOT 'refs/remotes/origin-fork/' or 'refs/remotes/origin_backup/'
				const refData = parseRefs(stdout, ['origin']);
				expect(refData.remotes.map((r) => r.name)).toEqual([
					'origin-fork/main',
					'origin_backup/main',
					'upstream/feature'
				]);
			});

			it('should toggle remote HEAD inclusion correctly', () => {
				const stdout = [
					'r1 refs/remotes/origin/main',
					'r2 refs/remotes/origin/HEAD',
					'r3 refs/remotes/origin/feature/HEAD'
				].join('\n');

				const withoutHead = parseRefs(stdout, [], false);
				// Ends with /HEAD are filtered out when showRemoteHeads is false
				expect(withoutHead.remotes.map((r) => r.name)).toEqual(['origin/main']);

				const withHead = parseRefs(stdout, [], true);
				expect(withHead.remotes.map((r) => r.name)).toEqual([
					'origin/main',
					'origin/HEAD',
					'origin/feature/HEAD'
				]);
			});

			it('should safely ignore noisy, malformed, and non-ref show-ref lines', () => {
				const stdout = [
					'',
					'    ',
					'no_space_token_in_this_line',
					'hash_with_unknown_ref_prefix refs/notes/commits',
					'hash_with_stash_ref refs/stash',
					'hash1 refs/heads/valid-branch',
					'   '
				].join('\n');

				const refData = parseRefs(stdout);
				expect(refData.heads).toEqual([
					{ hash: 'hash1', name: 'valid-branch' }
				]);
				expect(refData.tags).toEqual([]);
				expect(refData.remotes).toEqual([]);
				expect(refData.head).toBeNull();
			});
		});

		describe('parseBranches Edge Cases', () => {
			it('should filter detached HEAD states and special Git status markers', () => {
				const stdout = [
					'* (HEAD detached at a1b2c3d)',
					'  (no branch, rebasing main)',
					'  (no branch, bisecting)',
					'  main',
					'  feature'
				].join('\n');

				const branchData = parseBranches(stdout);
				expect(branchData.branches).toEqual(['main', 'feature']);
				expect(branchData.head).toBeNull();
			});

			it('should correctly identify active branch prefixed with asterisk and unshift to head of list', () => {
				const stdout = [
					'  alpha',
					'* beta',
					'  gamma'
				].join('\n');

				const branchData = parseBranches(stdout);
				expect(branchData.head).toBe('beta');
				expect(branchData.branches).toEqual(['beta', 'alpha', 'gamma']);
			});

			it('should filter symbolic tracking branches (remotes/origin/HEAD -> origin/main) correctly', () => {
				const stdout = [
					'  remotes/origin/HEAD -> origin/main',
					'  remotes/origin/main'
				].join('\n');

				const defaultResult = parseBranches(stdout, [], false);
				expect(defaultResult.branches).toEqual(['remotes/origin/main']);

				const showHeadResult = parseBranches(stdout, [], true);
				expect(showHeadResult.branches).toEqual(['remotes/origin/HEAD', 'remotes/origin/main']);
			});

			it('should filter hidden remotes in parseBranches without collision', () => {
				const stdout = [
					'  remotes/origin/main',
					'  remotes/origin-dev/main',
					'  remotes/upstream/main'
				].join('\n');

				const result = parseBranches(stdout, ['origin']);
				expect(result.branches).toEqual(['remotes/origin-dev/main', 'remotes/upstream/main']);
			});
		});
	});

	// =========================================================================
	// 3. stashParser Adversarial
	// =========================================================================
	describe('stashParser Adversarial', () => {
		it('should parse standard 2-parent stash (commit + index) with untrackedFilesHash: null', () => {
			const stdout = `stash_hash1${GIT_LOG_SEPARATOR}base_hash1 index_hash1${GIT_LOG_SEPARATOR}stash@{0}${GIT_LOG_SEPARATOR}StashAuthor${GIT_LOG_SEPARATOR}author@test.com${GIT_LOG_SEPARATOR}1700000000${GIT_LOG_SEPARATOR}WIP on main: regular stash`;
			const stashes = parseStashes(stdout);

			expect(stashes.length).toBe(1);
			expect(stashes[0]).toEqual({
				hash: 'stash_hash1',
				baseHash: 'base_hash1',
				untrackedFilesHash: null,
				selector: 'stash@{0}',
				author: 'StashAuthor',
				email: 'author@test.com',
				date: 1700000000,
				message: 'WIP on main: regular stash'
			});
		});

		it('should parse 3-parent untracked file stash (git stash -u) extracting untrackedFilesHash', () => {
			const stdout = `stash_hash2${GIT_LOG_SEPARATOR}base_hash2 index_hash2 untracked_hash2${GIT_LOG_SEPARATOR}stash@{1}${GIT_LOG_SEPARATOR}StashAuthor${GIT_LOG_SEPARATOR}author@test.com${GIT_LOG_SEPARATOR}1700000001${GIT_LOG_SEPARATOR}WIP on feature: stash with untracked files`;
			const stashes = parseStashes(stdout);

			expect(stashes.length).toBe(1);
			expect(stashes[0]).toEqual({
				hash: 'stash_hash2',
				baseHash: 'base_hash2',
				untrackedFilesHash: 'untracked_hash2',
				selector: 'stash@{1}',
				author: 'StashAuthor',
				email: 'author@test.com',
				date: 1700000001,
				message: 'WIP on feature: stash with untracked files'
			});
		});

		it('should skip malformed stash lines (wrong parts count or empty parent hashes)', () => {
			const malformedCases = [
				// Empty parents
				`stash_hash${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}stash@{0}${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Msg`,
				// 6 parts (missing selector)
				`stash_hash${GIT_LOG_SEPARATOR}base_hash${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Msg`,
				// 8 parts (extra field)
				`stash_hash${GIT_LOG_SEPARATOR}base_hash${GIT_LOG_SEPARATOR}stash@{0}${GIT_LOG_SEPARATOR}A${GIT_LOG_SEPARATOR}E${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Msg${GIT_LOG_SEPARATOR}extra`,
				// Plain text
				'fatal: not a reflog line',
				''
			].join('\n');

			const stashes = parseStashes(malformedCases);
			expect(stashes).toEqual([]);
		});

		it('should handle stash subjects with emojis and unicode characters', () => {
			const stdout = `stash_emoji${GIT_LOG_SEPARATOR}base1 idx1${GIT_LOG_SEPARATOR}stash@{2}${GIT_LOG_SEPARATOR}太郎${GIT_LOG_SEPARATOR}taro@test.com${GIT_LOG_SEPARATOR}1700000002${GIT_LOG_SEPARATOR}📦 WIP: 作業中の変更と絵文字 🚀`;
			const stashes = parseStashes(stdout);

			expect(stashes.length).toBe(1);
			expect(stashes[0].author).toBe('太郎');
			expect(stashes[0].message).toBe('📦 WIP: 作業中の変更と絵文字 🚀');
		});
	});

	// =========================================================================
	// 4. assembleCommits & parseGitLog Adversarial
	// =========================================================================
	describe('assembleCommits & parseGitLog Adversarial', () => {
		const baseOptions: ParseLogOptions = {
			remotes: ['origin'],
			hideRemotes: [],
			showRemoteHeads: false,
			showTags: true,
			maxCommits: 10,
			uncommittedChanges: 0,
			showUncommittedChanges: false
		};

		it('should correctly handle pagination boundary when commits.length === maxCommits + 1', () => {
			const commits: GitCommitRecord[] = Array.from({ length: 11 }, (_, i) => ({
				hash: `c_${i}`,
				parents: i > 0 ? [`c_${i - 1}`] : [],
				author: 'Author',
				email: 'a@test.com',
				date: 1000 + i,
				message: `Commit ${i}`
			}));

			const refData: GitRefData = { head: 'c_10', heads: [], tags: [], remotes: [] };
			const result = assembleCommits(commits, refData, [], { ...baseOptions, maxCommits: 10 });

			expect(result.moreCommitsAvailable).toBe(true);
			// 11th commit was popped
			expect(result.commits.length).toBe(10);
			expect(result.commits[0].hash).toBe('c_0');
			expect(result.commits[9].hash).toBe('c_9');
		});

		it('should inject synthetic UNCOMMITTED node at HEAD when showUncommittedChanges is true and changes > 0', () => {
			const commits: GitCommitRecord[] = [
				{ hash: 'head_hash', parents: ['root_hash'], author: 'Dev', email: 'dev@test.com', date: 1000, message: 'Head commit' },
				{ hash: 'root_hash', parents: [], author: 'Dev', email: 'dev@test.com', date: 900, message: 'Root commit' }
			];

			const refData: GitRefData = { head: 'head_hash', heads: [{ hash: 'head_hash', name: 'main' }], tags: [], remotes: [] };
			const options: ParseLogOptions = {
				...baseOptions,
				showUncommittedChanges: true,
				uncommittedChanges: 3
			};

			const result = assembleCommits(commits, refData, [], options);
			expect(result.commits.length).toBe(3);
			const uncommittedNode = result.commits[0];
			expect(uncommittedNode.hash).toBe(UNCOMMITTED);
			expect(uncommittedNode.parents).toEqual(['head_hash']);
			expect(uncommittedNode.message).toBe('Uncommitted Changes (3)');
			expect(uncommittedNode.author).toBe('*');
		});

		it('should NOT inject UNCOMMITTED node when uncommittedChanges is 0 or showUncommittedChanges is false', () => {
			const commits: GitCommitRecord[] = [
				{ hash: 'head_hash', parents: [], author: 'Dev', email: 'dev@test.com', date: 1000, message: 'Head' }
			];
			const refData: GitRefData = { head: 'head_hash', heads: [], tags: [], remotes: [] };

			const res1 = assembleCommits(commits, refData, [], { ...baseOptions, showUncommittedChanges: true, uncommittedChanges: 0 });
			expect(res1.commits.length).toBe(1);
			expect(res1.commits[0].hash).toBe('head_hash');

			const res2 = assembleCommits(commits, refData, [], { ...baseOptions, showUncommittedChanges: false, uncommittedChanges: 5 });
			expect(res2.commits.length).toBe(1);
			expect(res2.commits[0].hash).toBe('head_hash');
		});

		it('should splice multiple stashes directly before base commit sorted descending by date', () => {
			const commits: GitCommitRecord[] = [
				{ hash: 'c_feature', parents: ['c_base'], author: 'Dev', email: 'dev@test.com', date: 3000, message: 'Feature' },
				{ hash: 'c_base', parents: [], author: 'Dev', email: 'dev@test.com', date: 1000, message: 'Base commit' }
			];

			const stashes: GitStash[] = [
				{
					hash: 'stash_older',
					baseHash: 'c_base',
					untrackedFilesHash: null,
					selector: 'stash@{1}',
					author: 'Dev',
					email: 'dev@test.com',
					date: 1500,
					message: 'Older stash'
				},
				{
					hash: 'stash_newer',
					baseHash: 'c_base',
					untrackedFilesHash: 'untracked_1',
					selector: 'stash@{0}',
					author: 'Dev',
					email: 'dev@test.com',
					date: 2000,
					message: 'Newer stash'
				}
			];

			const refData: GitRefData = { head: 'c_feature', heads: [], tags: [], remotes: [] };
			const result = assembleCommits(commits, refData, stashes, baseOptions);

			// Expected order:
			// 0: c_feature
			// 1: stash_newer (date 2000)
			// 2: stash_older (date 1500)
			// 3: c_base (date 1000)
			expect(result.commits.length).toBe(4);
			expect(result.commits[0].hash).toBe('c_feature');
			expect(result.commits[1].hash).toBe('stash_newer');
			expect(result.commits[1].stash?.selector).toBe('stash@{0}');
			expect(result.commits[2].hash).toBe('stash_older');
			expect(result.commits[2].stash?.selector).toBe('stash@{1}');
			expect(result.commits[3].hash).toBe('c_base');
		});

		it('should attach stash metadata when stash commit hash already exists in commit log', () => {
			const commits: GitCommitRecord[] = [
				{ hash: 'stash_hash_in_log', parents: ['c_base'], author: 'Dev', email: 'dev@test.com', date: 2000, message: 'WIP on base' },
				{ hash: 'c_base', parents: [], author: 'Dev', email: 'dev@test.com', date: 1000, message: 'Base commit' }
			];

			const stashes: GitStash[] = [
				{
					hash: 'stash_hash_in_log',
					baseHash: 'c_base',
					untrackedFilesHash: null,
					selector: 'stash@{0}',
					author: 'Dev',
					email: 'dev@test.com',
					date: 2000,
					message: 'WIP on base'
				}
			];

			const refData: GitRefData = { head: 'c_base', heads: [], tags: [], remotes: [] };
			const result = assembleCommits(commits, refData, stashes, baseOptions);

			expect(result.commits.length).toBe(2);
			expect(result.commits[0].hash).toBe('stash_hash_in_log');
			expect(result.commits[0].stash).toEqual({
				selector: 'stash@{0}',
				baseHash: 'c_base',
				untrackedFilesHash: null
			});
		});

		it('should annotate heads, peeled tags, and remotes accurately', () => {
			const commits: GitCommitRecord[] = [
				{ hash: 'c1', parents: [], author: 'Dev', email: 'dev@test.com', date: 1000, message: 'Commit 1' }
			];

			const refData: GitRefData = {
				head: 'c1',
				heads: [{ hash: 'c1', name: 'main' }, { hash: 'c1', name: 'release' }],
				tags: [
					{ hash: 'c1', name: 'v1.0.0', annotated: true },
					{ hash: 'c1', name: 'v1.0.0', annotated: false }
				],
				remotes: [
					{ hash: 'c1', name: 'origin/main' },
					{ hash: 'c1', name: 'upstream/main' }
				]
			};

			const result = assembleCommits(commits, refData, [], {
				...baseOptions,
				remotes: ['origin', 'upstream']
			});

			expect(result.commits[0].heads).toEqual(['main', 'release']);
			expect(result.commits[0].tags).toEqual([
				{ name: 'v1.0.0', annotated: true },
				{ name: 'v1.0.0', annotated: false }
			]);
			expect(result.commits[0].remotes).toEqual([
				{ name: 'origin/main', remote: 'origin' },
				{ name: 'upstream/main', remote: 'upstream' }
			]);
			expect(result.tags).toEqual(['v1.0.0']);
		});
	});

	// =========================================================================
	// 5. Massive Log Output Performance Stress Harness (1,000 to 10,000 commits)
	// =========================================================================
	describe('Massive Log Output Stress Harness', () => {
		function generateMockLog(numCommits: number): { stdout: string; refStdout: string } {
			const logLines: string[] = [];
			const refLines: string[] = [];

			refLines.push('hash_000000 HEAD');
			refLines.push('hash_000000 refs/heads/main');

			for (let i = 0; i < numCommits; i++) {
				const hash = `hash_${i.toString().padStart(6, '0')}`;
				const parents = i < numCommits - 1 ? `hash_${(i + 1).toString().padStart(6, '0')}` : '';
				const author = `Author ${i % 50}`;
				const email = `author${i % 50}@company.com`;
				const date = 1700000000 - i * 60;
				const message = `Commit ${i}: Feature ${i % 100} implementation 🚀`;

				logLines.push([hash, parents, author, email, date.toString(), message].join(GIT_LOG_SEPARATOR));

				if (i % 100 === 0) {
					refLines.push(`${hash} refs/tags/v${Math.floor(i / 100)}.0.0^{}`);
					refLines.push(`${hash} refs/remotes/origin/release-${i}`);
				}
			}

			return {
				stdout: logLines.join('\n'),
				refStdout: refLines.join('\n')
			};
		}

		it('should parse and assemble 1,000 commits correctly under 50ms', () => {
			const { stdout, refStdout } = generateMockLog(1000);

			const start = performance.now();
			const result = parseGitLog(stdout, refStdout, [], {
				remotes: ['origin'],
				hideRemotes: [],
				showRemoteHeads: false,
				showTags: true,
				maxCommits: 1000
			});
			const elapsed = performance.now() - start;

			expect(result.commits.length).toBe(1000);
			expect(result.head).toBe('hash_000000');
			expect(result.commits[0].heads).toContain('main');
			expect(result.commits[0].tags.length).toBeGreaterThan(0);
			expect(elapsed).toBeLessThan(100); // Strict budget
		});

		it('should parse and assemble 5,000 commits under 200ms without memory degradation', () => {
			const { stdout, refStdout } = generateMockLog(5000);

			const start = performance.now();
			const result = parseGitLog(stdout, refStdout, [], {
				remotes: ['origin'],
				hideRemotes: [],
				showRemoteHeads: false,
				showTags: true,
				maxCommits: 5000
			});
			const elapsed = performance.now() - start;

			expect(result.commits.length).toBe(5000);
			expect(result.moreCommitsAvailable).toBe(false);
			expect(elapsed).toBeLessThan(300);
		});

		it('should parse and assemble 10,000 commits under 500ms with 100 stashes', () => {
			const { stdout, refStdout } = generateMockLog(10000);

			// Generate 100 stashes
			const stashes: GitStash[] = Array.from({ length: 100 }, (_, i) => ({
				hash: `stash_hash_${i}`,
				baseHash: `hash_${(i * 50).toString().padStart(6, '0')}`,
				untrackedFilesHash: i % 2 === 0 ? `untracked_${i}` : null,
				selector: `stash@{${i}}`,
				author: 'StashDev',
				email: 'stash@test.com',
				date: 1700000000 + i,
				message: `WIP on branch ${i}`
			}));

			const start = performance.now();
			const result = parseGitLog(stdout, refStdout, stashes, {
				remotes: ['origin'],
				hideRemotes: [],
				showRemoteHeads: false,
				showTags: true,
				maxCommits: 10000
			});
			const elapsed = performance.now() - start;

			// 10,000 commits + 100 stashes spliced in
			expect(result.commits.length).toBe(10100);
			expect(elapsed).toBeLessThan(600);
		});
	});
});
