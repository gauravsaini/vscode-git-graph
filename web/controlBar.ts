/* Enhanced Control Bar & Git Actions Toolbar */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */

type ToolbarButtonStyle = 'iconOnly' | 'textOnly' | 'iconAndText';
type SearchType = 'all' | 'message' | 'author' | 'hash' | 'exclude_author';
type QuickFilterType = 'all' | 'my-commits' | 'no-merges' | 'last-7-days';

interface ToolbarActionDefinition {
	readonly id: string;
	readonly domId: string;
	readonly label: string;
	readonly title: string;
	readonly iconSvg: string;
}

const TOOLBAR_ACTIONS: { [id: string]: ToolbarActionDefinition } = {
	fetch: {
		id: 'fetch',
		domId: 'fetch-btn',
		label: 'Fetch',
		title: 'Fetch from all remotes',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M8 1v10M4 7l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
	},
	pull: {
		id: 'pull',
		domId: 'pull-btn',
		label: 'Pull',
		title: 'Pull from remote',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M8 2v9M5 8l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="14" r="1" fill="currentColor"/></svg>'
	},
	push: {
		id: 'push',
		domId: 'push-btn',
		label: 'Push',
		title: 'Push to remote',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M8 14V5M5 8l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="2" r="1" fill="currentColor"/></svg>'
	},
	forcePush: {
		id: 'forcePush',
		domId: 'force-push-btn',
		label: 'Force Push',
		title: 'Force push (with lease) to remote',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M5.5 14V5M3 7.5L5.5 5 8 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5.5" cy="2" r="1" fill="currentColor"/><path d="M12 4v5M12 12h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
	},
	branch: {
		id: 'branch',
		domId: 'create-branch-btn',
		label: 'Branch',
		title: 'Create a new branch',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M5 3v6a4 4 0 0 0 4 4h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="3" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11" cy="13" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
	},
	tag: {
		id: 'tag',
		domId: 'create-tag-btn',
		label: 'Tag',
		title: 'Create a tag at selected commit',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M2 2h5l7 7-5 5-7-7V2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/></svg>'
	},
	squash: {
		id: 'squash',
		domId: 'squash-btn',
		label: 'Squash',
		title: 'Squash commits from HEAD down to selected commit',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M4 2h8M4 14h8M8 4v3M6 6l2 2 2-2M8 12V9M6 10l2-2 2 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
	},
	stash: {
		id: 'stash',
		domId: 'stash-btn',
		label: 'Stash',
		title: 'Stash uncommitted changes',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="6.5" width="10" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="11" width="10" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>'
	},
	reflog: {
		id: 'reflog',
		domId: 'reflog-btn',
		label: 'Reflog',
		title: 'View HEAD reflog history',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M2 8a6 6 0 1 1 6 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M1 5l1 3 3-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 4v4l3 2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
	},
	terminal: {
		id: 'terminal',
		domId: 'terminal-btn',
		label: 'Terminal',
		title: 'Open Terminal in repository',
		iconSvg: '<svg class="action-icon" viewBox="0 0 16 16"><path d="M2 3l5 4-5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 13h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
	}
};

const DEFAULT_TOOLBAR_ACTIONS: ReadonlyArray<string> = [
	'fetch',
	'pull',
	'push',
	'forcePush',
	'|',
	'branch',
	'tag',
	'squash',
	'stash',
	'reflog',
	'|',
	'terminal'
];

function formatSquashButtonLabel(count: number): { label: string; hasSelection: boolean } {
	if (count > 1) {
		return { label: 'Squash (' + count + ')', hasSelection: true };
	}
	return { label: 'Squash', hasSelection: false };
}

function isActionSeparator(actionId: string): boolean {
	return actionId === '|' || actionId === 'separator' || actionId === '---';
}

class ControlBar {
	private readonly view: GitGraphView;
	private actionsBar: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private searchTypeSelect: HTMLSelectElement | null = null;
	private quickFilterSelect: HTMLSelectElement | null = null;
	private searchCount: HTMLElement | null = null;
	private comparisonBanner: HTMLElement | null = null;
	private comparisonHashes: HTMLElement | null = null;
	private compareDiffBtn: HTMLElement | null = null;
	private compareClearBtn: HTMLElement | null = null;
	private reflogModal: HTMLElement | null = null;
	private reflogTableBody: HTMLElement | null = null;
	private squashBtn: HTMLElement | null = null;

