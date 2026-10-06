/* Types for Wasm Bridge */

interface WasmRawAuthor {
	readonly name: string;
	readonly email: string;
}

interface WasmRawCommit {
	readonly hash: string;
	readonly abbreviated_hash: string;
	readonly parents: ReadonlyArray<string>;
	readonly author: WasmRawAuthor;
	readonly committer: WasmRawAuthor;
	readonly message: string;
	readonly summary: string;
	readonly date: string;
}

interface WasmRefCollection {
	readonly head?: { readonly Detached: string } | { readonly Branch: string };
	readonly branches: ReadonlyArray<string>;
	readonly remotes: ReadonlyArray<string>;
	readonly tags: ReadonlyArray<string>;
	readonly stashes: ReadonlyArray<string>;
	readonly worktrees: ReadonlyArray<string>;
}

interface WasmLayoutConfig {
	readonly row_height: number;
	readonly col_width: number;
	readonly node_radius: number;
	readonly color_palette_size: number;
}


/* GraphWasmBridge Class */

class GraphWasmBridge {
	public static isAvailable(): boolean {
		return typeof wasm_bindgen !== 'undefined' && typeof wasm_bindgen.generate_layout_js === 'function';
	}

	public static isWasmAvailable(): boolean {
		return GraphWasmBridge.isAvailable();
	}

	public static formatCommits(commits: ReadonlyArray<GG.GitCommit>, wasmCommitsInput?: ReadonlyArray<any>): ReadonlyArray<WasmRawCommit> {
		if (wasmCommitsInput && wasmCommitsInput.length === commits.length) {
			return wasmCommitsInput as ReadonlyArray<WasmRawCommit>;
		}

		const wasmCommits = new Array<WasmRawCommit>(commits.length);
		for (let i = 0; i < commits.length; i++) {
			const commit = commits[i];
			const authorInfo = { name: commit.author, email: commit.email };
			let dateIso: string;
			try {
				const d = new Date(commit.date * 1000);
				dateIso = isNaN(d.getTime()) ? '1970-01-01T00:00:00.000Z' : d.toISOString();
			} catch {
				dateIso = '1970-01-01T00:00:00.000Z';
			}

			wasmCommits[i] = {
				hash: commit.hash,
				abbreviated_hash: commit.hash.substring(0, 7),
				parents: commit.parents || [],
				author: authorInfo,
				committer: authorInfo,
				message: commit.message,
				summary: commit.message.split('\n')[0],
				date: dateIso
			};
		}
		return wasmCommits;
	}

	public static formatRefs(commitHead: string | null): WasmRefCollection {
		return {
			head: commitHead ? { Detached: commitHead } : undefined,
			branches: [],
			remotes: [],
			tags: [],
			stashes: [],
			worktrees: []
		};
	}

	public static formatConfig(config: GG.GraphConfig): WasmLayoutConfig {
		return {
			row_height: config.grid.y,
			col_width: config.grid.x,
			node_radius: 4,
			color_palette_size: config.colours.length
		};
	}

	public static generateLayout(
		commits: ReadonlyArray<GG.GitCommit>,
		commitHead: string | null,
		config: GG.GraphConfig,
		wasmCommitsInput?: ReadonlyArray<any>
	): GG.WasmGraphLayout | null {
		if (!GraphWasmBridge.isAvailable() || commits.length === 0) {
			return null;
		}

		try {
			const wasmCommits = GraphWasmBridge.formatCommits(commits, wasmCommitsInput);
			const wasmRefs = GraphWasmBridge.formatRefs(commitHead);
			const wasmConfig = GraphWasmBridge.formatConfig(config);
			return wasm_bindgen!.generate_layout_js(wasmCommits, wasmRefs, wasmConfig);
		} catch {
			return null;
		}
	}

	public static loadCommits(
		layout: GraphLayout,
		commits: ReadonlyArray<GG.GitCommit>,
		commitHead: string | null,
		commitLookup: { [hash: string]: number },
		onlyFollowFirstParent: boolean,
		config: GG.GraphConfig,
		wasmCommitsInput?: ReadonlyArray<any>
	): boolean {
		layout.initCommits(commits, commitHead, commitLookup, onlyFollowFirstParent);
		if (commits.length === 0) return false;

		let usedWasm = false;
		if (GraphWasmBridge.isAvailable()) {
			try {
				const wasmLayout = GraphWasmBridge.generateLayout(commits, commitHead, config, wasmCommitsInput);
				if (wasmLayout !== null && wasmLayout.rows && wasmLayout.rows.length === commits.length) {
					layout.applyWasmLayout(wasmLayout);
					usedWasm = true;
				}
			} catch {
				usedWasm = false;
			}
		}

		if (!usedWasm) {
			layout.computePureLayout();
		}

		return usedWasm;
	}

	public static renderLanesSvg(layout: GG.WasmGraphLayout, config: GG.GraphConfig): string | null {
		if (typeof wasm_bindgen !== 'undefined' && typeof wasm_bindgen.render_lanes_svg_js === 'function') {
			try {
				const wasmConfig = GraphWasmBridge.formatConfig(config);
				return wasm_bindgen.render_lanes_svg_js(layout, wasmConfig);
			} catch {
				return null;
			}
		}
		return null;
	}
}

if (typeof exports !== 'undefined') {
	exports.GraphWasmBridge = GraphWasmBridge;
}
