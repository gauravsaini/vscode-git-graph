import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import * as date from '../mocks/date';
import { mockSpyOnSpawn } from '../mocks/spawn';
import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });
jest.mock('../../src/askpass/askpassManager');
jest.mock('../../src/logger');

import { ConfigurationChangeEvent } from 'vscode';
import { DataSource } from '../../src/dataSource';
import {
	GIT_LOG_SEPARATOR,
	GitCommitRecord,
	GitLogParser,
	GitRefData,
	GitRefTag,
	ParseLogOptions,
	UNCOMMITTED
} from '../../src/gitLogParser';
import { Logger } from '../../src/logger';
import { CommitOrdering, GitStash } from '../../src/types';
import * as utils from '../../src/utils';
import { EventEmitter } from '../../src/utils/event';

describe('Seam 1 Characterization: Log, Ref, Stash Parsing & Assembly', () => {
	const logFixturePath = path.join(__dirname, 'fixtures/log_various_commits.txt');
	const refsFixturePath = path.join(__dirname, 'fixtures/refs_various.txt');
	const stashesFixturePath = path.join(__dirname, 'fixtures/stashes_reflog.txt');

	const logStdout = fs.readFileSync(logFixturePath, 'utf8');
	const refsStdout = fs.readFileSync(refsFixturePath, 'utf8');
	const stashesStdout = fs.readFileSync(stashesFixturePath, 'utf8');

	let onDidChangeConfiguration: EventEmitter<ConfigurationChangeEvent>;
	let onDidChangeGitExecutable: EventEmitter<utils.GitExecutable>;
	let logger: Logger;
	let spyOnSpawn: jest.SpyInstance;
	let dataSource: DataSource;

	beforeAll(() => {
		onDidChangeConfiguration = new EventEmitter<ConfigurationChangeEvent>();
		onDidChangeGitExecutable = new EventEmitter<utils.GitExecutable>();
		logger = new Logger();
		spyOnSpawn = jest.spyOn(cp, 'spawn');
	});

	afterAll(() => {
		logger.dispose();
		onDidChangeConfiguration.dispose();
		onDidChangeGitExecutable.dispose();
	});

	beforeEach(() => {
		dataSource = new DataSource(
			{ path: '/path/to/git', version: '2.25.0' },
			onDidChangeConfiguration.subscribe,
			onDidChangeGitExecutable.subscribe,
			logger
		);
	});

	afterEach(() => {
		dataSource.dispose();
	});

	const mockGitSuccessOnce = (stdout?: string, stderr?: string) => {
		mockSpyOnSpawn(spyOnSpawn, (onCallbacks, stderrOnCallbacks, stdoutOnCallbacks) => {
			if (stdout) {
				stdoutOnCallbacks['data'](Buffer.from(stdout));
			}
			stdoutOnCallbacks['close']();
			if (stderr) {
				stderrOnCallbacks['data'](Buffer.from(stderr));
			}
			stderrOnCallbacks['close']();
			onCallbacks['exit'](0);
		});
	};

	describe('getLog line parsing', () => {
		it('should parse separator-delimited commit records into structured objects', () => {
			const commits = GitLogParser.parseLogLines(logStdout);
			expect(commits.length).toBe(6);

			// Root commit (0 parents)
			const root = commits.find((c) => c.hash === '1111111111111111111111111111111111111111');
			expect(root).toBeDefined();
			expect(root!.parents).toEqual([]);
			expect(root!.author).toBe('Dev One');
			expect(root!.email).toBe('dev1@example.com');
			expect(root!.date).toBe(1700000000);
			expect(root!.message).toBe('🎉 Root commit with emoji');

			// Linear commit (1 parent)
			const linear = commits.find((c) => c.hash === '2222222222222222222222222222222222222222');
			expect(linear).toBeDefined();
			expect(linear!.parents).toEqual(['1111111111111111111111111111111111111111']);
			expect(linear!.author).toBe('Jane Doe 👩‍💻');
			expect(linear!.email).toBe('jane@example.com');
			expect(linear!.date).toBe(1700000100);
			expect(linear!.message).toBe('✨ Feature A implementation 🚀');

			// Merge commit (2 parents)
			const merge = commits.find((c) => c.hash === '5555555555555555555555555555555555555555');
			expect(merge).toBeDefined();
			expect(merge!.parents).toEqual([
				'2222222222222222222222222222222222222222',
				'3333333333333333333333333333333333333333'
			]);
			expect(merge!.message).toBe('Merge branch B into feature A');

			// Octopus merge (>2 parents)
			const octopus = commits.find((c) => c.hash === '6666666666666666666666666666666666666666');
			expect(octopus).toBeDefined();
			expect(octopus!.parents).toEqual([
				'5555555555555555555555555555555555555555',
				'4444444444444444444444444444444444444444',
				'1111111111111111111111111111111111111111'
			]);
			expect(octopus!.message).toBe('🐙 Octopus merge: A, C, and root');
		});

		it('should accurately handle Unicode characters, emojis, and multiline subject edge cases', () => {
			const multilineLog = [
				[
					'7777777777777777777777777777777777777777',
					'1111111111111111111111111111111111111111',
					'Éléonore Müller',
					'eleonore@example.de',
					'1700000600',
					'Commit with international text: 日本語 / 한국어 / 中文'
				].join(GIT_LOG_SEPARATOR),
				[
					'8888888888888888888888888888888888888888',
					'',
					'Dev 💻',
					'dev@example.com',
					'1700000700',
					'Multi-line subject simulation part 1\ncontinuation line without separator'
				].join(GIT_LOG_SEPARATOR)
			].join('\n') + '\n';

			const parsed = GitLogParser.parseLogLines(multilineLog);
			expect(parsed.length).toBe(2);
			expect(parsed[0].hash).toBe('7777777777777777777777777777777777777777');
			expect(parsed[0].author).toBe('Éléonore Müller');
			expect(parsed[0].message).toBe('Commit with international text: 日本語 / 한국어 / 中文');

			// Second record's first line has all 6 separator fields, so it gets parsed with first line of subject
			expect(parsed[1].hash).toBe('8888888888888888888888888888888888888888');
			expect(parsed[1].message).toBe('Multi-line subject simulation part 1');
			// The continuation line without separator is discarded
		});

		it('should ignore empty lines and lines with invalid separator counts', () => {
			const noisyLog = `
malformed line with no separator
hash1${GIT_LOG_SEPARATOR}parent1${GIT_LOG_SEPARATOR}author1

hash2${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email@test.com${GIT_LOG_SEPARATOR}1700000000${GIT_LOG_SEPARATOR}Valid Root
`;
			const commits = GitLogParser.parseLogLines(noisyLog);
			expect(commits.length).toBe(1);
			expect(commits[0].hash).toBe('hash2');
			expect(commits[0].parents).toEqual([]);
			expect(commits[0].message).toBe('Valid Root');
		});

		it('should match DataSource.getLog execution behavior', async () => {
			mockGitSuccessOnce(logStdout);
			const commits: GitCommitRecord[] = await (dataSource as any).getLog(
				'/path/to/repo',
				null,
				10,
				true,
				true,
				false,
				false,
				CommitOrdering.Date,
				['origin'],
				[],
				[]
			);

			expect(commits.length).toBe(6);
			expect(commits[0].hash).toBe('6666666666666666666666666666666666666666');
			expect(commits[0].parents.length).toBe(3);
			expect(commits[5].hash).toBe('1111111111111111111111111111111111111111');
			expect(commits[5].parents).toEqual([]);
		});
	});

	describe('getRefs output parsing', () => {
		it('should correctly parse heads, tags, remotes, and detached HEAD', () => {
			const refData = GitLogParser.parseRefs(refsStdout, ['upstream'], false);

			// Detached HEAD
			expect(refData.head).toBe('6666666666666666666666666666666666666666');

			// Heads (refs/heads/*)
			expect(refData.heads).toEqual([
				{ hash: '6666666666666666666666666666666666666666', name: 'main' },
				{ hash: '2222222222222222222222222222222222222222', name: 'feature/sub/a' },
				{ hash: '3333333333333333333333333333333333333333', name: 'branch-b' }
			]);

			// Lightweight Tag
			const v010 = refData.tags.find((t: GitRefTag) => t.name === 'v0.1.0');
			expect(v010).toBeDefined();
			expect(v010!.annotated).toBe(false);
			expect(v010!.hash).toBe('1111111111111111111111111111111111111111');

			// Annotated Tag with dereferenced peeled tag ^{}
			const v100Unpeeled = refData.tags.find((t) => t.name === 'v1.0.0' && !t.annotated);
			expect(v100Unpeeled).toBeDefined();
			expect(v100Unpeeled!.hash).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

			const v100Peeled = refData.tags.find((t) => t.name === 'v1.0.0' && t.annotated);
			expect(v100Peeled).toBeDefined();
			expect(v100Peeled!.hash).toBe('2222222222222222222222222222222222222222'); // dereferenced target commit hash

			// Remote Branches with /HEAD stripped and hidden remotes filtered out
			expect(refData.remotes).toEqual([
				{ hash: '6666666666666666666666666666666666666666', name: 'origin/main' },
				{ hash: '2222222222222222222222222222222222222222', name: 'origin/feature/sub/a' },
				// 'refs/remotes/upstream/branch-b' was filtered because 'upstream' is in hideRemotes
				// 'upstream-fork' must NOT be filtered by 'upstream' pattern
				{ hash: '3333333333333333333333333333333333333333', name: 'upstream-fork/branch-b' }
			]);
		});

		it('should include remote HEADs when showRemoteHeads is true', () => {
			const refData = GitLogParser.parseRefs(refsStdout, [], true);
			const remoteHead = refData.remotes.find((r) => r.name === 'origin/HEAD');
			expect(remoteHead).toBeDefined();
			expect(remoteHead!.hash).toBe('6666666666666666666666666666666666666666');
		});

		it('should match DataSource.getRefs execution behavior', async () => {
			mockGitSuccessOnce(refsStdout);
			const refData: GitRefData = await (dataSource as any).getRefs('/path/to/repo', true, false, ['upstream']);

			expect(refData.head).toBe('6666666666666666666666666666666666666666');
			expect(refData.heads.length).toBe(3);
			expect(refData.remotes.length).toBe(3); // origin/HEAD stripped, upstream/branch-b hidden
			expect(refData.tags.some((t) => t.name === 'v1.0.0' && t.annotated)).toBe(true);
		});
	});

	describe('getStashes reflog parsing', () => {
		// Pure characterization helper matching DataSource.getStashes parsing callback (dataSource.ts:1615-1632)
		const parseStashReflog = (stdout: string): GitStash[] => {
			const lines = stdout.split(/\r\n|\r|\n/g);
			const stashes: GitStash[] = [];
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i].trim();
				if (line.length === 0) continue;
				const parts = line.split(GIT_LOG_SEPARATOR);
				if (parts.length !== 7 || parts[1] === '') continue;
				const parentHashes = parts[1].split(' ');
				stashes.push({
					hash: parts[0],
					baseHash: parentHashes[0],
					untrackedFilesHash: parentHashes.length === 3 ? parentHashes[2] : null,
					selector: parts[2],
					author: parts[3],
					email: parts[4],
					date: parseInt(parts[5], 10),
					message: parts[6]
				});
			}
			return stashes;
		};

		it('should distinguish standard 2-parent stash from 3-parent untracked file stash', () => {
			const stashes = parseStashReflog(stashesStdout);
			expect(stashes.length).toBe(2);

			// Standard 2-parent stash
			const stash0 = stashes[0];
			expect(stash0.hash).toBe('s111111111111111111111111111111111111111');
			expect(stash0.baseHash).toBe('2222222222222222222222222222222222222222');
			expect(stash0.untrackedFilesHash).toBeNull();
			expect(stash0.selector).toBe('refs/stash@{0}');
			expect(stash0.author).toBe('Jane Doe');
			expect(stash0.date).toBe(1700000150);
			expect(stash0.message).toBe('WIP on feature A: 2222222 changes');

			// 3-parent untracked stash (git stash -u)
			const stash1 = stashes[1];
			expect(stash1.hash).toBe('s222222222222222222222222222222222222222');
			expect(stash1.baseHash).toBe('3333333333333333333333333333333333333333');
			expect(stash1.untrackedFilesHash).toBe('u333333333333333333333333333333333333333');
			expect(stash1.selector).toBe('refs/stash@{1}');
			expect(stash1.author).toBe('Éléonore Müller');
			expect(stash1.date).toBe(1700000250);
			expect(stash1.message).toBe('WIP on branch B: untracked configs included');
		});

		it('should ignore malformed stash lines without parent hashes', () => {
			const malformed = `hash${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}stash@{0}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}mail${GIT_LOG_SEPARATOR}12345${GIT_LOG_SEPARATOR}msg\n`;
			expect(parseStashReflog(malformed)).toEqual([]);
		});

		it('should match DataSource.getStashes execution behavior', async () => {
			mockGitSuccessOnce(stashesStdout);
			const stashes: GitStash[] = await (dataSource as any).getStashes('/path/to/repo');

			expect(stashes.length).toBe(2);
			expect(stashes[0].untrackedFilesHash).toBeNull();
			expect(stashes[1].untrackedFilesHash).toBe('u333333333333333333333333333333333333333');
		});
	});

	describe('assembleCommits', () => {
		const defaultOptions: ParseLogOptions = {
			remotes: ['origin', 'upstream-fork'],
			hideRemotes: ['upstream'],
			showRemoteHeads: false,
			showTags: true,
			maxCommits: 20
		};

		it('should splice stashes topologically directly before their base commit', () => {
			const commits = GitLogParser.parseLogLines(logStdout);
			const refData = GitLogParser.parseRefs(refsStdout, ['upstream'], false);
			const stashes: GitStash[] = [
				{
					hash: 's111111111111111111111111111111111111111',
					baseHash: '2222222222222222222222222222222222222222',
					untrackedFilesHash: null,
					selector: 'refs/stash@{0}',
					author: 'Jane Doe',
					email: 'jane@example.com',
					date: 1700000150,
					message: 'WIP on feature A'
				}
			];

			const result = GitLogParser.assembleCommits(commits, refData, stashes, defaultOptions);

			const stashIndex = result.commits.findIndex((c) => c.hash === 's111111111111111111111111111111111111111');
			const baseIndex = result.commits.findIndex((c) => c.hash === '2222222222222222222222222222222222222222');

			expect(stashIndex).toBeGreaterThan(-1);
			expect(baseIndex).toBeGreaterThan(-1);
			expect(stashIndex).toBe(baseIndex - 1); // Stash inserted right before base commit
			expect(result.commits[stashIndex].stash).toEqual({
				selector: 'refs/stash@{0}',
				baseHash: '2222222222222222222222222222222222222222',
				untrackedFilesHash: null
			});
			expect(result.commits[stashIndex].parents).toEqual(['2222222222222222222222222222222222222222']);
		});

		it('should sort multiple stashes on the same base commit by date descending', () => {
			const commits = GitLogParser.parseLogLines(logStdout);
			const refData = GitLogParser.parseRefs(refsStdout, ['upstream'], false);
			const stashes: GitStash[] = [
				{
					hash: 's_earlier',
					baseHash: '2222222222222222222222222222222222222222',
					untrackedFilesHash: null,
					selector: 'refs/stash@{1}',
					author: 'Jane Doe',
					email: 'jane@example.com',
					date: 1700000110,
					message: 'Earlier stash'
				},
				{
					hash: 's_later',
					baseHash: '2222222222222222222222222222222222222222',
					untrackedFilesHash: 'u_hash',
					selector: 'refs/stash@{0}',
					author: 'Jane Doe',
					email: 'jane@example.com',
					date: 1700000190,
					message: 'Later stash'
				}
			];

			const result = GitLogParser.assembleCommits(commits, refData, stashes, defaultOptions);

			const idxLater = result.commits.findIndex((c) => c.hash === 's_later');
			const idxEarlier = result.commits.findIndex((c) => c.hash === 's_earlier');
			const idxBase = result.commits.findIndex((c) => c.hash === '2222222222222222222222222222222222222222');

			expect(idxLater).toBe(idxEarlier - 1);
			expect(idxEarlier).toBe(idxBase - 1);
		});

		it('should inject synthetic uncommitted changes commit at the front referencing HEAD', () => {
			const commits = GitLogParser.parseLogLines(logStdout);
			const refData = GitLogParser.parseRefs(refsStdout, [], false);
			const options: ParseLogOptions = {
				...defaultOptions,
				showUncommittedChanges: true,
				uncommittedChanges: 4
			};

			const result = GitLogParser.assembleCommits(commits, refData, [], options);

			expect(result.commits[0].hash).toBe(UNCOMMITTED);
			expect(result.commits[0].parents).toEqual([refData.head!]);
			expect(result.commits[0].author).toBe('*');
			expect(result.commits[0].message).toBe('Uncommitted Changes (4)');
		});

		it('should not inject synthetic commit if showUncommittedChanges is false or changes count is 0', () => {
			const commits = GitLogParser.parseLogLines(logStdout);
			const refData = GitLogParser.parseRefs(refsStdout, [], false);

			const noChangesOptions: ParseLogOptions = {
				...defaultOptions,
				showUncommittedChanges: true,
				uncommittedChanges: 0
			};
			const resNoChanges = GitLogParser.assembleCommits(commits.slice(), refData, [], noChangesOptions);
			expect(resNoChanges.commits[0].hash).not.toBe(UNCOMMITTED);

			const disabledOptions: ParseLogOptions = {
				...defaultOptions,
				showUncommittedChanges: false,
				uncommittedChanges: 5
			};
			const resDisabled = GitLogParser.assembleCommits(commits.slice(), refData, [], disabledOptions);
			expect(resDisabled.commits[0].hash).not.toBe(UNCOMMITTED);
		});

		it('should annotate commits with heads, peeled tags, and remotes', () => {
			const commits = GitLogParser.parseLogLines(logStdout);
			const refData = GitLogParser.parseRefs(refsStdout, ['upstream'], false);
			const result = GitLogParser.assembleCommits(commits, refData, [], defaultOptions);

			// Commit 6666 (HEAD) has head 'main' and remote 'origin/main'
			const c6666 = result.commits.find((c) => c.hash === '6666666666666666666666666666666666666666')!;
			expect(c6666.heads).toEqual(['main']);
			expect(c6666.remotes).toEqual([{ name: 'origin/main', remote: 'origin' }]);

			// Commit 2222 has head 'feature/sub/a', peeled tag 'v1.0.0', remote 'origin/feature/sub/a'
			const c2222 = result.commits.find((c) => c.hash === '2222222222222222222222222222222222222222')!;
			expect(c2222.heads).toEqual(['feature/sub/a']);
			expect(c2222.tags).toEqual([{ name: 'v1.0.0', annotated: true }]);
			expect(c2222.remotes).toEqual([{ name: 'origin/feature/sub/a', remote: 'origin' }]);

			// Commit 1111 has lightweight tag 'v0.1.0'
			const c1111 = result.commits.find((c) => c.hash === '1111111111111111111111111111111111111111')!;
			expect(c1111.tags).toEqual([{ name: 'v0.1.0', annotated: false }]);

			// Deduplicated tags list in result
			expect(result.tags).toEqual(['v0.1.0', 'v1.0.0']);
		});

		it('should handle pagination flag moreCommitsAvailable correctly', () => {
			const commits = GitLogParser.parseLogLines(logStdout); // 6 commits
			const refData = GitLogParser.parseRefs(refsStdout, [], false);

			const cappedOptions: ParseLogOptions = {
				...defaultOptions,
				maxCommits: 5 // commits.length === maxCommits + 1 -> pops extra commit
			};

			const cappedResult = GitLogParser.assembleCommits(commits.slice(), refData, [], cappedOptions);
			expect(cappedResult.commits.length).toBe(5);
			expect(cappedResult.moreCommitsAvailable).toBe(true);

			const uncappedOptions: ParseLogOptions = {
				...defaultOptions,
				maxCommits: 6
			};
			const uncappedResult = GitLogParser.assembleCommits(commits.slice(), refData, [], uncappedOptions);
			expect(uncappedResult.commits.length).toBe(6);
			expect(uncappedResult.moreCommitsAvailable).toBe(false);
		});

		it('should match DataSource.getCommits end-to-end integration assembly', async () => {
			mockGitSuccessOnce(logStdout);
			mockGitSuccessOnce(refsStdout);
			mockGitSuccessOnce('M modified.txt\n?? untracked.txt\n');

			vscode.mockExtensionSettingReturnValue('repository.showCommitsOnlyReferencedByTags', true);
			vscode.mockExtensionSettingReturnValue('repository.showRemoteHeads', false);
			vscode.mockExtensionSettingReturnValue('repository.showUncommittedChanges', true);
			vscode.mockExtensionSettingReturnValue('repository.showUntrackedFiles', true);
			date.setCurrentTime(1700000800);

			const result = await dataSource.getCommits(
				'/path/to/repo',
				null,
				10,
				true,
				true,
				false,
				false,
				CommitOrdering.Date,
				['origin', 'upstream-fork'],
				['upstream'],
				[]
			);

			expect(result.error).toBeNull();
			expect(result.head).toBe('6666666666666666666666666666666666666666');
			expect(result.commits[0].hash).toBe(UNCOMMITTED);
			expect(result.commits[0].message).toBe('Uncommitted Changes (2)');
			expect(result.tags).toEqual(['v0.1.0', 'v1.0.0']);
		});
	});
});
