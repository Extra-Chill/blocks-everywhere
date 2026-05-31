/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { addFilter } from '@wordpress/hooks';

/**
 * Internal dependencies
 */
import type {
	EditorAutocompleteCompleter,
	EditorAutocompleteService,
	EditorMountSettings,
	EditorServiceContext,
	EditorServices,
} from './editor-services';
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

type ActiveAutocompleteRegistration = {
	autocomplete: EditorAutocompleteService;
	context: EditorServiceContext;
};

const activeAutocompleteRegistrations = new Set< ActiveAutocompleteRegistration >();
let isAutocompleteFilterInstalled = false;

function resolveServiceCompleters( autocomplete: EditorAutocompleteService, context: EditorServiceContext ) {
	if ( ! autocomplete || typeof autocomplete === 'function' ) {
		return [];
	}

	try {
		const completers = autocomplete.completers;
		if ( typeof completers === 'function' ) {
			return toArray( completers( context ) );
		}

		return toArray( completers );
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: autocomplete completer service failed', error );
		return [];
	}
}

function applyAutocompleteService(
	completers: EditorAutocompleteCompleter[],
	autocomplete: EditorAutocompleteService,
	context: EditorServiceContext
) {
	try {
		if ( typeof autocomplete === 'function' ) {
			return autocomplete( completers, context ) || completers;
		}

		return autocomplete?.filterCompleters?.( completers, context ) || completers;
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: autocomplete filter service failed', error );
		return completers;
	}
}

function ensureAutocompleteFilterInstalled() {
	if ( isAutocompleteFilterInstalled ) {
		return;
	}

	// Gutenberg portability gap: `editor.Autocomplete.completers` is a
	// page-global hook. BE uses Gutenberg's completer primitive and scopes custom
	// host sources as far as the upstream hook allows.
	addFilter(
		'editor.Autocomplete.completers',
		'blocks-everywhere/autocomplete-services',
		( completers = [] ) => {
			let resolvedCompleters = [ ...completers ];

			activeAutocompleteRegistrations.forEach( ( registration ) => {
				const additionalCompleters = resolveServiceCompleters(
					registration.autocomplete,
					registration.context
				);
				resolvedCompleters = [ ...resolvedCompleters, ...additionalCompleters ];
				resolvedCompleters = applyAutocompleteService(
					resolvedCompleters,
					registration.autocomplete,
					registration.context
				);
			} );

			return resolvedCompleters;
		},
		20
	);

	isAutocompleteFilterInstalled = true;
}

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

export function registerAutocompleteServices(
	autocomplete: EditorAutocompleteService | undefined,
	context: EditorServiceContext
) {
	if ( ! autocomplete ) {
		return () => {};
	}

	ensureAutocompleteFilterInstalled();

	const registration = { autocomplete, context };
	activeAutocompleteRegistrations.add( registration );

	return () => activeAutocompleteRegistrations.delete( registration );
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
