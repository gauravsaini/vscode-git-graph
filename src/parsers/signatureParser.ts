import { GitSignature, GitSignatureStatus, Writeable } from '../types';

const EOL_REGEX = /\r\n|\r|\n/g;

interface GpgStatusCodeParsingDetails {
	readonly status: GitSignatureStatus;
	readonly uid: boolean;
}

const GPG_STATUS_CODE_PARSING_DETAILS: Readonly<{ [statusCode: string]: GpgStatusCodeParsingDetails }> = {
	'GOODSIG': { status: GitSignatureStatus.GoodAndValid, uid: true },
	'BADSIG': { status: GitSignatureStatus.Bad, uid: true },
	'ERRSIG': { status: GitSignatureStatus.CannotBeChecked, uid: false },
	'EXPSIG': { status: GitSignatureStatus.GoodButExpired, uid: true },
	'EXPKEYSIG': { status: GitSignatureStatus.GoodButMadeByExpiredKey, uid: true },
	'REVKEYSIG': { status: GitSignatureStatus.GoodButMadeByRevokedKey, uid: true }
};

/**
 * Parse raw GPG signature verification output from `git verify-tag --raw`.
 * @param rawOutput The stdout or stderr string from `git verify-tag --raw`.
 * @returns A parsed GitSignature object.
 */
export function parseTagSignature(rawOutput: string): GitSignature {
	try {
		const lines = rawOutput.split(EOL_REGEX);
		const records: string[][] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith('[GNUPG:] ')) {
				records.push(lines[i].split(' '));
			}
		}

		let signature: Writeable<GitSignature> | null = null;
		let trustLevel: string | null = null;

		for (let i = 0; i < records.length; i++) {
			const statusCode = records[i][1];
			const parsingDetails = GPG_STATUS_CODE_PARSING_DETAILS[statusCode];
			if (parsingDetails) {
				if (signature !== null) {
					// Multiple signatures exist -> return fallback CannotBeChecked
					return {
						status: GitSignatureStatus.CannotBeChecked,
						key: '',
						signer: ''
					};
				}
				signature = {
					status: parsingDetails.status,
					key: records[i][2] || '',
					signer: parsingDetails.uid ? records[i].slice(3).join(' ') : ''
				};
			} else if (statusCode && statusCode.startsWith('TRUST_')) {
				trustLevel = statusCode;
			}
		}

		if (signature !== null && signature.status === GitSignatureStatus.GoodAndValid && (trustLevel === 'TRUST_UNDEFINED' || trustLevel === 'TRUST_NEVER')) {
			signature.status = GitSignatureStatus.GoodWithUnknownValidity;
		}

		if (signature !== null) {
			return signature;
		}
	} catch {
		// Fall through to default fallback
	}

	return {
		status: GitSignatureStatus.CannotBeChecked,
		key: '',
		signer: ''
	};
}
