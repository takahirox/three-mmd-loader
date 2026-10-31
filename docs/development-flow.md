# Development Flow

This document defines the default development flow for @takahirox/three-mmd, with particular emphasis on AI-assisted development.

## 1. Start with an Issue

Work should begin with an Issue.

The Issue should clearly state:

- the problem
- the expected outcome
- relevant context

The Issue defines the scope of the work. If the scope is unclear, clarify the Issue before implementation instead of inventing requirements during the change.

By default, completion criteria should be executable and verifiable by an AI agent. Require human checks, such as physical-device testing, subjective evaluation, or external approval, only when there is a necessary reason to do so.

When human work is required, state why it is necessary and what result is expected. Distinguish optional additional validation from mandatory completion criteria.

### Pre-Merge Acceptance and Post-Merge Verification

Mandatory pre-merge acceptance criteria must be achievable and verifiable before merge. Checks possible only after merge must not be prerequisites for pre-merge Pull Request approval.

Record required post-merge verification separately in the Issue, including how to perform each check. This separation preserves all implementation requirements and applicable pre-merge tests; it changes when verification is performed, not what must be delivered.

For example, when deployment is triggered by merge, validate the code and configuration, local builds, and applicable automated tests before merge. After merge, verify successful publication and the newly published site. Report required post-merge checks as pending until performed, then record results and evidence. Do not report pending checks as passed or the overall outcome as verified.

Use the [Issue template](../.github/ISSUE_TEMPLATE/issue.md) to record both stages, and apply the [review guidelines](review-guidelines.md#check-acceptance-and-verification) when assessing acceptance and validation.

Choose applicable validation using the [testing and CI principles](#testing-and-ci-principles).

### Testing and CI Principles

**Detect the required failures at the lightest appropriate layer, without redundant execution.** Preserve required correctness, regressions and meaningful integration coverage when redistributing checks.

1. **Prefer the lightest meaningful test layer.** Use focused Node tests for calculations, branches and broad data combinations. Reserve Chrome/rendering, real Ammo, Worker, real-model and packaged-consumer checks for behavior and boundaries that need them. `npm test` includes integration and package checks; it is not entirely a lightweight unit suite. Add assertions that catch concrete defects rather than mirror implementation.
2. **Choose combinations deliberately.** Cover distinct PMD/PMX, material, physics, renderer and example paths with representative cases. Expand combinations exhaustively where interactions require them, rather than multiplying every model, format, state and backend. Retain required regressions, WebGL2 rendering and the existing capability-gated native WebGPU assertions.
3. **Match validation to the change.** Use the change-specific checks below for fast feedback, then complete applicable full regression validation before merge. Configured required CI and Issue acceptance criteria remain mandatory; this guidance does not change workflow selection or waive gates. Keep optional checks explicit and record genuinely post-merge-only verification separately, following the acceptance guidance above.
4. **Reuse work and eliminate duplicate execution.** Reuse compiled output, generated fixtures and verified asset downloads with keys covering relevant source, lockfile, toolchain and platform inputs, and isolation that prevents stale results or private-asset leakage. npm lifecycle hooks currently rebuild for several commands. Both workflows use push/PR triggers and repeat some checks: future CI work should avoid equivalent execution for the same revision while preserving their distinct fixture/public-asset coverage. Cancel superseded validation when safe; preserve Pages deployment/rollback ordering (currently serialized without cancellation). Measure resource use before increasing parallelism; browser suites currently run with concurrency one.
5. **Review test value and added cost together.** Identify the additional defect a test detects, assurance already supplied by existing coverage, and execution/maintenance cost. Watch repeated Chrome/renderer startup, compiler builds, isolated package installs, large model downloads, long physics loops and Cartesian-product growth. Reduce redundant setup or cases while retaining meaningful assertions and required coverage.
6. **Maintain an execution-time budget.** No measured normal-CI baseline or repository-wide time target is documented yet. During actual test/CI performance work, establish a baseline and target from representative runs, monitor growth and investigate overruns. Track elapsed feedback time, summed runner/computation time and queue time separately. Revisit validation structure and duplication before adding resources or weakening coverage. Existing physics benchmarks and individual historical test timings are not a normal-CI budget; this policy adds no benchmark, hardware or merge gate.

Use these checks according to the affected behavior:

| Change | Relevant validation |
| --- | --- |
| Documentation only | Check Markdown structure, links/anchors, consistency and `git diff --check`; application builds and browser suites are not needed solely for prose. |
| Example UI | Relevant Node checks and Chrome example checks (`npm run test:examples`); validate the built site under the project path when affected. |
| Core/runtime | `npm run typecheck`, `npm test`, and applicable legacy Ammo (`npm run test:legacy`), browser/rendering (`npm run test:browser`), Worker and package regressions. |
| CI/build/release | Validate changed configuration, builds, artifact contents and applicable suites; use packaging/publication dry-runs as described in the [release guide](releases.md#automated-checks-before-merge). |

The [Tests workflow](../.github/workflows/tests.yml) runs regression checks, generated-fixture site validation and npm dry-runs. The [Pages workflow](../.github/workflows/examples-pages.yml) builds and tests the public-asset site before deployment, including on PRs to `main`. These local/build checks are pre-merge work; public-site verification after a merge-triggered deployment is post-merge work. See the [examples guide](../examples/README.md#deployment) for reproduction and ordering. Optional private-model inspection and human visual/listening checks remain optional unless the Issue justifies requiring them.

## 2. Create a Pull Request for the Issue

Implementation should be proposed through a Pull Request associated with the Issue.

The Pull Request should explain:

- what changed
- what outcome the change produces
- how the change was validated
- which required post-merge checks remain pending and how to perform them
- which Issue it addresses

A Pull Request should only claim to close an Issue when it implements all requirements and satisfies all pre-merge acceptance criteria. A closing reference does not establish that required post-merge verification has passed; report it separately as pending until performed.

If the Pull Request intentionally implements only part of the Issue, it should state that clearly and should not present the Issue as fully resolved.

## 3. Review Before Merge

Every Pull Request should be reviewed before merge.

A central review question is:

> Does this Pull Request address the Issue completely, without adding changes that are not justified by the Issue?

Review must check both directions:

- **No missing scope:** the Pull Request should not leave required parts of the Issue unresolved while claiming completion.
- **No unnecessary scope:** the Pull Request should not introduce unrelated abstractions, frameworks, policies, or complexity beyond what is needed to solve the Issue.

This is especially important for AI-generated changes. AI agents may produce broader or more elaborate designs than the task requires. Prefer the smallest change that fully satisfies the Issue.

## 4. Revise Until Review Passes

If review finds missing requirements, unnecessary scope, correctness problems, or insufficient validation, update the Pull Request and review it again.

The Pull Request should be merged only when the reviewed change is an appropriate and complete response to the Issue.

## 5. Merge

After review passes, merge the Pull Request.

## 6. Perform Required Post-Merge Verification

Perform the separately recorded post-merge checks and update their status with results and evidence. Until they are performed, keep them pending. If a check fails, report the failure and follow up; do not claim the expected outcome is fully verified until all required checks pass.

The normal flow is therefore:

```text
Issue
  ↓
Implementation
  ↓
Pull Request
  ↓
Review
  ↓
Revision if needed
  ↓
Merge
  ↓
Required post-merge verification
```
