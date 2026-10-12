# abcjs 6.7.1 (vendored)

MIT; used only for ABC parsing (research R3).

| Field | Value |
|---|---|
| Package | `abcjs` |
| Version | 6.7.1 |
| npm tarball | https://registry.npmjs.org/abcjs/-/abcjs-6.7.1.tgz |
| Tarball integrity | `sha512-H9fnuhSSP3tbcJf4K3a/sgX8lM2M5cx8drlXEsPNrsRca/MGxhSb6HcT0ICFVoNW7Izx3kMHf7PExarC+5LUJw==` |
| File | `abcjs-basic-min.js`, copied unchanged from `package/dist/` |
| File SHA-256 | `e796d0d064998c0eee261594a80215001c2ff4bc793050628c8f35d85cacd8b4` |
| File size | 511,907 bytes (148,670 bytes gzipped) |
| License | `LICENSE.md`, copied unchanged from the package root (MIT, Paul Rosen and Gregory Dyke) |

## How it is used

- The page loads the bundle with a classic `<script>` only when it reads an ABC text, and then
  passes `globalThis.ABCJS` to `src/core/abc-reader.js`.
- The Node tests load the same file with `createRequire` (`tests/helpers.js`, `loadAbcjs()`).
- Only `ABCJS.parseOnly` and `tune.setUpAudio({chordsOff: true})` are called. The app does not
  use abcjs to draw notation or to play sound.

## Keep it byte-for-byte

The files here are excluded from the pre-commit hygiene hooks (`.pre-commit-config.yaml`),
because `end-of-file-fixer` would add a final newline to the minified file and change its
SHA-256. To check the copy:

```bash
sha256sum arranger/vendor/abcjs/abcjs-basic-min.js
```

To update it, run `npm pack abcjs@<version>` in a scratch folder, copy
`package/dist/abcjs-basic-min.js` and `package/LICENSE.md` here, and update this table.
