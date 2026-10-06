import * as vscode from '../mocks/vscode';
jest.mock('vscode', () => vscode, { virtual: true });
jest.mock('../../src/askpass/askpassManager');
jest.mock('../../src/logger');

import { DataSource } from '../../src/dataSource';
import { GitCommit, GitReflogEntry } from '../../src/types';
import { createControlBarHarness, createSampleCommit } from './fixtures/webHarness';

const UNCOMMITTED = '*';

describe('ControlBar & Enhanced Action Toolbar Characterization Suite', () => {
	const fixedNowMs = 1769990000000; // ~2026-02-02
	const fixedNowSec = Math.floor(fixedNowMs / 1000);

	const commitAliceLinear = createSampleCommit({
		hash: '1111111111111111111111111111111111111111',
		author: 'Alice Smith',
		email: 'alice@company.org',
		date: fixedNowSec - 86400, // 1 day ago
		message: 'feat(auth): implement oauth2 token flow\n\nCloses #101.',
		parents: ['0000000000000000000000000000000000000000']
	});

	const commitBobLinear = createSampleCommit({
		hash: '2222222222222222222222222222222222222222',
		author: 'Bob Jones',
		email: 'bob@contractor.net',
		date: fixedNowSec - 2 * 86400, // 2 days ago
		message: 'fix(core): resolve null pointer in session\n\nFixes ticket #404.',
		parents: [commitAliceLinear.hash]
	});

	const commitMerge = createSampleCommit({
		hash: '3333333333333333333333333333333333333333',
		author: 'Charlie Brown',
		email: 'charlie@open-source.org',
		date: fixedNowSec - 3 * 86400, // 3 days ago
		message: 'Merge branch feature/session into main',
		parents: [commitAliceLinear.hash, commitBobLinear.hash]
	});

	const commitOld = createSampleCommit({
		hash: '4444444444444444444444444444444444444444',
		author: 'Alice Smith',
		email: 'alice@company.org',
		date: fixedNowSec - 14 * 86400, // 14 days ago
		message: 'chore(ci): initial setup pipeline',
		parents: [commitMerge.hash]
	});

	const commitUncommitted = createSampleCommit({
		hash: UNCOMMITTED,
		author: '*',
		email: '*',
		date: fixedNowSec,
		message: '*',
		parents: [commitAliceLinear.hash]
	});

	const allCommits: GitCommit[] = [
		commitUncommitted,
		commitAliceLinear,
		commitBobLinear,
		commitMerge,
		commitOld
	];

	describe('1. Toolbar Rendering & Button Layout', () => {
		it('renders default 10 toolbar action buttons and separators', () => {
			const harness = createControlBarHarness();
			const buttons = harness.elements.actionsBar.querySelectorAll('button');
			const actionIds = [
				'fetch-btn',
				'pull-btn',
				'push-btn',
				'force-push-btn',
				'create-branch-btn',
				'create-tag-btn',
				'squash-btn',
				'stash-btn',
				'reflog-btn',
				'terminal-btn'
			];

			expect(buttons.length).toBe(10);
			actionIds.forEach((id) => {
				const btn = buttons.find((b) => b.id === id);
				expect(btn).toBeDefined();
			});
		});

		it('groups push and forcePush inside an action-button-group container', () => {
			const harness = createControlBarHarness();
			const groups = harness.elements.actionsBar.querySelectorAll('.action-button-group');
			expect(groups.length).toBe(1);

			const pushGroup = groups[0];
			expect(pushGroup.getAttribute('role')).toBe('group');
			expect(pushGroup.getAttribute('aria-label')).toBe('Push options');

			const pushBtn = pushGroup.querySelector('#push-btn');
			const forceBtn = pushGroup.querySelector('#force-push-btn');
			expect(pushBtn).toBeDefined();
			expect(forceBtn).toBeDefined();
		});

		it('applies button style classes correctly', () => {
			const iconHarness = createControlBarHarness({ buttonStyle: 'iconOnly' });
			expect(iconHarness.elements.actionsBar.classList.contains('style-icon-only')).toBe(true);

			const textHarness = createControlBarHarness({ buttonStyle: 'textOnly' });
			expect(textHarness.elements.actionsBar.classList.contains('style-text-only')).toBe(true);

			const bothHarness = createControlBarHarness({ buttonStyle: 'iconAndText' });
			expect(bothHarness.elements.actionsBar.classList.contains('style-icon-and-text')).toBe(true);
		});

		it('renders custom action subset and separators', () => {
			const harness = createControlBarHarness({
				actionIds: ['fetch', '|', 'branch', '---', 'terminal']
			});
			const buttons = harness.elements.actionsBar.querySelectorAll('button');
			expect(buttons.length).toBe(3);
			expect(buttons[0].id).toBe('fetch-btn');
			expect(buttons[1].id).toBe('create-branch-btn');
			expect(buttons[2].id).toBe('terminal-btn');
		});
	});

	describe('2. Toolbar Action Invocations', () => {
		it('dispatches fetch action on fetch-btn click', () => {
			const harness = createControlBarHarness();
			const btn = harness.elements.actionsBar.querySelector('#fetch-btn')!;
			btn.click();
			expect(harness.mockCalls['fetchFromRemotesAction']?.length).toBe(1);
		});

		it('dispatches pull action on pull-btn click', () => {
			const harness = createControlBarHarness();
			const btn = harness.elements.actionsBar.querySelector('#pull-btn')!;
			btn.click();
			expect(harness.mockCalls['pullAction']?.length).toBe(1);
		});

		it('dispatches push action without force on push-btn click', () => {
			const harness = createControlBarHarness();
			const btn = harness.elements.actionsBar.querySelector('#push-btn')!;
			btn.click();
			expect(harness.mockCalls['pushAction']?.length).toBe(1);
			expect(harness.mockCalls['pushAction'][0][0]).toBe(false);
		});

		it('dispatches push action with force=true on force-push-btn click', () => {
			const harness = createControlBarHarness();
			const btn = harness.elements.actionsBar.querySelector('#force-push-btn')!;
			btn.click();
			expect(harness.mockCalls['pushAction']?.length).toBe(1);
			expect(harness.mockCalls['pushAction'][0][0]).toBe(true);
		});

		it('dispatches branch and tag actions on click', () => {
			const harness = createControlBarHarness();
			harness.elements.actionsBar.querySelector('#create-branch-btn')!.click();
			harness.elements.actionsBar.querySelector('#create-tag-btn')!.click();
			expect(harness.mockCalls['createBranchActionFromToolbar']?.length).toBe(1);
			expect(harness.mockCalls['createTagActionFromToolbar']?.length).toBe(1);
		});

		it('dispatches squash, stash, reflog, and terminal actions on click', () => {
			const harness = createControlBarHarness();
			harness.elements.actionsBar.querySelector('#squash-btn')!.click();
			harness.elements.actionsBar.querySelector('#stash-btn')!.click();
			harness.elements.actionsBar.querySelector('#reflog-btn')!.click();
			harness.elements.actionsBar.querySelector('#terminal-btn')!.click();

			expect(harness.mockCalls['squashActionFromToolbar']?.length).toBe(1);
			expect(harness.mockCalls['stashActionFromToolbar']?.length).toBe(1);
			expect(harness.mockCalls['requestReflogAction']?.length).toBe(1);
			expect(harness.mockCalls['openTerminalAction']?.length).toBe(1);
		});
	});

	describe('3. Squash Selection Count Formatting', () => {
		it('formats label without count when selection <= 1', () => {
			const harness = createControlBarHarness({ buttonStyle: 'iconAndText' });
			const squashBtn = harness.elements.actionsBar.querySelector('#squash-btn')!;

			harness.controlBar.setSelectionCount(0);
			expect(squashBtn.querySelector('.action-label')?.textContent).toBe('Squash');
			expect(squashBtn.classList.contains('has-selection')).toBe(false);

			harness.controlBar.setSelectionCount(1);
			expect(squashBtn.querySelector('.action-label')?.textContent).toBe('Squash');
			expect(squashBtn.classList.contains('has-selection')).toBe(false);
		});

		it('formats label with count and has-selection class when selection > 1', () => {
			const harness = createControlBarHarness({ buttonStyle: 'iconAndText' });
			const squashBtn = harness.elements.actionsBar.querySelector('#squash-btn')!;

			harness.controlBar.setSelectionCount(3);
			expect(squashBtn.querySelector('.action-label')?.textContent).toBe('Squash (3)');
			expect(squashBtn.classList.contains('has-selection')).toBe(true);

			harness.controlBar.setSelectionCount(12);
			expect(squashBtn.querySelector('.action-label')?.textContent).toBe('Squash (12)');
			expect(squashBtn.classList.contains('has-selection')).toBe(true);
		});
	});

	describe('4. Quick Filters', () => {
		it('returns all commits when filter is all', () => {
			const harness = createControlBarHarness();
			harness.elements.quickFilterSelect.value = 'all';

			const res = harness.controlBar.filterCommits(allCommits);
			expect(res.length).toBe(allCommits.length);
		});

		it('filters by my-commits using user email or author name and preserves UNCOMMITTED', () => {
			const harness = createControlBarHarness();
			harness.elements.quickFilterSelect.value = 'my-commits';

			const resEmail = harness.controlBar.filterCommits(allCommits, 'bob@contractor.net', '');
			const hashesEmail = resEmail.map((c: GitCommit) => c.hash);
			expect(hashesEmail).toEqual([UNCOMMITTED, commitBobLinear.hash]);

			const resName = harness.controlBar.filterCommits(allCommits, '', 'Alice Smith');
			const hashesName = resName.map((c: GitCommit) => c.hash);
			expect(hashesName).toEqual([UNCOMMITTED, commitAliceLinear.hash, commitOld.hash]);
		});

		it('filters out merge commits with no-merges and preserves UNCOMMITTED', () => {
			const harness = createControlBarHarness();
			harness.elements.quickFilterSelect.value = 'no-merges';

			const res = harness.controlBar.filterCommits(allCommits);
			const hashes = res.map((c: GitCommit) => c.hash);
			expect(hashes.includes(commitMerge.hash)).toBe(false);
			expect(hashes).toContain(UNCOMMITTED);
			expect(hashes).toContain(commitAliceLinear.hash);
			expect(hashes).toContain(commitBobLinear.hash);
			expect(hashes).toContain(commitOld.hash);
		});

		it('filters commits by last-7-days and preserves UNCOMMITTED', () => {
			const harness = createControlBarHarness();
			harness.elements.quickFilterSelect.value = 'last-7-days';

			const res = harness.controlBar.filterCommits(allCommits, undefined, undefined, fixedNowMs);
			const hashes = res.map((c: GitCommit) => c.hash);
			expect(hashes).toContain(UNCOMMITTED);
			expect(hashes).toContain(commitAliceLinear.hash); // 1d ago
			expect(hashes).toContain(commitBobLinear.hash); // 2d ago
			expect(hashes).toContain(commitMerge.hash); // 3d ago
			expect(hashes.includes(commitOld.hash)).toBe(false); // 14d ago
		});
	});

	describe('5. Multi-field Search', () => {
		it('searches by commit message', () => {
			const harness = createControlBarHarness();
			harness.elements.searchTypeSelect.value = 'message';
			harness.elements.searchInput.value = 'oauth2';

			const res = harness.controlBar.filterCommits(allCommits);
			expect(res.length).toBe(1);
			expect(res[0].hash).toBe(commitAliceLinear.hash);
		});

		it('searches by author name or email', () => {
			const harness = createControlBarHarness();
			harness.elements.searchTypeSelect.value = 'author';
			harness.elements.searchInput.value = 'contractor.net';

			const res = harness.controlBar.filterCommits(allCommits);
			expect(res.length).toBe(1);
			expect(res[0].hash).toBe(commitBobLinear.hash);
		});

		it('excludes authors using exclude_author', () => {
			const harness = createControlBarHarness();
			harness.elements.searchTypeSelect.value = 'exclude_author';
			harness.elements.searchInput.value = 'alice';

			const res = harness.controlBar.filterCommits(allCommits);
			const hashes = res.map((c: GitCommit) => c.hash);
			expect(hashes).toContain(commitBobLinear.hash);
			expect(hashes).toContain(commitMerge.hash);
			expect(hashes.includes(commitAliceLinear.hash)).toBe(false);
			expect(hashes.includes(commitOld.hash)).toBe(false);
		});

		it('searches by commit hash', () => {
			const harness = createControlBarHarness();
			harness.elements.searchTypeSelect.value = 'hash';
			harness.elements.searchInput.value = '33333333';

			const res = harness.controlBar.filterCommits(allCommits);
			expect(res.length).toBe(1);
			expect(res[0].hash).toBe(commitMerge.hash);
		});

		it('searches across all fields when searchType is all', () => {
			const harness = createControlBarHarness();
			harness.elements.searchTypeSelect.value = 'all';
			harness.elements.searchInput.value = '404';

			const res = harness.controlBar.filterCommits(allCommits);
			expect(res.length).toBe(1);
			expect(res[0].hash).toBe(commitBobLinear.hash);
		});

		it('combines quick filter and multi-search', () => {
			const harness = createControlBarHarness();
			harness.elements.quickFilterSelect.value = 'last-7-days';
			harness.elements.searchTypeSelect.value = 'author';
			harness.elements.searchInput.value = 'Alice';

			const res = harness.controlBar.filterCommits(allCommits, undefined, undefined, fixedNowMs);
			// commitAliceLinear is within 7 days, commitOld is 14 days ago
			expect(res.length).toBe(1);
			expect(res[0].hash).toBe(commitAliceLinear.hash);
		});
	});

	describe('6. Search Match Count Indicator', () => {
		it('clears match count text when no search query and quick filter is all', () => {
			const harness = createControlBarHarness();
			harness.elements.searchInput.value = '';
			harness.elements.quickFilterSelect.value = 'all';

			harness.controlBar.setSearchMatchCount(5, 5);
			expect(harness.elements.searchCount.textContent).toBe('');
		});

		it('formats match count text when query or filter is active', () => {
			const harness = createControlBarHarness();
			harness.elements.searchInput.value = 'test';
			harness.controlBar.setSearchMatchCount(2, 10);
			expect(harness.elements.searchCount.textContent).toBe('2 of 10 commits');

			harness.elements.searchInput.value = '';
			harness.elements.quickFilterSelect.value = 'my-commits';
			harness.controlBar.setSearchMatchCount(3, 10);
			expect(harness.elements.searchCount.textContent).toBe('3 of 10 commits');
		});
	});

	describe('7. Comparison Banner Lifecycle & Actions', () => {
		it('starts hidden and shows formatted hashes on showComparison', () => {
			const harness = createControlBarHarness();
			expect(harness.controlBar.isComparisonVisible()).toBe(false);

			harness.controlBar.showComparison(
				'1111111122222222333333334444444455555555',
				'2222222233333333444444445555555566666666'
			);

			expect(harness.controlBar.isComparisonVisible()).toBe(true);
			expect(harness.elements.comparisonHashes.textContent).toContain('11111111 ↔ 22222222');

			harness.controlBar.hideComparison();
			expect(harness.controlBar.isComparisonVisible()).toBe(false);
		});

		it('triggers view combined diff and clear comparison actions on button clicks', () => {
			const harness = createControlBarHarness();
			harness.elements.compareDiffBtn.click();
			harness.elements.compareClearBtn.click();

			expect(harness.mockCalls['viewCombinedDiffAction']?.length).toBe(1);
			expect(harness.mockCalls['clearComparisonAction']?.length).toBe(1);
		});
	});

	describe('8. Reflog Modal Lifecycle & Interactions', () => {
		const sampleReflogEntries: GitReflogEntry[] = [
			{
				hash: '1111111122222222333333334444444455555555',
				abbreviatedHash: '11111111',
				selector: 'HEAD@{0}',
				action: 'checkout',
				description: 'moving from main to feature',
				timestamp: fixedNowSec - 120
			},
			{
				hash: '2222222233333333444444445555555566666666',
				abbreviatedHash: '22222222',
				selector: 'HEAD@{1}',
				action: 'commit',
				description: 'fix session bug',
				timestamp: fixedNowSec - 3600
			}
		];

		it('renders reflog entries in table with badges and buttons', () => {
			const harness = createControlBarHarness();
			expect(harness.controlBar.isReflogVisible()).toBe(false);

			harness.controlBar.showReflog(sampleReflogEntries);
			expect(harness.controlBar.isReflogVisible()).toBe(true);

			const rows = harness.elements.reflogTableBody.querySelectorAll('.reflog-row');
			expect(rows.length).toBe(2);

			const firstRow = rows[0];
			expect(firstRow.querySelector('.reflog-selector-badge')?.textContent).toBe('HEAD@{0}');
			expect(firstRow.querySelector('.reflog-hash-btn')?.textContent).toBe('11111111');
			expect(firstRow.querySelector('.reflog-action-badge')?.textContent).toBe('checkout');
			expect(firstRow.querySelector('.reflog-desc-cell')?.textContent).toBe('moving from main to feature');
			expect(firstRow.querySelector('.reflog-action-btn')?.textContent).toBe('Checkout');
		});

		it('clicking hash button closes modal and scrolls to commit', () => {
			const harness = createControlBarHarness();
			harness.controlBar.showReflog(sampleReflogEntries);

			const firstRow = harness.elements.reflogTableBody.querySelectorAll('.reflog-row')[0];
			const hashBtn = firstRow.querySelector('.reflog-hash-btn')!;
			hashBtn.click();

			expect(harness.controlBar.isReflogVisible()).toBe(false);
			expect(harness.mockCalls['scrollToCommit']?.length).toBe(1);
			expect(harness.mockCalls['scrollToCommit'][0][0]).toBe('1111111122222222333333334444444455555555');
		});

		it('clicking checkout button closes modal and triggers checkout action', () => {
			const harness = createControlBarHarness();
			harness.controlBar.showReflog(sampleReflogEntries);

			const secondRow = harness.elements.reflogTableBody.querySelectorAll('.reflog-row')[1];
			const checkoutBtn = secondRow.querySelector('.reflog-action-btn')!;
			checkoutBtn.click();

			expect(harness.controlBar.isReflogVisible()).toBe(false);
			expect(harness.mockCalls['checkoutCommitAction']?.length).toBe(1);
			expect(harness.mockCalls['checkoutCommitAction'][0][0]).toBe('2222222233333333444444445555555566666666');
		});

		it('handles empty reflog entries list gracefully', () => {
			const harness = createControlBarHarness();
			harness.controlBar.showReflog([]);
			expect(harness.controlBar.isReflogVisible()).toBe(true);

			const emptyCell = harness.elements.reflogTableBody.querySelector('td');
			expect(emptyCell?.textContent).toContain('No reflog entries found.');
		});

		it('modal close and dismiss buttons hide modal', () => {
			const harness = createControlBarHarness();
			harness.controlBar.showReflog(sampleReflogEntries);
			expect(harness.controlBar.isReflogVisible()).toBe(true);

			harness.elements.reflogModalClose.click();
			expect(harness.controlBar.isReflogVisible()).toBe(false);

			harness.controlBar.showReflog(sampleReflogEntries);
			harness.elements.reflogModalDismiss.click();
			expect(harness.controlBar.isReflogVisible()).toBe(false);
		});
	});

	describe('9. DataSource.getReflog Delimiter Parsing', () => {
		it('parses delimiter output from git reflog into GitReflogEntry objects', async () => {
			const sampleRawOutput = [
				'1111111122222222333333334444444455555555‖1111111‖HEAD@{0}‖checkout: moving from main to feat/login‖1769990000',
				'2222222233333333444444445555555566666666‖2222222‖HEAD@{1}‖commit: feat: add login screen‖1769980000',
				'3333333344444444555555556666666677777777‖3333333‖HEAD@{2}‖pull: Fast-forward‖1769970000',
				''
			].join('\n');

			const mockSpawnGit = jest.fn((_args: string[], _repo: string, successValue: (stdout: string) => any) => Promise.resolve(successValue(sampleRawOutput)));
			const mockEvent: any = () => ({ dispose: () => {} });
			const ds = new DataSource(null as any, mockEvent, mockEvent, null as any);
			(ds as any).spawnGit = mockSpawnGit;

			const entries = await ds.getReflog('/path/to/repo', 50);

			expect(mockSpawnGit).toHaveBeenCalledWith(
				['reflog', '--format=%H‖%h‖%gd‖%gs‖%at', '--max-count=50'],
				'/path/to/repo',
				expect.any(Function)
			);
			expect(entries.length).toBe(3);

			expect(entries[0]).toEqual({
				hash: '1111111122222222333333334444444455555555',
				abbreviatedHash: '1111111',
				selector: 'HEAD@{0}',
				action: 'checkout',
				description: 'moving from main to feat/login',
				timestamp: 1769990000
			});

			expect(entries[1].action).toBe('commit');
			expect(entries[1].description).toBe('feat: add login screen');
			expect(entries[2].action).toBe('pull');
			expect(entries[2].description).toBe('Fast-forward');
		});

		it('handles invalid or partial reflog lines without throwing', async () => {
			const malformedRawOutput = [
				'invalid-line-without-delimiters',
				'1111111122222222333333334444444455555555‖1111111‖HEAD@{0}‖commit: only 5 parts',
				'2222222233333333444444445555555566666666‖2222222‖HEAD@{1}‖merge: Merge branch dev‖1769985000'
			].join('\n');

			const mockSpawnGit = jest.fn((_args: string[], _repo: string, successValue: (stdout: string) => any) => Promise.resolve(successValue(malformedRawOutput)));
			const mockEvent: any = () => ({ dispose: () => {} });
			const ds = new DataSource(null as any, mockEvent, mockEvent, null as any);
			(ds as any).spawnGit = mockSpawnGit;

			const entries = await ds.getReflog('/path/to/repo', 10);
			expect(entries.length).toBe(1);
			expect(entries[0].action).toBe('merge');
			expect(entries[0].description).toBe('Merge branch dev');
		});
	});
});
