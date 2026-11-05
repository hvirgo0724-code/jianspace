import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen" role="alert">
          <span className="eyebrow">UNEXPECTED ERROR</span>
          <h1>页面出现异常</h1>
          <p>
            当前操作没有完成，已保存的项目数据不受影响。刷新页面后可继续；若问题重复出现，请记录当前页面与操作步骤。
          </p>
          <div className="crash-actions">
            <button className="button primary" onClick={() => window.location.reload()}>
              刷新页面
            </button>
            <Link className="button outline" to="/projects" onClick={() => this.setState({ error: null })}>
              返回项目工作台
            </Link>
          </div>
          <details>
            <summary>技术信息</summary>
            <code>{this.state.error.message}</code>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
