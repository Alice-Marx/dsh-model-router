# Third-party notices

## OpenMausBot

OpenMausBot, Copyright 2026 Milind Soni and OpenMausBot contributors.
Licensed under the Apache License, Version 2.0: <https://www.apache.org/licenses/LICENSE-2.0>.
Source: <https://github.com/milind-soni/OpenMausBot>

This plugin adapts, with changes, the following from OpenMausBot's Apache-2.0 core (nothing from its
source-available `enterprise/` folder):

- The colour palettes of its twelve skins (`src/styles.css`), paired by family into the six themes in
  `apps/integration-client/skins.mjs`.
- The layout of its model picker (`src/components/ModelPicker.tsx`, `ModelPickerFull.tsx`): an engine
  rail beside the selected engine's models, status pills, search and suggestions. The picker in
  `apps/integration-client/brain-picker.jsx` is a new implementation for this plugin's Bot binding
  model; no OpenMausBot source code is copied.
