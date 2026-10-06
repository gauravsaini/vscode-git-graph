/* Commit Filter Fallback Strategy */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */

interface CommitFilterColumnVisibility {
	readonly author: boolean;
	readonly commit: boolean;
	readonly date: boolean;
}

interface CommitFilterOptions {
	readonly query: string;
	readonly isRegex: boolean;
	readonly isCaseSensitive: boolean;
	readonly columnVisibility: CommitFilterColumnVisibility;
	readonly combineLocalAndRemoteBranchLabels?: boolean;
	readonly wasmCommits?: ReadonlyArray<any>;
}

interface CommitFilterMatch {
	readonly hash: string;
	readonly index: number;
}

interface CommitFilterResult {
	readonly matches: CommitFilterMatch[];
	readonly error: string | null;
}

function commitFilterAbbrevCommit(commitHash: string): string {
	if (typeof abbrevCommit === 'function') {
		return abbrevCommit(commitHash);
	}
	return commitHash.substring(0, 8);
}

function commitFilterFormatShortDate(unixTimestamp: number): { formatted: string } {
	if (typeof formatShortDate === 'function') {
		return formatShortDate(unixTimestamp);
	}
	const date = new Date(unixTimestamp * 1000);
	return { formatted: date.toISOString() };
}

function commitFilterGetBranchLabels(
	heads: ReadonlyArray<string>,
	remotes: ReadonlyArray<GG.GitCommitRemote>,
	combineLocalAndRemoteBranchLabels: boolean
): { heads: { name: string; remotes: string[] }[]; remotes: ReadonlyArray<GG.GitCommitRemote> } {
	if (typeof CommitDataStore !== 'undefined' && typeof CommitDataStore.getBranchLabels === 'function') {
		return CommitDataStore.getBranchLabels(heads, remotes, combineLocalAndRemoteBranchLabels);
	}
	const headLabels: { name: string; remotes: string[] }[] = [];
	const headLookup: { [name: string]: number } = {};

	for (let i = 0; i < heads.length; i++) {
		headLabels.push({ name: heads[i], remotes: [] });
		headLookup[heads[i]] = i;
	}

	if (combineLocalAndRemoteBranchLabels) {
		const remainingRemoteLabels: GG.GitCommitRemote[] = [];
		for (let i = 0; i < remotes.length; i++) {
			const remote = remotes[i];
			if (remote.remote !== null) {
				const branchName = remote.name.substring(remote.remote.length + 1);
				if (typeof headLookup[branchName] === 'number') {
					headLabels[headLookup[branchName]].remotes.push(remote.remote);
					continue;
				}
			}
			remainingRemoteLabels.push(remote);
		}
		return { heads: headLabels, remotes: remainingRemoteLabels };
	} else {
		return { heads: headLabels, remotes: remotes };
	}
}

