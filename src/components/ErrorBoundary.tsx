import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn("[ErrorBoundary] Caught unhandled render error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-ink p-6 text-center text-white">
          <div className="max-w-md rounded-2xl border border-white/10 bg-panel-1 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <span className="text-2xl font-bold">!</span>
            </div>
            <h2 className="mb-2 text-xl font-bold text-white">Something went wrong</h2>
            <p className="mb-6 text-sm text-neutral-400">
              An unexpected error occurred while loading this view. You can reload the page or return to Home.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={this.handleReset}
                className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-hover active:scale-95"
              >
                Reload Page
              </button>
              <a
                href="/home"
                className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-neutral-300 transition hover:bg-white/10 hover:text-white"
              >
                Return Home
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
