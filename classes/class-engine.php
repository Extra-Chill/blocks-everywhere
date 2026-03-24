<?php
/**
 * Engine — Data-driven context manager for Blocks Everywhere.
 *
 * Replaces the per-handler subclass pattern with a single class that
 * processes context configuration arrays identically. External plugins
 * register contexts via the `blocks_everywhere_contexts` filter.
 *
 * @package Automattic\Blocks_Everywhere
 * @since   2.0.0
 */

namespace Automattic\Blocks_Everywhere;

use Automattic\Blocks_Everywhere\Handler\Handler;

class Engine extends Handler {

	/**
	 * Registered contexts keyed by ID.
	 *
	 * @var array<string, array>
	 */
	private $contexts = [];

	/**
	 * Active context ID (set when an editor is loading).
	 *
	 * @var string|null
	 */
	private $active_context = null;

	/**
	 * Default config values for every context.
	 *
	 * @var array
	 */
	private static $defaults = [
		'type'              => 'core',
		'textarea'          => '',
		'container'         => '.blocks-everywhere',
		'trigger'           => null,
		'trigger_priority'  => 10,
		'condition'         => null,
		'body_class_hook'   => null,
		'admin_hook'        => null,
		'admin_textarea'    => '.wp-editor-area',
		'kses_filter'       => null,
		'content_filters'   => [],
		'save_filters'      => [],
		'disable_tinymce'   => true,
		'wrap_textarea'     => true,
		'metadata'          => null,
		'setup_kses'        => false,
		'kses_workaround'   => null,
		'remove_filters'    => [],
		'view_assets'       => true,
		'admin_editor'      => false,
		'admin_condition'   => null,
	];

	/**
	 * Constructor — call parent to register shared assets.
	 */
	public function __construct() {
		parent::__construct();
	}

	/**
	 * Register a context configuration.
	 *
	 * @param string $id     Unique context identifier.
	 * @param array  $config Context configuration array.
	 */
	public function register_context( string $id, array $config ) {
		$this->contexts[ $id ] = wp_parse_args( $config, self::$defaults );
	}

	/**
	 * Boot — called on `init`. Collects contexts from the filter, wires
	 * trigger hooks, content display filters, and view assets.
	 */
	public function boot() {
		// Collect contexts via filter. Built-in contexts register at priority 5,
		// so third-party code at default priority 10 can add/modify/remove.
		$contexts = apply_filters( 'blocks_everywhere_contexts', [] );

		foreach ( $contexts as $id => $config ) {
			$this->register_context( $id, $config );
		}

		// Wire each context.
		foreach ( $this->contexts as $id => $config ) {
			$this->wire_context( $id, $config );
		}

		// Admin editors.
		add_action( 'admin_enqueue_scripts', [ $this, 'admin_enqueue_scripts' ] );
	}

	/**
	 * Wire a single context — trigger hooks, content filters, view assets.
	 *
	 * @param string $id     Context identifier.
	 * @param array  $config Context configuration.
	 */
	private function wire_context( string $id, array $config ) {
		// 1. Content display filters — always wire these regardless of editor load.
		foreach ( $config['content_filters'] as $filter ) {
			if ( is_array( $filter ) ) {
				// [ filter_name, callback, priority ] format.
				$filter_name = $filter[0];
				$callback    = $filter[1];
				$priority    = $filter[2] ?? 8;
				add_filter( $filter_name, $callback, $priority );
			} else {
				// Simple string — use do_blocks.
				add_filter(
					$filter,
					function ( $content ) use ( $filter ) {
						return $this->do_blocks( $content, $filter );
					},
					8
				);
			}
		}

		// 2. View assets.
		if ( $config['view_assets'] && $config['trigger'] ) {
			add_action(
				$config['trigger'],
				function () {
					$this->load_view_assets();
				},
				( $config['trigger_priority'] ?? 10 ) - 1
			);
		}

		// 3. Editor trigger hook.
		if ( $config['trigger'] ) {
			add_action(
				$config['trigger'],
				function () use ( $id ) {
					$this->load_editor_for_context( $id );
				},
				$config['trigger_priority']
			);
		}

		// 4. Metadata filter.
		if ( is_callable( $config['metadata'] ) ) {
			add_filter(
				'blocks_everywhere_editor_settings',
				function ( $settings ) use ( $config ) {
					$meta = call_user_func( $config['metadata'] );
					if ( is_array( $meta ) ) {
						$settings = array_merge( $settings, $meta );
					}
					return $settings;
				}
			);
		}
	}

