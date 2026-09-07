# Textbox paste sizing, opaque backgrounds, and ASCII input

Large pastes now update the textbox's exact wrapped height and selection border
in the same input operation. The previous large-text typing shortcut deferred
autoheight for paste as well as single-character typing. Paste, drop, and bulk
insertion now force the exact cached line count; ordinary single-character
typing keeps its existing performance path.

Textboxes have an opaque background matching their world-space rectangle and
the active board theme. Before drawing, the renderer subtracts higher textbox
rectangles from lower objects. Fully covered textboxes skip layout and drawing;
partially covered text uses visible rectangles to narrow layout and GPU glyph
submissions. Images retain scene order. The editing overlay draws its background
before selection, text, and caret.

Occlusion work is bounded to 128 covering rectangles and 32 visible fragments
per object. If a board exceeds those limits, the renderer safely draws extra
content that subsequent opaque backgrounds cover. It never drops visible
content to satisfy the work limit. GPU clips share pixel-center rounding at
fractional boundaries; native Canvas uses a single union clip to avoid seams.
The existing shared glyph atlas, filtering, and retained geometry remain in use.

The shared content normalizer accepts printable ASCII (U+0020–U+007E), TAB, and
LF. CRLF and CR become LF. All other code points are skipped, with no substitute
spaces or transliteration. Typed, pasted, composed, created, imported, and saved
textbox content uses this rule. Filtering an entire insertion leaves the
original selection and text intact. Object paste counts accepted objects before
checking capacity and avoids clone/layout work if capacity is insufficient.
Opening a board normalizes the in-memory content; it does not rewrite the source
file merely because the board was opened.

## Browser reproduction

The generated fixture in `src/dev/textbox-behavior.html` exercises the normal
app, input handlers, selection overlay, theme handling, and GPU renderer. Its
paste events are synthetic; the harness emulates the browser's default textarea
mutation only when the application permits it. Composition checks send multiple
provisional updates followed by the final composition event.

The prior production bundle, `972732412ad0`, reproduced all three reported
problems. Appending 100,000 characters to a 100,000-character textbox left its
height at 2,120 world pixels instead of the required 4,208. Unsupported paste
remained in the content, and four coincident textboxes differed from one textbox
in 700,583 color channels. Blank areas in a foreground textbox showed the text
underneath in both themes.

The updated browser check verifies the 200,000-character height is 4,208 before
any Enter key is sent. It also verifies the visible selection outline tracks
the new height, allowing less than one CSS pixel for border rounding. Mixed
input becomes the same ASCII text through paste and typing; unsupported-only
paste, fallback input, and composition preserve selected text.

Four coincident 100,000-character textboxes now produce exactly the same pixels
as one textbox. The development renderer submits 84,314 glyphs for either
scene. This is a reduction in hidden glyph work, not an FPS measurement.
Partial overlaps match a reference assembled from independently rendered
foreground and background images in every RGBA channel at 10%, 11.37%, and 45%
zoom with fractional pan positions. Both dark and light themes pass, including
blank foreground pixels while editing.

The final production bundle is `c67c18acb71f`. Both development and production
browser checks pass, along with 625 automated tests, 25 static checks, and the
production build. The tests include multi-update composition, cancellation,
trailing native input events, filtered-only paste at capacity, clipping state,
editing order, and partial-overlap glyph-work reduction.

The generated fixture contains no user document content. Raw before/after
results are retained in [textbox-behavior.json](gpu-render-results/textbox-behavior.json).
The earlier zoom timing measurements are documented separately in
[text-zoom-performance.md](text-zoom-performance.md).

To reproduce, run `npm run web:build`, then start the fixture server:

```sh
node scripts/serve-text-motion.mjs \
  --board /absolute/path/to/boardTest.bf \
  --baseline 2c11cd0031b7bd565802afed0111d033db3d5125 \
  --port 5193 \
  --evidence /tmp/boardfish-textbox
```

Open `/dev/textbox-behavior.html`, then run **Check paste and ASCII** and
**Check opaque overlaps**. Add `?production=1` to repeat against the built app.
The server reads the board argument without modifying it; these checks use
generated text instead of loading its contents.
