import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectSource, setupSource, sources } from './private-models.ts';

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	try {

		const [ id, ...args ] = process.argv.slice( 2 );
		if ( id === '--list' && ! args.length ) {

			for ( const s of sources ) console.log( `${s.id}: ${s.name}\nOrigin: ${s.origin}\nPinned commit: ${s.commit} (${s.files.length} Git-blob-hashed files in scripts/model-sources.json)\n${s.license}\n${s.attribution}\nFeature categories (${s.inspection?.parser ?? 'inspect after setup'}): ${JSON.stringify( s.inspection?.features ?? {} )}. Re-inspected after setup; presence does not establish a visual test result.\n` );
			console.log( 'Protected/passworded/approval-gated sources (including BowlRoll candidates) are manual-only: use models:import after permitted local acquisition.' );

		} else {

			if ( ! id || args.some( a => a !== '--offline' ) ) throw new Error( 'Usage: npm run models:setup -- gene [--offline] | --list' );
			const source = selectSource( id );
			console.log( `${source.name}: ${source.license}\n${source.attribution}\nPreserving original README and usage guidelines; review locally before use.` );
			console.log( JSON.stringify( await setupSource( source, { offline: args.includes( '--offline' ) } ), null, 2 ) );
			console.log( 'Run npm run dev:sdef, open http://127.0.0.1:8081/local-sdef/, choose Gene in Installed models, review notices, and Load PMX. Generated fixtures remain available.' );

		}

	} catch ( error ) { console.error( String( error ) ); process.exitCode = 1; }

}
