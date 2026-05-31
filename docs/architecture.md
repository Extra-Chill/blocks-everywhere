# Blocks Everywhere - Architecture

Blocks Everywhere provides a Gutenberg-powered editor runtime for surfaces outside the canonical WordPress post editor. The current architecture is context-driven: host integrations register context configuration, Blocks Everywhere loads the shared editor runtime, and optional client adapters connect host persistence and product behavior to the embedded editor.

## Runtime Shape

```
Host app
    owns routes, permissions, persistence, and product UI
        |
        v
Server context
    registers textarea, trigger hook, settings, assets, and render filters
        |
        v
Blocks Everywhere runtime
    loads Gutenberg packages, editor assets, chrome, block settings, and serialization
        |
        v
Client adapters
    connect content, entity state, services, lifecycle, and low-level runtime hooks
```

## Core Classes

### `Editor`

**File**: `classes/class-editor.php`

The `Editor` class owns Gutenberg asset and settings bootstrapping for embedded editor instances.

Responsibilities:

- Load editor JavaScript and CSS assets.
- Configure block editor settings through `block_editor_settings_all` and `blocks_everywhere_editor_settings`.
- Prepare media upload support when the current user can upload files.
- Provide iframe canvas assets and editor-style compatibility where WordPress does not expose a direct public primitive.
- Apply theme compatibility and block editor environment setup.

### `Handler\Handler`

**File**: `classes/class-handler.php`

The base handler is now shared infrastructure, not the extension model for new platforms. It provides common asset registration, editor wrapping, block rendering, allowed-block helpers, and editor loading methods used by the data-driven engine.

Use `blocks_everywhere_contexts` for new integrations instead of adding `Handler\*` subclasses.

### `Engine`

**File**: `classes/class-engine.php`

The `Engine` class is the server-side context manager. It replaces the old per-platform subclass pattern with configuration arrays registered through the `blocks_everywhere_contexts` filter.

Responsibilities:

- Collect context definitions.
- Wire trigger hooks that decide when an editor should load.
- Apply context-specific editor settings.
- Attach preload paths, block categories, body classes, and server-side block settings.
- Load editor assets for each active context.
- Support admin contexts through `admin_hook`.

Context registrations can provide values such as:

```php
add_filter( 'blocks_everywhere_contexts', function ( $contexts ) {
    $contexts['reply-composer'] = [
        'type'       => 'reply',
        'textarea'   => '#reply-content',
        'container'  => '.reply-editor',
        'trigger'    => 'wp',
        'condition'  => function () {
            return is_user_logged_in();
        },
        'mode'       => 'compact',
        'patterns'   => [
            [
                'name'    => 'host/reply-template',
                'title'   => 'Reply template',
                'content' => '<!-- wp:paragraph --><p>Thanks for the report.</p><!-- /wp:paragraph -->',
            ],
        ],
        'entity_bridge' => [
            'entity' => [
                'type' => 'reply',
                'id'   => get_the_ID(),
            ],
        ],
    ];

    return $contexts;
} );
```

## Client Adapter Boundaries

The embedded editor receives settings under `blocksEverywhere`. Host integrations should choose the narrowest surface that fits the behavior:

| Surface | Use for |
|---------|---------|
| `contentBridge` | Loading, serializing, saving, replacing content, and reporting dirty state. |
| `entityBridge` | Describing the host record being edited and coordinating entity edit/reset hooks. |
| `services` | Supplying callable host capabilities such as fetch, media, notices, autocomplete, autosave, and telemetry. |
| `lifecycle` | Instance-scoped load, focus, error, save, and teardown callbacks. |
| `hostAdapter` | Host-owned UI coordination and legacy lifecycle integrations. |
| `runtimeAdapter` | Low-level runtime hooks such as before-load preparation, content reactions, media upload resolution, handler installation, and cleanup. Prefer the higher-level surfaces first. |

BBPress-specific runtime behavior is implemented as a bundled client adapter in `src/editor/bbpress-adapter.ts`. The generic editor runtime selects it for `editorType === 'bbpress'`, but does not call bbPress-specific methods directly.

## Gutenberg Boundary

Blocks Everywhere composes the editor from public Gutenberg packages wherever possible:

- `@wordpress/block-editor` for canvas, block list, inserter, settings, and serialization.
- `@wordpress/editor` for canonical post editing when a real WordPress post entity is available.
- `@wordpress/data`, `@wordpress/components`, and related packages for stores and chrome.

Some chrome surfaces still depend on experimental Gutenberg exports because stable host-agnostic primitives are not available yet. Those boundaries are documented in `docs/portable-editor-adapters.md` and should stay isolated behind Blocks Everywhere settings instead of becoming host-specific contracts.

