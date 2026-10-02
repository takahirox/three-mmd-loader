const panel = document.getElementById( 'panel' );
const navigation = document.getElementById( 'contentWrapper' );
const expandButton = document.getElementById( 'expandButton' );
const viewerArea = document.getElementById( 'viewerArea' );
const viewer = document.getElementById( 'viewer' );
const placeholder = document.getElementById( 'placeholder' );
const narrow = window.matchMedia( '(max-width: 640px)' );
const cards = new Map( [ ...document.querySelectorAll( '[data-example]' ) ].map( card => [ card.dataset.example, card ] ) );
let selected = null;

function updatePanel() {

	const expanded = ! narrow.matches || panel.classList.contains( 'open' );
	expandButton.setAttribute( 'aria-expanded', String( expanded ) );
	navigation.inert = ! expanded;
	viewerArea.inert = narrow.matches && expanded;

}

function setPanelOpen( open ) {

	panel.classList.toggle( 'open', open );
	updatePanel();

}

function restoreSelection() {

	// Resolve only the three known examples, never a URL supplied by the hash.
	const hash = window.location.hash.slice( 1 );
	const id = cards.has( hash ) ? hash : null;
	for ( const [ name, card ] of cards ) {

		card.classList.toggle( 'selected', name === id );
		const link = card.querySelector( 'a' );
		if ( name === id ) link.setAttribute( 'aria-current', 'page' );
		else link.removeAttribute( 'aria-current' );

	}
	if ( id !== selected ) {

		// Keep one history entry per hash change. Assigning iframe.src would
		// add a second entry to the browser's joint session history.
		const href = id ? cards.get( id ).querySelector( 'a' ).href : 'about:blank';
		viewer.contentWindow.location.replace( href );

	}
	selected = id;
	viewer.hidden = id === null;
	placeholder.hidden = id !== null;
	viewer.title = id ? cards.get( id ).querySelector( '.title' ).textContent : 'Selected MMD example';
	setPanelOpen( id === null );

}

for ( const [ id, card ] of cards ) {

	card.querySelector( 'a' ).addEventListener( 'click', event => {

		if ( event.button !== 0 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ) return;
		event.preventDefault();
		window.location.hash = id;
		restoreSelection();
		viewer.focus();

	} );

}

expandButton.addEventListener( 'click', () => setPanelOpen( ! panel.classList.contains( 'open' ) ) );
function closePanel() {

	setPanelOpen( false );
	expandButton.focus();

}

document.getElementById( 'closeButton' ).addEventListener( 'click', closePanel );
document.getElementById( 'panelScrim' ).addEventListener( 'click', closePanel );
document.addEventListener( 'keydown', event => {

	if ( event.key === 'Escape' && narrow.matches && panel.classList.contains( 'open' ) ) closePanel();

} );
narrow.addEventListener( 'change', updatePanel );
window.addEventListener( 'hashchange', restoreSelection );
restoreSelection();
