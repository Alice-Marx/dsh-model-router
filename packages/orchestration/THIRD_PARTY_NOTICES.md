# Third-party notices

Parts of this package are adapted from OpenMausBot, <https://github.com/milind-soni/OpenMausBot>,
commit `bea6b2da42a15ddfd4cacd3388743fb53f222546`, used under the Apache License, Version 2.0.
The full license text is in [`modules/bot-runtime/vendor/ds-bot/LICENSE`](../../modules/bot-runtime/vendor/ds-bot/LICENSE)
and at <http://www.apache.org/licenses/LICENSE-2.0>.

Attribution notice of that project:

```text
OpenMausBot
Copyright 2026 Milind Soni and OpenMausBot contributors
```

Adapted parts. Each was rewritten for this Host; the changes are ours.

| File | Adapted from | Changes |
| --- | --- | --- |
| `src/bot-templates.mjs` | `src/lib/ready-bots.ts` (ready-made Bot names, titles, descriptions and instructions) | Translated into Chinese and rewritten so no template claims a tool, app integration, model or permission; those stay with the owner's committed Host state. |
| `src/team-package.mjs` | `shared/package-format.ts` (team package layout, format `openmaus.package` version 2) and `shared/redact.ts` (credential shapes) | Reads JSON only, keeps Bots, group chats and playbooks, reports everything else as skipped, refuses any package with a credential-shaped value and imports additively with rollback. |

No file from that project's `enterprise/` directory is used. The OpenMausBot and MausBot names
and the mascot are trademarks of their owner. The Apache License grants no trademark rights,
and this product does not use them in its interface.
