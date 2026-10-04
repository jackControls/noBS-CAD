# Limo rename checklist

**Status: Plan · 2026-10-02** · Decision: [ADR 0007](adr/0007-limo-name.md) ·
Rationale: [Limo naming proposal](limo-naming-proposal.md)

This sequences the move from **noBS CAD** to **Limo CAD** (**砺模 CAD** on
Simplified Chinese pages). Each phase is a separately reviewed change. The
rule throughout: change what people read first, and keep what existing
projects and agent setups depend on until a compatibility path ships.

## Inventory

Surveyed from the repository on 2026-10-02.

| Surface | Current value | Treatment |
|---|---|---|
| Display name | `productName` and window title `noBS CAD` in `src-tauri/tauri.conf.json`; usage text in `src-tauri/src/startup.rs`; help, recipe and knowledge copy | **Rename** per locale (phase 2) |
| Bundle identifier | `org.nbcad.desktop` | **Keep.** Changing it makes the OS treat the app as new: separate settings, signing and notarization identity, no in-place upgrade |
| Project file | `.nbcad` extension, shared Rust project-file crate | **Keep.** Existing projects must open unchanged. Any new extension is an additional format decision |
| URL scheme | `nbcad://recipe/<id>` (native `recipe_links.rs`) | **Keep and later add** a Limo scheme alongside it. Published "Open recipe" links depend on the old one |
| Environment variables | `NBCAD_*` (session dir, build channel, test hooks) | **Keep.** Internal and scripted; document only |
| Retired browser storage | Former React browser preference/project keys | Browser replacement must offer an explicit import path for old user projects; native preferences remain in the Rust preference store |
| Crate names | `nbcad`, `nbcad-*` workspace crates | **Keep** unless a separate refactor justifies the churn |
| MCP server name | `nobs-cad` in documented `mcpServers` configs (`docs/INSTALL.md`) | **Keep working.** Introduce a Limo name as an alias, document both, retire the old only after a deprecation notice |
| Windows executable and artifacts | `noBS-CAD.exe`; `noBS-CAD-<ver>-windows-<arch>.zip`, `noBS.CAD_<ver>_*.dmg/.deb/.AppImage` | **Rename** at the first Limo release (phase 4), with the old names noted in release notes |
| CI workflow text | step and artifact names in `.github/workflows/desktop-packages.yml` and others | **Rename** with the artifact change; branch-protection required-check names may depend on job names, so check first |
| Package metadata | repository URLs in `Cargo.toml`, shared `REPOSITORY` slug | **Update** with `cargo xtask retarget-repository` after the repository move (phase 3); `REPOSITORY` is the single source for Rust knowledge/media tools |
| Docs and READMEs | `jackControls/Limo-CAD` URLs, badges, prose in `docs/`, `knowledge/`, `examples/`, four README languages | **Sweep** after the move; GitHub redirects keep old links alive meanwhile |
| GitHub Pages | `https://jackcontrols.github.io/Limo-CAD/` (`pages-knowledge.yml`): showcase, `open.html` recipe links | **Replace.** Pages URLs do not redirect when a repository is renamed or transferred |
| Release assets | `releases/download/v*/…` and `showcase-v0.2.0` URLs | Redirect after a move, but pinned-release checks in workflows must follow the new path |
| Related plugin | `dsh-nobs-cad-step` | Separate package; rename in its own repository after phase 4 |

## Phase 0: confirm names

- [ ] Choose the account: stay under `jackControls`, or create a Limo
      organization and transfer the repository once. One move is better than two.
- [ ] Choose the repository and site name. Checked 2026-10-02: the GitHub
      account name `limo` is already taken; `limo-cad` resolved as unused for
      both users and organizations. Recheck immediately before creating it.
- [ ] Search for conflicts in the intended channels (package registries, app
      stores, domains, social handles), and for trademark conflicts in software
      and CAD. English *limo* also means limousine; confirm search results for
      "Limo CAD" are acceptable.
- [ ] Decide whether the old repository name stays reserved. Do not create a
      new `noBS-CAD` repository afterward; that would break GitHub's redirect.

### Name check results (2026-10-02)

A first-pass screen, not legal clearance.

- **Existing products:** web searches found no CAD, CAM or 3D-modeling product
  called Limo or Limo CAD. "Limo" results are limousine dispatch software and
  vehicle blocks in CAD libraries.
- **GitHub:** `limo` is an organization (created 2010) and `limocad` is an
  empty personal account (created 2018); both are unavailable. `limo-cad` is unused.
- **Registries:** `limo-cad` is unused on npm, crates.io and PyPI. `limo` is
  taken on npm and crates.io (unrelated, small packages) and unused on PyPI.
  No `limo` formula or cask in Homebrew and no Flathub entry was found.
- **Domains:** `limocad.com`, `limocad.org`, `limo-cad.com` appear unregistered
  by WHOIS. `limo.app` and `limo.dev` are registered. `limocad.dev`,
  `limocad.app` and `.cad` queries returned no usable result; verify at a registrar.
