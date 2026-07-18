<?php

use PHPUnit\Framework\TestCase;

// phpcs:ignore
class Native_Post_Preview_Test extends TestCase {
	public function test_preview_is_opt_in_and_uses_the_public_core_component() {
		$shell = file_get_contents( dirname( __DIR__ ) . '/src/editor/embedded-editor-shell.tsx' );
		$index = file_get_contents( dirname( __DIR__ ) . '/src/editor/index.tsx' );

		$this->assertStringContainsString( 'PostPreviewButton', $shell );
		$this->assertStringContainsString( 'preview: raw?.preview === true', $index );
		$this->assertStringContainsString( 'hasCanonicalPost && chrome.preview && <PostPreviewButton />', $shell );
		$this->assertStringNotContainsString( '__unstableSaveForPreview', $shell );
	}

	public function test_preview_requires_the_canonical_editor_provider_path() {
		$provider_shell = file_get_contents( dirname( __DIR__ ) . '/src/editor/post-entity-shell.tsx' );
		$index          = file_get_contents( dirname( __DIR__ ) . '/src/editor/index.tsx' );
		$editor_shell   = file_get_contents( dirname( __DIR__ ) . '/src/editor/embedded-editor-shell.tsx' );

		$this->assertStringContainsString( 'children( true )', $provider_shell );
		$this->assertGreaterThanOrEqual( 3, substr_count( $provider_shell, 'children( false )' ) );
		$this->assertStringContainsString( 'hasCanonicalPost={ hasCanonicalPost }', $index );
		$this->assertStringContainsString( 'hasCanonicalPost && chrome.preview', $editor_shell );
	}

	public function test_non_post_behavior_and_preview_boundary_are_documented() {
		$docs   = file_get_contents( dirname( __DIR__ ) . '/docs/portable-editor-adapters.md' );
		$readme = file_get_contents( dirname( __DIR__ ) . '/README.md' );

		$this->assertStringContainsString( '`blocksEverywhere.chrome.preview`', $docs );
		$this->assertStringContainsString( 'Editor-canvas theme styles are not a frontend preview', $docs );
		$this->assertStringContainsString( 'missing, zero, and negative post IDs remain post-agnostic', $docs );
		$this->assertStringContainsString( '| `preview` | `false` |', $readme );
	}
}
