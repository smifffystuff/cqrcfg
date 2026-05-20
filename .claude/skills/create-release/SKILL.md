---
name: create-release
description: Bump the patch version in package.json, commit, push, tag, and push the tag. Use when the user wants to create a release or push a new version.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(node *) Read Edit
---

Create a release by bumping the patch version, committing, pushing, and tagging.

## Steps

1. Read `package.json` in the repository root and extract the current `version` field.
2. Increment the patch level (e.g., `1.0.0` -> `1.0.1`, `2.3.11` -> `2.3.12`).
3. Update the `version` field in `package.json` with the new version.
4. Stage `package.json` and commit with message: `Release v<new-version>`
5. Push the current branch to origin.
6. Create an annotated git tag `v<new-version>` with message `Release v<new-version>`.
7. Push the tag to origin.
8. Report the new version to the user.

## Important

- Do NOT use `npm version` as it may have side effects or hooks configured.
- Use `git switch` for any branch operations (not `git checkout`).
- Do not include Co-Authored-By lines or model identifiers in the commit message.
- If there are uncommitted changes beyond package.json, warn the user and stop.