## Server Bootstrap

**File**: `blocks-everywhere.php`

The plugin bootstrap loads the core classes, creates the shared `Editor`, and boots the context engine. Platform support is registered through filters and context definitions rather than separate handler subclass files.

Typical flow:

```php
require_once BLOCKS_EVERYWHERE_DIR . 'classes/class-editor.php';
require_once BLOCKS_EVERYWHERE_DIR . 'classes/class-handler.php';
require_once BLOCKS_EVERYWHERE_DIR . 'classes/class-engine.php';

new Editor();

$engine = new Engine();
add_action( 'init', [ $engine, 'boot' ] );
```

## Hook System

Important filters:

- `blocks_everywhere_contexts` registers server contexts for editor surfaces.
- `blocks_everywhere_editor_settings` customizes the settings sent to editor instances.
- `blocks_everywhere_allowed_blocks` customizes allowed block names for a context type.
- `blocks_everywhere_editor_styles` customizes iframe editor styles.
- `blocks_everywhere_editor_scripts` customizes iframe editor scripts.
- `block_editor_settings_all` receives the final WordPress block editor settings.
- `block_editor_preload_paths` can be scoped by an active context.
- `block_categories_all` can be scoped by an active context.

Important actions:

- Context `trigger` hooks load frontend editor instances.
- `admin_enqueue_scripts` loads admin contexts when their `admin_hook` matches.
- Context `editor_assets`, `after_load`, and legacy `editor_setup` callbacks provide integration-specific setup points.

## Asset Loading Strategy

Compiled bundles live in `build/` and are generated from the TypeScript and SCSS sources under `src/`.

Key bundles:

- `index.min.js` and `style-index.min.css` provide the editor runtime.
- `support-content-editor.min.js` and `support-content-editor.min.css` support block editing for content surfaces.
- `support-content-view.min.js` and `support-content-view.min.css` support rendered block content on the frontend.

Assets are registered once by the shared handler infrastructure and enqueued when an active context loads the editor or view assets.

## Data Flow: Creating Content

```
1. Host page reaches a registered context trigger.
   ↓
2. Engine checks the context condition and bootstraps settings.
   ↓
3. Blocks Everywhere loads the embedded Gutenberg editor for the target textarea/container.
   ↓
4. Optional client adapters load initial content, services, entity state, patterns, and chrome.
   ↓
5. User edits with Gutenberg blocks.
   ↓
6. Content bridge or native form submission persists serialized block markup.
   ↓
7. Host platform validates, sanitizes, and saves content.
```

## Data Flow: Displaying Content

```
1. Host content is retrieved from storage.
   ↓
2. Host or context-specific filters pass serialized blocks to the shared rendering helper.
   ↓
3. parse_blocks() and render_block() produce frontend HTML.
   ↓
4. WordPress sanitization runs where the host platform requires it.
   ↓
5. Rendered block content appears in the host surface.
```

## Extensibility Patterns

### Add A New Editor Surface

Register a context through `blocks_everywhere_contexts` with a stable `type`, `textarea`, `trigger`, and optional settings callbacks. Add host-specific save/render filters in the owning plugin or context callback.

### Customize Editor Settings

```php
add_filter( 'blocks_everywhere_editor_settings', function ( $settings ) {
    $settings['blocksEverywhere']['blocks']['allowBlocks'][] = 'custom/block';
    $settings['blocksEverywhere']['allowEmbeds'] = [ 'youtube', 'twitter' ];
    $settings['blocksEverywhere']['className'] = 'my-custom-editor-class';

    return $settings;
} );
```

### Restrict Block Usage

```php
add_filter( 'blocks_everywhere_editor_settings', function ( $settings ) {
    $settings['blocksEverywhere']['blocks']['allowBlocks'] = [
        'core/paragraph',
        'core/heading',
        'core/list',
    ];

    return $settings;
} );
```

## Testing Architecture

PHP tests live in `tests/` and cover the server context engine, bootstrap settings, lifecycle payload sanitization, initial content, pattern settings, global side-effect boundaries, and content rendering behavior.

Manual testing should cover:

- Editor mount and unmount on each host surface.
- Block availability, media flows, autosave, and form submission.
- Permission scenarios for authors, moderators, and administrators.
- Rendered block output and sanitization.
- Theme compatibility and editor chrome layout.

## Related Documentation

- [Portable Editor Adapter Guide](portable-editor-adapters.md)
- [bbPress Integration Guide](handlers/bbpress-handler.md)
- [Components Guide](components.md)
