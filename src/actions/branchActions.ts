import { getConfig } from '../config';
import { GitBranchData, parseBranches } from '../parsers';
import { ErrorInfo, MergeActionOn } from '../types';
import { areStagedChanges, commitSquashIfStagedChangesExist } from './commitActions';
import { GitExecutor } from './gitExecutor';

export { areStagedChanges, commitSquashIfStagedChangesExist };

/**
 * Checkout a branch in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the branch to checkout.
 * @param remoteBranch The name of the remote branch to check out (if not NULL).
 * @returns The ErrorInfo from the executed command.
 */
export function checkoutBranch(
	git: GitExecutor,
	repo: string,
	branchName: string,
	remoteBranch: string | null
): Promise<ErrorInfo> {
	const args = ['checkout'];
	if (remoteBranch === null) args.push(branchName);
	else args.push('-b', branchName, remoteBranch);

	return git.runGitCommand(args, repo);
}

/**
 * Create a branch at a commit.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the branch.
 * @param commitHash The hash of the commit the branch should be created at.
 * @param checkout Check out the branch after it is created.
 * @param force Force create the branch, replacing an existing branch with the same name (if it exists).
 * @returns The ErrorInfo's from the executed command(s).
 */
export async function createBranch(
	git: GitExecutor,
	repo: string,
	branchName: string,
	commitHash: string,
	checkout: boolean,
	force: boolean
): Promise<ErrorInfo[]> {
	const args: string[] = [];
	if (checkout && !force) {
		args.push('checkout', '-b');
	} else {
		args.push('branch');
		if (force) {
			args.push('-f');
		}
	}
	args.push(branchName, commitHash);

	const statuses = [await git.runGitCommand(args, repo)];
	if (statuses[0] === null && checkout && force) {
		statuses.push(await checkoutBranch(git, repo, branchName, null));
	}
	return statuses;
}

/**
 * Delete a branch in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the branch.
 * @param force Should force the branch to be deleted (even if not merged).
 * @returns The ErrorInfo from the executed command.
 */
export function deleteBranch(
	git: GitExecutor,
	repo: string,
	branchName: string,
	force: boolean
): Promise<ErrorInfo> {
	return git.runGitCommand(['branch', force ? '-D' : '-d', branchName], repo);
}

/**
 * Delete a remote branch in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the branch.
 * @param remote The name of the remote to delete the branch on.
 * @returns The ErrorInfo from the executed command.
 */
export async function deleteRemoteBranch(
	git: GitExecutor,
	repo: string,
	branchName: string,
	remote: string
): Promise<ErrorInfo> {
	const remoteStatus = await git.runGitCommand(['push', remote, '--delete', branchName], repo);
	if (remoteStatus !== null && /remote ref does not exist/i.test(remoteStatus)) {
		const trackingBranchStatus = await git.runGitCommand(['branch', '-d', '-r', remote + '/' + branchName], repo);
		return trackingBranchStatus === null ? null : 'Branch does not exist on the remote, deleting the remote tracking branch ' + remote + '/' + branchName + '.\n' + trackingBranchStatus;
	}
	return remoteStatus;
}

/**
 * Fetch a remote branch into a local branch.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param remote The name of the remote containing the remote branch.
 * @param remoteBranch The name of the remote branch.
 * @param localBranch The name of the local branch.
 * @param force Force fetch the remote branch.
 * @returns The ErrorInfo from the executed command.
 */
export function fetchIntoLocalBranch(
	git: GitExecutor,
	repo: string,
	remote: string,
	remoteBranch: string,
	localBranch: string,
	force: boolean
): Promise<ErrorInfo> {
	const args = ['fetch'];
	if (force) {
		args.push('-f');
	}
	args.push(remote, remoteBranch + ':' + localBranch);
	return git.runGitCommand(args, repo);
}

/**
 * Pull a remote branch into the current branch.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param branchName The name of the remote branch.
 * @param remote The name of the remote containing the remote branch.
 * @param createNewCommit Is `--no-ff` enabled if a merge is required.
 * @param squash Is `--squash` enabled if a merge is required.
 * @returns The ErrorInfo from the executed command.
 */
export function pullBranch(
	git: GitExecutor,
	repo: string,
	branchName: string,
	remote: string,
	createNewCommit: boolean,
	squash: boolean
): Promise<ErrorInfo> {
	const args = ['pull', remote, branchName], config = getConfig();
	if (squash) {
		args.push('--squash');
	} else if (createNewCommit) {
		args.push('--no-ff');
	}
	if (config.signCommits) {
		args.push('-S');
	}
	return git.runGitCommand(args, repo).then((pullStatus) => {
		return pullStatus === null && squash
			? commitSquashIfStagedChangesExist(git, repo, remote + '/' + branchName, MergeActionOn.Branch, config.squashPullMessageFormat, config.signCommits)
			: pullStatus;
	});
}

/**
 * Rename a branch in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param oldName The old name of the branch.
 * @param newName The new name of the branch.
 * @returns The ErrorInfo from the executed command.
 */
export function renameBranch(
	git: GitExecutor,
	repo: string,
	oldName: string,
	newName: string
): Promise<ErrorInfo> {
	return git.runGitCommand(['branch', '-m', oldName, newName], repo);
}

/**
 * Get the branches in a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param showRemoteBranches Are remote branches shown.
 * @param hideRemotes An array of hidden remotes.
 * @returns The branch data.
 */
export function getBranches(
	git: GitExecutor,
	repo: string,
	showRemoteBranches: boolean,
	hideRemotes: ReadonlyArray<string>
): Promise<GitBranchData> {
	const args = ['branch'];
	if (showRemoteBranches) args.push('-a');
	args.push('--no-color');

	const showRemoteHeads = getConfig().showRemoteHeads;

	return git.spawnGit(args, repo, (stdout) => {
		return parseBranches(stdout, hideRemotes, showRemoteHeads);
	});
}
