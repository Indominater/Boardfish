# Feedback and Reports

Thanks for helping improve Boardfish. Bug reports and workflow feedback are
welcome.

Boardfish is source-available, not open-source. External code contributions and
pull requests are not being accepted right now.

The source code is available for personal, educational, research, evaluation,
and other non-commercial uses under the Boardfish Source-Available License.
Commercial use, redistribution, and business or studio use require permission.
See [LICENSE](LICENSE) for the full terms.

## Reporting Bugs

Use the bug report issue template and include:

- Boardfish version
- Operating system and version
- Installer used, such as `.dmg`, `.exe`, `.msi`, or source build
- Steps to reproduce
- Screenshot, screen recording, or a small `.bf` file when useful

## Sharing Feedback

Use the feedback issue template for workflow notes, rough edges, and feature
ideas. The most useful feedback explains what you were trying to do, what tool
you use today, and what would make Boardfish worth keeping in your workflow.

## Pull Requests

External pull requests are not being accepted right now. Please open an issue
instead if you found a bug, have feedback, or want to suggest a feature.

If this changes later, contribution guidelines will be updated here.

## Local Evaluation

If you want to inspect or run Boardfish locally for personal evaluation,
prerequisites are:

- Node.js 18+
- Rust

Run the app locally:

```bash
npm install
npm run tauri dev
```

Build a release installer:

```bash
npm run tauri build
```