	constructor(view: GitGraphView) {
		this.view = view;
		this.actionsBar = document.getElementById('actionsBar');
		this.searchInput = <HTMLInputElement>document.getElementById('searchInput');
		this.searchTypeSelect = <HTMLSelectElement>document.getElementById('searchTypeSelect');
		this.quickFilterSelect = <HTMLSelectElement>document.getElementById('quickFilterSelect');
		this.searchCount = document.getElementById('searchCount');
		this.comparisonBanner = document.getElementById('comparisonBanner');
		this.comparisonHashes = document.getElementById('comparisonHashes');
		this.compareDiffBtn = document.getElementById('compareDiffBtn');
		this.compareClearBtn = document.getElementById('compareClearBtn');
		this.reflogModal = document.getElementById('reflogModal');
		this.reflogTableBody = document.getElementById('reflogTableBody');

		this.renderToolbar();
		this.bindEvents();
	}

	public renderToolbar(actionIds?: ReadonlyArray<string>, buttonStyle: ToolbarButtonStyle = 'iconOnly') {
		if (this.actionsBar === null) return;
		this.actionsBar.innerHTML = '';
		this.actionsBar.classList.remove('style-icon-and-text', 'style-icon-only', 'style-text-only');
		this.actionsBar.classList.add(
			buttonStyle === 'iconOnly'
				? 'style-icon-only'
				: buttonStyle === 'textOnly'
					? 'style-text-only'
					: 'style-icon-and-text'
		);

		const effectiveActions = actionIds && actionIds.length > 0 ? actionIds : DEFAULT_TOOLBAR_ACTIONS;

		for (let i = 0; i < effectiveActions.length; i++) {
			const actionId = effectiveActions[i];

			if (isActionSeparator(actionId)) {
				const sep = document.createElement('span');
				sep.className = 'actions-separator';
				this.actionsBar.appendChild(sep);
				continue;
			}

			const actionDef = TOOLBAR_ACTIONS[actionId];
			if (!actionDef) continue;

			// Handle button grouping for push + forcePush
			if (actionId === 'push' && effectiveActions[i + 1] === 'forcePush') {
				const groupEl = document.createElement('div');
				groupEl.className = 'action-button-group';
				groupEl.setAttribute('role', 'group');
				groupEl.setAttribute('aria-label', 'Push options');

				const pushBtn = this.createButtonElement(actionDef, buttonStyle, () => this.handleAction('push'));
				const forceDef = TOOLBAR_ACTIONS['forcePush'];
				const forceBtn = this.createButtonElement(forceDef, buttonStyle, () => this.handleAction('forcePush'));

				groupEl.appendChild(pushBtn);
				groupEl.appendChild(forceBtn);
				this.actionsBar.appendChild(groupEl);

				i++; // Skip forcePush in next iteration
				continue;
			}

			const btn = this.createButtonElement(actionDef, buttonStyle, () => this.handleAction(actionId));
			this.actionsBar.appendChild(btn);
		}

		this.squashBtn = document.getElementById('squash-btn');
	}

	private createButtonElement(actionDef: ToolbarActionDefinition, buttonStyle: ToolbarButtonStyle, handler: () => void): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.id = actionDef.domId;
		btn.className = 'action-button';
		btn.title = actionDef.title;
		btn.setAttribute('aria-label', actionDef.label);

		if (buttonStyle !== 'textOnly') {
			const iconContainer = document.createElement('span');
			iconContainer.className = 'action-icon-wrap';
			iconContainer.innerHTML = actionDef.iconSvg;
			btn.appendChild(iconContainer);
		}

		if (buttonStyle !== 'iconOnly') {
			const labelSpan = document.createElement('span');
			labelSpan.className = 'action-label';
			labelSpan.textContent = actionDef.label;
			btn.appendChild(labelSpan);
		}

