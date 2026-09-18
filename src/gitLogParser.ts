import { DeepWriteable, GitCommit, GitStash } from './types';

export const UNCOMMITTED = '*';
export const GIT_LOG_SEPARATOR = 'XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb';
const EOL_REGEX = /\r\n|\r|\n/g;

export interface GitRef {
	hash: string;
	name: string;
}

export interface GitRefTag extends GitRef {
	annotated: boolean;
}

export interface GitRefData {
	head: string | null;
	heads: GitRef[];
	tags: GitRefTag[];
	remotes: GitRef[];
}

export interface GitCommitRecord {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	message: string;
}

export interface ParseLogOptions {
	readonly remotes: ReadonlyArray<string>;
	readonly hideRemotes: ReadonlyArray<string>;
	readonly showRemoteHeads: boolean;
	readonly showTags: boolean;
	readonly maxCommits: number;
	readonly uncommittedChanges?: number;
	readonly showUncommittedChanges?: boolean;
}

export interface ParsedGitCommitData {
	commits: GitCommit[];
	head: string | null;
	tags: string[];
	moreCommitsAvailable: boolean;
}

export class GitLogParser {
	/**
	 * Parse raw git show-ref output.
	 */
	public static parseRefs(
		stdout: string,
		hideRemotes: ReadonlyArray<string> = [],
		showRemoteHeads: boolean = false
	): GitRefData {
		const refData: GitRefData = { head: null, heads: [], tags: [], remotes: [] };
		const lines = stdout.split(EOL_REGEX);
		const hideRemotePatterns = hideRemotes.map((remote) => 'refs/remotes/' + remote + '/');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line.length === 0) continue;
			const spaceIdx = line.indexOf(' ');
			if (spaceIdx === -1) continue;

			const hash = line.substring(0, spaceIdx);
			const ref = line.substring(spaceIdx + 1);

