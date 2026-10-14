import { initExample } from './scene.js';

export const ready = initExample( 'gene', { physicsMode: 'sync' } );
ready.catch( () => {} );
