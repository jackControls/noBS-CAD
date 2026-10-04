//! Fail-closed opt-in for OS input on this repository's disposable runners.

pub(super) fn enabled(
    platform: &str,
    expected_platform: &str,
    runner: &str,
    opt_in: (&str, &str),
    read: impl Fn(&str) -> Option<String>,
) -> bool {
    platform == expected_platform
        && [
            opt_in,
            ("GITHUB_ACTIONS", "true"),
            ("RUNNER_OS", runner),
            ("RUNNER_ENVIRONMENT", "github-hosted"),
            ("GITHUB_REPOSITORY", crate::repository::slug()),
        ]
        .into_iter()
        .all(|(key, expected)| read(key).as_deref() == Some(expected))
        && read("GITHUB_RUN_ID")
            .is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renamed_repository_preserves_every_disposable_runner_guard() {
        for (platform, runner, opt_in) in [
            (
                "windows",
                "Windows",
                ("NBCAD_NATIVE_IME_TEST", "windows-japanese"),
            ),
            (
                "macos",
                "macOS",
                ("NBCAD_NATIVE_IME_TEST", "macos-japanese"),
            ),
            (
                "windows",
                "Windows",
                ("NBCAD_NATIVE_PRINT_TEST", "windows-cancel"),
            ),
        ] {
            let environment = |key: &str| {
                Some(if key == opt_in.0 {
                    opt_in.1.into()
                } else {
                    match key {
                        "GITHUB_ACTIONS" => "true".into(),
                        "RUNNER_OS" => runner.into(),
                        "RUNNER_ENVIRONMENT" => "github-hosted".into(),
                        "GITHUB_REPOSITORY" => crate::repository::slug().into(),
                        "GITHUB_RUN_ID" => "123".into(),
                        _ => return None,
                    }
                })
            };
            assert!(enabled(platform, platform, runner, opt_in, environment));
            assert!(!enabled("linux", platform, runner, opt_in, environment));
            for key in [
                opt_in.0,
                "GITHUB_ACTIONS",
                "RUNNER_OS",
                "RUNNER_ENVIRONMENT",
                "GITHUB_REPOSITORY",
                "GITHUB_RUN_ID",
            ] {
                assert!(
                    !enabled(platform, platform, runner, opt_in, |name| {
                        if name == key {
                            None
                        } else {
                            environment(name)
                        }
                    }),
                    "{platform}: missing {key}"
                );
            }
            for (key, bad) in [
                (opt_in.0, "another-mode"),
                ("GITHUB_ACTIONS", "false"),
                ("RUNNER_OS", "Linux"),
                ("RUNNER_ENVIRONMENT", "self-hosted"),
                ("GITHUB_REPOSITORY", "another/repo"),
                ("GITHUB_REPOSITORY", "jackControls/noBS-CAD"),
                ("GITHUB_RUN_ID", ""),
                ("GITHUB_RUN_ID", "local"),
                ("GITHUB_RUN_ID", "12 34"),
            ] {
                assert!(
                    !enabled(platform, platform, runner, opt_in, |name| {
                        if name == key {
                            Some(bad.into())
                        } else {
                            environment(name)
                        }
                    }),
                    "{platform}: invalid {key}={bad}"
                );
            }
        }
    }
}
