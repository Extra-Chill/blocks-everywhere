/**
 * WordPress dependencies
 */
import { MediaUpload } from '@wordpress/media-utils';
import {
	BlockEditorProvider,
	mediaUpload as blockEditorMediaUpload,
	// Gutenberg portability gap: there is no stable, post-agnostic public
	// library panel primitive yet. BE isolates the unstable export behind its
	// own detached inserter contract so hosts never depend on this API shape.
	// @ts-ignore __experimentalLibrary is unstable.
	__experimentalLibrary as Library,
} from '@wordpress/block-editor';
import { mediaUpload as legacyMediaUpload } from '@wordpress/editor';
import { SlotFillProvider } from '@wordpress/components';
import { createRoot, useCallback, useEffect, useState } from '@wordpress/element';
import { addFilter } from '@wordpress/hooks';
import { createBlock, parse, rawHandler } from '@wordpress/blocks';
import { useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import BuddyPress from './buddypress';
import ContentBridge from './content-bridge';
import { createContentBridgeController } from './content-bridge-controller';
import DetachedSidebar from './detached-sidebar';
import { getEditorContext } from './editor-context';
import { MaybeEditorDataBoundary } from './editor-data-boundary';
import EmbeddedEditorShell, { type ResolvedChromeConfig, type ResolvedToolbarConfig } from './embedded-editor-shell';
import type { EditorServices } from './editor-services';
import { createEntityBridgeController, getEntityBridgeEntity } from './entity-bridge-controller';
import {
	createHostAdapterContext,
	dispatchLifecycleEvent,
	getLifecycleCallbackName,
	getHostAdapter,
	runHostAdapterCallback,
	runHostAdapterCleanup,
} from './lifecycle';
import PostEntityShell, { EditorEditsBridge, type PostEntityRef } from './post-entity-shell';
import { installRefreshReceiver } from './refresh-controller';
import { resolveHostRuntimeAdapter } from './runtime-adapters';
import { type EditorMountOptions, resolveMountSettings } from './settings';
import { mergeSettings } from './utils';
import {
	createScopedApiFetch,
	createServiceContext,
	notifyService,
	registerAutocompleteServices,
	resolvePermission,
} from './services';
import { RegisteredSlotFills } from './slot-fills';
import { getBootstrapSettingsSummary } from '../bootstrap-settings';

export type {
	EditorHostRuntimeAdapter,
	EditorMountSettings,
	EditorServiceContext,
	EditorServices,
} from './editor-services';

export type { EditorMountOptions } from './settings';

export interface EditorMount {
	container: HTMLElement;
	context?: Record< string, unknown >;
	entity?: Record< string, unknown >;
	focus: () => void;
	getEntityEdits?: () => Record< string, unknown >;
	registry?: unknown;
	resetEntity?: ( reason?: string ) => void;
	textarea: HTMLTextAreaElement;
	unmount: () => void;
}

const mountedEditors = new WeakMap< HTMLTextAreaElement, EditorMount >();
let isMediaUploadFilterInstalled = false;

function ensureMediaUploadFilterInstalled() {
	if ( isMediaUploadFilterInstalled ) {
		return;
	}

	// Gutenberg portability gap: `editor.MediaUpload` is a page-global hook, not
	// an instance setting. Install BE's provider once and leave it in place so
	// multiple embedded editors cannot race each other during unmount.
	addFilter( 'editor.MediaUpload', 'blocks-everywhere/media-upload', () => MediaUpload );
	isMediaUploadFilterInstalled = true;
}

/**
 * Inline block inserter panel rendered into the detached sidebar portal.
 *
 * Gutenberg portability gap: the reusable inserter library panel is still
 * `__experimentalLibrary`. BE keeps the host-facing contract to "render an
 * inserter panel in this sidebar" and contains the unstable Gutenberg export
 * here so consumers do not couple to the upstream component directly.
 */
function DetachedInserterPanel() {
	return (
		<div className="blocks-everywhere-editor__detached-inserter edit-widgets-layout__inserter-panel">
			<div className="edit-widgets-layout__inserter-panel-content blocks-everywhere-editor__inserter-tabs">
				{ /* @ts-ignore __experimentalLibrary is unstable */ }
				<Library showMostUsedBlocks={ false } showInserterHelpPanel />
			</div>
		</div>
	);
}

function setLoaded( container ) {
	const closest = container.closest( '.blocks-everywhere-editor__loading' );

	if ( closest ) {
		closest.classList.remove( 'blocks-everywhere-editor__loading' );
	}
}

function focusEditor( container ) {
	const target = container?.querySelector?.(
		'.block-editor-block-list__layout [contenteditable="true"], .block-editor-block-list__layout textarea, .block-editor-block-list__layout input'
	);
	target?.focus?.();
}

function EditorLoaded( { onLoaded } ) {
	useEffect( () => {
		onLoaded?.();
	}, [ onLoaded ] );

	return null;
}

/**
 * Resolve the consumer's toolbar configuration into a fully-specified
 * `ResolvedToolbarConfig`.
 *
 * Default toolbar matches the upstream wp-admin post editor (every primitive
 * enabled). Consumers opt OUT individual primitives via
 * `settings.blocksEverywhere.toolbar`; they never need to opt IN. Any key left
 * `undefined` is treated as `true`.
 *
 * Notes on the underlying primitives (rendered by `<EmbeddedEditorShell>`):
 * - `inserter` — document-level "+" block inserter button. May be effectively
 *   suppressed when a persistent detached sidebar is mounted (the sidebar
 *   always shows the inserter panel, making the toolbar button redundant).
 * - `undo` / `redo` — delegate to the core editor history. They are no-ops
 *   when no entity is being edited (BE mounts without a `postEntity` do not
 *   accumulate undo state); the buttons render disabled in that case, which
 *   matches the upstream behavior for an empty post.
 * - `listView` — block list-view tree. Toggle button + dropdown panel on the
 *   toolbar, owned by the shell.
 * - `blockTools` — selected-block format toolbar (the contextual `¶ B I link`
 *   row Gutenberg shows when a block is selected).
 *
 * @param raw              Consumer-supplied partial toolbar config from `settings.blocksEverywhere.toolbar`, or undefined.
 * @param suppressInserter When true, forces `inserter: false` regardless of consumer config. Used when a persistent detached sidebar already exposes the inserter panel.
 */
function resolveToolbarConfig(
	raw: Partial< ResolvedToolbarConfig > | undefined,
	suppressInserter: boolean
): ResolvedToolbarConfig {
	const requested: ResolvedToolbarConfig = {
		inserter: raw?.inserter !== false,
		undo: raw?.undo !== false,
		redo: raw?.redo !== false,
		listView: raw?.listView !== false,
		blockTools: raw?.blockTools !== false,
	};

	// Persistent detached sidebar already exposes the inserter; the toolbar
	// button becomes redundant chrome. Suppression is orthogonal to the
	// consumer's `toolbar.inserter` config — it modifies the effective value.
	if ( suppressInserter ) {
		requested.inserter = false;
	}

	return requested;
}

function resolveChromeConfig( raw: Partial< ResolvedChromeConfig > | undefined ): ResolvedChromeConfig {
	const mode = [ 'inline', 'full-height', 'modal', 'compact' ].includes( String( raw?.mode ) )
		? ( raw?.mode as ResolvedChromeConfig[ 'mode' ] )
		: 'inline';
	const fullscreen = raw?.fullscreen;
	const fullscreenConfig = typeof fullscreen === 'object' && fullscreen !== null ? fullscreen : {};
	const fullscreenEnabled = fullscreen === true || fullscreenConfig?.enabled === true;

	return {
		mode,
		fullscreen: {
			active: typeof fullscreenConfig?.active === 'boolean' ? fullscreenConfig.active : undefined,
			defaultActive: fullscreenConfig?.defaultActive === true,
			enabled: fullscreenEnabled,
			onChange: typeof fullscreenConfig?.onChange === 'function' ? fullscreenConfig.onChange : undefined,
		},
		topBar: raw?.topBar === true,
		toolbar: raw?.toolbar !== false,
		secondaryToolbar: raw?.secondaryToolbar === true,
		footer: raw?.footer !== false,
		documentSidebar: raw?.documentSidebar === true,
		inserterSidebar: raw?.inserterSidebar === true,
	};
}

function ensureSeededBlocks( blocks ) {
	if ( Array.isArray( blocks ) && blocks.length > 0 ) {
		return blocks;
	}
	return [ createBlock( 'core/paragraph' ) ];
}

function EmbeddedBlockEditor( { children, className, onChange, onError, onInput, onLoad, onSelection, settings } ) {
	const [ blocks, setBlocks ] = useState( () => {
		try {
			const initial = onLoad ? onLoad( parse, rawHandler ) : [];
			return ensureSeededBlocks( initial );
		} catch ( error ) {
			onError?.( error );
			return ensureSeededBlocks( [] );
		}
	} );
	const [ selection, setSelection ] = useState( null );

	// Public API for a detached sidebar portal:
	// `settings.blocksEverywhere.sidebar.detached = { target, className?, persistent?, defaultView? }`.
	// `target` is required to enable the detached portal. `defaultView`
	// currently supports only `'inserter'`; `'list-view'` is reserved and
	// falls back to the inserter panel (BE has no list-view chrome yet).
	const detachedSidebar = settings?.blocksEverywhere?.sidebar?.detached || null;
	const hasDetachedSidebar = Boolean( detachedSidebar?.target );
	// When the detached sidebar is persistent, the inserter panel is always
	// visible in the host's portal target — so the toolbar's "+" inserter
	// button becomes redundant chrome. Suppress it in that case.
	// Non-persistent detached sidebars (or the default in-shell sidebar)
	// keep the toolbar button as the trigger.
	const suppressToolbarInserter = Boolean( hasDetachedSidebar && detachedSidebar?.persistent );

	// Resolve the toolbar config (consumer overrides + persistent-sidebar
	// inserter suppression). Defaults match the upstream wp-admin post editor:
	// every primitive on, consumers opt OUT individually.
	const toolbar = resolveToolbarConfig( settings?.blocksEverywhere?.toolbar, suppressToolbarInserter );
	const chrome = resolveChromeConfig( settings?.blocksEverywhere?.chrome );

	const updateBlocks = useCallback(
		( nextBlocks ) => {
			setBlocks( nextBlocks );
			onChange?.( nextBlocks );
		},
		[ onChange ]
	);
	const inputBlocks = useCallback(
		( nextBlocks ) => {
			setBlocks( nextBlocks );
			onInput?.( nextBlocks );
		},
		[ onInput ]
	);
	const replaceBlocks = useCallback(
		( nextBlocks ) => {
			setBlocks( nextBlocks );
			onChange?.( nextBlocks );
		},
		[ onChange ]
	);
	const updateSelection = useCallback(
		( nextSelection ) => {
			setSelection( nextSelection );
			onSelection?.( nextSelection );
		},
		[ onSelection ]
	);

	return (
		<SlotFillProvider>
			<BlockEditorProvider
				value={ blocks }
				onInput={ inputBlocks }
				onChange={ updateBlocks }
				selection={ selection }
				onChangeSelection={ updateSelection }
				settings={ settings.editor }
				useSubRegistry={ false }
			>
				<EmbeddedEditorShell
					chrome={ chrome }
					toolbar={ toolbar }
					styles={ settings.editor?.styles || [] }
					className={ className }
				/>
				{ hasDetachedSidebar && (
					<DetachedSidebar target={ detachedSidebar.target } className={ detachedSidebar.className }>
						<DetachedInserterPanel />
					</DetachedSidebar>
				) }
				{ typeof children === 'function' ? children( { blocks, replaceBlocks } ) : children }
			</BlockEditorProvider>
		</SlotFillProvider>
	);
}

function createContainer( textarea, existingContainer ) {
	if ( existingContainer && ! existingContainer.contains( textarea ) ) {
		return { container: existingContainer, inserted: false };
	}

	const container = document.createElement( 'div' );

	// Insert the container
	textarea.parentNode.insertBefore( container, textarea );

	return { container, inserted: true };
}

function getPageGlobalDisallowedBlockVariations( settings ) {
	const configured = settings?.blocksEverywhere?.blockVariations?.disallow;
	const variations = Array.isArray( configured ) ? [ ...configured ] : [];

	// Gutenberg portability gap: block variations are registered page-globally,
	// so there is no per-editor way to hide a variation. BE makes that limitation
	// explicit through `blocksEverywhere.blockVariations.disallow` and performs
	// the one-way unregister at the page boundary.
	if ( settings?.editorType === 'bbpress' || getBootstrapSettingsSummary().hasBbpressEditor ) {
		variations.push(
			{ blockName: 'core/paragraph', variationName: 'stretchy-paragraph' },
			{ blockName: 'core/heading', variationName: 'stretchy-heading' }
		);
	}

	return variations;
}

function PageGlobalBlockVariationPruner( { settings } ) {
	useEffect( () => {
		const variations = getPageGlobalDisallowedBlockVariations( settings );
		if ( variations.length === 0 ) {
			return;
		}

		try {
			variations.forEach( ( variation ) => {
				const blockName = variation?.blockName || variation?.block;
				const variationName = variation?.variationName || variation?.name;
				if ( blockName && variationName ) {
					window?.wp?.blocks?.unregisterBlockVariation?.( blockName, variationName );
				}
			} );
		} catch ( error ) {
			// eslint-disable-next-line no-console
			console.error( 'Blocks Everywhere: failed to prune block variations', error );
		}
	}, [ settings ] );

	return null;
}

/**
 * Dispatches theme supports to WordPress core store.
 * This enables blocks like core/embed to detect responsive-embeds support
 * and apply proper aspect ratio classes when saving content.
 * @param root0
 * @param root0.themeSupports
 */
function ThemeSupportsDispatcher( { themeSupports } ) {
	const { receiveCurrentTheme } = useDispatch( 'core' );

	useEffect( () => {
		if ( themeSupports && receiveCurrentTheme ) {
			receiveCurrentTheme( {
				theme_supports: themeSupports,
			} );
		}
	}, [ themeSupports, receiveCurrentTheme ] );

	return null;
}

function createEditorContainer( container, textarea, settings ) {
	const root = createRoot( container );
	const cleanupCallbacks = [];
	const hostAdapter = getHostAdapter( settings );
	const services: EditorServices = settings?.blocksEverywhere?.services || {};
	const serviceContext = createServiceContext( settings, textarea, container );
	const scopedApiFetch = createScopedApiFetch( services );

	const hasUploadPermission = resolvePermission(
		services,
		'uploadMedia',
		serviceContext,
		settings?.editor?.hasUploadPermissions === true
	);
	let isUnmounted = false;
	const editorKey = 0;
	const contentBridge = createContentBridgeController( textarea, settings );
	let entityBridge = null;
	let hasEditorFocus = false;
	const runtimeAdapter = resolveHostRuntimeAdapter( {
		container,
		notify: notifyService,
		scopedApiFetch,
		serviceContext,
		services,
		settings,
		textarea,
	} );
	const cleanupAutocompleteServices = registerAutocompleteServices( services?.autocomplete, serviceContext );
	const cleanupRuntimeAutocompleteServices = registerAutocompleteServices(
		runtimeAdapter?.resolveAutocomplete?.( serviceContext ),
		serviceContext
	);

	const emitLifecycle = ( name, detail = {} ) => {
		dispatchLifecycleEvent( name, { container, detail, settings, textarea } );
	};
	const emitContentHook = ( name, blocks, serialized ) => {
		const context = createHostAdapterContext( { container, instance, settings, textarea } );
		const callbackName = getLifecycleCallbackName( name );

		runHostAdapterCallback( hostAdapter, 'onContent', [ name, blocks, serialized, context ] );
		if ( callbackName ) {
			runHostAdapterCallback( hostAdapter, callbackName, [ blocks, serialized, context ] );
		}

		runHostAdapterCallback( hostAdapter, 'onContentChange', [ blocks, serialized, context, { source: name } ] );
		// Legacy portable adapter alias. Content edits are not persistence saves.
		runHostAdapterCallback( hostAdapter, 'onSave', [ blocks, serialized, context, { source: name } ] );
		emitLifecycle( name, { blocks, serialized, instance } );
		emitLifecycle( 'content-change', { blocks, serialized, source: name, instance } );
	};

	const onFocusIn = () => {
		if ( hasEditorFocus ) {
			return;
		}

		hasEditorFocus = true;
		emitLifecycle( 'focused', { instance } );
	};
	const onFocusOut = ( event ) => {
		if ( ! container?.contains?.( event.relatedTarget ) ) {
			hasEditorFocus = false;
			emitLifecycle( 'blurred', { instance } );
		}
	};

	container?.addEventListener?.( 'focusin', onFocusIn );
	container?.addEventListener?.( 'focusout', onFocusOut );

	const instance = {
		container,
		context: getEditorContext( settings ),
		entity: getEntityBridgeEntity( settings ),
		focus: () => {
			emitLifecycle( 'focus-requested', { instance } );
			focusEditor( container );
		},
		getEntityEdits: () => entityBridge?.getEdits?.() || {},
		services,
		registry: undefined,
		resetEntity: ( reason?: string ) => entityBridge?.reset?.( reason ),
		textarea,
		unmount: () => unmountEditor( textarea ),
	};
	entityBridge = createEntityBridgeController( {
		container,
		contentBridge,
		instance,
		settings,
		textarea,
	} );

	textarea.__blocksEverywhereEditor = instance;
	container.__blocksEverywhereEditor = instance;

	emitLifecycle( 'before-mount', { instance } );
	const hostAdapterContext = createHostAdapterContext( { container, instance, settings, textarea } );
	runHostAdapterCallback( hostAdapter, 'beforeMount', [ hostAdapterContext ] );
	const cleanupHostAdapter = runHostAdapterCallback( hostAdapter, 'setup', [ hostAdapterContext ] );
	if ( typeof cleanupHostAdapter === 'function' ) {
		cleanupCallbacks.push( () => runHostAdapterCleanup( cleanupHostAdapter ) );
	}

	// External-edit refresh receiver: when the host signals the watched post
	// changed elsewhere, refetch + replace this editor's content safely. No-op
	// unless the host configured `blocksEverywhere.refresh`.
	cleanupCallbacks.push( installRefreshReceiver( textarea, settings ) );

	emitLifecycle( 'mounted', { instance } );

	const form = container.closest( 'form' );
	if ( form ) {
		const onSubmit = ( event ) => emitLifecycle( 'submit', { event, instance } );
		form.addEventListener( 'submit', onSubmit );
		cleanupCallbacks.push( () => form.removeEventListener( 'submit', onSubmit ) );
	}

	const renderEditor = () => {
		// Opt-in postEntity wiring: when the consumer declares this BE mount is
		// backed by a canonical WP post, wrap the editor in <EditorProvider> so
		// `core/editor` is populated. <AutosaveMonitor> + <LocalAutosaveMonitor>
		// then fire on the standard WordPress autosave path with no per-consumer
		// debounce/in-flight/sendBeacon code required.
		//
		// Gutenberg portability boundary: real WP posts should use the public
		// `@wordpress/editor` provider/autosave stack; textarea-only hosts stay on
		// `@wordpress/block-editor` primitives and must not fake a post entity.
		const postEntity: PostEntityRef | null =
			settings?.postEntity && typeof settings.postEntity === 'object'
				? {
						type: String( settings.postEntity.type || '' ),
						id: Number( settings.postEntity.id ) || 0,
				  }
				: null;

		root.render(
			<MaybeEditorDataBoundary instance={ instance } settings={ settings } textarea={ textarea }>
				<PostEntityShell postEntity={ postEntity } editorSettings={ settings?.editor }>
					<EmbeddedBlockEditor
						key={ editorKey }
						settings={ settings }
						onLoad={ () => entityBridge.load() }
						onError={ ( error ) => {
							// eslint-disable-next-line no-console
							console.error( 'Blocks Everywhere: editor initialization failed', error );
							container?.classList?.add( 'blocks-everywhere--error' );
							document?.body?.classList?.add( 'gutenberg-support-loaded' );
							setLoaded( container );
							emitLifecycle( 'error', { error, instance } );
						} }
						onInput={ ( newBlocks ) => {
							settings?.blocksEverywhere?.__experimentalOnInput?.( newBlocks );
							const serialized = contentBridge.save( newBlocks );
							entityBridge.saveEdits( newBlocks, serialized, 'input' );
							emitContentHook( 'input', newBlocks, serialized );
							runtimeAdapter?.onContent?.( newBlocks, serialized, 'input' );
						} }
						onChange={ ( newBlocks ) => {
							settings?.blocksEverywhere?.__experimentalOnChange?.( newBlocks );
							const serialized = contentBridge.save( newBlocks );
							entityBridge.saveEdits( newBlocks, serialized, 'change' );
							emitContentHook( 'change', newBlocks, serialized );
							runtimeAdapter?.onContent?.( newBlocks, serialized, 'change' );
						} }
						onSelection={ ( selection ) =>
							settings?.blocksEverywhere?.__experimentalOnSelection?.( selection )
						}
						className={ settings?.blocksEverywhere?.className }
					>
						{ ( { blocks, replaceBlocks } ) => (
							<>
								<EditorLoaded
									onLoaded={ () => {
										setLoaded( container );
										emitLifecycle( 'loaded', { instance } );
									} }
								/>
								<ThemeSupportsDispatcher themeSupports={ settings?.editor?.themeSupports } />
								<ContentBridge
									textarea={ textarea }
									blocks={ blocks }
									replaceBlocks={ replaceBlocks }
									contentBridge={ contentBridge }
								/>
								<RegisteredSlotFills textarea={ textarea } />

								{ /* Forward block changes to core/editor edits so <AutosaveMonitor> sees dirty state. */ }
								{ postEntity?.id > 0 && <EditorEditsBridge blocks={ blocks } /> }

								{ settings.editorType === 'buddypress' && <BuddyPress textarea={ textarea } /> }
								<PageGlobalBlockVariationPruner settings={ settings } />
							</>
						) }
					</EmbeddedBlockEditor>
				</PostEntityShell>
			</MaybeEditorDataBoundary>
		);
	};

	runtimeAdapter?.installHandlers?.();

	if ( services?.fetchLinkSuggestions !== undefined ) {
		settings.editor.__experimentalFetchLinkSuggestions = services.fetchLinkSuggestions || undefined;
	}

	if ( services?.mediaUpload !== undefined ) {
		settings.editor.mediaUpload = services.mediaUpload || null;

		if ( services.mediaUpload ) {
			ensureMediaUploadFilterInstalled();
		}
	} else if ( runtimeAdapter?.resolveMediaUpload ) {
		const resolvedMediaUpload = runtimeAdapter.resolveMediaUpload( {
			...serviceContext,
			canUploadMedia: hasUploadPermission,
		} );
		settings.editor.mediaUpload = resolvedMediaUpload || null;

		if ( resolvedMediaUpload ) {
			ensureMediaUploadFilterInstalled();
		}
	} else if ( hasUploadPermission ) {
		// Gutenberg portability gap: media upload helpers have moved between
		// packages across Gutenberg/Core versions. Prefer block-editor's helper and
		// fall back to editor's legacy export while BE supports both surfaces.
		const resolvedMediaUpload = blockEditorMediaUpload || legacyMediaUpload || null;
		settings.editor.mediaUpload = resolvedMediaUpload;

		if ( resolvedMediaUpload ) {
			ensureMediaUploadFilterInstalled();
		}
	} else {
		settings.editor.mediaUpload = null;
	}

	void ( async () => {
		try {
			emitLifecycle( 'before-load', { instance } );
			await runtimeAdapter?.onBeforeLoad?.();
			if ( isUnmounted ) {
				return;
			}

			renderEditor();
		} catch ( error ) {
			// eslint-disable-next-line no-console
			console.error( 'Blocks Everywhere: editor initialization failed', error );
			container?.classList?.add( 'blocks-everywhere--error' );
			document?.body?.classList?.add( 'gutenberg-support-loaded' );
			setLoaded( container );
			emitLifecycle( 'error', { error, instance } );
		}
	} )();

	return () => {
		emitLifecycle( 'before-unmount', { instance } );
		isUnmounted = true;

		cleanupAutocompleteServices();
		cleanupRuntimeAutocompleteServices();
		runtimeAdapter?.cleanup?.();
		container?.removeEventListener?.( 'focusin', onFocusIn );
		container?.removeEventListener?.( 'focusout', onFocusOut );
		cleanupCallbacks.forEach( ( cleanup ) => cleanup() );
		root.unmount();
		delete textarea.__blocksEverywhereContentApi;
		delete textarea.__blocksEverywhereEditor;
		delete container.__blocksEverywhereEditor;
		emitLifecycle( 'unmounted', { instance } );
		delete instance.registry;
	};
}

// If the container is inside a form then we need insulate button clicks inside the editor from propagating out into the form
// This is because a lot of Gutenberg buttons don't set a 'type', and so default to 'submit'
function insulateForm( container ) {
	const form = container.closest( 'form' );

	if ( form ) {
		const handler = ( ev ) => {
			if ( ev.submitter && ev.submitter.closest( '.blocks-everywhere-editor' ) ) {
				ev.stopPropagation();
				ev.preventDefault();
			}
		};

		form.addEventListener( 'submit', handler );

		return () => form.removeEventListener( 'submit', handler );
	}

	return () => {};
}

function resolveContainerOption( container ) {
	if ( typeof container === 'string' ) {
		return document.querySelector( container );
	}

	return container || null;
}

export function mountEditor( node: HTMLTextAreaElement, options: EditorMountOptions = {} ): EditorMount | null {
	const globalSettings = typeof wpBlocksEverywhere !== 'undefined' ? wpBlocksEverywhere : null;
	const baseSettings =
		options.settings && globalSettings
			? mergeSettings( globalSettings, options.settings )
			: options.settings || globalSettings;
	if ( ! baseSettings?.container ) {
		// eslint-disable-next-line no-console
		console.error( 'Blocks Everywhere: settings object missing; cannot initialize editor.' );
		setLoaded( node?.parentNode || document.body );
		return null;
	}

	const existingMount = mountedEditors.get( node );
	if ( existingMount ) {
		return existingMount;
	}

	let containerSource = resolveContainerOption( options.container );
	const settings = resolveMountSettings( baseSettings, options, node );

	// Prefer enclosing containers, so check if one exists outside.
	const outerContainerNode = node.closest( settings.container );
	containerSource = containerSource || outerContainerNode || document.querySelector( settings.container );
	const { container, inserted } = createContainer( node, containerSource );
	const cleanupInsulatedForm = insulateForm( container );
	const cleanupEditorContainer = createEditorContainer( container, node, settings );

	const mount: EditorMount = {
		container,
		get context() {
			return node.__blocksEverywhereEditor?.context;
		},
		focus: () => node.__blocksEverywhereEditor?.focus?.(),
		get registry() {
			return node.__blocksEverywhereEditor?.registry;
		},
		textarea: node,
		unmount: () => {
			if ( ! mountedEditors.has( node ) ) {
				return;
			}

			cleanupEditorContainer?.();
			cleanupInsulatedForm?.();
			mountedEditors.delete( node );

			if ( inserted ) {
				container.remove();
			}
		},
	};

	mountedEditors.set( node, mount );

	return mount;
}

export function unmountEditor( target: EditorMount | HTMLTextAreaElement ): boolean {
	const mount = 'unmount' in target ? target : mountedEditors.get( target );
	if ( ! mount ) {
		return false;
	}

	mount.unmount();
	return true;
}

export default mountEditor;
