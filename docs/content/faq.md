## Does Slope need a server?

No. The app and this guide are both static pages. You can host them on any static file server.

## Why is this guide rendered in the browser?

This repository already uses a zero-build static architecture. Rendering trusted Markdown with Marked keeps the docs easy to inspect and easy to ship alongside the app.

## Would server-side or pre-rendered docs ever make sense?

Yes, if the documentation grows into a larger public site where SEO, indexing, content validation, or richer content transforms become important. For the current app, client-side rendering is the simpler fit.

## Why Marked instead of Remark or Markdown-it?

Marked is the smallest implementation for this repository's needs: trusted local Markdown, local screenshots, and no build step. Markdown-it would be a reasonable second choice if the docs need more presentation plugins. Remark becomes worthwhile when you need an AST pipeline, frontmatter processing, or more formal content tooling.

## Are my imported tracks uploaded anywhere?

No. Slope works in the browser and stores workspace state locally unless you explicitly export files yourself.

## What if the interface feels crowded on a small screen?

Collapse the settings panel, keep only one track active, and use the profile toggle when you need more map space.
