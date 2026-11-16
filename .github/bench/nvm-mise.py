"""Isolated GitHub Actions setup benchmark; no repository dependencies."""
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import statistics
import subprocess
import sys
import time

ROOT = Path(os.environ["BENCH_ROOT"])
DATA = ROOT / "data"
PROJECT = ROOT / "project"
NODE_VERSION = "24.13.0"
MISE_VERSION = "2026.11.9"
TOOL = os.environ["BENCH_TOOL"]
RESULT = ROOT / "results.json"
PROBE = 'console.log(JSON.stringify({version:process.version,path:process.execPath}))'


def env():
    return {
        "HOME": str(DATA / "home"),
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "CI": "true",
        "PROFILE": "/dev/null",
        "NVM_DIR": str(DATA / "nvm"),
        "MISE_DATA_DIR": str(DATA / "mise"),
        "MISE_CACHE_DIR": str(DATA / "cache"),
        "MISE_STATE_DIR": str(DATA / "state"),
        "MISE_CONFIG_DIR": str(DATA / "config"),
        "XDG_CONFIG_HOME": str(DATA / "config"),
        "XDG_DATA_HOME": str(DATA / "xdg-data"),
        "XDG_CACHE_HOME": str(DATA / "xdg-cache"),
        "MISE_YES": "1",
        "NO_COLOR": "1",
    }


def run(args, custom_env=None):
    result = subprocess.run(
        args, cwd=PROJECT, env=custom_env or env(),
        capture_output=True, text=True, timeout=180,
    )
    if result.returncode:
        raise RuntimeError(f"{args}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def bash(text, custom_env=None):
    return run(["/bin/bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", text], custom_env)


def download(url, target, sha256):
    run(["curl", "--fail", "--location", "--silent", "--show-error", url, "-o", str(target)])
    assert hashlib.sha256(target.read_bytes()).hexdigest() == sha256


def bootstrap():
    if TOOL == "nvm":
        script = DATA / "nvm-install.sh"
        download(
            "https://raw.githubusercontent.com/nvm-sh/nvm/v0.41.0/install.sh",
            script, "045932fe05f0d4247c946f2ec0ec4026dbfd8ce88a5f67ea28d8ea833227f48b",
        )
        run(["/bin/bash", str(script)])
    else:
        arch = {"x86_64": "x64", "aarch64": "arm64"}[platform.machine()]
        hashes = {
            "x64": "23ba592fcbc61f057e2b82c1eafd085832712ba0c759b714ca16cd06babca378",
            "arm64": "cf2900bfb4279f8d8f8a19d5c27bf1bde826b3e742182f3f67511c588498c786",
        }
        archive = DATA / "mise.tar.gz"
        download(
            f"https://github.com/jdx/mise/releases/download/v{MISE_VERSION}/mise-v{MISE_VERSION}-linux-{arch}.tar.gz",
            archive, hashes[arch],
        )
        run(["tar", "-xzf", str(archive), "-C", str(DATA)])


def mise():
    return str(DATA / "mise/bin/mise")


def install():
    if TOOL == "nvm":
        value = bash(f'. "{DATA}/nvm/nvm.sh" --no-use; nvm install {NODE_VERSION} >&2; printf "%s" "$PATH"')
    else:
        run([mise(), "install"])
        value = json.loads(run([mise(), "env", "--json"]))["PATH"]
    return dict(env(), PATH=value)


def probe(custom_env):
    data = json.loads(run(["node", "-e", PROBE], custom_env))
    assert data["version"] == "v" + NODE_VERSION, data
    assert data["path"].startswith(str(DATA) + "/"), data
    return {
        **data,
        "sha256": hashlib.sha256(Path(data["path"]).read_bytes()).hexdigest(),
    }


def workload(custom_env):
    start = time.perf_counter()
    run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], custom_env)
    run(["npm", "test"], custom_env)
    return time.perf_counter() - start


def persist(data):
    RESULT.write_text(json.dumps(data, indent=2) + "\n")
    print(json.dumps(data, indent=2), flush=True)


