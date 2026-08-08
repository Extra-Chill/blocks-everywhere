/**
 * WordPress dependencies
 */
import { select } from '@wordpress/data';
import { store as richTextStore } from '@wordpress/rich-text';

/**
 * Internal dependencies
 */
import type { EditorMountSettings, EditorServices } from './editor-services';
import { resolveEditorServices } from './services';
import { isPlainObject, mergeSettings, mergeSettingsValue, normalizeModeNames } from './utils';

export interface EditorMountOptions {
	container?: HTMLElement | string | null;
	mode?: string | string[];
	services?: EditorServices;
	settings?: Partial< EditorMountSettings >;
	settingsTransforms?: SettingsTransform[];
}

type SettingsTransformContext = {
	mode?: string;
	modes: string[];
	options: EditorMountOptions;
	settings: EditorMountSettings;
	textarea: HTMLTextAreaElement | null;
};

export type SettingsTransform =
	| Record< string, unknown >
	| ( ( settings: EditorMountSettings, context: SettingsTransformContext ) => Record< string, unknown > | void );

const disallowedFormatTypes = new Set( [
	'core/text-color',
	'core/image',
	'core/code',
	'core/keyboard',
	'core/language',
	'core/math',
] );

function normalizeTransformPatch( patch ) {
	if ( ! isPlainObject( patch ) ) {
		return null;
	}

	const rootPatch = { ...patch };
	const blocksEverywherePatch = {};
	const editorPatch = {};

	[
		'allowEmbeds',
		'blockVariations',
		'blocks',
		'chrome',
		'className',
		'contentBridge',
		'defaultPreferences',
		'features',
		'entityBridge',
		'initialContent',
		'lifecycle',
		'mode',
		'modes',
		'patterns',
		'preferenceKey',
		'runtimeAdapter',
		'services',
		'settingsTransforms',
		'sidebar',
		'toolbar',
	].forEach( ( key ) => {
		if ( Object.prototype.hasOwnProperty.call( rootPatch, key ) ) {
			blocksEverywherePatch[ key ] = rootPatch[ key ];
			delete rootPatch[ key ];
		}
	} );

	if ( Object.prototype.hasOwnProperty.call( rootPatch, 'allowedBlocks' ) ) {
		blocksEverywherePatch.blocks = {
			...( blocksEverywherePatch.blocks || {} ),
			allowBlocks: rootPatch.allowedBlocks,
		};
		delete rootPatch.allowedBlocks;
	}

	if ( Object.prototype.hasOwnProperty.call( rootPatch, 'disallowedBlocks' ) ) {
		blocksEverywherePatch.blocks = {
			...( blocksEverywherePatch.blocks || {} ),
			disallowBlocks: rootPatch.disallowedBlocks,
		};
		delete rootPatch.disallowedBlocks;
	}

	[ 'template', 'templateLock' ].forEach( ( key ) => {
		if ( Object.prototype.hasOwnProperty.call( rootPatch, key ) ) {
			editorPatch[ key ] = rootPatch[ key ];
			delete rootPatch[ key ];
		}
	} );

	if ( Object.keys( blocksEverywherePatch ).length > 0 ) {
		rootPatch.blocksEverywhere = mergeSettingsValue( rootPatch.blocksEverywhere || {}, blocksEverywherePatch );
	}

	if ( Object.keys( editorPatch ).length > 0 ) {
		rootPatch.editor = mergeSettingsValue( rootPatch.editor || {}, editorPatch );
	}

	return rootPatch;
}

function applySettingsTransform( settings, transform, context ) {
	const patch = typeof transform === 'function' ? transform( settings, context ) : transform;
	const normalizedPatch = normalizeTransformPatch( patch );

	if ( ! normalizedPatch ) {
		return settings;
	}

	return mergeSettings( settings, normalizedPatch );
}

function resolveModeTransforms( settings, modes ) {
	const configuredModes = settings?.blocksEverywhere?.modes;
	if ( ! isPlainObject( configuredModes ) ) {
		return [];
	}

	return modes.map( ( mode ) => configuredModes[ mode ] ).filter( Boolean );
}

function resolveAllowedBlocks( settings ) {
	const allowedBlocks = settings?.blocksEverywhere?.blocks?.allowBlocks;
	const disallowedBlocks = settings?.blocksEverywhere?.blocks?.disallowBlocks || [];

	if ( ! Array.isArray( allowedBlocks ) ) {
		return;
	}

	const nextAllowedBlocks = allowedBlocks.filter( ( blockName ) => disallowedBlocks.indexOf( blockName ) === -1 );
	settings.blocksEverywhere.blocks.allowBlocks = nextAllowedBlocks;
	settings.editor.allowedBlockTypes = nextAllowedBlocks;
}

function resolveInstanceBehaviorSettings( settings ) {
	const allowedBlocks = settings?.blocksEverywhere?.blocks?.allowBlocks;
	const formatTypes = ( select( richTextStore ) as any ).getFormatTypes();
	settings.editor.blocksEverywhere = {
		...( settings.editor.blocksEverywhere || {} ),
		allowHeading: ! Array.isArray( allowedBlocks ) || allowedBlocks.includes( 'core/heading' ),
		allowUrlEmbed: settings?.allowUrlEmbed !== false,
		allowedFormats: formatTypes
			.map( ( formatType ) => formatType.name )
			.filter( ( formatName ) => ! disallowedFormatTypes.has( formatName ) ),
		pastePlainText: settings?.pastePlainText === true,
		replaceParagraphCode: settings?.replaceParagraphCode === true,
	};
}

function getPatternIdentifier( pattern ) {
	return String( pattern?.name || pattern?.slug || pattern?.title || '' );
}

