<?php

use Automattic\Blocks_Everywhere\Engine;
use PHPUnit\Framework\TestCase;

// phpcs:ignore
class WP_oEmbed_Controller {
}

// phpcs:ignore
class Blocks_Everywhere_REST_Request {
	private $route;
	private $method;
	private $params;

	public function __construct( $route, $method = 'GET', $params = [] ) {
		$this->route  = $route;
		$this->method = $method;
		$this->params = $params;
	}

	public function get_route() {
		return $this->route;
	}

	public function get_method() {
		return $this->method;
	}

	public function get_param( $name ) {
		return $this->params[ $name ] ?? null;
	}
}

// phpcs:ignore
class OEmbed_Permissions_Test extends TestCase {
	protected function setUp(): void {
		$GLOBALS['__wp_filters']       = [];
		$GLOBALS['__wp_current_filter'] = [];
		$GLOBALS['__current_user_caps'] = [];
	}

	public function test_context_authorized_user_can_proxy_oembed_request() {
		$engine = $this->boot_engine();
		$GLOBALS['__current_user_caps']['publish_topics'] = true;
		$request = new Blocks_Everywhere_REST_Request(
			'/oembed/1.0/proxy',
			'GET',
			[ 'url' => 'https://www.youtube.com/shorts/-VcOpQ_5kTQ' ]
		);
		$endpoints = $engine->add_context_oembed_permissions( $this->get_endpoints() );

		$this->assertTrue( call_user_func( $endpoints['/oembed/1.0/proxy'][0]['permission_callback'], $request ) );
		$this->assertFalse( current_user_can( 'edit_posts' ) );
	}

	public function test_unauthorized_user_remains_subject_to_core_permissions() {
		$engine  = $this->boot_engine();
		$request = new Blocks_Everywhere_REST_Request(
			'/oembed/1.0/proxy',
			'GET',
			[ 'url' => 'https://www.youtube.com/watch?v=abc123' ]
		);
		$endpoints = $engine->add_context_oembed_permissions( $this->get_endpoints() );

		$this->assertFalse( call_user_func( $endpoints['/oembed/1.0/proxy'][0]['permission_callback'], $request ) );
		$this->assertFalse( current_user_can( 'edit_posts' ) );
	}

	public function test_context_author_cannot_proxy_discovered_provider() {
		$engine = $this->boot_engine();
		$GLOBALS['__current_user_caps']['publish_topics'] = true;
		$request = new Blocks_Everywhere_REST_Request(
			'/oembed/1.0/proxy',
			'GET',
			[ 'url' => 'https://example.com/embed-me' ]
		);
		$endpoints = $engine->add_context_oembed_permissions( $this->get_endpoints() );

		$this->assertFalse( call_user_func( $endpoints['/oembed/1.0/proxy'][0]['permission_callback'], $request ) );
		$this->assertFalse( current_user_can( 'edit_posts' ) );
	}

	public function test_provider_name_in_an_untrusted_host_does_not_bypass_permission() {
		$engine = $this->boot_engine();
		$GLOBALS['__current_user_caps']['publish_topics'] = true;
		$request = new Blocks_Everywhere_REST_Request(
			'/oembed/1.0/proxy',
			'GET',
			[ 'url' => 'https://example.com/youtube.com/shorts/-VcOpQ_5kTQ' ]
		);
		$endpoints = $engine->add_context_oembed_permissions( $this->get_endpoints() );

		$this->assertFalse( call_user_func( $endpoints['/oembed/1.0/proxy'][0]['permission_callback'], $request ) );
	}

	private function get_endpoints() {
		return [
			'/oembed/1.0/proxy' => [
				[
					'callback'            => [ new WP_oEmbed_Controller(), 'get_proxy_item' ],
					'permission_callback' => function () {
						return current_user_can( 'edit_posts' );
					},
				],
			],
		];
	}

	private function boot_engine() {
		add_filter(
			'blocks_everywhere_contexts',
			function ( $contexts ) {
				$contexts['forum'] = [
					'type'              => 'forum',
					'textarea'          => '#content',
					'oembed_permission' => function () {
						return current_user_can( 'publish_topics' );
					},
				];

				return $contexts;
			}
		);

		$engine = new Engine();
		$engine->boot();

		return $engine;
	}
}
