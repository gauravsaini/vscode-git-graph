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
	GitSignatureStatus
} from '../../src/types';

describe('Milestone 1 Diff, Config & Signature Adversarial Challenge Suite', () => {

	// =========================================================================
	// 1. diffParser Adversarial Tests
	// =========================================================================
	describe('diffParser Adversarial Edge Cases', () => {

		describe('parseDiffNameStatus Edge Cases', () => {
			it('should parse all standard statuses: Added, Modified, Deleted', () => {
				const output = ['A', 'added.ts', 'M', 'modified.ts', 'D', 'deleted.ts', ''];
				const records = parseDiffNameStatus(output);
				expect(records).toEqual([
					{ type: GitFileStatus.Added, oldFilePath: 'added.ts', newFilePath: 'added.ts' },
					{ type: GitFileStatus.Modified, oldFilePath: 'modified.ts', newFilePath: 'modified.ts' },
					{ type: GitFileStatus.Deleted, oldFilePath: 'deleted.ts', newFilePath: 'deleted.ts' }
				]);
			});

			it('should parse Renamed with similarity scores (e.g. R100, R085, R)', () => {
				const output = [
					'R100', 'old1.ts', 'new1.ts',
					'R085', 'old2.ts', 'new2.ts',
					'R', 'old3.ts', 'new3.ts',
					''
				];
				const records = parseDiffNameStatus(output);
				expect(records).toEqual([
					{ type: GitFileStatus.Renamed, oldFilePath: 'old1.ts', newFilePath: 'new1.ts' },
					{ type: GitFileStatus.Renamed, oldFilePath: 'old2.ts', newFilePath: 'new2.ts' },
					{ type: GitFileStatus.Renamed, oldFilePath: 'old3.ts', newFilePath: 'new3.ts' }
				]);
			});

			it('should correctly handle paths with spaces, tabs, and unicode characters', () => {
				const output = [
					'A', 'path with spaces/file name (1).ts',
					'M', 'src/документ/ünicøde-файл-🚀.ts',
					'R100', 'old path/ancien nom.txt', 'new path/nouveau nom-🎉.txt',
					''
				];
				const records = parseDiffNameStatus(output);
				expect(records.length).toBe(3);
				expect(records[0]).toEqual({
					type: GitFileStatus.Added,
					oldFilePath: 'path with spaces/file name (1).ts',
					newFilePath: 'path with spaces/file name (1).ts'
				});
				expect(records[1]).toEqual({
					type: GitFileStatus.Modified,
					oldFilePath: 'src/документ/ünicøde-файл-🚀.ts',
					newFilePath: 'src/документ/ünicøde-файл-🚀.ts'
				});
				expect(records[2]).toEqual({
					type: GitFileStatus.Renamed,
					oldFilePath: 'old path/ancien nom.txt',
					newFilePath: 'new path/nouveau nom-🎉.txt'
				});
			});

			it('should normalise Windows backslashes in paths to forward slashes', () => {
				const output = [
					'M', 'src\\nested\\deep\\module.ts',
					'R100', 'win\\old\\path.ts', 'win\\new\\path.ts',
					''
				];
				const records = parseDiffNameStatus(output);
				expect(records).toEqual([
					{ type: GitFileStatus.Modified, oldFilePath: 'src/nested/deep/module.ts', newFilePath: 'src/nested/deep/module.ts' },
					{ type: GitFileStatus.Renamed, oldFilePath: 'win/old/path.ts', newFilePath: 'win/new/path.ts' }
				]);
			});

			it('should handle isDiffTree = true by shifting the leading commit hash token', () => {
				const rawOutput = '4b825dc642cb6eb9a060e54bf8d69288fbee4904\0A\0file.ts\0';
				const records = parseDiffNameStatus(rawOutput, true);
				expect(records).toEqual([
					{ type: GitFileStatus.Added, oldFilePath: 'file.ts', newFilePath: 'file.ts' }
				]);
			});

			it('should handle isDiffTree = true when tokens list is empty or single empty string', () => {
				expect(parseDiffNameStatus([], true)).toEqual([]);
				expect(parseDiffNameStatus('', true)).toEqual([]);
				expect(parseDiffNameStatus(['hash_only'], true)).toEqual([]);
			});

			it('should gracefully handle truncated streams without throwing', () => {
				// Truncated Added token (no file path)
				expect(parseDiffNameStatus(['A'])).toEqual([]);
				// Truncated Rename token (only old file path, missing new path)
				expect(parseDiffNameStatus(['R100', 'old.ts'])).toEqual([]);
				// Valid record followed by truncated record
				expect(parseDiffNameStatus(['A', 'valid.ts', 'M'])).toEqual([
					{ type: GitFileStatus.Added, oldFilePath: 'valid.ts', newFilePath: 'valid.ts' }
				]);
				expect(parseDiffNameStatus(['M', 'valid.ts', 'R100', 'old.ts'])).toEqual([
					{ type: GitFileStatus.Modified, oldFilePath: 'valid.ts', newFilePath: 'valid.ts' }
				]);
			});

			it('should terminate parsing immediately when encountering non-standard or unknown status', () => {
				// C (Copy) or T (Typechange) or garbage characters
				const output = ['A', 'first.ts', 'C', 'orig.ts', 'copy.ts', ''];
				const records = parseDiffNameStatus(output);
				expect(records).toEqual([
					{ type: GitFileStatus.Added, oldFilePath: 'first.ts', newFilePath: 'first.ts' }
				]);
			});

			it('should parse NUL-delimited string input with trailing NUL correctly', () => {
				const raw = 'A\0file1.ts\0M\0file2.ts\0D\0file3.ts\0';
				const records = parseDiffNameStatus(raw);
				expect(records.length).toBe(3);
			});
		});

		describe('parseDiffNumStat Edge Cases', () => {
			it('should parse standard numeric additions and deletions', () => {
				const output = ['42\t17\tsrc/index.ts', '0\t0\tempty.txt', ''];
				const records = parseDiffNumStat(output);
				expect(records).toEqual([
					{ filePath: 'src/index.ts', additions: 42, deletions: 17 },
					{ filePath: 'empty.txt', additions: 0, deletions: 0 }
				]);
			});

			it('should parse renamed files where fields[2] is empty followed by old/new paths', () => {
				const output = ['15\t3\t', 'old/module.ts', 'new/module.ts', ''];
				const records = parseDiffNumStat(output);
				expect(records).toEqual([
					{ filePath: 'new/module.ts', additions: 15, deletions: 3 }
				]);
			});

			it('should handle binary files with hyphen - additions and deletions yielding NaN', () => {
				const output = ['-\t-\timages/banner.png', '-\t-\t', 'old/font.woff', 'new/font.woff', ''];
				const records = parseDiffNumStat(output);
				expect(records.length).toBe(2);
				expect(records[0].filePath).toBe('images/banner.png');
				expect(Number.isNaN(records[0].additions)).toBe(true);
				expect(Number.isNaN(records[0].deletions)).toBe(true);

				expect(records[1].filePath).toBe('new/font.woff');
				expect(Number.isNaN(records[1].additions)).toBe(true);
				expect(Number.isNaN(records[1].deletions)).toBe(true);
			});

			it('should normalise Windows backslashes in numstat file paths', () => {
				const output = ['10\t5\tsrc\\win\\path.ts', ''];
				const records = parseDiffNumStat(output);
				expect(records[0].filePath).toBe('src/win/path.ts');
			});

			it('should handle unicode characters and spaces in file paths', () => {
				const output = ['99\t1\tfolder name/документ-🚀.ts', ''];
				const records = parseDiffNumStat(output);
				expect(records[0].filePath).toBe('folder name/документ-🚀.ts');
				expect(records[0].additions).toBe(99);
				expect(records[0].deletions).toBe(1);
			});

			it('should skip leading commit hash when isDiffTree is true', () => {
				const output = ['commit_hash_12345', '10\t2\tfile.ts', ''];
				const records = parseDiffNumStat(output, true);
				expect(records).toEqual([
					{ filePath: 'file.ts', additions: 10, deletions: 2 }
				]);
			});

			it('should stop parsing upon non-3-part lines (missing tabs, single fields, extra tabs)', () => {
				// Line with no tabs
				expect(parseDiffNumStat(['10 5 file.ts', ''])).toEqual([]);
				// Line with 1 tab (2 fields)
				expect(parseDiffNumStat(['10\t5', ''])).toEqual([]);
				// Line with 3 tabs (4 fields)
				expect(parseDiffNumStat(['10\t5\tfile.ts\textra', ''])).toEqual([]);
				// Valid line followed by corrupted line
				expect(parseDiffNumStat(['10\t5\tvalid.ts', 'corrupted', '20\t2\tignored.ts', ''])).toEqual([
					{ filePath: 'valid.ts', additions: 10, deletions: 5 }
				]);
			});

			it('should handle truncated stream in rename without throwing', () => {
				// Rename line with missing new path
				const output = ['10\t5\t', 'old.ts'];
				const records = parseDiffNumStat(output);
				expect(records).toEqual([]);
			});

			it('should handle empty input strings gracefully', () => {
				expect(parseDiffNumStat('')).toEqual([]);
				expect(parseDiffNumStat('', true)).toEqual([]);
				expect(parseDiffNumStat([])).toEqual([]);
			});
		});

		describe('parseStatusFiles Edge Cases', () => {
			it('should parse untracked (??) files', () => {
				const stdout = '?? untracked.ts\0?? another untracked file.txt\0';
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['untracked.ts', 'another untracked file.txt']);
				expect(status.deleted).toEqual([]);
			});

			it('should parse deleted files with working-tree ( D), index (D ), or conflict (DD/MD) status', () => {
				const stdout = [
					' D wt_deleted.ts',
					'D  index_deleted.ts',
					'DD both_deleted.ts',
					'MD mod_then_deleted.ts',
					''
				].join('\0');
				const status = parseStatusFiles(stdout);
				expect(status.deleted).toEqual([
					'wt_deleted.ts',
					'index_deleted.ts',
					'both_deleted.ts',
					'mod_then_deleted.ts'
				]);
				expect(status.untracked).toEqual([]);
			});

			it('should skip destination path tokens on rename (R) or copy (C) records', () => {
				const stdout = [
					'R  old.ts',
					'new.ts',
					'C  orig.ts',
					'copy.ts',
					'?? pending.ts',
					''
				].join('\0');
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['pending.ts']);
				expect(status.deleted).toEqual([]);
			});

			it('should stop parsing when encountering tokens shorter than 4 characters', () => {
				const stdout = '?? file1.ts\0xyz\0?? file2.ts\0';
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['file1.ts']);
			});

			it('should handle truncated streams without throwing', () => {
				// Empty output
				expect(parseStatusFiles('')).toEqual({ deleted: [], untracked: [] });
				// Output ending at rename token without second path
				expect(parseStatusFiles('R  old.ts')).toEqual({ deleted: [], untracked: [] });
				// Bare status prefix without path
				expect(parseStatusFiles('?? ')).toEqual({ deleted: [], untracked: [] });
			});

			it('should preserve unicode and space characters in status paths', () => {
				const stdout = '?? folder/файл с пробелами 🚀.ts\0 D old/документ.txt\0';
				const status = parseStatusFiles(stdout);
				expect(status.untracked).toEqual(['folder/файл с пробелами 🚀.ts']);
				expect(status.deleted).toEqual(['old/документ.txt']);
			});
		});

		describe('generateFileChanges Edge Cases', () => {
			it('should merge nameStatus and numStat records accurately', () => {
				const nameStatus = [
					{ type: GitFileStatus.Added, oldFilePath: 'added.ts', newFilePath: 'added.ts' },
					{ type: GitFileStatus.Modified, oldFilePath: 'mod.ts', newFilePath: 'mod.ts' },
					{ type: GitFileStatus.Renamed, oldFilePath: 'old.ts', newFilePath: 'new.ts' }
				];
				const numStat = [
					{ filePath: 'added.ts', additions: 10, deletions: 0 },
					{ filePath: 'mod.ts', additions: 5, deletions: 3 },
					{ filePath: 'new.ts', additions: 20, deletions: 8 }
				];
				const changes = generateFileChanges(nameStatus, numStat, null);
				expect(changes).toEqual([
					{ oldFilePath: 'added.ts', newFilePath: 'added.ts', type: GitFileStatus.Added, additions: 10, deletions: 0 },
					{ oldFilePath: 'mod.ts', newFilePath: 'mod.ts', type: GitFileStatus.Modified, additions: 5, deletions: 3 },
					{ oldFilePath: 'old.ts', newFilePath: 'new.ts', type: GitFileStatus.Renamed, additions: 20, deletions: 8 }
				]);
			});

			it('should override change type to Deleted if file is present in status.deleted', () => {
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

			it('should append new Deleted and Untracked entries from status', () => {
				const nameStatus = [
					{ type: GitFileStatus.Modified, oldFilePath: 'mod.ts', newFilePath: 'mod.ts' }
				];
				const status = {
					deleted: ['removed_outside_diff.ts'],
					untracked: ['fresh_untracked.ts']
				};
				const changes = generateFileChanges(nameStatus, [], status);
				expect(changes.length).toBe(3);
				expect(changes[1]).toEqual({
					oldFilePath: 'removed_outside_diff.ts',
					newFilePath: 'removed_outside_diff.ts',
					type: GitFileStatus.Deleted,
					additions: null,
					deletions: null
				});
				expect(changes[2]).toEqual({
					oldFilePath: 'fresh_untracked.ts',
					newFilePath: 'fresh_untracked.ts',
					type: GitFileStatus.Untracked,
					additions: null,
					deletions: null
				});
			});

			it('should normalise Windows backslashes in status paths during matching', () => {
				const nameStatus = [
					{ type: GitFileStatus.Modified, oldFilePath: 'src/file.ts', newFilePath: 'src/file.ts' }
				];
				const status = {
					deleted: ['src\\file.ts'],
					untracked: ['src\\untracked.ts']
				};
				const changes = generateFileChanges(nameStatus, [], status);
				expect(changes.length).toBe(2);
				expect(changes[0].type).toBe(GitFileStatus.Deleted);
				expect(changes[1].newFilePath).toBe('src/untracked.ts');
			});

			it('should safely ignore numstat records that do not match any file in nameStatus', () => {
				const nameStatus = [
					{ type: GitFileStatus.Modified, oldFilePath: 'file.ts', newFilePath: 'file.ts' }
				];
				const numStat = [
					{ filePath: 'unknown_file.ts', additions: 100, deletions: 50 }
				];
				const changes = generateFileChanges(nameStatus, numStat, null);
				expect(changes).toEqual([
					{ oldFilePath: 'file.ts', newFilePath: 'file.ts', type: GitFileStatus.Modified, additions: null, deletions: null }
				]);
			});
		});
	});

	// =========================================================================
	// 2. configParser Adversarial Tests
	// =========================================================================
	describe('configParser Adversarial Edge Cases', () => {

		describe('parseConfigList Edge Cases', () => {
			it('should return empty GitConfigSet for empty string or single trailing NUL', () => {
				expect(parseConfigList('')).toEqual({});
				expect(parseConfigList('\0')).toEqual({});
			});

			it('should parse standard key-value pairs', () => {
				const stdout = 'user.name\nJohn Doe\0user.email\njohn@test.com\0';
				const configs = parseConfigList(stdout);
				expect(configs).toEqual({
					'user.name': 'John Doe',
					'user.email': 'john@test.com'
				});
			});

			it('should preserve multiline configuration values', () => {
				const stdout = 'alias.loggraph\nlog --graph\n--oneline\n--all\0commit.template\n[Type]\n\nDescription\0';
				const configs = parseConfigList(stdout);
				expect(configs['alias.loggraph']).toBe('log --graph\n--oneline\n--all');
				expect(configs['commit.template']).toBe('[Type]\n\nDescription');
			});

			it('should normalize CRLF (Windows) and CR line endings in multiline config values', () => {
				const stdout = 'alias.ci\r\ncommit\r\n-v\r\n--amend\0alias.co\rcheckout\r-b\0';
				const configs = parseConfigList(stdout);
				expect(configs['alias.ci']).toBe('commit\n-v\n--amend');
				expect(configs['alias.co']).toBe('checkout\n-b');
			});

			it('should handle empty config values correctly as empty string', () => {
				const stdout = 'user.signingkey\n\0core.bare\nfalse\0';
				const configs = parseConfigList(stdout);
				expect(configs['user.signingkey']).toBe('');
				expect(configs['core.bare']).toBe('false');
			});

			it('should handle config entries with missing newline (key with empty value)', () => {
				const stdout = 'singlekey\0';
				const configs = parseConfigList(stdout);
				expect(configs['singlekey']).toBe('');
			});

			it('should handle special characters, unicode, spaces, and punctuation in keys and values', () => {
				const stdout = [
					'url.https://github.com/.insteadOf\ngit@github.com:',
					'user.name\n田中 太郎 🚀',
					'diff.tool\ncode --wait "$LOCAL" "$REMOTE"',
					''
				].join('\0');
				const configs = parseConfigList(stdout);
				expect(configs['url.https://github.com/.insteadOf']).toBe('git@github.com:');
				expect(configs['user.name']).toBe('田中 太郎 🚀');
				expect(configs['diff.tool']).toBe('code --wait "$LOCAL" "$REMOTE"');
			});

			it('should overwrite earlier values with later values for duplicate keys', () => {
				const stdout = 'remote.origin.fetch\n+refs/heads/*:refs/remotes/origin/*\0remote.origin.fetch\n+refs/tags/*:refs/tags/*\0';
				const configs = parseConfigList(stdout);
				expect(configs['remote.origin.fetch']).toBe('+refs/tags/*:refs/tags/*');
			});
		});

		describe('parseRepoConfigBranches Edge Cases', () => {
			it('should return empty object when no branch configuration keys exist', () => {
				expect(parseRepoConfigBranches({})).toEqual({});
				expect(parseRepoConfigBranches({ 'user.name': 'Alice', 'core.bare': 'false' })).toEqual({});
			});

			it('should parse branches with dots and slashes in their names', () => {
				const configs = {
					'branch.feature/1.0.0-rc.1.remote': 'origin',
					'branch.feature/1.0.0-rc.1.pushremote': 'upstream',
					'branch.release/v2.0.remote': 'origin'
				};
				const branches = parseRepoConfigBranches(configs);
				expect(branches).toEqual({
					'feature/1.0.0-rc.1': { remote: 'origin', pushRemote: 'upstream' },
					'release/v2.0': { remote: 'origin', pushRemote: null }
				});
			});

			it('should handle remote defined before pushRemote and vice-versa', () => {
				const configs1 = {
					'branch.main.remote': 'origin',
					'branch.main.pushremote': 'upstream'
				};
				const configs2 = {
					'branch.main.pushremote': 'upstream',
					'branch.main.remote': 'origin'
				};
				expect(parseRepoConfigBranches(configs1)).toEqual({
					main: { remote: 'origin', pushRemote: 'upstream' }
				});
				expect(parseRepoConfigBranches(configs2)).toEqual({
					main: { remote: 'origin', pushRemote: 'upstream' }
				});
			});

			it('should ignore other branch configuration properties (merge, rebase, etc.)', () => {
				const configs = {
					'branch.main.merge': 'refs/heads/main',
					'branch.main.rebase': 'true',
					'branch.main.remote': 'origin'
				};
				const branches = parseRepoConfigBranches(configs);
				expect(branches).toEqual({
					main: { remote: 'origin', pushRemote: null }
				});
			});
		});

		describe('getConfigValue Edge Cases', () => {
			it('should return string value when key exists', () => {
				const configs = { 'user.name': 'Test User', 'core.editor': 'vim' };
				expect(getConfigValue(configs, 'user.name')).toBe('Test User');
				expect(getConfigValue(configs, 'core.editor')).toBe('vim');
			});

			it('should return empty string when key exists with empty value (not null)', () => {
				const configs = { 'user.signingkey': '' };
				expect(getConfigValue(configs, 'user.signingkey')).toBe('');
			});

			it('should return null when key does not exist', () => {
				const configs = { 'user.name': 'Test User' };
				expect(getConfigValue(configs, 'missing.key')).toBeNull();
			});
		});
	});

	// =========================================================================
	// 3. signatureParser Adversarial Tests
	// =========================================================================
	describe('signatureParser Adversarial Edge Cases', () => {

		describe('parseTagSignature GPG Edge Cases', () => {
			it('should parse GOODSIG with TRUST_ULTIMATE as GoodAndValid', () => {
				const output = [
					'[GNUPG:] NEWSIG',
					'[GNUPG:] GOODSIG 1234567890ABCDEF Michael Hutchison <mhutchie@example.com>',
					'[GNUPG:] TRUST_ULTIMATE 0 pgp',
					''
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodAndValid,
					key: '1234567890ABCDEF',
					signer: 'Michael Hutchison <mhutchie@example.com>'
				});
			});

			it('should parse GOODSIG with TRUST_FULLY and TRUST_MARGINAL as GoodAndValid', () => {
				const fullyOutput = '[GNUPG:] GOODSIG K1 Signer One\n[GNUPG:] TRUST_FULLY 0 pgp\n';
				expect(parseTagSignature(fullyOutput).status).toBe(GitSignatureStatus.GoodAndValid);

				const marginalOutput = '[GNUPG:] GOODSIG K2 Signer Two\n[GNUPG:] TRUST_MARGINAL 0 pgp\n';
				expect(parseTagSignature(marginalOutput).status).toBe(GitSignatureStatus.GoodAndValid);
			});

			it('should degrade GOODSIG to GoodWithUnknownValidity under TRUST_UNDEFINED', () => {
				const output = [
					'[GNUPG:] NEWSIG',
					'[GNUPG:] GOODSIG 1234567890ABCDEF Unknown Signer <unknown@test.com>',
					'[GNUPG:] TRUST_UNDEFINED 0 pgp',
					''
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodWithUnknownValidity,
					key: '1234567890ABCDEF',
					signer: 'Unknown Signer <unknown@test.com>'
				});
			});

			it('should degrade GOODSIG to GoodWithUnknownValidity under TRUST_NEVER', () => {
				const output = [
					'[GNUPG:] NEWSIG',
					'[GNUPG:] GOODSIG 1234567890ABCDEF Untrusted Signer <untrusted@test.com>',
					'[GNUPG:] TRUST_NEVER 0 pgp',
					''
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodWithUnknownValidity,
					key: '1234567890ABCDEF',
					signer: 'Untrusted Signer <untrusted@test.com>'
				});
			});

			it('should parse BADSIG as Bad with key and signer UID', () => {
				const output = '[GNUPG:] BADSIG AABBCCDDEEFF0011 Forged Key <forger@evil.com>\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.Bad,
					key: 'AABBCCDDEEFF0011',
					signer: 'Forged Key <forger@evil.com>'
				});
			});

			it('should parse ERRSIG as CannotBeChecked with key and empty signer UID', () => {
				const output = '[GNUPG:] ERRSIG AABBCCDDEEFF0011 1 2 00 1600000000 9\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.CannotBeChecked,
					key: 'AABBCCDDEEFF0011',
					signer: ''
				});
			});

			it('should parse EXPSIG as GoodButExpired', () => {
				const output = '[GNUPG:] EXPSIG K1 Expired Signature Signer <exp@test.com>\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodButExpired,
					key: 'K1',
					signer: 'Expired Signature Signer <exp@test.com>'
				});
			});

			it('should parse EXPKEYSIG as GoodButMadeByExpiredKey', () => {
				const output = '[GNUPG:] EXPKEYSIG K1 Expired Key Signer <expkey@test.com>\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodButMadeByExpiredKey,
					key: 'K1',
					signer: 'Expired Key Signer <expkey@test.com>'
				});
			});

			it('should parse REVKEYSIG as GoodButMadeByRevokedKey', () => {
				const output = '[GNUPG:] REVKEYSIG K1 Revoked Key Signer <revkey@test.com>\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodButMadeByRevokedKey,
					key: 'K1',
					signer: 'Revoked Key Signer <revkey@test.com>'
				});
			});

			it('should return CannotBeChecked fallback when multiple signatures exist', () => {
				const output = [
					'[GNUPG:] GOODSIG K1 Signer One',
					'[GNUPG:] GOODSIG K2 Signer Two',
					'[GNUPG:] TRUST_ULTIMATE 0 pgp'
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.CannotBeChecked,
					key: '',
					signer: ''
				});
			});

			it('should return CannotBeChecked fallback when mixed signatures exist (GOODSIG followed by BADSIG)', () => {
				const output = [
					'[GNUPG:] GOODSIG K1 Signer One',
					'[GNUPG:] BADSIG K2 Signer Two'
				].join('\n');
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.CannotBeChecked,
					key: '',
					signer: ''
				});
			});

			it('should return CannotBeChecked fallback on empty input, non-GNUPG output, or missing signature status', () => {
				// Empty string
				expect(parseTagSignature('')).toEqual({ status: GitSignatureStatus.CannotBeChecked, key: '', signer: '' });
				// Output with GNUPG markers but no signature status code
				expect(parseTagSignature('[GNUPG:] NEWSIG\n[GNUPG:] VALIDSIG FFFF\n')).toEqual({
					status: GitSignatureStatus.CannotBeChecked,
					key: '',
					signer: ''
				});
				// Raw stderr error noise without [GNUPG:] prefix
				expect(parseTagSignature('gpg: Can\'t check signature: No public key\n')).toEqual({
					status: GitSignatureStatus.CannotBeChecked,
					key: '',
					signer: ''
				});
			});

			it('should handle Windows CRLF line endings in GNUPG raw output', () => {
				const output = '[GNUPG:] NEWSIG\r\n[GNUPG:] GOODSIG 1234ABCD Signer Name\r\n[GNUPG:] TRUST_ULTIMATE 0 pgp\r\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodAndValid,
					key: '1234ABCD',
					signer: 'Signer Name'
				});
			});

			it('should preserve unicode and special characters in signer UID', () => {
				const output = '[GNUPG:] GOODSIG K1 山田 太郎 🚀 (Work Key) <yamada@corp.jp>\n[GNUPG:] TRUST_ULTIMATE\n';
				const sig = parseTagSignature(output);
				expect(sig.signer).toBe('山田 太郎 🚀 (Work Key) <yamada@corp.jp>');
			});

			it('should handle malformed GNUPG status lines without throwing', () => {
				// Status line with no key or signer
				const output = '[GNUPG:] GOODSIG\n';
				const sig = parseTagSignature(output);
				expect(sig).toEqual({
					status: GitSignatureStatus.GoodAndValid,
					key: '',
					signer: ''
				});
			});
		});
	});

	// =========================================================================
	// 4. Performance & High Volume Stress Harness
	// =========================================================================
	describe('Performance & High Volume Stress Harness', () => {
		it('should parse and merge 10,000 diff records in under 100ms', () => {
			const nameStatusTokens: string[] = [];
			const numStatTokens: string[] = [];

			for (let i = 0; i < 10000; i++) {
				const path = `src/module_${i}/file_${i}.ts`;
				nameStatusTokens.push('M', path);
				numStatTokens.push(`${i % 50}\t${i % 20}\t${path}`);
			}
			nameStatusTokens.push('');
			numStatTokens.push('');

			const start = Date.now();
			const nameRecords = parseDiffNameStatus(nameStatusTokens);
			const numRecords = parseDiffNumStat(numStatTokens);
			const changes = generateFileChanges(nameRecords, numRecords, null);
			const elapsed = Date.now() - start;

			expect(nameRecords.length).toBe(10000);
			expect(numRecords.length).toBe(10000);
			expect(changes.length).toBe(10000);
			expect(changes[0].additions).toBe(0);
			expect(changes[1].additions).toBe(1);
			expect(elapsed).toBeLessThan(200);
		});

		it('should parse 10,000 config list records in under 100ms', () => {
			const pairs: string[] = [];
			for (let i = 0; i < 10000; i++) {
				pairs.push(`branch.feature_${i}.remote\norigin`);
			}
			const stdout = pairs.join('\0') + '\0';

			const start = Date.now();
			const configs = parseConfigList(stdout);
			const branches = parseRepoConfigBranches(configs);
			const elapsed = Date.now() - start;

			expect(Object.keys(configs).length).toBe(10000);
			expect(Object.keys(branches).length).toBe(10000);
			expect(branches['feature_0'].remote).toBe('origin');
			expect(elapsed).toBeLessThan(200);
		});

		it('should parse 5,000 tag signature outputs in under 100ms', () => {
			const rawSig = '[GNUPG:] NEWSIG\n[GNUPG:] GOODSIG 1234567890ABCDEF Signer Name <signer@test.com>\n[GNUPG:] TRUST_ULTIMATE 0 pgp\n';
			const start = Date.now();
			for (let i = 0; i < 5000; i++) {
				const sig = parseTagSignature(rawSig);
				expect(sig.status).toBe(GitSignatureStatus.GoodAndValid);
			}
			const elapsed = Date.now() - start;
			expect(elapsed).toBeLessThan(1000);
		});
	});
});
