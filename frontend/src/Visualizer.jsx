import React from "react";
import "./style.css";

const Visualizer = ({ mode }) => {
  return (
    <div className={`ai-core ${mode}`}>
      <div className="ring outer"></div>
      <div className="ring middle"></div>
      <div className="ring inner"></div>
      <div className="core-dot"></div>
    </div>
  );
};

export default Visualizer;