# Component library

`catalog.json` contains reusable, scene-independent parametric recipes. A recipe only describes primitive geometry, materials, children, and a default placement; it contains no café, bedroom, or radio-specific generation branch.

The prompt adapter matches aliases to these recipes. If no recipe matches, it emits a valid generic primitive object, so generation can continue without editing generator source. New reusable components can be added declaratively by extending the catalog.