		btn.addEventListener('click', handler);
		return btn;
	}

	private handleAction(actionId: string) {
		switch (actionId) {
			case 'fetch':
				this.view.fetchFromRemotesAction();
				break;
			case 'pull':
				this.view.pullAction();
				break;
			case 'push':
				this.view.pushAction(false);
				break;
			case 'forcePush':
				this.view.pushAction(true);
				break;
			case 'branch':
				this.view.createBranchActionFromToolbar();
				break;
			case 'tag':
				this.view.createTagActionFromToolbar();
				break;
			case 'squash':
				this.view.squashActionFromToolbar();
				break;
			case 'stash':
				this.view.stashActionFromToolbar();
				break;
			case 'reflog':
				this.view.requestReflogAction();
				break;
			case 'terminal':
				this.view.openTerminalAction();
				break;
		}
	}

	private bindEvents() {
		if (this.searchInput !== null) {
			this.searchInput.addEventListener('input', () => {
				this.view.applyFilters();
			});
		}

		if (this.searchTypeSelect !== null) {
			this.searchTypeSelect.addEventListener('change', () => {
				this.view.applyFilters();
			});
		}

		if (this.quickFilterSelect !== null) {
			this.quickFilterSelect.addEventListener('change', () => {
				this.view.applyFilters();
			});
		}

		if (this.compareDiffBtn !== null) {
			this.compareDiffBtn.addEventListener('click', () => {
				this.view.viewCombinedDiffAction();
			});
		}

		if (this.compareClearBtn !== null) {
			this.compareClearBtn.addEventListener('click', () => {
				this.view.clearComparisonAction();
			});
		}

		const reflogClose = document.getElementById('reflogModalClose');
		const reflogDismiss = document.getElementById('reflogModalDismiss');
		if (reflogClose !== null) {
			reflogClose.addEventListener('click', () => this.hideReflog());
		}
		if (reflogDismiss !== null) {
			reflogDismiss.addEventListener('click', () => this.hideReflog());
		}
	}

	public filterCommits(commits: ReadonlyArray<GG.GitCommit>, currentUserEmail?: string, currentAuthorName?: string, nowTimestampMs: number = Date.now()): GG.GitCommit[] {
		let filtered = commits.slice(0);
		const quickFilter = this.getQuickFilter();
		const searchQuery = this.getSearchQuery().trim().toLowerCase();
		const searchType = this.getSearchType();

		// 1. Quick Filters
		if (quickFilter === 'my-commits') {
			const emailLower = (currentUserEmail || '').toLowerCase().trim();
			const authorLower = (currentAuthorName || '').toLowerCase().trim();
			filtered = filtered.filter((c) => {
				if (c.hash === UNCOMMITTED) return true;
				const cEmail = (c.email || '').toLowerCase().trim();
				const cAuthor = (c.author || '').toLowerCase().trim();
				return (emailLower.length > 0 && cEmail === emailLower) || (authorLower.length > 0 && cAuthor === authorLower);
			});
		} else if (quickFilter === 'no-merges') {
			filtered = filtered.filter((c) => c.hash === UNCOMMITTED || c.parents.length <= 1);
		} else if (quickFilter === 'last-7-days') {
			const sevenDaysAgoSec = Math.floor((nowTimestampMs - 7 * 86400 * 1000) / 1000);
			filtered = filtered.filter((c) => c.hash === UNCOMMITTED || c.date >= sevenDaysAgoSec);
		}

		// 2. Multi-field Search
		if (searchQuery.length > 0) {
			filtered = filtered.filter((c) => {
				if (c.hash === UNCOMMITTED) return false;
				const msg = (c.message || '').toLowerCase();
				const author = (c.author || '').toLowerCase();
				const email = (c.email || '').toLowerCase();
				const hash = (c.hash || '').toLowerCase();

				if (searchType === 'message') {
					return msg.indexOf(searchQuery) !== -1;
				}
				if (searchType === 'author') {
					return author.indexOf(searchQuery) !== -1 || email.indexOf(searchQuery) !== -1;
				}
				if (searchType === 'exclude_author') {
					return author.indexOf(searchQuery) === -1 && email.indexOf(searchQuery) === -1;
				}
				if (searchType === 'hash') {
					return hash.indexOf(searchQuery) !== -1;
				}
				// 'all'
				return msg.indexOf(searchQuery) !== -1 ||
					author.indexOf(searchQuery) !== -1 ||
					email.indexOf(searchQuery) !== -1 ||
					hash.indexOf(searchQuery) !== -1;
			});
		}

		this.setSearchMatchCount(filtered.length, commits.length);
		return filtered;
	}

	public setSearchMatchCount(count: number, total: number) {
		if (this.searchCount === null) return;
		const query = this.getSearchQuery().trim();
		const filter = this.getQuickFilter();
		if (query.length === 0 && filter === 'all') {
			this.searchCount.textContent = '';
			return;
		}
		this.searchCount.textContent = count + ' of ' + total + ' commits';
	}

	public showComparison(hashA: string, hashB: string) {
		if (this.comparisonBanner === null || this.comparisonHashes === null) return;
		this.comparisonHashes.textContent = abbrevCommit(hashA) + ' \u2194 ' + abbrevCommit(hashB);
		this.comparisonBanner.classList.remove('hidden');
	}

	public hideComparison() {
		if (this.comparisonBanner !== null) {
			this.comparisonBanner.classList.add('hidden');
		}
	}

	public setSelectionCount(count: number) {
		if (this.squashBtn === null) {
			this.squashBtn = document.getElementById('squash-btn');
		}
		if (this.squashBtn === null) return;
		const label = this.squashBtn.querySelector('.action-label');
		const textTarget = label !== null ? label : this.squashBtn;
		const formatted = formatSquashButtonLabel(count);

		textTarget.textContent = formatted.label;
		if (formatted.hasSelection) {
			this.squashBtn.classList.add('has-selection');
		} else {
			this.squashBtn.classList.remove('has-selection');
		}
	}

	public showReflog(entries: ReadonlyArray<GG.GitReflogEntry>) {
		if (this.reflogModal === null || this.reflogTableBody === null) return;
		this.reflogTableBody.innerHTML = '';

		if (entries.length === 0) {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			td.setAttribute('colspan', '6');
			td.className = 'text-muted';
			td.style.setProperty('text-align', 'center');
			td.style.setProperty('padding', '24px');
			td.textContent = 'No reflog entries found.';
			tr.appendChild(td);
			this.reflogTableBody.appendChild(tr);
		} else {
			for (let i = 0; i < entries.length; i++) {
				const entry = entries[i];
				const tr = document.createElement('tr');
				tr.className = 'reflog-row';

				// 1. Selector
				const tdSelector = document.createElement('td');
				const selectorBadge = document.createElement('span');
				selectorBadge.className = 'reflog-selector-badge';
				selectorBadge.textContent = entry.selector;
				tdSelector.appendChild(selectorBadge);

				// 2. Hash
				const tdHash = document.createElement('td');
				const hashBtn = document.createElement('button');
				hashBtn.className = 'reflog-hash-btn';
				hashBtn.textContent = entry.abbreviatedHash;
				hashBtn.title = 'Select commit ' + entry.hash + ' in graph';
				hashBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.hideReflog();
					this.view.scrollToCommit(entry.hash, true, true);
				});
				tdHash.appendChild(hashBtn);

				// 3. Action
				const tdAction = document.createElement('td');
				const actionBadge = document.createElement('span');
				actionBadge.className = 'reflog-action-badge action-' + this.sanitizeActionName(entry.action);
				actionBadge.textContent = entry.action;
				tdAction.appendChild(actionBadge);

				// 4. Description
				const tdDesc = document.createElement('td');
				tdDesc.className = 'reflog-desc-cell';
				tdDesc.textContent = entry.description || '-';
				tdDesc.title = entry.description || '';

				// 5. Time
				const tdTime = document.createElement('td');
				tdTime.className = 'reflog-time-cell';
				tdTime.textContent = this.formatReflogDate(entry.timestamp);
				tdTime.title = new Date(entry.timestamp * 1000).toLocaleString();

				// 6. Ops
				const tdOps = document.createElement('td');
				tdOps.className = 'reflog-ops-cell';
				const checkoutBtn = document.createElement('button');
				checkoutBtn.className = 'reflog-action-btn';
				checkoutBtn.textContent = 'Checkout';
				checkoutBtn.title = 'Checkout ' + entry.abbreviatedHash;
				checkoutBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.hideReflog();
					this.view.checkoutCommitAction(entry.hash);
				});
				tdOps.appendChild(checkoutBtn);

				tr.appendChild(tdSelector);
				tr.appendChild(tdHash);
				tr.appendChild(tdAction);
				tr.appendChild(tdDesc);
				tr.appendChild(tdTime);
				tr.appendChild(tdOps);

				tr.addEventListener('dblclick', () => {
					this.hideReflog();
					this.view.scrollToCommit(entry.hash, true, true);
				});

				this.reflogTableBody.appendChild(tr);
			}
		}

		this.reflogModal.classList.remove('hidden');
	}

	public hideReflog() {
		if (this.reflogModal !== null) {
			this.reflogModal.classList.add('hidden');
		}
	}

	public getSearchQuery(): string {
		return this.searchInput !== null ? this.searchInput.value : '';
	}

	public getSearchType(): SearchType {
		return this.searchTypeSelect !== null ? <SearchType>this.searchTypeSelect.value : 'all';
	}

	public getQuickFilter(): QuickFilterType {
		return this.quickFilterSelect !== null ? <QuickFilterType>this.quickFilterSelect.value : 'all';
	}

	public isComparisonVisible(): boolean {
		return this.comparisonBanner !== null && !this.comparisonBanner.classList.contains('hidden');
	}

	public isReflogVisible(): boolean {
		return this.reflogModal !== null && !this.reflogModal.classList.contains('hidden');
	}

	private sanitizeActionName(action: string): string {
		return action
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '-')
			.replace(/-+/g, '-');
	}

	private formatReflogDate(timestampSec: number): string {
		if (!timestampSec) return '';
		const now = Date.now();
		const diffSec = Math.floor((now - timestampSec * 1000) / 1000);
		if (diffSec < 60) return 'just now';
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return diffMin + 'm ago';
		const diffHours = Math.floor(diffMin / 60);
		if (diffHours < 24) return diffHours + 'h ago';
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays < 30) return diffDays + 'd ago';
		const diffMonths = Math.floor(diffDays / 30);
		if (diffMonths < 12) return diffMonths + 'mo ago';
		const diffYears = Math.floor(diffDays / 365);
		return diffYears + 'y ago';
	}
}
