//! noBS CAD desktop entry point.

// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