			if (ref.startsWith('refs/heads/')) {
				refData.heads.push({ hash: hash, name: ref.substring(11) });
			} else if (ref.startsWith('refs/tags/')) {
				const annotated = ref.endsWith('^{}');
				refData.tags.push({
					hash: hash,
					name: annotated ? ref.substring(10, ref.length - 3) : ref.substring(10),
					annotated: annotated
				});
			} else if (ref.startsWith('refs/remotes/')) {
				if (!hideRemotePatterns.some((pattern) => ref.startsWith(pattern)) && (showRemoteHeads || !ref.endsWith('/HEAD'))) {
					refData.remotes.push({ hash: hash, name: ref.substring(13) });
				}
			} else if (ref === 'HEAD') {
				refData.head = hash;
			}
		}

		return refData;
	}

	/**
	 * Parse raw git log output formatted with GIT_LOG_SEPARATOR.
	 */
	public static parseLogLines(stdout: string): GitCommitRecord[] {
		const lines = stdout.split(EOL_REGEX);
		const commits: GitCommitRecord[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.length === 0) continue;
			const parts = line.split(GIT_LOG_SEPARATOR);
			if (parts.length !== 6) continue;

			commits.push({
				hash: parts[0],
				parents: parts[1] !== '' ? parts[1].split(' ') : [],
				author: parts[2],
				email: parts[3],
				date: parseInt(parts[4], 10) || 0,
				message: parts[5]
			});
		}

		return commits;
	}

	/**
	 * Assemble parsed commits and refs into final GitCommitData.
	 */
	public static assembleCommits(
		commits: GitCommitRecord[],
		refData: GitRefData,
		stashes: ReadonlyArray<GitStash>,
		options: ParseLogOptions
	): ParsedGitCommitData {
		let moreCommitsAvailable = commits.length === options.maxCommits + 1;
		if (moreCommitsAvailable) commits.pop();

		// Inject uncommitted changes node if present
		if (refData.head !== null && options.showUncommittedChanges && (options.uncommittedChanges || 0) > 0) {
			for (let i = 0; i < commits.length; i++) {
				if (refData.head === commits[i].hash) {
					commits.unshift({
						hash: UNCOMMITTED,
						parents: [refData.head],
						author: '*',
						email: '',
						date: Math.round(Date.now() / 1000),
						message: 'Uncommitted Changes (' + options.uncommittedChanges + ')'
					});
					break;
				}
			}
		}

		const commitNodes: DeepWriteable<GitCommit>[] = [];
		const commitLookup: { [hash: string]: number } = {};

		for (let i = 0; i < commits.length; i++) {
			commitLookup[commits[i].hash] = i;
			commitNodes.push({
				...commits[i],
				heads: [],
				tags: [],
				remotes: [],
				stash: null
			});
		}

		// Insert stashes
		const toAdd: { index: number; data: GitStash }[] = [];
		for (let i = 0; i < stashes.length; i++) {
			if (typeof commitLookup[stashes[i].hash] === 'number') {
				commitNodes[commitLookup[stashes[i].hash]].stash = {
					selector: stashes[i].selector,
					baseHash: stashes[i].baseHash,
					untrackedFilesHash: stashes[i].untrackedFilesHash
				};
			} else if (typeof commitLookup[stashes[i].baseHash] === 'number') {
				toAdd.push({ index: commitLookup[stashes[i].baseHash], data: stashes[i] });
			}
		}

		toAdd.sort((a, b) => (a.index !== b.index ? a.index - b.index : b.data.date - a.data.date));
		for (let i = toAdd.length - 1; i >= 0; i--) {
			const stash = toAdd[i].data;
			commitNodes.splice(toAdd[i].index, 0, {
				hash: stash.hash,
				parents: [stash.baseHash],
				author: stash.author,
				email: stash.email,
				date: stash.date,
				message: stash.message,
				heads: [],
				tags: [],
				remotes: [],
				stash: {
					selector: stash.selector,
					baseHash: stash.baseHash,
					untrackedFilesHash: stash.untrackedFilesHash
				}
			});
		}

		for (let i = 0; i < commitNodes.length; i++) {
			commitLookup[commitNodes[i].hash] = i;
		}

		// Annotate heads
		for (let i = 0; i < refData.heads.length; i++) {
			const idx = commitLookup[refData.heads[i].hash];
			if (typeof idx === 'number') {
				commitNodes[idx].heads.push(refData.heads[i].name);
			}
		}

		// Annotate tags
		if (options.showTags) {
			for (let i = 0; i < refData.tags.length; i++) {
				const idx = commitLookup[refData.tags[i].hash];
				if (typeof idx === 'number') {
					commitNodes[idx].tags.push({
						name: refData.tags[i].name,
						annotated: refData.tags[i].annotated
					});
				}
			}
		}

		// Annotate remotes
		for (let i = 0; i < refData.remotes.length; i++) {
			const idx = commitLookup[refData.remotes[i].hash];
			if (typeof idx === 'number') {
				const name = refData.remotes[i].name;
				const remote = options.remotes.find((r) => name.startsWith(r + '/'));
				commitNodes[idx].remotes.push({ name: name, remote: remote ? remote : null });
			}
		}

		const uniqueTags = Array.from(new Set(refData.tags.map((t) => t.name)));

		return {
			commits: commitNodes,
			head: refData.head,
			tags: uniqueTags,
			moreCommitsAvailable: moreCommitsAvailable
		};
	}

	/**
	 * High-level pure parser entry point with optional Wasm acceleration.
	 */
	public static parse(
		logStdout: string,
		refsStdout: string,
		stashes: ReadonlyArray<GitStash>,
		options: ParseLogOptions,
		wasmModule?: any
	): ParsedGitCommitData {
		if (wasmModule && typeof wasmModule.parse_git_log_js === 'function') {
			try {
				return wasmModule.parse_git_log_js(
					logStdout,
					refsStdout,
					stashes,
					options
				);
			} catch (e) {
				// Fall through to native TS parser on any Wasm exception
			}
		}

		const refData = this.parseRefs(refsStdout, options.hideRemotes, options.showRemoteHeads);
		const commits = this.parseLogLines(logStdout);
		return this.assembleCommits(commits, refData, stashes, options);
	}
}
