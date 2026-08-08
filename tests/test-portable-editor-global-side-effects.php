<?php

use PHPUnit\Framework\TestCase;

// phpcs:ignore
class Portable_Editor_Global_Side_Effects_Test extends TestCase {
	// phpcs:disable WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Local fixture source reads.
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

	public function test_each_editor_owns_an_isolated_block_editor_store() {
		$boundary_source = file_get_contents( dirname( __DIR__ ) . '/src/editor/editor-data-boundary.tsx' );
		$editor_source   = file_get_contents( dirname( __DIR__ ) . '/src/editor/index.tsx' );

		$this->assertStringContainsString( 'createRegistry( {}, parentRegistry )', $boundary_source );
		$this->assertStringContainsString( 'registry.register( blockEditorStore )', $boundary_source );
		$this->assertStringContainsString( '<EditorDataBoundary', $boundary_source );
		$this->assertStringContainsString( 'useSubRegistry={ false }', $editor_source );
	}

	public function test_format_restrictions_are_instance_scoped() {
		$bootstrap_source = file_get_contents( dirname( __DIR__ ) . '/src/index.tsx' );
		$settings_source  = file_get_contents( dirname( __DIR__ ) . '/src/editor/settings.ts' );
		$paragraph_source = file_get_contents( dirname( __DIR__ ) . '/src/block-customization/paragraph/edit.tsx' );

		$this->assertStringNotContainsString( 'unregisterFormatType', $bootstrap_source );
		$this->assertStringContainsString( 'allowedFormats: formatTypes', $settings_source );
		$this->assertStringContainsString( 'allowedFormats={ allowedFormats }', $paragraph_source );
	}
	// phpcs:enable WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
}
