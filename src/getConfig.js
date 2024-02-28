'use strict';

const fs = require( 'fs' );
const path = require( 'path' );

// Define path to the configuration file
const configPath = path.join( __dirname, '.unused-resources.json' );

let configData;

if ( fs.existsSync( configPath ) ) {
	configData = JSON.parse( fs.readFileSync( configPath, 'utf8' ) );
}

module.exports = function ( type ) {
	if ( !configData ) {
		return {};
	}
	return Object.assign( {}, configData.common, configData[ type ] );
};
