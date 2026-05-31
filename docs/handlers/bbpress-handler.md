# bbPress Integration Guide

## Overview

The bbPress integration embeds Gutenberg into forum topic and reply surfaces. It is implemented with the shared Blocks Everywhere context engine plus a bundled client runtime adapter for bbPress-specific draft, media, reply-switching, and submit behavior.

**Status**: Good, fully supported<br>
**Minimum bbPress**: 2.6+

## Implementation Files

- Server context and shared editor loading: `classes/class-engine.php`, `classes/class-handler.php`, `classes/class-editor.php`
- Client runtime adapter: `src/editor/bbpress-adapter.ts`
- Generic editor runtime: `src/editor/index.tsx`
- Forum styles: `src/styles/bbpress.scss`

The old `classes/handlers/class-bbpress.php` subclass model has been replaced by the data-driven `blocks_everywhere_contexts` API.

## Integration Points

### Frontend Forum Pages

When a user visits a forum, topic, or reply page, the bbPress context decides whether an embedded editor should load for the available topic/reply form. Blocks Everywhere then:

- Loads the shared editor assets.
- Wraps the target textarea with the embedded editor container.
- Applies bbPress-aware block settings and allowed blocks.
- Selects the bundled bbPress runtime adapter when `editorType` is `bbpress`.

### Topic Creation And Editing

- User opens a new topic or edit-topic form.
- Blocks Everywhere mounts the Gutenberg editor on the bbPress textarea.
- The editor serializes blocks back to the textarea or content bridge.
- bbPress saves the submitted serialized block content.

### Reply Creation And Editing

- User opens a reply or edit-reply form.
- The bbPress runtime adapter coordinates reply-specific draft restore, autosave, media upload resolution, and submit behavior.
- The form saves serialized block markup for the reply content.

### Admin Screens

When bbPress admin editing is enabled, Blocks Everywhere can load the editor on topic, reply, and forum edit screens so moderators can work with block content in admin.

## Content Rendering

Forum content is stored as serialized block markup and rendered through WordPress block rendering helpers.

Typical display flow:

```
bbPress content output
    ↓
Host/context filter receives topic, reply, or forum content
    ↓
WordPress autoembed processing where applicable
    ↓
parse_blocks() and render_block() render block markup
    ↓
Host sanitization such as wp_kses_post() or bbPress KSES
    ↓
Rendered HTML is displayed on the page
```

Common bbPress output filters include:

- `bbp_get_forum_content`
- `bbp_get_topic_content`
- `bbp_get_reply_content`

## Permissions

Frontend permissions remain bbPress-owned. Blocks Everywhere only mounts where the host/context says the current user can edit or compose.

Common cases:

- Topic authors can edit their own topics when bbPress allows it.
- Reply authors can edit their own replies when bbPress allows it.
- Moderators can edit forum content according to bbPress capabilities.
- Administrators have full editing access.
- Regular users can create topics/replies where forum permissions allow it.

Example bbPress checks:

```php
if ( bbp_is_user_topic_author( $user_id, $topic_id ) ) {
    // Topic author can edit when bbPress allows it.
}

if ( bbp_user_can_edit_topic( $user_id, $topic_id ) ) {
    // User can edit this topic.
}

if ( current_user_can( 'manage_options' ) ) {
    // Site administrator.
}
```

Admin screen access is controlled by the configured admin capability, defaulting to `manage_options` and filterable with `blocks_everywhere_admin_cap`.

## Configuration

### Enable bbPress Support

```php
define( 'BLOCKS_EVERYWHERE_BBPRESS', true );
define( 'BLOCKS_EVERYWHERE_BBPRESS_ADMIN', true );
```

Or use filters:

```php
add_filter( 'blocks_everywhere_bbpress', '__return_true' );
add_filter( 'blocks_everywhere_bbpress_admin', '__return_true' );
```

### Customize Editor Settings

