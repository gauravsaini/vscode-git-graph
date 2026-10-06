import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as branchActions from '../../src/actions/branchActions';
import * as commitActions from '../../src/actions/commitActions';
import * as diffActions from '../../src/actions/diffActions';
import * as remoteActions from '../../src/actions/remoteActions';
import * as stashActions from '../../src/actions/stashActions';
import * as tagActions from '../../src/actions/tagActions';
import { GIT_LOG_SEPARATOR } from '../../src/parsers';
import {
	ErrorInfoExtensionPrefix,
	GitFileStatus,
	GitPushBranchMode,
	GitResetMode,
	GitSignatureStatus,
	MergeActionOn,
	RebaseActionOn,
	SquashMessageFormat,
	TagType
} from '../../src/types';
import {
	GitVersionRequirement,
	UNABLE_TO_FIND_GIT_MSG,
	UNCOMMITTED
} from '../../src/utils';
import { MockGitExecutor } from './fixtures/mockGitExecutor';

const REPO = '/path/to/repo';

describe('Actions Subsystem Unit Tests', () => {
	let git: MockGitExecutor;

	beforeEach(() => {
		git = new MockGitExecutor();
		(vscode.window.showErrorMessage as jest.Mock).mockReturnValue(Promise.resolve(undefined));
	});

	// =========================================================================
	// 0. MockGitExecutor Unit Verification
	// =========================================================================
	describe('MockGitExecutor', () => {
		it('should record runGitCommand and return configured responses', async () => {
			git.runGitCommandResponses.push('fatal: error');
			const res1 = await git.runGitCommand(['status'], REPO);
			expect(res1).toBe('fatal: error');

			const res2 = await git.runGitCommand(['log'], REPO);
			expect(res2).toBeNull();
			expect(git.calls).toEqual([
				{ method: 'runGitCommand', args: ['status'], repo: REPO },
				{ method: 'runGitCommand', args: ['log'], repo: REPO }
			]);
		});

		it('should record spawnGit and resolve string values', async () => {
			git.spawnGitResponses.push('output 123');
			const parsed = await git.spawnGit(['rev-parse', 'HEAD'], REPO, (stdout) => stdout.trim());
			expect(parsed).toBe('output 123');
			expect(git.calls[0]).toEqual({ method: 'spawnGit', args: ['rev-parse', 'HEAD'], repo: REPO });
		});

		it('should record _spawnGit with Buffer and ignoreExitCode', async () => {
			git._spawnGitResponses.push({ stdout: Buffer.from('hello'), stderr: 'some warning' });
			const result = await git._spawnGit(['show'], REPO, (stdout, stderr) => ({ out: stdout.toString(), err: stderr }), true);
			expect(result).toEqual({ out: 'hello', err: 'some warning' });
			expect(git.calls[0]).toEqual({ method: '_spawnGit', args: ['show'], repo: REPO, ignoreExitCode: true });
		});

		it('should check version requirement correctly', () => {
			git.gitExecutable = { path: '/git', version: '2.30.0' };
			expect(git.isGitAtLeastVersion(GitVersionRequirement.PushStash)).toBe(true);
			git.gitExecutable = { path: '/git', version: '2.10.0' };
			expect(git.isGitAtLeastVersion(GitVersionRequirement.PushStash)).toBe(false);
			git.gitExecutable = null;
			expect(git.isGitAtLeastVersion(GitVersionRequirement.PushStash)).toBe(false);
		});
	});

	// =========================================================================
	// 1. branchActions
	// =========================================================================
	describe('branchActions', () => {
		describe('checkoutBranch', () => {
			it('should checkout a local branch', async () => {
				const status = await branchActions.checkoutBranch(git, REPO, 'feature-x', null);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['checkout', 'feature-x'], repo: REPO }
				]);
			});

			it('should checkout and track a remote branch with -b flag', async () => {
				const status = await branchActions.checkoutBranch(git, REPO, 'feature-x', 'origin/feature-x');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['checkout', '-b', 'feature-x', 'origin/feature-x'], repo: REPO }
				]);
			});

			it('should propagate checkout failure error', async () => {
				git.runGitCommandResponses.push('error: pathspec not found');
				const status = await branchActions.checkoutBranch(git, REPO, 'missing', null);
				expect(status).toBe('error: pathspec not found');
			});
		});

		describe('createBranch', () => {
			it('should standard create a branch without checking out', async () => {
				const statuses = await branchActions.createBranch(git, REPO, 'new-br', 'hash123', false, false);
				expect(statuses).toEqual([null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', 'new-br', 'hash123'], repo: REPO }
				]);
			});

			it('should checkout create a branch when checkout is true and force is false', async () => {
				const statuses = await branchActions.createBranch(git, REPO, 'new-br', 'hash123', true, false);
				expect(statuses).toEqual([null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['checkout', '-b', 'new-br', 'hash123'], repo: REPO }
				]);
			});

			it('should force create a branch when force is true and checkout is false', async () => {
				const statuses = await branchActions.createBranch(git, REPO, 'new-br', 'hash123', false, true);
				expect(statuses).toEqual([null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', '-f', 'new-br', 'hash123'], repo: REPO }
				]);
			});

			it('should execute 2-command sequence when force create and checkout are both true', async () => {
				const statuses = await branchActions.createBranch(git, REPO, 'new-br', 'hash123', true, true);
				expect(statuses).toEqual([null, null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', '-f', 'new-br', 'hash123'], repo: REPO },
					{ method: 'runGitCommand', args: ['checkout', 'new-br'], repo: REPO }
				]);
			});

			it('should halt after step 1 if branch force creation fails', async () => {
				git.runGitCommandResponses.push('fatal: cannot force create');
				const statuses = await branchActions.createBranch(git, REPO, 'new-br', 'hash123', true, true);
				expect(statuses).toEqual(['fatal: cannot force create']);
				expect(git.calls.length).toBe(1);
			});

			it('should return failure status for step 2 if follow-up checkout fails', async () => {
				git.runGitCommandResponses.push(null, 'error: checkout failed');
				const statuses = await branchActions.createBranch(git, REPO, 'new-br', 'hash123', true, true);
				expect(statuses).toEqual([null, 'error: checkout failed']);
				expect(git.calls.length).toBe(2);
			});
		});

		describe('deleteBranch', () => {
			it('should safe delete a branch with -d', async () => {
				const status = await branchActions.deleteBranch(git, REPO, 'feat', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', '-d', 'feat'], repo: REPO }
				]);
			});

			it('should force delete a branch with -D', async () => {
				const status = await branchActions.deleteBranch(git, REPO, 'feat', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', '-D', 'feat'], repo: REPO }
				]);
			});

			it('should propagate branch deletion error', async () => {
				git.runGitCommandResponses.push('error: branch not fully merged');
				const status = await branchActions.deleteBranch(git, REPO, 'feat', false);
				expect(status).toBe('error: branch not fully merged');
			});
		});

		describe('deleteRemoteBranch', () => {
			it('should delete a remote branch using push --delete', async () => {
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', '--delete', 'feat'], repo: REPO }
				]);
			});

			it('should fallback to branch -d -r when remote ref does not exist and succeed', async () => {
				git.runGitCommandResponses.push('error: unable to delete "feat": remote ref does not exist', null);
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', '--delete', 'feat'], repo: REPO },
					{ method: 'runGitCommand', args: ['branch', '-d', '-r', 'origin/feat'], repo: REPO }
				]);
			});

			it('should return composite error message when fallback deletion fails', async () => {
				git.runGitCommandResponses.push('error: remote ref does not exist', 'error: tracking branch not found');
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBe('Branch does not exist on the remote, deleting the remote tracking branch origin/feat.\nerror: tracking branch not found');
			});

			it('should return error directly without fallback for non-matching push errors', async () => {
				git.runGitCommandResponses.push('fatal: Authentication failed');
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBe('fatal: Authentication failed');
				expect(git.calls.length).toBe(1);
			});
		});

		describe('fetchIntoLocalBranch', () => {
			it('should fetch into local branch without force', async () => {
				const status = await branchActions.fetchIntoLocalBranch(git, REPO, 'origin', 'main', 'main', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['fetch', 'origin', 'main:main'], repo: REPO }
				]);
			});

			it('should fetch into local branch with force flag -f', async () => {
				const status = await branchActions.fetchIntoLocalBranch(git, REPO, 'origin', 'main', 'main', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['fetch', '-f', 'origin', 'main:main'], repo: REPO }
				]);
			});
		});

		describe('pullBranch', () => {
			it('should perform normal pull', async () => {
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main'], repo: REPO }
				]);
			});

			it('should pull with --no-ff when createNewCommit is true', async () => {
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', true, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main', '--no-ff'], repo: REPO }
				]);
			});

			it('should sign commit when signCommits configuration is true', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', true, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main', '--no-ff', '-S'], repo: REPO }
				]);
			});

			it('should pull with --squash and commit staged changes when they exist', async () => {
				git.spawnGitResponses.push('staged-changes-exist');
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO },
					{ method: 'runGitCommand', args: ['commit', '-m', 'Merge branch \'origin/main\''], repo: REPO }
				]);
			});

			it('should pull with --squash and skip commit when no staged changes exist', async () => {
				git.spawnGitResponses.push('');
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO }
				]);
			});

			it('should use --no-edit for squash commit message when custom format configured', async () => {
				vscode.mockExtensionSettingReturnValue('dialog.pullBranch.squashMessageFormat', 'Git SQUASH_MSG');
				git.spawnGitResponses.push('changes');
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, true);
				expect(status).toBeNull();
				expect(git.calls[2]).toEqual(
					{ method: 'runGitCommand', args: ['commit', '--no-edit'], repo: REPO }
				);
			});
		});

		describe('renameBranch', () => {
			it('should rename branch using -m', async () => {
				const status = await branchActions.renameBranch(git, REPO, 'old-name', 'new-name');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', '-m', 'old-name', 'new-name'], repo: REPO }
				]);
			});
		});

		describe('getBranches', () => {
			it('should query branches without remotes', async () => {
				git.spawnGitResponses.push('* main\n  feature\n');
				const result = await branchActions.getBranches(git, REPO, false, []);
				expect(result.branches).toEqual(['main', 'feature']);
				expect(result.head).toBe('main');
				expect(result.error).toBeNull();
				expect(git.calls[0].args).toEqual(['branch', '--no-color']);
			});

			it('should query branches with remotes when showRemoteBranches is true', async () => {
				git.spawnGitResponses.push('* main\n  remotes/origin/main\n  remotes/hidden/branch\n');
				const result = await branchActions.getBranches(git, REPO, true, ['hidden']);
				expect(result.branches).toEqual(['main', 'remotes/origin/main']);
				expect(git.calls[0].args).toEqual(['branch', '-a', '--no-color']);
			});
		});

		describe('areStagedChanges', () => {
			it('should return true when diff-index outputs changes', async () => {
				git.spawnGitResponses.push(':100644 100644 hash1 hash2 M\tfile.txt');
				const res = await branchActions.areStagedChanges(git, REPO);
				expect(res).toBe(true);
			});

			it('should return false when diff-index outputs empty string or rejects', async () => {
				git.spawnGitResponses.push('');
				expect(await branchActions.areStagedChanges(git, REPO)).toBe(false);

				git.spawnGitResponses.push(new Error('diff failed'));
				expect(await branchActions.areStagedChanges(git, REPO)).toBe(false);
			});
		});

		describe('commitSquashIfStagedChangesExist', () => {
			it('should return null if no staged changes exist', async () => {
				git.spawnGitResponses.push('');
				const res = await branchActions.commitSquashIfStagedChangesExist(
					git,
					REPO,
					'origin/feat',
					MergeActionOn.Branch,
					SquashMessageFormat.Default,
					false
				);
				expect(res).toBeNull();
			});
		});
	});

	// =========================================================================
	// 2. tagActions
	// =========================================================================
	describe('tagActions', () => {
		describe('addTag', () => {
			it('should add a lightweight tag', async () => {
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Lightweight, '', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['tag', 'v1.0.0', 'hash1'], repo: REPO }
				]);
			});

			it('should add an annotated tag with -a', async () => {
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Annotated, 'Initial release', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['tag', '-a', 'v1.0.0', '-m', 'Initial release', 'hash1'], repo: REPO }
				]);
			});

			it('should add a signed tag with -s when signTags setting is true', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.tags', true);
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Annotated, 'Release signed', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['tag', '-s', 'v1.0.0', '-m', 'Release signed', 'hash1'], repo: REPO }
				]);
			});

			it('should force add a tag with -f', async () => {
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Lightweight, '', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['tag', '-f', 'v1.0.0', 'hash1'], repo: REPO }
				]);
			});
		});

		describe('deleteTag', () => {
			it('should delete a local tag only when deleteOnRemote is null', async () => {
				const status = await tagActions.deleteTag(git, REPO, 'v1.0.0', null);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['tag', '-d', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should delete on remote first then delete locally', async () => {
				const status = await tagActions.deleteTag(git, REPO, 'v1.0.0', 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', '--delete', 'v1.0.0'], repo: REPO },
					{ method: 'runGitCommand', args: ['tag', '-d', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should abort local deletion if remote deletion fails', async () => {
				git.runGitCommandResponses.push('remote push rejected');
				const status = await tagActions.deleteTag(git, REPO, 'v1.0.0', 'origin');
				expect(status).toBe('remote push rejected');
				expect(git.calls.length).toBe(1);
			});
		});

		describe('pushTag', () => {
			it('should return error when no remotes are specified', async () => {
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', [], 'hash1', false);
				expect(errors).toEqual(['No remote(s) were specified to push the tag v1.0.0 to.']);
				expect(git.calls.length).toBe(0);
			});

			it('should verify commit containment on remote and push if contained', async () => {
				git.spawnGitResponses.push('  origin/main\n');
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin'], 'hash1', false);
				expect(errors).toEqual([null]);
				expect(git.calls).toEqual([
					{ method: 'spawnGit', args: ['branch', '-r', '--no-color', '--contains=hash1'], repo: REPO },
					{ method: 'runGitCommand', args: ['push', 'origin', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should return PushTagCommitNotOnRemote error if commit is not on remote', async () => {
				git.spawnGitResponses.push('  upstream/main\n');
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin'], 'hash1', false);
				expect(errors).toEqual([ErrorInfoExtensionPrefix.PushTagCommitNotOnRemote + JSON.stringify(['origin'])]);
				expect(git.calls.length).toBe(1);
			});

			it('should skip remote check when skipRemoteCheck is true', async () => {
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', true);
				expect(errors).toEqual([null, null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', 'v1.0.0'], repo: REPO },
					{ method: 'runGitCommand', args: ['push', 'upstream', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should terminate loop early if an error occurs during multi-remote push', async () => {
				git.runGitCommandResponses.push('error pushing to origin');
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', true);
				expect(errors).toEqual(['error pushing to origin']);
				expect(git.calls.length).toBe(1);
			});
		});

		describe('getTagDetails', () => {
			it('should return incompatible version error if git version is < 1.7.8', async () => {
				git.gitExecutable = { path: '/git', version: '1.7.2' };
				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.details).toBeNull();
				expect(data.error).toContain('A newer version of Git (>= 1.7.8) is required');
			});

			it('should parse lightweight tag details', async () => {
				const stdout = ['hash123', '', '', '', '', ''].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.error).toBeNull();
				expect(data.details).toEqual({
					hash: 'hash123',
					taggerName: '',
					taggerEmail: '',
					taggerDate: NaN,
					message: '',
					signature: null
				});
			});

			it('should parse annotated tag details with multi-line message', async () => {
				const stdout = [
					'hash123',
					'John Doe',
					'<john@example.com>',
					'1600000000',
					'',
					'Line 1 of message\n\nLine 2 of message\n\n'
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.error).toBeNull();
				expect(data.details).toEqual({
					hash: 'hash123',
					taggerName: 'John Doe',
					taggerEmail: 'john@example.com',
					taggerDate: 1600000000,
					message: 'Line 1 of message\n\nLine 2 of message',
					signature: null
				});
			});

			it('should integrate signed tag details by resolving getTagSignature', async () => {
				const stdout = [
					'hash123',
					'John Doe',
					'<john@example.com>',
					'1600000000',
					'gpg-signature-data',
					'Release message\ngpg-signature-data'
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const gpgOutput = '[GNUPG:] GOODSIG 12345 John Doe <john@example.com>\n[GNUPG:] VALIDSIG 12345';
				git._spawnGitResponses.push({ stdout: Buffer.from(gpgOutput), stderr: '' });

				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.error).toBeNull();
				expect(data.details?.signature).not.toBeNull();
				expect(data.details?.signature?.status).toBe(GitSignatureStatus.GoodAndValid);
			});

			it('should handle getTagDetails command error', async () => {
				git.spawnGitResponses.push(new Error('fatal: ref not found'));
				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.details).toBeNull();
				expect(data.error).toBe('fatal: ref not found');
			});
		});

		describe('getTagSignature', () => {
			it('should invoke verify-tag --raw and parse signature', async () => {
				const gpgOutput = '[GNUPG:] GOODSIG ABCDEF Alice <alice@example.com>';
				git._spawnGitResponses.push({ stdout: Buffer.from(gpgOutput), stderr: '' });

				const sig = await tagActions.getTagSignature(git, REPO, 'refs/tags/v1.0.0');
				expect(sig.status).toBe(GitSignatureStatus.GoodAndValid);
				expect(sig.key).toBe('ABCDEF');
				expect(sig.signer).toBe('Alice <alice@example.com>');
				expect(git.calls[0]).toEqual({
					method: '_spawnGit',
					args: ['verify-tag', '--raw', 'refs/tags/v1.0.0'],
					repo: REPO,
					ignoreExitCode: true
				});
			});

			it('should fallback to CannotBeChecked if _spawnGit rejects', async () => {
				git._spawnGitResponses.push(new Error('command failed'));
				const sig = await tagActions.getTagSignature(git, REPO, 'refs/tags/v1.0.0');
				expect(sig).toEqual({
					status: GitSignatureStatus.CannotBeChecked,
					key: '',
					signer: ''
				});
			});
		});
	});

	// =========================================================================
	// 3. remoteActions
	// =========================================================================
	describe('remoteActions', () => {
		describe('addRemote', () => {
			it('should add basic remote without pushUrl and fetch', async () => {
				const status = await remoteActions.addRemote(git, REPO, 'upstream', 'https://github.com/up.git', null, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'add', 'upstream', 'https://github.com/up.git'], repo: REPO }
				]);
			});

			it('should add remote with pushUrl and trigger fetch', async () => {
				const status = await remoteActions.addRemote(git, REPO, 'upstream', 'https://github.com/up.git', 'https://push.git', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'add', 'upstream', 'https://github.com/up.git'], repo: REPO },
					{ method: 'runGitCommand', args: ['remote', 'set-url', 'upstream', '--push', 'https://push.git'], repo: REPO },
					{ method: 'runGitCommand', args: ['fetch', 'upstream'], repo: REPO }
				]);
			});

			it('should halt immediately on remote add failure', async () => {
				git.runGitCommandResponses.push('fatal: remote already exists');
				const status = await remoteActions.addRemote(git, REPO, 'upstream', 'url', 'pushUrl', true);
				expect(status).toBe('fatal: remote already exists');
				expect(git.calls.length).toBe(1);
			});
		});

		describe('deleteRemote', () => {
			it('should remove remote', async () => {
				const status = await remoteActions.deleteRemote(git, REPO, 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'remove', 'origin'], repo: REPO }
				]);
			});
		});

		describe('editRemote', () => {
			it('should rename remote when name changes', async () => {
				const status = await remoteActions.editRemote(git, REPO, 'origin', 'upstream', null, null, null, null);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'rename', 'origin', 'upstream'], repo: REPO }
				]);
			});

			it('should handle url delete, add, and update', async () => {
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', 'oldUrl', null, null, null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', 'origin', '--delete', 'oldUrl']);

				git.reset();
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, 'newUrl', null, null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', 'origin', '--add', 'newUrl']);

				git.reset();
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', 'oldUrl', 'newUrl', null, null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', 'origin', 'newUrl', 'oldUrl']);
			});

			it('should handle pushUrl delete, add, and update', async () => {
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, null, 'oldPush', null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', '--push', 'origin', '--delete', 'oldPush']);

				git.reset();
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, null, null, 'newPush');
				expect(git.calls[0].args).toEqual(['remote', 'set-url', '--push', 'origin', '--add', 'newPush']);

				git.reset();
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, null, 'oldPush', 'newPush');
				expect(git.calls[0].args).toEqual(['remote', 'set-url', '--push', 'origin', 'newPush', 'oldPush']);
			});

			it('should halt on rename error without updating urls', async () => {
				git.runGitCommandResponses.push('error: rename failed');
				const status = await remoteActions.editRemote(git, REPO, 'old', 'new', 'urlOld', 'urlNew', null, null);
				expect(status).toBe('error: rename failed');
				expect(git.calls.length).toBe(1);
			});
		});

		describe('pruneRemote', () => {
			it('should prune remote', async () => {
				const status = await remoteActions.pruneRemote(git, REPO, 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'prune', 'origin'], repo: REPO }
				]);
			});
		});

		describe('fetch', () => {
			it('should fetch all remotes when remote is null', async () => {
				const status = await remoteActions.fetch(git, REPO, null, false, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['fetch', '--all'], repo: REPO }
				]);
			});

			it('should fetch specific remote with prune flag', async () => {
				const status = await remoteActions.fetch(git, REPO, 'origin', true, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['fetch', 'origin', '--prune'], repo: REPO }
				]);
			});

			it('should reject prune-tags if prune is false', async () => {
				const status1 = await remoteActions.fetch(git, REPO, 'origin', false, true);
				expect(status1).toContain('In order to Prune Tags, pruning must also be enabled when fetching from a remote.');

				const status2 = await remoteActions.fetch(git, REPO, null, false, true);
				expect(status2).toContain('In order to Prune Tags, pruning must also be enabled when fetching from remote(s).');
			});

			it('should check version requirement for prune-tags', async () => {
				git.gitExecutable = { path: '/git', version: '2.10.0' };
				const status = await remoteActions.fetch(git, REPO, 'origin', true, true);
				expect(status).toContain('A newer version of Git (>= 2.17.0) is required');

				git.gitExecutable = { path: '/git', version: '2.20.0' };
				const okStatus = await remoteActions.fetch(git, REPO, 'origin', true, true);
				expect(okStatus).toBeNull();
				expect(git.calls[0].args).toEqual(['fetch', 'origin', '--prune', '--prune-tags']);
			});
		});

		describe('pushBranch', () => {
			it('should push branch in Normal mode without upstream', async () => {
				const status = await remoteActions.pushBranch(git, REPO, 'main', 'origin', false, GitPushBranchMode.Normal);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', 'main'], repo: REPO }
				]);
			});

			it('should push branch with upstream and Force mode', async () => {
				const status = await remoteActions.pushBranch(git, REPO, 'main', 'origin', true, GitPushBranchMode.Force);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', 'main', '--set-upstream', '--force'], repo: REPO }
				]);
			});

			it('should push branch with ForceWithLease mode', async () => {
				const status = await remoteActions.pushBranch(git, REPO, 'main', 'origin', false, GitPushBranchMode.ForceWithLease);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', 'main', '--force-with-lease'], repo: REPO }
				]);
			});
		});

		describe('pushBranchToMultipleRemotes', () => {
			it('should return error when remotes array is empty', async () => {
				const errors = await remoteActions.pushBranchToMultipleRemotes(git, REPO, 'main', [], false, GitPushBranchMode.Normal);
				expect(errors).toEqual(['No remote(s) were specified to push the branch main to.']);
			});

			it('should push to all remotes sequentially', async () => {
				const errors = await remoteActions.pushBranchToMultipleRemotes(git, REPO, 'main', ['origin', 'upstream'], false, GitPushBranchMode.Normal);
				expect(errors).toEqual([null, null]);
				expect(git.calls.length).toBe(2);
			});

			it('should break on first error during sequential push', async () => {
				git.runGitCommandResponses.push('error pushing origin');
				const errors = await remoteActions.pushBranchToMultipleRemotes(git, REPO, 'main', ['origin', 'upstream'], false, GitPushBranchMode.Normal);
				expect(errors).toEqual(['error pushing origin']);
				expect(git.calls.length).toBe(1);
			});
		});

		describe('getRemoteUrl', () => {
			it('should return trimmed first line of url or null on error', async () => {
				git.spawnGitResponses.push('https://github.com/foo.git\n');
				const url = await remoteActions.getRemoteUrl(git, REPO, 'origin');
				expect(url).toBe('https://github.com/foo.git');

				git.spawnGitResponses.push(new Error('not found'));
				const nullUrl = await remoteActions.getRemoteUrl(git, REPO, 'origin');
				expect(nullUrl).toBeNull();
			});
		});

		describe('getRemotes', () => {
			it('should return list of remote names', async () => {
				git.spawnGitResponses.push('origin\nupstream\n');
				const remotes = await remoteActions.getRemotes(git, REPO);
				expect(remotes).toEqual(['origin', 'upstream']);
			});
		});

		describe('getRemotesContainingCommit', () => {
			it('should match known remotes prefix against remote branches containing commit', async () => {
				git.spawnGitResponses.push('  origin/main\n  origin/feature\n  other/branch\n');
				const res = await remoteActions.getRemotesContainingCommit(git, REPO, 'hash1', ['origin', 'upstream']);
				expect(res).toEqual(['origin']);
			});
		});
	});

	// =========================================================================
	// 4. stashActions
	// =========================================================================
	describe('stashActions', () => {
		describe('applyStash', () => {
			it('should apply stash without --index', async () => {
				const status = await stashActions.applyStash(git, REPO, 'stash@{0}', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'apply', 'stash@{0}'], repo: REPO }
				]);
			});

			it('should apply stash with --index', async () => {
				const status = await stashActions.applyStash(git, REPO, 'stash@{0}', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'apply', '--index', 'stash@{0}'], repo: REPO }
				]);
			});
		});

		describe('branchFromStash', () => {
			it('should branch from stash with correct argument order', async () => {
				const status = await stashActions.branchFromStash(git, REPO, 'stash@{1}', 'stash-branch');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'branch', 'stash-branch', 'stash@{1}'], repo: REPO }
				]);
			});
		});

		describe('dropStash', () => {
			it('should drop stash', async () => {
				const status = await stashActions.dropStash(git, REPO, 'stash@{0}');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'drop', 'stash@{0}'], repo: REPO }
				]);
			});
		});

		describe('popStash', () => {
			it('should pop stash without --index', async () => {
				const status = await stashActions.popStash(git, REPO, 'stash@{0}', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'pop', 'stash@{0}'], repo: REPO }
				]);
			});

			it('should pop stash with --index', async () => {
				const status = await stashActions.popStash(git, REPO, 'stash@{0}', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'pop', '--index', 'stash@{0}'], repo: REPO }
				]);
			});
		});

		describe('pushStash', () => {
			it('should return UNABLE_TO_FIND_GIT_MSG when gitExecutable is null', async () => {
				git.gitExecutable = null;
				const status = await stashActions.pushStash(git, REPO, 'WIP', false);
				expect(status).toBe(UNABLE_TO_FIND_GIT_MSG);
			});

			it('should return incompatible version error when git is < 2.13.2', async () => {
				git.gitExecutable = { path: '/git', version: '2.10.0' };
				const status = await stashActions.pushStash(git, REPO, 'WIP', false);
				expect(status).toContain('A newer version of Git (>= 2.13.2) is required');
			});

			it('should push stash with message and includeUntracked', async () => {
				git.gitExecutable = { path: '/git', version: '2.30.0' };
				const status = await stashActions.pushStash(git, REPO, 'My stash msg', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'push', '--include-untracked', '--message', 'My stash msg'], repo: REPO }
				]);
			});

			it('should push stash without message when message is empty string', async () => {
				git.gitExecutable = { path: '/git', version: '2.30.0' };
				const status = await stashActions.pushStash(git, REPO, '', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'push'], repo: REPO }
				]);
			});
		});

		describe('getStashes', () => {
			it('should query reflog and parse stashes', async () => {
				const reflogOutput = ['hash1', 'p1 p2', 'stash@{0}', 'Dev', 'dev@test.com', '1600000000', 'WIP commit'].join(GIT_LOG_SEPARATOR) + '\n';
				git.spawnGitResponses.push(reflogOutput);

				const stashes = await stashActions.getStashes(git, REPO, 'format-string');
				expect(stashes.length).toBe(1);
				expect(stashes[0].selector).toBe('stash@{0}');
				expect(stashes[0].baseHash).toBe('p1');
				expect(stashes[0].untrackedFilesHash).toBeNull();
			});

			it('should fallback to empty array if reflog command fails', async () => {
				git.spawnGitResponses.push(new Error('fatal: refs/stash does not exist'));
				const stashes = await stashActions.getStashes(git, REPO);
				expect(stashes).toEqual([]);
			});
		});

		describe('getStashDetails', () => {
			it('should retrieve 2-parent stash details without untracked changes', async () => {
				const baseStdout = [
					'hash123', 'p1 p2', 'Author', 'author@test.com', '1600000000',
					'Committer', 'committer@test.com', '1600000000', '', '', '', 'Body'
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(baseStdout); // getCommitDetailsBase
				git.spawnGitResponses.push('M\0file.txt\0'); // diffNameStatus
				git.spawnGitResponses.push('1\t2\tfile.txt\0'); // diffNumStat

				const res = await stashActions.getStashDetails(git, REPO, 'hash123', {
					selector: 'stash@{0}',
					baseHash: 'p1',
					untrackedFilesHash: null
				});
				expect(res.error).toBeNull();
				expect(res.commitDetails?.hash).toBe('hash123');
				expect(res.commitDetails?.fileChanges.length).toBe(1);
			});

			it('should retrieve 3-parent stash details and mark untracked files', async () => {
				const baseStdout = [
					'hash123', 'p1 p2 p3', 'Author', 'author@test.com', '1600000000',
					'Committer', 'committer@test.com', '1600000000', '', '', '', 'Body'
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(baseStdout); // base
				git.spawnGitResponses.push(''); // stash diff name
				git.spawnGitResponses.push(''); // stash diff num
				git.spawnGitResponses.push('p3\0A\0untracked.txt\0'); // untracked diff name
				git.spawnGitResponses.push('p3\x005\t0\tuntracked.txt\0'); // untracked diff num

				const res = await stashActions.getStashDetails(git, REPO, 'hash123', {
					selector: 'stash@{0}',
					baseHash: 'p1',
					untrackedFilesHash: 'p3'
				});
				expect(res.error).toBeNull();
				expect(res.commitDetails?.fileChanges.length).toBe(1);
				expect(res.commitDetails?.fileChanges[0].type).toBe(GitFileStatus.Untracked);
			});

			it('should handle stash details error', async () => {
				git.spawnGitResponses.push(new Error('failed to load stash details'));
				const res = await stashActions.getStashDetails(git, REPO, 'hash123', {
					selector: 'stash@{0}',
					baseHash: 'p1',
					untrackedFilesHash: null
				});
				expect(res.commitDetails).toBeNull();
				expect(res.error).toBe('failed to load stash details');
			});
		});

		describe('getGitFormatStash', () => {
			it('should generate stash format string with author date or committer date', () => {
				const fmt = stashActions.getGitFormatStash();
				expect(fmt).toContain('%H');
				expect(fmt).toContain('%gD');
			});
		});
	});

	// =========================================================================
	// 5. commitActions
	// =========================================================================
	describe('commitActions', () => {
		describe('checkoutCommit', () => {
			it('should checkout commit', async () => {
				const status = await commitActions.checkoutCommit(git, REPO, 'commit123');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['checkout', 'commit123'], repo: REPO }
				]);
			});
		});

		describe('cherrypickCommit', () => {
			it('should cherrypick commit with all flag variations', async () => {
				await commitActions.cherrypickCommit(git, REPO, 'hash1', 0, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', 'hash1']);

				git.reset();
				await commitActions.cherrypickCommit(git, REPO, 'hash1', 2, true, true);
				expect(git.calls[0].args).toEqual(['cherry-pick', '--no-commit', '-x', '-m', '2', 'hash1']);

				git.reset();
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.cherrypickCommit(git, REPO, 'hash1', 0, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', '-S', 'hash1']);
			});
		});

		describe('dropCommit', () => {
			it('should drop commit using rebase --onto', async () => {
				await commitActions.dropCommit(git, REPO, 'hash1');
				expect(git.calls[0].args).toEqual(['rebase', '--onto', 'hash1^', 'hash1']);

				git.reset();
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.dropCommit(git, REPO, 'hash1');
				expect(git.calls[0].args).toEqual(['rebase', '-S', '--onto', 'hash1^', 'hash1']);
			});
		});

		describe('resetToCommit', () => {
			it('should reset to commit with specified mode', async () => {
				await commitActions.resetToCommit(git, REPO, 'hash1', GitResetMode.Hard);
				expect(git.calls[0].args).toEqual(['reset', '--hard', 'hash1']);

				git.reset();
				await commitActions.resetToCommit(git, REPO, 'hash1', GitResetMode.Soft);
				expect(git.calls[0].args).toEqual(['reset', '--soft', 'hash1']);
			});
		});

		describe('revertCommit', () => {
			it('should revert commit with options', async () => {
				await commitActions.revertCommit(git, REPO, 'hash1', 0);
				expect(git.calls[0].args).toEqual(['revert', '--no-edit', 'hash1']);

				git.reset();
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.revertCommit(git, REPO, 'hash1', 1);
				expect(git.calls[0].args).toEqual(['revert', '--no-edit', '-S', '-m', '1', 'hash1']);
			});
		});

		describe('merge', () => {
			it('should merge with squash, no-ff, no-commit, and signCommits', async () => {
				await commitActions.merge(git, REPO, 'feat', MergeActionOn.Branch, true, false, false);
				expect(git.calls[0].args).toEqual(['merge', 'feat', '--no-ff']);

				git.reset();
				await commitActions.merge(git, REPO, 'feat', MergeActionOn.Branch, false, true, true);
				expect(git.calls[0].args).toEqual(['merge', 'feat', '--squash', '--no-commit']);

				git.reset();
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.merge(git, REPO, 'feat', MergeActionOn.Branch, false, false, false);
				expect(git.calls[0].args).toEqual(['merge', 'feat', '-S']);
			});

			it('should perform post-merge squash commit when squash is true and noCommit is false', async () => {
				git.spawnGitResponses.push('changes');
				await commitActions.merge(git, REPO, 'feat', MergeActionOn.Branch, false, true, false);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['merge', 'feat', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO },
					{ method: 'runGitCommand', args: ['commit', '-m', 'Merge branch \'feat\''], repo: REPO }
				]);
			});
		});

		describe('rebase', () => {
			it('should open git terminal for interactive rebase', async () => {
				await commitActions.rebase(git, REPO, 'main', RebaseActionOn.Branch, false, true);
				expect(git.calls).toEqual([
					{ method: 'openGitTerminal', args: ['rebase --interactive main'], repo: REPO }
				]);
			});

			it('should run git command for non-interactive rebase', async () => {
				await commitActions.rebase(git, REPO, 'main', RebaseActionOn.Branch, true, false);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['rebase', 'main', '--ignore-date'], repo: REPO }
				]);

				git.reset();
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.rebase(git, REPO, 'main', RebaseActionOn.Branch, false, false);
				expect(git.calls[0].args).toEqual(['rebase', 'main', '-S']);
			});
		});

		describe('archive', () => {
			it('should create archive', async () => {
				await commitActions.archive(git, REPO, 'v1.0.0', '/path/out.zip', 'zip');
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['archive', '--format=zip', '-o', '/path/out.zip', 'v1.0.0'], repo: REPO }
				]);
			});
		});

		describe('cleanUntrackedFiles', () => {
			it('should clean untracked files with and without directory flag', async () => {
				await commitActions.cleanUntrackedFiles(git, REPO, false);
				expect(git.calls[0].args).toEqual(['clean', '-f']);

				git.reset();
				await commitActions.cleanUntrackedFiles(git, REPO, true);
				expect(git.calls[0].args).toEqual(['clean', '-fd']);
			});
		});

		describe('resetFileToRevision', () => {
			it('should checkout file at revision', async () => {
				await commitActions.resetFileToRevision(git, REPO, 'hash1', 'file.ts');
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['checkout', 'hash1', '--', 'file.ts'], repo: REPO }
				]);
			});
		});

		describe('getCommitSubject', () => {
			it('should return trimmed single line commit subject', async () => {
				git.spawnGitResponses.push('  Commit   subject   with   spaces\n');
				const subject = await commitActions.getCommitSubject(git, REPO, 'hash1');
				expect(subject).toBe('Commit subject with spaces');
				expect(git.calls[0].args).toEqual(['-c', 'log.showSignature=false', 'log', '--format=%s', '-n', '1', 'hash1', '--']);
			});

			it('should return null if git command rejects', async () => {
				git.spawnGitResponses.push(new Error('fail'));
				const subject = await commitActions.getCommitSubject(git, REPO, 'hash1');
				expect(subject).toBeNull();
			});
		});

		describe('getCommitDetails', () => {
			it('should fetch commit details base and diffs in parallel', async () => {
				const baseStdout = [
					'hash1', 'p1', 'Alice', 'alice@test.com', '1600000000',
					'Bob', 'bob@test.com', '1600000000', 'G', 'Signer', 'Key123', 'Subject line'
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(baseStdout); // base
				git.spawnGitResponses.push('M\0file.ts\0'); // diff name
				git.spawnGitResponses.push('10\t5\tfile.ts\0'); // diff num

				const res = await commitActions.getCommitDetails(git, REPO, 'hash1', true);
				expect(res.error).toBeNull();
				expect(res.commitDetails?.hash).toBe('hash1');
				expect(res.commitDetails?.signature).toEqual({
					status: GitSignatureStatus.GoodAndValid,
					signer: 'Signer',
					key: 'Key123'
				});
				expect(res.commitDetails?.fileChanges.length).toBe(1);
			});

			it('should handle commit details error', async () => {
				git.spawnGitResponses.push(new Error('commit not found'));
				const res = await commitActions.getCommitDetails(git, REPO, 'hash1', true);
				expect(res.commitDetails).toBeNull();
				expect(res.error).toBe('commit not found');
			});
		});

		describe('getUncommittedDetails', () => {
			it('should retrieve uncommitted details with status', async () => {
				git.spawnGitResponses.push('M\0mod.ts\0'); // name
				git.spawnGitResponses.push('3\t1\tmod.ts\0'); // num
				git.spawnGitResponses.push(' M mod.ts\0'); // status

				const res = await commitActions.getUncommittedDetails(git, REPO);
				expect(res.error).toBeNull();
				expect(res.commitDetails?.hash).toBe(UNCOMMITTED);
			});
		});

		describe('computeGitFormatCommitDetails', () => {
			it('should compute git log format tokens', () => {
				const fmt = commitActions.computeGitFormatCommitDetails(git);
				expect(fmt).toContain('%H');
				expect(fmt).toContain('%B');
			});
		});
	});

	// =========================================================================
	// 6. diffActions
	// =========================================================================
	describe('diffActions', () => {
		describe('openExternalDirDiff', () => {
			it('should return UNABLE_TO_FIND_GIT_MSG when gitExecutable is null', async () => {
				git.gitExecutable = null;
				const status = await diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', true);
				expect(status).toBe(UNABLE_TO_FIND_GIT_MSG);
			});

			it('should launch gui diff for single commit with ^.. hash range', async () => {
				jest.useFakeTimers();
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash1', true);
				jest.runOnlyPendingTimers();
				jest.useRealTimers();
				const status = await promise;
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'hash1^..hash1']);
			});

			it('should launch gui diff between two commits with .. range', async () => {
				jest.useFakeTimers();
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', true);
				jest.runOnlyPendingTimers();
				jest.useRealTimers();
				const status = await promise;
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'hash1..hash2']);
			});

			it('should launch gui diff for uncommitted changes', async () => {
				jest.useFakeTimers();
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', UNCOMMITTED, true);
				jest.runOnlyPendingTimers();
				jest.useRealTimers();
				const status = await promise;
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'hash1']);
			});

			it('should launch gui diff for single uncommitted comparison with HEAD', async () => {
				jest.useFakeTimers();
				const promise = diffActions.openExternalDirDiff(git, REPO, UNCOMMITTED, UNCOMMITTED, true);
				jest.runOnlyPendingTimers();
				jest.useRealTimers();
				const status = await promise;
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'HEAD']);
			});

			it('should launch terminal diff when isGui is false', async () => {
				jest.useFakeTimers();
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', false);
				jest.runOnlyPendingTimers();
				jest.useRealTimers();
				const status = await promise;
				expect(status).toBeNull();
			});

			it('should log and report error when external diff tool fails', async () => {
				git.runGitCommandResponses.push('diff tool crashed');
				jest.useFakeTimers();
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', true);
				jest.runOnlyPendingTimers();
				jest.useRealTimers();
				await promise;
				expect(git.mockLogger.logError).toHaveBeenCalledWith('diff tool crashed');
			});
		});

		describe('getCommitComparison', () => {
			it('should compare two commits', async () => {
				git.spawnGitResponses.push('M\0file1.ts\0'); // diffName
				git.spawnGitResponses.push('4\t2\tfile1.ts\0'); // diffNum

				const comp = await diffActions.getCommitComparison(git, REPO, 'hash1', 'hash2');
				expect(comp.error).toBeNull();
				expect(comp.fileChanges.length).toBe(1);
			});

			it('should compare commit to UNCOMMITTED and include status', async () => {
				git.spawnGitResponses.push('M\0file1.ts\0');
				git.spawnGitResponses.push('4\t2\tfile1.ts\0');
				git.spawnGitResponses.push(' M file1.ts\0'); // status

				const comp = await diffActions.getCommitComparison(git, REPO, 'hash1', UNCOMMITTED);
				expect(comp.error).toBeNull();
				expect(comp.fileChanges.length).toBe(1);
			});

			it('should handle comparison error', async () => {
				git.spawnGitResponses.push(new Error('comparison failed'));
				const comp = await diffActions.getCommitComparison(git, REPO, 'hash1', 'hash2');
				expect(comp.fileChanges).toEqual([]);
				expect(comp.error).toBe('comparison failed');
			});
		});

		describe('getCommitFile', () => {
			it('should show and decode file content at revision', async () => {
				git._spawnGitResponses.push({ stdout: Buffer.from('const x = 10;'), stderr: '' });
				const content = await diffActions.getCommitFile(git, REPO, 'hash1', 'index.ts');
				expect(content).toBe('const x = 10;');
				expect(git.calls[0]).toEqual({
					method: '_spawnGit',
					args: ['show', 'hash1:index.ts'],
					repo: REPO,
					ignoreExitCode: false
				});
			});
		});

		describe('getNewPathOfRenamedFile', () => {
			it('should detect renamed file path', async () => {
				git.spawnGitResponses.push('R\0old.ts\0new.ts\0');
				const newPath = await diffActions.getNewPathOfRenamedFile(git, REPO, 'hash1', 'old.ts');
				expect(newPath).toBe('new.ts');
			});

			it('should return null if file was not renamed or on error', async () => {
				git.spawnGitResponses.push('');
				expect(await diffActions.getNewPathOfRenamedFile(git, REPO, 'hash1', 'old.ts')).toBeNull();

				git.spawnGitResponses.push(new Error('fail'));
				expect(await diffActions.getNewPathOfRenamedFile(git, REPO, 'hash1', 'old.ts')).toBeNull();
			});
		});

		describe('execDiff', () => {
			it('should use diff-tree and shift root entry when fromHash equals toHash', async () => {
				git.spawnGitResponses.push('\0entry1\0entry2\0');
				const lines = await diffActions.execDiff(git, REPO, 'hash1', 'hash1', '--name-status', 'AMDR');
				expect(lines).toEqual(['entry1', 'entry2', '']);
				expect(git.calls[0].args).toEqual(['diff-tree', '--name-status', '-r', '--root', '--find-renames', '--diff-filter=AMDR', '-z', 'hash1']);
			});

			it('should use diff when fromHash differs from toHash', async () => {
				git.spawnGitResponses.push('entry1\0entry2\0');
				const lines = await diffActions.execDiff(git, REPO, 'hash1', 'hash2', '--numstat', 'AMDR');
				expect(lines).toEqual(['entry1', 'entry2', '']);
				expect(git.calls[0].args).toEqual(['diff', '--numstat', '--find-renames', '--diff-filter=AMDR', '-z', 'hash1', 'hash2']);
			});
		});

		describe('getStatus', () => {
			it('should query porcelain status files', async () => {
				git.spawnGitResponses.push(' M file.ts\0?? untracked.ts\0');
				const status = await diffActions.getStatus(git, REPO);
				expect(status.deleted).toEqual([]);
				expect(status.untracked).toEqual(['untracked.ts']);
				expect(git.calls[0].args).toContain('status');
			});
		});
	});
});
