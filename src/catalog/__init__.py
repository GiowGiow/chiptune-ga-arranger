"""The MPB MIDI catalog: a searchable list of Brazilian songs that have a MIDI file on the web.

Beatriz Kauffmann's Web Site (https://www.beakauffmann.com/) lists thousands of fan-made MIDI
sequences of Brazilian popular music (MPB), one index page per initial letter. The browser
arranger lets a visitor search that list by title, composer or performer, then download a song
from the site and arrange it. This package builds the list once, offline: `pages` reads the
site's HTML and `crawl` walks the site politely and writes `arranger/data/catalog.json`.

The site says "All Rights Reserved", so the catalog keeps metadata and links only (title,
composers, performer, page and MIDI URLs) and credits the site. The MIDI files stay on the site.
"""
