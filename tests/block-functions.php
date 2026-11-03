<?php
/**
 * Lightweight WordPress block test harness. Parser fixtures are unmodified
 * WordPress core (GPL-2.0-or-later); rendering records callbacks without booting WP.
 */
require_once __DIR__ . '/fixtures/wordpress/class-wp-block-parser.php';

function parse_blocks( $content ) {
	return ( new WP_Block_Parser() )->parse( $content );
}

function serialize_blocks( $blocks ) {
	return implode( '', array_map( 'serialize_block', $blocks ) );
}

function serialize_block( $block ) {
	$content = '';
	$index = 0;
	foreach ( $block['innerContent'] as $chunk ) {
		$content .= is_string( $chunk ) ? $chunk : serialize_block( $block['innerBlocks'][ $index++ ] );
	}
	if ( null === $block['blockName'] ) {
		return $content;
	}
	$name = preg_replace( '#^core/#', '', $block['blockName'] );
	$attrs = empty( $block['attrs'] ) ? '' : strtr(
		json_encode( $block['attrs'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ),
		[ '--' => '\\u002d\\u002d', '<' => '\\u003c', '>' => '\\u003e', '&' => '\\u0026' ]
	) . ' ';
	return '' === $content
		? "<!-- wp:$name $attrs/-->"
		: "<!-- wp:$name $attrs-->$content<!-- /wp:$name -->";
}

function render_block( $block ) {
	$GLOBALS['__rendered_blocks'][] = $block['blockName'];
	$content = '';
	$index = 0;
	foreach ( $block['innerContent'] as $chunk ) {
		$content .= is_string( $chunk ) ? $chunk : render_block( $block['innerBlocks'][ $index++ ] );
	}
	return $content;
}

function has_blocks( $content ) {
	return false !== strpos( $content, '<!-- wp:' );
}

function wp_slash( $content ) {
	return addslashes( $content );
}

function wp_unslash( $content ) {
	return stripslashes( $content );
}

function wp_strip_all_tags( $content ) {
	return strip_tags( $content );
}

function remove_action( $hook, $callback, $priority = 10 ) {
	remove_filter( $hook, $callback, $priority );
}
