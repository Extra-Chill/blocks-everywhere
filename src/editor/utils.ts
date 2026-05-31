export function toArray< T >( value: T | T[] | undefined ): T[] {
	if ( Array.isArray( value ) ) {
		return value;
	}

	return value ? [ value ] : [];
}

export function isPlainObject( value ) {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}

export function cloneSettingsValue( value ) {
	if ( Array.isArray( value ) ) {
		return [ ...value ];
	}

	if ( isPlainObject( value ) ) {
		return Object.keys( value ).reduce( ( next, key ) => {
			next[ key ] = cloneSettingsValue( value[ key ] );
			return next;
		}, {} );
	}

	return value;
}

export function mergeSettingsValue( base, override ) {
	if ( override === undefined ) {
		return cloneSettingsValue( base );
	}

	if ( Array.isArray( override ) ) {
		return [ ...override ];
	}

	if ( isPlainObject( base ) && isPlainObject( override ) ) {
		const merged = { ...cloneSettingsValue( base ) };
		Object.keys( override ).forEach( ( key ) => {
			merged[ key ] = mergeSettingsValue( merged[ key ], override[ key ] );
		} );

		return merged;
	}

	return cloneSettingsValue( override );
}

export function mergeSettings( base, override ) {
	return mergeSettingsValue( base || {}, override || {} );
}

export function normalizeModeNames( mode ) {
	const modes = Array.isArray( mode ) ? mode : [ mode ];
	return modes.map( ( name ) => String( name || '' ).trim() ).filter( Boolean );
}
