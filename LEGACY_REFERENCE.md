# Original source and asset preservation

The supplied code was preserved in place under `src/`:

- `src/controllers/` — original Express/MySQL controller source
- `src/routes/` and `src/server.js` — original routing/runtime source
- `src/views/` — original EJS templates and embedded page bundles
- `src/public/` — original images, banners, CSS, JavaScript, APK and game/provider catalogue files
- `schema/` and `gar/` — original schema and ancillary source files

The MERN runtime does not modify or execute the legacy runtime files. It serves the
same `src/public` asset URLs and keeps the legacy files in the deliverable for
audit, comparison and rollback reference. New production code is isolated in
`client/`, `server/`, `ecosystem.config.cjs` and the root deployment documents.

Some legacy views contain compiled browser bundles rather than their original
Vue/authoring source. Those supplied compiled assets remain present exactly as
received; React routes recreate their navigation/workflow coverage using the
same asset library.

Two old schema fixture files contained inline personal/account sample values.
Their fixture values were replaced with inert placeholders before packaging;
their schema/utility logic remains available for historical reference. No
legacy credential, token or personal account data is intentionally redistributed.
