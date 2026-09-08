#[test]
fn part_design_goldens_over_mcp_stdio() {
    let status = std::process::Command::new("node")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/examples/part-design/run.mjs"
        ))
        .arg("--server")
        .arg(env!("CARGO_BIN_EXE_nbcad-mcp"))
        .status()
        .expect("Node.js is required to run the MCP stdio part-design goldens");
    assert!(status.success(), "part-design golden failed");
}

#[test]
fn parametric_assembly_over_mcp_stdio() {
    let status = std::process::Command::new("node")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/examples/part-design/assembly.mjs"
        ))
        .arg("--server")
        .arg(env!("CARGO_BIN_EXE_nbcad-mcp"))
        .status()
        .expect("Node.js is required for the parametric assembly golden");
    assert!(status.success(), "parametric assembly golden failed");
}
