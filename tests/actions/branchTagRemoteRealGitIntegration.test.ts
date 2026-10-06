import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as branchActions from '../../src/actions/branchActions';
import { GitExecutor } from '../../src/actions/gitExecutor';
import * as remoteActions from '../../src/actions/remoteActions';
import * as tagActions from '../../src/actions/tagActions';
import { Logger } from '../../src/logger';
import { ErrorInfo, GitPushBranchMode, TagType } from '../../src/types';
import { GitExecutable, GitVersionRequirement } from '../../src/utils';

class RealGitExecutor implements GitExecutor {
	constructor(private gitPath: string = 'git') {}

	public runGitCommand(args: string[], repo: string): Promise<ErrorInfo> {
		return new Promise((resolve) => {
			cp.execFile(this.gitPath, args, { cwd: repo }, (error, _stdout, stderr) => {
				if (error) {
					resolve(stderr ? stderr.toString().trim() : error.message);
				} else {
					resolve(null);
				}
			});
		});
	}

	public spawnGit<T>(args: string[], repo: string, resolveValue: (stdout: string) => T): Promise<T> {
		return new Promise((resolve, reject) => {
			cp.execFile(this.gitPath, args, { cwd: repo }, (error, stdout, stderr) => {
				if (error) {
					reject(stderr ? stderr.toString().trim() : error.message);
				} else {
					resolve(resolveValue(stdout.toString()));
				}
			});
		});
	}

	public _spawnGit<T>(
		args: string[],
		repo: string,
		resolveValue: (stdout: Buffer, stderr: string) => T,
		ignoreExitCode: boolean = false
	): Promise<T> {
		return new Promise((resolve, reject) => {
			cp.execFile(this.gitPath, args, { cwd: repo, encoding: 'buffer' }, (error, stdout, stderr) => {
				const stderrStr = stderr ? stderr.toString() : '';
				if (error && !ignoreExitCode) {
					reject(stderrStr || error.message);
				} else {
					resolve(resolveValue(stdout as Buffer, stderrStr));
				}
			});
		});
	}

	public openGitTerminal(): Promise<ErrorInfo> {
		return Promise.resolve(null);
	}

	public getGitExecutable(): GitExecutable | null {
		return { path: this.gitPath, version: '2.39.0' };
	}

	public getLogger(): Logger {
		return {
			log: jest.fn(),
			logCmd: jest.fn(),
			logError: jest.fn()
		} as unknown as Logger;
	}

	public isGitAtLeastVersion(_requirement: GitVersionRequirement): boolean {
		return true;
	}
}