mode = sys.argv[1]
if mode == "prepare":
    assert not ROOT.exists(), "Refuse to reuse a previous benchmark directory"
    PROJECT.mkdir(parents=True)
    (DATA / "home").mkdir(parents=True)
    (PROJECT / "mise.toml").write_text(f'[tools]\nnode = "{NODE_VERSION}"\n')
    (PROJECT / ".nvmrc").write_text(NODE_VERSION + "\n")
    (PROJECT / "package.json").write_text(json.dumps({
        "name": "ci-setup-benchmark", "version": "1.0.0", "private": True,
        "scripts": {"test": "node --test test.cjs"},
    }))
    (PROJECT / "package-lock.json").write_text(json.dumps({
        "name": "ci-setup-benchmark", "version": "1.0.0", "lockfileVersion": 3,
        "requires": True, "packages": {"": {"name": "ci-setup-benchmark", "version": "1.0.0"}},
    }))
    (PROJECT / "test.cjs").write_text(
        "const test = require('node:test'); const assert = require('node:assert/strict');\n"
        "test('identical workload', () => { for (let i=0;i<100000;i++) assert.equal(i+i,2*i); });\n"
    )
    persist({
        "runner": os.environ["BENCH_RUNNER"], "arch": platform.machine(),
        "trial": int(os.environ["BENCH_TRIAL"]), "tool": TOOL,
        "node": NODE_VERSION, "nvm": "0.41.0", "mise": MISE_VERSION,
        "image_version": os.environ.get("ImageVersion"),
        "cpu": Path("/proc/cpuinfo").read_text().splitlines()[:25],
    })
elif mode == "cold":
    results = json.loads(RESULT.read_text())
    start = time.perf_counter()
    bootstrap()
    results["manager_bootstrap_seconds"] = time.perf_counter() - start
    install_start = time.perf_counter()
    active = install()
    details = probe(active)
    results["node_install_select_probe_seconds"] = time.perf_counter() - install_start
    results["cold_setup_seconds"] = time.perf_counter() - start
    results["cold_node"] = details
    results["cold_workload_seconds"] = workload(active)
    persist(results)
elif mode == "rotate":
    DATA.rename(ROOT / "original-data")
    results = json.loads(RESULT.read_text())
    results["restore_start_ns"] = time.time_ns()
    persist(results)
elif mode == "warm":
    assert os.environ["CACHE_HIT"] == "true", "Warm comparison requires an exact cache hit"
    results = json.loads(RESULT.read_text())
    warm_start = time.perf_counter()
    results["cache_restore_and_step_transition_seconds"] = (
        time.time_ns() - results.pop("restore_start_ns")
    ) / 1e9
    active = install()
    details = probe(active)
    assert details == results["cold_node"], (details, results["cold_node"])
    results["warm_install_select_probe_seconds"] = time.perf_counter() - warm_start
    results["warm_setup_including_restore_seconds"] = (
        results["cache_restore_and_step_transition_seconds"]
        + results["warm_install_select_probe_seconds"]
    )
    results["warm_workload_seconds"] = workload(active)
    samples = {"per_step_selection": [], "exported_path": []}
    cases = list(samples) * 30
    random.Random(20261116).shuffle(cases)
    for case in cases:
        start = time.perf_counter()
        if case == "exported_path":
            details = json.loads(run(["node", "-e", PROBE], active))
            assert details["version"] == "v" + NODE_VERSION
            assert details["path"].startswith(str(DATA) + "/")
        else:
            if TOOL == "nvm":
                output = bash(f'. "{DATA}/nvm/nvm.sh" --no-use; nvm use --silent {NODE_VERSION}; node -e \'{PROBE}\'')
            else:
                output = run([mise(), "exec", "--", "node", "-e", PROBE])
            details = json.loads(output.strip().splitlines()[-1])
            assert details["version"] == "v" + NODE_VERSION
            assert details["path"].startswith(str(DATA) + "/")
        samples[case].append(time.perf_counter() - start)
    results["launch_samples_seconds"] = samples
    results["launch_medians_seconds"] = {k: statistics.median(v) for k, v in samples.items()}
    persist(results)
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
        summary.write("```json\n" + json.dumps(results, indent=2) + "\n```\n")
else:
    raise RuntimeError("Unknown mode: " + mode)
