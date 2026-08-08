/**
 * WordPress dependencies
 */
import { addFilter } from '@wordpress/hooks';

/**
 * Internal dependencies
 */
import customBlocks from './block-customization';

const removedBlockVariations = new Set< string >();
let isPageGlobalSetupComplete = false;
let isEmojiPatchInstalled = false;

/**
 * Install the Gutenberg registrations that cannot be scoped to one editor.
 *
 * These changes are intentionally one-way for the lifetime of the page:
 * block registration filters affect every later registration and core block
 * registration populates Gutenberg's shared block registry. Re-running this
 * function cannot add callbacks or registrations.
 */
export function ensurePageGlobalSetup() {
	if ( isPageGlobalSetupComplete ) {
		return;
	}

	addFilter( 'blocks.registerBlockType', 'blocks-everywhere/modify-blocks', customBlocks );

	const blockLibrary = window?.wp?.blockLibrary;
	if ( blockLibrary?.registerCoreBlocks && ! window.blocksEverywhereCoreBlocksRegistered ) {
		blockLibrary.registerCoreBlocks();
		window.blocksEverywhereCoreBlocksRegistered = true;
	}

	isPageGlobalSetupComplete = true;
}

function ensureEmojiPatchInstalled() {
	if ( isEmojiPatchInstalled || ! window?.twemoji?.parse ) {
		return;
	}

	const originalParse = window.twemoji.parse;
	window.twemoji.parse = ( object, args ) => {
		if ( object?.closest?.( '.blocks-everywhere--patch-emoji' ) ) {
			return object;
		}

		return originalParse( object, args );
	};
	isEmojiPatchInstalled = true;
}

/**
 * Apply settings whose Gutenberg APIs are page-global.
 *
 * Block variation removal is irreversible because Gutenberg has no scoped
 * variation allow-list. Each unique variation is removed at most once. The
 * twemoji replacement is installed once, but its behavior is limited to
 * containers for editor instances that explicitly enable `patchEmoji`.
 *
 * @param settings  Resolved settings for one editor instance.
 * @param container Editor container for instance-scoped emoji behavior.
 * @return Cleanup for reversible instance markers.
 */
export function applyPageGlobalEditorSettings( settings, container: HTMLElement ) {
	const disallowedVariations = settings?.blocksEverywhere?.blockVariations?.disallow;

	( Array.isArray( disallowedVariations ) ? disallowedVariations : [] ).forEach( ( variation ) => {
		const blockName = variation?.blockName || variation?.block;
		const variationName = variation?.variationName || variation?.name;
		if ( ! blockName || ! variationName ) {
			return;
		}

		const key = `${ blockName }/${ variationName }`;
		if ( removedBlockVariations.has( key ) ) {
			return;
		}

		window?.wp?.blocks?.unregisterBlockVariation?.( blockName, variationName );
		removedBlockVariations.add( key );
	} );

	if ( settings?.patchEmoji ) {
		ensureEmojiPatchInstalled();
		container?.classList?.add( 'blocks-everywhere--patch-emoji' );
	}

	return () => container?.classList?.remove( 'blocks-everywhere--patch-emoji' );
}
