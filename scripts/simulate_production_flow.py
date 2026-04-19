#!/usr/bin/env python3

import argparse
import json
import math
import sys
from pathlib import Path

from _manufacturing_demo import ensure_dir, load_json, validate_context


DISCLAIMER = (
    "DELMIA-adjacent learning demo only. This is not an official DELMIA or "
    "3DEXPERIENCE integration and not a verified factory simulation."
)


def build_indexes(context):
    centers = {item["work_center_id"]: item for item in context.get("work_centers", [])}
    issues_by_operation = {}
    for issue in context.get("quality_issues", []):
        issues_by_operation.setdefault(issue.get("operation_id"), []).append(issue)
    return centers, issues_by_operation


def compute_center_loads(context):
    centers, issues_by_operation = build_indexes(context)
    routing = sorted(context.get("routing", []), key=lambda item: item.get("sequence", 0))
    order_qty = (
        ((context.get("production_line") or {}).get("active_order") or {}).get("quantity")
        or 1
    )

    operation_rows = []
    center_totals = {}
    total_touch_sec = 0.0

    for operation in routing:
        center = centers[operation["work_center_id"]]
        base_cycle = float(operation.get("machine_cycle_sec", 0)) + float(operation.get("labor_cycle_sec", 0))
        setup_share = (float(center.get("setup_time_min", 0)) * 60.0) / max(order_qty, 1)
        quality_penalty = 8.0 * len(issues_by_operation.get(operation["operation_id"], []))
        practical_cycle = (base_cycle + setup_share + quality_penalty) / max(float(center.get("parallel_units", 1)), 1.0)
        practical_cycle = practical_cycle / max(float(center.get("expected_oee", 0.85)), 0.5)

        operation_rows.append({
            "operation_id": operation["operation_id"],
            "sequence": operation["sequence"],
            "operation_name": operation["operation_name"],
            "work_center_id": center["work_center_id"],
            "work_center_name": center["name"],
            "base_cycle_sec": round(base_cycle, 2),
            "setup_share_sec": round(setup_share, 2),
            "quality_penalty_sec": round(quality_penalty, 2),
            "practical_cycle_sec": round(practical_cycle, 2)
        })
        total_touch_sec += practical_cycle
        bucket = center_totals.setdefault(center["work_center_id"], {
            "work_center_id": center["work_center_id"],
            "work_center_name": center["name"],
            "process_type": center["process_type"],
            "parallel_units": center["parallel_units"],
            "queue_buffer_units": center["queue_buffer_units"],
            "expected_oee": center["expected_oee"],
            "utilization_target": center["utilization_target"],
            "operation_ids": [],
            "practical_cycle_sec": 0.0,
            "quality_issue_count": 0
        })
        bucket["operation_ids"].append(operation["operation_id"])
        bucket["practical_cycle_sec"] += practical_cycle
        bucket["quality_issue_count"] += len(issues_by_operation.get(operation["operation_id"], []))

    center_rows = list(center_totals.values())
    bottleneck = max(center_rows, key=lambda item: item["practical_cycle_sec"])
    bottleneck_cycle = bottleneck["practical_cycle_sec"]

    utilization_rows = []
    wip_units = 0
    for center in sorted(center_rows, key=lambda item: item["work_center_id"]):
        utilization = min(center["practical_cycle_sec"] / bottleneck_cycle, 0.99)
        queue_units = int(center.get("queue_buffer_units", 0))
        center_wip = min(queue_units, max(1 if queue_units else 0, math.ceil(queue_units * utilization)))
        wip_units += center_wip
        utilization_rows.append({
            "work_center_id": center["work_center_id"],
            "work_center_name": center["work_center_name"],
            "utilization_ratio": round(utilization, 3),
            "estimated_queue_units": center_wip,
            "practical_cycle_sec": round(center["practical_cycle_sec"], 2),
            "quality_issue_count": center["quality_issue_count"]
        })

    throughput_units_per_hour = round(3600.0 / bottleneck_cycle, 2)
    shift_hours = float((context.get("production_line") or {}).get("hours_per_shift", 8))
    wait_time_sec = max((wip_units / max(throughput_units_per_hour, 0.1)) * 3600.0 - total_touch_sec, 0.0)
    lead_time_sec = total_touch_sec + wait_time_sec

    return {
        "operation_rows": operation_rows,
        "utilization_rows": utilization_rows,
        "bottleneck": bottleneck,
        "throughput_units_per_hour": throughput_units_per_hour,
        "throughput_units_per_shift": round(throughput_units_per_hour * shift_hours, 1),
        "wip_units": int(wip_units),
        "total_touch_sec": round(total_touch_sec, 2),
        "wait_time_sec": round(wait_time_sec, 2),
        "lead_time_sec": round(lead_time_sec, 2)
    }


