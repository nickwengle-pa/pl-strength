import React from 'react';

type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error('ErrorBoundary caught', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontFamily: 'ui-sans-serif, system-ui' }}>
          <h2 style={{ fontWeight: 700, marginBottom: 8 }}>App Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#fee2e2', padding: 12, borderRadius: 8, border: '1px solid #ef4444' }}>
{String(this.state.error.message || this.state.error)}
          </pre>
          <div style={{ marginTop: 8, fontSize: 14, color: '#374151' }}>Check the browser console for stack traces.</div>
        </div>
      );
    }
    return this.props.children;
  }
}
