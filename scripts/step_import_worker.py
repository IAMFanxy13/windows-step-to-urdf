"""Run one isolated STEP-to-XCAF import job."""

from __future__ import annotations

import argparse
import json
import traceback
from pathlib import Path

from occt_step import StepImportError, import_step
from candidate_engine import write_candidates


def write_status(job: Path, value: dict) -> None:
    target = job / "status.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", "utf-8")
    temporary.replace(target)


def run(job: Path) -> None:
    source = job / "source.step"
    output = job / "analysis"
    messages = {
        "read_step": "正在读取 STEP/AP242 文件",
        "transfer_xcaf": "正在恢复 XCAF 装配定义与实例",
        "build_definitions": "正在生成精确零件特征与预览网格",
        "contact_graph": "正在建立零件接触图",
        "write_artifacts": "正在保存分析结果",
    }

    def report(phase: str) -> None:
        write_status(job, {
            "state": "analyzing", "kind": "step-import", "phase": phase,
            "message": messages.get(phase, "正在用 OCCT/XCAF 解析 STEP"),
        })

    report("read_step")
    assembly = import_step(source, output, progress=report)
    write_status(job, {
        "state": "analyzing", "kind": "step-import", "phase": "candidate_generation",
        "message": "正在生成舵机、刚性组和关节候选",
    })
    candidates = write_candidates(output / "assembly.json", output / "brep_features.json", output / "joint_candidates.json")
    write_status(job, {
        "state": "ready", "kind": "step-import", "message": "STEP 精确 B-Rep 解析完成",
        "definitionCount": len(assembly["definitions"]),
        "occurrenceCount": len(assembly["occurrences"]),
        "diagnostics": assembly["diagnostics"],
        "jointCandidateCount": len(candidates["jointCandidates"]),
        "artifacts": {"assembly": "analysis/assembly.json", "features": "analysis/brep_features.json", "contactGraph": "analysis/contact_graph.json", "candidates": "analysis/joint_candidates.json"},
    })


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    job = args.job_dir.resolve()
    try:
        run(job)
        return 0
    except (StepImportError, OSError, ValueError) as error:
        write_status(job, {"state": "failed", "kind": "step-import", "message": str(error)})
        return 2
    except Exception as error:  # Keep a local traceback, but do not expose it through the API.
        (job / "worker-error.log").write_text(traceback.format_exc(), "utf-8")
        write_status(job, {"state": "failed", "kind": "step-import", "message": f"Unexpected STEP importer error: {type(error).__name__}"})
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
