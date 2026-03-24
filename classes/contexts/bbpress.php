<?php
/**
 * bbPress context configuration for Blocks Everywhere.
 *
 * @package Automattic\Blocks_Everywhere\Contexts
 * @since   2.0.0
 */

namespace Automattic\Blocks_Everywhere\Contexts;

use Automattic\Blocks_Everywhere\Engine;

/**
 * Build the bbPress context configuration array.
 *
 * @param Engine $engine The engine instance.
 * @return array
 */
function bbpress_context( Engine $engine ) {
	$default_bbpress = defined( 'BLOCKS_EVERYWHERE_BBPRESS' ) ? BLOCKS_EVERYWHERE_BBPRESS : false;

	// Backward-compatible filter — if false, don't register.
	if ( ! apply_filters( 'blocks_everywhere_bbpress', $default_bbpress ) ) {
		return null;
	}

	// Build content display filters using the callback factory.
	$display_filters = [];
	foreach ( [ 'bbp_get_forum_content', 'bbp_get_topic_content', 'bbp_get_reply_content' ] as $hook ) {
		$display_filters[] = [ $hook, bbpress_make_content_display_callback( $engine, $hook ), 8 ];
	}

	// Email filters (conditional).
	$default_email = defined( 'BLOCKS_EVERYWHERE_EMAIL' ) ? BLOCKS_EVERYWHERE_EMAIL : false;
	$email_enabled = apply_filters( 'blocks_everywhere_email', $default_email );

	if ( $email_enabled ) {
		$display_filters[] = [
			'bbp_subscription_mail_message',
			function ( $content, $reply_id ) use ( $engine ) {
				return bbpress_remove_blocks_from_reply( $engine, $content, $reply_id );
			},
			10,
		];
		$display_filters[] = [
			'bbp_forum_subscription_mail_message',
			function ( $content, $topic_id ) use ( $engine ) {
				return bbpress_remove_blocks_from_topic( $engine, $content, $topic_id );
			},
			10,
		];
	}

	// Save filters — each gets empty block check + pasted image cleanup.
	$save_filter_names = [
		'bbp_new_topic_pre_content',
		'bbp_edit_topic_pre_content',
		'bbp_new_reply_pre_content',
		'bbp_edit_reply_pre_content',
		'bbp_new_forum_pre_content',
		'bbp_edit_forum_pre_content',
	];

	$save_filters = [];
	foreach ( $save_filter_names as $filter ) {
		// Standard empty block check (handled by engine).
		$save_filters[] = $filter;
	}

	// Also add pasted image cleanup to each save filter.
	foreach ( $save_filter_names as $filter ) {
		$save_filters[] = [
			$filter,
			__NAMESPACE__ . '\\bbpress_convert_pasted_images',
			12,
		];
	}

	// Attachment reparenting (EC-specific, hookable).
	$save_filters[] = [
		'bbp_new_topic',
		__NAMESPACE__ . '\\bbpress_reparent_attachments',
		10,
	];

	$default_admin = defined( 'BLOCKS_EVERYWHERE_BBPRESS_ADMIN' ) ? BLOCKS_EVERYWHERE_BBPRESS_ADMIN : false;
	$bbpress_admin_enabled = is_admin() && apply_filters( 'blocks_everywhere_bbpress_admin', $default_admin );

	return [
		'type'             => 'bbpress',
		'textarea'         => '.bbp-the-content',
		'container'        => '.blocks-everywhere',
		'trigger'          => 'bbp_template_redirect',
		'trigger_priority' => 8,
		'condition'        => function () {
			$can_load = apply_filters( 'blocks_everywhere_bbpress_editor', true );

			if ( ! $can_load && ! bbpress_is_editing_blocks() ) {
				return false;
			}

			return is_user_logged_in();
		},
		'body_class_hook'  => 'bbp_head',
		'admin_hook'       => null,
		'admin_textarea'   => '.wp-editor-area',
		'admin_condition'  => $bbpress_admin_enabled ? function ( $hook ) {
			// Always show in admin when bbPress admin is enabled.
			return true;
		} : null,
		'kses_filter'      => 'bbp_kses_allowed_tags',
		'content_filters'  => $display_filters,
		'save_filters'     => $save_filters,
		'disable_tinymce'  => true,
		'wrap_textarea'    => true,
		'metadata'         => function () {
			return [
				'bbpress' => [
					'topicId'     => bbpress_get_current_topic_id(),
					'forumId'     => bbpress_get_current_forum_id(),
					'isTopicEdit' => function_exists( 'bbp_is_topic_edit' ) ? (bool) bbp_is_topic_edit() : false,
					'isReplyEdit' => function_exists( 'bbp_is_reply_edit' ) ? (bool) bbp_is_reply_edit() : false,
				],
			];
		},
		'setup_kses'       => true,
		'kses_workaround'  => 'bbpress',
		'remove_filters'   => [
			[ 'bbp_get_form_forum_content', 'bbp_code_trick_reverse' ],
			[ 'bbp_get_form_topic_content', 'bbp_code_trick_reverse' ],
			[ 'bbp_get_form_reply_content', 'bbp_code_trick_reverse' ],
		],
		'view_assets'      => true,
		// Gutenberg CPT support in admin.
		'admin_editor'     => $bbpress_admin_enabled,
	];
}

/**
 * Wire bbPress admin-specific hooks that run outside the normal trigger flow.
 *
 * Called from the bootstrap when the bbPress context is active and admin editing is enabled.
 *
 * @param Engine $engine The engine instance.
 */
function bbpress_wire_admin( Engine $engine ) {
	$default_admin = defined( 'BLOCKS_EVERYWHERE_BBPRESS_ADMIN' ) ? BLOCKS_EVERYWHERE_BBPRESS_ADMIN : false;

	if ( ! is_admin() || ! apply_filters( 'blocks_everywhere_bbpress_admin', $default_admin ) ) {
		return;
	}

	// Load editor on admin bbPress pages.
	add_action(
		'bbp_ready',
		function () use ( $engine ) {
			$engine->load_editor_for_context( 'bbpress' );
		}
	);

	// Gutenberg CPT support.
	$default_gutenberg_admin = defined( 'BLOCKS_EVERYWHERE_ADMIN' ) ? BLOCKS_EVERYWHERE_ADMIN : false;
	if ( apply_filters( 'blocks_everywhere_admin', $default_gutenberg_admin ) ) {
		$cap = apply_filters( 'blocks_everywhere_admin_cap', 'manage_options' );

		if ( current_user_can( $cap ) ) {
			add_filter( 'bbp_register_topic_post_type', __NAMESPACE__ . '\\bbpress_support_gutenberg' );
			add_filter( 'bbp_register_reply_post_type', __NAMESPACE__ . '\\bbpress_support_gutenberg' );
			add_filter( 'bbp_register_forum_post_type', __NAMESPACE__ . '\\bbpress_support_gutenberg' );
		}
	}
}
