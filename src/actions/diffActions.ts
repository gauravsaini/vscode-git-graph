import { getConfig } from '../config';
import {
	DiffNameStatusRecord,
	DiffNumStatRecord,
	GitStatusFiles,
	generateFileChanges,
	parseDiffNameStatus,
	parseDiffNumStat,
	parseStatusFiles
} from '../parsers';
import { ErrorInfo, GitFileChange } from '../types';
import {
	UNABLE_TO_FIND_GIT_MSG,
	UNCOMMITTED,
	openGitTerminal,
	showErrorMessage
} from '../utils';
import { GitExecutor } from './gitExecutor';

const EOL_REGEX = /\r\n|\r|\n/g;

export interface GitCommitComparisonData {
	fileChanges: GitFileChange[];
	error: ErrorInfo;
}

/**
 * Open an external directory diff tool comparing two commits or revisions.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param fromHash The commit hash the diff is from.
 * @param toHash The commit hash the diff is to.
 * @param isGui Is the external diff tool GUI based.
 * @returns The ErrorInfo from the executed command.
 */
export function openExternalDirDiff(git: GitExecutor, repo: string, fromHash: string, toHash: string, isGui: boolean): Promise<ErrorInfo> {
	return new Promise<ErrorInfo>((resolve) => {
		const gitExecutable = git.getGitExecutable();
		if (gitExecutable === null) {
			resolve(UNABLE_TO_FIND_GIT_MSG);
		} else {
			const args = ['difftool', '--dir-diff'];
			if (isGui) {
				args.push('-g');
			}
			if (fromHash === toHash) {
				if (toHash === UNCOMMITTED) {
					args.push('HEAD');
				} else {
					args.push(toHash + '^..' + toHash);
				}
			} else {
				if (toHash === UNCOMMITTED) {
					args.push(fromHash);
				} else {
					args.push(fromHash + '..' + toHash);
				}
			}
			if (isGui) {
				const logger = git.getLogger();
				logger.log('External diff tool is being opened (' + args[args.length - 1] + ')');
				git.runGitCommand(args, repo).then((errorInfo) => {
					logger.log('External diff tool has exited (' + args[args.length - 1] + ')');
					if (errorInfo !== null) {
						const errorMessage = errorInfo.replace(EOL_REGEX, ' ');
						logger.logError(errorMessage);
						showErrorMessage(errorMessage);
					}
				});
			} else {
				openGitTerminal(repo, gitExecutable.path, args.join(' '), 'Open External Directory Diff');
			}
			setTimeout(() => resolve(null), 1500);
		}
	});
}

/**
 * Get the comparison details for the Commit Comparison View.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param fromHash The commit hash the comparison is from.
 * @param toHash The commit hash the comparison is to.
 * @returns The comparison details.
 */
export function getCommitComparison(git: GitExecutor, repo: string, fromHash: string, toHash: string): Promise<GitCommitComparisonData> {
	return Promise.all<DiffNameStatusRecord[], DiffNumStatRecord[], GitStatusFiles | null>([
		getDiffNameStatus(git, repo, fromHash, toHash === UNCOMMITTED ? '' : toHash),
		getDiffNumStat(git, repo, fromHash, toHash === UNCOMMITTED ? '' : toHash),
		toHash === UNCOMMITTED ? getStatus(git, repo) : Promise.resolve(null)
	]).then((results) => {
		return {
			fileChanges: generateFileChanges(results[0], results[1], results[2]),
			error: null
		};
	}).catch((errorMessage) => {
		return { fileChanges: [], error: errorMessage };
	});
}

/**
 * Get the contents of a file at a specific revision.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The commit hash specifying the revision of the file.
 * @param filePath The path of the file relative to the repository root.
 * @returns The file contents.
 */
