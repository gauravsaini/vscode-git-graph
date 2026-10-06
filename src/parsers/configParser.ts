import { GitRepoConfigBranches } from '../types';

const EOL_REGEX = /\r\n|\r|\n/g;

export type GitConfigSet = { [key: string]: string };

/**
 * Parse git config list output formatted with -z into a key-value record.
 * @param stdout The NUL-delimited stdout from `git config --list -z --includes`.
 * @returns A set of key-value configuration records.
 */
export function parseConfigList(stdout: string): GitConfigSet {
	const configs: GitConfigSet = {};
	const keyValuePairs = stdout.split('\0');
	const numPairs = keyValuePairs.length - 1;
	for (let i = 0; i < numPairs; i++) {
		const comps = keyValuePairs[i].split(EOL_REGEX);
		const key = comps.shift();
		if (typeof key === 'string' && key.length > 0) {
			configs[key] = comps.join('\n');
		}
	}
	return configs;
}

/**
 * Parse branch configuration (remote and pushRemote) from local git config.
 * @param localConfigs The configuration records from local repository config.
 * @returns The parsed GitRepoConfigBranches map.
 */
export function parseRepoConfigBranches(localConfigs: GitConfigSet): GitRepoConfigBranches {
	const branches: GitRepoConfigBranches = {};
	const keys = Object.keys(localConfigs);
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		if (key.startsWith('branch.')) {
			if (key.endsWith('.remote')) {
				const branchName = key.substring(7, key.length - 7);
				branches[branchName] = {
					pushRemote: typeof branches[branchName] !== 'undefined' ? branches[branchName].pushRemote : null,
					remote: localConfigs[key]
				};
			} else if (key.endsWith('.pushremote')) {
				const branchName = key.substring(7, key.length - 11);
				branches[branchName] = {
					pushRemote: localConfigs[key],
					remote: typeof branches[branchName] !== 'undefined' ? branches[branchName].remote : null
				};
			}
		}
	}
	return branches;
}

/**
 * Get a specific configuration value from a GitConfigSet.
 * @param configs A set of key-value Git configuration records.
 * @param key The key of the desired configuration.
 * @returns The value for key if it exists, otherwise null.
 */
export function getConfigValue(configs: GitConfigSet, key: string): string | null {
	return typeof configs[key] !== 'undefined' ? configs[key] : null;
}
