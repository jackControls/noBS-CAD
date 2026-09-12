# Install noBS CAD

Download the **[showcase prerelease](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12.2)**
for your computer. The application includes the Scripts library and MCP server;
you do not need Rust, Node.js or an agent to use it. Choose an application package,
not GitHub's **Source code** archives.

This is pre-alpha software. Keep the original copy of an important `.nbcad`
project when trying a new build. The release notes record the source revision
and package checks.

## Windows

1. Download `noBS-CAD-0.1.0-windows-x64.zip` for an Intel/AMD PC. On Windows
   on Arm, use `noBS-CAD-0.1.0-windows-arm64.zip` instead.
2. Install the matching Microsoft Visual C++ v14 Redistributable if needed:
   [x64](https://aka.ms/vc14/vc_redist.x64.exe) or
   [ARM64](https://aka.ms/vc14/vc_redist.arm64.exe).
3. Extract **all** files into a folder you can keep, then open `noBS-CAD.exe`.
   Keep its DLLs and notices in that folder.

Requires Windows 10 version 1803 or newer, or Windows 11, and Microsoft Edge
WebView2. To update, close CAD and extract the new ZIP to a separate folder;
your saved projects can stay where they are.

<details>
<summary>Windows startup help</summary>

If WebView2 is missing, install Microsoft's
[Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
Check the package architecture and Visual C++ runtime if a DLL error appears.
The executable is not Authenticode-signed, so SmartScreen may show a warning.
This preview has no setup installer or automatic updater.

See [Windows packaging and troubleshooting](WINDOWS_PACKAGING.md) for details.

</details>

## macOS

Download the **Apple-silicon `.dmg`**, open it, and drag **noBS CAD** into
**Applications**. Launch it from Applications. Use the published release package,
which is Developer ID signed and notarized. There is no Intel Mac package.

## Ubuntu

On **Ubuntu 26.04 LTS, x86_64**, download the `.deb` and run this from its folder:

```sh
sudo apt install ./noBS.CAD_0.1.0_amd64.deb
```

Open **noBS CAD** from the application launcher. Vulkan support is required.
The package is checked on X11 and Ubuntu's Wayland desktop through XWayland.

<details>
<summary>Ubuntu portable alternative: AppImage</summary>

If you prefer a portable application, download the AppImage instead:

```sh
chmod +x noBS.CAD_0.1.0_amd64.AppImage
./noBS.CAD_0.1.0_amd64.AppImage
```

For a FUSE error, launch it with `--appimage-extract-and-run`.
The AppImage has the same tested Ubuntu baseline; it does not establish support
for every Linux distribution.

Opening recipes from browser links requires the AppImage to launch normally
with FUSE. Its registered handler does not retain the extraction flag; use the
recommended DEB on a machine without FUSE. AppImage registration also requires
`xdg-utils` and `desktop-file-utils`, normally supplied by the Ubuntu desktop.

See [Linux dependencies and troubleshooting](LINUX_PACKAGING.md).

</details>

## Connect an MCP agent

Agent setup is optional. Add a local **stdio MCP server** to your agent. Set the command to the installed
application executable and pass `--mcp`. This starts the Rust server without
opening a desktop window. A normal launch opens CAD for live work.

For clients that accept `mcpServers`, a Windows configuration looks like:

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

Use the absolute path to your executable. On other platforms, keep the same
argument and change the command:

- **macOS:** `/Applications/noBS CAD.app/Contents/MacOS/nbcad`
- **Ubuntu DEB:** `/usr/bin/nbcad`

Reload the client's MCP servers, then ask it to discover the noBS CAD interface
and run a short recipe in a blank document. For live editing, open CAD normally
and have the agent discover and attach to the intended design. Keep the desktop
and MCP modes on the same release when updating.

The server runs locally and needs no cloud account. Your agent/model provider
has its own setup and data-handling choices.

<details>
<summary>Other clients, AppImage, and developer MCP setup</summary>

Some clients use a different configuration container; the executable and
arguments stay the same. Keep the complete Windows folder or macOS `.app`
together. Packaged MCP does not require an OCCT SDK or developer `PATH` setup.
In Windows JSON paths, use forward slashes or escape backslashes.

For AppImage, use its absolute path as the command. If FUSE is unavailable,
use `"args": ["--appimage-extract-and-run", "--mcp"]`.

Stdout carries MCP JSON-RPC; diagnostics go to stderr. See the
[server guide](../mcp-server/README.md) and [live-control contract](mcp-harness.md)
for the interface. Developers building a separate server should use the
[developer guide](DEVELOPMENT.md#standalone-mcp-server), not a second application
installation.

</details>

<details>
<summary>Verify a download's SHA-256 checksum</summary>

Download the package's adjacent `.sha256` asset into the same folder.
On Windows, compare the following values (substitute the ARM64 filename if used;
hash letter case does not matter):

```powershell
Get-FileHash .\noBS-CAD-0.1.0-windows-x64.zip -Algorithm SHA256
Get-Content .\noBS-CAD-0.1.0-windows-x64.zip.sha256
```

On macOS use `shasum -a 256 -c PACKAGE.sha256`; on Ubuntu use
`sha256sum -c PACKAGE.sha256`, substituting the downloaded checksum filename.

</details>
