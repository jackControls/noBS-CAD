use super::{
    common::{self, Package},
    Options,
};
use anyhow::{bail, ensure, Context, Result};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[path = "provenance.rs"]
mod provenance;

pub(super) struct Target {
    pub triple: &'static str,
    pub arch: &'static str,
    pub triplet: &'static str,
}
pub(super) fn target(arch: &str, selected: Option<&str>) -> Result<Target> {
    match selected.unwrap_or(match arch {
        "x86_64" => "x86_64-pc-windows-msvc",
        "aarch64" => "aarch64-pc-windows-msvc",
        _ => "unsupported",
    }) {
        "x86_64-pc-windows-msvc" => Ok(Target {
            triple: "x86_64-pc-windows-msvc",
            arch: "x64",
            triplet: "x64-windows",
        }),
        "aarch64-pc-windows-msvc" => Ok(Target {
            triple: "aarch64-pc-windows-msvc",
            arch: "arm64",
            triplet: "arm64-windows",
        }),
        other => bail!("unsupported Windows target {other}"),
    }
}
pub(super) fn build(package: &Package, options: &Options) -> Result<()> {
    let target = target(env::consts::ARCH, options.target.as_deref())?;
    let source = provenance::read(&package.root)?;
    let sdk = options
        .occt_root
        .clone()
        .or_else(|| env::var_os("OCCT_ROOT").map(PathBuf::from))
        .unwrap_or_else(|| package.root.join("vcpkg_installed").join(target.triplet))
        .canonicalize()
        .context("resolve Windows OCCT SDK")?;
    let bin = [
        "bin",
        "win64/vc17/bin",
        "win64/vc16/bin",
        "win64/vc15/bin",
        "win64/vc14/bin",
    ]
    .iter()
    .map(|name| sdk.join(name))
    .find(|path| path.join("TKernel.dll").is_file())
    .context("TKernel.dll missing from OCCT SDK")?;
    common::run(
        package
            .cargo()
            .args(["--target", target.triple])
            .env("NBCAD_BUILD_REVISION", &source.revision)
            .env("OCCT_ROOT", &sdk)
            .env("VCPKG_TARGET_TRIPLET", target.triplet),
    )?;
    ensure!(
        provenance::read(&package.root)? == source,
        "Source revision or modified state changed while building the Windows package"
    );
    let release = package.target.join(target.triple).join("release");
    stage(
        package,
        &target,
        &release.join("nbcad.exe"),
        &sdk,
        &bin,
        &release.join("bundle/portable"),
        &source,
    )
}
fn stage(
    package: &Package,
    target: &Target,
    executable: &Path,
    sdk: &Path,
    bin: &Path,
    output: &Path,
    source: &provenance::Source,
) -> Result<()> {
    ensure!(executable.is_file(), "Cargo did not produce nbcad.exe");
    let name = format!("noBS-CAD-{}-windows-{}", package.version, target.arch);
    let directory = common::fresh_child(output, &name)?;
    fs::copy(executable, directory.join("noBS-CAD.exe"))?;
    let mut count = 0;
    for entry in fs::read_dir(bin)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dll"))
        {
            fs::copy(entry.path(), directory.join(entry.file_name()))?;
            count += 1;
        }
    }
    ensure!(count > 0, "SDK contains no runtime DLLs");
    for name in ["TKernel.dll", "TKDESTEP.dll", "TKFillet.dll", "TKHLR.dll"] {
        ensure!(
            directory.join(name).is_file(),
            "required OCCT runtime library missing: {name}"
        );
    }
    let licenses = directory.join("licenses");
    package.notices(&licenses)?;
    fn copyrights(source: &Path, licenses: &Path) -> Result<()> {
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                copyrights(&entry.path(), licenses)?;
            } else if entry.file_name() == "copyright" {
                let path = entry.path();
                let port = path
                    .parent()
                    .and_then(Path::file_name)
                    .context("vcpkg port name")?
                    .to_string_lossy();
                fs::copy(&path, licenses.join(format!("vcpkg-{port}.txt")))?;
            }
        }
        Ok(())
    }
    copyrights(&sdk.join("share"), &licenses)?;
    ensure!(
        licenses.join("vcpkg-opencascade.txt").is_file(),
        "vcpkg OpenCASCADE license notice missing"
    );
    let commit = source.stamp();
    fs::write(directory.join("README.txt"), format!("noBS CAD {} - Windows {} portable build\n\nRun noBS-CAD.exe directly; no installation is required.\n\nLocal stdio MCP is always available. A normal launch opens the CAD window.\nUse args [\"--headless\"] for an agent worker without an extra window.\nKeep the DLLs beside the executable; no separate server or OCCT SDK is required.\n\nSystem requirements:\n- Windows 10 version 1803 or newer, or Windows 11\n- Microsoft Visual C++ v14 {} Redistributable\n  https://aka.ms/vc14/vc_redist.{}.exe\n- A graphics adapter and driver accepted by wgpu's DX12 or Vulkan backend\n\nThe Visual C++ runtime is intentionally not bundled. Install the centrally\nserviced Microsoft Redistributable for security and servicing updates.\n\nSource: https://github.com/jackControls/Limo-CAD\nSource commit: {commit}\n", package.version, target.arch, target.arch, target.arch))?;
    let zip = output.join(format!("{name}.zip"));
    common::zip_directory(&directory, &zip)?;
    common::checksum(&zip)?;
    println!("Packaged {count} runtime DLLs");
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_package_requires_runtime_and_license_closure() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::write(root.join("LICENSE"), "license").unwrap();
        fs::write(root.join("THIRD_PARTY_NOTICES.md"), "notices").unwrap();
        let sdk = root.join("sdk");
        let bin = sdk.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(sdk.join("share/opencascade")).unwrap();
        fs::write(sdk.join("share/opencascade/copyright"), "OCCT").unwrap();
        for name in ["TKernel.dll", "TKDESTEP.dll", "TKFillet.dll"] {
            fs::write(bin.join(name), "DLL").unwrap();
        }
        let exe = root.join("nbcad.exe");
        fs::write(&exe, "exe").unwrap();
        let package = Package {
            root: root.to_owned(),
            desktop: root.into(),
            target: root.into(),
            version: "0.3.0-rc.1".into(),
        };
        let target = target("x86_64", None).unwrap();
        let output = root.join("output");
        let source = provenance::Source {
            revision: "123456789abcdef0123456789abcdef0123456789a".into(),
            modified: true,
        };
        assert!(stage(&package, &target, &exe, &sdk, &bin, &output, &source).is_err());
        fs::write(bin.join("TKHLR.dll"), "DLL").unwrap();
        stage(&package, &target, &exe, &sdk, &bin, &output, &source).unwrap();
        let readme =
            fs::read_to_string(output.join("noBS-CAD-0.3.0-rc.1-windows-x64/README.txt")).unwrap();
        assert!(readme.contains(&format!("Source commit: {}\n", source.stamp())));
        assert!(!readme.contains("local working tree"));
        let mut archive = zip::ZipArchive::new(
            fs::File::open(output.join("noBS-CAD-0.3.0-rc.1-windows-x64.zip")).unwrap(),
        )
        .unwrap();
        assert!(archive
            .by_name("noBS-CAD-0.3.0-rc.1-windows-x64/licenses/vcpkg-opencascade.txt")
            .is_ok());
        assert!(archive
            .by_name("noBS-CAD-0.3.0-rc.1-windows-x64/TKHLR.dll")
            .is_ok());
    }
}
