//! noBS CAD desktop entry point.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The packaged application is also the standalone MCP executable. Branch
    // before any platform, window, or renderer initialization and retain the
    // pipes supplied by the agent (including Windows GUI-subsystem builds).
    let mut arguments = std::env::args_os().skip(1);
    if arguments.next().is_some_and(|argument| argument == "--mcp") {
        if arguments.next().is_some() {
            eprintln!("Usage: noBS CAD --mcp (no additional arguments)");
            std::process::exit(2);
        }
        if std::env::var_os("NBCAD_DESKTOP_BIN").is_none() {
            if let Ok(executable) = std::env::current_exe() {
                std::env::set_var("NBCAD_DESKTOP_BIN", executable);
            }
        }
        nbcad_mcp::run_stdio();
        return;
    }

    #[cfg(target_os = "linux")]
    {
        // GTK 3 exposes child widget windows as real X11 windows, which lets
        // wgpu own a Vulkan surface beneath WebKitGTK. Under native Wayland it
        // exposes the top-level wl_surface instead; GTK and Vulkan would then
        // attach competing buffers to one compositor-owned surface. Ubuntu's
        // Wayland desktop supplies XWayland for this compatibility path.
        std::env::set_var("GDK_BACKEND", "x11");
    }
    nbcad_lib::run();
}
