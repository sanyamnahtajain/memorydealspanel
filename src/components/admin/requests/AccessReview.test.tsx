/**
 * The approval review on screen: a traffic light + one decision word, a
 * history trail that folds runs into "×N" so it never outgrows a phone, and
 * no wall of chips.
 */
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { buildTrail, EMPTY_HISTORY, reviewAccess, type AccessHistory } from "@/lib/access-review";
import { AccessReviewLine, AccessReviewNotice, groupTrail } from "./AccessReview";

afterEach(cleanup);

const NOW = new Date("2026-11-23T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const review = (h: Partial<AccessHistory>) => reviewAccess({ ...EMPTY_HISTORY, ...h }, NOW);

describe("groupTrail", () => {
  it("folds a run of the same point into one", () => {
    const { trail } = buildTrail([300, 250, 200, 150].map(ago), [320].map(ago));
    const groups = groupTrail(trail);
    expect(groups.map((g) => [g.kind, g.unused, g.events.length])).toEqual([
      ["order", false, 1],
      ["approval", true, 4],
    ]);
  });

  it("keeps a used approval apart from unused ones", () => {
    const { trail } = buildTrail([200, 100, 50].map(ago), [150].map(ago));
    expect(groupTrail(trail).map((g) => [g.kind, g.unused, g.events.length])).toEqual([
      ["approval", false, 1],
      ["order", false, 1],
      ["approval", true, 2],
    ]);
  });
});

describe("AccessReviewLine", () => {
  it("says the decision in one word next to a lit traffic light — red for a hold", () => {
    const approvals = [300, 200, 100].map(ago);
    render(
      <AccessReviewLine
        review={review({ approvalsTotal: 3, approvalsSinceLastOrder: 3, ...buildTrail(approvals, []) })}
      />,
    );
    expect(screen.getByText("Don’t approve")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /red, stop/ })).toBeInTheDocument();
    // Three unused approvals in a row are ONE point "×3", then "now".
    const trail = screen.getByRole("list", { name: /^History:/ });
    expect(within(trail).getByText("×3")).toBeInTheDocument();
    expect(trail.getAttribute("aria-label")).toMatch(/Approved 3 times, no order after.*now asking for prices/);
  });

  it("a regular buyer is green: 'Good buyer'", () => {
    render(
      <AccessReviewLine
        review={review({
          ordersTotal: 4,
          ordersRecent: 1,
          lastOrderAt: ago(5),
          approvalsTotal: 1,
          ...buildTrail([ago(60)], [50, 30, 20, 5].map(ago)),
        })}
      />,
    );
    expect(screen.getByText("Good buyer")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /green, go/ })).toBeInTheDocument();
  });

  it("shows no trail for a brand-new shop on a renewal row (one lone point says nothing)", () => {
    render(<AccessReviewLine review={review({})} showNow={false} />);
    expect(screen.queryByRole("list", { name: /^History:/ })).toBeNull();
  });
});

describe("AccessReviewNotice", () => {
  it("draws approvals as keys when there are few, and says how many had no order", () => {
    render(
      <AccessReviewNotice
        review={review({
          ordersTotal: 1,
          lastOrderAt: ago(120),
          approvalsTotal: 3,
          approvalsSinceLastOrder: 2,
          ...buildTrail([150, 90, 40].map(ago), [ago(120)]),
        })}
      />,
    );
    expect(screen.getByLabelText("3 approvals, 2 with no order after")).toBeInTheDocument();
    expect(screen.getByText("2 with no order")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument(); // hold
  });
});
