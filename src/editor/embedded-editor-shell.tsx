/**
 * Embedded Editor Shell — toolbar + canvas composition for post-agnostic
 * block-editor mounts.
 *
 * This is the BE-owned, public-primitive-only equivalent of upstream's
 * `<VisualEditor>` from `@wordpress/editor`. We deliberately do NOT consume
 * `<EditorInterface>` / `<VisualEditor>` / `<DocumentTools>` from upstream:
 *
 * - Those components are NOT publicly exported (internal-only, not in
 *   `@wordpress/editor`'s `components/index.js` nor in `private-apis.js`).
 * - They are hard-coupled to a post entity (read `getCurrentPostId`,
 *   `getCurrentPostType`, `getRenderingMode` from `editorStore`, which is
 *   only populated when `<EditorProvider>` is mounted with a real post).
 * - They consume upstream's private `unlock()` APIs pervasively
 *   (`ExperimentalBlockCanvas`, `LayoutStyle`, `getInserterSidebarToggleRef`,
 *   etc.), which would couple BE to private contracts that break across
 *   Gutenberg minor releases.
 *
 * BE consumers (bbPress replies, comments, BuddyPress, ad-hoc textareas) do
 * NOT have a post entity, so upstream's composed surfaces are structurally
 * unusable. The opt-in `<PostEntityShell>` (see `post-entity-shell.tsx`) is
 * the correct integration point when a post IS available — it wraps BE in
 * upstream's public `<EditorProvider>` + `<AutosaveMonitor>` stack without
 * BE needing to fake an entity.
 *
 * Investigation that justifies this design lives in #28. The full feasibility
 * analysis (why replatforming on `@wordpress/editor` composed surfaces is not
 * viable) is captured there. Future contributors: read #28 before asking
 * "should we use `<EditorInterface>` here?" — the answer is no, and the
 * reasoning is documented.
 *
 * Public-API equivalent of `<VisualEditor>`:
 *
 *   <BlockCanvas height="100%" styles={ ... } />
 *
 * `<BlockCanvas>` is self-contained: it renders its own `<BlockTools>`, the
 * `<Iframe name="editor-canvas">`, and wires WritingFlow + keyboard-nav hooks
 * to the editable content INSIDE the iframe. BE must NOT wrap it in a second
 * `<BlockTools>`/`<WritingFlow>`/`<ObserveTyping>` — doing so attaches
 * arrow-key handlers to the host document where the caret never lives, and
 * left/right arrow navigation goes dead (a previous composition did exactly
 * that; see the comment next to the `<BlockCanvas>` render below).
 *
 * The flex-height contract still holds: pass `height="100%"`, paired with
 * `display: flex; flex-direction: column` on `.blocks-everywhere-editor` and
 * `flex: 1` on `.blocks-everywhere-editor__body` so `height: 100%` resolves to
 * the remaining space below the toolbar. See `editor.scss`.
 */

/**
 * External dependencies
 */
import type { ReactNode } from 'react';

/**
 * WordPress dependencies
 */
import {
	BlockCanvas,
	BlockEditorKeyboardShortcuts,
	BlockToolbar,
	Inserter,
	// Gutenberg portability gap: List View reads from `core/block-editor` and is
	// exactly the primitive BE needs, but Gutenberg only exports it as
	// `__experimentalListView` today. BE keeps the setting stable while isolating
	// the unstable component name here.
	// @ts-ignore __experimentalListView is unstable.
	__experimentalListView as ListView,
} from '@wordpress/block-editor';
import { EditorHistoryRedo, EditorHistoryUndo, PostPreviewButton } from '@wordpress/editor';
import { Button, Dropdown, Slot } from '@wordpress/components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { fullscreen, listView as listViewIcon } from '@wordpress/icons';

/**
 * Toolbar configuration shape.
 *
 * Default toolbar matches the upstream wp-admin post editor (every primitive
 * enabled). Consumers opt OUT individual primitives via
 * `settings.blocksEverywhere.toolbar`; they never need to opt IN.
 *
 * - `inserter` — document-level "+" block inserter button.
 * - `undo` / `redo` — delegate to the core editor history.
 * - `listView` — block list-view tree (dropdown panel).
 * - `blockTools` — selected-block format toolbar (`¶ B I link`).
 */
export interface ResolvedToolbarConfig {
	inserter: boolean;
	undo: boolean;
	redo: boolean;
	listView: boolean;
	blockTools: boolean;
}