- **USPTO (searched 2026-10-02, tmsearch.uspto.gov):** no mark for "LIMO CAD"
  or "LIMOCAD", live or dead. 403 records contain LIMO, 79 of them live. In the
  classes that matter for software (9, 42, 41) the live ones are:
  - **LIMO**, reg. 75842917, owned by LIMO Lissotschenko Mikrooptik GmbH
    (Germany): lasers and laser optics in class 9, renewed. Same word, but
    hardware in an unrelated field. Worth watching, not a likely blocker.
  - **LIMO ANYWHERE**, **CARMEL LIMO AT YOUR FINGERTIPS**, **LIMOCOCKPIT**,
    **LIMODAD**, **QUOTEME.LIMO**, **LIMOLANE** (pending), **LIMOPRO** (pending):
    booking and dispatch software for limousine services. This is the nearest
    collision risk for "Limo" as a software word; the goods differ from CAD.
  - Unrelated: LIVE AT LIMO (video streaming), LM LIMO STUDIO (camera
    gear), LIQUOR LIMO, E EZ LIMO (motors), MINI-LIMO (vehicle upgrades).
  - A bare LIMO word mark also exists for baby bottles and toys (classes
    10, 12, 28, Vidiamo, France).
  Searched by word mark only; phonetic and look-alike marks (LEEMO, LYMO) and
  design marks were not.
- **China (CNIPA):** **not searched.** `wsjs.cnipa.gov.cn` did not load from
  the machine used, and a commercial aggregator would not return results
  without leaving the page. A web search for 砺模 as a company, product or
  brand found nothing, which is weak evidence. A USPTO search for 砺模 and
  its pinyin transliteration found only an unrelated cancelled herbal
  supplement record. Someone with access should search 砺模 (and the
  traditional form 礪模) in classes 9, 42, 41 and 35, with similar-group
  search, before the Chinese name is used publicly. A Chinese trademark
  attorney can run it and advise on first-to-file registration.
- **EUIPO, WIPO Madrid and UK:** not searched.

## Phase 1: prepare, with no user-visible change

- [ ] Add Limo locale strings for the product name in `src/i18n/{en,zh-CN,es,de}.json`
      behind a single constant, so display copy changes in one place.
- [ ] Add the compatibility paths: second URL scheme, MCP name alias, storage
      read-old/write-new, with tests that old projects, links, configs and saved
      preferences still work.
- [ ] Draft the Chinese banner (only the English concept image exists today)
      and have fluent contributors review the zh-CN, es and de README wording.
- [ ] Rehearse in a fork: rename it, then confirm what breaks (Pages, workflows,
      pinned release checks, branch rules, CODEOWNERS, required checks).

## Phase 2: rename the application

- [ ] Change display copy per locale: window title, installer and bundle name,
      About, help, recipes, knowledge, usage text, and error messages.
- [ ] Use "Limo CAD (formerly noBS CAD)" in English, with equivalents in
      other locales, until the transition ends.
- [ ] Release notes explain what did not change: file format, projects,
      agent connection and saved preferences.
- [ ] Verify an upgrade over an existing install on Windows, macOS and Linux:
      settings, recent files and language preference survive.

## Phase 3: move the repository and site

- [x] Rename the repository to `jackControls/Limo-CAD` (2026-10-03).
      GitHub redirects the old repository, Git and release-download URLs.
- [x] Serve Pages at `https://jackcontrols.github.io/Limo-CAD/`.
      Direct HTTP checks on 2026-10-04 returned 200 there and 404 at the old
      `/noBS-CAD/` path. The old Pages address does not redirect.
- [x] Retarget repository links and hosted-runner identity. For a subsequent
      move, run `cargo xtask retarget-repository --to <owner>/<repo>`
      (dry run first, then `--write`; add `--pages-url <host/path>` for a custom
      domain). It rewrites repository, `.git`, SSH, raw, API, shields.io badge
      and Pages URLs, plus backtick-quoted slugs, in package metadata, every
      README language, docs and the knowledge pages. It leaves release-note
      history, lockfiles and artifact file names alone, and lists any line that
      still names the old slug so prose mentions get a manual edit. The
      knowledge checker and showcase staging task read the slug from
      `REPOSITORY`, so they follow without edits, and the checker rejects
      repository file links that still use the old slug. Then run
      `cargo test -p xtask repository::`, `cargo test -p xtask showcase_media::`
      and `cargo xtask knowledge check`.
- [ ] Update local remotes, branch-protection required checks, CODEOWNERS,
      secrets and environments, issue templates, and the Discussions links.
- [ ] Update external listings and shared links: awesome-list entry, plugin
      and registry metadata, social and community posts.
- [ ] Create the Limo organization profile README that links the four
      localized entrances.

## Phase 4: first Limo release

- [ ] Rename artifacts and the Windows executable; state the old names in
      the release notes.
- [ ] Re-run signing, notarization and Windows SmartScreen checks; confirm
      the artifact names match installer docs.
- [ ] Rename the `dsh-nobs-cad-step` package and refresh its listing.
- [ ] Publish a short announcement in all four languages that links the
      previous name and the new one.

## Phase 5: finish

- [ ] After a deprecation period, decide whether to retire the old scheme,
      MCP name and storage keys; announce before removing anything.
- [ ] Keep "formerly noBS CAD" in search-facing descriptions long enough for
      existing users to find the project.

## Release gate

Do not publish a Limo release until all of these hold: existing `.nbcad`
files open, old recipe links and MCP configs still work, saved language and
theme preferences survive upgrade, the four README pages and the site agree on
the names, and no required check or pinned release path points at a missing
location.
