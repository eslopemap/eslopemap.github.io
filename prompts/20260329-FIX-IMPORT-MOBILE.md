* the import logic is broken : when I import a gpx file with multiple tracks and segments, right now it is split into files in the track list, whereas the structure built should mirror the file, enough to round-trip on export. unit-test the round trip of multi-track + multi-segment, for a simple enough well-crafted gpx, the round-trip import>export should be semantically identical.
* in track panel, track list has wrong css ? when i scroll the track list, its content goes behind the panel header and it should not. this should be unit-tested againsta regressions.
* mobile editing: 
  - there was supposed to be a way to move a point. selecting the point works (as the '+' icon appears for insert-in-the-middle), but touch-dragging the display does not move the point accordingly .
  - we have this thing where I tap and a new point is added at the location in the middle of the screen. it works for normal insert (at the end) but not for insert-in-the-middle functionality. there the point is consistently added with an offset


as usual make focused commits