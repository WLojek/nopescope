# Contributing

Issues and pull requests are welcome.

- **A site Nopescope misses or breaks:** open an issue with the URL and what you expected. For a dedicated adapter, add or update a fixture in `extension/test/fixtures/` together with the fix.
- **A new site adapter:** implement `{id, name, matches(loc), scan(root)}` as described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), add a fixture and extend `test/adapters.test.mjs`.
- **A new text model:** export it with `basal-web/scripts/export.py`, run the parity test (`basal-web/test/run.mjs`) and the evals (`docs/EVAL.md`), and add it to `TEXT_MODELS` in `extension/src/shared/rules.js`.
- **Before a pull request:**
  - run `npm test` in `extension/`;
  - if you touched the content script or the models, also run `npm run test:e2e`.
- **Style:** plain modern JavaScript (ES modules, no framework), small files, comments that explain why.

By contributing you agree that your contribution is licensed under Apache-2.0.
