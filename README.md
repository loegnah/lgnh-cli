# lgnh

Git diff-based commit messages via OpenRouter.

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
# Configure API Key
lgnh config set-key <openrouter-api-key>

# Run in any git repository
lgnh commit         # verify project (lint/typecheck), generate message, commit
lgnh commit-fast    # skip verification, generate message, commit
lgnh commit -e      # edit generated message before committing

# Model selection
lgnh model                      # view current model
lgnh model <model-id>           # change model
lgnh model search [query]       # interactive model search
```
