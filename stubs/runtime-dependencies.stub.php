<?php

define( 'AUTOSAVE_INTERVAL', 60 );

class WP_Theme_JSON_Data_Gutenberg {
	/**
	 * @param array<string, mixed> $data Theme JSON data.
	 * @param string               $origin Theme JSON origin.
	 */
	public function __construct( array $data = [], $origin = 'theme' ) {}

	/**
	 * @param array<string, mixed> $new_data Theme JSON data to merge.
	 * @return $this
	 */
	public function update_with( array $new_data ) {}
}

class WP_Enqueue_Dynamic_Script {
	/**
	 * @param string $handle Script handle.
	 * @return void
	 */
	public static function enqueue_script( $handle ) {}
}

/** @return int */
function bbp_get_reply_id( $reply_id = 0 ) {}

/** @return int */
function bbp_get_topic_id( $topic_id = 0 ) {}

/** @return WP_Post|array<int|string, mixed>|null */
function bbp_get_reply( $reply, $output = OBJECT, $filter = 'raw' ) {}

/** @return bool */
function bbp_is_topic_edit() {}

/** @return bool */
function bbp_is_reply_edit() {}

/** @return bool */
function bbp_is_single_forum() {}

/** @return int */
function bbp_get_reply_topic_id( $reply_id = 0 ) {}

/** @return string */
function bbp_get_reply_content( $reply_id = 0 ) {}

/** @return string */
function bbp_get_topic_content( $topic_id = 0 ) {}
