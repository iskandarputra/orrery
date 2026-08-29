export function AboutSection(): React.JSX.Element {
  return (
    <>
      <h3 className="set-group">orrery</h3>
      <div className="about-hero">
        <div className="about-hero__badge">v0.1.0</div>
        <p className="set-note" style={{ margin: 0 }}>
          High-performance, feature-rich markdown editor and knowledge base with interactive live
          preview.
          <br />
          Crafted with Electron, React, and CodeMirror 6.
        </p>
      </div>
      <div className="about-links">
        <span className="about-links__tag">MIT License</span>
        <span className="about-links__tag">Offline First</span>
        <span className="about-links__tag">Local Storage</span>
      </div>
    </>
  )
}
