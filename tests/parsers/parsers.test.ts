import {
	GIT_LOG_SEPARATOR,
	UNCOMMITTED,
	assembleCommits,
	parseGitLog,
	parseLogLines
} from '../../src/parsers/logParser';
import {
	INVALID_BRANCH_REGEXP,
	REMOTE_HEAD_BRANCH_REGEXP,
	parseBranches,
	parseRefs
} from '../../src/parsers/refParser';
import { parseStashes } from '../../src/parsers/stashParser';
import {
	generateFileChanges,
	parseDiffNameStatus,
	parseDiffNumStat,
	parseStatusFiles
} from '../../src/parsers/diffParser';
import {
	getConfigValue,
	parseConfigList,
	parseRepoConfigBranches
} from '../../src/parsers/configParser';
import { parseTagSignature } from '../../src/parsers/signatureParser';
import {
	GitFileStatus,
	GitSignatureStatus,
	GitStash
} from '../../src/types';

describe('Pure Parser Unit Tests', () => {

	// =========================================================================
	// 1. refParser
	// =========================================================================
	describe('refParser', () => {
		describe('parseRefs', () => {
			it('should return empty ref data for empty string or whitespace input', () => {
				expect(parseRefs('')).toEqual({ head: null, heads: [], tags: [], remotes: [] });
				expect(parseRefs('  \n\t\n  \r\n')).toEqual({ head: null, heads: [], tags: [], remotes: [] });
			});

			it('should parse standard heads', () => {
				const stdout = 'h1 refs/heads/main\nh2 refs/heads/feature/login\n';
				const result = parseRefs(stdout);
				expect(result.heads).toEqual([
					{ hash: 'h1', name: 'main' },
					{ hash: 'h2', name: 'feature/login' }
				]);
				expect(result.tags).toEqual([]);
				expect(result.remotes).toEqual([]);
				expect(result.head).toBeNull();
			});

			it('should parse unannotated and peeled tags', () => {
				const stdout = 't1 refs/tags/v1.0.0\nt2 refs/tags/v2.0.0^{}\n';
				const result = parseRefs(stdout);
				expect(result.tags).toEqual([
					{ hash: 't1', name: 'v1.0.0', annotated: false },
					{ hash: 't2', name: 'v2.0.0', annotated: true }
				]);
			});

			it('should parse remotes and exclude remote HEAD by default', () => {
				const stdout = 'r1 refs/remotes/origin/main\nr2 refs/remotes/origin/HEAD\n';
				const result = parseRefs(stdout, [], false);
				expect(result.remotes).toEqual([
					{ hash: 'r1', name: 'origin/main' }
				]);
			});

			it('should include remote HEAD when showRemoteHeads is true', () => {
				const stdout = 'r1 refs/remotes/origin/main\nr2 refs/remotes/origin/HEAD\n';
				const result = parseRefs(stdout, [], true);
				expect(result.remotes).toEqual([
					{ hash: 'r1', name: 'origin/main' },
					{ hash: 'r2', name: 'origin/HEAD' }
				]);
			});

			it('should filter out hidden remotes using hideRemotes', () => {
				const stdout = [
					'r1 refs/remotes/origin/main',
					'r2 refs/remotes/upstream/main',
					'r3 refs/remotes/fork/main'
				].join('\n');
				const result = parseRefs(stdout, ['upstream', 'fork']);
				expect(result.remotes).toEqual([
					{ hash: 'r1', name: 'origin/main' }
				]);
			});

			it('should parse HEAD pointer', () => {
				const stdout = 'c1 HEAD\n';
				const result = parseRefs(stdout);
				expect(result.head).toBe('c1');
			});

			it('should skip invalid lines or lines without space separator', () => {
				const stdout = 'invalidline\n\n  \n';
				const result = parseRefs(stdout);
				expect(result).toEqual({ head: null, heads: [], tags: [], remotes: [] });
			});
		});

		describe('parseBranches', () => {
			it('should return empty branch data for empty stdout', () => {
				expect(parseBranches('')).toEqual({ branches: [], head: null, error: null });
			});

			it('should parse local and remote tracking branches', () => {
				const stdout = '  main\n  feature\n  remotes/origin/main\n';
				const result = parseBranches(stdout);
				expect(result.branches).toEqual(['main', 'feature', 'remotes/origin/main']);
				expect(result.head).toBeNull();
				expect(result.error).toBeNull();
			});

			it('should mark current branch with head and unshift to front of branches', () => {
				const stdout = '  develop\n* main\n  feature\n';
				const result = parseBranches(stdout);
				expect(result.head).toBe('main');
				expect(result.branches).toEqual(['main', 'develop', 'feature']);
			});

			it('should handle detached HEAD (* (HEAD detached at ...)) by skipping it', () => {
				const stdout = '* (HEAD detached at abc1234)\n  main\n';
				const result = parseBranches(stdout);
				expect(result.branches).toEqual(['main']);
				expect(result.head).toBeNull();
			});

			it('should filter branches matching INVALID_BRANCH_REGEXP', () => {
				expect(INVALID_BRANCH_REGEXP.test('(HEAD detached at 1234567)')).toBe(true);
				expect(INVALID_BRANCH_REGEXP.test('(no branch)')).toBe(true);
				expect(INVALID_BRANCH_REGEXP.test('main')).toBe(false);

				const stdout = '  (no branch, rebasing main)\n  main\n';
				const result = parseBranches(stdout);
				expect(result.branches).toEqual(['main']);
			});

			it('should strip symbolic remote HEAD pointer (-> origin/main) and filter when showRemoteHeads is false', () => {
				expect(REMOTE_HEAD_BRANCH_REGEXP.test('remotes/origin/HEAD')).toBe(true);
				const stdout = '  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n';
				const result = parseBranches(stdout, [], false);
				expect(result.branches).toEqual(['remotes/origin/main']);
			});

			it('should include remote HEAD branch when showRemoteHeads is true', () => {
				const stdout = '  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n';
				const result = parseBranches(stdout, [], true);
				expect(result.branches).toEqual(['remotes/origin/HEAD', 'remotes/origin/main']);
			});

			it('should filter branches belonging to hidden remotes', () => {
				const stdout = '  remotes/origin/main\n  remotes/upstream/main\n  remotes/fork/main\n';
				const result = parseBranches(stdout, ['upstream', 'fork']);
				expect(result.branches).toEqual(['remotes/origin/main']);
			});
		});
	});

	// =========================================================================
	// 2. logParser
	// =========================================================================
	describe('logParser', () => {
		describe('parseLogLines', () => {
			it('should return empty array for empty or whitespace-only input', () => {
				expect(parseLogLines('')).toEqual([]);
				expect(parseLogLines('\r\n\n  \t\n')).toEqual([]);
			});

			it('should parse standard commit records with all fields', () => {
				const stdout = [
					`c1${GIT_LOG_SEPARATOR}p1 p2${GIT_LOG_SEPARATOR}Author One${GIT_LOG_SEPARATOR}author1@test.com${GIT_LOG_SEPARATOR}1600000000${GIT_LOG_SEPARATOR}Initial commit`,
					`c2${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author Two${GIT_LOG_SEPARATOR}author2@test.com${GIT_LOG_SEPARATOR}1600000100${GIT_LOG_SEPARATOR}Second commit`,
					''
				].join('\n');

				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
				expect(commits[0]).toEqual({
					hash: 'c1',
					parents: ['p1', 'p2'],
					author: 'Author One',
					email: 'author1@test.com',
					date: 1600000000,
					message: 'Initial commit'
				});
				expect(commits[1]).toEqual({
					hash: 'c2',
					parents: [],
					author: 'Author Two',
					email: 'author2@test.com',
					date: 1600000100,
					message: 'Second commit'
				});
			});

			it('should handle root commits with empty parents', () => {
				const stdout = `root${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Creator${GIT_LOG_SEPARATOR}creator@test.com${GIT_LOG_SEPARATOR}1500000000${GIT_LOG_SEPARATOR}Root commit\n`;
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(1);
				expect(commits[0].parents).toEqual([]);
			});

			it('should handle merge commits with multiple parents', () => {
				const stdout = `m1${GIT_LOG_SEPARATOR}p1 p2 p3 p4${GIT_LOG_SEPARATOR}Merger${GIT_LOG_SEPARATOR}merger@test.com${GIT_LOG_SEPARATOR}1500000100${GIT_LOG_SEPARATOR}Octopus merge\n`;
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(1);
				expect(commits[0].parents).toEqual(['p1', 'p2', 'p3', 'p4']);
			});

			it('should handle unicode characters and emojis', () => {
				const stdout = `c3${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}田中 太郎${GIT_LOG_SEPARATOR}tanaka@test.jp${GIT_LOG_SEPARATOR}1600000200${GIT_LOG_SEPARATOR}🚀 feat: support wasm & utf-8 🎉\n`;
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(1);
				expect(commits[0].author).toBe('田中 太郎');
				expect(commits[0].message).toBe('🚀 feat: support wasm & utf-8 🎉');
			});

			it('should skip malformed lines that do not have 6 parts', () => {
				const stdout = [
					`c1${GIT_LOG_SEPARATOR}p1${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email${GIT_LOG_SEPARATOR}123`,
					`c2${GIT_LOG_SEPARATOR}p1${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email${GIT_LOG_SEPARATOR}123${GIT_LOG_SEPARATOR}Valid commit`,
					'not a valid line',
					''
				].join('\n');
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(1);
				expect(commits[0].hash).toBe('c2');
			});

			it('should handle Windows CRLF line endings', () => {
				const stdout = `c1${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Commit 1\r\nc2${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}email${GIT_LOG_SEPARATOR}200${GIT_LOG_SEPARATOR}Commit 2\r\n`;
				const commits = parseLogLines(stdout);
				expect(commits.length).toBe(2);
			});
		});

		describe('assembleCommits', () => {
			const dummyRefData = {
				head: 'c2',
				heads: [{ hash: 'c2', name: 'main' }],
				tags: [{ hash: 'c1', name: 'v1.0', annotated: false }, { hash: 'c1', name: 'v1.0', annotated: true }],
				remotes: [{ hash: 'c2', name: 'origin/main' }]
			};

			it('should handle pagination when commits.length === maxCommits + 1', () => {
				const records = [
					{ hash: 'c3', parents: ['c2'], author: 'A', email: 'a@a.com', date: 300, message: '3' },
					{ hash: 'c2', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: '2' },
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: '1' }
				];
				const result = assembleCommits(records, dummyRefData, [], {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 2
				});
				expect(result.commits.length).toBe(2);
				expect(result.moreCommitsAvailable).toBe(true);
			});

			it('should set moreCommitsAvailable to false when commits.length <= maxCommits', () => {
				const records = [
					{ hash: 'c2', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: '2' }
				];
				const result = assembleCommits(records, dummyRefData, [], {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 5
				});
				expect(result.commits.length).toBe(1);
				expect(result.moreCommitsAvailable).toBe(false);
			});

			it('should inject synthetic UNCOMMITTED node at head if uncommittedChanges > 0', () => {
				const records = [
					{ hash: 'c2', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: '2' },
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: '1' }
				];
				const result = assembleCommits(records, dummyRefData, [], {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10,
					showUncommittedChanges: true,
					uncommittedChanges: 3
				});
				expect(result.commits[0].hash).toBe(UNCOMMITTED);
				expect(result.commits[0].parents).toEqual(['c2']);
				expect(result.commits[0].message).toBe('Uncommitted Changes (3)');
			});

			it('should not inject UNCOMMITTED node when uncommittedChanges is 0 or showUncommittedChanges is false', () => {
				const records = [
					{ hash: 'c2', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: '2' }
				];
				const result = assembleCommits(records, dummyRefData, [], {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10,
					showUncommittedChanges: false,
					uncommittedChanges: 3
				});
				expect(result.commits[0].hash).toBe('c2');
			});

			it('should annotate heads, tags, and remotes correctly', () => {
				const records = [
					{ hash: 'c2', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: '2' },
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: '1' }
				];
				const result = assembleCommits(records, dummyRefData, [], {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10
				});
				const c2 = result.commits.find((c) => c.hash === 'c2')!;
				const c1 = result.commits.find((c) => c.hash === 'c1')!;
				expect(c2.heads).toEqual(['main']);
				expect(c2.remotes).toEqual([{ name: 'origin/main', remote: 'origin' }]);
				expect(c1.tags).toEqual([
					{ name: 'v1.0', annotated: false },
					{ name: 'v1.0', annotated: true }
				]);
				expect(result.tags).toEqual(['v1.0']);
			});

			it('should splice stashes directly before their base commit sorted descending by date', () => {
				const records = [
					{ hash: 'c2', parents: ['c1'], author: 'A', email: 'a@a.com', date: 200, message: '2' },
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: '1' }
				];
				const stashes: GitStash[] = [
					{ hash: 's1', baseHash: 'c1', untrackedFilesHash: null, selector: 'stash@{1}', author: 'A', email: 'a@a.com', date: 110, message: 'stash 1' },
					{ hash: 's2', baseHash: 'c1', untrackedFilesHash: 'u1', selector: 'stash@{0}', author: 'A', email: 'a@a.com', date: 150, message: 'stash 2' }
				];
				const result = assembleCommits(records, dummyRefData, stashes, {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10
				});
				const idxS2 = result.commits.findIndex((c) => c.hash === 's2');
				const idxS1 = result.commits.findIndex((c) => c.hash === 's1');
				const idxC1 = result.commits.findIndex((c) => c.hash === 'c1');
				expect(idxS2).toBe(idxS1 - 1);
				expect(idxS1).toBe(idxC1 - 1);
			});

			it('should associate stash metadata on existing commit if hash matches stash hash', () => {
				const records = [
					{ hash: 's1', parents: ['c1'], author: 'A', email: 'a@a.com', date: 150, message: 'stash commit' },
					{ hash: 'c1', parents: [], author: 'A', email: 'a@a.com', date: 100, message: '1' }
				];
				const stashes: GitStash[] = [
					{ hash: 's1', baseHash: 'c1', untrackedFilesHash: 'u1', selector: 'stash@{0}', author: 'A', email: 'a@a.com', date: 150, message: 'stash commit' }
				];
				const result = assembleCommits(records, dummyRefData, stashes, {
					remotes: ['origin'],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10
				});
				const s1 = result.commits.find((c) => c.hash === 's1')!;
				expect(s1.stash).toEqual({
					selector: 'stash@{0}',
					baseHash: 'c1',
					untrackedFilesHash: 'u1'
				});
			});
		});

		describe('parseGitLog', () => {
			it('should execute end-to-end parsing combining refs and log lines', () => {
				const logStdout = `c1${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}a@a.com${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Initial\n`;
				const refsStdout = 'c1 refs/heads/main\nc1 HEAD\n';
				const result = parseGitLog(logStdout, refsStdout, [], {
					remotes: [],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10
				});
				expect(result.commits.length).toBe(1);
				expect(result.commits[0].hash).toBe('c1');
				expect(result.commits[0].heads).toEqual(['main']);
				expect(result.head).toBe('c1');
			});

			it('should fallback to native TS parser if wasmModule throws', () => {
				const logStdout = `c1${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}Author${GIT_LOG_SEPARATOR}a@a.com${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}Initial\n`;
				const refsStdout = 'c1 refs/heads/main\n';
				const failingWasm = {
					parse_git_log_js: () => {
						throw new Error('Wasm failed');
					}
				};
				const result = parseGitLog(logStdout, refsStdout, [], {
					remotes: [],
					hideRemotes: [],
					showRemoteHeads: false,
					showTags: true,
					maxCommits: 10
				}, failingWasm);
				expect(result.commits.length).toBe(1);
				expect(result.commits[0].hash).toBe('c1');
			});
		});
	});

	// =========================================================================
	// 3. stashParser
	// =========================================================================
	describe('stashParser', () => {
		describe('parseStashes', () => {
			it('should return empty array for empty or whitespace input', () => {
				expect(parseStashes('')).toEqual([]);
				expect(parseStashes('   \r\n\t  \n')).toEqual([]);
			});

			it('should parse standard 2-parent stash with untrackedFilesHash null', () => {
				const stdout = `s1${GIT_LOG_SEPARATOR}b1 p2${GIT_LOG_SEPARATOR}stash@{0}${GIT_LOG_SEPARATOR}Dev${GIT_LOG_SEPARATOR}dev@test.com${GIT_LOG_SEPARATOR}1600000000${GIT_LOG_SEPARATOR}WIP 1\n`;
				const stashes = parseStashes(stdout);
				expect(stashes.length).toBe(1);
				expect(stashes[0]).toEqual({
					hash: 's1',
					baseHash: 'b1',
					untrackedFilesHash: null,
					selector: 'stash@{0}',
					author: 'Dev',
					email: 'dev@test.com',
					date: 1600000000,
					message: 'WIP 1'
				});
			});

			it('should parse 3-parent untracked stash (git stash -u)', () => {
				const stdout = `s2${GIT_LOG_SEPARATOR}b1 p2 u3${GIT_LOG_SEPARATOR}stash@{1}${GIT_LOG_SEPARATOR}Dev${GIT_LOG_SEPARATOR}dev@test.com${GIT_LOG_SEPARATOR}1600000100${GIT_LOG_SEPARATOR}WIP 2 with untracked\n`;
				const stashes = parseStashes(stdout);
				expect(stashes.length).toBe(1);
				expect(stashes[0]).toEqual({
					hash: 's2',
					baseHash: 'b1',
					untrackedFilesHash: 'u3',
					selector: 'stash@{1}',
					author: 'Dev',
					email: 'dev@test.com',
					date: 1600000100,
					message: 'WIP 2 with untracked'
				});
			});

			it('should skip malformed lines', () => {
				const stdout = [
					`s1${GIT_LOG_SEPARATOR}b1${GIT_LOG_SEPARATOR}stash@{0}`,
					`s2${GIT_LOG_SEPARATOR}${GIT_LOG_SEPARATOR}stash@{1}${GIT_LOG_SEPARATOR}Dev${GIT_LOG_SEPARATOR}dev@test.com${GIT_LOG_SEPARATOR}100${GIT_LOG_SEPARATOR}msg`,
					''
				].join('\n');
				const stashes = parseStashes(stdout);
				expect(stashes).toEqual([]);
			});
		});
	});

	// =========================================================================
	// 4. diffParser
	// =========================================================================
	describe('diffParser', () => {
		describe('parseDiffNameStatus', () => {
			it('should parse Added, Modified, and Deleted file records', () => {
				const output = ['A', 'newFile.ts', 'M', 'modifiedFile.ts', 'D', 'deletedFile.ts', ''];
				const records = parseDiffNameStatus(output);
				expect(records).toEqual([
					{ type: GitFileStatus.Added, oldFilePath: 'newFile.ts', newFilePath: 'newFile.ts' },
					{ type: GitFileStatus.Modified, oldFilePath: 'modifiedFile.ts', newFilePath: 'modifiedFile.ts' },
					{ type: GitFileStatus.Deleted, oldFilePath: 'deletedFile.ts', newFilePath: 'deletedFile.ts' }
				]);
			});

			it('should parse Renamed file records with old and new file paths', () => {
				const output = ['R100', 'oldPath.ts', 'newPath.ts', ''];
				const records = parseDiffNameStatus(output);
				expect(records).toEqual([
					{ type: GitFileStatus.Renamed, oldFilePath: 'oldPath.ts', newFilePath: 'newPath.ts' }
				]);
			});

			it('should normalise Windows backslashes in paths', () => {
				const output = ['M', 'src\\utils\\test.ts', ''];
				const records = parseDiffNameStatus(output);
				expect(records[0].oldFilePath).toBe('src/utils/test.ts');
				expect(records[0].newFilePath).toBe('src/utils/test.ts');
			});

			it('should skip leading commit hash when isDiffTree is true', () => {
				const output = ['1a2b3c4d5e6f', 'M', 'file.ts', ''];
				const records = parseDiffNameStatus(output, true);
				expect(records).toEqual([
					{ type: GitFileStatus.Modified, oldFilePath: 'file.ts', newFilePath: 'file.ts' }
				]);
			});

			it('should parse NUL-delimited string input', () => {
				const stdout = 'A\0added.ts\0M\0changed.ts\0';
				const records = parseDiffNameStatus(stdout);
				expect(records.length).toBe(2);
				expect(records[0].newFilePath).toBe('added.ts');
				expect(records[1].newFilePath).toBe('changed.ts');
			});

			it('should stop parsing at unexpected or empty status code', () => {
				const output = ['A', 'a.ts', 'UNKNOWN', 'b.ts', ''];
				const records = parseDiffNameStatus(output);
				expect(records.length).toBe(1);
			});
		});

		describe('parseDiffNumStat', () => {
			it('should parse standard additions and deletions', () => {
				const output = ['10\t5\tfile.ts', ''];
				const records = parseDiffNumStat(output);
				expect(records).toEqual([
					{ filePath: 'file.ts', additions: 10, deletions: 5 }
				]);
			});

			it('should parse renamed numstat entries where fields[2] is empty', () => {
				const output = ['20\t3\t', 'old.ts', 'new.ts', ''];
				const records = parseDiffNumStat(output);
				expect(records).toEqual([
					{ filePath: 'new.ts', additions: 20, deletions: 3 }
				]);
			});

			it('should handle binary files where additions and deletions are -', () => {
				const output = ['-\t-\timage.png', ''];
				const records = parseDiffNumStat(output);
				expect(records.length).toBe(1);
				expect(records[0].filePath).toBe('image.png');
				expect(Number.isNaN(records[0].additions)).toBe(true);
				expect(Number.isNaN(records[0].deletions)).toBe(true);
			});

			it('should skip leading commit hash when isDiffTree is true', () => {
				const output = ['1a2b3c4d5e6f', '1\t2\tfile.ts', ''];
				const records = parseDiffNumStat(output, true);
				expect(records).toEqual([
					{ filePath: 'file.ts', additions: 1, deletions: 2 }
				]);
			});

			it('should stop parsing when line does not contain 3 tab-separated fields', () => {
				const output = ['1\t2\tfile1.ts', 'malformed', '3\t4\tfile2.ts', ''];
				const records = parseDiffNumStat(output);
				expect(records.length).toBe(1);
				expect(records[0].filePath).toBe('file1.ts');
			});
		});

		describe('parseStatusFiles', () => {
			it('should parse untracked and deleted files from git status porcelain -z', () => {
				const stdout = '?? untracked.ts\0 D deleted.ts\0';
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['untracked.ts']);
				expect(status.deleted).toEqual(['deleted.ts']);
			});

			it('should skip destination path on rename (R) or copy (C) records', () => {
				const stdout = 'R  old.ts\0new.ts\0?? untracked.ts\0';
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['untracked.ts']);
				expect(status.deleted).toEqual([]);
			});

			it('should stop at tokens shorter than 4 characters or empty', () => {
				const stdout = '?? a.ts\0xy\0?? b.ts\0';
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['a.ts']);
			});
		});

		describe('generateFileChanges', () => {
			it('should merge nameStatus, numStat, and status records', () => {
				const nameStatus = [
					{ type: GitFileStatus.Modified, oldFilePath: 'file.ts', newFilePath: 'file.ts' }
				];
				const numStat = [
					{ filePath: 'file.ts', additions: 5, deletions: 2 }
				];
				const status = {
					deleted: ['removed.ts'],
					untracked: ['untracked.ts']
				};
				const changes = generateFileChanges(nameStatus, numStat, status);
				expect(changes).toEqual([
					{ oldFilePath: 'file.ts', newFilePath: 'file.ts', type: GitFileStatus.Modified, additions: 5, deletions: 2 },
					{ oldFilePath: 'removed.ts', newFilePath: 'removed.ts', type: GitFileStatus.Deleted, additions: null, deletions: null },
					{ oldFilePath: 'untracked.ts', newFilePath: 'untracked.ts', type: GitFileStatus.Untracked, additions: null, deletions: null }
				]);
			});

			it('should update existing file to Deleted if it appears in status.deleted', () => {
				const nameStatus = [
					{ type: GitFileStatus.Modified, oldFilePath: 'file.ts', newFilePath: 'file.ts' }
				];
				const status = {
					deleted: ['file.ts'],
					untracked: []
				};
				const changes = generateFileChanges(nameStatus, [], status);
				expect(changes.length).toBe(1);
				expect(changes[0].type).toBe(GitFileStatus.Deleted);
			});

			it('should handle null status', () => {
				const nameStatus = [
					{ type: GitFileStatus.Added, oldFilePath: 'new.ts', newFilePath: 'new.ts' }
				];
				const numStat = [
					{ filePath: 'new.ts', additions: 10, deletions: 0 }
				];
				const changes = generateFileChanges(nameStatus, numStat, null);
				expect(changes).toEqual([
					{ oldFilePath: 'new.ts', newFilePath: 'new.ts', type: GitFileStatus.Added, additions: 10, deletions: 0 }
				]);
			});
		});
	});

	// =========================================================================
	// 5. configParser
	// =========================================================================
	describe('configParser', () => {
		describe('parseConfigList', () => {
			it('should return empty object for empty stdout', () => {
				expect(parseConfigList('')).toEqual({});
			});

			it('should parse NUL-delimited configuration key-values', () => {
				const stdout = 'user.name\nJohn Doe\0user.email\njohn@example.com\0branch.main.remote\norigin\0';
				const configs = parseConfigList(stdout);
				expect(configs['user.name']).toBe('John Doe');
				expect(configs['user.email']).toBe('john@example.com');
				expect(configs['branch.main.remote']).toBe('origin');
			});

			it('should handle multiline configuration values', () => {
				const stdout = 'alias.ci\ncommit\n-v\n--amend\0';
				const configs = parseConfigList(stdout);
				expect(configs['alias.ci']).toBe('commit\n-v\n--amend');
			});
		});

		describe('parseRepoConfigBranches', () => {
			it('should return empty object when no branch configurations exist', () => {
				expect(parseRepoConfigBranches({})).toEqual({});
				expect(parseRepoConfigBranches({ 'user.name': 'John' })).toEqual({});
			});

			it('should parse branch remote and pushRemote configurations', () => {
				const configs = {
					'branch.main.remote': 'origin',
					'branch.main.pushremote': 'upstream',
					'branch.feature.remote': 'origin',
					'branch.hotfix.pushremote': 'origin',
					'user.name': 'Dev'
				};
				const branches = parseRepoConfigBranches(configs);
				expect(branches).toEqual({
					main: { remote: 'origin', pushRemote: 'upstream' },
					feature: { remote: 'origin', pushRemote: null },
					hotfix: { remote: null, pushRemote: 'origin' }
				});
			});
		});

		describe('getConfigValue', () => {
			it('should return configuration value when key exists', () => {
				const configs = { 'user.name': 'Alice' };
				expect(getConfigValue(configs, 'user.name')).toBe('Alice');
			});

			it('should return null when key does not exist', () => {
				const configs = { 'user.name': 'Alice' };
				expect(getConfigValue(configs, 'missing.key')).toBeNull();
			});
		});
	});

	// =========================================================================
	// 6. signatureParser
	// =========================================================================
	describe('signatureParser', () => {
		describe('parseTagSignature', () => {
			it('should parse GOODSIG with ultimate trust as GoodAndValid', () => {
				const output = [
					'[GNUPG:] NEWSIG',
					'[GNUPG:] GOODSIG 1234567890ABCDEF Signer Name <signer@test.com>',
					'[GNUPG:] TRUST_ULTIMATE 0 pgp',
					''
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					key: '1234567890ABCDEF',
					signer: 'Signer Name <signer@test.com>',
					status: GitSignatureStatus.GoodAndValid
				});
			});

			it('should degrade GOODSIG to GoodWithUnknownValidity under TRUST_UNDEFINED', () => {
				const output = [
					'[GNUPG:] GOODSIG 1234567890ABCDEF Signer <signer@test.com>',
					'[GNUPG:] TRUST_UNDEFINED 0 pgp',
					''
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig.status).toBe(GitSignatureStatus.GoodWithUnknownValidity);
			});

			it('should degrade GOODSIG to GoodWithUnknownValidity under TRUST_NEVER', () => {
				const output = [
					'[GNUPG:] GOODSIG 1234567890ABCDEF Signer <signer@test.com>',
					'[GNUPG:] TRUST_NEVER 0 pgp',
					''
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig.status).toBe(GitSignatureStatus.GoodWithUnknownValidity);
			});

			it('should parse BADSIG correctly', () => {
				const sig = parseTagSignature('[GNUPG:] BADSIG K1 Bad Signer <bad@test.com>\n');
				expect(sig).toEqual({
					key: 'K1',
					signer: 'Bad Signer <bad@test.com>',
					status: GitSignatureStatus.Bad
				});
			});

			it('should parse ERRSIG correctly (uid false, signer empty)', () => {
				const sig = parseTagSignature('[GNUPG:] ERRSIG K1 0 1 2 3 4\n');
				expect(sig).toEqual({
					key: 'K1',
					signer: '',
					status: GitSignatureStatus.CannotBeChecked
				});
			});

			it('should parse EXPSIG correctly', () => {
				const sig = parseTagSignature('[GNUPG:] EXPSIG K1 Expired Signer\n');
				expect(sig).toEqual({
					key: 'K1',
					signer: 'Expired Signer',
					status: GitSignatureStatus.GoodButExpired
				});
			});

			it('should parse EXPKEYSIG correctly', () => {
				const sig = parseTagSignature('[GNUPG:] EXPKEYSIG K1 ExpiredKey Signer\n');
				expect(sig).toEqual({
					key: 'K1',
					signer: 'ExpiredKey Signer',
					status: GitSignatureStatus.GoodButMadeByExpiredKey
				});
			});

			it('should parse REVKEYSIG correctly', () => {
				const sig = parseTagSignature('[GNUPG:] REVKEYSIG K1 RevokedKey Signer\n');
				expect(sig).toEqual({
					key: 'K1',
					signer: 'RevokedKey Signer',
					status: GitSignatureStatus.GoodButMadeByRevokedKey
				});
			});

			it('should return CannotBeChecked when multiple signatures exist', () => {
				const output = [
					'[GNUPG:] GOODSIG K1 Signer One',
					'[GNUPG:] BADSIG K2 Signer Two',
					''
				].join('\n');
				expect(parseTagSignature(output)).toEqual({
					key: '',
					signer: '',
					status: GitSignatureStatus.CannotBeChecked
				});
			});

			it('should return CannotBeChecked when no signature line exists or output is empty', () => {
				expect(parseTagSignature('')).toEqual({
					key: '',
					signer: '',
					status: GitSignatureStatus.CannotBeChecked
				});
				expect(parseTagSignature('random text without gnupg status\n')).toEqual({
					key: '',
					signer: '',
					status: GitSignatureStatus.CannotBeChecked
				});
			});
		});
	});
});
