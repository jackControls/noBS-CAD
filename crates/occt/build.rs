use std::env;
use std::path::{Path, PathBuf};

fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|path| path.exists())
}

fn main() {
    println!("cargo:rerun-if-changed=src/native.rs");
    println!("cargo:rerun-if-changed=src/shim.cpp");
    println!("cargo:rerun-if-changed=include/shim.hpp");
    println!("cargo:rerun-if-env-changed=OCCT_ROOT");
    println!("cargo:rerun-if-env-changed=NBCAD_OCCT_LIB_DIR");

    if env::var_os("CARGO_FEATURE_NATIVE_OCCT").is_none() {
        return;
    }

    let explicit = env::var_os("OCCT_ROOT").map(PathBuf::from);
    let root = first_existing(explicit.into_iter().chain([
        PathBuf::from("/opt/homebrew/opt/opencascade"),
        PathBuf::from("/usr/local/opt/opencascade"),
        PathBuf::from("/opt/opencascade"),
    ]))
    .unwrap_or_else(|| {
        panic!(
            "OCCT SDK not found. Set OCCT_ROOT or install Homebrew opencascade (tested with 7.9.x)"
        )
    });

    let include = first_existing([root.join("include/opencascade"), root.join("include")])
        .unwrap_or_else(|| panic!("OCCT headers not found under {}", root.display()));
    let sdk_lib = first_existing([root.join("lib"), root.join("lib64")])
        .unwrap_or_else(|| panic!("OCCT libraries not found under {}", root.display()));
    let lib = env::var_os("NBCAD_OCCT_LIB_DIR")
        .map(PathBuf::from)
        .filter(|path| path.join("libTKernel.dylib").exists())
        .unwrap_or(sdk_lib);

    cxx_build::bridge("src/native.rs")
        .file("src/shim.cpp")
        .include("include")
        .include(&include)
        .flag_if_supported("-std=c++17")
        .warnings(true)
        .compile("nbcad_occt_bridge");

    println!("cargo:rustc-link-search=native={}", lib.display());
    for library in [
        "TKDESTEP",
        "TKXSBase",
        "TKDE",
        "TKFillet",
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
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }

    assert!(Path::new("include/shim.hpp").exists());
}
