'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Log to localStorage for debugging
    try {
      const errorLog = {
        timestamp: new Date().toISOString(),
        error: error.toString(),
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      };

      const logs = JSON.parse(localStorage.getItem('expense-debug-logs') || '[]');
      logs.push({
        timestamp: new Date().toISOString(),
        message: 'CRASH: Error Boundary Caught',
        data: errorLog,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      });
      localStorage.setItem('expense-debug-logs', JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to log error:', e);
    }

    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
            <div className="text-red-600 text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Something went wrong
            </h1>
            <p className="text-gray-600 mb-4">
              Something on this page failed to load. Reloading usually fixes it; the details below help if it keeps happening.
            </p>

            <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
              <p className="text-sm font-mono text-red-800 break-all">
                {this.state.error?.toString()}
              </p>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  window.location.href = '/';
                }}
                className="btn btn-primary w-full"
              >
                Go to Home
              </button>

              <button
                onClick={() => window.location.href = '/debug'}
                className="btn btn-secondary w-full"
              >
                View Debug Logs
              </button>

              <button
                onClick={() => window.location.reload()}
                className="btn btn-success w-full"
              >
                Reload Page
              </button>
            </div>

            {this.state.error?.stack && (
              <details className="mt-4">
                <summary className="text-sm text-gray-600 cursor-pointer">
                  Technical Details
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
