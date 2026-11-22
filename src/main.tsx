import React from "react";
import ReactDOM from "react-dom/client";
import "@/ui/styles";
import "@/app/shell.css";
import "@/app/theme";
import App from "@/app/App";

if (new URLSearchParams(location.search).has("still")) document.documentElement.classList.add("still");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
