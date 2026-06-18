/**
 * External-edit refresh receiver.
 *
 * Generic primitive: "when I am told the post I am editing changed externally,
 * refetch (or accept supplied) content and replace my in-memory content safely,
 * without re-clobbering it on the next autosave."
 *
 * This is transport-agnostic and host-agnostic. Blocks Everywhere does NOT know
 * who triggers the refresh or why. It listens for a generic, BE-owned client
 * event — `blocksEverywhere:refresh-content` — whose `detail` carries the target
 * post identity (and optionally the new content). A thin host adapter is
 * responsible for translating any upstream signal (an external agent accepting
 * an edit, a collaborator save, etc.) into this BE-generic event. That adapter
 * is the only layer that knows both names; BE knows only its own event.
 *
 * ## Post identity
 *
 * BE editor mounts are post-agnostic at this seam: the host owns post identity
 * (the Compose tab, the forum composer, etc. each track their own active post).
 * So the receiver must be TOLD which post to watch. The host supplies a
 * `watchPostId` resolver (value or getter) via
 * `settings.blocksEverywhere.refresh.watchPostId`; the receiver only reacts to
 * events whose `postId` matches the currently-watched post. Events for a
 * different post are ignored. When no `watchPostId` is configured, the receiver
 * never matches (safe no-op) — a mount that has not opted in is never disturbed.
 *
 * ## Refetch vs. payload
 *
 * Refetch is the safe default: the single source of truth is the post that was
 * just written server-side, not whatever content rode along on the event. BE is
 * transport-agnostic, so it cannot fetch on its own — the host provides a
 * `fetchContent` callback (returns the post's current serialized block HTML).
 * If the event explicitly carries `content` AND the host does not provide a
 * fetcher, the receiver falls back to the supplied content. If neither is
 * available, the refresh is a no-op.
 *
 * ## Re-clobber guard
 *
 * Replacing content must not leave the host's autosave baseline pointing at the
 * stale content, or the next autosave would overwrite the external edit. After
 * the content API replaces the blocks, the receiver invokes a host-provided
 * `onRefreshed( html )` callback so the host can reset its own autosave baseline
 * (e.g. `lastSavedPayload`, content snapshot) to the freshly-applied content.
 * The host is also given a `beforeRefresh()` hook to cancel/await any in-flight
 * autosave before the replace happens. Both hooks are optional.
 */

/**
 * Internal dependencies
 */
import type { BlocksEverywhereContentApi } from './content-bridge';

/**
 * The generic, BE-owned client event a host adapter dispatches to ask an open
 * editor to refresh its content because the underlying post changed externally.
 */
export const REFRESH_CONTENT_EVENT = 'blocksEverywhere:refresh-content';

/**
 * `detail` payload of the {@link REFRESH_CONTENT_EVENT} event.
 */
export interface RefreshContentEventDetail {
	/** Numeric id of the post that changed externally. Required for matching. */
	postId?: number | string;
	/** Optional blog id (multisite). Passed through to the host fetcher. */
	blogId?: number | string;
	/**
	 * Optional pre-resolved serialized block HTML. Used only as a fallback when
	 * the host provides no `fetchContent` callback. Refetch is preferred.
	 */
	content?: string;
	/** Free-form extra context forwarded to host callbacks (e.g. tool/kind). */
	[ key: string ]: unknown;
}

/**
 * Host-supplied refresh wiring, read from
 * `settings.blocksEverywhere.refresh`.
 */
export interface RefreshConfig {
	/**
	 * Which post this editor instance is currently editing. A value or a getter
	 * (preferred — the active post can change over the editor's lifetime, e.g.
	 * the Compose draft picker). The receiver compares this against the event's
	 * `postId` and ignores non-matching events.
	 */
	watchPostId?: number | string | ( () => number | string | null | undefined );

	/**
	 * Refetch the current serialized block HTML for the changed post. Preferred
	 * over trusting `detail.content` (single source of truth = the written
	 * post). BE is transport-agnostic, so the host owns the fetch.
	 */
	fetchContent?: ( detail: RefreshContentEventDetail ) => Promise< string > | string;

