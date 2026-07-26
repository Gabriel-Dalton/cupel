# Demo sample photographs

The landing page demo runs on two pictures: one ordinary photograph that still
has quality left in it, and one visually busy photograph that somebody exported
as a PNG. `lib/demo/sources.ts` describes what each one has to show.

If `coast.webp` and `garden.webp` are here, the demo uses them. If they are not,
the page draws two scenes with arithmetic instead and says so under the picker,
because calling a generated image a photograph would be a small lie in the one
section of the site that asks readers to trust their own eyes.

## Adding a photograph

From `apps/web`:

```bash
pnpm demo:photo coast ~/Downloads/photo.jpg \
  --credit "Photographer Name" \
  --source https://unsplash.com/photos/xxxxxxxx
```

The second argument takes a local file or a direct image URL. The script resizes
to exactly 960x640, encodes lossy webp at quality 92, and records the credit in
`credits.json`. Commit the image and `credits.json` together: a test fails if an
image turns up here without its entry.

`--license` defaults to the Unsplash License. Pass it explicitly for anything
from anywhere else, and only use photographs whose licence actually permits
this: the Unsplash License, CC0, or public domain.

## Why 960x640

The demo runs five real encodes in the reader's browser tab, so the size is a
ceiling rather than a preference. It also matches the cap on the compare frame,
so the preview is displayed at its natural size and never enlarged.
