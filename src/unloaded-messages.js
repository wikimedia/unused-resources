#!/usr/bin/env node

'use strict';

const fs = require( 'fs' );
const path = require( 'path' );
const glob = require( 'glob' );
const chalk = require( 'chalk' );

const repoRoot = process.cwd();
const extensionPath = path.join( repoRoot, 'extension.json' );

if ( !fs.existsSync( extensionPath ) ) {
	throw new Error( 'extension.json not found in repo root.' );
}

const extension = require( extensionPath );
const modules = extension.ResourceModules || extension.ResourceLoaderModules || {};

function getMessagesUsedInScript( scriptPath, messageKeys ) {
	if ( !fs.existsSync( scriptPath ) ) {
		return [];
	}
	const content = fs.readFileSync( scriptPath, 'utf8' );
	return messageKeys.filter( ( key ) => content.includes( key ) );
}

Object.entries( modules ).forEach( ( [ moduleName, moduleDef ] ) => {
	if ( moduleDef.veModules ) {
		// TODO: Support veModules
		// TODO: Support EditCheck autoloaded of /experimental
		return;
	}
	const messages = moduleDef.messages || [];
	const getScripts = ( moduleValue ) => typeof moduleValue === 'string' ? [ moduleValue ] : ( moduleValue || [] ).filter( ( p ) => typeof p === 'string' );
	const scripts = [
		...getScripts( moduleDef.scripts ),
		...getScripts( moduleDef.packageFiles )
	];

	if ( !messages.length || !scripts.length ) {
		return;
	}

	// Find all messages used in scripts
	const usedMessages = new Set();
	const allScriptMessages = new Set();
	let missingMessages = [];
	let extraMessages = [];

	scripts.forEach( ( script ) => {
		// Try to resolve script path
		let scriptPath = path.join( repoRoot, script );
		if ( !fs.existsSync( scriptPath ) ) {
			// Try glob if not found
			const matches = glob.sync( script, { cwd: repoRoot } );
			if ( matches.length ) {
				scriptPath = path.join( repoRoot, matches[ 0 ] );
			}
		}
		if ( !fs.existsSync( scriptPath ) ) {
			console.warn( chalk.yellow( `Script not found: ${ script } in module ${ moduleName }` ) );
			return;
		}
		// Find messages used in this script
		messages.forEach( ( msg ) => {
			if ( getMessagesUsedInScript( scriptPath, [ msg ] ).length ) {
				usedMessages.add( msg );
				allScriptMessages.add( msg );
			}
		} );
		// Also find any other message keys used (not just those listed)
		// Look for ve/mw.msg( 'key' ) or mw.message( 'key' )
		const content = fs.readFileSync( scriptPath, 'utf8' );
		const regex = /(?:ve|mw)\.(?:msg|message)\( *['"]([a-zA-Z0-9-_]+)['"] *\)/g;
		// TODO: Detect keys in comments, but don't confuse with CSS classes
		// "// * message-key"
		// const regex = /(?:(?:ve|mw)\.(?:msg|message)\( *['"]([a-zA-Z0-9-_]+)['"] *\)|\/\/ \* ([a-zA-Z0-9-_]+)$)/gm;
		let match;
		while ( ( match = regex.exec( content ) ) !== null ) {
			allScriptMessages.add( match[ 1 ] );
		}
	} );

	// Messages listed but not used
	missingMessages = messages.filter( ( msg ) => !usedMessages.has( msg ) );
	// Messages used but not listed
	extraMessages = Array.from( allScriptMessages ).filter( ( msg ) => !messages.includes( msg ) );

	if ( missingMessages.length || extraMessages.length ) {
		console.log( chalk.cyan( `\nResourceLoader module: ${ moduleName }` ) );
		if ( missingMessages.length ) {
			console.log( chalk.yellow( '  Messages loaded but not used in scripts:' ) );
			missingMessages.forEach( ( msg ) => console.log( `    - ${ msg }` ) );
		}
		if ( extraMessages.length ) {
			console.log( chalk.yellow( '  Messages used in scripts but not loaded:' ) );
			extraMessages.forEach( ( msg ) => console.log( `    - ${ msg }` ) );
		}
	}
} );

console.log( chalk.green( '\nCheck complete.' ) );
