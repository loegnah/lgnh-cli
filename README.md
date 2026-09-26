# lgnh

Git diff-based commit messages via OMP.

## Installation

```bash
# Install dependencies
bun install

# Link globally for terminal use
ln -s $(pwd)/bin/lgnh-cli.ts ~/.local/bin/lgnh
# or
ln -s $(pwd)/bin/lgnh-cli.ts /usr/local/bin/lgnh
```

## Usage

```bash
# Config & model
lgnh config          # view config path and current model
lgnh model           # view current model
lgnh model <id>      # change model (default: @commit)
# Run in any git repository
lgnh commit             # verify project (lint/typecheck), generate message, commit
lgnh commit-fast        # skip verification, generate message, commit
lgnh commit-push        # verify project, generate message, commit, and push
lgnh commit-fast-push   # skip verification, commit, and push
lgnh commit -e          # edit generated message before committing
```
