import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';

if (typeof (global as any).TextDecoder === 'undefined') {
	(global as any).TextDecoder = TextDecoder;
	(global as any).TextEncoder = TextEncoder;
}

describe('Graph SVG Rendering', () => {
	const wasmJsPath = path.join(__dirname, '../media/git_graph_wasm.js');
	const wasmBgPath = path.join(__dirname, '../media/git_graph_wasm_bg.wasm');

	let wasmBindgen: any;

	beforeAll(() => {
		const wasmJsCode = fs.readFileSync(wasmJsPath, 'utf8');
		const getWasmBindgen = new Function(wasmJsCode + '; return wasm_bindgen;');
		wasmBindgen = getWasmBindgen();
		const wasmBytes = fs.readFileSync(wasmBgPath);
		wasmBindgen.initSync({ module: wasmBytes });
	});

	it('should render SVG for linear history', () => {
		const commits = [
			{
				hash: 'a111111111111111111111111111111111111111',
				abbreviated_hash: 'a111111',
				parents: [],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Initial commit',
				summary: 'Initial commit',
				date: '2026-01-01T00:00:00.000Z'
			},
			{
				hash: 'b222222222222222222222222222222222222222',
				abbreviated_hash: 'b222222',
				parents: ['a111111111111111111111111111111111111111'],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Feature commit',
				summary: 'Feature commit',
				date: '2026-01-02T00:00:00.000Z'
			}
		];

		const config = {
			row_height: 24,
			col_width: 16,
			node_radius: 4,
			color_palette_size: 10
		};

		const layout = wasmBindgen.generate_layout_js(commits, {}, config);
		expect(layout.rows.length).toBe(2);

		const svg = wasmBindgen.render_svg_js(layout, config);
		expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('</svg>');
		// Should contain path connecting the commits
		expect(svg).toContain('<path d="M');
		// Should contain circle nodes
		expect(svg).toContain('<circle cx=');
		expect(svg).toContain('r="4"');
	});

	it('should render SVG for merge topology with distinct lane colors', () => {
		const commits = [
			{
				hash: 'c1',
				abbreviated_hash: 'c1',
				parents: [],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Root',
				summary: 'Root',
				date: '2026-01-01T00:00:00.000Z'
			},
			{
				hash: 'c2',
				abbreviated_hash: 'c2',
				parents: ['c1'],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Branch A',
				summary: 'Branch A',
				date: '2026-01-02T00:00:00.000Z'
			},
			{
				hash: 'c3',
				abbreviated_hash: 'c3',
				parents: ['c1'],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Branch B',
				summary: 'Branch B',
				date: '2026-01-03T00:00:00.000Z'
			},
			{
				hash: 'c4',
				abbreviated_hash: 'c4',
				parents: ['c2', 'c3'],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Merge branches',
				summary: 'Merge branches',
				date: '2026-01-04T00:00:00.000Z'
			}
		];

		const config = {
			row_height: 24,
			col_width: 16,
			node_radius: 4,
			color_palette_size: 10
		};

		const layout = wasmBindgen.generate_layout_js(commits, {}, config);
		expect(layout.rows.length).toBe(4);
		expect(layout.max_columns).toBeGreaterThanOrEqual(2);

		const svg = wasmBindgen.render_svg_js(layout, config);
		expect(svg).toContain('<path');
		// Merge node has slightly larger radius (4 * 1.3 = 5.2)
		expect(svg).toContain('r="5.2"');
	});

	it('should render lane paths SVG directly via render_lanes_svg_js', () => {
		const commits = [
			{
				hash: 'x1',
				abbreviated_hash: 'x1',
				parents: [],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Root',
				summary: 'Root',
				date: '2026-01-01T00:00:00.000Z'
			},
			{
				hash: 'x2',
				abbreviated_hash: 'x2',
				parents: ['x1'],
				author: { name: 'Dev', email: 'dev@test.com' },
				committer: { name: 'Dev', email: 'dev@test.com' },
				message: 'Branch',
				summary: 'Branch',
				date: '2026-01-02T00:00:00.000Z'
			}
		];
		const config = {
			row_height: 24,
			col_width: 16,
			node_radius: 4,
			color_palette_size: 10
		};
		const layout = wasmBindgen.generate_layout_js(commits, {}, config);
		const lanesSvg = wasmBindgen.render_lanes_svg_js(layout, config);
		expect(lanesSvg).toContain('<path class="shadow"');
		expect(lanesSvg).toContain('<path class="line"');
		expect(lanesSvg).toContain('stroke=');
	});
});
