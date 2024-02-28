#!/usr/bin/env node

'use strict';

const fs = require( 'fs' );
const glob = require( 'glob' );
const path = require( 'path' );
const chalk = require( 'chalk' );
const less = require( 'less' );

const repoRoot = process.cwd();

// Update the pattern to include LESS files
const styleFilesPattern = '**/*.{css,less}';
const sourceCodePattern = '**/*.{html,php,js,vue}';
const ignore = [
	'**/node_modules/**',
	'**/build/**',
	'**/dist/**',
	'**/docs/**',
	'**/demos/**',
	'**/tests/**',
	'**/vendor/**',
	'**/coverage/**',
	'**/ve/lib/**'
];

// Function to extract class names from CSS content
function extractClassNames( cssContent ) {
	const classNames = new Set();
	const classRegex = /\.([-_a-zA-Z0-9]+)[\s{[,.:#]/g;
	let match;

	while ( ( match = classRegex.exec( cssContent ) ) !== null ) {
		classNames.add( match[ 1 ] );
	}

	return classNames;
}

// Function to process LESS content
async function processLessContent( lessContent, filePath ) {
	try {
		const output = await less.render( lessContent, {
			paths: [
				path.dirname( filePath ),
				'/var/www/MediaWiki/core/resources/src/mediawiki.less/mediawiki.ui/',
				'/var/www/MediaWiki/core/resources/src/mediawiki.less/'
			]
		} );
		return extractClassNames( output.css );
	} catch ( error ) {
		console.error( chalk.red( `Error processing LESS content: ${error}` ) );
		return new Set();
	}
}

// Load and merge the CSS/LESS files from the repo root
console.log( 'Finding style files...' );
const styleFiles = glob.sync( styleFilesPattern, { ignore: ignore } );

const allClassNames = new Set();

( async () => {
	for ( const styleFile of styleFiles ) {
		const styleFilePath = path.join( repoRoot, styleFile );
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const styleContent = fs.readFileSync( styleFilePath, 'utf8' );
		let classNames;

		if ( path.extname( styleFile ) === '.less' ) {
			classNames = await processLessContent( styleContent, styleFile );
			console.log( styleFile );
		} else {
			classNames = extractClassNames( styleContent );
		}

		classNames.forEach( ( className ) => {
			if (
				!className.startsWith( 'oo-ui-' ) &&
				// !className.startsWith( 'mw-' ) &&
				!/^[0-9]/.test( className )
			) {
				allClassNames.add( className );
			}
		} );
	}

	console.log( 'Searching code for CSS class names...' );
	// Search for source files using glob pattern
	const files = glob.sync(
		sourceCodePattern,
		{
			root: repoRoot,
			ignore: ignore
		}
	);

	function findClassesInSourceCode( fileContent ) {
		// eslint-disable-next-line security/detect-non-literal-regexp
		const messageKeysPattern = new RegExp( '(?:^|[^-_a-zA-Z0-9])(' + Array.from( allClassNames ).join( '|' ) + ')(?:$|[^-_a-zA-Z0-9])', 'g' );
		// eslint-disable-next-line es-x/no-string-prototype-matchall
		return Array.from( fileContent.matchAll( messageKeysPattern ), ( m ) => m[ 1 ] );
	}

	function checkContents( contents, classNames ) {
		const classesInSourceCode = findClassesInSourceCode( contents );
		classesInSourceCode.forEach( ( className ) => classNames.delete( className ) );
	}

	// Check defined source files for class usage
	files.forEach( ( filePath ) => {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const fileContent = fs.readFileSync( filePath, 'utf8' );
		checkContents( fileContent, allClassNames );
	} );

	const { exec } = require( 'child_process' );

	// Function to search the entire Git repository for a missing message key using the pickaxe option
	function findKeyInGitHistory( missingKey ) {
		return new Promise( ( resolve ) => {
			// TODO: This will false-positive on substring matches.
			// Should use a regex like we with file contents, but this
			// is very slow:
			// git log --pickaxe-regex -S"[^a-z-]${missingKey}[^a-z-]" ...
			const gitCommand = `git log -S"${missingKey}" --oneline --name-only --pretty=format:"%h%n%s" --`;

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
					const gitFiles = lines.slice( 2 ).filter(
						( file ) => !file.endsWith( '.css' ) && !file.endsWith( '.less' )
					);
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

	if ( allClassNames.size > 0 ) {
		console.log( chalk.yellow( `\nWarning: ${allClassNames.size} unused CSS classes found:\n` ) );
		allClassNames.forEach( ( className ) => {
			console.log( chalk.yellow( `* .${className}` ) );
			findKeyInGitHistory( className ).then( ( result ) => console.log( className, result ) );
		} );
	} else {
		console.log( 'No unused CSS classes found.' );
	}

} )();
