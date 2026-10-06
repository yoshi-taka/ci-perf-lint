# cuda-torch-install-on-cpu-runner

Flags standard Ubuntu x64 GitHub-hosted jobs that install PyTorch directly without a CPU-only index, pulling the CUDA build and its NVIDIA dependencies onto a runner that has no GPU.

## Why it matters

The default PyPI PyTorch build for Linux x64 bundles CUDA. For torch 2.5.1 on CPython 3.11 Linux x64, the wheel is about 900 MB and pulls roughly a dozen `nvidia-*` packages, for a total of roughly 2.8 GB before extraction overhead (triton and other optional paths add more). A standard Ubuntu x64 runner has no GPU, so none of that CUDA code can run, yet the download, disk usage, and install time are paid on every job run and inflate any pip cache or container image built from it.

The CPU-only build is a small fraction of that size and installs no NVIDIA dependencies.

## What it flags

This rule only fires when all of the following are true:

- the job runs on a standard Ubuntu x64 label (`ubuntu-latest`, `ubuntu-20.04`, `ubuntu-22.04`, `ubuntu-24.04`, and later)
- when `runs-on` references a matrix axis, that axis has a static list and every resolved value is a standard Ubuntu x64 label
- the job is not configured with a job container
- a step directly installs `torch`, `torchvision`, or `torchaudio` with `pip install`, `uv pip install`, `uv add`, or `poetry add`

It does not fire when:

- the job already selects a CPU build (`--index-url .../whl/cpu`, `--find-links .../cpu`, a `+cpu` version, `--torch-backend=cpu|auto`, or `UV_TORCH_BACKEND=cpu|auto`)
- CUDA build intent is visible in the workflow, such as `TORCH_CUDA_ARCH_LIST`, `CUDA_HOME`, `CUDA_PATH`, `CUDA_COMPUTE_CAP`, `LIBTORCH_USE_PYTORCH`, `nvcc`, a `cuda-toolkit` action, or a `whl/cu` index
- the runner is not a standard Ubuntu x64 label, for example a GPU-labeled or self-hosted runner, Windows, macOS, or arm64
- torch is only installed indirectly, for example through `pip install -r requirements.txt` or `pip install .`

`torch.cuda.is_available()` and step names mentioning CUDA are intentionally not treated as CUDA build intent, because CPU jobs often gate GPU-specific tests that way.

A `--extra-index-url .../whl/cpu` is intentionally not treated as CPU intent. pip does not rank indexes, so it does not guarantee the CPU build is selected.

CPU index/backend environment settings are read from the effective workflow, job, and step environment, including step-level `UV_TORCH_BACKEND` and `PIP_INDEX_URL`. A setting on another step does not apply to this install.

## Suggested action

Install the CPU-only PyTorch build on CPU runners, for example with `--index-url https://download.pytorch.org/whl/cpu` or a matching CPU index or find-links for the pinned version. A `+cpu` version pin alone is not enough without the CPU index or find-links.

## Verification

Compare dependency install time and cache or container image size before and after switching to the CPU-only build on CPU runners.

## Notes

TensorFlow is out of scope. The official guidance installs `tensorflow` for CPU and `tensorflow[and-cuda]` for GPU, so the PyTorch CUDA-bundle heuristic does not transfer. A separate `tensorflow-cpu` sizing rule would be a different change.
