#!/usr/bin/env node

'use strict';

const fs = require( 'fs' );
const glob = require( 'glob' );
const minimist = require( 'minimist' );
const path = require( 'path' );
const chalk = require( 'chalk' );
const utils = require( './utils' );
const getConfig = require( './getConfig' );
const config = getConfig( 'messages' );

const repoRoot = process.cwd();

const resourceFiles = config.resourceFiles ||
	[ '**/en.json' ].concat( config.extraResourceFiles || [] );
const sourceFiles = config.sourceFiles ||
	[ '**/{src,resources,rebaser,includes,modules}/**/*.{js,php,vue,html}', '**/{extension,skin}.json' ].concat( config.extraSourceFiles || [] );
const ignoreFiles = config.ignoreFiles || [
	'**/node_modules/**',
	'**/build/**',
	'**/dist/**',
	'**/docs/**',
	'**/demos/**',
	'**/tests/**',
	'**/vendor/**',
	'**/coverage/**',
	'**/lib/**'
].concat( config.extraIgnoreFiles || [] );

const args = minimist( process.argv.slice( 2 ) );
const git = args.git;

// Load and merge the message files from the repo root
const messages = {};
const messagesQqq = {};

let allMessageValues = '';

console.log( 'Finding i18n files...' );
glob.sync( resourceFiles, { ignore: ignoreFiles } ).forEach( ( messageFile ) => {
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
		if ( extension.TrackingCategories ) {
			extension.TrackingCategories.forEach(
				( category ) => {
					generatedMessages.push( category + '-desc' );
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

console.log( 'Searching code for message keys...' );
console.time( 'Searched code' );
glob.sync( sourceFiles, { root: repoRoot, ignore: ignoreFiles } ).forEach( ( filePath ) => {
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

function gitSearchFilter( file ) {
	// JSON i18n
	return !file.endsWith( '.json' ) &&
		// Old .i18n.php files
		!file.endsWith( 'i18n.php' );
}

if ( messageKeys.length > 0 ) {
	let gitPromise;
	if ( git ) {
		console.time( 'Searched git' );
		console.log( `Searching git history for ${ messageKeys.length } missing message keys...` );
		gitPromise = Promise.all( messageKeys.map( ( key ) => utils.gitSearch( key, gitSearchFilter ) ) );
	} else {
		gitPromise = Promise.resolve( null );
	}
	gitPromise.then( function ( gitInfos ) {
		if ( git ) {
			console.timeEnd( 'Searched git' );
		}
		console.log( chalk.yellow( `\nWarning: ${ messageKeys.length } unused or undocumented keys found (out of ${ totalMessages }):\n` ) );
		const messagesByCommit = {};
		const gitInfoByHash = {};
		messageKeys.forEach( ( key, i ) => {
			console.log( chalk.yellow( `* ${ key }` ) );
			console.log( '         en: ' + chalk.dim( `${ messages[ key ].replace( /\n/g, '\n             ' ) }` ) );
			console.log( '        qqq: ' + chalk.dim( `${ ( messagesQqq[ key ] || '' ).replace( /\n/g, '\n             ' ) }` ) );
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
				console.log( chalk.yellow( `* ${ hash }` ) + ' ' + gitInfoByHash[ hash ].subject );
				messagesByCommit[ hash ].forEach( function ( key ) {
					console.log( `   - ${ key }` );
				} );
			} );
		}
	} );
} else {
	console.log( `All ${ totalMessages } keys are used or documented in the source code.` );
}
