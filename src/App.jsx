import React from "react";
import AudioRecorder from "./AudioRecorder";

export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>Audio Streaming Test UI</h1>
      <AudioRecorder
        uploadUrl={"http://localhost:3000/upload"}
        segmentTime={5}
      />
    </div>
  );
}
