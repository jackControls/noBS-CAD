# Install noBS CAD

Download the **[showcase prerelease](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12.2)**
for your computer. The application includes the Scripts library and MCP server;
you do not need Rust, Node.js or an agent to use it. Choose an application package,
not GitHub's **Source code** archives.

This is pre-alpha software. Keep the original copy of an important `.nbcad`
project when trying a new build. The release notes record the source revision
and package checks.

Find the installed version, source revision and build channel under
**File → Settings → About noBS CAD**. Include that build text in a bug report.

## Windows

1. Download `noBS-CAD-0.1.0-windows-x64.zip` for an Intel/AMD PC. On Windows
   on Arm, use `noBS-CAD-0.1.0-windows-arm64.zip` instead.
2. Install the matching Microsoft Visual C++ v14 Redistributable if needed:
   [x64](https://aka.ms/vc14/vc_redist.x64.exe) or
   [ARM64](https://aka.ms/vc14/vc_redist.arm64.exe).
3. Extract **all** files into a folder you can keep, then open `noBS-CAD.exe`.
   Keep its DLLs and notices in that folder.

Use **Windows 11** with Microsoft Edge **WebView2**. The native viewport needs
a graphics adapter and driver that support **Direct3D 12 or Vulkan**;
see [wgpu's platform support](https://github.com/gfx-rs/wgpu#supported-platforms).
To update CAD, close it and extract the new ZIP to a separate folder;
your saved projects can stay where they are.

<details>
<summary>Windows startup help</summary>

If WebView2 is missing, install Microsoft's
[Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
Check the package architecture and Visual C++ runtime if a DLL error appears.
For a blank viewport or graphics-adapter error, [update the display driver](https://support.microsoft.com/en-us/windows/update-drivers-through-device-manager-in-windows-ec62f46c-ff14-c91d-eead-d7126dc1f7b6)
through Windows Update or the GPU manufacturer's support site, then restart CAD.
Package CI checks Windows Server 2025 on x64 and Windows 11 on ARM64 in the
[desktop workflow](../.github/workflows/desktop-packages.yml). Windows 10 remains
a compatibility target; this preview has no verified Windows 10 minimum.
The executable is not Authenticode-signed, so SmartScreen may show a warning.
This preview has no setup installer or automatic updater.

See [Windows packaging and troubleshooting](WINDOWS_PACKAGING.md) for details.

</details>

## macOS

Download the **Apple-silicon `.dmg`**, open it, and drag **noBS CAD** into
**Applications**. Launch it from Applications. Use the published release package,
which is Developer ID signed and notarized. There is no Intel Mac package.

The tested baseline is **macOS 15 (Sequoia), Apple silicon** in the
[desktop package workflow](../.github/workflows/desktop-packages.yml).
Older macOS versions have not been qualified for this preview; the minimum
compatible version has not yet been established. Keep the system components
current through **System Settings → General → Software Update**
([Apple's instructions](https://support.apple.com/en-us/108382)).

To update CAD, close it and replace the application in **Applications** with the
copy from the new DMG. Your saved project files can stay where they are.

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

## Make your first part

Start with the short **Sketch, extrude, ease the edges** lesson (`fillet-basics`).
The flagship assemblies have much longer construction sequences; the video edits
on the README are accelerated.

1. Open CAD, select **Scripts**, choose **Sketch, extrude, ease the edges**, and
   click **Run in new design**. Your existing design stays in its own tab.
2. Let the lesson and its final checks finish. The reference result is a
   **60 × 30 × 12 mm** block with **2 mm** rounds on its four top edges.
3. In the feature history, double-click the **Extrude** feature. Change
   **Distance** from **12** to **18 mm** and confirm the edit. The block becomes
   taller while retaining its sketch and rounded top edges.
4. Use **File → Save As** to save `first-part.nbcad` in a folder you can find.
   Close that design tab, then use **File → Open** to reopen the saved file.
   Double-click the extrusion again and confirm that its distance is **18 mm**.

<!-- Expected-result image: assets/showcase/first-part.png, from the verified
     live 18 mm edit and reopened first-part.nbcad. Add the image when captured. -->

**Save script as…** saves the construction recipe (`.nbcad.jsonc`). **File → Save**
saves the editable CAD project (`.nbcad`). Keep the project when you want to continue
modeling; keep the recipe when you want to replay its construction.

To inspect a flagship without waiting for construction, download its `.nbcad`
from the [showcase preview](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12.2)
and use **File → Open**. Browser **Open recipe** links load source into Scripts;
review it before choosing **Run in new design**. Launch the installed app once
before using those browser links, so it can register its `nbcad` handler.

## Connect an MCP agent

Agent setup is optional. Add a local **stdio MCP server** to your agent. Set the command to the installed
application executable and pass `--mcp`. This starts the Rust server without
opening a desktop window. A normal launch opens CAD for live work.

### Cursor

Edit your user MCP configuration: `%USERPROFILE%/.cursor/mcp.json` on Windows,
or `~/.cursor/mcp.json` on macOS/Linux. Add `nobs-cad` under `mcpServers`, keeping
any existing servers. This Windows example uses the extracted application:

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

### VS Code

Run **MCP: Open User Configuration** from the Command Palette to open the active
profile's `mcp.json`. For the default profile, the file is
`%APPDATA%/Code/User/mcp.json` on Windows,
`~/Library/Application Support/Code/User/mcp.json` on macOS, or
`~/.config/Code/User/mcp.json` on Linux. A workspace configuration instead belongs
in `.vscode/mcp.json`.

VS Code uses **`servers`**, with a `stdio` entry:

```json
{
  "servers": {
    "nobs-cad": {
      "type": "stdio",
      "command": "C:/YOUR/EXTRACTED/FOLDER/noBS-CAD.exe",
      "args": ["--mcp"]
    }
  }
}
```

Merge the entry into the chosen file; retain its other settings. See
[VS Code's MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)
for custom profiles and configuration options.

### Choose the executable and try it

Use the absolute path to your installed executable. On other platforms, keep
`"args": ["--mcp"]` and change `command`:

- **macOS:** `/Applications/noBS CAD.app/Contents/MacOS/nbcad`
- **Ubuntu DEB:** `/usr/bin/nbcad`

Reload the client's MCP servers and confirm that **nobs-cad** is available. Open
CAD normally, then ask your agent:

> Use noBS CAD to run the fillet-basics lesson in a new design in the open CAD
> window. Preserve my existing documents. After the final checks pass, change
> the stock extrusion from 12 to 18 mm, inspect the result and keep it open.

The expected reference and save/reopen steps are in
[Make your first part](#make-your-first-part). The agent should discover and
attach to the intended live design; an unattached MCP server owns a separate
headless document. Keep the desktop and MCP modes on the same release when updating.

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
