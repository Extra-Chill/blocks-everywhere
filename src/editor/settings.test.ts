/**
 * Internal dependencies
 */
import { resolveMountSettings } from './settings';

jest.mock( '@wordpress/rich-text', () => ( {
	store: 'core/rich-text',
} ) );

jest.mock( '@wordpress/data', () => ( {
	select: () => ( {
		getFormatTypes: () => [ { name: 'core/bold' }, { name: 'core/code' } ],
	} ),
} ) );

jest.mock( './services', () => ( {
	resolveEditorServices: () => ( {} ),
} ) );

function createSettings( overrides = {} ) {
	return {
		container: '.editor',
		editor: {},
		blocksEverywhere: {
			blocks: { allowBlocks: [ 'core/paragraph' ] },
		},
		...overrides,
	};
}

describe( 'resolveMountSettings', () => {
	it( 'keeps conflicting consumer restrictions isolated', () => {
		const first = resolveMountSettings(
			createSettings( {
				allowUrlEmbed: false,
				pastePlainText: true,
				replaceParagraphCode: true,
			} )
		);
		const second = resolveMountSettings(
			createSettings( {
				allowUrlEmbed: true,
				blocksEverywhere: {
					blocks: { allowBlocks: [ 'core/paragraph', 'core/heading' ] },
				},
			} )
		);

		expect( first.editor.allowedBlockTypes ).toEqual( [ 'core/paragraph' ] );
		expect( first.editor.blocksEverywhere ).toEqual( {
			allowHeading: false,
			allowUrlEmbed: false,
			allowedFormats: [ 'core/bold' ],
			pastePlainText: true,
			replaceParagraphCode: true,
		} );
		expect( second.editor.allowedBlockTypes ).toEqual( [ 'core/paragraph', 'core/heading' ] );
		expect( second.editor.blocksEverywhere ).toEqual( {
			allowHeading: true,
			allowUrlEmbed: true,
			allowedFormats: [ 'core/bold' ],
			pastePlainText: false,
			replaceParagraphCode: false,
		} );
	} );
} );
