## [1.4.0](https://github.com/example/changelog-from-commits/compare/v1.3.0...v1.4.0) (2026-08-21)

### ⚠ BREAKING CHANGES

* **auth:** `login()` returns a Promise<Token> instead of writing a cookie. Callers must await it and store the token. ([#142](https://github.com/example/changelog-from-commits/pull/142))
* **git:** drop support for git older than 2.20 ([5d0a2f8](https://github.com/example/changelog-from-commits/commit/5d0a2f8b6e3c9017d4a8b2f6c0e4a8d2b6f0c4e8))

### Features

* **auth:** replace session cookies with JWT ([#142](https://github.com/example/changelog-from-commits/pull/142)), closes [#138](https://github.com/example/changelog-from-commits/issues/138)
* **cli:** add --tag-prefix flag ([#140](https://github.com/example/changelog-from-commits/pull/140)), closes [#131](https://github.com/example/changelog-from-commits/issues/131)

### Bug Fixes

* **parser:** handle commits with an empty body ([2c8f1b7](https://github.com/example/changelog-from-commits/commit/2c8f1b7a5d9e3c081f4b6d8a0c2e4f6b8d0a2c4e)), closes [#139](https://github.com/example/changelog-from-commits/issues/139)
* **git:** drop support for git older than 2.20 ([5d0a2f8](https://github.com/example/changelog-from-commits/commit/5d0a2f8b6e3c9017d4a8b2f6c0e4a8d2b6f0c4e8))

### Performance Improvements

* stream git log instead of buffering ([#137](https://github.com/example/changelog-from-commits/pull/137))

### Code Refactoring

* split the renderer out of the changelog module ([8e2a4c6](https://github.com/example/changelog-from-commits/commit/8e2a4c60d5b9f13e7a0c4d8b2f6a9c1e5b8d0f3a))

### Documentation

* document the config file resolution order ([a7c4e18](https://github.com/example/changelog-from-commits/commit/a7c4e1859f2b6d03a5c8e1b4d7f0a3c6e9b2d5f8))

### Tests

* cover the scp-style remote parser ([b9e3c71](https://github.com/example/changelog-from-commits/commit/b9e3c714a0d8f26b5c9e3a7d1f5b9c3e7a1d5f9b))
