## Unreleased (2026-08-21)

### ⚠ BREAKING CHANGES

* **auth:** `login()` returns a Promise<Token> instead of writing a cookie. Callers must await it and store the token. (#142)
* **git:** drop support for git older than 2.20 (5d0a2f8)

### Features

* **auth:** replace session cookies with JWT (#142), closes #138
* **cli:** add --tag-prefix flag (#140), closes #131

### Bug Fixes

* **parser:** handle commits with an empty body (2c8f1b7), closes #139
* **git:** drop support for git older than 2.20 (5d0a2f8)

### Performance Improvements

* stream git log instead of buffering (#137)

### Code Refactoring

* split the renderer out of the changelog module (8e2a4c6)

### Documentation

* document the config file resolution order (a7c4e18)

### Tests

* cover the scp-style remote parser (b9e3c71)

### Other Changes

* wip (c4b8e70)
