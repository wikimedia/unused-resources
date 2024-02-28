'use strict';

const { exec } = require( 'child_process' );

// TODO: Instead of running a git command for each key, we could build a combined regex and do one search.
function gitSearch( string, fileFilter ) {
	return new Promise( ( resolve ) => {
		// TODO: This will false-positive on substring matches.
		// Should use a regex like we with file contents, but this
		// is very slow:
		// git log --pickaxe-regex -S"[^a-z-]${missingKey}[^a-z-]" ...
		const gitCommand = `git log -S"${ string }" --oneline --name-only --pretty=format:"%h%n%s" --`;

		// eslint-disable-next-line security/detect-child-process
		exec( gitCommand, ( error, stdout ) => {
			if ( error ) {
				resolve( null );
				return;
			}

			const results = stdout.trim().split( '\n\n' );

			results.some( ( result ) => {
				const lines = result.trim().split( '\n' );
				const commitHash = lines[ 0 ];
				const subject = lines[ 1 ];
				// Ignore i18n files
				const gitFiles = lines.slice( 2 ).filter( fileFilter );
				if ( !gitFiles.length ) {
					return false;
				}
				resolve( {
					commitHash,
					subject,
					files: gitFiles
				} );
				return true;
			} );
			resolve( null );
		} );
	} );
}

module.exports = {
	gitSearch
};
