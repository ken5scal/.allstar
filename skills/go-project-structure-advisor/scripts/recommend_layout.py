#!/usr/bin/env python3
"""
Recommend or scaffold Go project layout by profile.

Examples:
  python3 scripts/recommend_layout.py --profile p0 --project obsflow
  python3 scripts/recommend_layout.py --profile p0 --project obsflow --scaffold-root ./sandbox
"""

from __future__ import annotations

import argparse
from pathlib import Path


PROFILES = {
    "p0": {
        "label": "P0 lean single-application",
        "tree": [
            "cmd/{project}/main.go",
            "internal/config/load.go",
            "internal/config/types.go",
            "internal/model/record.go",
            "internal/model/job.go",
            "internal/handler/tick.go",
            "internal/handler/run.go",
            "internal/handler/validate.go",
            "internal/service/tick_service.go",
            "internal/service/collect_service.go",
            "internal/service/summarize_service.go",
            "internal/service/digest_service.go",
            "internal/repository/interfaces.go",
            "internal/repository/state_sqlite.go",
            "internal/repository/source_rss.go",
            "internal/repository/source_x.go",
            "internal/repository/vault_fs.go",
            "internal/repository/ai_external.go",
            "internal/repository/alert_slack.go",
        ],
    },
    "p1": {
        "label": "P1 growing multi-domain",
        "tree": [
            "cmd/api/main.go",
            "cmd/worker/main.go",
            "internal/platform/logging/logger.go",
            "internal/platform/persistence/sqlite.go",
            "internal/ingest/handler/http.go",
            "internal/ingest/service/collect_service.go",
            "internal/ingest/repository/source_rss.go",
            "internal/digest/handler/trigger.go",
            "internal/digest/service/digest_service.go",
            "internal/digest/repository/note_store.go",
        ],
    },
    "p2": {
        "label": "P2 platform or high-governance",
        "tree": [
            "cmd/collector/main.go",
            "cmd/summarizer/main.go",
            "internal/platform/observability/logging.go",
            "internal/platform/persistence/db.go",
            "internal/platform/messaging/bus.go",
            "internal/modules/ingest/app/collect_usecase.go",
            "internal/modules/ingest/domain/source_item.go",
            "internal/modules/ingest/infra/rss_client.go",
            "internal/modules/ingest/transport/http_handler.go",
            "internal/modules/digest/app/digest_usecase.go",
            "internal/modules/digest/domain/digest_job.go",
            "internal/modules/digest/infra/note_repository.go",
            "internal/modules/digest/transport/cli_handler.go",
        ],
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=["p0", "p1", "p2"], required=True)
    parser.add_argument("--project", default="app")
    parser.add_argument(
        "--scaffold-root",
        help="Create directories/files under this root path",
    )
    return parser.parse_args()


def render_tree(profile: str, project: str) -> list[str]:
    return [entry.format(project=project) for entry in PROFILES[profile]["tree"]]


def print_recommendation(profile: str, project: str) -> None:
    tree = render_tree(profile, project)
    label = PROFILES[profile]["label"]
    print(f"Profile: {label}\n")
    print("Recommended tree:")
    for path in tree:
        print(f"- {path}")


def package_name_from_path(path: str) -> str:
    parts = Path(path).parts
    if "internal" in parts:
        idx = parts.index("internal")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    if "cmd" in parts and path.endswith("main.go"):
        return "main"
    return "app"


def default_content(path: str) -> str:
    if path.endswith("main.go"):
        return "package main\n\nfunc main() {}\n"
    pkg = package_name_from_path(path)
    return f"package {pkg}\n"


def scaffold(root: Path, profile: str, project: str) -> None:
    tree = render_tree(profile, project)
    for relative in tree:
        dst = root / relative
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not dst.exists():
            dst.write_text(default_content(relative))
    print(f"\nScaffolded {len(tree)} files under: {root}")


def main() -> None:
    args = parse_args()
    print_recommendation(args.profile, args.project)
    if args.scaffold_root:
        scaffold(Path(args.scaffold_root).resolve(), args.profile, args.project)


if __name__ == "__main__":
    main()
