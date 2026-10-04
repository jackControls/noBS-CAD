use super::{
    common::{self, Package},
    xkb, Options,
};
use anyhow::{ensure, Context, Result};
use regex::Regex;
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
};

const HOST_LIBRARIES: &[&str] = &[
    "libwayland-client.so",
    "libwayland-cursor.so",
    "libwayland-egl.so",
];
const LINUXDEPLOY_DIGEST: &str = "c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d";
const LINUXDEPLOY_URL: &str = "https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20251107-1/linuxdeploy-x86_64.AppImage";
const DESKTOP: &str = "[Desktop Entry]\nType=Application\nName=noBS CAD\nComment=Local-first mechanical CAD\nExec=nbcad %u\nIcon=nbcad\nTerminal=false\nCategories=Graphics;Engineering;\nMimeType=x-scheme-handler/nbcad;\nStartupWMClass=nbcad\n";
const DEPENDS: &str = "desktop-file-utils, libdbus-1-3, libocct-data-exchange-7.9, libudev1, libvulkan1, libx11-6, libx11-xcb1, libxcursor1, libxi6, libxkbcommon-x11-0, xdg-utils, xdg-desktop-portal, xdg-desktop-portal-gtk, zenity";

fn first(paths: Vec<PathBuf>, label: &str) -> Result<PathBuf> {
    paths
        .into_iter()
        .find(|p| p.is_file())
        .with_context(|| format!("{label} is missing"))
}

