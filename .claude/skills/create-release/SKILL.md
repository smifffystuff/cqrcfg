---
name: create-release
description: Increment the build number in package.json (e.g., 1.0.7-build.1 -> 1.0.7-build.2), commit, push, tag, and push the tag. Use when the user wants to create a release or push a new version.
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(node *) Read Edit
---

Create a release by incrementing the build number, updating RELEASES.md, committing, pushing, and tagging.

## Steps

1. Read `package.json` in the repository root and extract the current `version` field.
2. Determine the new version:
   - If the version already has a `-build.N` suffix (e.g., `1.0.7-build.3`), increment N (e.g., `1.0.7-build.4`).
   - If the version has no build suffix (e.g., `1.0.7`), append `-build.1` (e.g., `1.0.7-build.1`).
3. Find the previous release tag by looking for the most recent tag matching `v*`.
4. Generate a changelog summary by running `git log <previous-tag>..HEAD --oneline` to get all commits since the last release. Summarize these into a concise bullet-point list of changes (group related commits, omit release-only commits like "Release vX.Y.Z").
5. Update or create `RELEASES.md` in the repository root:
   - If the file does not exist, create it with a `# Releases` heading.
   - Prepend a new section (below the heading, above previous entries) with the format:
     ```
     ## v<new-version> — <YYYY-MM-DD>

     - bullet point summary of changes
     - another change
     ```
6. Update the `version` field in `package.json` with the new version.
7. Stage `package.json` and `RELEASES.md`, then commit with message: `Release v<new-version>`
8. Push the current branch to origin.
9. Create an annotated git tag `v<new-version>` with message `Release v<new-version>`.
10. Push the tag to origin.
11. Report the new version to the user.

## Important

- Do NOT use `npm version` as it may have side effects or hooks configured.
- Do NOT change the major, minor, or patch numbers — only the build suffix.
- Use `git switch` for any branch operations (not `git checkout`).
- Do not include Co-Authored-By lines or model identifiers in the commit message.
- If there are uncommitted changes beyond package.json and RELEASES.md, warn the user and stop.
- The changelog summary should be human-readable and concise — not a raw git log dump.
