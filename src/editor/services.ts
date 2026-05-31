/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import type { EditorMountSettings, EditorServiceContext, EditorServices } from './editor-services';
import { normalizeModeNames, toArray } from './utils';

const removeNullPostFromFileUploadMiddleware = ( options, next ) => {
	if ( options.method === 'POST' && options.path === '/wp/v2/media' ) {
		const formData = options.body;

		if ( formData instanceof FormData && formData.has( 'post' ) && formData.get( 'post' ) === 'null' ) {
			formData.delete( 'post' );
		}
	}

	return next( options );
};

export function createServiceContext( settings, textarea?, container? ): EditorServiceContext {
	return {
		container,
		editorType: settings?.editorType,
		mode: normalizeModeNames( settings?.blocksEverywhere?.mode )[ 0 ],
		settings,
		textarea,
	};
}

export function notifyService(
	services: EditorServices,
	type: string,
	message: string,
	context: EditorServiceContext,
	details?
) {
	const notices = services?.notices;

	try {
		if ( typeof notices === 'function' ) {
			notices( type, message, context, details );
			return;
		}

		notices?.[ type ]?.( message, context, details );
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: notice service failed', error );
	}
}

export function createScopedApiFetch( services: EditorServices ) {
	const baseApiFetch = typeof services?.apiFetch === 'function' ? services.apiFetch : apiFetch;
	const middlewares = [ ...toArray( services?.apiFetchMiddleware ), ...toArray( services?.apiFetchMiddlewares ) ];

	return middlewares.reduceRight(
		( next, middleware ) => ( options ) => middleware( options, next ),
		( options ) => baseApiFetch( options )
	);
}

function getDefaultApiFetchMiddlewares( settings ) {
	const middlewares = [ removeNullPostFromFileUploadMiddleware ];

	if ( settings?.restNonce ) {
		middlewares.push( apiFetch.createNonceMiddleware( settings.restNonce ) );
	}

	return middlewares;
}

export function resolvePermission(
	services: EditorServices,
	capability: string,
	context: EditorServiceContext,
	fallback: boolean
) {
	const permissions = services?.permissions;

	if ( ! permissions ) {
		return fallback;
	}

	try {
		const delegated = permissions.can?.( capability, context );
		if ( typeof delegated === 'boolean' ) {
			return delegated;
		}

		if ( capability === 'uploadMedia' ) {
			const uploadPermission = permissions.canUploadMedia;
			if ( typeof uploadPermission === 'function' ) {
				const value = uploadPermission( context );
				if ( typeof value === 'boolean' ) {
					return value;
				}
			}

			if ( typeof uploadPermission === 'boolean' ) {
				return uploadPermission;
			}
		}
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: permissions service failed', error );
	}

	return fallback;
}

export function resolveEditorServices( settings: EditorMountSettings, mountServices?: EditorServices ): EditorServices {
	const blocksEverywhere = settings?.blocksEverywhere || {};
	const modes = normalizeModeNames( blocksEverywhere.mode );
	const servicesByMode = blocksEverywhere.servicesByMode || {};
	const resolvedServices = {
		...( blocksEverywhere.services || {} ),
		...modes.reduce( ( services, mode ) => ( { ...services, ...( servicesByMode?.[ mode ] || {} ) } ), {} ),
		...( mountServices || {} ),
	};
	const apiFetchMiddlewares = [
		...getDefaultApiFetchMiddlewares( settings ),
		...toArray( resolvedServices.apiFetchMiddlewares ),
	];

	return {
		...resolvedServices,
		apiFetchMiddlewares,
	};
}
