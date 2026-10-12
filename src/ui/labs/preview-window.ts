import { PREVIEW_FEATURES, isFeatureOn } from '../../world/preview-features';
import type { UiContext } from '../context';
import { hintOn } from '../context';
import { Button } from '../kit/controls';
import { DialogStyle } from '../kit/dialog';
import { el } from '../kit/dom';
import type { ToolContent } from '../kit/tool-window';
import { PreviewModel } from './preview-features';
import { buildLayout, layoutOf } from './preview-layouts';
import './preview-window.css';

/**
 * READ ME — View › Preview Features…: the unfinished features, what each adds,
 * a way straight into it, its switch, and comments on it. A switch acts at once
 * and leaves no trace when off (ui/feature-gate.ts). Comments stay in this
 * browser (io/prefs.ts), go along with Settings › Export…, and Copy comments
 * puts them all on the clipboard to send. A tool window: it floats over the
 * scene or docks in the left panel. Its layout is one of preview-layouts.ts.
 */
export class PreviewFeaturesTool implements ToolContent {
  readonly title = 'Preview Features';
  readonly tab = 'Preview';
  readonly style = DialogStyle.Stone;
  readonly cls = 'preview-features';
  readonly body: HTMLElement;
  private readonly model: PreviewModel;
  private stops: (() => void)[] = [];
  private subject: (text: string) => void = () => undefined;

  constructor(private readonly ctx: UiContext) {
    this.model = new PreviewModel(ctx);
    const layout = layoutOf();
    const copy = new Button({ label: 'Copy comments', cls: 'pf-copy', onClick: () => this.model.copy() });
    hintOn(ctx, copy.el, { title: 'Copy comments', text: 'Every comment as text, to paste into a message' });
    this.body = el('div', { cls: `pf-body pf-layout-${layout}` }, [
      el('div', { cls: 'pf-intro', text: 'Unfinished features to try. Off leaves no trace of them; On adds them.' }),
      buildLayout(layout, this.model),
      el('div', { cls: 'pf-foot' }, [copy.el, el('span', { cls: 'pf-foot-note', text: 'Comments stay in this browser and go with Settings › Export…' })]),
    ]);
  }

  start(subject: (text: string) => void): void {
    this.subject = subject;
    this.stops = [this.ctx.editor.events.on('changed', ({ state, previous }) => { if (state.features !== previous.features) this.sync(); })];
    this.sync();
  }

  stop(): void {
    for (const off of this.stops) off();
    this.stops = [];
  }

  private sync(): void {
    this.model.refresh();
    const on = PREVIEW_FEATURES.filter((f) => isFeatureOn(this.ctx.editor.state.features, f.id)).length;
    this.subject(on ? `${on} on` : '');
  }
}
