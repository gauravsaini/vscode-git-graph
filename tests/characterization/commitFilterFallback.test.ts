import { GitCommit } from '../../src/types';
import { FindWidgetHarness, createFindWidgetHarness, createSampleCommit } from './fixtures/webHarness';

const UNCOMMITTED = '*';

describe('FindWidget Fallback Commit Filter Characterization Suite', () => {
	const commitLinear1 = createSampleCommit({
		hash: '1111111122222222333333334444444455555555',
		author: 'Alice Smith',
		email: 'alice@company.org',
		date: 1767225600, // 2026-01-01
		message: 'feat(auth): implement oauth2 token flow\n\nSupport for refresh tokens included.',
		heads: ['main'],
		tags: [{ name: 'v1.0.0', annotated: true }],
		remotes: [{ name: 'origin/main', remote: 'origin' }],
		stash: null
	});

	const commitLinear2 = createSampleCommit({
		hash: '2222222233333333444444445555555566666666',
		author: 'Bob Jones',
		email: 'bob@contractor.net',
		date: 1767312000, // 2026-01-02
		message: 'fix(core): resolve null pointer in user session\n\nFixes ticket #404.',
		heads: ['feature/session'],
		tags: [],
		remotes: [{ name: 'origin/feature/session', remote: 'origin' }],
		stash: null
	});

	const commitMerge = createSampleCommit({
		hash: '3333333344444444555555556666666677777777',
		parents: [commitLinear1.hash, commitLinear2.hash],
		author: 'Charlie Brown',
		email: 'charlie@open-source.org',
		date: 1767398400, // 2026-01-03
		message: 'Merge branch feature/session into main\n\nReviewed-by: Alice',
		heads: ['develop'],
		tags: [{ name: 'v1.1.0-rc1', annotated: false }],
		remotes: [
			{ name: 'upstream/develop', remote: 'upstream' },
			{ name: 'backup/develop', remote: 'backup' },
			{ name: 'upstream/jira-404-ref', remote: 'upstream' }
		],
		stash: null
	});

	const commitStash = createSampleCommit({
		hash: '4444444455555555666666667777777788888888',
		author: 'Alice Smith',
		email: 'alice@company.org',
		date: 1767484800, // 2026-01-04
		message: 'WIP on experiment\n\nsaved uncommitted changes',
		heads: [],
		tags: [],
		remotes: [],
		stash: {
			selector: 'stash@{0}',
			baseHash: commitMerge.hash,
			untrackedFilesHash: null
		}
	});

	const commitSpecialChars = createSampleCommit({
		hash: '5555555566666666777777778888888899999999',
		author: 'Dana Developer (QA)',
		email: 'dana@company.org',
		date: 1767571200, // 2026-01-05
		message: 'docs(api): update [v1.0] path /api/v1/{id}?query=test*+1 (critical)',
		heads: ['release/2.0'],
		tags: [{ name: 'release-2.0', annotated: true }],
		remotes: [],
		stash: null
	});

	const commitUncommitted = createSampleCommit({
		hash: UNCOMMITTED,
		author: '*',
		email: '',
		date: 1767657600,
		message: 'Uncommitted Changes (2 files modified)',
		heads: [],
		tags: [],
		remotes: [],
		stash: null
	});

	const allTestCommits: GitCommit[] = [
		commitLinear1,
		commitLinear2,
		commitMerge,
		commitStash,
		commitSpecialChars,
		commitUncommitted
	];

	let harness: FindWidgetHarness;

	beforeEach(() => {
		harness = createFindWidgetHarness({
			commits: allTestCommits,
			columnVisibility: { author: true, commit: true, date: true },
			isRegex: false,
			isCaseSensitive: false
		});
	});

	describe('1. Plain Text Search Mode (findIsRegex = false)', () => {
		it('should match commit messages by substring case-insensitively', () => {
			const res = harness.search('oauth2');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([commitLinear1.hash]);
		});

		it('should match multiple commits containing the same term', () => {
			const res = harness.search('session');
			expect(res.error).toBeNull();
			// Matches commitLinear2 ("user session") and commitMerge ("feature/session")
			expect(res.matches).toEqual([commitLinear2.hash, commitMerge.hash]);
		});

		it('should escape regex metacharacters in plain text mode', () => {
			// Query with brackets, parens, asterisk, plus, question mark, braces, slash
			const res = harness.search('[v1.0] path /api/v1/{id}?query=test*+1 (critical)');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([commitSpecialChars.hash]);
		});

		it('should return empty matches when query does not match any commit', () => {
			const res = harness.search('nonexistent-term-xyz-987');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([]);
		});

		it('should clear matches and remove error attribute on empty query', () => {
			harness.search('oauth2');
			expect(harness.getMatches().length).toBe(1);

			const res = harness.search('');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([]);
		});
	});

	describe('2. Regex Search Mode (findIsRegex = true)', () => {
		beforeEach(() => {
			harness.setRegexMode(true);
		});

		it('should match commit messages using regex anchors and patterns', () => {
			const res = harness.search('^feat\\(auth\\):');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([commitLinear1.hash]);
		});

		it('should match multiple commits using alternation', () => {
			const res = harness.search('(oauth2|null pointer)');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([commitLinear1.hash, commitLinear2.hash]);
		});

		it('should handle character classes and digit matching', () => {
			const res = harness.search('#404\\.');
			expect(res.error).toBeNull();
			expect(res.matches).toEqual([commitLinear2.hash]);
		});

		it('should capture syntax errors and set data-error attribute on invalid regex', () => {
			const resUnclosedBracket = harness.search('[unclosed-bracket');
			expect(resUnclosedBracket.error).not.toBeNull();
			expect(resUnclosedBracket.matches).toEqual([]);

			const resDanglingQuantifier = harness.search('*dangling-quantifier');
			expect(resDanglingQuantifier.error).not.toBeNull();
			expect(resDanglingQuantifier.matches).toEqual([]);

			const resUnclosedParen = harness.search('(unclosed-paren');
			expect(resUnclosedParen.error).not.toBeNull();
			expect(resUnclosedParen.matches).toEqual([]);
		});

		it('should clear data-error attribute when subsequent search is valid', () => {
			harness.search('[invalid');
			expect(harness.getError()).not.toBeNull();

			const resValid = harness.search('oauth2');
			expect(resValid.error).toBeNull();
			expect(resValid.matches).toEqual([commitLinear1.hash]);
		});
	});

	describe('3. Case Sensitivity Gating', () => {
		it('should match case-insensitively when findIsCaseSensitive is false', () => {
			harness.setCaseSensitive(false);

			expect(harness.search('alice smith').matches).toEqual([commitLinear1.hash, commitStash.hash]);
			expect(harness.search('ALICE SMITH').matches).toEqual([commitLinear1.hash, commitStash.hash]);
			expect(harness.search('Alice Smith').matches).toEqual([commitLinear1.hash, commitStash.hash]);
		});

		it('should strictly match case when findIsCaseSensitive is true', () => {
			harness.setCaseSensitive(true);

			expect(harness.search('Alice Smith').matches).toEqual([commitLinear1.hash, commitStash.hash]);
			expect(harness.search('alice smith').matches).toEqual([]);
			expect(harness.search('ALICE SMITH').matches).toEqual([]);
		});

		it('should respect case sensitivity in regex mode', () => {
			harness.setRegexMode(true);
			harness.setCaseSensitive(true);

			expect(harness.search('^Merge').matches).toEqual([commitMerge.hash]);
			expect(harness.search('^merge').matches).toEqual([]);

			harness.setCaseSensitive(false);
			expect(harness.search('^merge').matches).toEqual([commitMerge.hash]);
		});
	});

	describe('4. Multi-Column Matching & Column Visibility Gating', () => {
		describe('Author Column Gating', () => {
			it('should match by author name when colVisibility.author is true', () => {
				harness.setColumnVisibility({ author: true });
				const res = harness.search('Bob Jones');
				expect(res.matches).toEqual([commitLinear2.hash]);
			});

			it('should NOT match by author name when colVisibility.author is false', () => {
				harness.setColumnVisibility({ author: false });
				const res = harness.search('Bob Jones');
				// Bob Jones only exists in author field, message is "fix(core): resolve null pointer..."
				expect(res.matches).toEqual([]);
			});

			it('should match by author when colVisibility.author is re-enabled', () => {
				harness.setColumnVisibility({ author: false });
				expect(harness.search('Charlie Brown').matches).toEqual([]);

				harness.setColumnVisibility({ author: true });
				expect(harness.search('Charlie Brown').matches).toEqual([commitMerge.hash]);
			});
		});

		describe('Commit Hash Column Gating', () => {
			it('should match commit hash prefix from index 0 when colVisibility.commit is true', () => {
				harness.setColumnVisibility({ commit: true });
				// First commit hash starts with '111111112222'
				const res = harness.search('111111112222');
				expect(res.matches).toEqual([commitLinear1.hash]);
			});

			it('should match commit 8-character abbreviated hash anywhere when colVisibility.commit is true', () => {
				harness.setColumnVisibility({ commit: true });
				// commitLinear2 hash starts with '22222222', abbrev is '22222222'
				const res = harness.search('22222222');
				expect(res.matches).toEqual([commitLinear2.hash]);
			});

			it('should NOT match non-prefix hash substring beyond 8 characters', () => {
				harness.setColumnVisibility({ commit: true });
				// '99999999' appears only at index 32 of commitSpecialChars ('...99999999'), not index 0 and not in abbrev '55555555'
				const endOfHashRes = harness.search('99999999');
				expect(endOfHashRes.matches).toEqual([]);
			});

			it('should NOT match commit hash when colVisibility.commit is false', () => {
				harness.setColumnVisibility({ commit: false });
				const res = harness.search('11111111');
				expect(res.matches).toEqual([]);
			});
		});

		describe('Date Column Gating', () => {
			it('should match formatted date string when colVisibility.date is true', () => {
				harness.setColumnVisibility({ date: true });
				// Date format in test harness is ISO '2026-01-01' for commitLinear1
				const res = harness.search('2026-01-01');
				expect(res.matches).toEqual([commitLinear1.hash]);
			});

			it('should NOT match formatted date string when colVisibility.date is false', () => {
				harness.setColumnVisibility({ date: false });
				const res = harness.search('2026-01-01');
				expect(res.matches).toEqual([]);
			});
		});

		describe('Message Matching Independence', () => {
			it('should always match message even if all other columns are hidden', () => {
				harness.setColumnVisibility({ author: false, commit: false, date: false });
				const res = harness.search('oauth2 token flow');
				expect(res.matches).toEqual([commitLinear1.hash]);
			});
		});
	});

	describe('5. Branch Label, Tag, and Stash Matching', () => {
		it('should match commits by local branch head name', () => {
			const res = harness.search('feature/session');
			// commitLinear2 has head 'feature/session'
			// commitMerge has message mentioning 'feature/session'
			expect(res.matches).toContain(commitLinear2.hash);
			expect(res.matches).toContain(commitMerge.hash);
		});

		it('should match commits by remote tracking branch combined with local head', () => {
			// commitLinear1 has head 'main' combined with remote 'origin'
			const res = harness.search('origin');
			// commitLinear1 has remote 'origin', commitLinear2 has remote 'origin'
			expect(res.matches).toContain(commitLinear1.hash);
			expect(res.matches).toContain(commitLinear2.hash);
		});

		it('should match commits by separate remote tracking branch name', () => {
			// commitMerge has remote 'upstream/jira-404-ref' with no matching local head
			const res = harness.search('upstream/jira-404-ref');
			expect(res.matches).toEqual([commitMerge.hash]);
		});

		it('should match commits by tag name', () => {
			const resTag1 = harness.search('v1.0.0');
			expect(resTag1.matches).toEqual([commitLinear1.hash]);

			const resTagRc = harness.search('v1.1.0-rc1');
			expect(resTagRc.matches).toEqual([commitMerge.hash]);
		});

		it('should match commits by stash selector', () => {
			const res = harness.search('stash@{0}');
			expect(res.matches).toEqual([commitStash.hash]);
		});

		it('should not match stash selector on non-stash commits', () => {
			const res = harness.search('stash@{1}');
			expect(res.matches).toEqual([]);
		});
	});

	describe('6. Uncommitted Changes Node Exclusion', () => {
		it('should NEVER include UNCOMMITTED node in find matches even if query matches', () => {
			// commitUncommitted has unique message 'Uncommitted Changes (2 files modified)'
			const res = harness.search('2 files modified');
			expect(res.matches).toEqual([]);

			// Even wildcard in regex mode does not match UNCOMMITTED node
			harness.setRegexMode(true);
			const resRegex = harness.search('files modified');
			expect(resRegex.matches).toEqual([]);
		});
	});

	describe('7. Zero-Length Regex Rejection', () => {
		beforeEach(() => {
			harness.setRegexMode(true);
		});

		it('should reject pattern "^" that produces zero-length matches', () => {
			const res = harness.search('^');
			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');
			expect(res.matches).toEqual([]);
		});

		it('should reject pattern ".*" that produces zero-length matches', () => {
			const res = harness.search('.*');
			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');
			expect(res.matches).toEqual([]);
		});

		it('should reject pattern "a*" that matches zero length on non-a characters', () => {
			const res = harness.search('a*');
			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');
			expect(res.matches).toEqual([]);
		});

		it('should reject pattern "$" that produces zero-length match at end of text', () => {
			const res = harness.search('$');
			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');
			expect(res.matches).toEqual([]);
		});

		it('should reject lookahead pattern "(?=feat)" that matches zero length position', () => {
			const res = harness.search('(?=feat)');
			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');
			expect(res.matches).toEqual([]);
		});
	});

	describe('8. Navigation, Positioning, and GoTo Hash', () => {
		it('should set current match position to 0 by default when matches exist', () => {
			harness.findMatches('session');
			expect(harness.widget.getCurrentHash()).toBe(commitLinear2.hash);
		});

		it('should position to goToCommitHash if specified and present in matches', () => {
			harness.findMatches('session', commitMerge.hash);
			expect(harness.widget.getCurrentHash()).toBe(commitMerge.hash);
		});

		it('should navigate through matches using next() and prev() methods', () => {
			harness.findMatches('session');
			expect(harness.widget.getCurrentHash()).toBe(commitLinear2.hash);

			harness.widget.next();
			expect(harness.widget.getCurrentHash()).toBe(commitMerge.hash);

			// Wrap around back to first match
			harness.widget.next();
			expect(harness.widget.getCurrentHash()).toBe(commitLinear2.hash);

			// Wrap around to last match using prev()
			harness.widget.prev();
			expect(harness.widget.getCurrentHash()).toBe(commitMerge.hash);
		});

		it('should return null currentHash when no matches exist', () => {
			harness.findMatches('nonexistent');
			expect(harness.widget.getCurrentHash()).toBeNull();
		});
	});

	describe('9. Adversarial Unicode & Boundary Tests', () => {
		const emojiCommit = createSampleCommit({
			hash: '6666666677777777888888889999999900000000',
			author: 'Taro Yamada (山田太郎)',
			message: 'feat(ui): 🚀 add dark mode & 🎨 color palette',
			heads: ['feature/🎨-theme'],
			tags: [{ name: 'v2.0-🌟', annotated: true }]
		});

		let unicodeHarness: FindWidgetHarness;

		beforeEach(() => {
			unicodeHarness = createFindWidgetHarness({
				commits: [...allTestCommits, emojiCommit],
				columnVisibility: { author: true, commit: true, date: true },
				isRegex: false,
				isCaseSensitive: false
			});
		});

		it('should match emoji characters in commit message and tags', () => {
			expect(unicodeHarness.search('🚀').matches).toEqual([emojiCommit.hash]);
			expect(unicodeHarness.search('🎨 color').matches).toEqual([emojiCommit.hash]);
			expect(unicodeHarness.search('v2.0-🌟').matches).toEqual([emojiCommit.hash]);
		});

		it('should match CJK characters in author name', () => {
			expect(unicodeHarness.search('山田太郎').matches).toEqual([emojiCommit.hash]);
		});

		it('should handle regex with unicode property escapes in regex mode', () => {
			unicodeHarness.setRegexMode(true);
			const res = unicodeHarness.search('\\p{Extended_Pictographic}+');
			expect(res.error).toBeNull();
			expect(res.matches).toContain(emojiCommit.hash);
		});
	});
});