class CommitFilterFallback {
	public static filter(
		commits: ReadonlyArray<GG.GitCommit>,
		options: CommitFilterOptions
	): CommitFilterResult {
		if (options.query === '') {
			return { matches: [], error: null };
		}

		let findPattern: RegExp;
		let findGlobalPattern: RegExp;
		const regexText = options.isRegex
			? options.query
			: options.query.replace(/[\\\[\](){}|.*+?^$]/g, '\\$&');
		const flags = 'u' + (options.isCaseSensitive ? '' : 'i');

		try {
			findPattern = new RegExp(regexText, flags);
			findGlobalPattern = new RegExp(regexText, 'g' + flags);
		} catch (e: any) {
			return { matches: [], error: e.message };
		}

		let wasmMatchSet: { [index: number]: boolean } | null = null;
		if (!options.isRegex && typeof wasm_bindgen !== 'undefined' && typeof wasm_bindgen.filter_commits_js === 'function') {
			try {
				const wasmCommits = options.wasmCommits;
				if (wasmCommits && wasmCommits.length === commits.length) {
					const matchingIndices: number[] = wasm_bindgen.filter_commits_js(wasmCommits, {
						text_query: options.query,
						case_sensitive: options.isCaseSensitive
					});
					wasmMatchSet = {};
					for (let m = 0; m < matchingIndices.length; m++) {
						wasmMatchSet[matchingIndices[m]] = true;
					}
				}
			} catch (e) {
			}
		}

		const uncommitted = typeof UNCOMMITTED !== 'undefined' ? UNCOMMITTED : '*';
		const combineBranches = typeof options.combineLocalAndRemoteBranchLabels === 'boolean'
			? options.combineLocalAndRemoteBranchLabels
			: (typeof initialState !== 'undefined' && initialState.config && initialState.config.referenceLabels
				? initialState.config.referenceLabels.combineLocalAndRemoteBranchLabels
				: true);

		const matches: CommitFilterMatch[] = [];
		let zeroLengthMatch = false;

		for (let i = 0; i < commits.length; i++) {
			const commit = commits[i];
			if (commit.hash === uncommitted) {
				continue;
			}

			const isWasmMatch = Boolean(wasmMatchSet && wasmMatchSet[i]);
			const branchLabels = commitFilterGetBranchLabels(commit.heads, commit.remotes, combineBranches);

			const isCandidateMatch = isWasmMatch
				|| (options.columnVisibility.author && findPattern.test(commit.author))
				|| (options.columnVisibility.commit && (commit.hash.search(findPattern) === 0 || findPattern.test(commitFilterAbbrevCommit(commit.hash))))
				|| (!isWasmMatch && findPattern.test(commit.message))
				|| branchLabels.heads.some(head => findPattern.test(head.name) || head.remotes.some(remote => findPattern.test(remote)))
				|| branchLabels.remotes.some(remote => findPattern.test(remote.name))
				|| commit.tags.some(tag => findPattern.test(tag.name))
				|| (options.columnVisibility.date && findPattern.test(commitFilterFormatShortDate(commit.date).formatted))
				|| (commit.stash !== null && findPattern.test(commit.stash.selector));

			if (isCandidateMatch) {
				const testStrings: string[] = [commit.message];
				if (options.columnVisibility.author) testStrings.push(commit.author);
				if (options.columnVisibility.commit) testStrings.push(commitFilterAbbrevCommit(commit.hash));
				if (options.columnVisibility.date) testStrings.push(commitFilterFormatShortDate(commit.date).formatted);
				for (let h = 0; h < branchLabels.heads.length; h++) {
					testStrings.push(branchLabels.heads[h].name);
					for (let r = 0; r < branchLabels.heads[h].remotes.length; r++) {
						testStrings.push(branchLabels.heads[h].remotes[r]);
					}
				}
				for (let r = 0; r < branchLabels.remotes.length; r++) {
					testStrings.push(branchLabels.remotes[r].name);
				}
				for (let t = 0; t < commit.tags.length; t++) {
					testStrings.push(commit.tags[t].name);
				}
				if (commit.stash !== null) {
					testStrings.push(commit.stash.selector);
				}

				for (let s = 0; s < testStrings.length; s++) {
					const str = testStrings[s];
					findGlobalPattern.lastIndex = 0;
					let execMatch: RegExpExecArray | null;
					while ((execMatch = findGlobalPattern.exec(str)) !== null) {
						if (execMatch[0].length === 0) {
							zeroLengthMatch = true;
							break;
						}
					}
					if (zeroLengthMatch) break;
				}

				if (zeroLengthMatch) break;

				matches.push({ hash: commit.hash, index: i });
			}
		}

		if (zeroLengthMatch) {
			return {
				matches: [],
				error: 'Cannot use a regular expression which has zero length matches'
			};
		}

		return { matches: matches, error: null };
	}
}

if (typeof exports !== 'undefined') {
	exports.CommitFilterFallback = CommitFilterFallback;
}
