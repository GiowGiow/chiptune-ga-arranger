// @ts-check
/**
 * Downloads: the three files that keep a run (spec 002, FR-024 and FR-025).
 *
 * - `<run id>.mid`: the arrangement as a four-track MIDI file (P1, P2, TR, NO);
 * - `<run id>.config.json`: the run record, which the command line accepts with `--config`;
 * - `<run id>.abc`: the lead sheet the run arranged, so a MIDI song can be rerun without its file.
 *
 * The files are made in the browser and saved by the browser; nothing is uploaded.
 */

/** @typedef {{name: string, label: string, hint: string, blob: Blob}} DownloadFile */

/**
 * Build the download buttons inside `container`.
 *
 * @param {HTMLElement} container
 * @returns {{set: (files: DownloadFile[]) => void, clear: () => void}}
 */
export function createDownloads(container) {
  container.classList.add("downloads");
  /** @type {string[]} */
  let urls = [];

  function clear() {
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
    container.innerHTML = "";
  }

  return {
    set(files) {
      clear();
      for (const file of files) {
        const url = URL.createObjectURL(file.blob);
        urls.push(url);
        const link = document.createElement("a");
        link.className = "button";
        link.href = url;
        link.download = file.name;
        link.title = file.hint;
        link.innerHTML = `<span>${file.label}</span><span class="file mono"></span>`;
        /** @type {HTMLElement} */ (link.querySelector(".file")).textContent = file.name;
        container.append(link);
      }
    },
    clear,
  };
}