function decodeWithFallback(buffer: Buffer, encoding: string): string {
	if (typeof buffer === 'string') {
		return buffer;
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const iconv = require('../vendor/iconv-lite');
		if (iconv && typeof iconv.decode === 'function' && typeof iconv.encodingExists === 'function') {
			return iconv.decode(buffer, iconv.encodingExists(encoding) ? encoding : 'utf8');
		}
	} catch (e1) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const iconv = require('iconv-lite');
			if (iconv && typeof iconv.decode === 'function' && typeof iconv.encodingExists === 'function') {
				return iconv.decode(buffer, iconv.encodingExists(encoding) ? encoding : 'utf8');
			}
		} catch (e2) {
			// Fallback below
		}
	}
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { TextDecoder: NodeTextDecoder } = require('util');
		if (NodeTextDecoder) {
			const decoder = new NodeTextDecoder(encoding);
			return decoder.decode(buffer);
		}
	} catch (e) {
		// Fallback below
	}
	try {
		return buffer.toString(encoding as BufferEncoding);
	} catch (e) {
		return buffer.toString('utf8');
	}
}

export function getCommitFile(git: GitExecutor, repo: string, commitHash: string, filePath: string): Promise<string> {
	return git._spawnGit(['show', commitHash + ':' + filePath], repo, (stdout) => {
		const encoding = getConfig(repo).fileEncoding;
		return decodeWithFallback(stdout, encoding);
	});
}

/**
 * Check to see if a file has been renamed between a commit and the working tree, and return the new file path.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The commit hash.
 * @param oldFilePath The old path of the file.
 * @returns The new path of the file, or NULL if not renamed.
 */
export function getNewPathOfRenamedFile(git: GitExecutor, repo: string, commitHash: string, oldFilePath: string): Promise<string | null> {
	return getDiffNameStatus(git, repo, commitHash, '', 'R').then((renamed) => {
		const record = renamed.find((r) => r.oldFilePath === oldFilePath);
		return record ? record.newFilePath : null;
	}).catch(() => null);
}

/**
 * Get the diff between two revisions.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param fromHash The revision the diff is from.
 * @param toHash The revision the diff is to.
 * @param arg Sets the data reported from the diff.
 * @param filter The types of file changes to retrieve.
 * @returns An array of null-delimited diff records.
 */
export function execDiff(git: GitExecutor, repo: string, fromHash: string, toHash: string, arg: '--numstat' | '--name-status', filter: string): Promise<string[]> {
	let args: string[];
	if (fromHash === toHash) {
		args = ['diff-tree', arg, '-r', '--root', '--find-renames', '--diff-filter=' + filter, '-z', fromHash];
	} else {
		args = ['diff', arg, '--find-renames', '--diff-filter=' + filter, '-z', fromHash];
		if (toHash !== '') args.push(toHash);
	}

	return git.spawnGit(args, repo, (stdout) => {
		const lines = stdout.split('\0');
		if (fromHash === toHash) lines.shift();
		return lines;
	});
}

/**
 * Get the diff `--name-status` records.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param fromHash The revision the diff is from.
 * @param toHash The revision the diff is to.
 * @param filter The types of file changes to retrieve (defaults to `AMDR`).
 * @returns An array of `--name-status` records.
 */
export function getDiffNameStatus(git: GitExecutor, repo: string, fromHash: string, toHash: string, filter: string = 'AMDR'): Promise<DiffNameStatusRecord[]> {
	return execDiff(git, repo, fromHash, toHash, '--name-status', filter).then((output) => {
		return parseDiffNameStatus(output);
	});
}

/**
 * Get the diff `--numstat` records.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param fromHash The revision the diff is from.
 * @param toHash The revision the diff is to.
 * @param filter The types of file changes to retrieve (defaults to `AMDR`).
 * @returns An array of `--numstat` records.
 */
export function getDiffNumStat(git: GitExecutor, repo: string, fromHash: string, toHash: string, filter: string = 'AMDR'): Promise<DiffNumStatRecord[]> {
	return execDiff(git, repo, fromHash, toHash, '--numstat', filter).then((output) => {
		return parseDiffNumStat(output);
	});
}

/**
 * Get the untracked and deleted files that are not staged or committed.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @returns The untracked and deleted files.
 */
export function getStatus(git: GitExecutor, repo: string): Promise<GitStatusFiles> {
	return git.spawnGit(['status', '-s', '--untracked-files=' + (getConfig().showUntrackedFiles ? 'all' : 'no'), '--porcelain', '-z'], repo, (stdout) => {
		return parseStatusFiles(stdout);
	});
}
