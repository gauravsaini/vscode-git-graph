import { GitStash } from '../types';

import { GIT_LOG_SEPARATOR } from './logParser';
const EOL_REGEX = /\r\n|\r|\n/g;

/**
 * Parse raw git reflog stash output.
 * @param stdout The stdout string from `git reflog --format=... refs/stash --`.
 * @returns An array of parsed GitStash objects.
 */
export function parseStashes(stdout: string): GitStash[] {
	const lines = stdout.split(EOL_REGEX);
	const stashes: GitStash[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.length === 0) continue;
		const parts = line.split(GIT_LOG_SEPARATOR);
		if (parts.length !== 7 || parts[1] === '') continue;
		const parentHashes = parts[1].split(' ');
		stashes.push({
			hash: parts[0],
			baseHash: parentHashes[0],
			untrackedFilesHash: parentHashes.length === 3 ? parentHashes[2] : null,
			selector: parts[2],
			author: parts[3],
			email: parts[4],
			date: parseInt(parts[5], 10) || 0,
			message: parts[6]
		});
	}
	return stashes;
}
