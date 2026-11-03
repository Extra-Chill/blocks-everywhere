<?php

use Automattic\Blocks_Everywhere\Engine;
use PHPUnit\Framework\TestCase;
use function Automattic\Blocks_Everywhere\Contexts\bbpress_context;
use function Automattic\Blocks_Everywhere\Contexts\buddypress_context;
use function Automattic\Blocks_Everywhere\Contexts\comments_context;

class Context_Allowlist_Test extends TestCase {
	private $engine;
	private $content = '<!-- wp:quote --><blockquote><!-- wp:paragraph {"className":"kept"} --><p>safe</p><!-- /wp:paragraph --><!-- wp:rss /--><!-- wp:paragraph --><p>last</p><!-- /wp:paragraph --></blockquote><!-- /wp:quote -->';

	protected function setUp(): void {
		$GLOBALS['__wp_filters'] = [];
		$GLOBALS['__wp_current_filter'] = [];
		$GLOBALS['__rendered_blocks'] = [];
		$GLOBALS['allowedtags'] = [];
		$this->engine = new Engine();
		add_filter( 'blocks_everywhere_allowed_blocks', function ( $allowed, $type ) {
			// No active editor: the hook must still supply its actual context type.
			return in_array( $type, [ 'bbpress', 'buddypress', 'comments' ], true )
				? [ 'core/quote', 'core/paragraph' ] : [];
		}, 10, 2 );
		foreach ( [ 'bbpress', 'buddypress', 'comments' ] as $type ) {
			add_filter( 'blocks_everywhere_' . $type, function () { return true; } );
		}
		bbpress_context( $this->engine );
		buddypress_context( $this->engine );
		comments_context( $this->engine );
		$GLOBALS['wp_embed'] = new class {
			public function autoembed( $content ) { return $content; }
		};
	}

	public function testSaveFiltersWithoutEditor() {
		foreach ( [ 'bbp_new_topic_pre_content', 'bbp_edit_topic_pre_content', 'bbp_new_reply_pre_content', 'bbp_edit_reply_pre_content', 'bbp_new_forum_pre_content', 'bbp_edit_forum_pre_content', 'pre_comment_content' ] as $hook ) {
			$saved = wp_unslash( apply_filters( $hook, wp_slash( $this->content ) ) );
			$this->assertStringNotContainsString( 'wp:rss', $saved, $hook );
			$this->assertStringContainsString( '"className":"kept"', $saved );
			$blocks = parse_blocks( $saved );
			$this->assertCount( 2, $blocks[0]['innerBlocks'] );
			$this->assertSame( $saved, serialize_blocks( $blocks ) );
		}
		$this->assertStringNotContainsString( 'wp:rss', apply_filters( 'bp_activity_content_before_save', $this->content ) );
		$this->assertSame( 'core', $this->engine->get_editor_type() );
	}

	public function testRenderFiltersExistingStoredContent() {
		foreach ( [ 'bbp_get_forum_content', 'bbp_get_topic_content', 'bbp_get_reply_content', 'bp_get_activity_content_body', 'comment_text' ] as $hook ) {
			$this->assertSame( '<blockquote><p>safe</p><p>last</p></blockquote>', apply_filters( $hook, $this->content ), $hook );
		}
		$this->assertNotContains( 'core/rss', $GLOBALS['__rendered_blocks'] );
		$this->assertContains( 'core/paragraph', $GLOBALS['__rendered_blocks'] );
	}

	public function testPlainContentIsUnchanged() {
		$plain = ' plain <b>HTML</b> and &lt;!-- wp:rss /--&gt;';
		$this->assertSame( $plain, $this->engine->remove_blocks( $plain ) );
	}

	public function testParserDelimitersDoNotDependOnHasBlocks() {
		$content = "<!--\twp:rss /-->";
		$this->assertFalse( has_blocks( $content ) );
		$this->assertSame( '', $this->engine->remove_blocks( $content ) );
	}

	public function testEmptyContentCheckNeverRendersDisallowedBlocks() {
		$this->assertSame( '', $this->engine->filter_context_content( 'bbpress', 'no_empty_block_content', '<!-- wp:rss /-->' ) );
		$this->assertNotContains( 'core/rss', $GLOBALS['__rendered_blocks'] );
	}
}
