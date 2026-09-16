import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PipPage } from "./pages/Pip";
import "./theme.css";

const pip = window.location.hash.replace(/^#/, "") === "/pip";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{pip ? <PipPage /> : <App />}</React.StrictMode>
);
