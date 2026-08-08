/**
 * WordPress dependencies
 */
import { addFilter } from '@wordpress/hooks';

jest.mock( '@wordpress/hooks', () => ( {
	addFilter: jest.fn(),
} ) );

jest.mock( './block-customization', () => jest.fn() );

function loadSetupModule() {
	let setupModule;
	jest.isolateModules( () => {
		setupModule = require( './page-global-setup' );
	} );
	return setupModule;
}

describe( 'page-global editor setup', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		delete window.blocksEverywhereCoreBlocksRegistered;
	} );

	it( 'installs shared registrations only once', () => {
		const registerCoreBlocks = jest.fn();
		window.wp = { blockLibrary: { registerCoreBlocks } } as typeof wp;
		const { ensurePageGlobalSetup } = loadSetupModule();

		ensurePageGlobalSetup();
		ensurePageGlobalSetup();

		expect( addFilter ).toHaveBeenCalledTimes( 1 );
		expect( registerCoreBlocks ).toHaveBeenCalledTimes( 1 );
		expect( window.blocksEverywhereCoreBlocksRegistered ).toBe( true );
	} );

	it( 'deduplicates irreversible effects across conflicting attach cycles', () => {
		const unregisterBlockVariation = jest.fn();
		const originalEmojiParse = jest.fn( ( object ) => object );
		window.wp = { blocks: { unregisterBlockVariation } } as typeof wp;
		window.twemoji = { parse: originalEmojiParse };
		const { applyPageGlobalEditorSettings } = loadSetupModule();
		const firstContainer = document.createElement( 'div' );
		const secondContainer = document.createElement( 'div' );
		const sharedVariation = { blockName: 'core/paragraph', variationName: 'shared' };
		const firstSettings = {
			patchEmoji: true,
			blocksEverywhere: { blockVariations: { disallow: [ sharedVariation ] } },
		};
		const secondSettings = {
			patchEmoji: false,
			blocksEverywhere: {
				blockVariations: {
					disallow: [ sharedVariation, { blockName: 'core/heading', variationName: 'second' } ],
				},
			},
		};

		const cleanupFirst = applyPageGlobalEditorSettings( firstSettings, firstContainer );
		const patchedEmojiParse = window.twemoji.parse;
		const cleanupSecond = applyPageGlobalEditorSettings( secondSettings, secondContainer );
		cleanupFirst();
		cleanupSecond();
		const cleanupReattached = applyPageGlobalEditorSettings( firstSettings, firstContainer );

		expect( unregisterBlockVariation ).toHaveBeenCalledTimes( 2 );
		expect( window.twemoji.parse ).toBe( patchedEmojiParse );
		expect( firstContainer.classList.contains( 'blocks-everywhere--patch-emoji' ) ).toBe( true );
		expect( secondContainer.classList.contains( 'blocks-everywhere--patch-emoji' ) ).toBe( false );

		cleanupReattached();
		expect( firstContainer.classList.contains( 'blocks-everywhere--patch-emoji' ) ).toBe( false );
	} );
} );
