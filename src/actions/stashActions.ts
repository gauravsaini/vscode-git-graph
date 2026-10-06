import { getConfig } from '../config';
import {
	GIT_LOG_SEPARATOR,
	generateFileChanges,
	parseStashes
} from '../parsers';
import {
	DateType,
	ErrorInfo,
	GitCommitStash,
	GitFileStatus,
	GitStash
} from '../types';
import {
	GitVersionRequirement,
	UNABLE_TO_FIND_GIT_MSG,
	constructIncompatibleGitVersionMessage,
	doesVersionMeetRequirement
} from '../utils';
import { GitCommitDetailsData, getCommitDetailsBase } from './commitActions';
import { getDiffNameStatus, getDiffNumStat } from './diffActions';
import { GitExecutor } from './gitExecutor';

/**
 * Apply a stash in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param selector The selector of the stash.
 * @param reinstateIndex Is `--index` enabled.
 * @returns The ErrorInfo from the executed command.
 */
export function applyStash(
	git: GitExecutor,
	repo: string,
	selector: string,
	reinstateIndex: boolean
): Promise<ErrorInfo> {
	const args = ['stash', 'apply'];
	if (reinstateIndex) args.push('--index');
	args.push(selector);

	return git.runGitCommand(args, repo);
}

/**
 * Create a branch from a stash.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param selector The selector of the stash.
 * @param branchName The name of the branch to be created.
 * @returns The ErrorInfo from the executed command.
 */
export function branchFromStash(
	git: GitExecutor,
	repo: string,
	selector: string,
	branchName: string
): Promise<ErrorInfo> {
	return git.runGitCommand(['stash', 'branch', branchName, selector], repo);
}

/**
 * Drop a stash in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param selector The selector of the stash.
 * @returns The ErrorInfo from the executed command.
 */
export function dropStash(
	git: GitExecutor,
	repo: string,
	selector: string
): Promise<ErrorInfo> {
	return git.runGitCommand(['stash', 'drop', selector], repo);
}

/**
 * Pop a stash in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param selector The selector of the stash.
 * @param reinstateIndex Is `--index` enabled.
 * @returns The ErrorInfo from the executed command.
 */
export function popStash(
	git: GitExecutor,
	repo: string,
	selector: string,
	reinstateIndex: boolean
): Promise<ErrorInfo> {
	const args = ['stash', 'pop'];
	if (reinstateIndex) args.push('--index');
	args.push(selector);

	return git.runGitCommand(args, repo);
}

/**
 * Push uncommitted changes to a stash.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param message The message of the stash.
 * @param includeUntracked Is `--include-untracked` enabled.
 * @returns The ErrorInfo from the executed command.
 */
export function pushStash(
	git: GitExecutor,
	repo: string,
	message: string,
	includeUntracked: boolean
): Promise<ErrorInfo> {
	const gitExecutable = git.getGitExecutable();
	if (gitExecutable === null) {
		return Promise.resolve(UNABLE_TO_FIND_GIT_MSG);
	} else if (!doesVersionMeetRequirement(gitExecutable.version, GitVersionRequirement.PushStash)) {
		return Promise.resolve(constructIncompatibleGitVersionMessage(gitExecutable, GitVersionRequirement.PushStash));
	}

	const args = ['stash', 'push'];
	if (includeUntracked) args.push('--include-untracked');
	if (message !== '') args.push('--message', message);
	return git.runGitCommand(args, repo);
}

/**
 * Generate the format string used to inspect git stashes in reflogs.
 * @returns The separator-delimited format string.
 */
export function getGitFormatStash(): string {
	const config = getConfig();
	const dateType = config.dateType === DateType.Author ? '%at' : '%ct';
	const useMailmap = config.useMailmap;

	return [
		'%H', '%P', '%gD', // Hash, Parent & Selector Information
		useMailmap ? '%aN' : '%an', useMailmap ? '%aE' : '%ae', dateType, // Author / Commit Information
		'%s' // Subject
	].join(GIT_LOG_SEPARATOR);
}

/**
 * Get the stashes in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param gitFormatStash Optional precomputed format string; if omitted, defaults to `getGitFormatStash()`.
 * @returns An array of parsed GitStash objects.
 */
export function getStashes(
	git: GitExecutor,
	repo: string,
	gitFormatStash?: string
): Promise<GitStash[]> {
	const format = gitFormatStash || getGitFormatStash();
	return git.spawnGit(['reflog', '--format=' + format, 'refs/stash', '--'], repo, (stdout) => {
		return parseStashes(stdout);
	}).catch(() => <GitStash[]>[]);
}

/**
 * Get the stash details for the Commit Details View.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the stash commit open in the Commit Details View.
 * @param stash The stash metadata.
 * @param gitFormatCommitDetails Optional precomputed format string for commit details base.
 * @returns The stash details data.
 */
export function getStashDetails(
	git: GitExecutor,
	repo: string,
	commitHash: string,
	stash: GitCommitStash,
	gitFormatCommitDetails?: string
): Promise<GitCommitDetailsData> {
	return Promise.all([
		getCommitDetailsBase(git, repo, commitHash, gitFormatCommitDetails),
		getDiffNameStatus(git, repo, stash.baseHash, commitHash),
		getDiffNumStat(git, repo, stash.baseHash, commitHash),
		stash.untrackedFilesHash !== null ? getDiffNameStatus(git, repo, stash.untrackedFilesHash, stash.untrackedFilesHash) : Promise.resolve([]),
		stash.untrackedFilesHash !== null ? getDiffNumStat(git, repo, stash.untrackedFilesHash, stash.untrackedFilesHash) : Promise.resolve([])
	]).then((results) => {
		results[0].fileChanges = generateFileChanges(results[1], results[2], null);
		if (stash.untrackedFilesHash !== null) {
			generateFileChanges(results[3], results[4], null).forEach((fileChange) => {
				if (fileChange.type === GitFileStatus.Added) {
					fileChange.type = GitFileStatus.Untracked;
					results[0].fileChanges.push(fileChange);
				}
			});
		}
		return { commitDetails: results[0], error: null };
	}).catch((errorMessage) => {
		return { commitDetails: null, error: errorMessage };
	});
}
