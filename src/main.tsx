import React from "react";
import ReactDOM from "react-dom/client";

function App() {
  return <div style={{ padding: 48, fontFamily: "system-ui", color: "#efe6d2", background: "#07080b", minHeight: "100vh" }}>Basis — scaffold</div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
