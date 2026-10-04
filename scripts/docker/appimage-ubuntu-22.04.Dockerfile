FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH=/root/.cargo/bin:/opt/node/bin:${PATH}
ENV OCCT_ROOT=/opt/opencascade
ENV LD_LIBRARY_PATH=/opt/opencascade/lib

# AppImage build SDK. The AppImage bundles every library it links except the
# C library, so it runs on distributions whose glibc is at least the build
# system's: building on Ubuntu 22.04 (glibc 2.35) covers Debian 12, Ubuntu
# 22.04 and later. Ubuntu 22.04 does not ship OCCT 7.9, so it is built from
# pinned source into /opt/opencascade. The Debian package is built with
# scripts/docker/ubuntu-26.04.Dockerfile against Ubuntu's OCCT instead.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        build-essential \
        ca-certificates \
        clang \
        cmake \
        curl \
        dbus-x11 \
        desktop-file-utils \
        file \
        git \
        libayatana-appindicator3-dev \
        libfontconfig-dev \
        libfreetype-dev \
        libfuse2 \
        libgtk-3-dev \
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
        squashfs-tools \
        vulkan-tools \
        xauth \
        xdg-utils \
        xvfb \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/build-occt-linux.sh /tmp/build-occt-linux.sh
# Optional --build-arg to cap the OCCT compile jobs on a shared machine.
ARG CMAKE_BUILD_PARALLEL_LEVEL
RUN /tmp/build-occt-linux.sh /opt/opencascade && rm /tmp/build-occt-linux.sh

COPY rust-toolchain.toml /opt/nbcad-toolchain/rust-toolchain.toml
WORKDIR /opt/nbcad-toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain none
RUN rustup show

# Ubuntu 22.04's nodejs is too old for the frontend build; use Node 22.
RUN cd /tmp \
    && curl --proto '=https' --tlsv1.2 -sSfLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt \
    && archive="$(grep -o 'node-v22[^ ]*-linux-x64\.tar\.xz' SHASUMS256.txt)" \
    && curl --proto '=https' --tlsv1.2 -sSfLO "https://nodejs.org/dist/latest-v22.x/$archive" \
    && grep " $archive\$" SHASUMS256.txt | sha256sum -c - \
    && mkdir -p /opt/node \
    && tar -xJf "$archive" -C /opt/node --strip-components=1 \
    && rm -f "$archive" SHASUMS256.txt

WORKDIR /workspace
