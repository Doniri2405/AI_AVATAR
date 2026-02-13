import React from "react";
import "./face.css";

const Face = ({ mode, mouthScale = 0 }) => {
  return (
    <div className={`aegis-head ${mode}`}>
      <div className="face-plate">
        {/* Eyes Section */}
        <div className="eyes-container">
          <div className="eye-socket left">
            <div className="pupil"></div>
            <div className="eye-glow"></div>
          </div>
          <div className="eye-socket right">
            <div className="pupil"></div>
            <div className="eye-glow"></div>
          </div>
        </div>

        {/* Centered Mouth Area */}
        <div className="mouth-area">
          <div 
            className="mouth-bar" 
            style={{ 
              height: mode === "speaking" ? `${10 + (mouthScale * 45)}px` : "8px",
              width: mode === "speaking" ? `${60 - (mouthScale * 10)}px` : "50px",
              borderRadius: mode === "idle" ? "0 0 50px 50px" : "20px"
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default Face;