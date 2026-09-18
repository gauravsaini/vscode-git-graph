import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';

if (typeof (global as any).TextDecoder === 'undefined') {
	(global as any).TextDecoder = TextDecoder;
	(global as any).TextEncoder = TextEncoder;
}

describe('Commit Filtering Parity', () => {
	const wasmJsPath = path.join(__dirname, '../media/git_graph_wasm.js');
	const wasmBgPath = path.join(__dirname, '../media/git_graph_wasm_bg.wasm');

	let wasmBindgen: any;

	const commits = [
		{
			hash: 'a1b2c3d4e5f601',
			abbreviated_hash: 'a1b2c3d',
			parents: [],
			author: { name: 'Alice Smith', email: 'alice@company.org' },
			committer: { name: 'Alice Smith', email: 'alice@company.org' },
			message: 'feat: add user authentication\n\nDetailed description here.',
			summary: 'feat: add user authentication',
			date: '2026-01-01T10:00:00.000Z'
		},
		{
			hash: 'b2c3d4e5f6a102',
			abbreviated_hash: 'b2c3d4e',
			parents: ['a1b2c3d4e5f601'],
			author: { name: 'Bob Jones', email: 'bob@contractor.net' },
			committer: { name: 'Bob Jones', email: 'bob@contractor.net' },
			message: 'fix: resolve race condition in token refresh',
			summary: 'fix: resolve race condition in token refresh',
			date: '2026-01-02T11:00:00.000Z'
		},
		{
			hash: 'c3d4e5f6a1b203',
			abbreviated_hash: 'c3d4e5f',
			parents: ['b2c3d4e5f6a102'],
			author: { name: 'Alice Smith', email: 'alice@company.org' },
			committer: { name: 'Alice Smith', email: 'alice@company.org' },
			message: 'docs: update deployment architecture guide',
			summary: 'docs: update deployment architecture guide',
			date: '2026-01-03T12:00:00.000Z'
		}
	];

	beforeAll(() => {
		const wasmJsCode = fs.readFileSync(wasmJsPath, 'utf8');
		const getWasmBindgen = new Function(wasmJsCode + '; return wasm_bindgen;');
		wasmBindgen = getWasmBindgen();
		const wasmBytes = fs.readFileSync(wasmBgPath);
		wasmBindgen.initSync({ module: wasmBytes });
	});

	it('should filter commits by message pattern case-insensitively', () => {
		const query = { message_pattern: 'AUTHENTICATION' };
		const indices: number[] = wasmBindgen.filter_commits_js(commits, query);
		expect(indices).toEqual([0]);
	});

	it('should filter commits by author name or email', () => {
		const query = { author_pattern: 'alice' };
		const indices: number[] = wasmBindgen.filter_commits_js(commits, query);
		expect(indices).toEqual([0, 2]);

		const emailQuery = { author_pattern: 'contractor.net' };
		const emailIndices: number[] = wasmBindgen.filter_commits_js(commits, emailQuery);
		expect(emailIndices).toEqual([1]);
	});

	it('should filter commits by hash prefix', () => {
		const query = { hash_prefix: 'c3d4' };
		const indices: number[] = wasmBindgen.filter_commits_js(commits, query);
		expect(indices).toEqual([2]);
	});

	it('should return all commits when query is empty', () => {
		const query = {};
		const indices: number[] = wasmBindgen.filter_commits_js(commits, query);
		expect(indices).toEqual([0, 1, 2]);
	});

	it('should filter commits across all fields via text_query', () => {
		// Matches message
		expect(wasmBindgen.filter_commits_js(commits, { text_query: 'race condition' })).toEqual([1]);
		// Matches author name
		expect(wasmBindgen.filter_commits_js(commits, { text_query: 'bob' })).toEqual([1]);
		// Matches author email
		expect(wasmBindgen.filter_commits_js(commits, { text_query: 'company.org' })).toEqual([0, 2]);
		// Matches hash prefix
		expect(wasmBindgen.filter_commits_js(commits, { text_query: 'c3d4' })).toEqual([2]);
	});

	it('should respect case_sensitive flag with text_query', () => {
		expect(wasmBindgen.filter_commits_js(commits, { text_query: 'ALICE', case_sensitive: true })).toEqual([]);
		expect(wasmBindgen.filter_commits_js(commits, { text_query: 'Alice', case_sensitive: true })).toEqual([0, 2]);
	});
});
