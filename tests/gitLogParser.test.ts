import * as fs from 'fs';
import * as path from 'path';
import { GitLogParser, GitRefTag, ParseLogOptions, UNCOMMITTED } from '../src/gitLogParser';
import { GitStash } from '../src/types';

describe('GitLogParser', () => {
	const linearLogPath = path.join(__dirname, 'fixtures/git_log_linear.txt');
	const refsPath = path.join(__dirname, 'fixtures/git_refs.txt');

	const linearLogStdout = fs.readFileSync(linearLogPath, 'utf8');
	const refsStdout = fs.readFileSync(refsPath, 'utf8');

	const defaultOptions: ParseLogOptions = {
		remotes: ['origin'],
		hideRemotes: [],
		showRemoteHeads: false,
		showTags: true,
		maxCommits: 10
	};

	it('should parse raw git show-ref output correctly', () => {
		const refData = GitLogParser.parseRefs(refsStdout, ['hidden-remote'], false);

		expect(refData.head).toBe('c333333333333333333333333333333333333333');
		expect(refData.heads).toEqual([
			{ hash: 'c333333333333333333333333333333333333333', name: 'main' },
			{ hash: 'b222222222222222222222222222222222222222', name: 'feature-1' }
		]);

		const v01 = refData.tags.find((t: GitRefTag) => t.name === 'v0.1.0');
		expect(v01).toBeDefined();
		expect(v01!.annotated).toBe(false);

		const v02 = refData.tags.find((t: GitRefTag) => t.name === 'v0.2.0' && t.annotated);
		expect(v02).toBeDefined();
		expect(v02!.annotated).toBe(true);
		expect(v02!.hash).toBe('c333333333333333333333333333333333333333');

		expect(refData.remotes).toEqual([
			{ hash: 'c333333333333333333333333333333333333333', name: 'origin/main' }
		]);
	});

	it('should parse raw git log lines correctly', () => {
		const commits = GitLogParser.parseLogLines(linearLogStdout);

		expect(commits.length).toBe(3);
		expect(commits[0].hash).toBe('a111111111111111111111111111111111111111');
		expect(commits[0].parents).toEqual([]);
		expect(commits[0].author).toBe('Dev One');
		expect(commits[0].email).toBe('dev1@example.com');
		expect(commits[0].date).toBe(1767225600);
		expect(commits[0].message).toBe('Initial commit');

		expect(commits[1].hash).toBe('b222222222222222222222222222222222222222');
		expect(commits[1].parents).toEqual(['a111111111111111111111111111111111111111']);
	});

	it('should assemble commits, refs, and remotes in a single pass', () => {
		const result = GitLogParser.parse(linearLogStdout, refsStdout, [], defaultOptions);

		expect(result.commits.length).toBe(3);
		expect(result.head).toBe('c333333333333333333333333333333333333333');
		expect(result.tags).toEqual(['v0.1.0', 'v0.2.0']);
		expect(result.moreCommitsAvailable).toBe(false);

		// Verify commit 0 (a111) has tag v0.1.0
		expect(result.commits[0].tags).toEqual([{ name: 'v0.1.0', annotated: false }]);

		// Verify commit 1 (b222) has head feature-1
		expect(result.commits[1].heads).toEqual(['feature-1']);

		// Verify commit 2 (c333) has head main and remote origin/main
		expect(result.commits[2].heads).toEqual(['main']);
		expect(result.commits[2].remotes).toEqual([{ name: 'origin/main', remote: 'origin' }]);
	});

	it('should splice stashes into commit stream topologically', () => {
		const stash: GitStash = {
			hash: 's999999999999999999999999999999999999999',
			baseHash: 'b222222222222222222222222222222222222222',
			untrackedFilesHash: null,
			selector: 'stash@{0}',
			author: 'Dev One',
			email: 'dev1@example.com',
			date: 1767350000,
			message: 'WIP on feature-1'
		};

		const result = GitLogParser.parse(linearLogStdout, refsStdout, [stash], defaultOptions);

		// Stash should be inserted right before commit b222
		const stashNode = result.commits.find((c) => c.hash === stash.hash);
		expect(stashNode).toBeDefined();
		expect(stashNode!.stash).toEqual({
			selector: 'stash@{0}',
			baseHash: 'b222222222222222222222222222222222222222',
			untrackedFilesHash: null
		});
		expect(stashNode!.parents).toEqual(['b222222222222222222222222222222222222222']);
	});

	it('should inject synthetic uncommitted changes node when uncommitted changes exist', () => {
		const options: ParseLogOptions = {
			...defaultOptions,
			showUncommittedChanges: true,
			uncommittedChanges: 5
		};

		const result = GitLogParser.parse(linearLogStdout, refsStdout, [], options);

		expect(result.commits[0].hash).toBe(UNCOMMITTED);
		expect(result.commits[0].message).toBe('Uncommitted Changes (5)');
		expect(result.commits[0].parents).toEqual(['c333333333333333333333333333333333333333']);
	});

	it('should handle pagination and moreCommitsAvailable correctly', () => {
		const options: ParseLogOptions = {
			...defaultOptions,
			maxCommits: 2
		};

		const result = GitLogParser.parse(linearLogStdout, refsStdout, [], options);

		expect(result.commits.length).toBe(2);
		expect(result.moreCommitsAvailable).toBe(true);
	});
});