def build_actions(metrics):
    actions = [{
        "priority": "high",
        "work_center_id": metrics["bottleneck"]["work_center_id"],
        "action": f"Protect and elevate {metrics['bottleneck']['work_center_name']} capacity.",
        "rationale": "This work center has the highest practical cycle time and is the current deterministic bottleneck.",
        "expected_effect": "Improves line throughput and reduces queue growth ahead of the bottleneck."
    }]

    for row in metrics["utilization_rows"]:
        if row["utilization_ratio"] >= 0.9 and row["work_center_id"] != metrics["bottleneck"]["work_center_id"]:
            actions.append({
                "priority": "medium",
                "work_center_id": row["work_center_id"],
                "action": "Add overflow plan or parallel labor coverage.",
                "rationale": "High utilization suggests this station can become the next constraint after bottleneck relief.",
                "expected_effect": "Prevents constraint migration during rate increases."
            })
        if row["quality_issue_count"] > 0:
            actions.append({
                "priority": "medium",
                "work_center_id": row["work_center_id"],
                "action": "Link in-station quality check to the routing step.",
                "rationale": "Open quality issues are already concentrated at this station in the sample context.",
                "expected_effect": "Shortens feedback loops and reduces rework carryover."
            })

    deduped = []
    seen = set()
    for action in actions:
        key = (action["work_center_id"], action["action"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(action)
    return deduped


def build_report(context):
    metrics = compute_center_loads(context)
    planning_data = context.get("planning_data", {})
    return {
        "report_type": "delmia_style_flow_simulation_demo",
        "disclaimer": DISCLAIMER,
        "prototype_positioning": "Deterministic DELMIA-style learning demo for digital manufacturing and production flow optimization.",
        "input_context": {
            "part_id": ((context.get("product") or {}).get("part_id")),
            "line_id": ((context.get("production_line") or {}).get("line_id")),
            "schedule_snapshot_date": planning_data.get("schedule_snapshot_date")
        },
        "analysis_basis": {
            "heuristic_rules": [
                "Practical cycle = machine + labor + order-level setup share + quality penalty, adjusted by expected OEE.",
                "Throughput is based on the slowest work center practical cycle.",
                "WIP is approximated from queue buffers and work-center utilization ratios."
            ],
            "not_official_integration": True
        },
        "throughput": {
            "units_per_hour": metrics["throughput_units_per_hour"],
            "units_per_shift": metrics["throughput_units_per_shift"]
        },
        "bottleneck_work_center": {
            "work_center_id": metrics["bottleneck"]["work_center_id"],
            "name": metrics["bottleneck"]["work_center_name"],
            "process_type": metrics["bottleneck"]["process_type"],
            "practical_cycle_sec": round(metrics["bottleneck"]["practical_cycle_sec"], 2),
            "operation_ids": metrics["bottleneck"]["operation_ids"]
        },
        "wip_estimate": {
            "units": metrics["wip_units"],
            "basis": "Queue-buffer-weighted approximation using utilization ratios."
        },
        "utilization_by_work_center": metrics["utilization_rows"],
        "cycle_time_summary": {
            "total_touch_time_sec": metrics["total_touch_sec"],
            "estimated_wait_time_sec": metrics["wait_time_sec"],
            "estimated_lead_time_sec": metrics["lead_time_sec"]
        },
        "operation_metrics": metrics["operation_rows"],
        "recommended_improvement_actions": build_actions(metrics)
    }


def write_summary(report, output_path):
    lines = [
        "# Production Flow Simulation Summary",
        "",
        f"- Disclaimer: {report['disclaimer']}",
        f"- Part: `{report['input_context']['part_id']}`",
        f"- Line: `{report['input_context']['line_id']}`",
        f"- Schedule snapshot: `{report['input_context']['schedule_snapshot_date']}`",
        "",
        "## Key Outcomes",
        "",
        f"- Throughput: `{report['throughput']['units_per_hour']}` units/hour",
        f"- Throughput per shift: `{report['throughput']['units_per_shift']}` units/shift",
        f"- Bottleneck work center: `{report['bottleneck_work_center']['work_center_id']}` ({report['bottleneck_work_center']['name']})",
        f"- Estimated WIP: `{report['wip_estimate']['units']}` units",
        f"- Estimated lead time: `{report['cycle_time_summary']['estimated_lead_time_sec']}` seconds",
        "",
        "## Utilization Snapshot",
        "",
        "| Work Center | Utilization | Queue Units |",
        "| --- | --- | --- |"
    ]
    for row in report["utilization_by_work_center"]:
        lines.append(f"| `{row['work_center_id']}` {row['work_center_name']} | {row['utilization_ratio']} | {row['estimated_queue_units']} |")
    lines.extend([
        "",
        "## Recommended Actions",
        ""
    ])
    for action in report["recommended_improvement_actions"]:
        lines.append(f"- `{action['priority']}`: {action['action']} ({action['work_center_id']})")
        lines.append(f"  Rationale: {action['rationale']}")
    Path(output_path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Run a deterministic production flow simulation demo.")
    parser.add_argument("--context", default="configs/examples/manufacturing/bracket_line_context.json")
    parser.add_argument("--out-dir", default="output/delmia-demo")
    args = parser.parse_args()

    try:
        context = validate_context(load_json(args.context))
        report = build_report(context)
        out_dir = ensure_dir(args.out_dir)
        report_path = out_dir / "flow_simulation_report.json"
        summary_path = out_dir / "flow_simulation_summary.md"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        write_summary(report, summary_path)

        print(json.dumps({
            "success": True,
            "report_path": str(report_path),
            "summary_path": str(summary_path),
            "throughput_units_per_hour": report["throughput"]["units_per_hour"],
            "bottleneck_work_center": report["bottleneck_work_center"]["work_center_id"]
        }))
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
