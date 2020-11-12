CSS overrides are layered:

1. Initial style.css
  Sets the technical details of the design. Mostly try not to break them.

2. Layout restyles (min.css, canvas.css)
  Rearrange the general feel of the UI.

3. Component restyles.
  Restyle the entire component (accounts-flat, accounts-canvas). It's a good idea to not rely on much from the bottom level.
  Give specific margins, paddings, borders.

4. Recolors / adjustments.
  Make very limited changes. Either change the vars or specific properties.
  Prefer: "--border-color" to "border-color" to "border: .." as the first two will work even if another adjustment disables borders.

Some CSS files are simply examples of how to do specific things.