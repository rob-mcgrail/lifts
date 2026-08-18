import type { ReactNode } from "react";

export function Screen({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <>
      <header className="top">
        <h1>{title}</h1>
        {sub && <span className="sub">{sub}</span>}
      </header>
      <main>{children}</main>
    </>
  );
}