export interface ResolvedChromeConfig {
	mode: 'inline' | 'full-height' | 'modal' | 'compact';
	fullscreen: {
		active?: boolean;
		defaultActive: boolean;
		enabled: boolean;
		onChange?: ( active: boolean ) => void;
	};
	topBar: boolean;
	toolbar: boolean;
	preview: boolean;
	secondaryToolbar: boolean;
	footer: boolean;
	documentSidebar: boolean;
	inserterSidebar: boolean;
}

function resolveFullscreenActive( chrome: ResolvedChromeConfig, localActive: boolean ): boolean {
	return typeof chrome.fullscreen.active === 'boolean' ? chrome.fullscreen.active : localActive;
}

interface EmbeddedEditorShellProps {
	/** Resolved toolbar configuration (already merged with persistent-sidebar suppression). */
	toolbar: ResolvedToolbarConfig;
	/** Resolved shell chrome configuration. */
	chrome: ResolvedChromeConfig;
	/** Whether the shell is mounted in a canonical post EditorProvider. */
	hasCanonicalPost: boolean;
	/** Editor styles passed through to the iframe canvas. */
	styles?: unknown[];
	/** Optional extra className applied to the editor wrapper. */
	className?: string;
	/** Children rendered after the canvas body (e.g. registered slot fills, bridges). */
	children?: ReactNode;
}

let fullscreenLockCount = 0;

/**
 * Toggle button + dropdown panel that exposes the block list view.
 *
 * Built on Gutenberg's post-agnostic list-view primitive. The export is still
 * experimental, but the BE contract is the stable `toolbar.listView` option,
 * not the upstream component name. The dropdown keeps the panel self-contained
 * inside the BE toolbar; no external sidebar plumbing is required.
 */
function ListViewToggle(): JSX.Element {
	return (
		<Dropdown
			className="blocks-everywhere-editor__list-view-toggle"
			contentClassName="blocks-everywhere-editor__list-view-panel"
			popoverProps={ { placement: 'bottom-start' } }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					icon={ listViewIcon }
					label={ __( 'Document Overview' ) }
					onClick={ onToggle }
					aria-expanded={ isOpen }
					isPressed={ isOpen }
					showTooltip
				/>
			) }
			renderContent={ () => (
				/* @ts-ignore __experimentalListView is unstable */
				<ListView />
			) }
		/>
	);
}

/**
 * Toolbar + canvas composition for an embedded, post-agnostic block editor.
 *
 * Must be rendered inside a `<SlotFillProvider>` + `<BlockEditorProvider>`
 * tree (see `EmbeddedBlockEditor` in `index.tsx`, which owns the provider
 * setup and the block-state contract).
 *
 * @param props           Component props.
 * @param props.toolbar   Resolved toolbar config (which primitives to render).
 * @param props.styles    Iframe canvas styles (passed to `<BlockCanvas>`).
 * @param props.className Optional extra wrapper className from the consumer.
 * @param props.children  Slot-fill consumers, theme bridges, content bridge,
 *                        etc. Rendered after the canvas body.
 */
