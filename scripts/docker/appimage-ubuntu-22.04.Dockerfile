# syntax=docker/dockerfile:1
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH=/root/.cargo/bin:${PATH}
ENV OCCT_ROOT=/opt/opencascade
ENV LD_LIBRARY_PATH=/opt/opencascade/lib

# AppImage build SDK. Graphics/window loaders remain host libraries. The
# package runs on distributions whose glibc is at least the build
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
        libdbus-1-3 \
        libfontconfig-dev \
        libfreetype-dev \
        libfuse2 \
        libudev-dev \
        libvulkan-dev \
        libwayland-dev \
        libx11-dev \
        libx11-xcb1 \
        libxcursor1 \
        libxi6 \
        libxkbcommon-dev \
        libxkbcommon-x11-dev \
        pkg-config \
        mesa-vulkan-drivers \
        ninja-build \
        patchelf \
        squashfs-tools \
        vulkan-tools \
        xauth \
        xclip \
        xdg-utils \
        xdotool \
        xvfb \
        xz-utils \
        zenity \
    && rm -rf /var/lib/apt/lists/*

COPY rust-toolchain.toml /opt/nbcad-toolchain/rust-toolchain.toml
WORKDIR /opt/nbcad-toolchain
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain none
RUN rustup show

# Mount source inputs only for the SDK build; keep application code out of the image.
COPY Cargo.toml Cargo.lock rust-toolchain.toml VERSION /tmp/nbcad-build-tools/
COPY .cargo/config.toml .cargo/tools.toml /tmp/nbcad-build-tools/.cargo/
WORKDIR /tmp/nbcad-build-tools
RUN mkdir -p crates xtask assets/i18n
# Optional --build-arg to cap OCCT compile jobs on a shared machine.
ARG CMAKE_BUILD_PARALLEL_LEVEL
# Application edits may invalidate this layer; compatible SDK objects and Rust
# dependencies survive in BuildKit caches. Source mounts do not enter the image.
RUN --mount=type=bind,source=crates,target=/tmp/nbcad-build-tools/crates \
    --mount=type=bind,source=xtask,target=/tmp/nbcad-build-tools/xtask \
    --mount=type=bind,source=assets/i18n,target=/tmp/nbcad-build-tools/assets/i18n \
    --mount=type=cache,target=/var/cache/nbcad-rust-target,sharing=locked \
    --mount=type=cache,target=/root/.cargo/registry,sharing=locked \
    --mount=type=cache,target=/root/.cargo/git,sharing=locked \
    --mount=type=cache,target=/var/cache/nbcad-sdk,sharing=locked \
    CARGO_TARGET_DIR=/var/cache/nbcad-rust-target NBCAD_BUILD_CACHE=/var/cache/nbcad-sdk \
      cargo run --quiet --locked -p xtask -- build-occt --prefix /opt/opencascade
RUN rm -rf /tmp/nbcad-build-tools

WORKDIR /workspace
