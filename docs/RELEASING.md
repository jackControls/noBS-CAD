# Versioning and releases

## One version, one file

`VERSION` at the repository root holds the version of the whole product. It is
the only file a version bump edits by hand.

```sh
printf '0.3.0\n' > VERSION
npm run version:sync    # node scripts/sync-version.mjs
npm run version:check   # node scripts/sync-version.mjs --check
```

`scripts/sync-version.mjs` propagates the value to every carrier that has to
agree with it:

| Carrier | Why it exists |
| --- | --- |
| `Cargo.toml` (`[workspace.package]`) | the one Rust version; all eleven engine crates and `xtask` inherit it with `version.workspace = true` |
| `src-tauri/Cargo.toml`, `mcp-server/Cargo.toml` | separate workspaces, so they declare the version themselves |
| `Cargo.lock`, `src-tauri/Cargo.lock`, `mcp-server/Cargo.lock` | lockfiles record the version of every local package |
| `package.json`, `package-lock.json` | npm identity and the version the packaging workflow reads |
| `src-tauri/tauri.conf.json` | bundle version: DMG, DEB and AppImage names |
| `vcpkg.json` | native dependency manifest identity |
| `src/files/nbcad.ts` | `application_version` written into `.nbcad` manifests |
| `docs/DEVELOPMENT.md`, `docs/INSTALL.md`, `docs/OCCT_PACKAGING.md`, `docs/WINDOWS_PACKAGING.md` | packaged-file examples that quote a version |

The `Version guard` workflow runs the check and
`node --test scripts/sync-version.test.mjs` on every pull request and every push
to `main`, so a carrier that drifts from `VERSION` fails fast.

Two places derive the version instead of storing it:

- Desktop artifact names come from `package.json` inside
  `desktop-packages.yml`, so the workflow needs no literal version.
- The binary records `CARGO_PKG_VERSION`, the commit SHA and the build channel
  from `crates/core/build.rs`. A `v*` tag becomes the channel; anything else
  builds as `preview`. **File → Settings → About noBS CAD** shows
  `version+revision`.

Adding a new carrier means adding it to `versionCarriers()` in
`scripts/sync-version.mjs` and, when it is a file, to the table above.

## Choosing the number

Semantic Versioning, `MAJOR.MINOR.PATCH`:

- Below `1.0.0` the document model, file formats and MCP surface are not frozen,
  so a release that adds capability takes a **minor** bump (`0.2.0`, `0.3.0`).
- A release that only fixes defects takes a **patch** bump (`0.2.1`).
- Reserve `1.0.0` for a release the project is willing to keep compatible.
- Pre-releases take a suffix that sorts before the release they lead to:
  `v0.3.0-rc.1`, `v0.3.0-beta.2`. Publish those as GitHub pre-releases, not as
  the latest release.

Do not reuse a version for a different commit, and do not tag a commit whose
carriers disagree with `VERSION`.

## Cutting a release

1. **Bump and sync** on a branch from `main` — `VERSION`, the synced carriers
   and the release notes in one PR. Confirm locally:

   ```sh
   npm run version:check
   cargo metadata --offline --locked --format-version 1 > /dev/null
   ```

2. **Merge** after review. `main` requires an approving review, and the author
   cannot approve their own PR.

3. **Tag the merge commit** and push the tag:

   ```sh
   git checkout main && git pull --ff-only
   git tag -a v0.3.0 -m "noBS CAD 0.3.0"
   git push origin v0.3.0
   ```

   A `v*` tag makes `desktop-packages.yml` build the Windows x64 and ARM64
   portable ZIPs, the signed and notarized macOS DMG, and the Ubuntu DEB and
   AppImage, with `NBCAD_BUILD_CHANNEL` set to the tag name. The workflow
   uploads GitHub Actions artifacts; it does not create the release.

4. **Create the release and attach the packages** once the run succeeds:

   ```sh
   run=$(gh run list --workflow=desktop-packages.yml --event=push --limit 1 \
     --json databaseId --jq '.[0].databaseId')
   gh run watch "$run" --exit-status
   gh run download "$run" --dir target/release-assets
   gh release create v0.3.0 --title "noBS CAD 0.3.0" --notes-file notes.md --verify-tag
   gh release upload v0.3.0 <packages and .sha256 files>
   ```

   Add a `SHA256SUMS.txt` covering the uploaded packages, and state the tagged
   revision and the pre-alpha status in the notes.

5. **Repoint the download links.** `README.md` and `knowledge/home.html` name a
   specific release tag, so update them in a follow-up PR after the assets
   exist. They are intentionally not automated: a link that changes before the
   assets are uploaded would 404.

## What CI does not decide

The version guard only proves that the carriers agree. Whether a release is
warranted, which number it deserves and whether the notes are honest stay with
the maintainers.
