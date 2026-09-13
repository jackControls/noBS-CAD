fn main() -> std::process::ExitCode {
    match nbcad_mcp::run_stdio() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("noBS CAD MCP failed: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
