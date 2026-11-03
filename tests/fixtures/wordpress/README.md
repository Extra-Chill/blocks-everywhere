# WordPress block parser fixtures

These three unmodified parser classes are from WordPress 7.1.4,
`wp-includes/class-wp-block-parser{,-block,-frame}.php`.
Source: https://github.com/WordPress/WordPress/tree/7.1.4/wp-includes
License: GPL-2.0-or-later (https://wordpress.org/about/license/).

They let the unit suite exercise WordPress's actual block delimiter parser
without a WordPress installation, database, or network access. The small
serialization/rendering stand-ins in `tests/block-functions.php` only exercise
static markup and record rendered block names; they are not a full WordPress
integration test. The upstream integration harness remains in `tests/e2e/`.
