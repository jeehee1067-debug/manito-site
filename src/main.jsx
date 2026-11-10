import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
// 연말 장식(시즌 한정). 빼려면 아래 두 줄과 <Snow />를 지운다.
import "./xmas.css";
import { Snow } from "./xmas.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Snow />
    <App />
  </React.StrictMode>
);
