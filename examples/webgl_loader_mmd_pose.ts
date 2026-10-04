import { initExample } from './scene.js';

export const ready = initExample( 'pose' );
// initExample reports failures in the page; avoid an unhandled rejection.
ready.catch( () => {} );
