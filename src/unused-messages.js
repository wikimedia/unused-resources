#!/usr/bin/env node

'use strict';

const fs = require( 'fs' );
const glob = require( 'glob' );
const minimist = require( 'minimist' );
const path = require( 'path' );
const chalk = require( 'chalk' );

const repoRoot = process.cwd();

const args = minimist( process.argv.slice( 2 ) );
const messageFilesPattern = args.messageFilesPattern || '**/en.json';
const sourceCodePattern = args.sourceCodePattern || [ '**/{src,resources,rebaser,includes,modules}/**/*.{js,php,vue,html}', '**/{extension,skin}.json' ];
const ignore = args.ignore || [
	'**/node_modules/**',
	'**/build/**',
	'**/dist/**',
	'**/docs/**',
	'**/demos/**',
	'**/tests/**',
	'**/vendor/**',
	'**/coverage/**',
	'**/lib/**'
];
const noGit = args.nogit;

// Load and merge the message files from the repo root
const messages = {};
const messagesQqq = {};

console.log( 'Finding i18n files...' );
const messageFiles = glob.sync( messageFilesPattern, { ignore: ignore } );

let allMessageValues = '';

messageFiles.forEach( ( messageFile ) => {
	const messageFilePath = path.join( repoRoot, messageFile );
	// eslint-disable-next-line security/detect-non-literal-require
	const messageData = require( messageFilePath );
	Object.assign( messages, messageData );
	allMessageValues += Object.values( messages ).join( '\n' );

	// eslint-disable-next-line security/detect-non-literal-require
	const messageDataQqq = require( messageFilePath.replace( 'en.json', 'qqq.json' ) );
	Object.assign( messagesQqq, messageDataQqq );
} );

const generatedMessages = [];
[ 'extension.json', 'skin.json' ].forEach( ( file ) => {
	const extensionPath = path.join( repoRoot, file );
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	if ( fs.existsSync( extensionPath ) ) {
		// eslint-disable-next-line security/detect-non-literal-require
		const extension = require( extensionPath );

		if ( extension.AvailableRights ) {
			extension.AvailableRights.forEach( ( right ) => {
				generatedMessages.push( 'right-' + right );
				generatedMessages.push( 'action-' + right );
			} );
		}
		if ( extension.GrantPermissions ) {
			Object.keys( extension.GrantPermissions ).forEach(
				( right ) => {
					generatedMessages.push( 'grant-' + right );
				}
			);
		}
		if ( extension.GroupPermissions ) {
			// Many of these will be existing groups, but that's ok
			Object.keys( extension.GroupPermissions ).forEach(
				( group ) => {
					generatedMessages.push( 'group-' + group );
					generatedMessages.push( 'group-' + group + '-member' );
					generatedMessages.push( 'grouppage-' + group );
					generatedMessages.push( 'group-' + group + '.js' );
					generatedMessages.push( 'group-' + group + '.css' );
				}
			);
		}
		if ( extension.SpecialPages ) {
			Object.keys( extension.SpecialPages ).forEach(
				( specialPage ) => {
					generatedMessages.push( specialPage.toLowerCase() );
				}
			);
		}
		if ( extension.LogTypes ) {
			extension.LogTypes.forEach(
				( type ) => {
					generatedMessages.push( 'log-name-' + type );
					generatedMessages.push( 'log-description-' + type );
					generatedMessages.push( 'logeventslist-' + type + '-log' );
				}
			);
		}
		if ( extension.ActionFilteredLogs ) {
			Object.keys( extension.ActionFilteredLogs ).forEach( ( type ) => {
				generatedMessages.push( 'log-action-filter-' + type );
				Object.values( extension.ActionFilteredLogs[ type ] ).forEach(
					( action ) => {
						generatedMessages.push( 'log-action-filter-' + type + '-' + action );
						generatedMessages.push( 'logentry-' + type + '-' + action );
					}
				);
			} );
		}
	}
} );

// Collect all message keys from the message file
const messageKeys = Object.keys( messages )
	.filter( ( key ) =>
		// e.g. @metadata is ignored
		!key.startsWith( '@' ) &&
		// Some MW messages are consistently generated, and
		// are easy to search for usages
		!key.startsWith( 'tag-' ) &&
		!key.startsWith( 'apihelp-' )
	);

const totalMessages = messageKeys.length;

const messageKeyPatterns = {};
messageKeys.forEach( ( key ) => {
	// eslint-disable-next-line security/detect-non-literal-regexp
	messageKeyPatterns[ key ] = new RegExp(
		'(?:^|[^a-z-_])(' +
		key.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) +
		')(?:$|[^a-z-_])', 'g' );
} );

