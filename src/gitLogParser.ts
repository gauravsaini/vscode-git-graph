import { GitStash } from './types';
import {
	GIT_LOG_SEPARATOR,
	GitCommitRecord,
	ParseLogOptions,
	ParsedGitCommitData,
	UNCOMMITTED,
	assembleCommits,
	parseGitLog,
	parseLogLines
} from './parsers/logParser';
import {
	GitBranchData,
	GitRef,
	GitRefData,
	GitRefTag,
	INVALID_BRANCH_REGEXP,
	REMOTE_HEAD_BRANCH_REGEXP,
	parseBranches,
	parseRefs
} from './parsers/refParser';

export {
	UNCOMMITTED,
	GIT_LOG_SEPARATOR,
	GitCommitRecord,
	ParseLogOptions,
	ParsedGitCommitData,
	parseLogLines,
	assembleCommits,
	parseGitLog
};

export {
	INVALID_BRANCH_REGEXP,
	REMOTE_HEAD_BRANCH_REGEXP,
	GitRef,
	GitRefTag,
	GitRefData,
	GitBranchData,
	parseRefs,
	parseBranches
};

/**
 * Backward-compatibility wrapper class matching the original GitLogParser static API.
 * Delegates all operations to pure parser functions in src/parsers/.
 */
export class GitLogParser {
	public static parseRefs(
		stdout: string,
		hideRemotes: ReadonlyArray<string> = [],
		showRemoteHeads: boolean = false
	): GitRefData {
		return parseRefs(stdout, hideRemotes, showRemoteHeads);
	}

	public static parseLogLines(stdout: string): GitCommitRecord[] {
		return parseLogLines(stdout);
	}

	public static assembleCommits(
		commits: GitCommitRecord[],
		refData: GitRefData,
		stashes: ReadonlyArray<GitStash>,
		options: ParseLogOptions
	): ParsedGitCommitData {
		return assembleCommits(commits, refData, stashes, options);
	}

	public static parse(
		logStdout: string,
		refsStdout: string,
		stashes: ReadonlyArray<GitStash>,
		options: ParseLogOptions,
		wasmModule?: any
	): ParsedGitCommitData {
		return parseGitLog(logStdout, refsStdout, stashes, options, wasmModule);
	}
}
