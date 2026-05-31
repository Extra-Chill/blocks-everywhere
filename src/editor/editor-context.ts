/**
 * Internal dependencies
 */
import { isPlainObject } from './utils';

export function getEditorDataSettings( settings ) {
	const data = settings?.blocksEverywhere?.data;
	return isPlainObject( data ) ? data : {};
}

export function getEditorContext( settings ) {
	const context = getEditorDataSettings( settings )?.context;
	return isPlainObject( context ) ? context : {};
}

export function getBlockContext( settings ) {
	const context = getEditorDataSettings( settings )?.blockContext;
	return isPlainObject( context ) ? context : {};
}
