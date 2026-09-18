const fs = require('fs');
const path = require('path');

function deleteFolderAndFiles(directory) {
	if (fs.existsSync(directory)) {
		fs.readdirSync(directory).forEach((fileName) => {
			if (fileName.startsWith('git_graph_wasm')) return;
			const fullPath = path.join(directory, fileName);
			if (fs.statSync(fullPath).isDirectory()) {
				// The entry is a folder, recursively delete its contents
				deleteFolderAndFiles(fullPath);
			} else {
				// The entry is a file, delete it
				fs.unlinkSync(fullPath);
			}
		});
		// If the directory is now empty, delete it.
		if (fs.readdirSync(directory).length === 0) {
			fs.rmdirSync(directory);
		}
	}
}

deleteFolderAndFiles('./media');
deleteFolderAndFiles('./out');
