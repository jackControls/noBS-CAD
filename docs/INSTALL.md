# Install noBS CAD

Start with the **[showcase prerelease](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12)**.
Download an application asset, rather than GitHub's automatically generated
**Source code** archives. The app and built-in Scripts library do not require
Rust, Node.js or an agent. Standalone MCP setup is described below.

This is pre-alpha software. Keep the original copy of an important `.nbcad`
project when trying a new build. The release notes identify the source revision
and checks performed on each package.

## Windows

1. Choose `noBS-CAD-0.1.0-windows-x64.zip` for an Intel/AMD PC, or
   `noBS-CAD-0.1.0-windows-arm64.zip` for Windows on Arm.
2. Install the matching Microsoft Visual C++ v14 Redistributable if needed:
   [x64](https://aka.ms/vc14/vc_redist.x64.exe) or
   [ARM64](https://aka.ms/vc14/vc_redist.arm64.exe).
3. Extract **all** files into a folder you can keep, then open `noBS-CAD.exe`.
   Keep the supplied DLLs and notices together with the executable.

The supported baseline is Windows 10 version 1803 or newer, or Windows 11, with
the Microsoft Edge WebView2 Runtime. If WebView2 is missing, use Microsoft's
[Evergreen Runtime installer](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
There is no MSI/setup installer or automatic updater in this preview. To update,
close CAD and extract the new ZIP to a separate folder. Your saved projects can
stay wherever you keep them.

If startup fails, check the architecture and runtimes before reporting the exact
error. [Windows packaging and troubleshooting](WINDOWS_PACKAGING.md)

## macOS

Download the **Apple-silicon `.dmg`**, open it and drag **noBS CAD** into
**Applications**. Launch it from Applications. This release does not provide an
Intel Mac binary. Signing and notarization status are recorded in the release
notes; use the published release package rather than a diagnostic CI build.

[macOS build and native dependency details](OCCT_PACKAGING.md)

## Ubuntu

The supported baseline is **Ubuntu 26.04 LTS, x86_64**, with Vulkan support.
X11 and Ubuntu's Wayland desktop through XWayland are covered by the package
launch checks. AppImage is an alternative package on this baseline, not a promise
of compatibility with every Linux distribution.

Download the `.deb` and install it from its folder:

```sh
sudo apt install ./noBS.CAD_0.1.0_amd64.deb
```

Then open **noBS CAD** from the application launcher. Alternatively, download
the AppImage, mark it executable and launch it:

```sh
chmod +x noBS.CAD_0.1.0_amd64.AppImage
./noBS.CAD_0.1.0_amd64.AppImage
```

For an AppImage FUSE error, the standard extraction-and-run mode is also available:

```sh
./noBS.CAD_0.1.0_amd64.AppImage --appimage-extract-and-run
```

[Linux dependencies, display support and troubleshooting](LINUX_PACKAGING.md)

## Check your download

Each application package has an adjacent `.sha256` asset. Download both and
compare the SHA-256 before opening the application.

On Windows (replace the filename for ARM64):

```powershell
Get-FileHash .\noBS-CAD-0.1.0-windows-x64.zip -Algorithm SHA256
Get-Content .\noBS-CAD-0.1.0-windows-x64.zip.sha256
```

Compare the hash values; letter case does not matter. On macOS use
`shasum -a 256 -c PACKAGE.sha256`; on Ubuntu use
`sha256sum -c PACKAGE.sha256`, substituting the downloaded checksum filename.
Run the command in the folder containing the package.

## Connect an MCP agent

The desktop app includes the recipe runner. **The standalone `nbcad-mcp` stdio
server is currently a separate source build**, not an executable in the desktop
download. Use matching desktop/server source revisions for live control.

Install the platform's Rust and OCCT build dependencies using the
[developer guide](DEVELOPMENT.md), then check out the release source:

```sh
git clone --branch preview-2026-09-12 https://github.com/jackControls/noBS-CAD.git
cd noBS-CAD
cargo build --release --locked --manifest-path mcp-server/Cargo.toml
```

On Windows set `OCCT_ROOT` to the installed matching vcpkg prefix before building,
as described in [Windows setup](WINDOWS_PACKAGING.md). The server must be able to
load the same OCCT runtime libraries when your agent starts it.

The repository can discover and configure supported client presets:

```sh
cargo xtask install-mcp --dry-run
cargo xtask install-mcp --clients cursor
```

Replace `cursor` with `vscode`, `claude` or `opencode`, or use a comma-separated
list of clients you want configured. The installer builds/copies the server to a
stable user directory, backs up existing client configuration and preserves
unrelated entries. Restart the client or reload MCP afterward.

For other clients, add a **local stdio server** pointing at the built executable
using that client's configuration format. For clients accepting `mcpServers`:

```json
{
  "mcpServers": {
    "nobs-cad": {
      "command": "/absolute/path/to/noBS-CAD/mcp-server/target/release/nbcad-mcp"
    }
  }
}
```

On Windows use an absolute path ending in `nbcad-mcp.exe` and escape backslashes
in JSON (or use forward slashes). Stdout carries MCP JSON-RPC; logs go to stderr.
The server needs no cloud account. Your agent/model provider has its own setup
and data-handling choices.

Use session discovery and attachment to select the intended live design before
editing. See the [server guide](../mcp-server/README.md) and
[live-control contract](mcp-harness.md).
