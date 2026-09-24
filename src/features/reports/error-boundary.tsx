'use client';
import React, { Component, ReactNode } from 'react';
import { ErrorState } from '@/components/common/error-state';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ReportsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // The detail goes to the console, where a developer can read it. It does
    // not go on the page: a stack trace tells the officer looking at Reports
    // nothing they can act on, and names our internals to anyone watching.
    console.error('Reports Error Boundary caught an error:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title="Reports did not load"
          description="Something went wrong while rendering this page. Reloading usually clears it; if it does not, the detail is in the browser console."
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }

    return this.props.children;
  }
}
