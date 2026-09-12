# Install noBS CAD

Start with the **[showcase prerelease](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12)**.
Download an application asset, rather than GitHub's automatically generated
**Source code** archives. The app, built-in Scripts library and packaged MCP mode
do not require Rust or Node.js. Connecting an agent is optional.

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

**The application download includes MCP.** Configure a local stdio server in your
agent with the application executable as its command and `--mcp` as an argument.
It runs the same Rust server without opening a desktop window or initializing the
viewport. Use a normal launch, without that argument, to open CAD for live work.

For clients accepting the `mcpServers` configuration shape, Windows looks like:

```json
{
  "mcpServers": {
    "nobs-cad": {
      "command": "C:/YOUR/EXTRACTED/FOLDER/noBS-CAD.exe",
      "args": ["--mcp"]
    }
  }
}
```

Replace the placeholder with the absolute path to your extracted executable.
Keep its DLLs beside it; there is no OCCT SDK or developer `PATH` setup for the
portable package. Use forward slashes in JSON or escape Windows backslashes.

Use the same `args` on other platforms, changing `command` to:

- **macOS:** `/Applications/noBS CAD.app/Contents/MacOS/nbcad` (the executable
  inside the installed app, not `open -a`). Keep the complete `.app` together.
- **Ubuntu DEB:** `/usr/bin/nbcad` after installing the package.
- **Ubuntu AppImage:** the absolute path to your executable AppImage. If FUSE is
  unavailable, use `"args": ["--appimage-extract-and-run", "--mcp"]` so the
  AppImage runtime sets up its libraries before starting the server.

Other clients use different configuration containers; add an equivalent **stdio**
entry with the same command and arguments. Restart the client or reload its MCP
servers. Confirm `nobs-cad` appears and ask it to discover the product interface
or run a short recipe in a blank headless document.

Stdout carries MCP JSON-RPC; diagnostics go to stderr. The server needs no cloud
account. Your agent/model provider has its own setup and data-handling choices.
For live editing, launch CAD normally and discover/attach to the intended design.
Keep the desktop and MCP modes on the same release when updating.
See the [server guide](../mcp-server/README.md) and [live-control contract](mcp-harness.md).

### Build the standalone server from source

Developers can still build `nbcad-mcp` separately. Use matching desktop/server
source revisions for live control.

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

On Windows the helper also configures the OCCT DLL search path. For manual
configuration, add the matching `vcpkg_installed/x64-windows/bin` (or
`arm64-windows/bin`) directory to the server process's `PATH`, preserving the
existing entries. Setting `OCCT_ROOT` alone does not configure the Windows DLL
loader. See [the detailed MCP installer guide](agentic/INSTALL_MCP.md).

For manual source-build configuration, point the stdio command at this executable
without `--mcp` (the standalone binary already starts in server mode):

```json
{
  "mcpServers": {
    "nobs-cad": {
      "command": "/absolute/path/to/noBS-CAD/mcp-server/target/release/nbcad-mcp"
    }
  }
}
```

On Windows use an absolute path ending in `nbcad-mcp.exe`. The source installer
does not configure the packaged application; use the packaged instructions above
when your command is the desktop executable.
