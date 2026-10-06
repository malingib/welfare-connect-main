import React, { ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { logSystemEvent } from '@/lib/systemLog';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * Global Error Boundary Component
 * 
 * Catches React errors anywhere in the component tree and displays
 * a user-friendly error message instead of a blank screen.
 * 
 * Usage:
 * <ErrorBoundary>
 *   <App />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console for debugging
    console.error('Error caught by boundary:', error);
    console.error('Error info:', errorInfo);
    
    // Update state with error details
    this.setState({
      errorInfo,
    });

    // Log to audit trail if possible
    try {
      const user = localStorage.getItem('currentUser');
      console.error('User when error occurred:', user);
      void logSystemEvent({
        action: 'UI_ERROR_BOUNDARY_TRIGGERED',
        tableName: 'system',
        status: 'error',
        metadata: {
          message: error?.message || 'Unknown error',
          stack: error?.stack || null,
          component_stack: errorInfo?.componentStack || null,
          user: user ? JSON.parse(user) : null,
          path: typeof window !== 'undefined' ? window.location.pathname : null,
        },
      });
    } catch (e) {
      // Ignore
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(
          this.state.error || new Error('Unknown error'),
          this.handleReset
        );
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md shadow-xl border-red-200">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertCircle className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <CardTitle className="text-red-900">
                    Oops! Something went wrong
                  </CardTitle>
                  <CardDescription className="text-red-700">
                    An unexpected error has occurred
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {this.state.error && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-700">Error Details:</p>
                  <div className="bg-gray-100 p-3 rounded-md border border-gray-300">
                    <p className="text-sm text-gray-700 font-mono break-words">
                      {this.state.error.message || 'An unknown error occurred'}
                    </p>
                  </div>
                </div>
              )}

              {import.meta.env.DEV && this.state.errorInfo && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-gray-600 hover:text-gray-900">
                    Technical Details (Development Only)
                  </summary>
                  <div className="mt-2 bg-gray-100 p-2 rounded border border-gray-300 max-h-48 overflow-y-auto">
                    <pre className="text-gray-700 whitespace-pre-wrap break-words">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </div>
                </details>
              )}

              <p className="text-sm text-gray-600">
                Please try one of the following:
              </p>
              <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
                <li>Try refreshing the page</li>
                <li>Clear your browser cache</li>
                <li>Contact support if the problem persists</li>
              </ul>

              <div className="flex gap-2 pt-4">
                <Button
                  onClick={this.handleReset}
                  variant="outline"
                  className="flex-1"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                >
                  <Home className="h-4 w-4 mr-2" />
                  Go Home
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
