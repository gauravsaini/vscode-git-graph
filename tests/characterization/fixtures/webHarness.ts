import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as vm from 'vm';
import { GitCommit, GitCommitRemote, GitCommitTag } from '../../../src/types';

export interface ColumnVisibility {
	author: boolean;
	commit: boolean;
	date: boolean;
}

export interface MockHtmlElement {
	tagName: string;
	id?: string;
	className?: string;
	dataset: { [key: string]: string };
	style: { [key: string]: any; setProperty: (k: string, v: string) => void };
	classList: {
		add: (c: string) => void;
		remove: (c: string) => void;
		contains: (c: string) => boolean;
	};
	children: MockHtmlElement[];
	childNodes: MockNode[];
	parentNode: MockHtmlElement | null;
	previousSibling: MockNode | null;
	nextSibling: MockNode | null;
	previousElementSibling?: MockHtmlElement | null;
	nextElementSibling?: MockHtmlElement | null;
	value: string;
	textContent: string;
	innerHTML: string;
	title?: string;
	disabled?: boolean;
	setAttribute: (k: string, v: string) => void;
	removeAttribute: (k: string) => void;
	getAttribute: (k: string) => string | null;
	appendChild: (c: MockNode) => MockNode;
	insertBefore: (n: MockNode, ref: MockNode | null) => MockNode;
	removeChild: (c: MockNode) => MockNode;
	replaceChild: (n: MockNode, o: MockNode) => MockNode;
	addEventListener: (evt: string, fn: Function) => void;
	focus: () => void;
	querySelector: (selector: string) => MockHtmlElement | null;
	querySelectorAll: (selector: string) => MockHtmlElement[];
	click: () => void;
	trigger: (evt: string, data?: any) => void;
}

export interface MockNode {
	textContent: string | null;
	childNodes: MockNode[];
	children?: MockHtmlElement[];
	parentNode: MockHtmlElement | null;
	previousSibling: MockNode | null;
	nextSibling: MockNode | null;
	previousElementSibling?: MockHtmlElement | null;
	nextElementSibling?: MockHtmlElement | null;
}

