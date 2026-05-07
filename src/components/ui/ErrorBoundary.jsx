import React from 'react';

class ErrorBoundary extends React.Component {
 constructor(props) {
 super(props);
 this.state = { hasError: false, error: null, errorInfo: null };
 }

 static getDerivedStateFromError(error) {
 return { hasError: true, error };
 }

 componentDidCatch(error, errorInfo) {
 console.error('ErrorBoundary caught:', error, errorInfo);
 this.setState({ errorInfo });
 }

 render() {
 if (this.state.hasError) {
 return (
 <div style={{ padding: 20, color: 'var(--color-accent)', background: 'var(--color-bg-1)', border: '1px solid var(--color-line-s)', borderRadius: 8, margin: 20, fontFamily: "'JetBrains Mono', monospace" }}>
 <h2 style={{ color: 'var(--color-fg-1)', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em' }}>[ERROR] Application Error</h2>
 {import.meta.env.DEV ? (
 <>
 <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 12 }}>
 {this.state.error?.toString()}
 </pre>
 <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--color-fg-4)', marginTop: 10 }}>
 {this.state.errorInfo?.componentStack}
 </pre>
 </>
 ) : (
 <p style={{ color: 'var(--color-fg-3)', fontSize: 14, marginTop: 12 }}>Ha ocurrido un error inesperado. Por favor, recarga la página.</p>
 )}
 <button
 onClick={() => window.location.reload()}
 style={{ marginTop: 16, padding: '12px 24px', background: 'var(--color-fg-1)', color: 'var(--color-bg-0)', border: 'none', borderRadius: 999, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em' }}
 >
 Reintentar
 </button>
 </div>
 );
 }
 return this.props.children;
 }
}

export default ErrorBoundary;
