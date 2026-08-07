# @loomery/brain-site

The shared Quartz v5 frontend for Loomery project brains. This package ships the skin —
theme, layout, plugins, and CLI scaffolding — while each brain repository owns its own
content and file structure. Individual brains depend on this package rather than
vendoring their own copy of the frontend, so improvements to the shared skin can be
picked up across all brains.

Consumers pin this package to a specific git tag (rather than a branch or `main`) to get
a stable, reproducible build.
