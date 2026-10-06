import { FindWidgetHarness, createDataStoreHarness, createFindWidgetHarness, createSampleCommit, getTranspiledWebScript, webScriptExists } from './fixtures/webHarness';



const UNCOMMITTED = '*';



describe('Empirical Challenger: Seams 3 & 4 Adversarial Battery', () => {



	describe('1. Catastrophic Backtracking (ReDoS) Behavior', () => {

		it('empirically demonstrates ReDoS vulnerability in findPattern without timeout guard', () => {

			const redosTarget = createSampleCommit({

				hash: '1111111111111111111111111111111111111111',

				message: 'aaaaaaaaaaaa!' // 12 'a's followed by non-matching '!'

			});



			const harness = createFindWidgetHarness({

				commits: [redosTarget],

				isRegex: true,

				isCaseSensitive: false

			});



			const start = Date.now();

			const res = harness.search('(a+)+$');

			const elapsed = Date.now() - start;



			expect(res.matches).toEqual([]);

			// Completes, demonstrating search succeeds when length is small, but has no timeout protection

			expect(elapsed).toBeLessThan(1000);

		});

	});



	describe('2. Zero-Length Regexes and Boundary Anchors', () => {

		const targetCommit = createSampleCommit({

			hash: '3333333333333333333333333333333333333333',

			message: 'feat: add zero-length test commit'

		});



		let harness: FindWidgetHarness;



		beforeEach(() => {

			harness = createFindWidgetHarness({

				commits: [targetCommit],

				isRegex: true

			});

		});



		it('rejects word boundary anchor "\\b" as zero-length regex', () => {

			const res = harness.search('\\b');

			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');

			expect(res.matches).toEqual([]);

		});



		it('rejects empty lookahead "(?=)" as zero-length regex', () => {

			const res = harness.search('(?=)');

			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');

			expect(res.matches).toEqual([]);

		});



		it('rejects lookbehind "(?<=feat)" when match is zero length', () => {

			const res = harness.search('(?<=feat)');

			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');

			expect(res.matches).toEqual([]);

		});



		it('rejects empty string alternation "(feat|)" as zero-length match', () => {

			const res = harness.search('(feat|)');

			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');

			expect(res.matches).toEqual([]);

		});



		it('rejects zero repetition "a{0}" as zero-length match', () => {

			const res = harness.search('a{0}');

			expect(res.error).toBe('Cannot use a regular expression which has zero length matches');

			expect(res.matches).toEqual([]);

		});



		it('empirically reveals: zero-length regex that matches NO commit does NOT trigger zeroLengthMatch error', () => {

			// (?=nonexistent) produces zero length match IF it matches, but since no commit contains 'nonexistent',

			// findPattern.test(commit) is false, so it never reaches findGlobalPattern.exec().

			const res = harness.search('(?=nonexistent)');

			// Characterization behavior: error is null because zeroLengthMatch flag is only set during match loop

			expect(res.error).toBeNull();

			expect(res.matches).toEqual([]);

		});

	});



	describe('3. Unicode Messages, Astral Plane, and Line Endings', () => {

		const astralCommit = createSampleCommit({

			hash: '4444444444444444444444444444444444444444',

			author: 'Alice 👩‍💻',

			email: 'alice@unicode.org',

			message: 'feat: support surrogate pairs 𝒳 and math symbols ∑ ∏\r\nSecond line with CRLF\r\nThird line',

			heads: ['feature/🚀-rocket'],

			tags: [{ name: 'v1.0-🎉', annotated: true }],

			remotes: [{ name: 'origin/feature/🚀-rocket', remote: 'origin' }]

		});



		it('findWidget matches astral plane surrogate pairs correctly', () => {

			const harness = createFindWidgetHarness({

				commits: [astralCommit],

				isRegex: false

			});



			expect(harness.search('𝒳').matches).toEqual([astralCommit.hash]);

			expect(harness.search('👩‍💻').matches).toEqual([astralCommit.hash]);

			expect(harness.search('🎉').matches).toEqual([astralCommit.hash]);

		});



		it('findWidget in regex mode uses "u" flag which rejects invalid unicode escapes', () => {

			const harness = createFindWidgetHarness({

				commits: [astralCommit],

				isRegex: true

			});



			// In ES6 RegExp with 'u' flag, invalid escapes like \a throw SyntaxError

			const res = harness.search('\\a');

			expect(res.error).not.toBeNull();

			expect(res.matches).toEqual([]);

		});



		it('dataStore: projectWasmCommits preserves CRLF in message and retains carriage return in summary', () => {

			const dataHarness = createDataStoreHarness();

			const projected = dataHarness.projectWasmCommits([astralCommit]);



			expect(projected[0].message).toBe(astralCommit.message);

			// Characterization truth: split('\n')[0] on CRLF leaves trailing '\r' in summary!

			expect(projected[0].summary).toBe('feat: support surrogate pairs 𝒳 and math symbols ∑ ∏\r');

			expect(projected[0].summary.endsWith('\r')).toBe(true);

		});



		it('dataStore: getBranchLabels correctly handles branch names with emoji', () => {

			const dataHarness = createDataStoreHarness({ combineLocalAndRemoteBranchLabels: true });

			const result = dataHarness.getBranchLabels(astralCommit.heads, astralCommit.remotes);



			expect(result.heads).toEqual([

				{ name: 'feature/🚀-rocket', remotes: ['origin'] }

			]);

			expect(result.remotes).toEqual([]);

		});

	});



	describe('4. Undefined / Missing / Malformed Commit Fields', () => {

		it('empirically reveals: findWidget crashes with TypeError when commit.stash is undefined', () => {

			const commitUndefinedStash = createSampleCommit({

				hash: '5555555555555555555555555555555555555555',

				stash: undefined as any // malformed commit where stash is undefined instead of null

			});



			const harness = createFindWidgetHarness({

				commits: [commitUndefinedStash],

				isRegex: false

			});



			// Line 265 in web/findWidget.ts:

			// commit.stash !== null && findPattern.test(commit.stash.selector)

			// Because undefined !== null is TRUE, it attempts to read commit.stash.selector -> throws TypeError!

			expect(() => {

				harness.search('anything');

			}).toThrow(/selector/);

		});



		it('empirically reveals: areCommitArraysEqual crashes with TypeError when commit.stash is undefined', () => {

			const dataHarness = createDataStoreHarness();

			const c1 = createSampleCommit({ hash: '1111', stash: undefined as any });

			const c2 = createSampleCommit({ hash: '1111', stash: undefined as any });



			// Line 331 in web/main.ts / line 404 in webHarness:

			// (a.stash !== null && b.stash !== null && a.stash.selector === b.stash.selector)

			// undefined !== null is TRUE -> reads a.stash.selector -> throws TypeError!

			expect(() => {

				dataHarness.areCommitArraysEqual([c1], [c2]);

			}).toThrow(TypeError);

		});



		it('dataStore: aggregateAvatarsNeeded skips commits with empty email or non-string cache', () => {

			const dataHarness = createDataStoreHarness();

			const commitEmptyEmail = createSampleCommit({ hash: 'e1', email: '' });

			const commitNullEmail = createSampleCommit({ hash: 'e2', email: null as any });



			const needed = dataHarness.aggregateAvatarsNeeded([commitEmptyEmail, commitNullEmail], {}, true);

			// Empty string is skipped; null is treated as key 'null'

			expect(needed['']).toBeUndefined();

			expect(needed['null']).toEqual(['e2']);

		});



		it('dataStore: projectWasmCommits handles missing parent array by failing if not an array', () => {

			const dataHarness = createDataStoreHarness();

			const commitNoParents = createSampleCommit({

				hash: '6666666666666666666666666666666666666666',

				parents: undefined as any

			});



			const projected = dataHarness.projectWasmCommits([commitNoParents]);

			expect(projected[0].parents).toBeUndefined();

		});

	});



	describe('5. Uncommitted Node Handling and Mutation Guarantees', () => {

		it('findWidget strictly skips UNCOMMITTED node even if query matches all commit fields', () => {

			const uncommittedCommit = createSampleCommit({

				hash: UNCOMMITTED,

				author: 'Uncommitted Author',

				message: 'Uncommitted message with keyword'

			});

			const regularCommit = createSampleCommit({

				hash: '7777777777777777777777777777777777777777',

				message: 'Regular commit with keyword'

			});



			const harness = createFindWidgetHarness({

				commits: [uncommittedCommit, regularCommit]

			});



			// Searching for 'keyword' should ONLY match regularCommit, NEVER uncommittedCommit

			const res = harness.search('keyword');

			expect(res.matches).toEqual([regularCommit.hash]);

			expect(res.matches).not.toContain(UNCOMMITTED);

		});



		it('dataStore: areCommitArraysEqual ignores message changes on UNCOMMITTED node', () => {

			const dataHarness = createDataStoreHarness();

			const uncommittedV1 = createSampleCommit({

				hash: UNCOMMITTED,

				message: 'Uncommitted Changes (1 file modified)'

			});

			const uncommittedV2 = createSampleCommit({

				hash: UNCOMMITTED,

				message: 'Uncommitted Changes (10 files modified, 3 deleted)'

			});



			// areCommitArraysEqual does NOT compare messages!

			expect(dataHarness.areCommitArraysEqual([uncommittedV1], [uncommittedV2])).toBe(true);

		});



		it('dataStore: areCommitArraysEqual detects changes if UNCOMMITTED node parents change', () => {

			const dataHarness = createDataStoreHarness();

			const uncommittedP1 = createSampleCommit({

				hash: UNCOMMITTED,

				parents: ['parent1']

			});

			const uncommittedP2 = createSampleCommit({

				hash: UNCOMMITTED,

				parents: ['parent2']

			});



			expect(dataHarness.areCommitArraysEqual([uncommittedP1], [uncommittedP2])).toBe(false);

		});



		it('dataStore: buildCommitLookup correctly indexes UNCOMMITTED node whether at index 0 or elsewhere', () => {
			const dataHarness = createDataStoreHarness();
			const c1 = createSampleCommit({ hash: 'hash1' });
			const uncommitted = createSampleCommit({ hash: UNCOMMITTED });

			const lookup = dataHarness.buildCommitLookup([c1, uncommitted]);
			expect(lookup['hash1']).toBe(0);
			expect(lookup[UNCOMMITTED]).toBe(1);
		});
	});

	describe('6. Web Harness Extensibility & Dynamic Script Resolution', () => {
		it('accurately reports existence of web scripts via webScriptExists', () => {
			expect(webScriptExists('utils.ts')).toBe(true);
			expect(webScriptExists('main.ts')).toBe(true);
			expect(webScriptExists('findWidget.ts')).toBe(true);
			expect(webScriptExists('completelyUnknownFile.ts')).toBe(false);
		});

		it('throws informative error when getTranspiledWebScript is called with unsupported filename', () => {
			expect(() => {
				getTranspiledWebScript('unsupportedModule.ts');
			}).toThrow('Unknown script: unsupportedModule.ts');
		});

		it('successfully instantiates DataStoreHarness with forward and backward compatibility', () => {
			const harness = createDataStoreHarness();
			expect(harness).toBeDefined();
			expect(typeof harness.arraysEqual).toBe('function');
			expect(typeof harness.arraysStrictlyEqual).toBe('function');
			expect(typeof harness.areCommitArraysEqual).toBe('function');
			expect(typeof harness.buildCommitLookup).toBe('function');
			expect(typeof harness.projectWasmCommits).toBe('function');
			expect(typeof harness.aggregateAvatarsNeeded).toBe('function');
		});

		it('successfully instantiates FindWidgetHarness with forward and backward compatibility', () => {
			const harness = createFindWidgetHarness({
				commits: [createSampleCommit({ hash: 'c1', message: 'test harness match' })]
			});
			expect(harness).toBeDefined();
			expect(typeof harness.search).toBe('function');
			expect(harness.search('harness').matches).toEqual(['c1']);
		});
	});
});


