use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.exists())
}

fn contains_library(directory: &Path, target_os: &str, stem: &str) -> bool {
    if !directory.is_dir() {
        return false;
    }
    if target_os == "windows" {
        return directory.join(format!("{stem}.lib")).is_file();
    }
    let (prefix, extension) = if target_os == "macos" {
        (format!("lib{stem}"), ".dylib")
    } else {
        (format!("lib{stem}.so"), "")
    };
    fs::read_dir(directory)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().into_string().ok())
        .any(|name| {
            name.starts_with(&prefix) && (extension.is_empty() || name.ends_with(extension))
        })
}

fn first_library_dir(
    candidates: impl IntoIterator<Item = PathBuf>,
    target_os: &str,
) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|path| contains_library(path, target_os, "TKernel"))
}

fn main() {
    println!("cargo:rerun-if-changed=src/native.rs");
    println!("cargo:rerun-if-changed=src/shim.cpp");
    println!("cargo:rerun-if-changed=include/shim.hpp");
    println!("cargo:rerun-if-env-changed=OCCT_ROOT");
    println!("cargo:rerun-if-env-changed=NBCAD_OCCT_LIB_DIR");
    println!("cargo:rerun-if-env-changed=VCPKG_INSTALLED_DIR");
    println!("cargo:rerun-if-env-changed=VCPKG_TARGET_TRIPLET");

    if env::var_os("CARGO_FEATURE_NATIVE_OCCT").is_none() {
        return;
    }

    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("Cargo did not provide target OS");
    let target_triplet =
        env::var("VCPKG_TARGET_TRIPLET").unwrap_or_else(|_| "x64-windows".to_string());
    let explicit = env::var_os("OCCT_ROOT").map(PathBuf::from);
    let vcpkg = env::var_os("VCPKG_INSTALLED_DIR")
        .map(PathBuf::from)
        .map(|root| root.join(&target_triplet));
    let project_vcpkg = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("vcpkg_installed")
        .join(&target_triplet);
    let platform_roots = if target_os == "windows" {
        vec![project_vcpkg]
    } else {
        vec![
            PathBuf::from("/opt/homebrew/opt/opencascade"),
            PathBuf::from("/usr/local/opt/opencascade"),
            PathBuf::from("/opt/opencascade"),
        ]
    };
    let root = first_existing(explicit.into_iter().chain(vcpkg).chain(platform_roots))
        .unwrap_or_else(|| {
            panic!(
                "OCCT SDK not found. Set OCCT_ROOT to a compatible OCCT 7.9.x prefix \
             (or install Homebrew opencascade on macOS)"
            )
        });

    let include = first_existing([
        root.join("include/opencascade"),
        root.join("inc"),
        root.join("include"),
    ])
    .unwrap_or_else(|| panic!("OCCT headers not found under {}", root.display()));
    let sdk_lib = first_library_dir(
        [
            root.join("lib"),
            root.join("lib64"),
            root.join("win64/vc17/lib"),
            root.join("win64/vc16/lib"),
            root.join("win64/vc15/lib"),
            root.join("win64/vc14/lib"),
        ],
        &target_os,
    )
    .unwrap_or_else(|| {
        panic!(
            "OCCT link libraries for {target_os} were not found under {}",
            root.display()
        )
    });
    let lib = env::var_os("NBCAD_OCCT_LIB_DIR")
        .map(PathBuf::from)
        .filter(|path| contains_library(path, &target_os, "TKernel"))
        .unwrap_or(sdk_lib);

    let mut bridge = cxx_build::bridge("src/native.rs");
    bridge
        .file("src/shim.cpp")
        .include("include")
        .include(&include)
        .std("c++17")
        .warnings(true);
    if target_os == "windows" {
        bridge
            .define("NOMINMAX", None)
            .define("WIN32_LEAN_AND_MEAN", None)
            .flag_if_supported("/EHsc");
    }
    bridge.compile("nbcad_occt_bridge");

    println!("cargo:rustc-link-search=native={}", lib.display());
    for library in [
        "TKDESTEP",
        "TKXSBase",
        "TKDE",
        "TKFillet",
        "TKHLR",
        "TKOffset",
        "TKBO",
        "TKPrim",
        "TKTopAlgo",
        "TKMesh",
        "TKBRep",
        "TKGeomAlgo",
        "TKGeomBase",
        "TKG3d",
        "TKG2d",
        "TKMath",
        "TKernel",
    ] {
        println!("cargo:rustc-link-lib=dylib={library}");
    }

    // Local development uses the SDK rpath. Tauri's production bundle
    // stages the recursive dylib closure into Contents/Frameworks and
    // rewrites direct loads to @rpath.
    if target_os == "macos" {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }

    assert!(Path::new("include/shim.hpp").exists());
}