	/**
	 * Invoked before the content is replaced, so the host can cancel/await any
	 * in-flight autosave. May return a promise the receiver awaits.
	 */
	beforeRefresh?: ( detail: RefreshContentEventDetail ) => Promise< void > | void;

	/**
	 * Invoked after the content has been replaced, with the HTML that was
	 * applied. The host resets its autosave baseline here so the next autosave
	 * carries the external edit forward instead of re-clobbering it.
	 */
	onRefreshed?: ( html: string, detail: RefreshContentEventDetail ) => void;
}

function getRefreshConfig( settings: unknown ): RefreshConfig | null {
	const refresh = ( settings as { blocksEverywhere?: { refresh?: unknown } } )?.blocksEverywhere?.refresh;
	return refresh && typeof refresh === 'object' ? ( refresh as RefreshConfig ) : null;
}

function resolveWatchedPostId( config: RefreshConfig ): string | null {
	const raw = typeof config.watchPostId === 'function' ? config.watchPostId() : config.watchPostId;
	if ( raw === undefined || raw === null || raw === '' ) {
		return null;
	}
	return String( raw );
}

function detailPostId( detail: RefreshContentEventDetail | undefined ): string | null {
	const raw = detail?.postId;
	if ( raw === undefined || raw === null || raw === '' ) {
		return null;
	}
	return String( raw );
}

/**
 * Install the external-edit refresh receiver for a single editor mount.
 *
 * No-op (returns a no-op cleanup) when the host has not configured
 * `settings.blocksEverywhere.refresh`. Otherwise listens on `document` for the
 * BE-generic refresh event and, on a post-id match, refetches/replaces content
 * with the re-clobber guard.
 *
 * @param  textarea The mount's backing textarea (carries the content API).
 * @param  settings The resolved mount settings.
 * @return {() => void} Cleanup function that removes the listener.
 */
export function installRefreshReceiver( textarea: HTMLTextAreaElement, settings: unknown ): () => void {
	const config = getRefreshConfig( settings );
	if ( ! config ) {
		return () => {};
	}

	let isRefreshing = false;

	const handler = ( event: Event ): void => {
		const detail = ( event as CustomEvent< RefreshContentEventDetail > ).detail || {};

		const watchedId = resolveWatchedPostId( config );
		const incomingId = detailPostId( detail );
		// Ignore events for a different (or unknown) post, and mounts that are
		// not currently watching any post.
		if ( ! watchedId || ! incomingId || watchedId !== incomingId ) {
			return;
		}

		// Coalesce: ignore re-entrant events while a refresh is mid-flight.
		if ( isRefreshing ) {
			return;
		}
		isRefreshing = true;

		void ( async (): Promise< void > => {
			try {
				// Let the host quiesce its autosave before we mutate content.
				await config.beforeRefresh?.( detail );

				// Refetch is the source of truth. Fall back to supplied content
				// only when the host provides no fetcher.
				let html: string | null = null;
				if ( typeof config.fetchContent === 'function' ) {
					const fetched = await config.fetchContent( detail );
					html = typeof fetched === 'string' ? fetched : null;
				} else if ( typeof detail.content === 'string' ) {
					html = detail.content;
				}

				if ( html === null ) {
					return;
				}

				const api: BlocksEverywhereContentApi | null = textarea?.__blocksEverywhereContentApi ?? null;
				if ( ! api ) {
					return;
				}

				// Replace resets the editor's in-memory content to the external
				// content; the next autosave now carries it forward.
				api.replaceContent( html );

				// Let the host reset its autosave baseline to the applied HTML so
				// it does not immediately re-save the stale snapshot.
				config.onRefreshed?.( html, detail );
			} catch ( error ) {
				// eslint-disable-next-line no-console
				console.error( 'Blocks Everywhere: external-edit refresh failed', error );
			} finally {
				isRefreshing = false;
			}
		} )();
	};

	document.addEventListener( REFRESH_CONTENT_EVENT, handler );

	return () => {
		document.removeEventListener( REFRESH_CONTENT_EVENT, handler );
	};
}