export function createMockElement(tag: string = 'div', textContent: string = ''): MockHtmlElement {
	const classNames = new Set<string>();
	const attributes: { [key: string]: string } = {};
	const childElements: MockHtmlElement[] = [];
	const childNodeList: MockNode[] = [];
	const eventListeners: { [evt: string]: Function[] } = {};
	let innerHtmlValue = '';
	let idValue = '';

	const elem: MockHtmlElement = {
		tagName: tag.toUpperCase(),
		dataset: {},
		style: {
			setProperty: () => {}
		},
		classList: {
			add: (c: string) => { classNames.add(c); },
			remove: (c: string) => { classNames.delete(c); },
			contains: (c: string) => classNames.has(c)
		},
		children: childElements,
		childNodes: childNodeList,
		parentNode: null,
		previousSibling: null,
		nextSibling: null,
		value: textContent,
		textContent: textContent,
		get innerHTML(): string {
			return innerHtmlValue;
		},
		set innerHTML(val: string) {
			innerHtmlValue = val;
			if (val === '') {
				childElements.length = 0;
				childNodeList.length = 0;
			}
		},
		get className(): string {
			return Array.from(classNames).join(' ');
		},
		set className(val: string) {
			classNames.clear();
			if (val) {
				val.trim().split(/\s+/).forEach((c) => {
					if (c) classNames.add(c);
				});
			}
		},
		get id(): string {
			return idValue;
		},
		set id(val: string) {
			idValue = val;
			attributes['id'] = val;
		},
		setAttribute: (k: string, v: string) => {
			attributes[k] = v;
			if (k === 'id') idValue = v;
			if (k === 'class') {
				classNames.clear();
				v.trim().split(/\s+/).forEach((c) => {
					if (c) classNames.add(c);
				});
			}
		},
		removeAttribute: (k: string) => {
			delete attributes[k];
			if (k === 'id') idValue = '';
			if (k === 'class') classNames.clear();
		},
		getAttribute: (k: string) => attributes[k] !== undefined ? attributes[k] : null,
		appendChild: (child: MockNode) => {
			child.parentNode = elem;
			childNodeList.push(child);
			if ((child as MockHtmlElement).tagName !== undefined) {
				childElements.push(child as MockHtmlElement);
			}
			return child;
		},
		insertBefore: (newChild: MockNode, _refChild: MockNode | null) => {
			newChild.parentNode = elem;
			childNodeList.push(newChild);
			if ((newChild as MockHtmlElement).tagName !== undefined) {
				childElements.push(newChild as MockHtmlElement);
			}
			return newChild;
		},
		removeChild: (child: MockNode) => {
			const idx = childNodeList.indexOf(child);
			if (idx > -1) childNodeList.splice(idx, 1);
			const elIdx = childElements.indexOf(child as MockHtmlElement);
			if (elIdx > -1) childElements.splice(elIdx, 1);
			return child;
		},
		replaceChild: (newChild: MockNode, oldChild: MockNode) => {
			const idx = childNodeList.indexOf(oldChild);
			if (idx > -1) {
				childNodeList[idx] = newChild;
				newChild.parentNode = elem;
			}
			const elIdx = childElements.indexOf(oldChild as MockHtmlElement);
			if (elIdx > -1) {
				childElements[elIdx] = newChild as MockHtmlElement;
			}
			return oldChild;
		},
		addEventListener: (evt: string, fn: Function) => {
			if (!eventListeners[evt]) eventListeners[evt] = [];
			eventListeners[evt].push(fn);
		},
		focus: () => {},
		querySelector: (selector: string): MockHtmlElement | null => {
			const search = (parent: MockHtmlElement): MockHtmlElement | null => {
				for (const child of parent.children) {
					if (selector.startsWith('.') && child.classList.contains(selector.substring(1))) {
						return child;
					}
					if (selector.startsWith('#') && child.id === selector.substring(1)) {
						return child;
					}
					if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) {
						return child;
					}
					if (child.children && child.children.length > 0) {
						const sub = search(child);
						if (sub) return sub;
					}
				}
				return null;
			};
			return search(elem);
		},
		querySelectorAll: (selector: string): MockHtmlElement[] => {
			const results: MockHtmlElement[] = [];
			const search = (parent: MockHtmlElement) => {
				for (const child of parent.children) {
					if (selector.startsWith('.') && child.classList.contains(selector.substring(1))) {
						results.push(child);
					} else if (selector.startsWith('#') && child.id === selector.substring(1)) {
						results.push(child);
					} else if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) {
						results.push(child);
					}
					if (child.children && child.children.length > 0) {
						search(child);
					}
				}
			};
			search(elem);
			return results;
		},
		click: () => {
			const list = eventListeners['click'] || [];
			list.forEach((cb) => cb({ stopPropagation: () => {} }));
		},
		trigger: (evt: string, data?: any) => {
			const list = eventListeners[evt] || [];
			list.forEach((cb) => cb(data || { stopPropagation: () => {} }));
		}
	};

	if (textContent !== '') {
		const textNode: MockNode = {
			textContent: textContent,
			childNodes: [],
			children: [],
			parentNode: elem,
			previousSibling: null,
			nextSibling: null
		};
		childNodeList.push(textNode);
	}

	return elem;
}

let cachedUtilsJs: string | null = null;
let cachedFindWidgetJs: string | null = null;
let cachedMainJs: string | null = null;
let cachedGraphLayoutJs: string | null = null;
let cachedGraphWasmBridgeJs: string | null = null;
let cachedCommitDataStoreJs: string | null = null;
let cachedCommitFilterFallbackJs: string | null = null;
let cachedControlBarJs: string | null = null;

export function webScriptExists(fileName: string): boolean {
	const filePath = path.join(__dirname, '../../../web/', fileName);
	return fs.existsSync(filePath);
}

