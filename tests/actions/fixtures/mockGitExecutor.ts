import { GitExecutor } from '../../../src/actions/gitExecutor';
import { Logger } from '../../../src/logger';
import { ErrorInfo } from '../../../src/types';
import { GitExecutable, GitVersionRequirement, doesVersionMeetRequirement } from '../../../src/utils';

export interface CommandCall {
	method: 'runGitCommand' | 'spawnGit' | '_spawnGit' | 'openGitTerminal';
	args: string[];
	repo: string;
	ignoreExitCode?: boolean;
}

export class MockGitExecutor implements GitExecutor {
	public calls: CommandCall[] = [];
	public runGitCommandResponses: (ErrorInfo | ((args: string[], repo: string) => Promise<ErrorInfo> | ErrorInfo))[] = [];
	public spawnGitResponses: (string | Error | ((args: string[], repo: string) => Promise<string> | string))[] = [];
	public _spawnGitResponses: ({ stdout: Buffer | string; stderr?: string } | Error | ((args: string[], repo: string, ignoreExitCode?: boolean) => Promise<{ stdout: Buffer | string; stderr?: string }>))[] = [];
	public openGitTerminalResponses: (ErrorInfo | ((repo: string, command: string | null, name: string) => Promise<ErrorInfo> | ErrorInfo))[] = [];

	public gitExecutable: GitExecutable | null = { path: '/path/to/git', version: '2.30.0' };
	public mockLogger = {
		log: jest.fn(),
		logCmd: jest.fn(),
		logError: jest.fn()
	};

	public runGitCommand(args: string[], repo: string): Promise<ErrorInfo> {
		this.calls.push({ method: 'runGitCommand', args, repo });
		if (this.runGitCommandResponses.length > 0) {
			const resp = this.runGitCommandResponses.shift()!;
			if (typeof resp === 'function') {
				return Promise.resolve(resp(args, repo));
			}
			return Promise.resolve(resp);
		}
		return Promise.resolve(null);
	}

	public spawnGit<T>(args: string[], repo: string, resolveValue: (stdout: string) => T): Promise<T> {
		this.calls.push({ method: 'spawnGit', args, repo });
		if (this.spawnGitResponses.length > 0) {
			const resp = this.spawnGitResponses.shift()!;
			if (resp instanceof Error) {
				return Promise.reject(resp.message);
			}
			if (typeof resp === 'function') {
				return Promise.resolve(resp(args, repo)).then(resolveValue);
			}
			return Promise.resolve(resolveValue(resp));
		}
		return Promise.resolve(resolveValue(''));
	}

	public _spawnGit<T>(
		args: string[],
		repo: string,
		resolveValue: (stdout: Buffer, stderr: string) => T,
		ignoreExitCode: boolean = false
	): Promise<T> {
		this.calls.push({ method: '_spawnGit', args, repo, ignoreExitCode });
		if (this._spawnGitResponses.length > 0) {
			const resp = this._spawnGitResponses.shift()!;
			if (resp instanceof Error) {
				return Promise.reject(resp.message);
			}
			if (typeof resp === 'function') {
				return Promise.resolve(resp(args, repo, ignoreExitCode)).then((r) => {
					const buf = Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
					return resolveValue(buf, r.stderr || '');
				});
			}
			const buf = Buffer.isBuffer(resp.stdout) ? resp.stdout : Buffer.from(resp.stdout);
			return Promise.resolve(resolveValue(buf, resp.stderr || ''));
		}
		return Promise.resolve(resolveValue(Buffer.from(''), ''));
	}

	public openGitTerminal(repo: string, command: string | null, name: string): Promise<ErrorInfo> {
		this.calls.push({ method: 'openGitTerminal', args: command ? [command] : [], repo });
		if (this.openGitTerminalResponses.length > 0) {
			const resp = this.openGitTerminalResponses.shift()!;
			if (typeof resp === 'function') {
				return Promise.resolve(resp(repo, command, name));
			}
			return Promise.resolve(resp);
		}
		return Promise.resolve(null);
	}

	public getGitExecutable(): GitExecutable | null {
		return this.gitExecutable;
	}

	public getLogger(): Logger {
		return this.mockLogger as unknown as Logger;
	}

	public isGitAtLeastVersion(requirement: GitVersionRequirement): boolean {
		return this.gitExecutable !== null && doesVersionMeetRequirement(this.gitExecutable.version, requirement);
	}

	public reset() {
		this.calls = [];
		this.runGitCommandResponses = [];
		this.spawnGitResponses = [];
		this._spawnGitResponses = [];
		this.openGitTerminalResponses = [];
		this.gitExecutable = { path: '/path/to/git', version: '2.30.0' };
		this.mockLogger.log.mockClear();
		this.mockLogger.logCmd.mockClear();
		this.mockLogger.logError.mockClear();
	}
}
