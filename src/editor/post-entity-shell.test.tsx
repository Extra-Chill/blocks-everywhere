/**
 * WordPress dependencies
 */
import { EditorProvider } from '@wordpress/editor';
import { renderToString } from '@wordpress/element';

/**
 * Internal dependencies
 */
import PostEntityShell from './post-entity-shell';

const mockPost = { type: 'post', id: 42 };

jest.mock( '@wordpress/blocks', () => ( {} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
} ) );

jest.mock( '@wordpress/data', () => ( {
	useSelect: ( mapSelect ) =>
		mapSelect( () => ( {
			getEntityConfig: () => ( { kind: 'postType', name: 'post' } ),
			getEntityRecord: () => mockPost,
		} ) ),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	EditorProvider: jest.fn( () => null ),
	AutosaveMonitor: () => null,
	LocalAutosaveMonitor: () => null,
} ) );

it( 'disables the EditorProvider sub-registry when the canonical post is loaded', () => {
	const editorSettings = { allowedBlockTypes: [ 'core/paragraph' ] };

	renderToString(
		<PostEntityShell postEntity={ mockPost } editorSettings={ editorSettings }>
			{ () => null }
		</PostEntityShell>
	);

	expect( jest.mocked( EditorProvider ).mock.calls[ 0 ]?.[ 0 ] ).toEqual(
		expect.objectContaining( { post: mockPost, settings: editorSettings, useSubRegistry: false } )
	);
} );