Use `blocks_everywhere_editor_settings` for global editor settings or context settings for a specific surface.

```php
add_filter( 'blocks_everywhere_editor_settings', function ( $settings ) {
    $settings['blocksEverywhere']['blocks']['allowBlocks'] = [
        'core/paragraph',
        'core/heading',
        'core/list',
        'core/list-item',
        'core/image',
        'core/quote',
    ];

    $settings['blocksEverywhere']['allowEmbeds'] = [];

    return $settings;
} );
```

### Register Or Override A Context

Integrations can add or adjust contexts through `blocks_everywhere_contexts`.

```php
add_filter( 'blocks_everywhere_contexts', function ( $contexts ) {
    $contexts['custom-bbpress-reply'] = [
        'type'      => 'bbpress',
        'textarea'  => '#bbp_reply_content',
        'container' => '.bbp-the-content-wrapper',
        'trigger'   => 'bbp_template_redirect',
        'condition' => function () {
            return function_exists( 'bbp_current_user_can_access_create_reply_form' )
                && bbp_current_user_can_access_create_reply_form();
        },
    ];

    return $contexts;
} );
```

## Block Support

bbPress allows blocks that survive the forum KSES policy. The default allowed block list is derived from bbPress allowed tags when bbPress exposes them.

Recommended blocks:

- `core/paragraph`
- `core/heading`
- `core/list`
- `core/list-item`
- `core/quote`
- `core/image`
- `core/audio`
- `core/video`
- `core/embed`
- `core/code`
- `core/table`

Blocks with layout sensitivity:

- `core/media-text` can exceed narrow forum layouts.
- `core/columns` can be awkward in narrow topic/reply widths.
- `core/gallery` works for image collections but depends on theme styles.

Restrict blocks with editor settings:

```php
add_filter( 'blocks_everywhere_editor_settings', function ( $settings ) {
    $settings['blocksEverywhere']['blocks']['allowBlocks'] = array_values(
        array_diff(
            $settings['blocksEverywhere']['blocks']['allowBlocks'] ?? [],
            [ 'core/embed', 'core/gallery' ]
        )
    );

    return $settings;
} );
```

## Client Runtime Adapter

The bundled bbPress runtime adapter lives in `src/editor/bbpress-adapter.ts`. It is selected by the generic runtime for bbPress editor instances and handles bbPress-specific browser behavior behind the generic `runtimeAdapter` boundary.

Adapter responsibilities include:

- Preparing editor state before load.
- Restoring and saving reply drafts.
- Reacting to content changes for autosave or host UI state.
- Resolving media upload behavior for bbPress forms.
- Installing submit and reply-switch handlers.
- Cleaning up listeners when the editor unmounts.

Use the generic adapter surfaces for new behavior where possible:

- `contentBridge` for content persistence.
- `entityBridge` for host record identity and edit state.
- `services` for callable host capabilities.
- `lifecycle` for instance events.
- `runtimeAdapter` only for low-level runtime behavior.

## Troubleshooting

### Editor Does Not Load

- Confirm `BLOCKS_EVERYWHERE_BBPRESS` or `blocks_everywhere_bbpress` is enabled.
- Confirm bbPress is active and the current page has the expected topic/reply form.
- Check browser console errors.
- Check that the target textarea selector exists.
- Confirm current user permissions allow topic/reply creation or editing.

### Blocks Are Removed On Save

- Check bbPress KSES allowed tags.
- Check `blocks_everywhere_allowed_blocks` and `blocksEverywhere.blocks.allowBlocks`.
- Confirm the block's rendered HTML is allowed by the forum sanitization policy.

### Media Uploads Fail

- Confirm the current user can upload files.
- Check WordPress media permissions and nonce data.
- Confirm the bbPress runtime adapter is active for the editor instance.

## Related Documentation

- [Architecture](../architecture.md)
- [Portable Editor Adapter Guide](../portable-editor-adapters.md)
- [Components Guide](../components.md)
