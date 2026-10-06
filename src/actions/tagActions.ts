import { getConfig } from '../config';
import { GIT_LOG_SEPARATOR, parseTagSignature } from '../parsers';
import {
	ErrorInfo,
	ErrorInfoExtensionPrefix,
	GitSignature,
	GitSignatureStatus,
	GitTagDetails,
	TagType
} from '../types';
import {
	GitVersionRequirement,
	constructIncompatibleGitVersionMessage
} from '../utils';
import { GitExecutor } from './gitExecutor';
import { getRemotesContainingCommit } from './remoteActions';

const EOL_REGEX = /\r\n|\r|\n/g;

export interface GitTagDetailsData {
	details: GitTagDetails | null;
	error: ErrorInfo;
}

/**
 * Add a new tag to a commit.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param tagName The name of the tag.
 * @param commitHash The hash of the commit the tag should be added to.
 * @param type Is the tag annotated or lightweight.
 * @param message The message of the tag (if it is an annotated tag).
 * @param force Force add the tag, replacing an existing tag with the same name (if it exists).
 * @returns The ErrorInfo from the executed command.
 */
export function addTag(
	git: GitExecutor,
	repo: string,
	tagName: string,
	commitHash: string,
	type: TagType,
	message: string,
	force: boolean
): Promise<ErrorInfo> {
	const args = ['tag'];
	if (force) {
		args.push('-f');
	}
	if (type === TagType.Lightweight) {
		args.push(tagName);
	} else {
		args.push(getConfig().signTags ? '-s' : '-a', tagName, '-m', message);
	}
	args.push(commitHash);
	return git.runGitCommand(args, repo);
}

/**
 * Delete an existing tag from a repository.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param tagName The name of the tag.
 * @param deleteOnRemote The name of the remote to delete the tag on, or NULL.
 * @returns The ErrorInfo from the executed command.
 */
export async function deleteTag(
	git: GitExecutor,
	repo: string,
	tagName: string,
	deleteOnRemote: string | null
): Promise<ErrorInfo> {
	if (deleteOnRemote !== null) {
		const status = await git.runGitCommand(['push', deleteOnRemote, '--delete', tagName], repo);
		if (status !== null) return status;
	}
	return git.runGitCommand(['tag', '-d', tagName], repo);
}

/**
 * Push a tag to remote(s).
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param tagName The name of the tag to push.
 * @param remotes The remote(s) to push the tag to.
 * @param commitHash The commit hash the tag is on.
 * @param skipRemoteCheck Skip checking that the tag is on each of the `remotes`.
 * @returns The ErrorInfo's from the executed commands.
 */
export async function pushTag(
	git: GitExecutor,
	repo: string,
	tagName: string,
	remotes: string[],
	commitHash: string,
	skipRemoteCheck: boolean
): Promise<ErrorInfo[]> {
	if (remotes.length === 0) {
		return ['No remote(s) were specified to push the tag ' + tagName + ' to.'];
	}

	if (!skipRemoteCheck) {
		const remotesContainingCommit = await getRemotesContainingCommit(git, repo, commitHash, remotes).catch(() => remotes);
		const remotesNotContainingCommit = remotes.filter((remote) => !remotesContainingCommit.includes(remote));
		if (remotesNotContainingCommit.length > 0) {
			return [ErrorInfoExtensionPrefix.PushTagCommitNotOnRemote + JSON.stringify(remotesNotContainingCommit)];
		}
	}

	const results: ErrorInfo[] = [];
	for (let i = 0; i < remotes.length; i++) {
		const result = await git.runGitCommand(['push', remotes[i], tagName], repo);
		results.push(result);
		if (result !== null) break;
	}
	return results;
}

/**
 * Get the details of a tag.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param tagName The name of the tag.
 * @returns The tag details.
 */
export function getTagDetails(
	git: GitExecutor,
	repo: string,
	tagName: string
): Promise<GitTagDetailsData> {
	const gitExecutable = git.getGitExecutable();
	if (gitExecutable !== null && !git.isGitAtLeastVersion(GitVersionRequirement.TagDetails)) {
		return Promise.resolve({
			details: null,
			error: constructIncompatibleGitVersionMessage(gitExecutable, GitVersionRequirement.TagDetails, 'retrieving Tag Details')
		});
	}

	const ref = 'refs/tags/' + tagName;
	return git.spawnGit(['for-each-ref', ref, '--format=' + ['%(objectname)', '%(taggername)', '%(taggeremail)', '%(taggerdate:unix)', '%(contents:signature)', '%(contents)'].join(GIT_LOG_SEPARATOR)], repo, (stdout) => {
		const data = stdout.split(GIT_LOG_SEPARATOR);
		return {
			hash: data[0],
			taggerName: data[1],
			taggerEmail: data[2].substring(data[2].startsWith('<') ? 1 : 0, data[2].length - (data[2].endsWith('>') ? 1 : 0)),
			taggerDate: parseInt(data[3]),
			message: removeTrailingBlankLines(data.slice(5).join(GIT_LOG_SEPARATOR).replace(data[4], '').split(EOL_REGEX)).join('\n'),
			signed: data[4] !== ''
		};
	}).then(async (tag) => ({
		details: {
			hash: tag.hash,
			taggerName: tag.taggerName,
			taggerEmail: tag.taggerEmail,
			taggerDate: tag.taggerDate,
			message: tag.message,
			signature: tag.signed
				? await getTagSignature(git, repo, ref)
				: null
		},
		error: null
	})).catch((errorMessage) => ({
		details: null,
		error: errorMessage
	}));
}

/**
 * Get the signature of a signed tag.
 * @param git The Git executor instance.
 * @param repo The path of the repository.
 * @param ref The reference identifying the tag.
 * @returns A Promise resolving to the signature.
 */
export function getTagSignature(git: GitExecutor, repo: string, ref: string): Promise<GitSignature> {
	return git._spawnGit(['verify-tag', '--raw', ref], repo, (stdout, stderr) => stderr || stdout.toString(), true)
		.then((output) => parseTagSignature(output))
		.catch(() => ({
			status: GitSignatureStatus.CannotBeChecked,
			key: '',
			signer: ''
		}));
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
