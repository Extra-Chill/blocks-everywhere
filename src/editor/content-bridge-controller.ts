/**
 * WordPress dependencies
 */
import { parse, rawHandler, serialize } from '@wordpress/blocks';

/**
 * Internal dependencies
 */
import { getBlockContext, getEditorContext } from './editor-context';
import { getEntityBridgeEntity } from './entity-bridge-controller';
import { toArray } from './utils';

function saveBlocks( textarea: HTMLTextAreaElement, content: string ): void {
	if ( textarea ) {
		textarea.value = content;
	}
}

function createContentBridgeHelpers( textarea, settings ) {
	return {
		parse,
		rawHandler,
		serialize,
		getTextareaContent() {
			return textarea?.value || '';
		},
		setTextareaContent( content ) {
			if ( textarea ) {
				textarea.value = String( content || '' );
			}
		},
		textarea,
		settings,
	};
}

function createContentBridgeContext( textarea, settings ) {
	return {
		blockContext: getBlockContext( settings ),
		context: getEditorContext( settings ),
		entity: getEntityBridgeEntity( settings ),
		textarea,
		settings,
		editorType: settings?.editorType,
	};
}

export function normalizeLoadedBlocks( value, helpers ) {
	if ( Array.isArray( value ) ) {
		return value;
	}

	if ( typeof value === 'string' ) {
		return helpers.parse( value );
	}

	return null;
}

function hasMeaningfulInitialContent( blocks ) {
	if ( ! Array.isArray( blocks ) || blocks.length === 0 ) {
		return false;
	}

	return blocks.some( ( block ) => {
		const name = block?.name || block?.blockName || '';
		const attributes = block?.attributes || block?.attrs || {};
		const innerBlocks = block?.innerBlocks || [];

		if ( Array.isArray( innerBlocks ) && hasMeaningfulInitialContent( innerBlocks ) ) {
			return true;
		}

		if ( name !== 'core/paragraph' ) {
			return true;
		}

		return Object.values( attributes ).some( ( value ) => String( value || '' ).trim() !== '' );
	} );
}

function resolveInitialContentValue( value, context, helpers ) {
	if ( typeof value === 'function' ) {
		return value( context, helpers );
	}

	return value;
}

function resolveInitialContentBlocks( value, context, helpers ) {
	return normalizeLoadedBlocks( resolveInitialContentValue( value, context, helpers ), helpers );
}

function applyInitialContentPipeline( blocks, contentBridge ) {
	const initialContent = contentBridge?.helpers?.settings?.blocksEverywhere?.initialContent || null;
	if ( ! initialContent || typeof initialContent !== 'object' ) {
		return blocks;
	}

	const helpers = contentBridge.helpers;
	const baseContext = {
		...contentBridge.context,
		blocks,
		hasContent: hasMeaningfulInitialContent( blocks ),
		serialized: helpers.serialize( blocks ),
		source: 'initial',
	};
	let nextBlocks = blocks;
	const loaded = resolveInitialContentBlocks( initialContent.load, baseContext, helpers );

	if ( loaded ) {
		nextBlocks = loaded;
	}

	const transforms = [ ...toArray( initialContent.transform ), ...toArray( initialContent.transforms ) ];
	transforms.forEach( ( transform ) => {
		if ( typeof transform !== 'function' ) {
			return;
		}

		const serialized = helpers.serialize( nextBlocks );
		const transformed = transform(
			serialized,
			{
				...baseContext,
				blocks: nextBlocks,
				hasContent: hasMeaningfulInitialContent( nextBlocks ),
				serialized,
			},
			helpers
		);
		const transformedBlocks = normalizeLoadedBlocks( transformed, helpers );

		if ( transformedBlocks ) {
			nextBlocks = transformedBlocks;
		}
	} );

	if ( hasMeaningfulInitialContent( nextBlocks ) ) {
		return nextBlocks;
	}

	const starter =
		resolveInitialContentBlocks( initialContent.pattern, baseContext, helpers ) ||
		resolveInitialContentBlocks( initialContent.template, baseContext, helpers ) ||
		resolveInitialContentBlocks( initialContent.starter, baseContext, helpers );

	return starter || nextBlocks;
}

export function createContentBridgeController( textarea, settings ) {
	const bridge = settings?.blocksEverywhere?.contentBridge || null;
	const helpers = createContentBridgeHelpers( textarea, settings );
	const context = createContentBridgeContext( textarea, settings );
	const syncTextarea = bridge?.syncTextarea !== false;
	const serializeBlocks = ( blocks ) => {
		const serialized = helpers.serialize( blocks );

		if ( typeof bridge?.serialize !== 'function' ) {
			return serialized;
		}

		const nextSerialized = bridge.serialize( blocks, context, helpers );
		return typeof nextSerialized === 'string' ? nextSerialized : serialized;
	};

	return {
		bridge,
		helpers,
		context,
		prepareInitialContent( blocks ) {
			return applyInitialContentPipeline( blocks, this );
		},
		load() {
			let loaded;
			if ( typeof bridge?.load === 'function' ) {
				loaded = normalizeLoadedBlocks( bridge.load( helpers, context ), helpers );
				if ( loaded ) {
					return applyInitialContentPipeline( loaded, this );
				}
			}

			loaded = textarea && textarea.nodeName === 'TEXTAREA' ? helpers.parse( textarea.value ) : [];
			return applyInitialContentPipeline( loaded, this );
		},
		serializeBlocks,
		save( blocks ) {
			const serialized = serializeBlocks( blocks );

			if ( syncTextarea ) {
				saveBlocks( textarea, serialized );
			}

			if ( typeof bridge?.save === 'function' ) {
				bridge.save( blocks, serialized, context, helpers );
			}

			return serialized;
		},
		replaceContent( content ) {
			let nextContent = content;

			if ( typeof bridge?.replaceContent === 'function' ) {
				const replaced = bridge.replaceContent( content, context, helpers );
				if ( replaced !== undefined ) {
					nextContent = replaced;
				}
			}

			const nextBlocks = normalizeLoadedBlocks( nextContent, helpers );
			return nextBlocks || [];
		},
	};
}
