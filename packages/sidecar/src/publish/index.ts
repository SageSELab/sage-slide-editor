// The Phase 5 methods (docs/rpc.md "Publish and export"): talk.publish, talk.export,
// site.stage, site.commit, talk.qr. main.ts registers them; they run in the request queue, one
// at a time with builds and edits, so an export never renders a half-written film.
import { ErrorCode, PublishErrorCode, RpcError, type BuildResult, type ExportParams, type ExportProgressParams, type PublishParams, type QrParams, type SiteCommitParams, type SiteStageParams, type TalkKind } from '../protocol.ts';
import type { Spine } from '../core-port.ts';
import { exportFilm, type ExportDeps } from './export.ts';
import { publishOpenTalk } from './publish.ts';
import { writeQrCodes } from './qr.ts';
import { commitSite, stageSite } from './site.ts';

export interface PublisherHost {
  readonly root: string | null;
  readonly kind: TalkKind | null;
  build(): Promise<BuildResult>;
  spine(): Promise<Spine>;
  notifyProgress(p: ExportProgressParams): void;
  /** An app write into the talk (announced to the watcher, then atomic). */
  writeFile(rel: string, content: string): void;
}

export class Publisher {
  constructor(private host: PublisherHost, private deps: Pick<ExportDeps, 'launch'> = {}) {}

  private root(method: string): string {
    const root = this.host.root;
    if (!root) throw new RpcError(ErrorCode.NoTalkOpen, 'no talk is open');
    if (this.host.kind !== 'beatFormat') throw new RpcError(ErrorCode.UnsupportedForKind, `${method} works on sage-talk/1 talks`, { kind: this.host.kind });
    return root;
  }

  publish(p: PublishParams | undefined) {
    return publishOpenTalk(this.root('talk.publish'), p?.slug);
  }

  async export(p: ExportParams) {
    const root = this.root('talk.export');
    const b = await this.host.build();
    if (!b.ok) throw new RpcError(PublishErrorCode.PublishFailed, 'the talk does not build; fix it before exporting', { diagnostics: b.diagnostics });
    return exportFilm(root, p, { ...this.deps, progress: (x) => this.host.notifyProgress(x) });
  }

  async stage(p: SiteStageParams) {
    const root = this.root('site.stage');
    const spine = await this.host.spine() as Spine & { venue?: string };
    return stageSite(p, { talkRoot: root, title: spine.title ?? p.slug, ...(spine.venue ? { venue: spine.venue } : {}) });
  }

  commit(p: SiteCommitParams) {
    return commitSite(p);
  }

  qr(p: QrParams) {
    this.root('talk.qr');
    return writeQrCodes(p, (rel, content) => this.host.writeFile(rel, content));
  }
}
