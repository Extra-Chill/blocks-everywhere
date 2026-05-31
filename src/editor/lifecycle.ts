/**
 * Internal dependencies
 */
import { getEditorContext } from './editor-data-boundary';
import { getEntityBridgeEntity } from './entity-bridge-controller';

export const lifecycleCallbackNames = {
	'before-mount': 'onBeforeMount',
	mounted: 'onMounted',
	'before-load': 'onBeforeLoad',
	loaded: 'onLoaded',
	input: 'onInput',
	change: 'onChange',
	'content-change': 'onContentChange',
	save: 'onSave',
	submit: 'onSubmit',
	'focus-requested': 'onFocusRequested',
	focused: 'onFocused',
	blurred: 'onBlurred',
	error: 'onError',
	'before-unmount': 'onBeforeUnmount',
	unmounted: 'onUnmounted',
};

const hostAdapterContentEvents = new Set( [ 'input', 'change', 'content-change', 'save' ] );

function createPublicEditorInstance( instance ) {
	if ( ! instance ) {
		return null;
	}

	return {
		container: instance.container,
		context: instance.context,
		entity: instance.entity,
		focus: instance.focus,
		getEntityEdits: instance.getEntityEdits,
		resetEntity: instance.resetEntity,
		textarea: instance.textarea,
		unmount: instance.unmount,
	};
}

function createPublicLifecycleEventDetail( eventDetail ) {
	const publicDetail = {
		blocks: eventDetail.blocks,
		container: eventDetail.container,
		context: eventDetail.context,
		entity: eventDetail.entity,
		error: eventDetail.error,
		event: eventDetail.event,
		getContentApi: eventDetail.getContentApi,
		instance: createPublicEditorInstance( eventDetail.instance ),
		metadata: eventDetail.metadata,
		serialized: eventDetail.serialized,
		source: eventDetail.source,
		textarea: eventDetail.textarea,
	};

	Object.keys( publicDetail ).forEach( ( key ) => {
		if ( publicDetail[ key ] === undefined || publicDetail[ key ] === null ) {
			delete publicDetail[ key ];
		}
	} );

	return publicDetail;
}

export function getHostAdapter( settings ) {
	const adapter = settings?.blocksEverywhere?.hostAdapter;
	return adapter && typeof adapter === 'object' ? adapter : null;
}

function getHostAdapterMetadata( settings ) {
	return getHostAdapter( settings )?.metadata ?? settings?.blocksEverywhere?.hostContext ?? undefined;
}

export function createHostAdapterContext( { container, instance, settings, textarea } ) {
	return {
		container,
		entity: getEntityBridgeEntity( settings ),
		getContentApi: () => textarea?.__blocksEverywhereContentApi ?? null,
		instance,
		metadata: getHostAdapterMetadata( settings ),
		settings,
		textarea,
	};
}

function invokeHostAdapterCallback( adapter, callbackName, args ) {
	if ( ! adapter || typeof adapter?.[ callbackName ] !== 'function' ) {
		return undefined;
	}

	return adapter[ callbackName ]( ...args );
}

export function runHostAdapterCallback( adapter, callbackName, args ) {
	try {
		return invokeHostAdapterCallback( adapter, callbackName, args );
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: host adapter callback failed', error );
		return undefined;
	}
}

export function runHostAdapterCleanup( cleanup ) {
	if ( typeof cleanup !== 'function' ) {
		return;
	}

	try {
		cleanup();
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: host adapter cleanup failed', error );
	}
}

export function dispatchLifecycleEvent( name, { container, detail = {}, settings, textarea } ) {
	const instance =
		detail?.instance || textarea?.__blocksEverywhereEditor || container?.__blocksEverywhereEditor || null;
	const eventDetail = {
		context: getEditorContext( settings ),
		container,
		entity: getEntityBridgeEntity( settings ),
		getContentApi: () => textarea?.__blocksEverywhereContentApi ?? null,
		instance,
		metadata: getHostAdapterMetadata( settings ),
		settings,
		textarea,
		...detail,
	};
	const lifecycle = settings?.blocksEverywhere?.lifecycle;
	const hostAdapter = getHostAdapter( settings );
	const event = new CustomEvent( `blocksEverywhere:editor:${ name }`, {
		bubbles: true,
		cancelable: false,
		detail: createPublicLifecycleEventDetail( eventDetail ),
	} );

	container?.dispatchEvent?.( event );

	try {
		lifecycle?.onEvent?.( name, eventDetail );

		const callbackName = lifecycleCallbackNames[ name ];
		if ( callbackName ) {
			lifecycle?.[ callbackName ]?.( eventDetail );
		}

		hostAdapter?.onEvent?.( name, eventDetail );

		if ( callbackName && ! hostAdapterContentEvents.has( name ) ) {
			hostAdapter?.[ callbackName ]?.( eventDetail );
		}
	} catch ( error ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: lifecycle callback failed', error );
	}
}
