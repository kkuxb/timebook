"""独立发布包构建脚本：扫描 timebook 源码并生成兼容 unpack_verify.py 的 ZIP 发布包。

用法：
  python scripts/release_app.py build --output workspace-data/outputs/timebook/v1.0.0-R1/timebook.zip
"""
import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_NAME = "timebook"
MANIFEST_NAME = "_release-manifest.json"

EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "target",
    "workspace-data",
    "__pycache__",
    ".wrangler",
    ".vscode",
    ".idea",
}

EXCLUDE_FILES = {
    ".DS_Store",
    "Thumbs.db",
}

EXCLUDE_SUFFIXES = (
    ".sqlite",
    ".sqlite-wal",
    ".sqlite-shm",
    ".sqlite-journal",
    ".log",
    ".pem",
    ".key",
    ".tsbuildinfo",
)

# 禁止打入发布包的私密/机器路径模式
FORBIDDEN_PATTERNS = [
    (re.compile(r"(?:[A-Za-z]:[/\\]Users[/\\][^/\\\s\"']+)"), "包含本机用户绝对路径"),
    (re.compile(r"192\.168\.\d+\.\d+"), "包含硬编码局域网 IP"),
    (re.compile(r"secret_[a-zA-Z0-9]{20,}"), "疑似 Notion 或第三方密钥"),
]


def is_excluded(rel_posix: str, path: Path) -> bool:
    parts = rel_posix.split("/")
    if any(p in EXCLUDE_DIRS for p in parts):
        return True
    name = path.name
    if name in EXCLUDE_FILES:
        return True
    # 排除 .env 和 .env.*，但保留 .env.example
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        return True
    if name.endswith(EXCLUDE_SUFFIXES):
        return True
    return False


def collect_files() -> list[tuple[str, Path]]:
    items: list[tuple[str, Path]] = []
    for root, dirs, files in os.walk(ROOT):
        root_path = Path(root)
        # 就地裁剪忽略目录
        dirs[:] = sorted(
            d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".pytest")
        )
        for fname in sorted(files):
            fpath = root_path / fname
            rel = fpath.relative_to(ROOT).as_posix()
            if is_excluded(rel, fpath):
                continue
            items.append((rel, fpath))
    items.sort(key=lambda x: x[0])
    return items


def security_scan(items: list[tuple[str, Path]]) -> list[str]:
    problems: list[str] = []
    text_exts = {
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".json",
        ".yaml",
        ".yml",
        ".md",
        ".html",
        ".css",
        ".py",
        ".rs",
        ".toml",
        ".example",
    }
    for rel, fpath in items:
        if rel == "scripts/release_app.py":
            continue
        if fpath.suffix.lower() not in text_exts and fpath.name not in {"Dockerfile"}:
            continue
        try:
            content = fpath.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pat, desc in FORBIDDEN_PATTERNS:
            if pat.search(content):
                problems.append(f"{rel}: {desc}")
    return problems


def build_zip(output_path: Path) -> dict:
    items = collect_files()
    problems = security_scan(items)
    if problems:
        raise RuntimeError("发布包静态安全检查未通过:\n" + "\n".join(problems))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        raise FileExistsError(f"目标发布包已存在，请使用新的轮次路径避免覆盖: {output_path}")

    files_sha: dict[str, str] = {}
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel, fpath in items:
            raw = fpath.read_bytes()
            files_sha[rel] = hashlib.sha256(raw).hexdigest()
            zf.writestr(f"{APP_NAME}/{rel}", raw)

        manifest = {
            "schemaVersion": 1,
            "skill": APP_NAME,
            "files": files_sha,
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
        zf.writestr(f"{APP_NAME}/{MANIFEST_NAME}", manifest_bytes)

    return {
        "ok": True,
        "output": str(output_path.resolve()),
        "file_count": len(files_sha),
        "zip_sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
    }


def main():
    ap = argparse.ArgumentParser(description="构建 Timebook 独立发布包")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="构建发布 ZIP")
    b.add_argument("--output", required=True, help="输出 ZIP 文件路径")
    args = ap.parse_args()

    if args.cmd == "build":
        res = build_zip(Path(args.output))
        print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(1)