pub(super) fn build(package: &Package, options: &Options) -> Result<()> {
    let sdk = options
        .occt_root
        .clone()
        .or_else(|| env::var_os("OCCT_ROOT").map(PathBuf::from));
    let mut copyrights = Vec::new();
    if let Some(path) = env::var_os("OCCT_COPYRIGHT_FILE") {
        copyrights.push(path.into());
    }
    if let Some(sdk) = &sdk {
        copyrights.push(sdk.join("share/doc/opencascade/copyright"));
    }
    copyrights.extend([
        PathBuf::from("/usr/share/doc/libocct-foundation-7.9/copyright"),
        PathBuf::from("/usr/share/doc/libocct-data-exchange-7.9/copyright"),
    ]);
    let copyright = first(copyrights, "OCCT copyright notice")?;
    let license = first(
        vec![
            "/usr/share/common-licenses/LGPL-2.1".into(),
            "/usr/share/common-licenses/LGPL-2".into(),
        ],
        "LGPL 2.1 text",
    )?;
    let licenses = package.desktop.join("linux-licenses");
    fs::create_dir_all(&licenses)?;
    fs::copy(copyright, licenses.join("OCCT-copyright.txt"))?;
    fs::copy(license, licenses.join("LGPL-2.1.txt"))?;
    let runtime = xkb::stage(package, &licenses)?;
    if options.stage_licenses {
        return Ok(());
    }
    let mut cargo = package.cargo();
    if let Some(sdk) = &sdk {
        cargo.env("OCCT_ROOT", sdk);
    }
    common::run(&mut cargo)?;
    let bundle = package.target.join("release/bundle");
    let staging = common::fresh_child(&bundle, "native-linux")?;
    let deb_root = staging.join("deb");
    let app = staging.join("noBS-CAD.AppDir");
    for root in [&deb_root, &app] {
        for directory in [
            "usr/bin",
            "usr/share/applications",
            "usr/share/icons/hicolor/256x256/apps",
        ] {
            fs::create_dir_all(root.join(directory))?;
        }
        fs::copy(
            package.target.join("release/nbcad"),
            root.join("usr/bin/nbcad"),
        )?;
        common::executable(&root.join("usr/bin/nbcad"))?;
        fs::write(root.join("usr/share/applications/nbcad.desktop"), DESKTOP)?;
        fs::copy(
            package.desktop.join("icons/128x128@2x.png"),
            root.join("usr/share/icons/hicolor/256x256/apps/nbcad.png"),
        )?;
        let notices = root.join("usr/share/nbcad/licenses");
        package.notices(&notices)?;
        fs::copy(
            licenses.join("LGPL-2.1.txt"),
            notices.join("OCCT-LGPL-2.1.txt"),
        )?;
        fs::copy(
            licenses.join("OCCT-copyright.txt"),
            notices.join("OCCT-copyright.txt"),
        )?;
        common::copy_tree(&licenses.join("xkb/licenses"), &notices.join("xkb"))?;
    }
    let required = required_notices(&runtime);
    if options.bundle.as_deref().is_none_or(|v| v == "deb") {
        fs::create_dir(deb_root.join("DEBIAN"))?;
        fs::write(deb_root.join("DEBIAN/control"), format!("Package: nbcad\nVersion: {}\nArchitecture: amd64\nMaintainer: noBS CAD contributors <nbcad@users.noreply.github.com>\nSection: graphics\nPriority: optional\nDepends: {DEPENDS}\nRecommends: fonts-noto-core, fonts-noto-cjk\nDescription: Local-first mechanical CAD with a native Bevy interface\n", package.version))?;
        let output = bundle.join("deb");
        fs::create_dir_all(&output)?;
        let deb = output.join(format!("noBS.CAD_{}_amd64.deb", package.version));
        common::run(
            package
                .command("dpkg-deb")
                .args(["--build", "--root-owner-group"])
                .arg(&deb_root)
                .arg(&deb),
        )?;
        let listing = common::output(package.command("dpkg-deb").arg("--contents").arg(&deb))?;
        for notice in &required {
            ensure!(
                listing.contains(&format!("/licenses/{notice}"))
                    || listing.contains(&format!("/licenses/xkb/{notice}")),
                "Debian package missing license {notice}"
            );
        }
        common::checksum(&deb)?;
    }
    if options.bundle.as_deref().is_none_or(|v| v == "appimage") {
        common::copy_tree(&licenses.join("xkb/lib"), &app.join("usr/lib"))?;
        let tool = bundle.join("linuxdeploy-x86_64.AppImage");
        if !tool.is_file() || common::sha256(&tool)? != LINUXDEPLOY_DIGEST {
            let download = tempfile::NamedTempFile::new_in(&bundle)?;
            common::run(
                package
                    .command("curl")
                    .args(["--fail", "--location", "--proto", "=https", "--output"])
                    .arg(download.path())
                    .arg(LINUXDEPLOY_URL),
            )?;
            ensure!(
                common::sha256(download.path())? == LINUXDEPLOY_DIGEST,
                "linuxdeploy checksum mismatch"
            );
            download.persist(&tool)?;
        }
        common::executable(&tool)?;
        let output = bundle.join("appimage");
        fs::create_dir_all(&output)?;
        let filename = format!("noBS.CAD_{}_amd64.AppImage", package.version);
        let mut command = package.command(&tool);
        command
            .current_dir(&output)
            .args(["--appimage-extract-and-run", "--appdir"])
            .arg(&app);
        for prefix in HOST_LIBRARIES {
            command.args(["--exclude-library", &format!("{prefix}*")]);
        }
        command
            .arg("--desktop-file")
            .arg(app.join("usr/share/applications/nbcad.desktop"))
            .arg("--icon-file")
            .arg(app.join("usr/share/icons/hicolor/256x256/apps/nbcad.png"))
            .args(["--output", "appimage"])
            .env("ARCH", "x86_64")
            .env("VERSION", &package.version)
            .env("OUTPUT", &filename)
            .env("APPIMAGE_EXTRACT_AND_RUN", "1")
            .env("NO_STRIP", "1");
        common::run(&mut command)?;
        let artifact = output.join(filename);
        audit_appimage(package, &artifact, &runtime, &required)?;
        common::checksum(&artifact)?;
    }
    Ok(())
}

