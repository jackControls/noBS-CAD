fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=windows.manifest");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        winresource::WindowsResource::new()
            .set_icon("icons/icon.ico")
            .set("ProductName", "noBS CAD")
            .set("FileDescription", "noBS CAD")
            .set("OriginalFilename", "nbcad.exe")
            .set_manifest_file("windows.manifest")
            .compile()
            .expect("compile native Windows icon, version and DPI manifest");
    }
}
