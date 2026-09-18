# preview

A place to put work in progress so it can be shared as a **link** instead of a zip.

Published at **https://annalynn-cmyk.github.io/preview/**

## Publishing something

```
node publish.mjs --from <dir-or-html-file> --slug <name> --title "..." --note "..."
git add -A && git commit -m "publish <name>" && git push
```

Pages redeploys in a minute or so. The directory page at the root rebuilds itself from
`published.json` each time, so the list of links always matches what is actually in the repo.

## Why publishing is not just a copy

Pages serves this repo from a **sub-path** — `/preview/`, not the domain root. A site built
for its own domain writes root-absolute references like `href="/about-us/"`, and those
resolve against the origin, so a straight copy would send the browser to
`https://annalynn-cmyk.github.io/about-us/` and get a 404. Stylesheets, images and every
link break at once and the site renders naked.

`publish.mjs` therefore copies **and rewrites**: every root-absolute reference is re-pointed
at `/preview/<slug>/`. Protocol-relative (`//cdn…`) and absolute (`https://…`) references are
left alone. The seoguarantee site needed 37,321 of these rewrites across 261 pages.

If a publish reports **0 references rewritten**, that is either a genuinely self-contained
file or the rewrite silently failing — check before sharing the link.

## What "public" means here

The repository is public, which is what makes the links work on a free plan. So:

- **Anyone with a link can open it.** Share links with the team; they are not private.
- **The repo is browsable and indexable on github.com.** The source is public too.
- Pages carry `noindex`, which is what actually keeps them out of search results.
  The `robots.txt` in this repo is a courtesy — crawlers read the one at the domain root,
  which this repo does not control.

Nothing here should be a client's confidential material or anything with real credentials.
