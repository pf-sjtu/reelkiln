---
name: sfx
description: Including sound effects
metadata:
  tags: sfx, sound, effect, audio
---

Fetch a rights-cleared catalog cue into the job first, then use the local job asset with
the `<Audio>` tag:

```tsx
import { Audio } from "@remotion/sfx";
import { staticFile } from "remotion";

<Audio src={staticFile(`${jobPublicPath}/sfx/transition_whoosh_short__v1.wav`)} />;
```

Search and fetch by stable ID:

```bash
uv run python tools/sfx_catalog.py --job <id> --mode search --query whoosh
uv run python tools/sfx_catalog.py --job <id> --mode fetch \
  --id transition.whoosh.short --version 1
```

If no catalog cue fits, omit it or ask the user for a licensed file. Do not embed a remote CDN
URL, search the internet, or silently generate a replacement.
