---
name: Issue
about: Report a problem or propose a change
title: ""
labels: ""
assignees: ""
---

## Problem

Describe the problem.

## Expected outcome

Describe what should be true when the issue is resolved.

Default to completion criteria an AI agent can execute and verify. Require human checks only when necessary; explain why and the expected result, and distinguish optional validation from mandatory criteria. See the [development guidance](https://github.com/takahirox/three-mmd-loader/blob/main/docs/development-flow.md#1-start-with-an-issue).

### Pre-merge acceptance criteria

List mandatory acceptance criteria that can be achieved and verified before merge. Checks possible only after merge must not be prerequisites for pre-merge PR approval.

For a merge-triggered deployment, require validation of the code and configuration, local builds, and applicable automated tests before merge.

### Required post-merge verification

Record required checks possible only after merge separately, including how to verify them. For a merge-triggered deployment, verify successful publication and the newly published site after merge. Report these checks as pending until performed, then record the results and evidence. If none are required, state that explicitly.

This separation preserves all implementation requirements and applicable pre-merge tests. Report validation accurately; pending checks are not passing checks. See the [review guidelines](https://github.com/takahirox/three-mmd-loader/blob/main/docs/review-guidelines.md#check-acceptance-and-verification).

## Context

Add any relevant context, examples, logs, or related issues.