	/**
	 * Load the editor for a specific context — called by the trigger hook.
	 *
	 * @param string $id Context identifier.
	 */
	public function load_editor_for_context( string $id ) {
		if ( ! isset( $this->contexts[ $id ] ) ) {
			return;
		}

		$config = $this->contexts[ $id ];

		// Check condition.
		if ( is_callable( $config['condition'] ) && ! call_user_func( $config['condition'] ) ) {
			return;
		}

		$this->active_context = $id;

		$textarea  = $config['textarea'];
		$container = $config['container'];

		// Admin override.
		if ( is_admin() && $config['admin_textarea'] ) {
			$textarea = $config['admin_textarea'];
		}

		// Wrap textarea.
		if ( $config['wrap_textarea'] || $config['disable_tinymce'] ) {
			add_filter( 'the_editor', [ $this, 'the_editor' ] );
		}

		// Disable TinyMCE/quicktags.
		if ( $config['disable_tinymce'] ) {
			add_filter( 'wp_editor_settings', [ $this, 'wp_editor_settings' ], 10, 2 );
		}

		// Load the editor.
		$this->load_editor( $textarea, $container );

		// Body class hook.
		if ( $config['body_class_hook'] ) {
			add_action(
				$config['body_class_hook'],
				function () {
					add_filter( 'body_class', [ $this, 'body_class' ] );
				}
			);
		}

		// Save filters — empty content check.
		foreach ( $config['save_filters'] as $filter ) {
			if ( is_array( $filter ) ) {
				// [ filter_name, callback, priority ] format.
				$filter_name = $filter[0];
				$callback    = $filter[1];
				$priority    = $filter[2] ?? 12;
				add_filter( $filter_name, $callback, $priority );
			} else {
				add_filter( $filter, [ $this, 'no_empty_block_content' ], 12 );
			}
		}

		// KSES setup.
		if ( $config['setup_kses'] && ! current_user_can( 'unfiltered_html' ) ) {
			$this->setup_kses_for_context( $config );
		}

		// Remove conflicting filters.
		foreach ( $config['remove_filters'] as $removal ) {
			if ( is_array( $removal ) && count( $removal ) >= 2 ) {
				remove_filter( $removal[0], $removal[1] );
			}
		}
	}

	/**
	 * Set up KSES for a context.
	 *
	 * @param array $config Context configuration.
	 */
	private function setup_kses_for_context( array $config ) {
		if ( $config['kses_workaround'] === 'bbpress' ) {
			// bbPress-specific: allow block comments through bbp_encode_bad.
			$save_filter_names = [];
			foreach ( $config['save_filters'] as $filter ) {
				$save_filter_names[] = is_array( $filter ) ? $filter[0] : $filter;
			}

			foreach ( $save_filter_names as $filter ) {
				add_filter( $filter, 'Automattic\Blocks_Everywhere\Contexts\bbpress_allow_comments_pre', 9 );
				add_filter( $filter, 'Automattic\Blocks_Everywhere\Contexts\bbpress_allow_comments_post', 11 );
			}
		}

		// Add KSES tags for blocks.
		$kses_filter = $config['kses_filter'] ?? 'wp_kses_allowed_html';
		if ( $kses_filter === 'wp_kses_allowed_html' ) {
			// Comments-style: context-aware KSES.
			add_filter(
				'wp_kses_allowed_html',
				function ( $tags, $context ) {
					if ( 'pre_comment_content' === $context ) {
						$tags = $this->get_kses_for_allowed_blocks( $tags );
					}
					return $tags;
				},
				10,
				2
			);
		} else {
			add_filter( $kses_filter, [ $this, 'get_kses_for_allowed_blocks' ] );
		}
	}

	/**
	 * Get the editor type for the currently active context.
	 *
	 * @return string
	 */
	public function get_editor_type() {
		if ( $this->active_context && isset( $this->contexts[ $this->active_context ] ) ) {
			return $this->contexts[ $this->active_context ]['type'];
		}

		return 'core';
	}

	/**
	 * Filter bbPress content and check for an empty block. Replace it with empty
	 * content so the host system can detect it.
	 *
	 * @param string $content Content.
	 * @return string
	 */
	public function no_empty_block_content( $content ) {
		$stripped = do_blocks( $content );
		$stripped = wp_strip_all_tags( $stripped );
		$stripped = trim( $stripped );

		if ( empty( $stripped ) ) {
			return '';
		}

		return $content;
	}

	/**
	 * Body class callback — adds editor indicator classes.
	 *
	 * @param string[] $classes Body classes.
	 * @return string[]
	 */
	public function body_class( $classes ) {
		$classes[] = 'gutenberg-support';

		$can_upload = false;
		if ( isset( $this->settings['editor']['hasUploadPermissions'] ) && $this->settings['editor']['hasUploadPermissions'] ) {
			$can_upload = true;
		}

		if ( $can_upload ) {
			$classes[] = 'gutenberg-support-upload';
		}

		return $classes;
	}

	/**
	 * Admin editor support — check all contexts for admin_hook matches.
	 *
	 * @param string $hook Admin page hook.
	 */
	public function admin_enqueue_scripts( $hook ) {
		foreach ( $this->contexts as $id => $config ) {
			$can_show = false;

			if ( is_callable( $config['admin_condition'] ) ) {
				$can_show = call_user_func( $config['admin_condition'], $hook );
			} elseif ( $config['admin_hook'] ) {
				$can_show = ( $hook === $config['admin_hook'] );
			}

			if ( $can_show ) {
				$this->active_context = $id;

				add_action(
					'admin_head',
					function () {
						add_filter( 'the_editor', [ $this, 'the_editor' ] );
						add_filter( 'wp_editor_settings', [ $this, 'wp_editor_settings' ], 10, 2 );
					}
				);

				// Stops a problem with the Gutenberg plugin accessing widgets that don't exist.
				remove_action( 'admin_footer', 'gutenberg_block_editor_admin_footer' );

				add_action(
					'in_admin_header',
					function () use ( $config ) {
						$this->load_editor( $config['admin_textarea'] );
					}
				);

				break;
			}
		}
	}

	/**
	 * Get a registered context config by ID.
	 *
	 * @param string $id Context identifier.
	 * @return array|null
	 */
	public function get_context( string $id ) {
		return $this->contexts[ $id ] ?? null;
	}

	/**
	 * Get all registered context IDs.
	 *
	 * @return string[]
	 */
	public function get_context_ids() {
		return array_keys( $this->contexts );
	}
}