export function getTranspiledWebScript(fileName: string): string {
	if (fileName === 'utils.ts') {
		if (!cachedUtilsJs) {
			const filePath = path.join(__dirname, '../../../web/utils.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedUtilsJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedUtilsJs;
	}
	if (fileName === 'findWidget.ts') {
		if (!cachedFindWidgetJs) {
			const filePath = path.join(__dirname, '../../../web/findWidget.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedFindWidgetJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedFindWidgetJs;
	}
	if (fileName === 'main.ts') {
		if (!cachedMainJs) {
			const filePath = path.join(__dirname, '../../../web/main.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedMainJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedMainJs;
	}
	if (fileName === 'graphLayout.ts') {
		if (!cachedGraphLayoutJs) {
			const filePath = path.join(__dirname, '../../../web/graphLayout.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedGraphLayoutJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedGraphLayoutJs;
	}
	if (fileName === 'graphWasmBridge.ts') {
		if (!cachedGraphWasmBridgeJs) {
			const filePath = path.join(__dirname, '../../../web/graphWasmBridge.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedGraphWasmBridgeJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedGraphWasmBridgeJs;
	}
	if (fileName === 'commitDataStore.ts') {
		if (!cachedCommitDataStoreJs) {
			const filePath = path.join(__dirname, '../../../web/commitDataStore.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedCommitDataStoreJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedCommitDataStoreJs;
	}
	if (fileName === 'commitFilterFallback.ts') {
		if (!cachedCommitFilterFallbackJs) {
			const filePath = path.join(__dirname, '../../../web/commitFilterFallback.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedCommitFilterFallbackJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedCommitFilterFallbackJs;
	}
	if (fileName === 'controlBar.ts') {
		if (!cachedControlBarJs) {
			const filePath = path.join(__dirname, '../../../web/controlBar.ts');
			const content = fs.readFileSync(filePath, 'utf8');
			cachedControlBarJs = ts.transpileModule(content, {
				compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.None }
			}).outputText;
		}
		return cachedControlBarJs;
	}
	throw new Error('Unknown script: ' + fileName);
}

export interface FindWidgetHarnessOptions {
	commits: GitCommit[];
	wasmCommits?: any[];
	columnVisibility?: ColumnVisibility;
	isRegex?: boolean;
	isCaseSensitive?: boolean;
	combineBranches?: boolean;
}

export interface FindWidgetHarness {
	widget: any;
	sandbox: any;
	setColumnVisibility: (colVis: Partial<ColumnVisibility>) => void;
	setRegexMode: (isRegex: boolean) => void;
	setCaseSensitive: (isCaseSensitive: boolean) => void;
	search: (text: string) => { matches: string[]; error: string | null };
	findMatches: (text: string, goToHash?: string | null) => void;
	getMatches: () => string[];
	getError: () => string | null;
}

export function createFindWidgetHarness(options: FindWidgetHarnessOptions): FindWidgetHarness {
	const elementsById: { [id: string]: MockHtmlElement } = {};
	let commitRowElements: MockHtmlElement[] = [];

	const colVisibility: ColumnVisibility = {
		author: true,
		commit: true,
		date: true,
		...(options.columnVisibility || {})
	};

	commitRowElements = options.commits.map((c, i) => {
		const row = createMockElement('tr', c.message);
		row.dataset.id = i.toString();
		return row;
	});

	const mockDocument = {
		createElement: (tag: string) => createMockElement(tag),
		body: createMockElement('body'),
		getElementById: (id: string) => {
			if (!elementsById[id]) {
				elementsById[id] = createMockElement(id === 'findInput' ? 'input' : 'span');
			}
			return elementsById[id];
		},
		getElementsByClassName: (_cls: string) => commitRowElements,
		createTextNode: (t: string) => ({
			textContent: t,
			childNodes: [],
			children: [],
			parentNode: null,
			previousSibling: null,
			nextSibling: null
		})
	};

	const sandbox: any = {
		acquireVsCodeApi: () => ({ getState: () => null, setState: () => {}, postMessage: () => {} }),
		document: mockDocument,
		window: { addEventListener: () => {} },
		initialState: {
			config: {
				dateFormat: { iso: true, type: 'Date Only' },
				repoDropdownOrder: 'FullPath',
				referenceLabels: { combineLocalAndRemoteBranchLabels: options.combineBranches !== false },
				customEmojiShortcodeMappings: []
			}
		},
		globalState: {},
		workspaceState: {
			findIsCaseSensitive: Boolean(options.isCaseSensitive),
			findIsRegex: Boolean(options.isRegex),
			findOpenCommitDetailsView: false
		},
		alterClass: (elem: MockHtmlElement, cls: string, condition: boolean) => {
			if (condition) elem.classList.add(cls);
			else elem.classList.remove(cls);
		},
		handledEvent: () => {},
		updateWorkspaceViewState: (key: string, val: any) => { sandbox.workspaceState[key] = val; },
		SVG_ICONS: { arrowUp: '', arrowDown: '', cdv: '', close: '' },
		getBranchLabels: (heads: ReadonlyArray<string>, remotes: ReadonlyArray<GitCommitRemote>) => {
			const headLabels = heads.map(h => ({ name: h, remotes: [] as string[] }));
			const headLookup: { [k: string]: number } = {};
			heads.forEach((h, i) => { headLookup[h] = i; });
			const remotesRemaining: GitCommitRemote[] = [];
			for (const r of remotes) {
				if (sandbox.initialState.config.referenceLabels.combineLocalAndRemoteBranchLabels && r.remote !== null) {
					const branchName = r.name.substring(r.remote.length + 1);
					if (typeof headLookup[branchName] === 'number') {
						headLabels[headLookup[branchName]].remotes.push(r.remote);
						continue;
					}
				}
				remotesRemaining.push(r);
			}
			return { heads: headLabels, remotes: remotesRemaining };
		},
		abbrevCommit: (h: string) => h.substring(0, 8),
		getChildrenWithClassName: () => [],
		getCommitElems: () => commitRowElements,
		GG: {
			DateFormatType: { DateAndTime: 'Date & Time', DateOnly: 'Date Only', Relative: 'Relative' }
		},
		console
	};

	vm.createContext(sandbox);

	const utilsJs = getTranspiledWebScript('utils.ts');
	vm.runInContext(utilsJs, sandbox);

	if (webScriptExists('commitDataStore.ts')) {
		const commitDataStoreJs = getTranspiledWebScript('commitDataStore.ts');
		vm.runInContext(commitDataStoreJs, sandbox);
	}

	if (webScriptExists('commitFilterFallback.ts')) {
		const commitFilterFallbackJs = getTranspiledWebScript('commitFilterFallback.ts');
		vm.runInContext(commitFilterFallbackJs, sandbox);
	}

	const findWidgetJs = getTranspiledWebScript('findWidget.ts');
	vm.runInContext(findWidgetJs, sandbox);

	const FindWidgetClass = vm.runInContext('FindWidget', sandbox);

	let currentCommits = options.commits;
	let currentWasmCommits = options.wasmCommits || [];

	const mockView = {
		getColumnVisibility: () => colVisibility,
		getCommits: () => currentCommits,
		getWasmCommits: () => currentWasmCommits,
		saveState: () => {},
		scrollToCommit: () => {},
		isCdvOpen: () => false,
		getCommitId: (hash: string) => {
			const idx = currentCommits.findIndex(c => c.hash === hash);
			return idx > -1 ? idx : null;
		},
		loadCommitDetails: () => {}
	};

	const widget = new FindWidgetClass(mockView);

	return {
		widget,
		sandbox,
		setColumnVisibility: (newColVis: Partial<ColumnVisibility>) => {
			Object.assign(colVisibility, newColVis);
		},
		setRegexMode: (isRegex: boolean) => {
			sandbox.workspaceState.findIsRegex = isRegex;
		},
		setCaseSensitive: (isCaseSensitive: boolean) => {
			sandbox.workspaceState.findIsCaseSensitive = isCaseSensitive;
		},
		search: (text: string) => {
			widget.text = text;
			widget.findMatches(null, false);
			return {
				matches: widget.matches.map((m: any) => m.hash),
				error: widget.widgetElem.getAttribute('data-error')
			};
		},
		findMatches: (text: string, goToHash: string | null = null) => {
			widget.text = text;
			widget.findMatches(goToHash, false);
		},
		getMatches: () => widget.matches.map((m: any) => m.hash),
		getError: () => widget.widgetElem.getAttribute('data-error')
	};
}

export interface DataStoreHarness {
	sandbox: any;
	arraysEqual: <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, equalElements: (a: T, b: T) => boolean) => boolean;
	arraysStrictlyEqual: <T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>) => boolean;
	getBranchLabels: (heads: ReadonlyArray<string>, remotes: ReadonlyArray<GitCommitRemote>) => {
		heads: { name: string; remotes: string[] }[];
		remotes: ReadonlyArray<GitCommitRemote>;
	};
	abbrevCommit: (hash: string) => string;
	formatShortDate: (unixTimestamp: number) => { formatted: string };
	areCommitArraysEqual: (oldCommits: ReadonlyArray<GitCommit>, newCommits: ReadonlyArray<GitCommit>) => boolean;
	buildCommitLookup: (commits: ReadonlyArray<GitCommit>) => { [hash: string]: number };
	projectWasmCommits: (commits: ReadonlyArray<GitCommit>) => any[];
	aggregateAvatarsNeeded: (
		commits: ReadonlyArray<GitCommit>,
		existingAvatars: { [email: string]: string },
		fetchAvatars: boolean
	) => { [email: string]: string[] };
}

export function createDataStoreHarness(options?: { combineLocalAndRemoteBranchLabels?: boolean }): DataStoreHarness {
	const makeStub = () => function () { return { setColour: () => {}, close: () => {} }; };

	const sandbox: any = {
		acquireVsCodeApi: () => ({ getState: () => null, setState: () => {}, postMessage: () => {} }),
		document: {
			createElement: () => createMockElement('div'),
			body: createMockElement('body'),
			getElementById: () => null
		},
		window: { addEventListener: () => {} },
		initialState: {
			config: {
				dateFormat: { iso: true, type: 'Date Only' },
				repoDropdownOrder: 'FullPath',
				referenceLabels: {
					combineLocalAndRemoteBranchLabels: options?.combineLocalAndRemoteBranchLabels !== false
				},
				customEmojiShortcodeMappings: []
			}
		},
		globalState: {},
		workspaceState: {},
		ContextMenu: makeStub(),
		Dialog: makeStub(),
		EventOverlay: makeStub(),
		TextFormatter: { registerCustomEmojiMappings: () => {} },
		GG: {
			DateFormatType: { DateAndTime: 'Date & Time', DateOnly: 'Date Only', Relative: 'Relative' }
		},
		console
	};

	vm.createContext(sandbox);

	const utilsJs = getTranspiledWebScript('utils.ts');
	vm.runInContext(utilsJs, sandbox);

	if (webScriptExists('commitDataStore.ts')) {
		const commitDataStoreJs = getTranspiledWebScript('commitDataStore.ts');
		vm.runInContext(commitDataStoreJs, sandbox);
	}

	const mainJs = getTranspiledWebScript('main.ts');
	vm.runInContext(mainJs, sandbox);

	const arraysEqual = sandbox.arraysEqual;
	const arraysStrictlyEqual = sandbox.arraysStrictlyEqual;

	const areCommitArraysEqual = (oldCommits: ReadonlyArray<GitCommit>, newCommits: ReadonlyArray<GitCommit>): boolean => {
		if (sandbox.CommitDataStore && typeof sandbox.CommitDataStore.areCommitArraysEqual === 'function') {
			return sandbox.CommitDataStore.areCommitArraysEqual(oldCommits, newCommits);
		}
		if (typeof sandbox.areCommitArraysEqual === 'function') {
			return sandbox.areCommitArraysEqual(oldCommits, newCommits);
		}
		return arraysEqual(oldCommits, newCommits, (a: GitCommit, b: GitCommit) =>
			a.hash === b.hash &&
			arraysStrictlyEqual(a.heads, b.heads) &&
			arraysEqual(a.tags, b.tags, (tA: GitCommitTag, tB: GitCommitTag) => tA.name === tB.name && tA.annotated === tB.annotated) &&
			arraysEqual(a.remotes, b.remotes, (rA: GitCommitRemote, rB: GitCommitRemote) => rA.name === rB.name && rA.remote === rB.remote) &&
			arraysStrictlyEqual(a.parents, b.parents) &&
			((a.stash === null && b.stash === null) || (a.stash !== null && b.stash !== null && a.stash.selector === b.stash.selector))
		);
	};

	const buildCommitLookup = (commits: ReadonlyArray<GitCommit>): { [hash: string]: number } => {
		if (sandbox.CommitDataStore && typeof sandbox.CommitDataStore.buildCommitLookup === 'function') {
			return sandbox.CommitDataStore.buildCommitLookup(commits);
		}
		if (typeof sandbox.buildCommitLookup === 'function') {
			return sandbox.buildCommitLookup(commits);
		}
		const lookup: { [hash: string]: number } = {};
		for (let i = 0; i < commits.length; i++) {
			lookup[commits[i].hash] = i;
		}
		return lookup;
	};

	const projectWasmCommits = (commits: ReadonlyArray<GitCommit>): any[] => {
		if (sandbox.CommitDataStore && typeof sandbox.CommitDataStore.projectWasmCommits === 'function') {
			return sandbox.CommitDataStore.projectWasmCommits(commits);
		}
		if (typeof sandbox.projectWasmCommits === 'function') {
			return sandbox.projectWasmCommits(commits);
		}
		const wasmCommits = new Array(commits.length);
		for (let c = 0; c < commits.length; c++) {
			const cmt = commits[c];
			wasmCommits[c] = {
				hash: cmt.hash,
				abbreviated_hash: cmt.hash.substring(0, 7),
				parents: cmt.parents,
				author: { name: cmt.author, email: cmt.email },
				committer: { name: cmt.author, email: cmt.email },
				message: cmt.message,
				summary: cmt.message.split('\n')[0],
				date: new Date(cmt.date * 1000).toISOString()
			};
		}
		return wasmCommits;
	};

	const aggregateAvatarsNeeded = (
		commits: ReadonlyArray<GitCommit>,
		existingAvatars: { [email: string]: string },
		fetchAvatars: boolean
	): { [email: string]: string[] } => {
		if (sandbox.CommitDataStore && typeof sandbox.CommitDataStore.aggregateAvatarsNeeded === 'function') {
			return sandbox.CommitDataStore.aggregateAvatarsNeeded(commits, existingAvatars, fetchAvatars);
		}
		if (typeof sandbox.aggregateAvatarsNeeded === 'function') {
			return sandbox.aggregateAvatarsNeeded(commits, existingAvatars, fetchAvatars);
		}
		const avatarsNeeded: { [email: string]: string[] } = {};
		if (!fetchAvatars) return avatarsNeeded;

		for (let i = 0; i < commits.length; i++) {
			const commit = commits[i];
			if (typeof existingAvatars[commit.email] !== 'string' && commit.email !== '') {
				if (typeof avatarsNeeded[commit.email] === 'undefined') {
					avatarsNeeded[commit.email] = [commit.hash];
				} else {
					avatarsNeeded[commit.email].push(commit.hash);
				}
			}
		}
		return avatarsNeeded;
	};

	return {
		sandbox,
		arraysEqual,
		arraysStrictlyEqual,
		getBranchLabels: sandbox.getBranchLabels,
		abbrevCommit: sandbox.abbrevCommit,
		formatShortDate: sandbox.formatShortDate,
		areCommitArraysEqual,
		buildCommitLookup,
		projectWasmCommits,
		aggregateAvatarsNeeded
	};
}

export function createSampleCommit(overrides: Partial<GitCommit> = {}): GitCommit {
	return {
		hash: '0123456789abcdef0123456789abcdef01234567',
		parents: [],
		author: 'Alice Tester',
		email: 'alice@example.com',
		date: 1769947200,
		message: 'feat(core): initial commit\n\nDetailed commit message body.',
		heads: ['main'],
		tags: [{ name: 'v1.0.0', annotated: true }],
		remotes: [{ name: 'origin/main', remote: 'origin' }],
		stash: null,
		...overrides
	};
}
export interface ControlBarHarness {
	controlBar: any;
	sandbox: any;
	mockView: any;
	mockCalls: { [name: string]: any[][] };
	elements: {
		actionsBar: MockHtmlElement;
		searchInput: MockHtmlElement;
		searchTypeSelect: MockHtmlElement;
		quickFilterSelect: MockHtmlElement;
		searchCount: MockHtmlElement;
		comparisonBanner: MockHtmlElement;
		comparisonHashes: MockHtmlElement;
		compareDiffBtn: MockHtmlElement;
		compareClearBtn: MockHtmlElement;
		reflogModal: MockHtmlElement;
		reflogTableBody: MockHtmlElement;
		reflogModalClose: MockHtmlElement;
		reflogModalDismiss: MockHtmlElement;
	};
}

export function createControlBarHarness(options?: {
	actionIds?: ReadonlyArray<string>;
	buttonStyle?: 'iconOnly' | 'textOnly' | 'iconAndText';
	viewOverrides?: any;
}): ControlBarHarness {
	const actionsBar = createMockElement('div');
	actionsBar.id = 'actionsBar';
	const searchInput = createMockElement('input');
	searchInput.id = 'searchInput';
	const searchTypeSelect = createMockElement('select');
	searchTypeSelect.id = 'searchTypeSelect';
	searchTypeSelect.value = 'all';
	const quickFilterSelect = createMockElement('select');
	quickFilterSelect.id = 'quickFilterSelect';
	quickFilterSelect.value = 'all';
	const searchCount = createMockElement('span');
	searchCount.id = 'searchCount';
	const comparisonBanner = createMockElement('div');
	comparisonBanner.id = 'comparisonBanner';
	comparisonBanner.classList.add('hidden');
	const comparisonHashes = createMockElement('span');
	comparisonHashes.id = 'comparisonHashes';
	const compareDiffBtn = createMockElement('button');
	compareDiffBtn.id = 'compareDiffBtn';
	const compareClearBtn = createMockElement('button');
	compareClearBtn.id = 'compareClearBtn';
	const reflogModal = createMockElement('div');
	reflogModal.id = 'reflogModal';
	reflogModal.classList.add('hidden');
	const reflogTableBody = createMockElement('tbody');
	reflogTableBody.id = 'reflogTableBody';
	const reflogModalClose = createMockElement('button');
	reflogModalClose.id = 'reflogModalClose';
	const reflogModalDismiss = createMockElement('button');
	reflogModalDismiss.id = 'reflogModalDismiss';

	const elements: { [id: string]: MockHtmlElement } = {
		actionsBar,
		searchInput,
		searchTypeSelect,
		quickFilterSelect,
		searchCount,
		comparisonBanner,
		comparisonHashes,
		compareDiffBtn,
		compareClearBtn,
		reflogModal,
		reflogTableBody,
		reflogModalClose,
		reflogModalDismiss
	};

	const mockDocument = {
		createElement: (tag: string) => createMockElement(tag),
		body: createMockElement('body'),
		getElementById: (id: string) => {
			if (elements[id]) return elements[id];
			const found = actionsBar.querySelector('#' + id);
			if (found) return found;
			const el = createMockElement('div');
			el.id = id;
			elements[id] = el;
			return el;
		},
		createTextNode: (t: string) => ({
			textContent: t,
			childNodes: [],
			children: [],
			parentNode: null,
			previousSibling: null,
			nextSibling: null
		})
	};

	const sandbox: any = {
		acquireVsCodeApi: () => ({ getState: () => null, setState: () => {}, postMessage: () => {} }),
		document: mockDocument,
		window: { addEventListener: () => {} },
		abbrevCommit: (h: string) => h.substring(0, 8),
		console,
		Date
	};

	vm.createContext(sandbox);

	const utilsJs = getTranspiledWebScript('utils.ts');
	vm.runInContext(utilsJs, sandbox);

	const controlBarJs = getTranspiledWebScript('controlBar.ts');
	vm.runInContext(controlBarJs, sandbox);

	const ControlBarClass = vm.runInContext('ControlBar', sandbox);

	const mockCalls: { [name: string]: any[][] } = {};
	const record = (name: string) => (...args: any[]) => {
		if (!mockCalls[name]) mockCalls[name] = [];
		mockCalls[name].push(args);
	};

	const mockView: any = {
		fetchFromRemotesAction: record('fetchFromRemotesAction'),
		pullAction: record('pullAction'),
		pushAction: record('pushAction'),
		createBranchActionFromToolbar: record('createBranchActionFromToolbar'),
		createTagActionFromToolbar: record('createTagActionFromToolbar'),
		squashActionFromToolbar: record('squashActionFromToolbar'),
		stashActionFromToolbar: record('stashActionFromToolbar'),
		requestReflogAction: record('requestReflogAction'),
		openTerminalAction: record('openTerminalAction'),
		applyFilters: record('applyFilters'),
		viewCombinedDiffAction: record('viewCombinedDiffAction'),
		clearComparisonAction: record('clearComparisonAction'),
		scrollToCommit: record('scrollToCommit'),
		checkoutCommitAction: record('checkoutCommitAction'),
		...(options?.viewOverrides || {})
	};

	const controlBar = new ControlBarClass(mockView);
	if (options?.actionIds || options?.buttonStyle) {
		controlBar.renderToolbar(options.actionIds, options.buttonStyle);
	}

	return {
		controlBar,
		sandbox,
		mockView,
		mockCalls,
		elements: {
			actionsBar,
			searchInput,
			searchTypeSelect,
			quickFilterSelect,
			searchCount,
			comparisonBanner,
			comparisonHashes,
			compareDiffBtn,
			compareClearBtn,
			reflogModal,
			reflogTableBody,
			reflogModalClose,
			reflogModalDismiss
		}
	};
}

