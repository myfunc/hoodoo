import { CLOUD_LIMITS, REPORT_REASONS, ReportReason, cleanName } from '../../io/cloud/cloud-contract';
import { Select, TextField } from '../kit/controls';
import { Dialog, DialogStyle } from '../kit/dialog';
import { type Child, el } from '../kit/dom';
import { CLOUD, REASON_LABELS } from './cloud-strings';

/** The small windows of the cloud commands: the nickname, Publish, Report and the delete confirmations. */

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

/** The nickname: the only name Hoodoo Cloud shows. `problem` says why the last one was refused. */
export function openNickDialog(current: string | null, problem: string | null, onOk: (nick: string) => void, onCancel: () => void): void {
  const field = new TextField({ value: current ?? '', placeholder: CLOUD.nickPlaceholder, cls: 'cloud-form-field', maxLength: CLOUD_LIMITS.nickMax, onCommit: () => undefined });
  const dialog = new Dialog({
    title: CLOUD.nickTitle, style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form' }, [
      row(CLOUD.nickLabel, field.el),
      el('div', { cls: problem ? 'cloud-form-note is-bad' : 'cloud-form-note', text: problem ?? CLOUD.nickRules }),
      el('div', { cls: 'cloud-form-note', text: CLOUD.nickPrivacy }),
    ]),
    onOk: () => {
      const nick = field.el.value.trim();
      if (nick) onOk(nick);
      else onCancel();
    },
    onCancel,
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
  // A list, not segments: the reasons are long and there are five.
  const reasons = new Select({ items: REPORT_REASONS.map((r) => ({ value: r, label: REASON_LABELS[r] })), value: reason, onChange: (r) => { reason = r; } });
  const note = new TextField({ value: '', cls: 'cloud-form-field', maxLength: CLOUD_LIMITS.reportChars, onCommit: () => undefined });
  const dialog = new Dialog({
    title: `${CLOUD.reportTitle}: ${title}`, style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form' }, [row(CLOUD.reportReason, reasons.el), row(CLOUD.reportNote, note.el)]),
    onOk: () => onOk(reason, note.el.value.trim()),
    onCancel: () => undefined,
  });
  open(dialog);
}

/** Deleting the whole account: who, and what goes with it. */
export function confirmDeleteAccount(nick: string | null, onOk: () => void): void {
  open(new Dialog({
    title: CLOUD.deleteAccountTitle, style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form' }, [el('div', { cls: 'cloud-form-note', text: CLOUD.deleteAccountAsk(nick) }), el('div', { cls: 'cloud-form-note', text: CLOUD.deleteAccountWhat })]),
    onOk, onCancel: () => undefined,
  }));
}

export function confirmDelete(question: string, onOk: () => void): void {
  open(new Dialog({
    title: CLOUD.delete.replace('…', ''), style: DialogStyle.Stone, cls: 'cloud-dialog',
    body: el('div', { cls: 'cloud-form-note', text: question }),
    onOk, onCancel: () => undefined,
  }));
}
