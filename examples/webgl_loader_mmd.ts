import { initExample } from './scene.js';

export const ready = initExample( 'animation', { physicsMode: 'sync' } );
// initExample reports failures in the page; avoid an unhandled rejection.
ready.catch( () => {} );
