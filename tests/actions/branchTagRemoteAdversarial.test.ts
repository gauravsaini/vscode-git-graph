import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as branchActions from '../../src/actions/branchActions';
import * as remoteActions from '../../src/actions/remoteActions';
import * as tagActions from '../../src/actions/tagActions';
import { GIT_LOG_SEPARATOR } from '../../src/parsers';
import {
	ErrorInfoExtensionPrefix,
	GitPushBranchMode,
	GitSignatureStatus,
	TagType
} from '../../src/types';
import { MockGitExecutor } from './fixtures/mockGitExecutor';

const REPO = '/path/to/test/repo';

describe('Branch, Tag & Remote Adversarial Stress Suite', () => {
	let git: MockGitExecutor;

	beforeEach(() => {
		git = new MockGitExecutor();
		(vscode.window.showErrorMessage as jest.Mock).mockReturnValue(Promise.resolve(undefined));
	});

	// =========================================================================
	// 1. Branch Operations Adversarial Scenarios
	// =========================================================================
	describe('Branch Operations Adversarial Scenarios', () => {
		const specialBranchNames = [
			'feature/user-login',
			'feature/deeply/nested/branch/hierarchy/leaf',
			'feat/spaces in name',
			'feat/"double-quotes"',
			'feat/\'single-quotes\'',
			'feat/@{upstream}',
			'feat/test^1',
			'feat/test~2',
			'feat/tag#1',
			'feat/$variable',
			'feat/日本語ブランチ',
			'feat/🚀-rocket-branch',
			'feat/café-crème',
			'feat/dots...and.dots',
			'feat/hyphen-and_underscore'
		];

		describe('Special character branch names in all branch actions', () => {
			for (const branchName of specialBranchNames) {
				it(`checkoutBranch should preserve special branch name: "${branchName}"`, async () => {
					// Local checkout
					const statusLocal = await branchActions.checkoutBranch(git, REPO, branchName, null);
					expect(statusLocal).toBeNull();
					expect(git.calls[0].args).toEqual(['checkout', branchName]);

					// Remote tracking checkout
					git.reset();
					const remoteBranch = 'origin/' + branchName;
					const statusRemote = await branchActions.checkoutBranch(git, REPO, branchName, remoteBranch);
					expect(statusRemote).toBeNull();
					expect(git.calls[0].args).toEqual(['checkout', '-b', branchName, remoteBranch]);
				});

				it(`createBranch should handle special branch name: "${branchName}" across all permutations`, async () => {
					// 1. checkout: false, force: false
					git.reset();
					let res = await branchActions.createBranch(git, REPO, branchName, 'hash1', false, false);
					expect(res).toEqual([null]);
					expect(git.calls[0].args).toEqual(['branch', branchName, 'hash1']);

					// 2. checkout: true, force: false
					git.reset();
					res = await branchActions.createBranch(git, REPO, branchName, 'hash1', true, false);
					expect(res).toEqual([null]);
					expect(git.calls[0].args).toEqual(['checkout', '-b', branchName, 'hash1']);

					// 3. checkout: false, force: true
					git.reset();
					res = await branchActions.createBranch(git, REPO, branchName, 'hash1', false, true);
					expect(res).toEqual([null]);
					expect(git.calls[0].args).toEqual(['branch', '-f', branchName, 'hash1']);

					// 4. checkout: true, force: true (2-command sequence)
					git.reset();
					res = await branchActions.createBranch(git, REPO, branchName, 'hash1', true, true);
					expect(res).toEqual([null, null]);
					expect(git.calls[0].args).toEqual(['branch', '-f', branchName, 'hash1']);
					expect(git.calls[1].args).toEqual(['checkout', branchName]);
				});

				it(`deleteBranch should preserve special branch name: "${branchName}"`, async () => {
					// Safe delete (-d)
					git.reset();
					let status = await branchActions.deleteBranch(git, REPO, branchName, false);
					expect(status).toBeNull();
					expect(git.calls[0].args).toEqual(['branch', '-d', branchName]);

					// Force delete (-D)
					git.reset();
					status = await branchActions.deleteBranch(git, REPO, branchName, true);
					expect(status).toBeNull();
					expect(git.calls[0].args).toEqual(['branch', '-D', branchName]);
				});

				it(`deleteRemoteBranch should format push --delete with special branch name: "${branchName}"`, async () => {
					git.reset();
					const status = await branchActions.deleteRemoteBranch(git, REPO, branchName, 'origin');
					expect(status).toBeNull();
					expect(git.calls[0].args).toEqual(['push', 'origin', '--delete', branchName]);
				});

				it(`fetchIntoLocalBranch should format refspec correctly: "${branchName}"`, async () => {
					git.reset();
					const status = await branchActions.fetchIntoLocalBranch(git, REPO, 'origin', branchName, branchName, false);
					expect(status).toBeNull();
					expect(git.calls[0].args).toEqual(['fetch', 'origin', `${branchName}:${branchName}`]);

					git.reset();
					const statusForce = await branchActions.fetchIntoLocalBranch(git, REPO, 'origin', branchName, branchName, true);
					expect(statusForce).toBeNull();
					expect(git.calls[0].args).toEqual(['fetch', '-f', 'origin', `${branchName}:${branchName}`]);
				});

				it(`renameBranch should handle rename with special names: "${branchName}"`, async () => {
					git.reset();
					const newName = branchName + '-renamed';
					const status = await branchActions.renameBranch(git, REPO, branchName, newName);
					expect(status).toBeNull();
					expect(git.calls[0].args).toEqual(['branch', '-m', branchName, newName]);
				});
			}
		});

		describe('deleteRemoteBranch fallback on missing remote ref', () => {
			it('should trigger fallback when remote ref does not exist (lowercase)', async () => {
				git.runGitCommandResponses.push('error: unable to delete "feat": remote ref does not exist', null);
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', '--delete', 'feat'], repo: REPO },
					{ method: 'runGitCommand', args: ['branch', '-d', '-r', 'origin/feat'], repo: REPO }
				]);
			});

			it('should trigger fallback when remote ref does not exist (uppercase / mixed case)', async () => {
				git.runGitCommandResponses.push('fatal: REMOTE REF DOES NOT EXIST on remote server', null);
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBeNull();
				expect(git.calls.length).toBe(2);
				expect(git.calls[1].args).toEqual(['branch', '-d', '-r', 'origin/feat']);
			});

			it('should trigger fallback and return composite error message when tracking branch deletion fails', async () => {
				git.runGitCommandResponses.push(
					'error: remote ref does not exist',
					'error: remote-tracking branch "origin/feat" not found.'
				);
				const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
				expect(status).toBe(
					'Branch does not exist on the remote, deleting the remote tracking branch origin/feat.\n' +
					'error: remote-tracking branch "origin/feat" not found.'
				);
				expect(git.calls.length).toBe(2);
			});

			it('should NOT trigger fallback for authentication or permission errors', async () => {
				const nonMatchingErrors = [
					'fatal: Authentication failed for "https://github.com/repo.git"',
					'fatal: remote error: upload-pack: not our ref',
					'error: failed to push some refs to "https://github.com/repo.git"',
					'fatal: could not read Username for "https://github.com": terminal prompts disabled'
				];

				for (const errorMsg of nonMatchingErrors) {
					git.reset();
					git.runGitCommandResponses.push(errorMsg);
					const status = await branchActions.deleteRemoteBranch(git, REPO, 'feat', 'origin');
					expect(status).toBe(errorMsg);
					expect(git.calls.length).toBe(1);
				}
			});
		});

		describe('pullBranch squash commit formatting and precedence', () => {
			it('should perform normal pull when createNewCommit=false and squash=false', async () => {
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main'], repo: REPO }
				]);
			});

			it('should pull with --no-ff when createNewCommit=true and squash=false', async () => {
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', true, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main', '--no-ff'], repo: REPO }
				]);
			});

			it('should prioritize --squash over --no-ff when both squash=true and createNewCommit=true', async () => {
				git.spawnGitResponses.push(''); // No staged changes
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', true, true);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['pull', 'origin', 'main', '--squash']);
				expect(git.calls[0].args).not.toContain('--no-ff');
			});

			it('should format squash commit with Default message when staged changes exist', async () => {
				vscode.mockExtensionSettingReturnValue('dialog.pullBranch.squashMessageFormat', 'Default');
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', false);
				git.spawnGitResponses.push(':100644 100644 abc def M\tfile.ts'); // staged changes exist

				const status = await branchActions.pullBranch(git, REPO, 'feature/foo', 'origin', false, true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'feature/foo', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO },
					{ method: 'runGitCommand', args: ['commit', '-m', 'Merge branch \'origin/feature/foo\''], repo: REPO }
				]);
			});

			it('should format squash commit with --no-edit when Git SQUASH_MSG format configured', async () => {
				vscode.mockExtensionSettingReturnValue('dialog.pullBranch.squashMessageFormat', 'Git SQUASH_MSG');
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', false);
				git.spawnGitResponses.push('M file.ts');

				const status = await branchActions.pullBranch(git, REPO, 'main', 'upstream', false, true);
				expect(status).toBeNull();
				expect(git.calls[2].args).toEqual(['commit', '--no-edit']);
			});

			it('should append -S to both pull and squash commit when signCommits is true', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				vscode.mockExtensionSettingReturnValue('dialog.pullBranch.squashMessageFormat', 'Default');
				git.spawnGitResponses.push('staged changes');

				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, true);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['pull', 'origin', 'main', '--squash', '-S']);
				expect(git.calls[2].args).toEqual(['commit', '-S', '-m', 'Merge branch \'origin/main\'']);
			});

			it('should not commit when no staged changes exist after squash pull', async () => {
				git.spawnGitResponses.push(''); // diff-index returns empty string
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['pull', 'origin', 'main', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO }
				]);
			});

			it('should halt and return error without checking staged changes if pull fails', async () => {
				git.runGitCommandResponses.push('fatal: refusing to merge unrelated histories');
				const status = await branchActions.pullBranch(git, REPO, 'main', 'origin', false, true);
				expect(status).toBe('fatal: refusing to merge unrelated histories');
				expect(git.calls.length).toBe(1);
			});
		});

		describe('createBranch force checkout 2-command sequence error propagation', () => {
			it('should execute 2-command sequence when checkout=true and force=true', async () => {
				const statuses = await branchActions.createBranch(git, REPO, 'feat', 'hash1', true, true);
				expect(statuses).toEqual([null, null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['branch', '-f', 'feat', 'hash1'], repo: REPO },
					{ method: 'runGitCommand', args: ['checkout', 'feat'], repo: REPO }
				]);
			});

			it('should halt immediately if step 1 (branch -f) fails', async () => {
				git.runGitCommandResponses.push('fatal: cannot force update branch');
				const statuses = await branchActions.createBranch(git, REPO, 'feat', 'hash1', true, true);
				expect(statuses).toEqual(['fatal: cannot force update branch']);
				expect(git.calls.length).toBe(1);
			});

			it('should capture step 2 failure if checkout fails', async () => {
				git.runGitCommandResponses.push(null, 'error: your local changes would be overwritten by checkout');
				const statuses = await branchActions.createBranch(git, REPO, 'feat', 'hash1', true, true);
				expect(statuses).toEqual([null, 'error: your local changes would be overwritten by checkout']);
				expect(git.calls.length).toBe(2);
			});
		});

		describe('getBranches parsing and filtering', () => {
			it('should parse local and remote branches and extract head', async () => {
				const stdout = [
					'* main',
					'  develop',
					'  feature/login',
					'  remotes/origin/main',
					'  remotes/origin/feature/login',
					'  remotes/upstream/main',
					'  remotes/hidden/branch'
				].join('\n') + '\n';
				git.spawnGitResponses.push(stdout);

				const branchData = await branchActions.getBranches(git, REPO, true, ['hidden']);
				expect(branchData.error).toBeNull();
				expect(branchData.head).toBe('main');
				expect(branchData.branches).toContain('main');
				expect(branchData.branches).toContain('develop');
				expect(branchData.branches).toContain('feature/login');
				expect(branchData.branches).toContain('remotes/origin/main');
				expect(branchData.branches).toContain('remotes/upstream/main');
				expect(branchData.branches).not.toContain('remotes/hidden/branch');
			});

			it('should filter out detached HEAD and symbolic remotes when showRemoteHeads=false', async () => {
				vscode.mockExtensionSettingReturnValue('repository.showRemoteHeads', false);
				const stdout = [
					'* (HEAD detached at 1234abc)',
					'  main',
					'  remotes/origin/HEAD -> origin/main',
					'  remotes/origin/main'
				].join('\n') + '\n';
				git.spawnGitResponses.push(stdout);

				const branchData = await branchActions.getBranches(git, REPO, true, []);
				expect(branchData.branches).toEqual(['main', 'remotes/origin/main']);
			});
		});
	});

	// =========================================================================
	// 2. Tag Operations Adversarial Scenarios
	// =========================================================================
	describe('Tag Operations Adversarial Scenarios', () => {
		describe('Signed vs annotated vs lightweight tags', () => {
			it('should create lightweight tag without message or sign flag', async () => {
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Lightweight, '', false);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['tag', 'v1.0.0', 'hash1']);
			});

			it('should create forced lightweight tag', async () => {
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Lightweight, '', true);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['tag', '-f', 'v1.0.0', 'hash1']);
			});

			it('should create annotated tag with -a when signTags is false', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.tags', false);
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Annotated, 'Release v1.0.0', false);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['tag', '-a', 'v1.0.0', '-m', 'Release v1.0.0', 'hash1']);
			});

			it('should create annotated tag with -s when signTags is true', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.tags', true);
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Annotated, 'Signed release', false);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['tag', '-s', 'v1.0.0', '-m', 'Signed release', 'hash1']);
			});

			it('should create forced signed tag with -f before -s', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.tags', true);
				const status = await tagActions.addTag(git, REPO, 'v1.0.0', 'hash1', TagType.Annotated, 'Force signed', true);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['tag', '-f', '-s', 'v1.0.0', '-m', 'Force signed', 'hash1']);
			});

			it('should handle multi-line and special character messages in annotated tag', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.tags', false);
				const multiLineMsg = 'Header\n\n- Feature A\n- Feature B\n\nRelease notes!';
				const status = await tagActions.addTag(git, REPO, 'v1.1.0-beta.1', 'hash2', TagType.Annotated, multiLineMsg, false);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['tag', '-a', 'v1.1.0-beta.1', '-m', multiLineMsg, 'hash2']);
			});
		});

		describe('deleteTag remote and local behavior', () => {
			it('should delete local tag only when deleteOnRemote is null', async () => {
				const status = await tagActions.deleteTag(git, REPO, 'v1.0.0', null);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['tag', '-d', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should delete remote tag then local tag when deleteOnRemote is specified', async () => {
				const status = await tagActions.deleteTag(git, REPO, 'v1.0.0', 'origin');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', '--delete', 'v1.0.0'], repo: REPO },
					{ method: 'runGitCommand', args: ['tag', '-d', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should abort local deletion if remote deletion fails', async () => {
				git.runGitCommandResponses.push('error: unable to delete tag on remote: remote ref locked');
				const status = await tagActions.deleteTag(git, REPO, 'v1.0.0', 'origin');
				expect(status).toBe('error: unable to delete tag on remote: remote ref locked');
				expect(git.calls.length).toBe(1);
			});
		});

		describe('pushTag empty remotes guard and commit containment', () => {
			it('should return error when remotes array is empty (both skipRemoteCheck true and false)', async () => {
				const err1 = await tagActions.pushTag(git, REPO, 'v1.0.0', [], 'hash1', false);
				expect(err1).toEqual(['No remote(s) were specified to push the tag v1.0.0 to.']);
				expect(git.calls.length).toBe(0);

				const err2 = await tagActions.pushTag(git, REPO, 'v1.0.0', [], 'hash1', true);
				expect(err2).toEqual(['No remote(s) were specified to push the tag v1.0.0 to.']);
				expect(git.calls.length).toBe(0);
			});

			it('should verify commit containment and push when all remotes contain commit', async () => {
				git.spawnGitResponses.push('  origin/main\n  upstream/main\n');
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', false);
				expect(errors).toEqual([null, null]);
				expect(git.calls).toEqual([
					{ method: 'spawnGit', args: ['branch', '-r', '--no-color', '--contains=hash1'], repo: REPO },
					{ method: 'runGitCommand', args: ['push', 'origin', 'v1.0.0'], repo: REPO },
					{ method: 'runGitCommand', args: ['push', 'upstream', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should reject push if some remotes do not contain the commit', async () => {
				git.spawnGitResponses.push('  origin/main\n'); // Only origin contains commit, upstream does not
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', false);
				expect(errors).toEqual([
					ErrorInfoExtensionPrefix.PushTagCommitNotOnRemote + JSON.stringify(['upstream'])
				]);
				expect(git.calls.length).toBe(1);
			});

			it('should reject push if no remotes contain the commit', async () => {
				git.spawnGitResponses.push(''); // No remote contains commit
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', false);
				expect(errors).toEqual([
					ErrorInfoExtensionPrefix.PushTagCommitNotOnRemote + JSON.stringify(['origin', 'upstream'])
				]);
				expect(git.calls.length).toBe(1);
			});

			it('should bypass commit containment check when skipRemoteCheck is true', async () => {
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', true);
				expect(errors).toEqual([null, null]);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['push', 'origin', 'v1.0.0'], repo: REPO },
					{ method: 'runGitCommand', args: ['push', 'upstream', 'v1.0.0'], repo: REPO }
				]);
			});

			it('should fallback to assuming remotes contain commit if containment check rejects', async () => {
				git.spawnGitResponses.push(new Error('git branch -r failed'));
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin'], 'hash1', false);
				expect(errors).toEqual([null]);
				expect(git.calls.length).toBe(2);
			});

			it('should halt multi-remote push immediately on first error', async () => {
				git.runGitCommandResponses.push('fatal: remote connection lost');
				const errors = await tagActions.pushTag(git, REPO, 'v1.0.0', ['origin', 'upstream'], 'hash1', true);
				expect(errors).toEqual(['fatal: remote connection lost']);
				expect(git.calls.length).toBe(1);
			});
		});

		describe('getTagDetails multi-line parsing and version check', () => {
			it('should return incompatible Git version message for Git < 1.7.8', async () => {
				git.gitExecutable = { path: '/usr/bin/git', version: '1.7.7' };
				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.details).toBeNull();
				expect(data.error).toContain('A newer version of Git (>= 1.7.8) is required for retrieving Tag Details');
			});

			it('should parse lightweight tag with NaN date and empty fields', async () => {
				const stdout = ['abc1234', '', '', '', '', ''].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const data = await tagActions.getTagDetails(git, REPO, 'v1.0.0');
				expect(data.error).toBeNull();
				expect(data.details).toEqual({
					hash: 'abc1234',
					taggerName: '',
					taggerEmail: '',
					taggerDate: NaN,
					message: '',
					signature: null
				});
			});

			it('should parse annotated tag stripping trailing blank lines but preserving middle blank lines', async () => {
				const stdout = [
					'commit_hash_123',
					'Alice Developer',
					'<alice@example.com>',
					'1696000000',
					'', // No signature
					'Title line\n\nParagraph 1\n\nParagraph 2\n\n\n\n'
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const data = await tagActions.getTagDetails(git, REPO, 'v2.0.0');
				expect(data.error).toBeNull();
				expect(data.details).toEqual({
					hash: 'commit_hash_123',
					taggerName: 'Alice Developer',
					taggerEmail: 'alice@example.com',
					taggerDate: 1696000000,
					message: 'Title line\n\nParagraph 1\n\nParagraph 2',
					signature: null
				});
			});

			it('should handle tagger email without angle brackets or with empty angle brackets', async () => {
				// No angle brackets
				let stdout = ['h1', 'Bob', 'bob@example.com', '1000', '', 'msg'].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);
				let data = await tagActions.getTagDetails(git, REPO, 't1');
				expect(data.details?.taggerEmail).toBe('bob@example.com');

				// Empty angle brackets
				git.reset();
				stdout = ['h2', 'Bob', '<>', '1000', '', 'msg'].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);
				data = await tagActions.getTagDetails(git, REPO, 't2');
				expect(data.details?.taggerEmail).toBe('');
			});

			it('should reassemble tag message that contains GIT_LOG_SEPARATOR', async () => {
				const rawMsg = `Part1${GIT_LOG_SEPARATOR}Part2${GIT_LOG_SEPARATOR}Part3\n\n`;
				const stdout = [
					'h1',
					'Charlie',
					'<charlie@example.com>',
					'2000',
					'',
					rawMsg
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const data = await tagActions.getTagDetails(git, REPO, 't1');
				expect(data.details?.message).toBe(`Part1${GIT_LOG_SEPARATOR}Part2${GIT_LOG_SEPARATOR}Part3`);
			});

			it('should strip PGP signature from message for signed tags and fetch signature details', async () => {
				const pgpSig = '-----BEGIN PGP SIGNATURE-----\nVersion: GnuPG v2\n...sig...\n-----END PGP SIGNATURE-----';
				const msgBody = `Signed Release v3.0\nDetailed changelog\n${pgpSig}\n\n`;
				const stdout = [
					'commit_hash_signed',
					'Key Master',
					'<km@security.org>',
					'1700000000',
					pgpSig,
					msgBody
				].join(GIT_LOG_SEPARATOR);
				git.spawnGitResponses.push(stdout);

				const gpgOutput = '[GNUPG:] GOODSIG DEADBEEF Key Master <km@security.org>\n[GNUPG:] VALIDSIG DEADBEEF';
				git._spawnGitResponses.push({ stdout: Buffer.from(gpgOutput), stderr: '' });

				const data = await tagActions.getTagDetails(git, REPO, 'v3.0.0');
				expect(data.error).toBeNull();
				expect(data.details?.message).toBe('Signed Release v3.0\nDetailed changelog');
				expect(data.details?.signature).toEqual({
					status: GitSignatureStatus.GoodAndValid,
					key: 'DEADBEEF',
					signer: 'Key Master <km@security.org>'
				});
			});
		});

		describe('getTagSignature GPG non-zero exit tolerance', () => {
			it('should invoke _spawnGit with ignoreExitCode=true', async () => {
				const gpgStderr = '[GNUPG:] GOODSIG 112233 Alice <alice@work.org>\n[GNUPG:] TRUST_ULTIMATE';
				git._spawnGitResponses.push({ stdout: Buffer.from(''), stderr: gpgStderr });

				const sig = await tagActions.getTagSignature(git, REPO, 'refs/tags/v1.0.0');
				expect(sig.status).toBe(GitSignatureStatus.GoodAndValid);
				expect(sig.key).toBe('112233');
				expect(sig.signer).toBe('Alice <alice@work.org>');
				expect(git.calls[0]).toEqual({
					method: '_spawnGit',
					args: ['verify-tag', '--raw', 'refs/tags/v1.0.0'],
					repo: REPO,
					ignoreExitCode: true
				});
			});

			it('should parse BADSIG status correctly when exit code is non-zero', async () => {
				const gpgStderr = '[GNUPG:] BADSIG 445566 Bad Actor <bad@hacker.org>';
				git._spawnGitResponses.push({ stdout: Buffer.from(''), stderr: gpgStderr });

				const sig = await tagActions.getTagSignature(git, REPO, 'refs/tags/tampered');
				expect(sig.status).toBe(GitSignatureStatus.Bad);
				expect(sig.key).toBe('445566');
				expect(sig.signer).toBe('Bad Actor <bad@hacker.org>');
			});

			it('should parse ERRSIG and EXPSIG correctly', async () => {
				git._spawnGitResponses.push({ stdout: Buffer.from(''), stderr: '[GNUPG:] ERRSIG 778899 1 2 00 12345 9' });
				let sig = await tagActions.getTagSignature(git, REPO, 'refs/tags/err');
				expect(sig.status).toBe(GitSignatureStatus.CannotBeChecked);

				git.reset();
				git._spawnGitResponses.push({ stdout: Buffer.from(''), stderr: '[GNUPG:] EXPSIG 990011 Expired Key' });
				sig = await tagActions.getTagSignature(git, REPO, 'refs/tags/exp');
				expect(sig.status).toBe(GitSignatureStatus.GoodButExpired);
			});

			it('should fallback to CannotBeChecked if _spawnGit rejects completely', async () => {
				git._spawnGitResponses.push(new Error('spawn error: ENOENT git'));
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
	// 3. Remote Operations Adversarial Scenarios
	// =========================================================================
	describe('Remote Operations Adversarial Scenarios', () => {
		describe('editRemote add/delete/update URLs and push URLs with sequential failure abort', () => {
			it('should handle rename, URL update, and pushURL update when all changed', async () => {
				const status = await remoteActions.editRemote(
					git, REPO,
					'origin', 'upstream',
					'https://old.git', 'https://new.git',
					'https://old-push.git', 'https://new-push.git'
				);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'rename', 'origin', 'upstream'], repo: REPO },
					{ method: 'runGitCommand', args: ['remote', 'set-url', 'upstream', 'https://new.git', 'https://old.git'], repo: REPO },
					{ method: 'runGitCommand', args: ['remote', 'set-url', '--push', 'upstream', 'https://new-push.git', 'https://old-push.git'], repo: REPO }
				]);
			});

			it('should delete URL when urlNew is null and add URL when urlOld is null', async () => {
				// Delete URL
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', 'https://old.git', null, null, null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', 'origin', '--delete', 'https://old.git']);

				// Add URL
				git.reset();
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, 'https://new.git', null, null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', 'origin', '--add', 'https://new.git']);
			});

			it('should delete push URL when pushUrlNew is null and add push URL when pushUrlOld is null', async () => {
				// Delete push URL
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, null, 'https://old-push.git', null);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', '--push', 'origin', '--delete', 'https://old-push.git']);

				// Add push URL
				git.reset();
				await remoteActions.editRemote(git, REPO, 'origin', 'origin', null, null, null, 'https://new-push.git');
				expect(git.calls[0].args).toEqual(['remote', 'set-url', '--push', 'origin', '--add', 'https://new-push.git']);
			});

			it('should abort immediately if rename fails and skip URL updates', async () => {
				git.runGitCommandResponses.push('fatal: remote upstream already exists');
				const status = await remoteActions.editRemote(
					git, REPO,
					'origin', 'upstream',
					'https://old.git', 'https://new.git',
					'https://old-push.git', 'https://new-push.git'
				);
				expect(status).toBe('fatal: remote upstream already exists');
				expect(git.calls.length).toBe(1);
			});

			it('should abort immediately if URL update fails and skip push URL update', async () => {
				git.runGitCommandResponses.push('error: could not set url');
				const status = await remoteActions.editRemote(
					git, REPO,
					'origin', 'origin',
					'https://old.git', 'https://new.git',
					'https://old-push.git', 'https://new-push.git'
				);
				expect(status).toBe('error: could not set url');
				expect(git.calls.length).toBe(1);
				expect(git.calls[0].args).toEqual(['remote', 'set-url', 'origin', 'https://new.git', 'https://old.git']);
			});

			it('should do nothing and return null when no values changed', async () => {
				const status = await remoteActions.editRemote(
					git, REPO,
					'origin', 'origin',
					'https://same.git', 'https://same.git',
					'https://same-push.git', 'https://same-push.git'
				);
				expect(status).toBeNull();
				expect(git.calls.length).toBe(0);
			});
		});

		describe('fetch prune vs prune-tags version checks', () => {
			it('should reject prune-tags if prune is false for specific remote', async () => {
				const status = await remoteActions.fetch(git, REPO, 'origin', false, true);
				expect(status).toBe('In order to Prune Tags, pruning must also be enabled when fetching from a remote.');
				expect(git.calls.length).toBe(0);
			});

			it('should reject prune-tags if prune is false for all remotes (remote is null)', async () => {
				const status = await remoteActions.fetch(git, REPO, null, false, true);
				expect(status).toBe('In order to Prune Tags, pruning must also be enabled when fetching from remote(s).');
				expect(git.calls.length).toBe(0);
			});

			it('should check Git version requirement (>= 2.17.0) for prune-tags', async () => {
				git.gitExecutable = { path: '/git', version: '2.16.5' };
				const status = await remoteActions.fetch(git, REPO, 'origin', true, true);
				expect(status).toContain('A newer version of Git (>= 2.17.0) is required for pruning tags when fetching');
				expect(git.calls.length).toBe(0);
			});

			it('should allow prune-tags when Git version is >= 2.17.0', async () => {
				git.gitExecutable = { path: '/git', version: '2.17.0' };
				const status = await remoteActions.fetch(git, REPO, 'origin', true, true);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['fetch', 'origin', '--prune', '--prune-tags']);
			});

			it('should use --all when remote is null', async () => {
				const status = await remoteActions.fetch(git, REPO, null, true, false);
				expect(status).toBeNull();
				expect(git.calls[0].args).toEqual(['fetch', '--all', '--prune']);
			});
		});

		describe('pushBranchToMultipleRemotes sequential failure abort', () => {
			it('should return error when remotes array is empty', async () => {
				const errors = await remoteActions.pushBranchToMultipleRemotes(
					git, REPO, 'main', [], false, GitPushBranchMode.Normal
				);
				expect(errors).toEqual(['No remote(s) were specified to push the branch main to.']);
				expect(git.calls.length).toBe(0);
			});

			it('should push sequentially to multiple remotes with mode flags', async () => {
				// Normal mode
				let errors = await remoteActions.pushBranchToMultipleRemotes(
					git, REPO, 'main', ['origin', 'backup', 'mirror'], true, GitPushBranchMode.Normal
				);
				expect(errors).toEqual([null, null, null]);
				expect(git.calls.length).toBe(3);
				expect(git.calls[0].args).toEqual(['push', 'origin', 'main', '--set-upstream']);
				expect(git.calls[1].args).toEqual(['push', 'backup', 'main', '--set-upstream']);
				expect(git.calls[2].args).toEqual(['push', 'mirror', 'main', '--set-upstream']);

				// Force mode
				git.reset();
				errors = await remoteActions.pushBranchToMultipleRemotes(
					git, REPO, 'main', ['r1', 'r2'], false, GitPushBranchMode.Force
				);
				expect(errors).toEqual([null, null]);
				expect(git.calls[0].args).toEqual(['push', 'r1', 'main', '--force']);
				expect(git.calls[1].args).toEqual(['push', 'r2', 'main', '--force']);

				// ForceWithLease mode
				git.reset();
				errors = await remoteActions.pushBranchToMultipleRemotes(
					git, REPO, 'main', ['r1'], false, GitPushBranchMode.ForceWithLease
				);
				expect(errors).toEqual([null]);
				expect(git.calls[0].args).toEqual(['push', 'r1', 'main', '--force-with-lease']);
			});

			it('should halt sequential push immediately on first error', async () => {
				git.runGitCommandResponses.push(null, 'fatal: network unreachable');
				const errors = await remoteActions.pushBranchToMultipleRemotes(
					git, REPO, 'main', ['origin', 'backup', 'mirror'], false, GitPushBranchMode.Normal
				);
				expect(errors).toEqual([null, 'fatal: network unreachable']);
				expect(git.calls.length).toBe(2); // 'mirror' is never called!
			});
		});

		describe('getRemotesContainingCommit edge cases', () => {
			it('should correctly match remote prefixes and avoid false prefix collision', async () => {
				// "origin-backup" vs "origin": "origin-backup/feat" should NOT match "origin"
				const stdout = [
					'  origin-backup/feat',
					'  upstream/main'
				].join('\n') + '\n';
				git.spawnGitResponses.push(stdout);

				const matched = await remoteActions.getRemotesContainingCommit(git, REPO, 'hash1', ['origin', 'origin-backup', 'upstream']);
				expect(matched).toEqual(['origin-backup', 'upstream']);
				expect(matched).not.toContain('origin');
			});

			it('should filter out detached HEAD and invalid branch outputs', async () => {
				const stdout = [
					'  (HEAD detached at 1234abc)',
					'  origin/HEAD -> origin/main',
					'  origin/main'
				].join('\n') + '\n';
				git.spawnGitResponses.push(stdout);

				const matched = await remoteActions.getRemotesContainingCommit(git, REPO, 'hash1', ['origin']);
				expect(matched).toEqual(['origin']);
			});
		});

		describe('addRemote, deleteRemote, pruneRemote, getRemoteUrl, getRemotes', () => {
			it('should addRemote with and without pushUrl and shouldFetch', async () => {
				// With pushUrl and shouldFetch
				let status = await remoteActions.addRemote(git, REPO, 'origin', 'https://origin.git', 'https://push.git', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['remote', 'add', 'origin', 'https://origin.git'], repo: REPO },
					{ method: 'runGitCommand', args: ['remote', 'set-url', 'origin', '--push', 'https://push.git'], repo: REPO },
					{ method: 'runGitCommand', args: ['fetch', 'origin'], repo: REPO }
				]);

				// Halt if remote add fails
				git.reset();
				git.runGitCommandResponses.push('fatal: remote origin already exists');
				status = await remoteActions.addRemote(git, REPO, 'origin', 'https://origin.git', 'https://push.git', true);
				expect(status).toBe('fatal: remote origin already exists');
				expect(git.calls.length).toBe(1);
			});

			it('should deleteRemote and pruneRemote', async () => {
				await remoteActions.deleteRemote(git, REPO, 'origin');
				expect(git.calls[0].args).toEqual(['remote', 'remove', 'origin']);

				git.reset();
				await remoteActions.pruneRemote(git, REPO, 'origin');
				expect(git.calls[0].args).toEqual(['remote', 'prune', 'origin']);
			});

			it('should getRemoteUrl and return null on rejection', async () => {
				git.spawnGitResponses.push('https://github.com/my/repo.git\n');
				const url = await remoteActions.getRemoteUrl(git, REPO, 'origin');
				expect(url).toBe('https://github.com/my/repo.git');

				git.spawnGitResponses.push(new Error('not found'));
				const nullUrl = await remoteActions.getRemoteUrl(git, REPO, 'missing');
				expect(nullUrl).toBeNull();
			});

			it('should getRemotes splitting by line and removing trailing empty line', async () => {
				git.spawnGitResponses.push('origin\nupstream\nbackup\n');
				const remotes = await remoteActions.getRemotes(git, REPO);
				expect(remotes).toEqual(['origin', 'upstream', 'backup']);
			});
		});
	});
});
