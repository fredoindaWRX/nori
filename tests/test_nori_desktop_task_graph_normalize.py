"""Regression: analyze_csv graph steps verify by tool evidence, not changed bytes.

Reproduces the live task f073b64be48040f8888f805b76fa5064 deadlock where a
planner labeled an analysis step verify='artifact' and the loop could never
produce changed bytes, exhausting recovery segments.
"""

import pytest

from nori import desktop_task_graph as dtg


def _tasks(analyze_task, analyze_verify):
    return [
        {
            "id": "1",
            "worker": "neo",
            "model_tier": "coder_14b",
            "task": "write_file path data/nori/e2e-measurements.csv with contents: value 10 20 30",
            "depends_on": [],
            "verify": "artifact",
        },
        {
            "id": "2",
            "worker": "neo",
            "model_tier": "coder_14b",
            "task": analyze_task,
            "depends_on": ["1"],
            "verify": analyze_verify,
        },
    ]


def test_analyze_step_labeled_artifact_is_normalized_to_tool_evidence():
    nodes = dtg.validate(_tasks("analyze_csv on data/nori/e2e-measurements.csv", "artifact"))
    node = nodes[1]
    assert node["verify"] == "tool"
    assert node["required_operation"] == "analyze_csv"


def test_analyze_step_labeled_execution_is_normalized_to_tool_evidence():
    nodes = dtg.validate(_tasks("Run analyze_csv on data/nori/e2e-measurements.csv", "execution"))
    node = nodes[1]
    assert node["verify"] == "tool"
    assert node["required_operation"] == "analyze_csv"


def test_mixed_write_then_analyze_step_keeps_artifact_verification():
    mixed = "write_file data/report.csv with rows, then analyze_csv data/report.csv"
    nodes = dtg.validate(_tasks(mixed, "artifact"))
    assert nodes[1]["verify"] == "artifact"
    assert "required_operation" not in nodes[1]


def test_verify_node_accepts_post_start_analyze_tool_evidence():
    nodes = dtg.validate(_tasks("analyze_csv on data/nori/e2e-measurements.csv", "artifact"))
    node = nodes[1]
    node["evidence_start"] = {"tools": 0, "executions": 0, "artifacts": {}}
    bare_state = {
        "executed_tools": [
            {"knight": "neo", "operation": "analyze_csv",
             "path": "data/nori/e2e-measurements.csv", "source_sha256": "ab"}
        ],
        "executions": [],
        "artifacts": [],
    }
    dtg.verify_node(node, bare_state)  # must not raise

    node["evidence_start"] = {"tools": 1, "executions": 0, "artifacts": {}}
    with pytest.raises(ValueError, match="successful tool evidence"):
        dtg.verify_node(node, bare_state)