fn required_notices(runtime: &[xkb::Runtime]) -> BTreeSet<String> {
    let mut required: BTreeSet<_> = [
        "noBS-CAD-LICENSE.txt",
        "THIRD_PARTY_NOTICES.md",
        "OCCT-LGPL-2.1.txt",
        "OCCT-copyright.txt",
        "runtime.json",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    for entry in runtime {
        required.insert(entry.copyright.clone());
        required.extend(entry.common_licenses.iter().cloned());
    }
    required
}

#[derive(Debug, PartialEq, Eq)]
struct Entry {
    kind: char,
    permissions: String,
    path: String,
}
fn listing(text: &str) -> Result<Vec<Entry>> {
    let pattern =
        Regex::new(r"^([-dl])([-rwxsStT]{9})\s+\S+\s+\d+\s+\S+\s+\S+\s+squashfs-root/(.+)$")?;
    Ok(text
        .lines()
        .filter_map(|line| pattern.captures(line))
        .map(|c| {
            let kind = c[1].chars().next().unwrap();
            let mut path = c[3].to_owned();
            if kind == 'l' {
                path = path.split(" -> ").next().unwrap().into();
            }
            Entry {
                kind,
                permissions: c[2].into(),
                path,
            }
        })
        .collect())
}
fn audit_entries(entries: &[Entry], required: &BTreeSet<String>) -> Result<()> {
    ensure!(
        entries.iter().any(|e| e.path == "AppRun"),
        "could not read AppImage AppRun listing"
    );
    for entry in entries {
        if entry.kind != 'l' {
            let mode = entry.permissions.as_bytes();
            let searchable = entry.kind == 'd' || matches!(mode[2], b'x' | b's');
            ensure!(
                mode[6] == b'r' && (!searchable || matches!(mode[8], b'x' | b't')),
                "AppImage unreadable/unexecutable for other users: {}{} {}",
                entry.kind,
                entry.permissions,
                entry.path
            );
        }
        let name = Path::new(&entry.path)
            .file_name()
            .context("AppImage entry name")?
            .to_string_lossy();
        ensure!(
            !HOST_LIBRARIES.iter().any(|prefix| name.starts_with(prefix)),
            "AppImage bundles host-only library {}",
            entry.path
        );
    }
    for notice in required {
        ensure!(
            entries.iter().any(|e| e.kind == '-'
                && Path::new(&e.path)
                    .file_name()
                    .is_some_and(|v| v == notice.as_str())),
            "AppImage missing required license {notice}"
        );
    }
    Ok(())
}
fn audit_appimage(
    package: &Package,
    artifact: &Path,
    runtime: &[xkb::Runtime],
    required: &BTreeSet<String>,
) -> Result<()> {
    common::executable(artifact)?;
    let offset = common::output(package.command(artifact).arg("--appimage-offset"))?;
    offset.parse::<u64>().context("AppImage squashfs offset")?;
    let text = common::output(
        package
            .command("unsquashfs")
            .args(["-o", &offset, "-lln"])
            .arg(artifact),
    )?;
    audit_entries(&listing(&text)?, required)?;
    let temp = tempfile::tempdir()?;
    common::run(
        package
            .command("unsquashfs")
            .args(["-o", &offset, "-d"])
            .arg(temp.path().join("root"))
            .arg(artifact),
    )?;
    xkb::verify(package, &temp.path().join("root"), runtime)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn appimage_symlinks_permissions_and_host_only_libraries_are_audited() {
        let source = "drwxr-xr-x 0/0 106 2026-10-02 05:28 squashfs-root\nlrwxrwxrwx 0/0 13 2026-10-02 05:28 squashfs-root/AppRun -> usr/bin/nbcad\n-rwxr-xr-x 0/0 42 2026-10-02 05:27 squashfs-root/usr/bin/nbcad\n-rw-r--r-- 0/0 42 2026-10-02 05:27 squashfs-root/usr/share/Example -> notice.txt";
        let mut entries = listing(source).unwrap();
        assert_eq!(entries[0].path, "AppRun");
        assert_eq!(entries[2].path, "usr/share/Example -> notice.txt");
        audit_entries(&entries, &BTreeSet::new()).unwrap();
        entries[1].permissions = "rwx------".into();
        assert!(audit_entries(&entries, &BTreeSet::new()).is_err());
        entries[1].permissions = "rwxr-xr-x".into();
        entries.push(Entry {
            kind: 'l',
            permissions: "rwxrwxrwx".into(),
            path: "usr/lib/libwayland-client.so.0".into(),
        });
        assert!(audit_entries(&entries, &BTreeSet::new()).is_err());
        assert!(audit_entries(
            &listing(source).unwrap(),
            &BTreeSet::from(["MISSING-LICENSE".into()])
        )
        .is_err());
    }
}
