/* Commit Data Store */
/* eslint-disable @typescript-eslint/explicit-member-accessibility */

interface WasmProjectedCommit {
	readonly hash: string;
	readonly abbreviated_hash: string;
	readonly parents: ReadonlyArray<string>;
	readonly author: { readonly name: string; readonly email: string };
	readonly committer: { readonly name: string; readonly email: string };
	readonly message: string;
	readonly summary: string;
	readonly date: string;
}

interface BranchLabelsResult {
	readonly heads: { readonly name: string; readonly remotes: string[] }[];
	readonly remotes: ReadonlyArray<GG.GitCommitRemote>;
}

function commitDataStoreArraysEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>, equalElements: (a: T, b: T) => boolean) {
	if (typeof arraysEqual === 'function') {
		return arraysEqual(a, b, equalElements);
	}
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (!equalElements(a[i], b[i])) return false;
	}
	return true;
}

function commitDataStoreArraysStrictlyEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>) {
	if (typeof arraysStrictlyEqual === 'function') {
		return arraysStrictlyEqual(a, b);
	}
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

class CommitDataStore {
	private commits: GG.GitCommit[] = [];
	private wasmCommits: any[] = [];
	private commitHead: string | null = null;
	private commitLookup: { [hash: string]: number } = {};
	private avatars: AvatarImageCollection = {};
	private moreCommitsAvailable: boolean = false;
	private onlyFollowFirstParent: boolean = false;

	constructor(initialAvatars?: AvatarImageCollection) {
		if (initialAvatars) {
			this.avatars = Object.assign({}, initialAvatars);
		}
	}

	public getCommits(): GG.GitCommit[] {
		return this.commits;
	}

	public getWasmCommits(): any[] {
		return this.wasmCommits;
	}

	public getCommit(hash: string): GG.GitCommit | null {
		const id = this.getCommitId(hash);
		return id !== null ? this.commits[id] : null;
	}

	public getCommitByIndex(index: number): GG.GitCommit | null {
		return index >= 0 && index < this.commits.length ? this.commits[index] : null;
	}

	public getCommitId(hash: string): number | null {
		return typeof this.commitLookup[hash] === 'number' ? this.commitLookup[hash] : null;
	}

	public getCommitHead(): string | null {
		return this.commitHead;
	}

	public setCommitHead(head: string | null) {
		this.commitHead = head;
	}

	public getCommitLookup(): { [hash: string]: number } {
		return this.commitLookup;
	}

	public setCommitLookup(lookup: { [hash: string]: number }) {
		this.commitLookup = lookup;
	}

	public setWasmCommits(wasmCommits: any[]) {
		this.wasmCommits = wasmCommits;
	}

	public getAvatars(): AvatarImageCollection {
		return this.avatars;
	}

	public setAvatars(avatars: AvatarImageCollection) {
		this.avatars = Object.assign({}, avatars);
	}

	public setAvatar(email: string, image: string) {
		this.avatars[email] = image;
	}

	public getAvatar(email: string): string | null {
		return typeof this.avatars[email] === 'string' ? this.avatars[email] : null;
	}

	public isMoreCommitsAvailable(): boolean {
		return this.moreCommitsAvailable;
	}

	public setMoreCommitsAvailable(more: boolean) {
		this.moreCommitsAvailable = more;
	}

	public getOnlyFollowFirstParent(): boolean {
		return this.onlyFollowFirstParent;
	}

	public setOnlyFollowFirstParent(val: boolean) {
		this.onlyFollowFirstParent = val;
	}

	public setCommits(commits: GG.GitCommit[], commitHead: string | null = null, moreCommitsAvailable: boolean = false, onlyFollowFirstParent: boolean = false) {
		this.commits = commits;
		this.commitHead = commitHead;
		this.moreCommitsAvailable = moreCommitsAvailable;
		this.onlyFollowFirstParent = onlyFollowFirstParent;
		this.commitLookup = CommitDataStore.buildCommitLookup(this.commits);
		this.wasmCommits = CommitDataStore.projectWasmCommits(this.commits);
	}

	public updateUncommittedChanges(newCommit: GG.GitCommit): boolean {
		const uncommitted = typeof UNCOMMITTED !== 'undefined' ? UNCOMMITTED : '*';
		if (this.commits.length > 0 && this.commits[0].hash === uncommitted) {
			this.commits[0] = newCommit;
			if (this.wasmCommits.length > 0) {
				this.wasmCommits[0] = CommitDataStore.projectSingleWasmCommit(newCommit);
			}
			return true;
		}
		return false;
	}

	public clear() {
		this.commits = [];
		this.wasmCommits = [];
		this.commitHead = null;
		this.commitLookup = {};
		this.moreCommitsAvailable = false;
	}

	public size(): number {
		return this.commits.length;
	}

	public areCommitArraysEqual(newCommits: ReadonlyArray<GG.GitCommit>): boolean;
	public areCommitArraysEqual(oldCommits: ReadonlyArray<GG.GitCommit>, newCommits: ReadonlyArray<GG.GitCommit>): boolean;
	public areCommitArraysEqual(first: ReadonlyArray<GG.GitCommit>, second?: ReadonlyArray<GG.GitCommit>): boolean {
		if (second !== undefined) {
			return CommitDataStore.areCommitArraysEqual(first, second);
		}
		return CommitDataStore.areCommitArraysEqual(this.commits, first);
	}

	public static areCommitArraysEqual(oldCommits: ReadonlyArray<GG.GitCommit>, newCommits: ReadonlyArray<GG.GitCommit>): boolean {
		return commitDataStoreArraysEqual(oldCommits, newCommits, (a, b) =>
			a.hash === b.hash &&
			commitDataStoreArraysStrictlyEqual(a.heads, b.heads) &&
			commitDataStoreArraysEqual(a.tags, b.tags, (tA, tB) => tA.name === tB.name && tA.annotated === tB.annotated) &&
			commitDataStoreArraysEqual(a.remotes, b.remotes, (rA, rB) => rA.name === rB.name && rA.remote === rB.remote) &&
			commitDataStoreArraysStrictlyEqual(a.parents, b.parents) &&
			((a.stash === null && b.stash === null) || (a.stash !== null && b.stash !== null && a.stash.selector === b.stash.selector))
		);
	}

	public buildCommitLookup(): { [hash: string]: number } {
		return CommitDataStore.buildCommitLookup(this.commits);
	}

	public static buildCommitLookup(commits: ReadonlyArray<GG.GitCommit>): { [hash: string]: number } {
		const lookup: { [hash: string]: number } = {};
		for (let i = 0; i < commits.length; i++) {
			lookup[commits[i].hash] = i;
		}
		return lookup;
	}

	public projectWasmCommits(): any[] {
		return CommitDataStore.projectWasmCommits(this.commits);
	}

	public static projectWasmCommits(commits: ReadonlyArray<GG.GitCommit>): any[] {
		const projected = new Array(commits.length);
		for (let i = 0; i < commits.length; i++) {
			projected[i] = CommitDataStore.projectSingleWasmCommit(commits[i]);
		}
		return projected;
	}

	public static projectSingleWasmCommit(commit: GG.GitCommit): any {
		return {
			hash: commit.hash,
			abbreviated_hash: commit.hash.substring(0, 7),
			parents: commit.parents,
			author: { name: commit.author, email: commit.email },
			committer: { name: commit.author, email: commit.email },
			message: commit.message,
			summary: commit.message.split('\n')[0],
			date: new Date(commit.date * 1000).toISOString()
		};
	}

	public aggregateAvatarsNeeded(fetchAvatars: boolean): { [email: string]: string[] } {
		return CommitDataStore.aggregateAvatarsNeeded(this.commits, this.avatars, fetchAvatars);
	}

	public static aggregateAvatarsNeeded(
		commits: ReadonlyArray<GG.GitCommit>,
		existingAvatars: AvatarImageCollection,
		fetchAvatars: boolean
	): { [email: string]: string[] } {
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
	}

	public static getBranchLabels(
		heads: ReadonlyArray<string>,
		remotes: ReadonlyArray<GG.GitCommitRemote>,
		combineLocalAndRemoteBranchLabels: boolean
	): BranchLabelsResult {
		const headLabels: { name: string; remotes: string[] }[] = [];
		const headLookup: { [name: string]: number } = {};

		for (let i = 0; i < heads.length; i++) {
			headLabels.push({ name: heads[i], remotes: [] });
			headLookup[heads[i]] = i;
		}

		if (combineLocalAndRemoteBranchLabels) {
			const remainingRemoteLabels: GG.GitCommitRemote[] = [];
			for (let i = 0; i < remotes.length; i++) {
				const remote = remotes[i];
				if (remote.remote !== null) {
					const branchName = remote.name.substring(remote.remote.length + 1);
					if (typeof headLookup[branchName] === 'number') {
						headLabels[headLookup[branchName]].remotes.push(remote.remote);
						continue;
					}
				}
				remainingRemoteLabels.push(remote);
			}
			return { heads: headLabels, remotes: remainingRemoteLabels };
		} else {
			return { heads: headLabels, remotes: remotes };
		}
	}
}

if (typeof exports !== 'undefined') {
	exports.CommitDataStore = CommitDataStore;
}
