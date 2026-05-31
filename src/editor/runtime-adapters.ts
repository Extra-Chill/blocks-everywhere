/**
 * Internal dependencies
 */
import { createBbPressAdapter } from './bbpress-adapter';
import type { EditorHostRuntimeAdapter } from './editor-services';

export function resolveHostRuntimeAdapter( options ): EditorHostRuntimeAdapter | null {
	const { container, notify, scopedApiFetch, serviceContext, services, settings, textarea } = options;
	const configuredAdapter = settings?.blocksEverywhere?.runtimeAdapter;

	if ( configuredAdapter === false || configuredAdapter === null ) {
		return null;
	}

	if ( configuredAdapter && typeof configuredAdapter === 'object' ) {
		return configuredAdapter;
	}

	if ( settings?.editorType === 'bbpress' ) {
		return createBbPressAdapter( {
			container,
			settings,
			textarea,
			services,
			serviceContext,
			scopedApiFetch,
			notifyService: notify,
		} );
	}

	return null;
}
