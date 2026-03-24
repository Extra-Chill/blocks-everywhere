<?php
/**
 * Comments context configuration for Blocks Everywhere.
 *
 * @package Automattic\Blocks_Everywhere\Contexts
 * @since   2.0.0
 */

namespace Automattic\Blocks_Everywhere\Contexts;

use Automattic\Blocks_Everywhere\Engine;

/**
 * Build the Comments context configuration array.
 *
 * @param Engine $engine The engine instance.
 * @return array|null
 */
function comments_context( Engine $engine ) {
	$default_comments = defined( 'BLOCKS_EVERYWHERE_COMMENTS' ) ? BLOCKS_EVERYWHERE_COMMENTS : false;

	// Backward-compatible filter.
	if ( ! apply_filters( 'blocks_everywhere_comments', $default_comments ) ) {
		return null;
	}

	// Comments need to add the container via the form defaults filter.
	add_filter( 'comment_form_defaults', function ( $defaults ) {
		$defaults['class_container'] .= ' gutenberg-comments';
		$defaults['comment_field']   .= '<div class="blocks-everywhere iso-editor__loading"></div>';
		return $defaults;
	} );

	// Pre-save block removal.
	add_filter( 'pre_comment_content', function ( $content ) use ( $engine ) {
		return $engine->remove_blocks( $content );
	} );

	return [
		'type'             => 'comments',
		'textarea'         => '#comment',
		'container'        => '.blocks-everywhere',
		'trigger'          => 'comment_form_after',
		'trigger_priority' => 10,
		'condition'        => null, // Always load when trigger fires.
		'body_class_hook'  => null,
		'admin_hook'       => 'comment.php',
		'admin_textarea'   => '.wp-editor-area',
		'kses_filter'      => 'wp_kses_allowed_html',
		'content_filters'  => [
			[
				'comment_text',
				function ( $content ) use ( $engine ) {
					return $engine->do_blocks( $content, 'comment_text' );
				},
				8,
			],
		],
		'save_filters'     => [],
		'disable_tinymce'  => true,
		'wrap_textarea'    => true,
		'metadata'         => null,
		'setup_kses'       => true,
		'kses_workaround'  => null,
		'remove_filters'   => [],
		'view_assets'      => false,
	];
}
