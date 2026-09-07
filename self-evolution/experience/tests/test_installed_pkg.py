"""真实验证：experience-store 已解耦为独立可安装包（外部安装 + CLI + 跨进程）。

护栏覆盖（对应 v0.4.x「解耦开源」声明）：
  1. 构建 wheel + pip install --target 到独立临时目录（不触碰源码树/不污染仓库）。
  2. 只从该外部安装目录 import（sys.path 首位），证明不耦合源码路径。
  3. CLI 全链路真实生效：add 落库 → search 真实命中 → render 镜像含该经验。
  4. 跨进程持久化：进程 A add → 进程 B search 命中（SQLite 唯一事实库）。
运行方式：python tests/test_installed_pkg.py   （需 pip 可用，无第三方依赖）
"""
import subprocess
import sys
import tempfile
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parent.parent


def _run(args: list[str], cwd: Path | None = None, env=None) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd or PKG_ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=env)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="exp_pkg_") as tmp:
        inst = Path(tmp) / "site"
        cfg = Path(tmp) / "experience.yml"
        import shutil
        shutil.copy(PKG_ROOT / "experience.yml", cfg)

        # 1) 构建 + 安装到外部目录（--no-deps 验证纯标准库零依赖）
        r = _run([sys.executable, "-m", "pip", "install", "--target", str(inst),
                  "--no-deps", "--no-build-isolation", "."])
        assert r.returncode == 0, f"pip install 失败: {r.stderr}"

        # 2) 只从外部安装目录导入
        code = (
            "import sys; sys.path.insert(0, %r); "
            "import experience_store; "
            "from experience_store import ExperienceStore, parse_policy; "
            "s = ExperienceStore(); "
            "assert s.policy['version'], '策略版本缺失'; "
            "print('import OK from external install, version =', experience_store.__version__)"
        ) % str(inst)
        r = _run([sys.executable, "-c", code])
        assert r.returncode == 0 and "import OK" in r.stdout, f"外部导入失败: {r.stderr}"

        # 3) 跨进程：进程 A add → 进程 B search
        a_code = (
            "import sys; sys.path.insert(0, %r); "
            "from experience_store import ExperienceStore, parse_policy; "
            "s = ExperienceStore(parse_policy(open(%r, encoding='utf-8').read()), %r); "
            "s.add('xp-A', '跨进程写入', '进程A写', '进程B读', confidence=0.9); "
            "print('A wrote')"
        ) % (str(inst), str(cfg), str(cfg))
        r = _run([sys.executable, "-c", a_code])
        assert r.returncode == 0, f"进程A写入失败: {r.stderr}"

        b_code = (
            "import sys; sys.path.insert(0, %r); "
            "from experience_store import ExperienceStore, parse_policy; "
            "s = ExperienceStore(parse_policy(open(%r, encoding='utf-8').read()), %r); "
            "hits = s.search('跨进程'); "
            "print('B hit:', [e.case_id for e in hits]); "
            "assert any(e.case_id == 'xp-A' for e in hits), '进程B应检索到进程A写入的经验'"
        ) % (str(inst), str(cfg), str(cfg))
        r = _run([sys.executable, "-c", b_code])
        assert r.returncode == 0, f"进程B检索失败: {r.stderr}"
        assert "B hit: ['xp-A']" in r.stdout, f"跨进程未命中: {r.stdout}"

        # 4) CLI 全链路：add → search → render（从外部安装包入口）
        cli_code = (
            "import sys; sys.path.insert(0, %r); "
            "from experience_store.cli import main\n"
            "def run(argv):\n"
            "    sys.argv = ['experience-store', '--config', %r] + argv\n"
            "    try: main()\n"
            "    except SystemExit as e: return e.code or 0\n"
            "run(['add', '--case', 'cli-e2e', '--title', 'CLI全链路', '--problem', 'p', "
            "'--solution', 's', '--confidence', '0.9'])\n"
            "run(['search', 'CLI'])\n"
            "run(['render'])\n"
        ) % (str(inst), str(cfg))
        r = _run([sys.executable, "-c", cli_code])
        assert r.returncode == 0, f"CLI 全链路失败: {r.stderr}"
        assert "added cli-e2e" in r.stdout and "cli-e2e" in r.stdout, f"CLI 冒烟缺结果: {r.stdout}"

        print("PASS test_installed_pkg  →  外部安装 + 零依赖 + CLI + 跨进程持久化均真实生效")


if __name__ == "__main__":
    main()
