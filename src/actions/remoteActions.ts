import { INVALID_BRANCH_REGEXP } from '../parsers';
import { ErrorInfo, GitPushBranchMode } from '../types';
import {
	GitVersionRequirement,
	constructIncompatibleGitVersionMessage,
	doesVersionMeetRequirement
} from '../utils';
import { GitExecutor } from './gitExecutor';

const EOL_REGEX = /\r\n|\r|\n/g;

/**
 * Add a new remote to a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param name The name of the remote.
 * @param url The URL of the remote.
 * @param pushUrl The Push URL of the remote.
 * @param shouldFetch Fetch the remote after it is added.
 * @returns The ErrorInfo from the executed command.
 */
export async function addRemote(
	git: GitExecutor,
	repo: string,
	name: string,
	url: string,
	pushUrl: string | null,
	shouldFetch: boolean
): Promise<ErrorInfo> {
	let status = await git.runGitCommand(['remote', 'add', name, url], repo);
	if (status !== null) return status;

	if (pushUrl !== null) {
		status = await git.runGitCommand(['remote', 'set-url', name, '--push', pushUrl], repo);
		if (status !== null) return status;
	}

	return shouldFetch ? fetch(git, repo, name, false, false) : null;
}

/**
 * Delete an existing remote from a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param name The name of the remote.
 * @returns The ErrorInfo from the executed command.
 */
export function deleteRemote(
	git: GitExecutor,
	repo: string,
	name: string
): Promise<ErrorInfo> {
	return git.runGitCommand(['remote', 'remove', name], repo);
}

/**
 * Edit an existing remote of a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param nameOld The old name of the remote.
 * @param nameNew The new name of the remote.
 * @param urlOld The old URL of the remote.
 * @param urlNew The new URL of the remote.
 * @param pushUrlOld The old Push URL of the remote.
 * @param pushUrlNew The new Push URL of the remote.
 * @returns The ErrorInfo from the executed command.
 */
export async function editRemote(
	git: GitExecutor,
	repo: string,
	nameOld: string,
	nameNew: string,
	urlOld: string | null,
	urlNew: string | null,
	pushUrlOld: string | null,
	pushUrlNew: string | null
): Promise<ErrorInfo> {
	if (nameOld !== nameNew) {
		const status = await git.runGitCommand(['remote', 'rename', nameOld, nameNew], repo);
		if (status !== null) return status;
	}

	if (urlOld !== urlNew) {
		const args = ['remote', 'set-url', nameNew];
		if (urlNew === null) args.push('--delete', urlOld!);
		else if (urlOld === null) args.push('--add', urlNew);
		else args.push(urlNew, urlOld);

		const status = await git.runGitCommand(args, repo);
		if (status !== null) return status;
	}

	if (pushUrlOld !== pushUrlNew) {
		const args = ['remote', 'set-url', '--push', nameNew];
		if (pushUrlNew === null) args.push('--delete', pushUrlOld!);
		else if (pushUrlOld === null) args.push('--add', pushUrlNew);
		else args.push(pushUrlNew, pushUrlOld);

		const status = await git.runGitCommand(args, repo);
		if (status !== null) return status;
	}

	return null;
}

/**
 * Prune an existing remote of a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param name The name of the remote.
 * @returns The ErrorInfo from the executed command.
 */
export function pruneRemote(
	git: GitExecutor,
	repo: string,
	name: string
): Promise<ErrorInfo> {
	return git.runGitCommand(['remote', 'prune', name], repo);
}

/**
 * Fetch from the repository remote(s).
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param remote The remote to fetch, or NULL (fetch all remotes).
 * @param prune Is pruning enabled.
 * @param pruneTags Should tags be pruned.
 * @returns The ErrorInfo from the executed command.
 */
