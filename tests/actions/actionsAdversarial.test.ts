import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });

import * as commitActions from '../../src/actions/commitActions';
import * as diffActions from '../../src/actions/diffActions';
import * as stashActions from '../../src/actions/stashActions';
import { GIT_LOG_SEPARATOR, parseStashes } from '../../src/parsers';
import {
	GitFileStatus,
	GitResetMode,
	GitSignatureStatus,
	MergeActionOn,
	RebaseActionOn,
	SquashMessageFormat
} from '../../src/types';
import {
	GitVersionRequirement,
	UNABLE_TO_FIND_GIT_MSG,
	UNCOMMITTED
} from '../../src/utils';
import { MockGitExecutor } from './fixtures/mockGitExecutor';

const REPO = '/path/to/test-repo';

describe('Adversarial Challenge: Stash, Commit & Diff Actions', () => {
	let git: MockGitExecutor;

	beforeEach(() => {
		git = new MockGitExecutor();
		(vscode.window.showErrorMessage as jest.Mock).mockReturnValue(Promise.resolve(undefined));
		vscode.mockExtensionSettingReturnValue('repository.sign.commits', false);
	});

	// =========================================================================
	// 1. STASH OPERATIONS ADVERSARIAL CHALLENGES
	// =========================================================================
	describe('1. Stash Operations Adversarial Matrix', () => {

		describe('1.1 Stash Details: 2-Parent Standard vs 3-Parent Untracked Stashes', () => {
			it('should handle standard 2-parent stash without spawning untracked diff commands', async () => {
				const baseStdout = [
					'stash100', 'p1 p2', 'Author', 'author@test.com', '1650000000',
					'Committer', 'committer@test.com', '1650000000', '', '', '', 'Stash message body'
				].join(GIT_LOG_SEPARATOR);

				git.spawnGitResponses.push(baseStdout); // getCommitDetailsBase
				git.spawnGitResponses.push('M\0src/app.ts\0'); // tracked name-status
				git.spawnGitResponses.push('5\t2\tsrc/app.ts\0'); // tracked numstat

				const result = await stashActions.getStashDetails(git, REPO, 'stash100', {
					selector: 'stash@{0}',
					baseHash: 'p1',
					untrackedFilesHash: null
				});

				expect(result.error).toBeNull();
				expect(result.commitDetails).not.toBeNull();
				expect(result.commitDetails?.hash).toBe('stash100');
				expect(result.commitDetails?.fileChanges).toEqual([
					{
						oldFilePath: 'src/app.ts',
						newFilePath: 'src/app.ts',
						type: GitFileStatus.Modified,
						additions: 5,
						deletions: 2
					}
				]);

				// Exactly 3 spawnGit calls (base details, name-status, numstat); none for untracked
				expect(git.calls.filter(c => c.method === 'spawnGit').length).toBe(3);
			});

			it('should handle 3-parent untracked stash and mutate Added files to Untracked', async () => {
				const baseStdout = [
					'stash300', 'p1 p2 p3_untracked', 'Author', 'author@test.com', '1650000000',
					'Committer', 'committer@test.com', '1650000000', '', '', '', 'WIP with untracked'
				].join(GIT_LOG_SEPARATOR);

				git.spawnGitResponses.push(baseStdout); // base details
				git.spawnGitResponses.push('M\0tracked.ts\0'); // tracked name-status
				git.spawnGitResponses.push('1\t1\ttracked.ts\0'); // tracked numstat
				// Untracked commit diff-tree output (fromHash === toHash)
				git.spawnGitResponses.push('p3_untracked\0A\0new_file1.txt\0A\0new_file2.txt\0'); // untracked name-status
				git.spawnGitResponses.push(['p3_untracked', '10\t0\tnew_file1.txt', '20\t0\tnew_file2.txt', ''].join('\0')); // untracked numstat

				const result = await stashActions.getStashDetails(git, REPO, 'stash300', {
					selector: 'stash@{1}',
					baseHash: 'p1',
					untrackedFilesHash: 'p3_untracked'
				});

				expect(result.error).toBeNull();
				expect(result.commitDetails).not.toBeNull();
				expect(result.commitDetails?.fileChanges.length).toBe(3);

				// Tracked change
				expect(result.commitDetails?.fileChanges[0]).toEqual({
					oldFilePath: 'tracked.ts',
					newFilePath: 'tracked.ts',
					type: GitFileStatus.Modified,
					additions: 1,
					deletions: 1
				});

				// Untracked changes converted from Added to Untracked
				expect(result.commitDetails?.fileChanges[1]).toEqual({
					oldFilePath: 'new_file1.txt',
					newFilePath: 'new_file1.txt',
					type: GitFileStatus.Untracked,
					additions: 10,
					deletions: 0
				});
				expect(result.commitDetails?.fileChanges[2]).toEqual({
					oldFilePath: 'new_file2.txt',
					newFilePath: 'new_file2.txt',
					type: GitFileStatus.Untracked,
					additions: 20,
					deletions: 0
				});

				// Verify untracked diffs invoked diff-tree with --root
				const untrackedCalls = git.calls.filter(
					c => c.method === 'spawnGit' && c.args.includes('p3_untracked')
				);
				expect(untrackedCalls.length).toBe(2);
				expect(untrackedCalls[0].args).toContain('--root');
				expect(untrackedCalls[1].args).toContain('--root');
			});

			it('should ignore non-Added files inside untracked files commit if present', async () => {
				const baseStdout = [
					'stash301', 'p1 p2 p3', 'Author', 'author@test.com', '1650000000',
					'Committer', 'committer@test.com', '1650000000', '', '', '', 'WIP'
				].join(GIT_LOG_SEPARATOR);

				git.spawnGitResponses.push(baseStdout);
				git.spawnGitResponses.push(''); // tracked names
				git.spawnGitResponses.push(''); // tracked nums
				// Untracked commit contains an Added file AND an anomalous Modified file
				git.spawnGitResponses.push('p3\0A\0valid_untracked.txt\0M\0ignored_mod.txt\0');
				git.spawnGitResponses.push(['p3', '10\t0\tvalid_untracked.txt', '5\t5\tignored_mod.txt', ''].join('\0'));

				const result = await stashActions.getStashDetails(git, REPO, 'stash301', {
					selector: 'stash@{0}',
					baseHash: 'p1',
					untrackedFilesHash: 'p3'
				});

				expect(result.error).toBeNull();
				// Only the Added file was converted and appended
				expect(result.commitDetails?.fileChanges.length).toBe(1);
				expect(result.commitDetails?.fileChanges[0].oldFilePath).toBe('valid_untracked.txt');
				expect(result.commitDetails?.fileChanges[0].type).toBe(GitFileStatus.Untracked);
			});

			it('should catch rejection if untracked files diff command fails', async () => {
				const baseStdout = [
					'stashErr', 'p1 p2 p3', 'Author', 'author@test.com', '1650000000',
					'Committer', 'committer@test.com', '1650000000', '', '', '', 'WIP'
				].join(GIT_LOG_SEPARATOR);

				git.spawnGitResponses.push(baseStdout);
				git.spawnGitResponses.push(''); // tracked names
				git.spawnGitResponses.push(''); // tracked nums
				git.spawnGitResponses.push(new Error('fatal: corrupt untracked tree object')); // untracked names fail
				git.spawnGitResponses.push(''); // untracked nums

				const result = await stashActions.getStashDetails(git, REPO, 'stashErr', {
					selector: 'stash@{0}',
					baseHash: 'p1',
					untrackedFilesHash: 'p3'
				});

				expect(result.commitDetails).toBeNull();
				expect(result.error).toBe('fatal: corrupt untracked tree object');
			});
		});

		describe('1.2 Stash Apply & Pop: with and without --index', () => {
			it('should apply stash without --index and with custom selector', async () => {
				const status = await stashActions.applyStash(git, REPO, 'stash@{42}', false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'apply', 'stash@{42}'], repo: REPO }
				]);
			});

			it('should apply stash with --index positioned before selector', async () => {
				const status = await stashActions.applyStash(git, REPO, 'stash@{0}', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'apply', '--index', 'stash@{0}'], repo: REPO }
				]);
			});

			it('should pop stash without --index and propagate conflicts', async () => {
				git.runGitCommandResponses.push('CONFLICT (content): Merge conflict in file.ts');
				const status = await stashActions.popStash(git, REPO, 'stash@{1}', false);
				expect(status).toBe('CONFLICT (content): Merge conflict in file.ts');
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'pop', 'stash@{1}'], repo: REPO }
				]);
			});

			it('should pop stash with --index positioned before selector', async () => {
				const status = await stashActions.popStash(git, REPO, 'stash@{15}', true);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'pop', '--index', 'stash@{15}'], repo: REPO }
				]);
			});

			it('should execute branchFromStash with exact [stash, branch, name, selector] order', async () => {
				const status = await stashActions.branchFromStash(git, REPO, 'stash@{2}', 'hotfix/stash-recovery');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'branch', 'hotfix/stash-recovery', 'stash@{2}'], repo: REPO }
				]);
			});

			it('should drop stash with selector', async () => {
				const status = await stashActions.dropStash(git, REPO, 'stash@{5}');
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['stash', 'drop', 'stash@{5}'], repo: REPO }
				]);
			});
		});

		describe('1.3 Push Stash: Version Requirements & --include-untracked', () => {
			it('should fail with UNABLE_TO_FIND_GIT_MSG when git executable is null', async () => {
				git.gitExecutable = null;
				const status = await stashActions.pushStash(git, REPO, 'save work', true);
				expect(status).toBe(UNABLE_TO_FIND_GIT_MSG);
				expect(git.calls.length).toBe(0);
			});

			it('should reject git versions strictly below 2.13.2', async () => {
				const oldVersions = ['1.9.5', '2.0.0', '2.10.0', '2.13.0', '2.13.1'];
				for (const ver of oldVersions) {
					git.gitExecutable = { path: '/git', version: ver };
					expect(git.isGitAtLeastVersion(GitVersionRequirement.PushStash)).toBe(false);
					const status = await stashActions.pushStash(git, REPO, 'WIP', false);
					expect(status).toContain('A newer version of Git (>= 2.13.2) is required');
					expect(git.calls.length).toBe(0);
				}
			});

			it('should allow boundary version 2.13.2 and higher versions', async () => {
				const okVersions = ['2.13.2', '2.14.0', '2.39.2', '3.0.0'];
				for (const ver of okVersions) {
					git.reset();
					git.gitExecutable = { path: '/git', version: ver };
					const status = await stashActions.pushStash(git, REPO, '', false);
					expect(status).toBeNull();
					expect(git.calls[0].args).toEqual(['stash', 'push']);
				}
			});

			it('should construct push stash arguments with all flag combinations', async () => {
				git.gitExecutable = { path: '/git', version: '2.40.0' };

				// neither untracked nor message
				git.reset();
				await stashActions.pushStash(git, REPO, '', false);
				expect(git.calls[0].args).toEqual(['stash', 'push']);

				// untracked only
				git.reset();
				await stashActions.pushStash(git, REPO, '', true);
				expect(git.calls[0].args).toEqual(['stash', 'push', '--include-untracked']);

				// message only
				git.reset();
				await stashActions.pushStash(git, REPO, 'my message', false);
				expect(git.calls[0].args).toEqual(['stash', 'push', '--message', 'my message']);

				// both untracked and message
				git.reset();
				await stashActions.pushStash(git, REPO, 'my message', true);
				expect(git.calls[0].args).toEqual(['stash', 'push', '--include-untracked', '--message', 'my message']);

				// message with spaces, quotes, and unicode
				git.reset();
				await stashActions.pushStash(git, REPO, 'WIP: fix #123 & "quote" 🚀', true);
				expect(git.calls[0].args).toEqual(['stash', 'push', '--include-untracked', '--message', 'WIP: fix #123 & "quote" 🚀']);
			});
		});

		describe('1.4 Stash Reflog Parsing Integration', () => {
			it('should parse 2-parent vs 3-parent stashes from reflog output', async () => {
				const stdout = [
					// 2-parent stash
					['hash1', 'base1 parent2', 'stash@{0}', 'Dev', 'dev@test.com', '1600000000', 'WIP on main'].join(GIT_LOG_SEPARATOR),
					// 3-parent stash with untracked commit
					['hash2', 'base2 parent2 parent3_untracked', 'stash@{1}', 'Dev', 'dev@test.com', '1600000010', 'WIP with untracked'].join(GIT_LOG_SEPARATOR),
					// corrupt line (ignored)
					'corrupt line'
				].join('\n');

				git.spawnGitResponses.push(stdout);
				const parsedDirectly = parseStashes(stdout);
				expect(parsedDirectly.length).toBe(2);
				const stashes = await stashActions.getStashes(git, REPO);

				expect(stashes.length).toBe(2);
				expect(stashes[0].selector).toBe('stash@{0}');
				expect(stashes[0].baseHash).toBe('base1');
				expect(stashes[0].untrackedFilesHash).toBeNull();

				expect(stashes[1].selector).toBe('stash@{1}');
				expect(stashes[1].baseHash).toBe('base2');
				expect(stashes[1].untrackedFilesHash).toBe('parent3_untracked');
			});
		});
	});

	// =========================================================================
	// 2. COMMIT OPERATIONS ADVERSARIAL CHALLENGES
	// =========================================================================
	describe('2. Commit Operations Adversarial Matrix', () => {

		describe('2.1 Cherrypick: -x, -m, --no-commit, -S variations', () => {
			it('should handle cherrypick with only commitHash', async () => {
				await commitActions.cherrypickCommit(git, REPO, 'abc1234', 0, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', 'abc1234']);
			});

			it('should handle cherrypick with --no-commit flag', async () => {
				await commitActions.cherrypickCommit(git, REPO, 'abc1234', 0, false, true);
				expect(git.calls[0].args).toEqual(['cherry-pick', '--no-commit', 'abc1234']);
			});

			it('should handle cherrypick with -x flag', async () => {
				await commitActions.cherrypickCommit(git, REPO, 'abc1234', 0, true, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', '-x', 'abc1234']);
			});

			it('should handle cherrypick with parent index -m for merge commits', async () => {
				await commitActions.cherrypickCommit(git, REPO, 'mergeCommitHash', 1, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', '-m', '1', 'mergeCommitHash']);

				git.reset();
				await commitActions.cherrypickCommit(git, REPO, 'mergeCommitHash', 2, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', '-m', '2', 'mergeCommitHash']);
			});

			it('should NOT add -m if parentIndex <= 0', async () => {
				await commitActions.cherrypickCommit(git, REPO, 'hash1', 0, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', 'hash1']);

				git.reset();
				await commitActions.cherrypickCommit(git, REPO, 'hash2', -1, false, false);
				expect(git.calls[0].args).toEqual(['cherry-pick', 'hash2']);
			});

			it('should combine --no-commit, -x, -S, -m and commitHash in strict order', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.cherrypickCommit(git, REPO, 'complexMergeHash', 3, true, true);
				expect(git.calls[0].args).toEqual([
					'cherry-pick',
					'--no-commit',
					'-x',
					'-S',
					'-m',
					'3',
					'complexMergeHash'
				]);
			});
		});

		describe('2.2 Rebase: Interactive vs Non-Interactive and Shell Escaping', () => {
			it('should escape single quotes in branch name for interactive rebase', async () => {
				await commitActions.rebase(git, REPO, 'feature/\'special\'-name', RebaseActionOn.Branch, false, true);
				expect(git.calls).toEqual([
					{
						method: 'openGitTerminal',
						args: ['rebase --interactive feature/"\'"special"\'"-name'],
						repo: REPO
					}
				]);
			});

			it('should abbreviate commit hash in terminal title for commit rebase', async () => {
				const longHash = 'abcdef0123456789abcdef0123456789abcdef01';
				await commitActions.rebase(git, REPO, longHash, RebaseActionOn.Commit, false, true);
				expect(git.calls).toEqual([
					{
						method: 'openGitTerminal',
						args: ['rebase --interactive ' + longHash],
						repo: REPO
					}
				]);
			});

			it('should include -S flag in interactive rebase terminal command when signCommits is true', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.rebase(git, REPO, 'main', RebaseActionOn.Branch, false, true);
				expect(git.calls[0].args).toEqual(['rebase --interactive -S main']);
			});

			it('should run non-interactive rebase with --ignore-date and -S flags', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.rebase(git, REPO, 'upstream/main', RebaseActionOn.Branch, true, false);
				expect(git.calls[0].args).toEqual(['rebase', 'upstream/main', '--ignore-date', '-S']);
			});
		});

		describe('2.3 Merge & Squash Merge Staged Commit Resolution', () => {
			it('should perform standard merge with --no-ff and signCommits', async () => {
				vscode.mockExtensionSettingReturnValue('repository.sign.commits', true);
				await commitActions.merge(git, REPO, 'feat-branch', MergeActionOn.Branch, true, false, false);
				expect(git.calls[0].args).toEqual(['merge', 'feat-branch', '--no-ff', '-S']);
			});

			it('should perform merge with --squash and --no-commit without auto-committing', async () => {
				await commitActions.merge(git, REPO, 'feat-branch', MergeActionOn.Branch, false, true, true);
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['merge', 'feat-branch', '--squash', '--no-commit'], repo: REPO }
				]);
				// No diff-index or commit was attempted
				expect(git.calls.length).toBe(1);
			});

			it('should auto-commit staged changes after clean squash merge (Default format)', async () => {
				// 1. git merge feat --squash -> returns null (success)
				// 2. git diff-index HEAD -> returns changes
				git.spawnGitResponses.push(':100644 100644 0000000 1111111 M\tfile.ts\n');
				// 3. git commit -m ...

				const status = await commitActions.merge(git, REPO, 'feat-squash', MergeActionOn.Branch, false, true, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['merge', 'feat-squash', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO },
					{ method: 'runGitCommand', args: ['commit', '-m', 'Merge branch \'feat-squash\''], repo: REPO }
				]);
			});

			it('should auto-commit with --no-edit when squashMessageFormat is GitSquashMsg', async () => {
				vscode.mockExtensionSettingReturnValue('dialog.merge.squashMessageFormat', 'Git SQUASH_MSG');
				git.spawnGitResponses.push('changes'); // diff-index HEAD

				await commitActions.merge(git, REPO, 'feat-squash', MergeActionOn.Branch, false, true, false);
				expect(git.calls[2].args).toEqual(['commit', '--no-edit']);
			});

			it('should skip auto-commit when squash merge produces NO staged changes', async () => {
				git.spawnGitResponses.push(''); // diff-index HEAD reports empty stdout (no staged changes)

				const status = await commitActions.merge(git, REPO, 'empty-squash', MergeActionOn.Branch, false, true, false);
				expect(status).toBeNull();
				expect(git.calls).toEqual([
					{ method: 'runGitCommand', args: ['merge', 'empty-squash', '--squash'], repo: REPO },
					{ method: 'spawnGit', args: ['diff-index', 'HEAD'], repo: REPO }
				]);
				// No follow-up commit was spawned
				expect(git.calls.length).toBe(2);
			});

			it('should skip auto-commit when squash merge fails with conflict error', async () => {
				git.runGitCommandResponses.push('CONFLICT: Automatic merge failed; fix conflicts and then commit.');

				const status = await commitActions.merge(git, REPO, 'conflict-squash', MergeActionOn.Branch, false, true, false);
				expect(status).toBe('CONFLICT: Automatic merge failed; fix conflicts and then commit.');
				// Diff-index and commit must not be called on merge error
				expect(git.calls.length).toBe(1);
			});

			it('should directly execute commitSquashIfStagedChangesExist with Default and GitSquashMsg formats', async () => {
				// Default format with staged changes
				git.spawnGitResponses.push('staged');
				await commitActions.commitSquashIfStagedChangesExist(git, REPO, 'feat-x', MergeActionOn.Branch, SquashMessageFormat.Default, false);
				expect(git.calls[1].args).toEqual(['commit', '-m', 'Merge branch \'feat-x\'']);

				// GitSquashMsg format with staged changes and signing
				git.reset();
				git.spawnGitResponses.push('staged');
				await commitActions.commitSquashIfStagedChangesExist(git, REPO, 'feat-x', MergeActionOn.Commit, SquashMessageFormat.GitSquashMsg, true);
				expect(git.calls[1].args).toEqual(['commit', '-S', '--no-edit']);
			});
		});

		describe('2.4 Root Commit Parentless Diffs', () => {
			it('should query diff-tree --root when commit has no parents (hasParents: false)', async () => {
				const rootHash = 'rootCommit0001';
				const baseStdout = [
					rootHash, '', 'Author', 'author@test.com', '1600000000',
					'Committer', 'committer@test.com', '1600000000', '', '', '', 'Initial commit'
				].join(GIT_LOG_SEPARATOR);

				git.spawnGitResponses.push(baseStdout); // base details
				git.spawnGitResponses.push(`${rootHash}\0A\0README.md\0A\0package.json\0`); // diffNameStatus (first token rootHash shifted)
				git.spawnGitResponses.push([rootHash, '15\t0\tREADME.md', '40\t0\tpackage.json', ''].join('\0')); // diffNumStat (first token shifted)

				const result = await commitActions.getCommitDetails(git, REPO, rootHash, false);

				expect(result.error).toBeNull();
				expect(result.commitDetails?.hash).toBe(rootHash);
				expect(result.commitDetails?.parents).toEqual([]);
				expect(result.commitDetails?.fileChanges).toEqual([
					{
						oldFilePath: 'README.md',
						newFilePath: 'README.md',
						type: GitFileStatus.Added,
						additions: 15,
						deletions: 0
					},
					{
						oldFilePath: 'package.json',
						newFilePath: 'package.json',
						type: GitFileStatus.Added,
						additions: 40,
						deletions: 0
					}
				]);

				// Verify diff-tree with --root was used for parentless root commit
				const diffCalls = git.calls.filter(c => c.args.includes('diff-tree'));
				expect(diffCalls.length).toBe(2);
				expect(diffCalls[0].args).toContain('--root');
				expect(diffCalls[1].args).toContain('--root');
			});

			it('should query standard diff with parent when commit has parents (hasParents: true)', async () => {
				const commitHash = 'childCommit0002';
				const baseStdout = [
					commitHash, 'parent0001', 'Author', 'author@test.com', '1600000000',
					'Committer', 'committer@test.com', '1600000000', 'G', 'Signer Name', 'KeyId123', 'Second commit'
				].join(GIT_LOG_SEPARATOR);

				git.spawnGitResponses.push(baseStdout);
				git.spawnGitResponses.push('M\0README.md\0');
				git.spawnGitResponses.push('2\t1\tREADME.md\0');

				const result = await commitActions.getCommitDetails(git, REPO, commitHash, true);

				expect(result.error).toBeNull();
				expect(result.commitDetails?.parents).toEqual(['parent0001']);
				expect(result.commitDetails?.signature).toEqual({
					status: GitSignatureStatus.GoodAndValid,
					signer: 'Signer Name',
					key: 'KeyId123'
				});

				// Verify git diff (not diff-tree) was used
				const diffCalls = git.calls.filter(c => c.args[0] === 'diff');
				expect(diffCalls.length).toBe(2);
				expect(diffCalls[0].args).toEqual([
					'diff', '--name-status', '--find-renames', '--diff-filter=AMDR', '-z', 'childCommit0002^', 'childCommit0002'
				]);
			});
		});

		describe('2.5 Other Commit Actions: clean, reset, revert, archive, subject', () => {
			it('should clean untracked files with and without directory removal flag', async () => {
				await commitActions.cleanUntrackedFiles(git, REPO, false);
				expect(git.calls[0].args).toEqual(['clean', '-f']);

				git.reset();
				await commitActions.cleanUntrackedFiles(git, REPO, true);
				expect(git.calls[0].args).toEqual(['clean', '-fd']);
			});

			it('should reset file to specific revision', async () => {
				await commitActions.resetFileToRevision(git, REPO, 'hashABC', 'src/file.ts');
				expect(git.calls[0].args).toEqual(['checkout', 'hashABC', '--', 'src/file.ts']);
			});

			it('should reset current branch to commit with Soft, Mixed, and Hard modes', async () => {
				await commitActions.resetToCommit(git, REPO, 'hashReset', GitResetMode.Soft);
				expect(git.calls[0].args).toEqual(['reset', '--soft', 'hashReset']);

				git.reset();
				await commitActions.resetToCommit(git, REPO, 'hashReset', GitResetMode.Mixed);
				expect(git.calls[0].args).toEqual(['reset', '--mixed', 'hashReset']);

				git.reset();
				await commitActions.resetToCommit(git, REPO, 'hashReset', GitResetMode.Hard);
				expect(git.calls[0].args).toEqual(['reset', '--hard', 'hashReset']);
			});

			it('should drop commit with rebase --onto', async () => {
				await commitActions.dropCommit(git, REPO, 'badCommit123');
				expect(git.calls[0].args).toEqual(['rebase', '--onto', 'badCommit123^', 'badCommit123']);
			});

			it('should revert merge commit with -m flag', async () => {
				await commitActions.revertCommit(git, REPO, 'mergeCommit123', 1);
				expect(git.calls[0].args).toEqual(['revert', '--no-edit', '-m', '1', 'mergeCommit123']);
			});

			it('should archive repository with zip and tar formats', async () => {
				await commitActions.archive(git, REPO, 'HEAD', '/out.zip', 'zip');
				expect(git.calls[0].args).toEqual(['archive', '--format=zip', '-o', '/out.zip', 'HEAD']);

				git.reset();
				await commitActions.archive(git, REPO, 'v1.0.0', '/out.tar', 'tar');
				expect(git.calls[0].args).toEqual(['archive', '--format=tar', '-o', '/out.tar', 'v1.0.0']);
			});

			it('should retrieve commit subject and sanitize multiple spaces', async () => {
				git.spawnGitResponses.push('  Commit   with   weird    spacing\n\n');
				const subject = await commitActions.getCommitSubject(git, REPO, 'hashSubject');
				expect(subject).toBe('Commit with weird spacing');
			});
		});
	});

	// =========================================================================
	// 3. DIFF OPERATIONS ADVERSARIAL CHALLENGES
	// =========================================================================
	describe('3. Diff Operations Adversarial Matrix', () => {

		describe('3.1 External Dir Diff: Delay, Hash Ranges, GUI vs Terminal', () => {
			beforeEach(() => {
				jest.useFakeTimers();
			});

			afterEach(() => {
				jest.useRealTimers();
			});

			it('should immediately return UNABLE_TO_FIND_GIT_MSG when git executable is null without timer', async () => {
				git.gitExecutable = null;
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', true);
				const result = await promise;
				expect(result).toBe(UNABLE_TO_FIND_GIT_MSG);
				expect(git.calls.length).toBe(0);
			});

			it('should format commit hash range as commit^..commit when fromHash === toHash', async () => {
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hashA', 'hashA', true);
				jest.advanceTimersByTime(1499);
				let resolved = false;
				promise.then(() => { resolved = true; });
				await Promise.resolve(); // flush microtasks
				expect(resolved).toBe(false);

				jest.advanceTimersByTime(1);
				const result = await promise;
				expect(result).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'hashA^..hashA']);
			});

			it('should format commit hash range as HEAD when comparing UNCOMMITTED with UNCOMMITTED', async () => {
				const promise = diffActions.openExternalDirDiff(git, REPO, UNCOMMITTED, UNCOMMITTED, true);
				jest.runAllTimers();
				const result = await promise;
				expect(result).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'HEAD']);
			});

			it('should format commit range as fromHash when comparing commit to UNCOMMITTED', async () => {
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hashX', UNCOMMITTED, true);
				jest.runAllTimers();
				const result = await promise;
				expect(result).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'hashX']);
			});

			it('should format commit range as fromHash..toHash for two distinct commits', async () => {
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', true);
				jest.runAllTimers();
				const result = await promise;
				expect(result).toBeNull();
				expect(git.calls[0].args).toEqual(['difftool', '--dir-diff', '-g', 'hash1..hash2']);
			});

			it('should open git terminal instead of runGitCommand when isGui is false', async () => {
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', false);
				jest.runAllTimers();
				const result = await promise;
				expect(result).toBeNull();
				expect(vscode.window.createTerminal).toHaveBeenCalled();
				expect(git.calls.length).toBe(0);
			});

			it('should log and display error dialog when GUI diff tool returns error info', async () => {
				git.runGitCommandResponses.push('fatal: External diff tool crashed\nExit code 1');
				const promise = diffActions.openExternalDirDiff(git, REPO, 'hash1', 'hash2', true);
				jest.runAllTimers();
				await promise;
				await Promise.resolve(); // flush then-handler

				expect(git.mockLogger.logError).toHaveBeenCalledWith('fatal: External diff tool crashed Exit code 1');
				expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('fatal: External diff tool crashed Exit code 1');
			});
		});

		describe('3.2 File Encoding Fallback in getCommitFile', () => {
			it('should decode UTF-8 with multi-byte characters and emojis', async () => {
				const rawContent = 'Hello world! 🚀 简体中文 日本語 café\n';
				git._spawnGitResponses.push({
					stdout: Buffer.from(rawContent, 'utf8'),
					stderr: ''
				});

				const content = await diffActions.getCommitFile(git, REPO, 'rev1', 'doc.txt');
				expect(content).toBe(rawContent);
				expect(git.calls[0].args).toEqual(['show', 'rev1:doc.txt']);
			});

			it('should decode with valid alternate encoding if configured', async () => {
				vscode.mockExtensionSettingReturnValue('fileEncoding', 'latin1');
				const buffer = Buffer.from('Crème brûlée', 'latin1');
				git._spawnGitResponses.push({ stdout: buffer, stderr: '' });

				const content = await diffActions.getCommitFile(git, REPO, 'rev2', 'french.txt');
				expect(content).toBe('Crème brûlée');
			});

			it('should fallback safely to utf8 when configured encoding does not exist', async () => {
				vscode.mockExtensionSettingReturnValue('fileEncoding', 'invalid-non-existent-encoding-xyz');
				const rawContent = 'Fallback text should remain intact';
				git._spawnGitResponses.push({
					stdout: Buffer.from(rawContent, 'utf8'),
					stderr: ''
				});

				const content = await diffActions.getCommitFile(git, REPO, 'rev3', 'fallback.txt');
				expect(content).toBe('Fallback text should remain intact');
			});
		});

		describe('3.3 Rename Tracking with -R in getNewPathOfRenamedFile', () => {
			it('should detect renamed file path when match is found in diff', async () => {
				// Name-status output for renamed file
				git.spawnGitResponses.push('R100\0src/oldModule.ts\0src/newModule.ts\0');

				const newPath = await diffActions.getNewPathOfRenamedFile(git, REPO, 'commit100', 'src/oldModule.ts');
				expect(newPath).toBe('src/newModule.ts');

				// Verify diff arguments
				expect(git.calls[0].args).toEqual([
					'diff', '--name-status', '--find-renames', '--diff-filter=R', '-z', 'commit100'
				]);
			});

			it('should find matching rename among multiple renamed files with similarity indices', async () => {
				const renameOutput = [
					'R095', 'foo.ts', 'foo_renamed.ts',
					'R100', 'bar.ts', 'bar_renamed.ts',
					'R080', 'baz.ts', 'baz_renamed.ts',
					''
				].join('\0');
				git.spawnGitResponses.push(renameOutput);
				git.spawnGitResponses.push(renameOutput);

				const newBar = await diffActions.getNewPathOfRenamedFile(git, REPO, 'commit101', 'bar.ts');
				expect(newBar).toBe('bar_renamed.ts');

				const newBaz = await diffActions.getNewPathOfRenamedFile(git, REPO, 'commit101', 'baz.ts');
				expect(newBaz).toBe('baz_renamed.ts');
			});

			it('should return null when file was not renamed in the commit', async () => {
				git.spawnGitResponses.push('R100\0other.ts\0other2.ts\0');
				const result = await diffActions.getNewPathOfRenamedFile(git, REPO, 'commit102', 'unrelated.ts');
				expect(result).toBeNull();
			});

			it('should return null on git spawn error without throwing', async () => {
				git.spawnGitResponses.push(new Error('fatal: ambiguous argument'));
				const result = await diffActions.getNewPathOfRenamedFile(git, REPO, 'commit103', 'file.ts');
				expect(result).toBeNull();
			});
		});

		describe('3.4 Commit Comparison Details', () => {
			it('should fetch comparison against UNCOMMITTED including status files', async () => {
				git.spawnGitResponses.push('M\0mod.ts\0'); // diff name
				git.spawnGitResponses.push('3\t2\tmod.ts\0'); // diff num
				git.spawnGitResponses.push('?? new_untracked.txt\0'); // status porcelain

				const comp = await diffActions.getCommitComparison(git, REPO, 'headHash', UNCOMMITTED);
				expect(comp.error).toBeNull();
				expect(comp.fileChanges.length).toBe(2);
				expect(comp.fileChanges[0].newFilePath).toBe('mod.ts');
				expect(comp.fileChanges[0].type).toBe(GitFileStatus.Modified);
				expect(comp.fileChanges[1].newFilePath).toBe('new_untracked.txt');
				expect(comp.fileChanges[1].type).toBe(GitFileStatus.Untracked);
			});
		});
	});
});
