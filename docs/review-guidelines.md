# Review Guidelines

The purpose of review is not only to check whether a change works. It is also to verify that the change is the right response to the Issue that motivated it.

These guidelines are particularly important when reviewing AI-generated changes.

## Review Against the Issue

Start by reading the source Issue.

Treat the Issue as the reference for the intended problem and expected outcome.

Ask:

> Is the Pull Request a complete and appropriately scoped solution to this Issue?

## Check for Missing Work

Verify that the Pull Request addresses all parts of the Issue that it claims to resolve.

Do not approve a Pull Request as closing an Issue when important requirements remain unimplemented.

If the change is intentionally partial, the Pull Request should say so and the Issue should remain open.

## Check Acceptance and Verification

Mandatory pre-merge acceptance criteria must be achievable and verifiable before merge. Confirm that the implementation meets all requirements and that applicable pre-merge tests and checks pass.

Checks possible only after merge must not be prerequisites for pre-merge Pull Request approval. Require these checks to be recorded separately, with instructions for verification, and reported as pending until performed. Pending post-merge verification does not excuse missing implementation or insufficient pre-merge validation, and must not be reported as passed or as proof that the overall outcome is verified.

For a merge-triggered deployment, review the code and configuration, local build results, and applicable automated test results before merge. Verify successful publication and the newly published site after merge, then record the results and evidence.

Follow the [development flow](development-flow.md#pre-merge-acceptance-and-post-merge-verification) and the [Issue template](../.github/ISSUE_TEMPLATE/issue.md) to keep the two stages explicit.

## Check for Unnecessary Work

Verify that the Pull Request does not go beyond what the Issue requires without a clear reason.

Watch for:

- unnecessary abstractions
- speculative extensibility
- unrelated refactoring
- new frameworks or subsystems that are not required
- additional policies or configuration with no demonstrated need

AI agents can over-engineer solutions. Do not treat additional complexity as automatically beneficial.

Prefer the smallest design that completely solves the stated problem.

## Check the Result

Also verify the ordinary quality of the change:

- behavior matches the expected outcome
- implementation is coherent with the existing architecture
- validation is sufficient for the change
- documentation is updated when the change affects documented behavior

## Review Outcome

A Pull Request is ready to merge when:

- it implements all requirements of the Issue it claims to resolve and satisfies all pre-merge acceptance criteria
- it does not introduce unjustified scope or complexity
- the implementation is correct and appropriately validated
- required post-merge verification is recorded separately and accurately reported as pending until performed

If any of these conditions are not met, request changes and review again after revision.
