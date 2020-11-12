There are three CSS types in this project:

1. Initial style.css
  This sets the technical components of the design. Mostly try not to break them.

2. Component restyles.
  This restyles the entire component (accounts-flat, accounts-canvas). It's a good idea to not rely on much from the bottom level.
  At least try to give specific margins, paddings, borders.

3. Recolors / adjustments.
  Makes very limited changes. Either changes the vars or specific properties.
  Prefer: "--border-color" to "border-color" to "border: .." as the first two will work even if another adjustment disables borders.
