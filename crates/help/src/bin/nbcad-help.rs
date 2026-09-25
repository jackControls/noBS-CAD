//! Optional CI helper: `nbcad-help check`
use std::env;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("check") => match nbcad_help::check_corpus() {
            Ok(n) => {
                println!("nbcad-help check OK ({n} pages)");
                ExitCode::SUCCESS
            }
            Err(errors) => {
                eprintln!("nbcad-help check failed:");
                for e in errors {
                    eprintln!("- {e}");
                }
                ExitCode::FAILURE
            }
        },
        Some("search") => {
            let query = args.collect::<Vec<_>>().join(" ");
            if query.is_empty() {
                eprintln!("usage: nbcad-help search <query>");
                return ExitCode::FAILURE;
            }
            let store = nbcad_help::HelpStore::bundled();
            for hit in store.search(&query, None) {
                println!("{:.3}\t{}\t{}", hit.score, hit.id, hit.title);
            }
            ExitCode::SUCCESS
        }
        Some("get") => {
            let Some(id) = args.next() else {
                eprintln!("usage: nbcad-help get <id>");
                return ExitCode::FAILURE;
            };
            match nbcad_help::HelpStore::bundled().get(&id) {
                Ok(page) => {
                    println!("# {}\n\n{}", page.title, page.body);
                    if page.truncated {
                        eprintln!("(truncated)");
                    }
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("{e}");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            eprintln!("usage: nbcad-help <check|search|get> ...");
            ExitCode::FAILURE
        }
    }
}
