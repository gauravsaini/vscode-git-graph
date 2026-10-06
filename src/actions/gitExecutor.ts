import { Logger } from '../logger';
import { ErrorInfo } from '../types';
import { GitExecutable, GitVersionRequirement } from '../utils';

/**
 * Interface defining the execution environment and capabilities required by Git action modules.
 */
export interface GitExecutor {
	/**
	 * Run a Git command that returns an ErrorInfo (null on success, or an error string on failure).
	 * @param args The arguments to pass to Git.
	 * @param repo The directory of the repository.
	 * @returns A Promise resolving to null on success, or an error message string on failure.
	 */
	runGitCommand: (args: string[], repo: string) => Promise<ErrorInfo>;

	/**
	 * Spawn Git with stdout resolved as a decoded string.
	 * @param args The arguments to pass to Git.
	 * @param repo The directory of the repository.
	 * @param resolveValue Callback function that transforms the stdout string into return type T.
	 */
	spawnGit: <T>(args: string[], repo: string, resolveValue: (stdout: string) => T) => Promise<T>;

	/**
	 * Low-level spawn Git method with stdout Buffer and stderr string.
	 * @param args The arguments to pass to Git.
	 * @param repo The directory of the repository.
	 * @param resolveValue Callback function that transforms stdout Buffer and stderr into return type T.
	 * @param ignoreExitCode If true, non-zero exit codes do not automatically reject the promise.
	 */
	_spawnGit: <T>(
		args: string[],
		repo: string,
		resolveValue: (stdout: Buffer, stderr: string) => T,
		ignoreExitCode?: boolean
	) => Promise<T>;

	/**
	 * Open a Git terminal in VS Code to run interactive or long-running commands.
	 * @param repo The directory of the repository.
	 * @param command The shell command to run in the terminal, or null.
	 * @param name The display name of the terminal.
	 */
	openGitTerminal: (repo: string, command: string | null, name: string) => Promise<ErrorInfo>;

	/**
	 * Get the currently resolved Git executable metadata.
	 * @returns The GitExecutable instance, or null if Git is not found.
	 */
	getGitExecutable: () => GitExecutable | null;

	/**
	 * Get the logger instance for recording commands and diagnostics.
	 */
	getLogger: () => Logger;

	/**
	 * Check whether the active Git executable satisfies a specific version requirement.
	 * @param requirement The required version enum (e.g. GitVersionRequirement.TagDetails).
	 * @returns True if Git version is >= requirement, false otherwise.
	 */
	isGitAtLeastVersion: (requirement: GitVersionRequirement) => boolean;
}
