#!/usr/bin/env node

'use strict';

const fs = require( 'fs' );
const glob = require( 'glob' );
const minimist = require( 'minimist' );
const path = require( 'path' );
const chalk = require( 'chalk' );
const less = require( 'less' );
const utils = require( './utils' );
const getConfig = require( './getConfig' );
const config = getConfig( 'css' );

const repoRoot = process.cwd();

const resourceFiles = config.resourceFiles ||
	[ '**/*.{css,less}' ].concat( config.extraResourceFiles || [] );
const sourceFiles = config.sourceFiles ||
	[ '**/*.{html,php,js,vue}' ].concat( config.extraSourceFiles || [] );
const ignoreFiles = config.ignoreFiles || [
	'**/node_modules/**',
	'**/build/**',
	'**/dist/**',
	'**/docs/**',
	'**/demos/**',
	'**/tests/**',
	'**/vendor/**',
	'**/coverage/**',
	'**/ve/lib/**'
].concat( config.extraIgnoreFiles || [] );

const args = minimist( process.argv.slice( 2 ) );
const git = args.git;

if ( !process.env.MW_INSTALL_PATH ) {
	console.warn( 'MW_INSTALL_PATH not defined' );
}

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
			paths: [ path.dirname( filePath ) ].concat(
				process.env.MW_INSTALL_PATH ?
					[
						path.resolve( process.env.MW_INSTALL_PATH, 'resources/src/mediawiki.less/mediawiki.ui/' ),
						path.resolve( process.env.MW_INSTALL_PATH, 'resources/src/mediawiki.less/' )
					] : []
			)
		} );
		return extractClassNames( output.css );
	} catch ( error ) {
		console.error( chalk.red( `Error processing LESS content: ${ error }` ) );
		return new Set();
	}
}

// Load and merge the CSS/LESS files from the repo root
console.log( 'Finding style files...' );
const styleFiles = glob.sync( resourceFiles, { ignore: ignoreFiles } );

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

	const classPatterns = {};
	Array.from( allClassNames ).forEach( ( className ) => {
		// eslint-disable-next-line security/detect-non-literal-regexp
		classPatterns[ className ] = new RegExp(
			'(?:^|[^-_a-zA-Z0-9])(' +
			className.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) +
			')(?:^|[^-_a-zA-Z0-9])', 'g' );
	} );

	function findClassesInSourceCode( fileContent ) {
		// Building a big regex is faster, but missing cases where one class is a substring of another:
		// // eslint-disable-next-line security/detect-non-literal-regexp
		// const messageKeysPattern = new RegExp( '(?:^|[^-_a-zA-Z0-9])(' + Array.from( allClassNames ).join( '|' ) + ')(?:$|[^-_a-zA-Z0-9])', 'g' );
		// // eslint-disable-next-line es-x/no-string-prototype-matchall
		// return Array.from( fileContent.matchAll( messageKeysPattern ), ( m ) => m[ 1 ] );
		return Array.from( allClassNames ).filter( ( className ) =>
			// Do a faster simple string check first...
			fileContent.includes( className ) &&
			classPatterns[ className ].test( fileContent )
		);
	}

	function checkContents( contents, classNames ) {
		const classesInSourceCode = findClassesInSourceCode( contents );
		classesInSourceCode.forEach( ( className ) => classNames.delete( className ) );
	}

	console.log( 'Searching code for CSS class names...' );
	// Check defined source files for class usage
	glob.sync( sourceFiles, { root: repoRoot, ignore: ignoreFiles } ).forEach( ( filePath ) => {
		// eslint-disable-next-line security/detect-non-literal-fs-filename
		const fileContent = fs.readFileSync( filePath, 'utf8' );
		checkContents( fileContent, allClassNames );
	} );

	function gitSearchFilter( file ) {
		return !file.endsWith( '.css' ) && !file.endsWith( '.less' );
	}

	const allClassNamesList = Array.from( allClassNames );

	if ( allClassNamesList.length ) {
		let gitPromise;
		if ( git ) {
			console.time( 'Searched git' );
			console.log( `Searching git history for ${ allClassNamesList.length } missing CSS classes...` );
			gitPromise = Promise.all( Array.from( allClassNamesList ).map( ( className ) => utils.gitSearch( className, gitSearchFilter ) ) );
		} else {
			gitPromise = Promise.resolve( null );
		}
		gitPromise.then( function ( gitInfos ) {
			if ( git ) {
				console.timeEnd( 'Searched git' );
			}
			console.log( chalk.yellow( `\nWarning: ${ allClassNamesList.length } unused CSS classes found:\n` ) );
			const classesByCommit = {};
			const gitInfoByHash = {};
			allClassNamesList.forEach( ( className, i ) => {
				console.log( chalk.yellow( `* ${ className }` ) );
				if ( gitInfos ) {
					const gitInfo = gitInfos[ i ];
					if ( gitInfo ) {
						console.log( '  last seen: ' + chalk.dim( gitInfo.commitHash ) );
						console.log( '    subject: ' + chalk.dim( gitInfo.subject ) );
						console.log( '      files: ' + chalk.dim( gitInfo.files.join( '\n             ' ) ) );
						classesByCommit[ gitInfo.commitHash ] = classesByCommit[ gitInfo.commitHash ] || [];
						classesByCommit[ gitInfo.commitHash ].push( className );
						gitInfoByHash[ gitInfo.commitHash ] = gitInfo;
					} else {
						console.log( chalk.red( '             not found in git history' ) );
					}
				}
			} );
			if ( Object.keys( classesByCommit ).length ) {
				console.log( 'Classes grouped by last-seen commit:\n' );
				Object.keys( classesByCommit ).forEach( function ( hash ) {
					console.log( chalk.yellow( `* ${ hash }` ) + ' ' + gitInfoByHash[ hash ].subject );
					classesByCommit[ hash ].forEach( function ( className ) {
						console.log( `   - ${ className }` );
					} );
				} );
			}
		} );
	} else {
		console.log( 'No unused CSS classes found.' );
	}

} )();
