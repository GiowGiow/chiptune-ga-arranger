"""Reading the MPB MIDI catalog's pages: index rows and song pages.

The HTML below is synthetic: it follows the structure of the catalog site (research R8), but it is
written for these tests and holds no copy of the site's pages.
"""

from catalog.pages import IndexRow, SongPage, decode_page, parse_index, parse_song_page

SITE = "https://www.beakauffmann.com/"
INDEX_URL = SITE + "mpb_m.html"
SONG_URL = SITE + "mpb_m/mulher-de-fases.html"


def index_page(*rows: str) -> str:
    """An index page in the site's layout: letter links, then one table row per song."""
    body = "\n".join(f'<tr><td class="L">{row}</td></tr>' for row in rows)
    return (
        "<html><head><title>MPB - M</title></head><body>"
        '<a href="mpb_a.html" class="BK" title=" A ">A</a>'
        '<a href="mpb_x.html" class="BK" title=" X ">X</a>'
        '<a href="https://www.beakauffmann.com/contato.php?m=mpb_m" target="_blank">Contato</a>'
        '<a href="musicas-juninas.html" title=" M&uacute;sicas Juninas ">Juninas</a>'
        f"<table>{body}</table></body></html>"
    )


def song_page(title: str, *links: str) -> str:
    """A song page: the page title, then the links of the page."""
    anchors = "".join(f'<a href="{link}">download</a>' for link in links)
    return f"<html><head><title>{title}</title></head><body>{anchors}</body></html>"


# --- Index pages ---


def test_an_index_row_gives_the_title_the_composers_and_the_absolute_page_url():
    html = index_page(
        '<a href="mpb_m/mulher-de-fases.html" class="BB"><b>MULHER DE FASES</b></a>'
        " &nbsp;Dig&atilde;o e Rodolfo"
    )

    assert parse_index(html, INDEX_URL) == [
        IndexRow(title="MULHER DE FASES", composers="Digão e Rodolfo", page_url=SONG_URL)
    ]


def test_a_medley_joins_its_titles_with_a_bullet():
    html = index_page(
        '<a href="mpb_m/mulher-boa-era-a-maria_e_madrugadeiro.html" class="BB">'
        "<b>MULHER BOA ERA A MARIA</b>"
        '<font style="font-size: 9pt;">&nbsp;&bull;&nbsp;</font><b>MADRUGADEIRO</b></a>'
        " &nbsp;Ata&iacute;de e Alexandre"
    )

    [row] = parse_index(html, INDEX_URL)

    assert row.title == "MULHER BOA ERA A MARIA • MADRUGADEIRO"
    assert row.composers == "Ataíde e Alexandre"


def test_a_parenthesis_after_the_link_stays_part_of_the_title():
    html = index_page(
        '<a href="mpb_m/mulher-sexo-fragil.html" class="BB"><b>MULHER</b></a>'
        " (Sexo Fr&aacute;gil) &nbsp;Erasmo Carlos e Narinha"
    )

    [row] = parse_index(html, INDEX_URL)

    assert row.title == "MULHER (Sexo Frágil)"
    assert row.composers == "Erasmo Carlos e Narinha"


def test_a_row_without_composers_gives_an_empty_composer_text():
    html = index_page('<a href="mpb_m/maracatu.html" class="BB"><b>MARACATU</b></a>')

    assert parse_index(html, INDEX_URL)[0].composers == ""


def test_only_song_links_are_rows_not_letters_contact_or_other_lists():
    html = index_page(
        '<a href="mpb_m/mulher-de-fases.html" class="BB"><b>MULHER DE FASES</b></a>'
        " &nbsp;Dig&atilde;o e Rodolfo",
        '<a href="mpb_m.html" class="BB"><b>NOT A SONG</b></a> &nbsp;Nobody',
        '<a href="mpb_m/no-class.html"><b>NO CLASS</b></a> &nbsp;Nobody',
    )

    assert [row.title for row in parse_index(html, INDEX_URL)] == ["MULHER DE FASES"]


def test_rows_keep_the_order_of_the_index_page():
    html = index_page(
        '<a href="mpb_0-9/1x0.html" class="BB"><b>1 X 0</b></a> &nbsp;Pixinguinha',
        '<a href="mpb_0-9/14-anos.html" class="BB"><b>14 ANOS</b></a> &nbsp;Guilherme Arantes',
    )

    rows = parse_index(html, SITE + "mpb_0-9.html")

    assert [row.page_url for row in rows] == [
        SITE + "mpb_0-9/1x0.html",
        SITE + "mpb_0-9/14-anos.html",
    ]


# --- Song pages ---


def test_a_song_page_gives_the_performer_from_its_title_and_the_absolute_midi_url():
    html = song_page(
        "MULHER DE FASES - Raimundos - MIDI e Letra da M&uacute;sica - Lyric",
        "../mpb_m.html",
        "som/mulher-de-fases.mid",
    )

    assert parse_song_page(html, SONG_URL) == SongPage(
        performer="Raimundos",
        midi_urls=(SITE + "mpb_m/som/mulher-de-fases.mid",),
    )


def test_a_song_page_keeps_every_midi_link_once_in_page_order():
    html = song_page(
        "MULHER DE FASES - Raimundos - MIDI e Letra da M&uacute;sica - Lyric",
        "som/mulher-de-fases.mid",
        "som/mulher-de-fases-2.MID",
        "som/mulher-de-fases.mid",
    )

    assert parse_song_page(html, SONG_URL).midi_urls == (
        SITE + "mpb_m/som/mulher-de-fases.mid",
        SITE + "mpb_m/som/mulher-de-fases-2.MID",
    )


def test_a_song_page_with_no_midi_link_gives_an_empty_list():
    html = song_page("MULHER DE FASES - Raimundos - MIDI e Letra da M&uacute;sica", "letra.html")

    assert parse_song_page(html, SONG_URL).midi_urls == ()


def test_a_title_with_a_dash_still_gives_the_performer_before_the_site_suffix():
    html = song_page(
        "ANDAN&Ccedil;A - AO VIVO - Beth Carvalho - MIDI e Letra da M&uacute;sica - Lyric",
        "som/andanca.mid",
    )

    assert parse_song_page(html, SONG_URL).performer == "Beth Carvalho"


def test_an_instrumental_page_whose_title_ends_in_midi_still_gives_the_performer():
    html = song_page("CHORINHO - Pixinguinha - MIDI", "som/chorinho.mid")

    assert parse_song_page(html, SONG_URL).performer == "Pixinguinha"


def test_a_dash_without_a_space_before_it_still_separates_the_performer():
    html = song_page("SAMBINHA- Cartola - MIDI e Letra da M&uacute;sica - Lyric", "som/s.mid")

    assert parse_song_page(html, SONG_URL).performer == "Cartola"


def test_a_hyphenated_word_is_not_a_separator():
    html = song_page("MEIA-VOLTA - Beth Carvalho - MIDI e Letra da M&uacute;sica", "som/m.mid")
    no_performer = song_page("MEIA-VOLTA - MIDI e Letra da M&uacute;sica", "som/m.mid")

    assert parse_song_page(html, SONG_URL).performer == "Beth Carvalho"
    assert parse_song_page(no_performer, SONG_URL).performer == ""


# --- Bytes to text ---


def test_page_bytes_are_read_as_utf8_and_as_latin1_when_they_are_not_utf8():
    assert decode_page("Digão".encode()) == "Digão"
    assert decode_page("Digão".encode("latin-1")) == "Digão"
