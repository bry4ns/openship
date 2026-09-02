"use client";

import type { AttentionFeed } from "@/hooks/useAttentionFeed";
import { IssuesCard } from "./AttentionCards";
import HomeTipCard from "./HomeTipCard";

interface UpdatesBlockProps {
  /** The already-read feed, from {@link useAttentionFeed} on the home page. */
  feed: AttentionFeed;
  projectCount: number;
  loading: boolean;
}

/**
 * Home attention slot — broken infrastructure is shown here; routine update notices
 * remain available from Settings → Updates without taking over the home page.
 *
 * The rows come from `/issues` — the same feed the tracker page serves — read once by
 * the home page and passed in, because the page also needs the card count to decide
 * whether the Activity overview above still fits. This used to call
 * `/containers/issues` + `/containers/behind` and judge severity itself, which meant
 * the slot could only ever see edge and mail: a crash-looping container that had
 * already paged Telegram was invisible on the panel titled "Needs attention". One
 * read, one definition, and every source the feed grows reaches the home page free.
 */
export default function UpdatesBlock({ feed, projectCount, loading }: UpdatesBlockProps) {
  const { broken, busyId, resolve, infraFix, hide } = feed;

  // Do not surface update notices as an alert on the home page. If there is no
  // broken infrastructure, keep the slot as the regular product tip.
  if (!feed.showBroken || broken.length === 0) {
    return <HomeTipCard projectCount={projectCount} loading={loading} />;
  }

  return (
    <div className="space-y-3">
      {feed.showBroken && (
        <IssuesCard
          issues={broken}
          busyId={busyId}
          onResolve={resolve}
          onInfraFix={infraFix}
          onHide={() => hide("broken")}
        />
      )}
    </div>
  );
}
