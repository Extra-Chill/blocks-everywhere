/**
 * WordPress dependencies
 */
import { createBlock } from '@wordpress/blocks';

/**
 * Internal dependencies
 */
import edit from './edit';

export default function customizeParagraph( settings ) {
	return {
		...settings,
		edit,
		transforms: {
			...settings.transforms,
			from: [
				...settings.transforms.from,
				{
					type: 'shortcode',
					tag: '[a-z][a-z0-9_-]*',
					transform: ( node, match ) =>
						createBlock( 'core/paragraph', {
							content: match.content,
						} ),
					priority: 20,
				},
				{
					type: 'raw',
					isMatch: ( node ) => node.innerText === '`',
					transform: () => null,
				},
				{
					type: 'raw',
					isMatch: ( node ) => node.nodeName.toLowerCase() === 'table',
					transform: ( node ) =>
						createBlock( 'core/paragraph', {
							content: node.innerText,
						} ),
				},
			],
		},
	};
}