function filterPatternsBySettings( patterns, allowPatterns, disallowPatterns ) {
	if ( ! Array.isArray( patterns ) ) {
		return patterns;
	}

	const allowed = Array.isArray( allowPatterns ) ? allowPatterns.map( String ) : [];
	const disallowed = Array.isArray( disallowPatterns ) ? disallowPatterns.map( String ) : [];

	if ( allowed.length === 0 && disallowed.length === 0 ) {
		return patterns;
	}

	return patterns.filter( ( pattern ) => {
		const identifier = getPatternIdentifier( pattern );
		if ( disallowed.includes( identifier ) ) {
			return false;
		}

		return allowed.length === 0 || allowed.includes( identifier );
	} );
}

function appendUniquePatterns( basePatterns, additionalPatterns ) {
	const patterns = [ ...( Array.isArray( basePatterns ) ? basePatterns : [] ) ];
	const seen = new Set( patterns.map( getPatternIdentifier ).filter( Boolean ) );

	( Array.isArray( additionalPatterns ) ? additionalPatterns : [] ).forEach( ( pattern ) => {
		const identifier = getPatternIdentifier( pattern );
		if ( identifier && seen.has( identifier ) ) {
			return;
		}

		if ( identifier ) {
			seen.add( identifier );
		}
		patterns.push( pattern );
	} );

	return patterns;
}

function appendUniquePatternCategories( baseCategories, additionalCategories ) {
	const categories = [ ...( Array.isArray( baseCategories ) ? baseCategories : [] ) ];
	const seen = new Set( categories.map( ( category ) => String( category?.name || '' ) ).filter( Boolean ) );

	( Array.isArray( additionalCategories ) ? additionalCategories : [] ).forEach( ( category ) => {
		const name = String( category?.name || '' );
		if ( name && seen.has( name ) ) {
			return;
		}

		if ( name ) {
			seen.add( name );
		}
		categories.push( category );
	} );

	return categories;
}

function resolvePatternSettings( settings ) {
	const patternSettings = settings?.blocksEverywhere?.patterns || {};
	const additionalPatterns = patternSettings.items;
	const additionalCategories = patternSettings.categories;
	const allowPatterns = patternSettings.allowPatterns;
	const disallowPatterns = patternSettings.disallowPatterns;
	const hasPatternFilter =
		( Array.isArray( allowPatterns ) && allowPatterns.length > 0 ) ||
		( Array.isArray( disallowPatterns ) && disallowPatterns.length > 0 );
	const hasAdditionalPatterns =
		Array.isArray( settings.editor.__experimentalAdditionalBlockPatterns ) || Array.isArray( additionalPatterns );
	const hasBlockPatterns =
		Array.isArray( settings.editor.__experimentalBlockPatterns ) || Array.isArray( additionalPatterns );
	const hasAdditionalCategories =
		Array.isArray( settings.editor.__experimentalAdditionalBlockPatternCategories ) ||
		Array.isArray( additionalCategories );

	if ( hasAdditionalPatterns ) {
		settings.editor.__experimentalAdditionalBlockPatterns = filterPatternsBySettings(
			appendUniquePatterns( settings.editor.__experimentalAdditionalBlockPatterns, additionalPatterns ),
			allowPatterns,
			disallowPatterns
		);
	}

	if ( hasBlockPatterns || hasPatternFilter ) {
		settings.editor.__experimentalBlockPatterns = filterPatternsBySettings(
			appendUniquePatterns( settings.editor.__experimentalBlockPatterns, additionalPatterns ),
			allowPatterns,
			disallowPatterns
		);
	}

	if ( hasAdditionalCategories ) {
		settings.editor.__experimentalAdditionalBlockPatternCategories = appendUniquePatternCategories(
			settings.editor.__experimentalAdditionalBlockPatternCategories,
			additionalCategories
		);
	}
}

export function resolveMountSettings(
	settings,
	options: EditorMountOptions = {},
	textarea: HTMLTextAreaElement | null = null
) {
	let resolvedSettings = mergeSettings( {}, settings ) as EditorMountSettings;
	resolvedSettings.editor = resolvedSettings?.editor || {};
	resolvedSettings.blocksEverywhere = resolvedSettings?.blocksEverywhere || {};

	const modes = [
		...normalizeModeNames( resolvedSettings.blocksEverywhere?.mode ),
		...normalizeModeNames( options.mode ),
	].filter( ( mode, index, allModes ) => allModes.indexOf( mode ) === index );

	const transforms = [
		...( Array.isArray( resolvedSettings.blocksEverywhere?.settingsTransforms )
			? resolvedSettings.blocksEverywhere.settingsTransforms
			: [] ),
		...resolveModeTransforms( resolvedSettings, modes ),
		...( Array.isArray( options.settingsTransforms ) ? options.settingsTransforms : [] ),
	];

	transforms.forEach( ( transform ) => {
		resolvedSettings = applySettingsTransform( resolvedSettings, transform, {
			mode: modes[ 0 ],
			modes,
			options,
			settings: resolvedSettings,
			textarea,
		} ) as EditorMountSettings;
		resolvedSettings.editor = resolvedSettings?.editor || {};
		resolvedSettings.blocksEverywhere = resolvedSettings?.blocksEverywhere || {};
	} );

	if ( modes.length > 0 ) {
		resolvedSettings.blocksEverywhere.mode = modes.length === 1 ? modes[ 0 ] : modes;
	}

	resolvedSettings.blocksEverywhere.services = resolveEditorServices( resolvedSettings, options.services );

	resolvePatternSettings( resolvedSettings );
	resolveAllowedBlocks( resolvedSettings );
	resolveInstanceBehaviorSettings( resolvedSettings );

	return resolvedSettings;
}
