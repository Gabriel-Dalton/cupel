# Brand and voice

## 1. What cupel is, in one sentence

cupel makes images smaller without making them look worse, and it stops when
there is nothing left to safely remove.

That sentence is the product. Everything on this list exists to keep us from
drifting away from it.

## 2. Who we are talking to

Anyone who has images on a website. Not just developers, and definitely not
just people who know what a quantization table is.

Assume the reader knows that big images make pages slow, and that squashed
images look bad. Assume nothing else. A designer who has never opened a
terminal should be able to read the landing page and understand what this does
and why they would want it.

The technical audience is still important, and they are won by proof rather
than vocabulary. Show them a real measurement and they will trust us. Bury
them in jargon and they cannot tell us apart from the other forty compression
tools.

## 3. The name

A cupel is a small dish used to test how pure a sample of metal is before
anyone decides what it is worth. That is a nice story about testing something
before you act on it, and it is the reason for the name.

It is not the pitch. Nobody arrives at this page wanting a metallurgy lesson.
Keep the origin story in the About or docs, one sentence at most, and never in
the headline.

## 4. Voice

**Lead with what the reader gets, then explain how.** "Your images get smaller
and still look right" comes before anything about rate-distortion curves.

**Plain words, short sentences.** Say "checks" instead of "analyzes the
provenance of". Say "gives up" or "stops" instead of "issues a refusal". Vary
sentence length so it reads like a person.

**Be specific instead of impressive.** "Saved 51% of this photo and it still
looks the same" beats "dramatically reduces payload". Real numbers, real file
names, real verdicts.

**Say what it will not do.** Our best feature is a limit. cupel will not
re-squeeze a picture that has already been squeezed flat, and it will not
overwrite a single file unless you explicitly ask. Say so early and plainly.

**Show, do not claim.** Where a sentence makes a claim, put the thing that
proves it next to the sentence. The landing page runs the real code on real
images in the reader's browser. That is worth more than any adjective.

## 5. Words

**Use:** smaller, sharper, check, measure, stop, skip, keep, protect, prove,
receipt, quality, savings, before and after.

**Never in top-level copy:**

- Fluff: intelligent, seamless, magic, revolutionary, effortless, powerful,
  cutting edge, next generation, blazing fast.
- Metallurgy: assay, bone ash, ore, smelting, crucible. The name is enough.
- AI tells: "not just X, it's Y", leverage, unlock, elevate, harness, delve,
  tapestry, landscape as a metaphor, journey, "in today's fast paced world".

**Keep in the docs only:** provenance, quantization table, SSIM, deltaE,
rate-distortion, convex hull, radially averaged power spectrum, headroom,
lambda. Every one of these has a plain replacement for the landing page.
"Headroom" becomes "quality left to spend". "Provenance" becomes "what has
already happened to this file".

## 6. Punctuation and formatting

No dash characters in prose. No em dashes, no en dashes, and no hyphens used
as connectors or asides. Use commas, periods, colons, or the words "and" and
"but". Hyphens are allowed only where a machine needs them: code, CSS
properties, file names, URLs.

No arrow glyphs, no decorative symbols, no emoji. A button says "Try it", not
"Try it" with an arrow bolted on.

Sentence case for headings. Numbers as digits.

## 7. Design principles that carry the voice

**Neutral surfaces.** The background is a cool neutral grey, never a warm
cream. A warm background lies about the colour of the images sitting on it,
and this is a tool for judging image quality. Photo software is neutral for
the same reason.

**Two verdict colours, used consistently everywhere.** Green means cupel acted
and saved bytes. Red means cupel stopped and protected the file. A reader
should be able to scan any page and know the outcome from colour alone. These
two are the only accents. Nothing else gets to be colourful.

**No monospaced type.** Terminal fonts make a tool look like it is only for
people who live in terminals, which is exactly the audience limit we are
trying to break. Numbers line up using tabular figures in the normal
typeface instead. Data still aligns; it just does not shout "command line".

**Images are the hero.** This is a tool about pictures. Show pictures, large,
and let people drag a slider between the before and the after.

## 8. Messaging, in priority order

**A. The plain benefit (default, use this first)**

- Headline: Make your images smaller without making them worse.
- Body: cupel checks how much quality a picture actually has left, then only
  removes what it can remove safely. Most pages get noticeably lighter. Nothing
  gets wrecked.

**B. The limit (our real differentiator)**

- Headline: It knows when to stop.
- Body: Every other tool will happily squash a photo that was already squashed
  by your CMS two years ago, and it gets worse every time. cupel measures
  first, and when there is nothing left to take, it refuses and tells you why.

**C. The proof (for the sceptical technical reader)**

- Headline: Every change comes with a receipt you can check yourself.
- Body: cupel records what it did to each file and the numbers behind it. You,
  or anyone else, can recheck those numbers in a browser. If a receipt does not
  match the file, it says so.
