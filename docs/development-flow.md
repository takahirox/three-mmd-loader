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
