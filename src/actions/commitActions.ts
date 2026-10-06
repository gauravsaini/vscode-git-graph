import { getConfig } from '../config';
import { GIT_LOG_SEPARATOR, generateFileChanges } from '../parsers';
import {
	DeepWriteable,
	ErrorInfo,
	GitCommitDetails,
	GitResetMode,
	GitSignatureStatus,
	MergeActionOn,
	RebaseActionOn,
	SquashMessageFormat
} from '../types';
import {
	GitVersionRequirement,
	UNCOMMITTED,
	abbrevCommit,
	doesVersionMeetRequirement
} from '../utils';
import { getDiffNameStatus, getDiffNumStat, getStatus } from './diffActions';
import { GitExecutor } from './gitExecutor';

const EOL_REGEX = /\r\n|\r|\n/g;

export interface GitCommitDetailsData {
	commitDetails: GitCommitDetails | null;
	error: ErrorInfo;
}

/**
 * Checkout a commit in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit to check out.
 * @returns The ErrorInfo from the executed command.
 */
export function checkoutCommit(git: GitExecutor, repo: string, commitHash: string): Promise<ErrorInfo> {
	return git.runGitCommand(['checkout', commitHash], repo);
}

/**
 * Cherrypick a commit in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit to be cherry picked.
 * @param parentIndex The parent index if the commit is a merge.
 * @param recordOrigin Is `-x` enabled.
 * @param noCommit Is `--no-commit` enabled.
 * @returns The ErrorInfo from the executed command.
 */
export function cherrypickCommit(git: GitExecutor, repo: string, commitHash: string, parentIndex: number, recordOrigin: boolean, noCommit: boolean): Promise<ErrorInfo> {
	const args = ['cherry-pick'];
	if (noCommit) {
		args.push('--no-commit');
	}
	if (recordOrigin) {
		args.push('-x');
	}
	if (getConfig().signCommits) {
		args.push('-S');
	}
	if (parentIndex > 0) {
		args.push('-m', parentIndex.toString());
	}
	args.push(commitHash);
	return git.runGitCommand(args, repo);
}

/**
 * Drop a commit in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit to drop.
 * @returns The ErrorInfo from the executed command.
 */
export function dropCommit(git: GitExecutor, repo: string, commitHash: string): Promise<ErrorInfo> {
	const args = ['rebase'];
	if (getConfig().signCommits) {
		args.push('-S');
	}
	args.push('--onto', commitHash + '^', commitHash);
	return git.runGitCommand(args, repo);
}

/**
 * Reset the current branch to a specified commit.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commit The hash of the commit that the current branch should be reset to.
 * @param resetMode The mode of the reset.
 * @returns The ErrorInfo from the executed command.
 */
export function resetToCommit(git: GitExecutor, repo: string, commit: string, resetMode: GitResetMode): Promise<ErrorInfo> {
	return git.runGitCommand(['reset', '--' + resetMode, commit], repo);
}

/**
 * Revert a commit in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit to revert.
 * @param parentIndex The parent index if the commit is a merge.
 * @returns The ErrorInfo from the executed command.
 */
export function revertCommit(git: GitExecutor, repo: string, commitHash: string, parentIndex: number): Promise<ErrorInfo> {
	const args = ['revert', '--no-edit'];
	if (getConfig().signCommits) {
		args.push('-S');
	}
	if (parentIndex > 0) {
		args.push('-m', parentIndex.toString());
	}
	args.push(commitHash);
	return git.runGitCommand(args, repo);
}

/**
 * Merge a branch, remote branch, or commit into the current branch.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param obj The object to be merged into the current branch.
 * @param actionOn Is the merge on a branch, remote-tracking branch or commit.
 * @param createNewCommit Is `--no-ff` enabled.
 * @param squash Is `--squash` enabled.
 * @param noCommit Is `--no-commit` enabled.
 * @returns The ErrorInfo from the executed command.
 */
export function merge(git: GitExecutor, repo: string, obj: string, actionOn: MergeActionOn, createNewCommit: boolean, squash: boolean, noCommit: boolean): Promise<ErrorInfo> {
	const args = ['merge', obj], config = getConfig();
	if (squash) {
		args.push('--squash');
	} else if (createNewCommit) {
		args.push('--no-ff');
	}
	if (noCommit) {
		args.push('--no-commit');
	}
	if (config.signCommits) {
		args.push('-S');
	}
	return git.runGitCommand(args, repo).then((mergeStatus) => {
		return mergeStatus === null && squash && !noCommit
			? commitSquashIfStagedChangesExist(git, repo, obj, actionOn, config.squashMergeMessageFormat, config.signCommits)
			: mergeStatus;
	});
}