describe('Real Git CLI Empirical Integration Tests', () => {
	let tempDir: string;
	let repoDir: string;
	let remoteBareDir: string;
	let realGit: RealGitExecutor;
	let initialCommitHash: string;

	beforeAll(() => {
		realGit = new RealGitExecutor();
	});

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-graph-real-test-'));
		repoDir = path.join(tempDir, 'repo');
		remoteBareDir = path.join(tempDir, 'remote.git');

		fs.mkdirSync(repoDir);
		fs.mkdirSync(remoteBareDir);

		// Initialize local and bare remote
		cp.execSync('git init -b main', { cwd: repoDir });
		cp.execSync('git config user.name "Test User"', { cwd: repoDir });
		cp.execSync('git config user.email "test@example.com"', { cwd: repoDir });
		cp.execSync('git init --bare', { cwd: remoteBareDir });

		// Initial commit
		fs.writeFileSync(path.join(repoDir, 'file.txt'), 'Hello git-graph');
		cp.execSync('git add file.txt', { cwd: repoDir });
		cp.execSync('git commit -m "Initial commit"', { cwd: repoDir });

		initialCommitHash = cp.execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();

		// Add remote
		cp.execSync(`git remote add origin "${remoteBareDir}"`, { cwd: repoDir });
		cp.execSync('git push -u origin main', { cwd: repoDir });
	});

	afterEach(() => {
		try {
			cp.execSync(`rm -rf "${tempDir}"`);
		} catch {}
	});

	// =========================================================================
	// 1. Real Branch Operations
	// =========================================================================
	describe('branchActions with Real Git', () => {
		it('should create and checkout branch in real git', async () => {
			const statuses = await branchActions.createBranch(realGit, repoDir, 'feat-emp', initialCommitHash, true, false);
			expect(statuses).toEqual([null]);

			const currentBranch = cp.execSync('git branch --show-current', { cwd: repoDir }).toString().trim();
			expect(currentBranch).toBe('feat-emp');
		});

		it('should force create and checkout branch via 2-command sequence in real git', async () => {
			// First create on a different commit / same commit
			await branchActions.createBranch(realGit, repoDir, 'forced-branch', initialCommitHash, false, false);

			// Force recreate and checkout
			const statuses = await branchActions.createBranch(realGit, repoDir, 'forced-branch', initialCommitHash, true, true);
			expect(statuses).toEqual([null, null]);

			const currentBranch = cp.execSync('git branch --show-current', { cwd: repoDir }).toString().trim();
			expect(currentBranch).toBe('forced-branch');
		});

		it('should rename branch in real git', async () => {
			await branchActions.createBranch(realGit, repoDir, 'old-name', initialCommitHash, false, false);
			const err = await branchActions.renameBranch(realGit, repoDir, 'old-name', 'renamed-name');
			expect(err).toBeNull();

			const branches = cp.execSync('git branch', { cwd: repoDir }).toString();
			expect(branches).toContain('renamed-name');
			expect(branches).not.toContain('old-name');
		});

		it('should delete branch in real git', async () => {
			await branchActions.createBranch(realGit, repoDir, 'to-delete', initialCommitHash, false, false);
			const err = await branchActions.deleteBranch(realGit, repoDir, 'to-delete', false);
			expect(err).toBeNull();

			const branches = cp.execSync('git branch', { cwd: repoDir }).toString();
			expect(branches).not.toContain('to-delete');
		});

		it('should delete remote branch and handle fallback when remote ref already deleted on remote', async () => {
			// Push a branch to origin
			cp.execSync('git checkout -b remote-del', { cwd: repoDir });
			cp.execSync('git push -u origin remote-del', { cwd: repoDir });
			cp.execSync('git checkout main', { cwd: repoDir });

			// Simulate another user deleting the branch directly on remote
			cp.execSync('git branch -D remote-del', { cwd: remoteBareDir });

			// Verify local still has stale tracking branch
			let remoteBranches = cp.execSync('git branch -r', { cwd: repoDir }).toString();
			expect(remoteBranches).toContain('origin/remote-del');

			// Delete on remote via branchActions -> should trigger fallback and clean up tracking branch
			const err = await branchActions.deleteRemoteBranch(realGit, repoDir, 'remote-del', 'origin');
			expect(err).toBeNull();

			// Verify tracking branch is now removed locally!
			remoteBranches = cp.execSync('git branch -r', { cwd: repoDir }).toString();
			expect(remoteBranches).not.toContain('origin/remote-del');
		});

		it('should query getBranches correctly in real git', async () => {
			const branchData = await branchActions.getBranches(realGit, repoDir, true, []);
			expect(branchData.error).toBeNull();
			expect(branchData.head).toBe('main');
			expect(branchData.branches).toContain('main');
			expect(branchData.branches).toContain('remotes/origin/main');
		});
	});

	// =========================================================================
	// 2. Real Tag Operations
	// =========================================================================
	describe('tagActions with Real Git', () => {
		it('should add lightweight tag and retrieve its details in real git', async () => {
			const addErr = await tagActions.addTag(realGit, repoDir, 'v1.0.0-lw', initialCommitHash, TagType.Lightweight, '', false);
			expect(addErr).toBeNull();

			const detailsData = await tagActions.getTagDetails(realGit, repoDir, 'v1.0.0-lw');
			expect(detailsData.error).toBeNull();
			expect(detailsData.details?.hash).toBe(initialCommitHash);
			// In real git, %(contents) of lightweight tag dereferences to the target commit subject
			expect(detailsData.details?.message).toBe('Initial commit');
		});

		it('should add annotated tag and retrieve multi-line message in real git', async () => {
			const tagMsg = 'Release 2.0.0\n\n- Feature One\n- Feature Two';
			const addErr = await tagActions.addTag(realGit, repoDir, 'v2.0.0', initialCommitHash, TagType.Annotated, tagMsg, false);
			expect(addErr).toBeNull();

			const detailsData = await tagActions.getTagDetails(realGit, repoDir, 'v2.0.0');
			expect(detailsData.error).toBeNull();
			expect(detailsData.details?.taggerName).toBe('Test User');
			expect(detailsData.details?.taggerEmail).toBe('test@example.com');
			expect(detailsData.details?.message).toBe(tagMsg);
		});

		it('should push tag to remote in real git', async () => {
			await tagActions.addTag(realGit, repoDir, 'v3.0.0', initialCommitHash, TagType.Lightweight, '', false);

			const pushErrs = await tagActions.pushTag(realGit, repoDir, 'v3.0.0', ['origin'], initialCommitHash, false);
			expect(pushErrs).toEqual([null]);

			// Verify tag exists in remote
			const remoteTags = cp.execSync('git tag', { cwd: remoteBareDir }).toString();
			expect(remoteTags).toContain('v3.0.0');
		});

		it('should delete tag on remote and locally in real git', async () => {
			// Create and push tag
			await tagActions.addTag(realGit, repoDir, 'v4.0.0', initialCommitHash, TagType.Lightweight, '', false);
			await tagActions.pushTag(realGit, repoDir, 'v4.0.0', ['origin'], initialCommitHash, true);

			// Delete tag on remote and locally
			const delErr = await tagActions.deleteTag(realGit, repoDir, 'v4.0.0', 'origin');
			expect(delErr).toBeNull();

			const localTags = cp.execSync('git tag', { cwd: repoDir }).toString();
			expect(localTags).not.toContain('v4.0.0');

			const remoteTags = cp.execSync('git tag', { cwd: remoteBareDir }).toString();
			expect(remoteTags).not.toContain('v4.0.0');
		});
	});

	// =========================================================================
	// 3. Real Remote Operations
	// =========================================================================
	describe('remoteActions with Real Git', () => {
		it('should add, get URL, edit, and delete remote in real git', async () => {
			const secondaryBare = path.join(tempDir, 'secondary.git');
			fs.mkdirSync(secondaryBare);
			cp.execSync('git init --bare', { cwd: secondaryBare });

			// Add remote
			const addErr = await remoteActions.addRemote(realGit, repoDir, 'secondary', secondaryBare, null, false);
			expect(addErr).toBeNull();

			// Verify getRemoteUrl
			const url = await remoteActions.getRemoteUrl(realGit, repoDir, 'secondary');
			expect(url).toBe(secondaryBare);

			// Verify getRemotes
			const remotes = await remoteActions.getRemotes(realGit, repoDir);
			expect(remotes).toContain('origin');
			expect(remotes).toContain('secondary');

			// Edit remote (rename secondary -> backup)
			const editErr = await remoteActions.editRemote(realGit, repoDir, 'secondary', 'backup', secondaryBare, secondaryBare, null, null);
			expect(editErr).toBeNull();

			const remotesAfterRename = await remoteActions.getRemotes(realGit, repoDir);
			expect(remotesAfterRename).toContain('backup');
			expect(remotesAfterRename).not.toContain('secondary');

			// Delete remote
			const delErr = await remoteActions.deleteRemote(realGit, repoDir, 'backup');
			expect(delErr).toBeNull();

			const remotesFinal = await remoteActions.getRemotes(realGit, repoDir);
			expect(remotesFinal).not.toContain('backup');
		});

		it('should push branch to multiple remotes in real git', async () => {
			const backupBare = path.join(tempDir, 'backup.git');
			fs.mkdirSync(backupBare);
			cp.execSync('git init --bare', { cwd: backupBare });
			cp.execSync(`git remote add backup "${backupBare}"`, { cwd: repoDir });

			const pushErrs = await remoteActions.pushBranchToMultipleRemotes(
				realGit, repoDir, 'main', ['origin', 'backup'], false, GitPushBranchMode.Normal
			);
			expect(pushErrs).toEqual([null, null]);

			const originBranches = cp.execSync('git branch', { cwd: remoteBareDir }).toString();
			const backupBranches = cp.execSync('git branch', { cwd: backupBare }).toString();
			expect(originBranches).toContain('main');
			expect(backupBranches).toContain('main');
		});

		it('should verify getRemotesContainingCommit in real git', async () => {
			const remotesWithCommit = await remoteActions.getRemotesContainingCommit(
				realGit, repoDir, initialCommitHash, ['origin']
			);
			expect(remotesWithCommit).toEqual(['origin']);
		});
	});
});
