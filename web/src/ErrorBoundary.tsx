import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Without this, one thrown error unmounts the entire tree and leaves a black
 * screen with no way back except a reload — which is what happened when the
 * rest timer called `new Notification()` on Android Chrome, where it's an
 * illegal constructor.
 *
 * That specific bug is fixed, but the failure mode is what matters: this app is
 * used mid-workout with a bar in front of you, and "the screen went black" is
 * about the worst thing it can do. Anything that throws should cost you a
 * screen, not the session.
 *
 * The session itself is safe regardless — it lives in localStorage and is
 * pushed as total state — so the honest advice on the fallback is just to
 * reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[lifts] render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: "24px 18px" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Something broke</h1>
        <p className="muted small">
          Your session is saved on this phone and will sync — nothing has been lost.
        </p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => location.reload()}>
          Reload
        </button>
        <button
          className="btn ghost"
          style={{ marginTop: 10 }}
          onClick={() => this.setState({ error: null })}
        >
          Try to carry on
        </button>
        <pre
          className="muted small"
          style={{ marginTop: 24, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
        >
          {error.message}
        </pre>
      </div>
    );
  }
}