function findKeysInSourceCode( fileContent ) {
	// Building a big regex is faster, but missing cases where one message key is a substring of another:
	// const messageKeysEscaped = messageKeys.map( ( key ) => key.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) );
	// // eslint-disable-next-line security/detect-non-literal-regexp
	// const messageKeysPattern = new RegExp( '(?:^|[^a-z-_])(' + messageKeysEscaped.join( '|' ) + ')(?:$|[^a-z-_])', 'g' );
	// // eslint-disable-next-line es-x/no-string-prototype-matchall
	// return Array.from( fileContent.matchAll( messageKeysPattern ), ( m ) => m[ 1 ] );
	return messageKeys.filter( ( key ) =>
		// Do a faster simple string check first...
		fileContent.includes( key ) &&
		messageKeyPatterns[ key ].test( fileContent )
	);
}

console.log( 'Searching code for message keys...' );
// Search for JavaScript files using glob pattern
const files = glob.sync(
	sourceCodePattern,
	{
		root: repoRoot,
		ignore: ignore
	}
);

function checkContents( contents ) {
	const keysInSourceCode = findKeysInSourceCode( contents );

	// Mark keys as found
	keysInSourceCode.forEach( ( key ) => {
		const index = messageKeys.indexOf( key );
		if ( index !== -1 ) {
			messageKeys.splice( index, 1 );
		}
	} );
}

console.time( 'Searched code' );
// Check defined source files
files.forEach( ( filePath ) => {
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	if ( fs.lstatSync( filePath ).isDirectory() ) {
		// Some directories may end .js etc
		return;
	}
	// eslint-disable-next-line security/detect-non-literal-fs-filename
	const fileContent = fs.readFileSync( filePath, 'utf8' );
	checkContents( fileContent );
} );

// Also check messages values, as messages can transclude other messages
checkContents( allMessageValues );

// Check messages generated by extension.json
checkContents( generatedMessages.join( '  ' ) );
console.timeEnd( 'Searched code' );

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
				// Ignore i18n files
				const gitFiles = lines.slice( 2 ).filter(
					// JSON i18n
					( file ) => !file.endsWith( '.json' ) &&
					// Old .i18n.php files
					!file.endsWith( 'i18n.php' )
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

if ( messageKeys.length > 0 ) {
	console.time( 'Searched git' );
	console.log( `Searching git history for ${messageKeys.length} missing message keys...` );
	// TODO: Instead of running a git command for each key, we should build
	// a combined regex and do one search, like we do with file contents.
	const gitPromise = noGit ? Promise.resolve( null ) : Promise.all( messageKeys.map( findKeyInGitHistory ) );
	gitPromise.then( function ( gitInfos ) {
		console.timeEnd( 'Searched git' );
		console.log( chalk.yellow( `\nWarning: ${messageKeys.length} unused or undocumented keys found (out of ${totalMessages}):\n` ) );
		const messagesByCommit = {};
		const gitInfoByHash = {};
		messageKeys.forEach( ( key, i ) => {
			console.log( chalk.yellow( `* ${key}` ) );
			console.log( '         en: ' + chalk.dim( `${messages[ key ].replace( /\n/g, '\n             ' )}` ) );
			console.log( '        qqq: ' + chalk.dim( `${( messagesQqq[ key ] || '' ).replace( /\n/g, '\n             ' )}` ) );
			if ( gitInfos ) {
				const gitInfo = gitInfos[ i ];
				if ( gitInfo ) {
					console.log( '  last seen: ' + chalk.dim( gitInfo.commitHash ) );
					console.log( '    subject: ' + chalk.dim( gitInfo.subject ) );
					console.log( '      files: ' + chalk.dim( gitInfo.files.join( '\n             ' ) ) );
					messagesByCommit[ gitInfo.commitHash ] = messagesByCommit[ gitInfo.commitHash ] || [];
					messagesByCommit[ gitInfo.commitHash ].push( key );
					gitInfoByHash[ gitInfo.commitHash ] = gitInfo;
				} else {
					console.log( chalk.red( '             not found in git history' ) );
				}
			}
		} );
		if ( Object.keys( messagesByCommit ).length ) {
			console.log( 'Messages grouped by last-seen commit:\n' );
			Object.keys( messagesByCommit ).forEach( function ( hash ) {
				console.log( chalk.yellow( `* ${hash}` ) + ' ' + gitInfoByHash[ hash ].subject );
				messagesByCommit[ hash ].forEach( function ( key ) {
					console.log( `   - ${key}` );
				} );
			} );
		}
		// eslint-disable-next-line no-process-exit
		process.exit( 1 );
	} );
} else {
	console.log( `All ${totalMessages} keys are used or documented in the source code.` );
}
