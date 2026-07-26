# Demo sample photographs

The landing page demo runs on two pictures: one ordinary photograph that still
has quality left in it, and one visually busy photograph that somebody exported
as a PNG. `lib/demo/sources.ts` describes what each one has to show.

If `hero.webp` and `busy.webp` are here, the demo uses them. The names describe
the job each picture does rather than what is in it, because the photographs get
swapped and a file called `coast.webp` holding a photograph of a city is a small
lie that outlives whoever wrote it.

If the files are not here, the page draws two scenes with arithmetic instead and
says so under the picker, because calling a generated image a photograph would be
a small lie in the one section of the site that asks readers to trust their own
eyes.

## Adding the photographs

The candidates live in `scripts/demo-photos.json`. From `apps/web`:

```bash
pnpm demo:photos
```

That pulls every candidate, resizes each to exactly 960x640, encodes lossy webp
at quality 92, and writes both files plus `credits.json`.

Which photograph lands in which slot is decided by measurement, not by the order
they are listed: the script stores each candidate losslessly and gives the
largest result to `busy`, because that slot exists to show how big a photograph
gets when it is saved as a PNG. The next one becomes `hero`. It prints every
measurement and every choice, and it names any candidate it did not use.

To fill one slot by hand, from a local file or a direct image URL:

```bash
pnpm demo:photo hero ~/Downloads/photo.jpg \
  --source https://unsplash.com/photos/xxxxxxxx \
  --credit "Photographer Name"
```

`--source` and `--license` are required (`--license` defaults to the Unsplash
License, so pass it explicitly for anything from elsewhere). `--credit` is
optional: it names the photographer when that is known, and an invented name
would be worse than no name. Only use photographs whose licence actually permits
this: the Unsplash License, CC0, or public domain.

Commit the images and `credits.json` together, then run `pnpm test`. The demo
suite measures whatever is committed here, so a photograph that breaks one of
the three promises the page makes ("gets much smaller", "gets refused", "saves a
lot") fails the build rather than shipping a claim the picture does not support.
An almost featureless photograph fails the first promise, and a wall of noise
fails it too, because nothing compresses either one.

## Why 960x640

The demo runs five real encodes in the reader's browser tab, so the size is a
ceiling rather than a preference. It also matches the cap on the compare frame,
so the preview is displayed at its natural size and never enlarged.