export function fetch(
	git: GitExecutor,
	repo: string,
	remote: string | null,
	prune: boolean,
	pruneTags: boolean
): Promise<ErrorInfo> {
	const args = ['fetch', remote === null ? '--all' : remote];

	if (prune) {
		args.push('--prune');
	}
	if (pruneTags) {
		if (!prune) {
			return Promise.resolve(
				'In order to Prune Tags, pruning must also be enabled when fetching from ' +
				(remote !== null ? 'a remote' : 'remote(s)') + '.'
			);
		}
		const gitExecutable = git.getGitExecutable();
		if (gitExecutable !== null && !doesVersionMeetRequirement(gitExecutable.version, GitVersionRequirement.FetchAndPruneTags)) {
			return Promise.resolve(
				constructIncompatibleGitVersionMessage(gitExecutable, GitVersionRequirement.FetchAndPruneTags, 'pruning tags when fetching')
			);
		}
		args.push('--prune-tags');
	}

	return git.runGitCommand(args, repo);
}

/**
 * Push a branch to a remote.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the branch to push.
 * @param remote The remote to push the branch to.
 * @param setUpstream Set the branch upstream.
 * @param mode The mode of the push.
 * @returns The ErrorInfo from the executed command.
 */
export function pushBranch(
	git: GitExecutor,
	repo: string,
	branchName: string,
	remote: string,
	setUpstream: boolean,
	mode: GitPushBranchMode
): Promise<ErrorInfo> {
	const args = ['push', remote, branchName];
	if (setUpstream) args.push('--set-upstream');
	if (mode !== GitPushBranchMode.Normal) args.push('--' + mode);

	return git.runGitCommand(args, repo);
}

/**
 * Push a branch to multiple remotes.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the branch to push.
 * @param remotes The remotes to push the branch to.
 * @param setUpstream Set the branch upstream.
 * @param mode The mode of the push.
 * @returns The ErrorInfo from the executed commands.
 */
export async function pushBranchToMultipleRemotes(
	git: GitExecutor,
	repo: string,
	branchName: string,
	remotes: string[],
	setUpstream: boolean,
	mode: GitPushBranchMode
): Promise<ErrorInfo[]> {
	if (remotes.length === 0) {
		return ['No remote(s) were specified to push the branch ' + branchName + ' to.'];
	}

	const results: ErrorInfo[] = [];
	for (let i = 0; i < remotes.length; i++) {
		const result = await pushBranch(git, repo, branchName, remotes[i], setUpstream, mode);
		results.push(result);
		if (result !== null) break;
	}
	return results;
}

/**
 * Get the URL of a repository remote.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param remote The name of the remote.
 * @returns The URL, or NULL if an error occurred.
 */
export function getRemoteUrl(
	git: GitExecutor,
	repo: string,
	remote: string
): Promise<string | null> {
	return git.spawnGit(['config', '--get', 'remote.' + remote + '.url'], repo, (stdout) => {
		return stdout.split(EOL_REGEX)[0];
	}).then((url) => url, () => null);
}

/**
 * Get the names of the remotes of a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @returns An array of remote names.
 */
export function getRemotes(
	git: GitExecutor,
	repo: string
): Promise<string[]> {
	return git.spawnGit(['remote'], repo, (stdout) => {
		const lines = stdout.split(EOL_REGEX);
		lines.pop();
		return lines;
	});
}

/**
 * Get the names of the known remotes that contain a specified commit.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param commitHash The hash of the commit to check.
 * @param knownRemotes The list of known remotes to check for.
 * @returns A promise resolving to a list of remote names.
 */
export function getRemotesContainingCommit(
	git: GitExecutor,
	repo: string,
	commitHash: string,
	knownRemotes: string[]
): Promise<string[]> {
	return git.spawnGit(['branch', '-r', '--no-color', '--contains=' + commitHash], repo, (stdout) => {
		const branchNames = stdout.split(EOL_REGEX)
			.filter((line) => line.length > 2)
			.map((line) => line.substring(2).split(' -> ')[0])
			.filter((branchName) => !INVALID_BRANCH_REGEXP.test(branchName));

		return knownRemotes.filter((knownRemote) => {
			const knownRemotePrefix = knownRemote + '/';
			return branchNames.some((branchName) => branchName.startsWith(knownRemotePrefix));
		});
	});
}
