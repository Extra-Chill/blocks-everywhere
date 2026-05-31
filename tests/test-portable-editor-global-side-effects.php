<?php

use PHPUnit\Framework\TestCase;

// phpcs:ignore
class Portable_Editor_Global_Side_Effects_Test extends TestCase {
	public function test_rest_middlewares_are_resolved_per_editor_instance() {
		$bootstrap_source = file_get_contents( dirname( __DIR__ ) . '/src/index.tsx' );
		$services_source  = file_get_contents( dirname( __DIR__ ) . '/src/editor/services.ts' );

		$this->assertStringNotContainsString( 'apiFetch.use(', $bootstrap_source );
		$this->assertStringContainsString( 'function getDefaultApiFetchMiddlewares', $services_source );
		$this->assertStringContainsString( 'removeNullPostFromFileUploadMiddleware', $services_source );
		$this->assertStringContainsString( 'apiFetch.createNonceMiddleware', $services_source );
		$this->assertStringContainsString( 'apiFetchMiddlewares', $services_source );
	}

	public function test_bbpress_autocomplete_filter_lives_with_bbpress_adapter() {
		$bootstrap_source       = file_get_contents( dirname( __DIR__ ) . '/src/index.tsx' );
		$services_source        = file_get_contents( dirname( __DIR__ ) . '/src/editor/services.ts' );
		$bbpress_adapter_source = file_get_contents( dirname( __DIR__ ) . '/src/editor/bbpress-adapter.ts' );

		$this->assertStringNotContainsString( 'editor.Autocomplete.completers', $bootstrap_source );
		$this->assertStringContainsString( 'editor.Autocomplete.completers', $services_source );
		$this->assertStringContainsString( 'blocks-everywhere/autocomplete-services', $services_source );
		$this->assertStringContainsString( 'resolveAutocomplete', $bbpress_adapter_source );
	}
}