/**
 * Rebase the current branch on a branch or commit.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param obj The object the current branch will be rebased onto.
 * @param actionOn Is the rebase on a branch or commit.
 * @param ignoreDate Is `--ignore-date` enabled.
 * @param interactive Should the rebase be performed interactively.
 * @returns The ErrorInfo from the executed command.
 */
export function rebase(git: GitExecutor, repo: string, obj: string, actionOn: RebaseActionOn, ignoreDate: boolean, interactive: boolean): Promise<ErrorInfo> {
	if (interactive) {
		return git.openGitTerminal(
			repo,
			'rebase --interactive ' + (getConfig().signCommits ? '-S ' : '') + (actionOn === RebaseActionOn.Branch ? obj.replace(/'/g, '"\'"') : obj),
			'Rebase on "' + (actionOn === RebaseActionOn.Branch ? obj : abbrevCommit(obj)) + '"'
		);
	} else {
		const args = ['rebase', obj];
		if (ignoreDate) {
			args.push('--ignore-date');
		}
		if (getConfig().signCommits) {
			args.push('-S');
		}
		return git.runGitCommand(args, repo);
	}
}

/**
 * Create an archive of a repository at a specific reference, and save to disk.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param ref The reference of the revision to archive.
 * @param outputFilePath The file path that the archive should be saved to.
 * @param type The type of archive.
 * @returns The ErrorInfo from the executed command.
 */
export function archive(git: GitExecutor, repo: string, ref: string, outputFilePath: string, type: 'tar' | 'zip'): Promise<ErrorInfo> {
	return git.runGitCommand(['archive', '--format=' + type, '-o', outputFilePath, ref], repo);
}

/**
 * Clean the untracked files in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param directories Is `-d` enabled.
 * @returns The ErrorInfo from the executed command.
 */
export function cleanUntrackedFiles(git: GitExecutor, repo: string, directories: boolean): Promise<ErrorInfo> {
	return git.runGitCommand(['clean', '-f' + (directories ? 'd' : '')], repo);
}

/**
 * Reset a file to the specified revision.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The commit to reset the file to.
 * @param filePath The file to reset.
 * @returns The ErrorInfo from the executed command.
 */
export function resetFileToRevision(git: GitExecutor, repo: string, commitHash: string, filePath: string): Promise<ErrorInfo> {
	return git.runGitCommand(['checkout', commitHash, '--', filePath], repo);
}

/**
 * Get the subject of a commit.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The commit hash.
 * @returns The subject string, or NULL if an error occurred.
 */
export function getCommitSubject(git: GitExecutor, repo: string, commitHash: string): Promise<string | null> {
	return git.spawnGit(['-c', 'log.showSignature=false', 'log', '--format=%s', '-n', '1', commitHash, '--'], repo, (stdout) => {
		return stdout.trim().replace(/\s+/g, ' ');
	}).then((subject) => subject, () => null);
}

/**
 * Get the commit details for the Commit Details View.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit open in the Commit Details View.
 * @param hasParents Does the commit have parents.
 * @param gitFormatCommitDetails Optional format string for commit details base.
 * @returns The commit details.
 */
export function getCommitDetails(git: GitExecutor, repo: string, commitHash: string, hasParents: boolean, gitFormatCommitDetails?: string): Promise<GitCommitDetailsData> {
	const fromCommit = commitHash + (hasParents ? '^' : '');
	return Promise.all([
		getCommitDetailsBase(git, repo, commitHash, gitFormatCommitDetails),
		getDiffNameStatus(git, repo, fromCommit, commitHash),
		getDiffNumStat(git, repo, fromCommit, commitHash)
	]).then((results) => {
		results[0].fileChanges = generateFileChanges(results[1], results[2], null);
		return { commitDetails: results[0], error: null };
	}).catch((errorMessage) => {
		return { commitDetails: null, error: errorMessage };
	});
}

/**
 * Get the uncommitted details for the Commit Details View.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @returns The uncommitted details.
 */
export function getUncommittedDetails(git: GitExecutor, repo: string): Promise<GitCommitDetailsData> {
	return Promise.all([
		getDiffNameStatus(git, repo, 'HEAD', ''),
		getDiffNumStat(git, repo, 'HEAD', ''),
		getStatus(repo ? git : git, repo)
	]).then((results) => {
		return {
			commitDetails: {
				hash: UNCOMMITTED, parents: [],
				author: '', authorEmail: '', authorDate: 0,
				committer: '', committerEmail: '', committerDate: 0, signature: null,
				body: '', fileChanges: generateFileChanges(results[0], results[1], results[2])
			},
			error: null
		};
	}).catch((errorMessage) => {
		return { commitDetails: null, error: errorMessage };
	});
}

/**
 * Get the base commit details for the Commit Details View.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit open in the Commit Details View.
 * @param gitFormatCommitDetails Optional format string for commit details base.
 * @returns The base commit details.
 */
export function getCommitDetailsBase(git: GitExecutor, repo: string, commitHash: string, gitFormatCommitDetails?: string): Promise<DeepWriteable<GitCommitDetails>> {
	const format = gitFormatCommitDetails ?? computeGitFormatCommitDetails(git);
	return git.spawnGit(['-c', 'log.showSignature=false', 'show', '--quiet', commitHash, '--format=' + format], repo, (stdout): DeepWriteable<GitCommitDetails> => {
		const commitInfo = stdout.split(GIT_LOG_SEPARATOR);
		return {
			hash: commitInfo[0],
			parents: commitInfo[1] !== '' ? commitInfo[1].split(' ') : [],
			author: commitInfo[2],
			authorEmail: commitInfo[3],
			authorDate: parseInt(commitInfo[4]),
			committer: commitInfo[5],
			committerEmail: commitInfo[6],
			committerDate: parseInt(commitInfo[7]),
			signature: ['G', 'U', 'X', 'Y', 'R', 'E', 'B'].includes(commitInfo[8])
				? {
					key: commitInfo[10].trim(),
					signer: commitInfo[9].trim(),
					status: <GitSignatureStatus>commitInfo[8]
				}
				: null,
			body: removeTrailingBlankLines(commitInfo.slice(11).join(GIT_LOG_SEPARATOR).split(EOL_REGEX)).join('\n'),
			fileChanges: []
		};
	});
}

/**
 * Check if there are any staged changes in the repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @returns TRUE => Staged Changes, FALSE => No Staged Changes.
 */
export function areStagedChanges(git: GitExecutor, repo: string): Promise<boolean> {
	return git.spawnGit(['diff-index', 'HEAD'], repo, (stdout) => stdout !== '').then((changes) => changes, () => false);
}

/**
 * Check if there are staged changes that resulted from a squash merge, and if so, commit them.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param obj The object being squash merged into the current branch.
 * @param actionOn Is the merge on a branch, remote-tracking branch or commit.
 * @param squashMessageFormat The format to be used in the commit message of the squash.
 * @param signCommits Should commits be signed with GPG.
 * @returns The ErrorInfo from the executed command.
 */
export function commitSquashIfStagedChangesExist(
	git: GitExecutor,
	repo: string,
	obj: string,
	actionOn: MergeActionOn,
	squashMessageFormat: SquashMessageFormat,
	signCommits: boolean
): Promise<ErrorInfo> {
	return areStagedChanges(git, repo).then((changes) => {
		if (changes) {
			const args = ['commit'];
			if (signCommits) {
				args.push('-S');
			}
			if (squashMessageFormat === SquashMessageFormat.Default) {
				args.push('-m', 'Merge ' + actionOn.toLowerCase() + ' \'' + obj + '\'');
			} else {
				args.push('--no-edit');
			}
			return git.runGitCommand(args, repo);
		} else {
			return null;
		}
	});
}

/**
 * Generate git format commit details string dynamically.
 * @param git Optional Git executor to detect GPG support.
 * @returns Format string.
 */
export function computeGitFormatCommitDetails(git?: GitExecutor): string {
	const config = getConfig();
	const useMailmap = config.useMailmap;
	const gitExec = git ? git.getGitExecutable() : null;
	const supportsGpg = gitExec !== null && doesVersionMeetRequirement(gitExec.version, GitVersionRequirement.GpgInfo);

	return [
		'%H', '%P', // Hash & Parent Information
		useMailmap ? '%aN' : '%an', useMailmap ? '%aE' : '%ae', '%at', useMailmap ? '%cN' : '%cn', useMailmap ? '%cE' : '%ce', '%ct', // Author / Commit Information
		...(config.showSignatureStatus && supportsGpg ? ['%G?', '%GS', '%GK'] : ['', '', '']), // GPG Key Information
		'%B' // Body
	].join(GIT_LOG_SEPARATOR);
}

/**
 * Remove trailing blank lines from an array of lines.
 * @param lines Array of lines.
 * @returns Array of lines with trailing blank lines removed.
 */
function removeTrailingBlankLines(lines: string[]) {
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}
