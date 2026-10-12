import { CLOUD_LIMITS, REPORT_REASONS, ReportReason, cleanName } from '../../io/cloud/cloud-contract';
import { Choice, TextField } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { type Child, el } from '../kit/dom';
import { CLOUD, REASON_LABELS } from './cloud-strings';

/** The small windows of the cloud commands: Save to Cloud, Publish, Report and the delete confirmations. */

/** The cloud project the open scene came from or was saved to. */
export interface LinkedProject {
  readonly id: string;
  readonly name: string;
}

export interface SaveChoice {
  readonly name: string;
  /** The project to replace, or null for a new one. */
  readonly replaceId: string | null;
}

const row = (label: string, control: Child): HTMLElement => el('div', { cls: 'cloud-form-row' }, [el('span', { cls: 'cloud-form-label', text: label }), control]);

function nameField(value: string, placeholder: string): TextField {
  const field = new TextField({ value, placeholder, cls: 'cloud-form-field', maxLength: CLOUD_LIMITS.nameChars, onCommit: () => undefined });
  return field;
}

/** Focus the first field once the dialog is on screen. */
function open(dialog: Dialog, focus?: HTMLInputElement): void {
  dialog.open();
  focus?.focus();
  focus?.select();
}

export function openSaveDialog(name: string, linked: LinkedProject | null, onOk: (c: SaveChoice) => void): void {
  const field = nameField(linked?.name ?? name, CLOUD.saveName);
  let replace = linked !== null;
  const target = linked
    ? row(CLOUD.saveAs, new Choice({
      cls: 'segmented',
      items: [{ value: true, label: CLOUD.replace(linked.name) }, { value: false, label: CLOUD.newProject }],
      value: true,
      onChange: (v) => { replace = v; },
    }).el)
    : null;
  const dialog = new Dialog({
    title: CLOUD.saveTitle, style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form' }, [row(CLOUD.saveName, field.el), target]),
    onOk: () => {
      const text = cleanName(field.el.value);
      if (text) onOk({ name: text, replaceId: replace && linked ? linked.id : null });
    },
    onCancel: () => undefined,
  });
  open(dialog, field.el);
}

export function openPublishDialog(name: string, picture: string | null, onOk: (title: string) => void): void {
  const field = nameField(name, CLOUD.publishName);
  const preview = picture
    ? el('img', { cls: 'cloud-preview', attrs: { src: picture, alt: '' } })
    : el('div', { cls: 'cloud-preview is-empty', text: CLOUD.noPicture });
  const dialog = new Dialog({
    title: CLOUD.publishTitle, style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form' }, [preview, row(CLOUD.publishName, field.el), el('div', { cls: 'cloud-form-note', text: CLOUD.publishNote })]),
    onOk: () => {
      const text = cleanName(field.el.value);
      if (text) onOk(text);
    },
    onCancel: () => undefined,
  });
  open(dialog, field.el);
}

export function openReportDialog(title: string, onOk: (reason: ReportReason, note: string) => void): void {
  let reason = ReportReason.Spam;
  const reasons = new Choice({ cls: 'segmented', items: REPORT_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] })), value: reason, onChange: (r) => { reason = r; } });
  const note = new TextField({ value: '', cls: 'cloud-form-field', maxLength: CLOUD_LIMITS.reportChars, onCommit: () => undefined });
  const dialog = new Dialog({
    title: `${CLOUD.reportTitle}: ${title}`, style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form' }, [row(CLOUD.reportReason, reasons.el), row(CLOUD.reportNote, note.el)]),
    onOk: () => onOk(reason, note.el.value.trim()),
    onCancel: () => undefined,
  });
  open(dialog);
}

export function confirmDelete(question: string, onOk: () => void): void {
  open(new Dialog({
    title: CLOUD.delete.replace('…', ''), style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form-note', text: question }),
    onOk, onCancel: () => undefined,
  }));
}
