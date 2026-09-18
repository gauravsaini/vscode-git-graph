const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../../crates/git-graph-wasm/pkg-no-modules');
const destDir = path.join(__dirname, '../media');

if (!fs.existsSync(destDir)) {
	fs.mkdirSync(destDir, { recursive: true });
}

const files = ['git_graph_wasm.js', 'git_graph_wasm_bg.wasm'];
for (const file of files) {
	const srcPath = path.join(srcDir, file);
	const destPath = path.join(destDir, file);
	if (fs.existsSync(srcPath)) {
		fs.copyFileSync(srcPath, destPath);
		console.log(`Copied ${file} -> media/${file}`);
	} else {
		console.warn(`Source file not found: ${srcPath}`);
	}
}
