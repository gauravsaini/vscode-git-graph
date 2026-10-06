import { GitFileChange, GitFileStatus, Writeable } from '../types';

const normalisePath = (str: string): string => str.replace(/\\/g, '/');

export interface DiffNameStatusRecord {
	readonly type: GitFileStatus;
	readonly oldFilePath: string;
	readonly newFilePath: string;
}

export interface DiffNumStatRecord {
	readonly filePath: string;
	readonly additions: number;
	readonly deletions: number;
}

export interface GitStatusFiles {
	readonly deleted: string[];
	readonly untracked: string[];
}

/**
 * Parse git diff `--name-status` records (from NUL-delimited output).
 * @param output The raw stdout string or array of NUL-delimited records.
 * @param isDiffTree Whether the output was produced by git diff-tree (where the first token is the commit hash).
 * @returns An array of DiffNameStatusRecord objects.
 */
export function parseDiffNameStatus(output: string | ReadonlyArray<string>, isDiffTree: boolean = false): DiffNameStatusRecord[] {
	const tokens = typeof output === 'string' ? output.split('\0') : output.slice();
	if (isDiffTree && tokens.length > 0) {
		tokens.shift();
	}
	const records: DiffNameStatusRecord[] = [];
	let i = 0;
	while (i < tokens.length && tokens[i] !== '') {
		const type = <GitFileStatus>tokens[i][0];
		if (type === GitFileStatus.Added || type === GitFileStatus.Deleted || type === GitFileStatus.Modified) {
			if (i + 1 >= tokens.length) break;
			const p = normalisePath(tokens[i + 1]);
			records.push({ type: type, oldFilePath: p, newFilePath: p });
			i += 2;
		} else if (type === GitFileStatus.Renamed) {
			if (i + 2 >= tokens.length) break;
			records.push({
				type: type,
				oldFilePath: normalisePath(tokens[i + 1]),
				newFilePath: normalisePath(tokens[i + 2])
			});
			i += 3;
		} else {
			break;
		}
	}
	return records;
}

/**
 * Parse git diff `--numstat` records (from NUL-delimited output).
 * @param output The raw stdout string or array of NUL-delimited records.
 * @param isDiffTree Whether the output was produced by git diff-tree (where the first token is the commit hash).
 * @returns An array of DiffNumStatRecord objects.
 */
export function parseDiffNumStat(output: string | ReadonlyArray<string>, isDiffTree: boolean = false): DiffNumStatRecord[] {
	const tokens = typeof output === 'string' ? output.split('\0') : output.slice();
	if (isDiffTree && tokens.length > 0) {
		tokens.shift();
	}
	const records: DiffNumStatRecord[] = [];
	let i = 0;
	while (i < tokens.length && tokens[i] !== '') {
		const fields = tokens[i].split('\t');
		if (fields.length !== 3) break;
		if (fields[2] !== '') {
			// Add, Modify, or Delete
			records.push({
				filePath: normalisePath(fields[2]),
				additions: parseInt(fields[0], 10),
				deletions: parseInt(fields[1], 10)
			});
			i += 1;
		} else {
			// Rename
			if (i + 2 >= tokens.length) break;
			records.push({
				filePath: normalisePath(tokens[i + 2]),
				additions: parseInt(fields[0], 10),
				deletions: parseInt(fields[1], 10)
			});
			i += 3;
		}
	}
	return records;
}

/**
 * Parse git status porcelain -z output into deleted and untracked file paths.
 * @param stdout The NUL-delimited stdout string from `git status -s --porcelain -z`.
 * @returns An object containing arrays of deleted and untracked file paths.
 */
export function parseStatusFiles(stdout: string): GitStatusFiles {
	const output = stdout.split('\0');
	const status: GitStatusFiles = { deleted: [], untracked: [] };
	let i = 0;
	while (i < output.length && output[i] !== '') {
		if (output[i].length < 4) break;
		const path = output[i].substring(3);
		const c1 = output[i].substring(0, 1);
		const c2 = output[i].substring(1, 2);
		if (c1 === 'D' || c2 === 'D') {
			status.deleted.push(path);
		} else if (c1 === '?' || c2 === '?') {
			status.untracked.push(path);
		}

		if (c1 === 'R' || c2 === 'R' || c1 === 'C' || c2 === 'C') {
			// Renames or copies
			i += 2;
		} else {
			i += 1;
		}
	}
	return status;
}

/**
 * Generates the combined file changes from diff records and status information.
 * @param nameStatusRecords The `--name-status` records.
 * @param numStatRecords The `--numstat` records.
 * @param status The deleted and untracked files, or null if not applicable.
 * @returns An array of GitFileChange objects.
 */
export function generateFileChanges(
	nameStatusRecords: ReadonlyArray<DiffNameStatusRecord>,
	numStatRecords: ReadonlyArray<DiffNumStatRecord>,
	status: GitStatusFiles | null
): Writeable<GitFileChange>[] {
	const fileChanges: Writeable<GitFileChange>[] = [];
	const fileLookup: { [file: string]: number } = {};

	for (let i = 0; i < nameStatusRecords.length; i++) {
		fileLookup[nameStatusRecords[i].newFilePath] = fileChanges.length;
		fileChanges.push({
			oldFilePath: nameStatusRecords[i].oldFilePath,
			newFilePath: nameStatusRecords[i].newFilePath,
			type: nameStatusRecords[i].type,
			additions: null,
			deletions: null
		});
	}

	if (status !== null) {
		let filePath: string;
		for (let i = 0; i < status.deleted.length; i++) {
			filePath = normalisePath(status.deleted[i]);
			if (typeof fileLookup[filePath] === 'number') {
				fileChanges[fileLookup[filePath]].type = GitFileStatus.Deleted;
			} else {
				fileChanges.push({
					oldFilePath: filePath,
					newFilePath: filePath,
					type: GitFileStatus.Deleted,
					additions: null,
					deletions: null
				});
			}
		}
		for (let i = 0; i < status.untracked.length; i++) {
			filePath = normalisePath(status.untracked[i]);
			fileChanges.push({
				oldFilePath: filePath,
				newFilePath: filePath,
				type: GitFileStatus.Untracked,
				additions: null,
				deletions: null
			});
		}
	}

	for (let i = 0; i < numStatRecords.length; i++) {
		if (typeof fileLookup[numStatRecords[i].filePath] === 'number') {
			fileChanges[fileLookup[numStatRecords[i].filePath]].additions = numStatRecords[i].additions;
			fileChanges[fileLookup[numStatRecords[i].filePath]].deletions = numStatRecords[i].deletions;
		}
	}

	return fileChanges;
}
