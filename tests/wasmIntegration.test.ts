import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';

if (typeof (global as any).TextDecoder === 'undefined') {
	(global as any).TextDecoder = TextDecoder;
	(global as any).TextEncoder = TextEncoder;
}

describe('Wasm Integration', () => {
	const wasmJsPath = path.join(__dirname, '../media/git_graph_wasm.js');
	const wasmBgPath = path.join(__dirname, '../media/git_graph_wasm_bg.wasm');

	it('should have wasm binary and js glue present in media directory', () => {
		expect(fs.existsSync(wasmJsPath)).toBe(true);
		expect(fs.existsSync(wasmBgPath)).toBe(true);
	});

	it('should initialize wasm and compute graph layout', () => {
		const wasmJsCode = fs.readFileSync(wasmJsPath, 'utf8');
		const getWasmBindgen = new Function(wasmJsCode + '; return wasm_bindgen;');
		const wasmBindgen = getWasmBindgen();

		expect(typeof wasmBindgen).toBe('function');
		expect(typeof wasmBindgen.initSync).toBe('function');
		expect(typeof wasmBindgen.generate_layout_js).toBe('function');

		const wasmBytes = fs.readFileSync(wasmBgPath);
		wasmBindgen.initSync({ module: wasmBytes });

		const sampleCommits = [
			{
				hash: '1111111111111111111111111111111111111111',
				abbreviated_hash: '1111111',
				parents: [],
				author: { name: 'Author One', email: 'one@example.com' },
				committer: { name: 'Author One', email: 'one@example.com' },
				message: 'Initial commit',
				summary: 'Initial commit',
				date: '2026-01-01T00:00:00.000Z'
			},
			{
				hash: '2222222222222222222222222222222222222222',
				abbreviated_hash: '2222222',
				parents: ['1111111111111111111111111111111111111111'],
				author: { name: 'Author Two', email: 'two@example.com' },
				committer: { name: 'Author Two', email: 'two@example.com' },
				message: 'Second commit',
				summary: 'Second commit',
				date: '2026-01-02T00:00:00.000Z'
			}
		];

		const refs = {
			branches: [],
			remotes: [],
			tags: [],
			stashes: [],
			worktrees: []
		};

		const config = {
			row_height: 24,
			col_width: 16,
			node_radius: 4,
			color_palette_size: 10
		};

		const layout = wasmBindgen.generate_layout_js(sampleCommits, refs, config);

		expect(layout).toBeDefined();
		expect(layout.rows.length).toBe(2);
		expect(layout.rows[0].node.hash).toBe(sampleCommits[0].hash);
		expect(layout.rows[0].node.column).toBe(0);
		expect(layout.rows[1].node.hash).toBe(sampleCommits[1].hash);
		expect(layout.rows[1].node.column).toBe(1);
		expect(layout.max_columns).toBeGreaterThanOrEqual(1);
	});
});
