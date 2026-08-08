use std::{env, path::PathBuf};

fn main() {
    let output = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("bevy-ui-native.png"));
    nbcad_lib::native_viewport::ui_lab::run(output);
}
