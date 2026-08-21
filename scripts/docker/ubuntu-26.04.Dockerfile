FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH=/root/.cargo/bin:${PATH}

# Official Ubuntu 26.04 build/runtime SDK for the Tauri + WebKitGTK shell,
# Bevy/wgpu viewport, HID input and Ubuntu's OpenCASCADE 7.9 packages.
# Ubuntu's data-exchange -dev meta-package also depends on the VTK/IVTK
# development stack. noBS CAD needs its STEP headers, but not those
# visualization SDKs, so the RUN command extracts only that header package
# after installing its runtime and lower-level development dependencies.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential \
        ca-certificates \
        clang \
        cmake \
        curl \
        dbus-x11 \
        file \
        libayatana-appindicator3-dev \
        libfuse2t64 \
        libgtk-3-dev \
        libocct-data-exchange-7.9 \
        libocct-foundation-dev \
        libocct-modeling-algorithms-dev \
        libocct-modeling-data-dev \
        librsvg2-dev \
        libssl-dev \
        libudev-dev \
        libvulkan-dev \
        libwayland-dev \
        libwebkit2gtk-4.1-dev \
        libx11-dev \
        libxdo-dev \
        libxkbcommon-dev \
        mesa-vulkan-drivers \
        ninja-build \
        patchelf \
        vulkan-tools \
        weston \
        wget \
        xauth \
        xvfb \
    && if apt-cache show xwayland >/dev/null 2>&1; then \
         apt-get install --yes --no-install-recommends xwayland; \
       fi \
    && cd /tmp \
    && apt-get download libocct-data-exchange-dev \
    && dpkg-deb --extract libocct-data-exchange-dev_*.deb / \
    && rm -f libocct-data-exchange-dev_*.deb \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup target add wasm32-unknown-unknown \
    && cargo install wasm-pack --version 0.13.1 --locked

# Keep the reproducible SDK rooted in the official Ubuntu 26.04 archive. CI
# still uses setup-node for the pinned Node 22 release toolchain.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
