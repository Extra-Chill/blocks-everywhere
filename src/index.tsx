/**
 * WordPress dependencies
 */

import domReady from '@wordpress/dom-ready';

/**
 * Internal dependencies
 */

import mountEditor, { unmountEditor } from './editor';
import { registerSlotFill } from './editor/slot-fills';
import { getBootstrapSetting, getRegisteredBootstrapSettings, registerBootstrapSettings } from './bootstrap-settings';
import { ensurePageGlobalSetup } from './page-global-setup';
import './styles/style.scss';

// Back-compat alias for dynamic editor initialization.
( window as any ).blocksEverywhereCreateEditor = mountEditor;

/**
 * Get the content API for an editor instance by its textarea element.
 *
 * The ContentBridge component (rendered inside each editor instance) attaches
 * a content API object to the textarea. This function provides a clean
 * lookup without consumers needing to know the internal property name.
 *
 * @param {HTMLTextAreaElement} textarea The textarea element the editor was created from.
 * @return {import('./editor/content-bridge').BlocksEverywhereContentApi|null} Content API for the editor instance.
 *
 * @example
 *   const api = window.blocksEverywhereGetContentApi( myTextarea );
 *   if ( api ) {
 *       api.replaceContent( '<p>Hello world</p>' );
 *       const html = api.getContent();
 *   }
 */
const getContentApi = ( textarea: HTMLTextAreaElement ) => {
	return textarea?.__blocksEverywhereContentApi ?? null;
};

( window as any ).blocksEverywhereGetContentApi = getContentApi;

/**
 * Public namespace for Blocks Everywhere host-page integration APIs.
 *
 * Currently exposes:
 *   - mountEditor( textarea, options? ) — mount a dynamic editor instance.
 *   - unmount( mountOrTextarea ) — unmount a previously-mounted editor.
 *   - getContentApi( textarea ) — read or hot-replace an editor instance's
 *     serialized block content.
 *   - getEditor( textarea ) — retrieve the mounted editor instance API for
 *     focus and unmount lifecycle coordination.
 *   - registerSlotFill( slot, renderFn ) — render React content into the editor
 *     footer / toolbar / heading slots from outside BE's React tree.
 *
 * See src/editor/slot-fills.tsx for the full API contract.
 */
( window as any ).blocksEverywhere = {
	mountEditor,
	unmount: unmountEditor,
	getContentApi,
	getEditor: ( textarea: HTMLTextAreaElement ) => textarea?.__blocksEverywhereEditor ?? null,
	getSettings: getBootstrapSetting,
	registerSettings: registerBootstrapSettings,
	registerSlotFill,
};

domReady( () => {
	ensurePageGlobalSetup();

	// Add the editor
	getRegisteredBootstrapSettings().forEach( ( settings ) => {
		if ( ! settings?.saveTextarea ) {
			return;
		}

		document.querySelectorAll( settings.saveTextarea ).forEach( ( node ) => {
			mountEditor( node as HTMLTextAreaElement, { settings } );
		} );
	} );

	// Set the loaded flag
	setTimeout( () => document.body.classList.add( 'gutenberg-support-loaded' ), 250 );
} );
