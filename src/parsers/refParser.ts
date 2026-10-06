import { ErrorInfo } from '../types';

export const INVALID_BRANCH_REGEXP = /^\(.* .*\)$/;
export const REMOTE_HEAD_BRANCH_REGEXP = /^remotes\/.*\/HEAD$/;
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

export interface GitBranchData {
	branches: string[];
	head: string | null;
	error: ErrorInfo;
}

/**
 * Parse raw git show-ref output into structured GitRefData.
 *
 * @param stdout The stdout from `git show-ref -d --head`.
 * @param hideRemotes Remotes to hide from the references.
 * @param showRemoteHeads Whether to include remote HEAD references (e.g. `origin/HEAD`).
 * @returns Parsed GitRefData containing head, heads, tags, and remotes.
 */
export function parseRefs(
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
 * Parse raw git branch output into structured GitBranchData.
 *
 * @param stdout The stdout from `git branch -a --no-color` or `git branch --no-color`.
 * @param hideRemotes Remotes to hide from the branches.
 * @param showRemoteHeads Whether to include remote HEAD references (e.g. `remotes/origin/HEAD`).
 * @returns Parsed GitBranchData containing branches array, head string (or null), and error (null).
 */
export function parseBranches(
	stdout: string,
	hideRemotes: ReadonlyArray<string> = [],
	showRemoteHeads: boolean = false
): GitBranchData {
	const branchData: GitBranchData = { branches: [], head: null, error: null };
	const lines = stdout.split(EOL_REGEX);
	const hideRemotePatterns = hideRemotes.map((remote) => 'remotes/' + remote + '/');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.length <= 2) continue;

		const name = line.substring(2).split(' -> ')[0];
		if (
			INVALID_BRANCH_REGEXP.test(name) ||
			hideRemotePatterns.some((pattern) => name.startsWith(pattern)) ||
			(!showRemoteHeads && REMOTE_HEAD_BRANCH_REGEXP.test(name))
		) {
			continue;
		}

		if (line[0] === '*') {
			branchData.head = name;
			branchData.branches.unshift(name);
		} else {
			branchData.branches.push(name);
		}
	}

	return branchData;
}
