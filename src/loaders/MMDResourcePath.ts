/** Resolve PMD/PMX resource names without changing parsed filenames or asset bytes. */
export function resolveMMDResourcePath( resourcePath: string | undefined, filePath: string ): string {

	const invalid = () => new Error( 'THREE.MMDLoader: Unsafe relative texture path ' + JSON.stringify( filePath ) );
	if ( ! filePath || /[\u0000-\u001f\u007f]/.test( filePath ) || /^[a-z]:/i.test( filePath ) || filePath.startsWith( '\\' ) ) throw invalid();

	// Explicit URL references are already URLs, not Windows resource filenames.
	if ( /^[a-z][a-z\d+.-]*:/i.test( filePath ) || filePath.startsWith( '//' ) ) {

		try {

			const url = filePath.startsWith( '//' ) ? new URL( filePath, 'https://mmd.invalid/' ) : new URL( filePath );
			if ( url.protocol !== 'data:' && filePath.includes( '\\' ) ) throw invalid();
			return filePath;

		} catch { throw invalid(); }

	}

	const rooted = filePath.startsWith( '/' );
	const segments: string[] = [];
	for ( const segment of filePath.replaceAll( '\\', '/' ).split( '/' ) ) {

		if ( ! segment ) continue;
		let decoded: string;
		try { decoded = decodeURIComponent( segment ); } catch { throw invalid(); }

		// Inspect nested escapes for separators, controls and traversal only.
		// A decoded literal percent may precede non-UTF-8 bytes (e.g. %25FF);
		// only the first decoding validates UTF-8, and only it affects the URL.
		let checked = decoded;
		while ( true ) {

			if ( /[\\/\u0000-\u001f\u007f]/.test( checked ) ) throw invalid();
			if ( checked === '.' || checked === '..' || ! /%[\da-f]{2}/i.test( checked ) ) break;
			checked = checked.replace( /%([\da-f]{2})/gi, ( _, hex: string ) => String.fromCharCode( parseInt( hex, 16 ) ) );

		}

		if ( checked === '.' || checked === '..' ) {

			// Nested encoded dots must never acquire a different server meaning.
			if ( decoded !== checked ) throw invalid();
			if ( checked === '..' && ! segments.pop() ) throw invalid();
			continue;

		}

		// Canonicalize equivalent escaped/unescaped names, encoding filename
		// query/fragment delimiters, Unicode and spaces exactly once.
		try { segments.push( encodeURIComponent( decoded ) ); } catch { throw invalid(); }

	}

	if ( ! segments.length ) throw invalid();
	const relative = segments.join( '/' );
	if ( rooted ) return '/' + relative;
	return resourcePath ? resourcePath.replace( /\/+$/, '' ) + '/' + relative : relative;

}
