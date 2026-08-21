#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <appimage-or-deb> <x11|xwayland> <diagnostics-directory>" >&2
  exit 2
fi

artifact="$(realpath "$1")"
backend="$2"
diagnostics="$(realpath -m "$3")"
if [[ "$backend" != "x11" && "$backend" != "xwayland" ]]; then
  echo "display backend must be x11 or xwayland" >&2
  exit 2
fi
if [[ ! -f "$artifact" ]]; then
  echo "Linux application artifact was not found: $artifact" >&2
  exit 2
fi

mkdir -p "$diagnostics"
work="$(mktemp -d)"
runtime="$work/runtime"
probe="$diagnostics/native-viewport-$backend.json"
app_log="$diagnostics/application-$backend.log"
weston_log="$diagnostics/weston-$backend.log"
app_pid=""
weston_pid=""

cleanup() {
  if [[ -n "$app_pid" ]]; then
    kill "$app_pid" 2>/dev/null || true
    wait "$app_pid" 2>/dev/null || true
  fi
  if [[ -n "$weston_pid" ]]; then
    kill "$weston_pid" 2>/dev/null || true
    wait "$weston_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

case "$artifact" in
  *.AppImage)
    chmod +x "$artifact"
    (
      cd "$work"
      "$artifact" --appimage-extract >/dev/null
    )
    app="$work/squashfs-root/AppRun"
    if [[ ! -x "$app" ]]; then
      echo "AppImage did not contain an executable AppRun" >&2
      exit 1
    fi
    ;;
  *.deb)
    package_root="$work/deb-root"
    dpkg-deb --extract "$artifact" "$package_root"
    app="$package_root/usr/bin/nbcad"
    if [[ ! -x "$app" ]]; then
      echo "Debian package did not contain usr/bin/nbcad" >&2
      exit 1
    fi
    ;;
  *)
    echo "expected an AppImage or Debian package, got: $artifact" >&2
    exit 2
    ;;
esac

vulkan_icd="$(find /usr/share/vulkan/icd.d -maxdepth 1 -type f -name 'lvp_icd*.json' -print -quit)"
if [[ -z "$vulkan_icd" ]]; then
  echo "Mesa lavapipe Vulkan ICD was not found" >&2
  exit 1
fi

common_env=(
  "NBCAD_VIEWPORT_PROBE_FILE=$probe"
  "WGPU_BACKEND=vulkan"
  "VK_ICD_FILENAMES=$vulkan_icd"
  "LIBGL_ALWAYS_SOFTWARE=1"
  "WEBKIT_DISABLE_DMABUF_RENDERER=1"
)

if [[ "$backend" == "x11" ]]; then
  xvfb-run -a -s "-screen 0 1440x900x24" \
    dbus-run-session -- \
    env "${common_env[@]}" GDK_BACKEND=x11 "$app" >"$app_log" 2>&1 &
  app_pid=$!
else
  if ! command -v Xwayland >/dev/null 2>&1; then
    echo "Xwayland is required for the Wayland-desktop compatibility probe" >&2
    exit 1
  fi
  mkdir -p "$runtime"
  chmod 700 "$runtime"
  XDG_RUNTIME_DIR="$runtime" \
    weston \
      --backend=headless \
      --renderer=pixman \
      --width=1440 \
      --height=900 \
      --socket=nbcad-ci \
      --xwayland \
      --idle-time=0 \
      --no-config >"$weston_log" 2>&1 &
  weston_pid=$!
  for _ in $(seq 1 100); do
    [[ -S "$runtime/nbcad-ci" ]] && break
    kill -0 "$weston_pid" 2>/dev/null || {
      cat "$weston_log" >&2
      echo "Weston exited before publishing its Wayland socket" >&2
      exit 1
    }
    sleep 0.1
  done
  if [[ ! -S "$runtime/nbcad-ci" ]]; then
    cat "$weston_log" >&2
    echo "Weston did not publish its Wayland socket" >&2
    exit 1
  fi
  xwayland_display=""
  for _ in $(seq 1 100); do
    xwayland_display="$(sed -n 's/.*xserver listening on display \(:[0-9][0-9]*\).*/\1/p' "$weston_log" | tail -n 1)"
    [[ -n "$xwayland_display" ]] && break
    kill -0 "$weston_pid" 2>/dev/null || {
      cat "$weston_log" >&2
      echo "Weston exited before starting XWayland" >&2
      exit 1
    }
    sleep 0.1
  done
  if [[ -z "$xwayland_display" ]]; then
    cat "$weston_log" >&2
    echo "Weston did not publish an XWayland display" >&2
    exit 1
  fi
  dbus-run-session -- \
    env \
      "${common_env[@]}" \
      "XDG_RUNTIME_DIR=$runtime" \
      WAYLAND_DISPLAY=nbcad-ci \
      "DISPLAY=$xwayland_display" \
      GDK_BACKEND=x11 \
      "$app" >"$app_log" 2>&1 &
  app_pid=$!
fi

for _ in $(seq 1 180); do
  [[ -f "$probe" ]] && break
  kill -0 "$app_pid" 2>/dev/null || {
    cat "$app_log" >&2
    echo "Application exited before reporting native viewport readiness" >&2
    exit 1
  }
  sleep 0.5
done
if [[ ! -f "$probe" ]]; then
  cat "$app_log" >&2
  echo "Native viewport did not report ready or failed within 90 seconds" >&2
  exit 1
fi

# A render-task panic can race the asynchronous readiness probe. Give the
# renderer a moment to flush its diagnostics, then require both a live process
# and a panic-free application log before trusting the probe payload.
sleep 1
if ! kill -0 "$app_pid" 2>/dev/null; then
  cat "$app_log" >&2
  echo "Application exited immediately after reporting native viewport readiness" >&2
  exit 1
fi
if grep -Eiq 'panicked at|thread .* panicked|Encountered a panic in system' "$app_log"; then
  cat "$app_log" >&2
  echo "Native viewport reported ready but the renderer subsequently panicked" >&2
  exit 1
fi

cat "$probe"
node - "$probe" x11 <<'NODE'
const [probePath, expectedDisplay] = process.argv.slice(2);
const probe = JSON.parse(require('node:fs').readFileSync(probePath, 'utf8'));
if (probe.status !== 'ready') {
  throw new Error(`native viewport startup failed: ${probe.error ?? 'unknown error'}`);
}
if (probe.displayBackend !== expectedDisplay) {
  throw new Error(`expected ${expectedDisplay}, got ${probe.displayBackend}`);
}
if (!String(probe.backend).includes('Vulkan')) {
  throw new Error(`expected Vulkan renderer, got ${probe.backend}`);
}
if (probe.physicalWidth < 100 || probe.physicalHeight < 100) {
  throw new Error(`invalid surface size ${probe.physicalWidth}x${probe.physicalHeight}`);
}
if (probe.renderedFrames < 2) {
  throw new Error(`renderer reported only ${probe.renderedFrames} frames`);
}
NODE
