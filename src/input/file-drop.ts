/** Files dropped on the scene window: the window lights up while something is dragged over it. */
export function installFileDrop(el: HTMLElement, onDrop: (files: FileList) => void): void {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('is-dropping');
  });
  el.addEventListener('dragleave', () => el.classList.remove('is-dropping'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('is-dropping');
    if (e.dataTransfer?.files.length) onDrop(e.dataTransfer.files);
  });
}