export default function EmbeddedEditorShell( props: EmbeddedEditorShellProps ): JSX.Element {
	const { chrome, toolbar, styles, className, children, hasCanonicalPost } = props;
	const [ localFullscreenActive, setLocalFullscreenActive ] = useState( chrome.fullscreen.defaultActive );
	const fullscreenActive = chrome.fullscreen.enabled && resolveFullscreenActive( chrome, localFullscreenActive );
	// The top-bar is opt-in via `chrome.topBar` only. Fullscreen no longer
	// forces a secondary top-bar into existence — the fullscreen toggle lives
	// inside the primary toolbar (see below), so the top-bar is reserved for
	// consumers who explicitly fill the `topBar` / `windowControls` slots.
	const hasTopBar = chrome.topBar;
	const editorClassName = [
		'blocks-everywhere-editor',
		'block-editor',
		`blocks-everywhere-editor--${ chrome.mode }`,
		fullscreenActive ? 'blocks-everywhere-editor--fullscreen' : '',
		className || '',
	]
		.filter( Boolean )
		.join( ' ' );
	const setFullscreenActive = useCallback(
		( active: boolean ) => {
			if ( typeof chrome.fullscreen.active !== 'boolean' ) {
				setLocalFullscreenActive( active );
			}

			chrome.fullscreen.onChange?.( active );
		},
		[ chrome.fullscreen ]
	);

	useEffect( () => {
		if ( ! fullscreenActive ) {
			return;
		}

		const fullscreenClassName = 'blocks-everywhere-editor-is-fullscreen';
		const onKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key === 'Escape' ) {
				setFullscreenActive( false );
			}
		};

		fullscreenLockCount += 1;
		document?.body?.classList?.add( fullscreenClassName );
		document?.documentElement?.classList?.add( fullscreenClassName );
		document?.addEventListener?.( 'keydown', onKeyDown );

		return () => {
			fullscreenLockCount = Math.max( 0, fullscreenLockCount - 1 );
			if ( fullscreenLockCount === 0 ) {
				document?.body?.classList?.remove( fullscreenClassName );
				document?.documentElement?.classList?.remove( fullscreenClassName );
			}
			document?.removeEventListener?.( 'keydown', onKeyDown );
		};
	}, [ fullscreenActive, setFullscreenActive ] );

	return (
		<>
			<div className={ editorClassName }>
				{ hasTopBar && (
					<div className="blocks-everywhere-editor__top-bar">
						<Slot name="blocks-everywhere/topBar" />
						<div className="blocks-everywhere-editor__window-controls">
							<Slot name="blocks-everywhere/windowControls" />
						</div>
					</div>
				) }
				{ chrome.toolbar && (
					<div className="blocks-everywhere-editor__toolbar">
						<Slot name="blocks-everywhere/heading" />
						{ toolbar.inserter && <Inserter rootClientId={ null } /> }
						{ toolbar.undo && <EditorHistoryUndo /> }
						{ toolbar.redo && <EditorHistoryRedo /> }
						{ toolbar.listView && <ListViewToggle /> }
						{ toolbar.blockTools && <BlockToolbar hideDragHandle /> }
						<Slot name="blocks-everywhere/toolbar" />
						<Slot name="blocks-everywhere/actions" />
						{ /* Gutenberg's declaration incorrectly marks all optional props as required. */ }
						{ /* @ts-expect-error See @wordpress/editor PostPreviewButton source defaults. */ }
						{ hasCanonicalPost && chrome.preview && <PostPreviewButton /> }
						{ chrome.fullscreen.enabled && (
							<Button
								className="blocks-everywhere-editor__fullscreen-toggle"
								icon={ fullscreen }
								label={ fullscreenActive ? __( 'Exit fullscreen' ) : __( 'Fullscreen' ) }
								isPressed={ fullscreenActive }
								onClick={ () => setFullscreenActive( ! fullscreenActive ) }
								showTooltip
							/>
						) }
					</div>
				) }
				{ chrome.secondaryToolbar && (
					<div className="blocks-everywhere-editor__secondary-toolbar">
						<Slot name="blocks-everywhere/secondaryToolbar" />
					</div>
				) }
				<div className="blocks-everywhere-editor__body-row">
					{ chrome.documentSidebar && (
						<aside className="blocks-everywhere-editor__sidebar blocks-everywhere-editor__sidebar--document">
							<Slot name="blocks-everywhere/documentSidebar" />
						</aside>
					) }
					<div className="blocks-everywhere-editor__body">
						<BlockEditorKeyboardShortcuts />
						<BlockEditorKeyboardShortcuts.Register />
						{ /*
						 * `<BlockCanvas>` owns the iframe + keyboard-nav wiring. It
						 * renders its OWN `<BlockTools>`, the
						 * `<Iframe name="editor-canvas">`, and binds WritingFlow +
						 * useBlockSelectionClearer + useMouseMoveTypingReset to the
						 * editable content INSIDE that iframe (its docblock says so
						 * explicitly). BE must NOT wrap it in a second
						 * `<BlockTools>`/`<WritingFlow>`/`<ObserveTyping>` — a prior
						 * composition did, attaching arrow-key handlers to the host
						 * document while the caret lives inside the iframe, so
						 * left/right arrow navigation was dead (clicks still worked
						 * because caret placement on click is native, not WritingFlow).
						 *
						 * `<BlockCanvas>` defaults `height` to `'300px'` (see
						 * `@wordpress/block-editor/src/components/block-canvas/index.js`)
						 * and sets it as an inline style on its internal wrapping
						 * `<BlockTools>`. The iframe chain inside resolves to a hard
						 * height unless we pass `height="100%"`, paired with
						 * `display:flex; flex-direction:column` on
						 * `.blocks-everywhere-editor` and `flex:1` on
						 * `.blocks-everywhere-editor__body` (see editor.scss) so the
						 * canvas fills the remaining space below the toolbar.
						 */ }
						<BlockCanvas height="100%" styles={ ( styles as never ) || [] } />
					</div>
					{ chrome.inserterSidebar && (
						<aside className="blocks-everywhere-editor__sidebar blocks-everywhere-editor__sidebar--inserter">
							<Slot name="blocks-everywhere/inserterSidebar" />
						</aside>
					) }
				</div>
				{ chrome.footer && <Slot name="blocks-everywhere/footer" /> }
			</div>
			{ children }
		</>
	);
}
