/**
 * Internal dependencies
 */
import { getBlockContext, getEditorContext } from './editor-context';
import { normalizeLoadedBlocks } from './content-bridge-controller';
import { isPlainObject } from './utils';

export function getEntityBridge( settings ) {
	const bridge = settings?.blocksEverywhere?.entityBridge;
	return isPlainObject( bridge ) ? bridge : null;
}

export function getEntityBridgeEntity( settings ) {
	const bridge = getEntityBridge( settings );
	if ( ! bridge ) {
		return {};
	}

	const entity = isPlainObject( bridge.entity ) ? { ...bridge.entity } : {};
	Object.keys( bridge ).forEach( ( key ) => {
		if ( [ 'entity', 'load', 'getEdits', 'saveEdits', 'reset' ].includes( key ) ) {
			return;
		}

		if ( typeof bridge[ key ] !== 'function' ) {
			entity[ key ] = bridge[ key ];
		}
	} );

	return entity;
}

function createEntityBridgeContext( { container, instance, settings, source, textarea } ) {
	return {
		blockContext: getBlockContext( settings ),
		container,
		context: getEditorContext( settings ),
		editorType: settings?.editorType,
		entity: getEntityBridgeEntity( settings ),
		getContentApi: () => textarea?.__blocksEverywhereContentApi ?? null,
		instance,
		settings,
		source,
		textarea,
	};
}

export function createEntityBridgeController( { container, contentBridge, instance, settings, textarea } ) {
	const bridge = getEntityBridge( settings );
	const getContext = ( source? ) =>
		createEntityBridgeContext( {
			container,
			instance,
			settings,
			source,
			textarea,
		} );

	return {
		bridge,
		entity: getEntityBridgeEntity( settings ),
		getEdits() {
			if ( typeof bridge?.getEdits !== 'function' ) {
				return {};
			}

			try {
				const edits = bridge.getEdits( getContext() );
				return isPlainObject( edits ) ? edits : {};
			} catch ( error ) {
				// eslint-disable-next-line no-console
				console.error( 'Blocks Everywhere: entity bridge getEdits failed', error );
				return {};
			}
		},
		load() {
			if ( typeof bridge?.load === 'function' ) {
				try {
					const loaded = normalizeLoadedBlocks( bridge.load( getContext( 'load' ) ), contentBridge.helpers );
					if ( loaded ) {
						return contentBridge.prepareInitialContent( loaded );
					}
				} catch ( error ) {
					// eslint-disable-next-line no-console
					console.error( 'Blocks Everywhere: entity bridge load failed', error );
				}
			}

			return contentBridge.load();
		},
		reset( reason = 'reset' ) {
			if ( typeof bridge?.reset !== 'function' ) {
				return;
			}

			try {
				bridge.reset( getContext( reason ) );
			} catch ( error ) {
				// eslint-disable-next-line no-console
				console.error( 'Blocks Everywhere: entity bridge reset failed', error );
			}
		},
		saveEdits( blocks, serialized, source ) {
			if ( typeof bridge?.saveEdits !== 'function' ) {
				return;
			}

			const bridgeEdits = this.getEdits();
			try {
				bridge.saveEdits(
					{
						...bridgeEdits,
						blocks,
						content: serialized,
						entity: this.entity,
						serialized,
						source,
					},
					getContext( source )
				);
			} catch ( error ) {
				// eslint-disable-next-line no-console
				console.error( 'Blocks Everywhere: entity bridge saveEdits failed', error );
			}
		},
	};
}
