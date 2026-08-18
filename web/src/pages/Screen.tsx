import type { ReactNode } from "react";
import { useLongPress } from "../useLongPress";

/**
 * `onTitleHold` makes the heading press-and-hold. It's used for actions that
 * belong to the whole screen but shouldn't sit on it as a button — putting a
 * live session back in the queue is rare, mildly destructive, and would only
 * be clutter next to the thing you're actually there to do.
 */
export function Screen({
  title,
  sub,
  children,
  onTitleHold,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  onTitleHold?: () => void;
}) {
  const hold = useLongPress(() => onTitleHold?.());

  return (
    <>
      <header className="top">
        <h1
          {...(onTitleHold ? { onPointerDown: hold.onPointerDown, onPointerUp: hold.onPointerUp, onPointerCancel: hold.onPointerCancel, onContextMenu: hold.onContextMenu } : {})}
          className={onTitleHold ? "holdable" : undefined}
        >
          {title}
        </h1>
        {sub && <span className="sub">{sub}</span>}
      </header>
      <main>{children}</main>
    </>
  );
}
