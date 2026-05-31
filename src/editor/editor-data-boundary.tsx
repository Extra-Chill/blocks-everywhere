/**
 * WordPress dependencies
 */
import { BlockContextProvider } from '@wordpress/block-editor';
import { createRegistry, RegistryProvider, useRegistry } from '@wordpress/data';
import { useEffect, useState } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { isPlainObject } from './utils';

function getEditorDataSettings( settings ) {
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

function hasEditorDataBoundary( settings ) {
	const data = getEditorDataSettings( settings );
	return Boolean(
		data.register ||
			( Array.isArray( data.stores ) && data.stores.length > 0 ) ||
			Object.keys( getBlockContext( settings ) ).length > 0
	);
}

function registerEditorStore( registry, store, helpers ) {
	if ( typeof store === 'function' ) {
		return store( helpers );
	}

	if ( typeof store?.register === 'function' ) {
		return store.register( helpers );
	}

	if ( store?.descriptor ) {
		registry.register( store.descriptor );
		return undefined;
	}

	if ( store?.name && store?.config ) {
		registry.registerStore( store.name, store.config );
		return undefined;
	}

	if ( store?.name && typeof store?.instantiate === 'function' ) {
		registry.register( store );
	}

	return undefined;
}

function EditorDataBoundary( { children, instance, settings, textarea } ) {
	const parentRegistry = useRegistry();
	const [ controller ] = useState( () => {
		const data = getEditorDataSettings( settings );
		const context = getEditorContext( settings );
		const blockContext = getBlockContext( settings );
		const registry = createRegistry( {}, parentRegistry );
		const helpers = {
			blockContext,
			context,
			instance,
			registry,
			settings,
			textarea,
		};
		const cleanupCallbacks = [];

		( Array.isArray( data.stores ) ? data.stores : [] ).forEach( ( store ) => {
			const cleanup = registerEditorStore( registry, store, helpers );
			if ( typeof cleanup === 'function' ) {
				cleanupCallbacks.push( cleanup );
			}
		} );

		if ( typeof data.register === 'function' ) {
			const cleanup = data.register( helpers );
			if ( typeof cleanup === 'function' ) {
				cleanupCallbacks.push( cleanup );
			}
		}

		instance.context = context;
		instance.registry = registry;

		return {
			blockContext,
			cleanup: () => cleanupCallbacks.forEach( ( cleanup ) => cleanup() ),
			registry,
		};
	} );

	useEffect( () => () => controller.cleanup(), [ controller ] );

	return (
		<RegistryProvider value={ controller.registry }>
			<BlockContextProvider value={ controller.blockContext }>{ children }</BlockContextProvider>
		</RegistryProvider>
	);
}

export function MaybeEditorDataBoundary( { children, instance, settings, textarea } ) {
	if ( ! hasEditorDataBoundary( settings ) ) {
		return <>{ children }</>;
	}

	return (
		<EditorDataBoundary instance={ instance } settings={ settings } textarea={ textarea }>
			{ children }
		</EditorDataBoundary>
	);
}
