import React from "react";

/** Ловит ошибки рендера панели свойств или холста планировщика. */
export class PlannerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`Planner ${this.props.area || "ui"} render error`, error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      if (this.props.area === "canvas") {
        return (
          <div className="planner-canvas-error" style={{ padding: 24, textAlign: "center", color: "#6b7d74" }}>
            <p><b>Не удалось отобразить план</b></p>
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Попробуйте снять выделение (Esc) или обновить страницу (Ctrl+F5).
            </p>
            <button
              type="button"
              className="planner-btn"
              style={{ marginTop: 12 }}
              onClick={() => this.setState({ error: null })}
            >
              Повторить
            </button>
          </div>
        );
      }
      return (
        <aside className="planner-side planner-side--right no-print">
          <div className="planner-empty-props" style={{ padding: 16 }}>
            <p><b>Не удалось открыть панель</b></p>
            <p style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>
              Попробуйте выбрать объект снова или обновить страницу (Ctrl+F5).
            </p>
            <button
              type="button"
              className="planner-btn"
              onClick={() => this.setState({ error: null })}
            >
              Закрыть
            </button>
          </div>
        </aside>
      );
    }
    return this.props.children;
  }
}

/** @deprecated use PlannerOverlayBoundary */
export const PlannerPanelErrorBoundary = PlannerErrorBoundary;

/** Ловит ошибки только оверлея (размеры, обводка) — холст остаётся видимым. */
export class PlannerOverlayBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Planner overlay render error", error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}
