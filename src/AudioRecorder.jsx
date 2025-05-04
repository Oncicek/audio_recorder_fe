// AudioRecorder.jsx
import React, { useEffect, useRef, useState } from "react";
import { createFFmpeg } from "@ffmpeg/ffmpeg";

const ffmpeg = createFFmpeg({ log: true });

export default function AudioRecorder() {
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const recordingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);
  const chunkQueueRef = useRef([]);
  const processingRef = useRef(false);
  const segmentIndexRef = useRef(0);
  const segmentsRef = useRef([]);
  const mediaSequenceRef = useRef(0);

  useEffect(() => {
    (async () => {
      if (!ffmpeg.isLoaded()) {
        console.info("[info] use ffmpeg.wasm v0.11.6");
        console.info("[info] load ffmpeg-core");
        await ffmpeg.load();
        console.info("[info] ffmpeg-core loaded");
        setReady(true);
      }
    })();
  }, []);

  const startRecording = async () => {
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    recordingRef.current = true;
    setRecording(true);
    segmentIndexRef.current = 0;
    segmentsRef.current = [];
    mediaSequenceRef.current = 0;
    console.info("🎙️ Recording started");
    startNewSegment();
  };

  const startNewSegment = () => {
    if (!recordingRef.current || !streamRef.current) return;

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: "audio/webm;codecs=opus",
    });
    const index = segmentIndexRef.current++;
    const filename = `chunk_${Date.now()}_${index}`;
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      try {
        console.info(
          `[info] run FS.writeFile ${filename}.webm <${uint8Array.length} bytes binary file>`
        );
        ffmpeg.FS("writeFile", `${filename}.webm`, uint8Array);
        chunkQueueRef.current.push(filename);
        processQueue();
      } catch (err) {
        console.error(`[ERR] Failed to write ${filename}.webm:`, err);
      } finally {
        if (recordingRef.current) {
          startNewSegment();
        }
      }
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, 5000);
  };

  const stopRecording = () => {
    recordingRef.current = false;
    setRecording(false);
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    console.info("⏹️ Recording stopped");
  };

  const processQueue = async () => {
    if (processingRef.current || !ready || chunkQueueRef.current.length === 0)
      return;
    processingRef.current = true;

    const filename = chunkQueueRef.current.shift();

    try {
      console.info(
        `[info] run ffmpeg command: -fflags +igndts -fflags +genpts -avoid_negative_ts make_zero -use_wallclock_as_timestamps 1 -copyts -i ${filename}.webm -c:a aac -b:a 128k -f mpegts ${filename}.ts`
      );

      await ffmpeg.run(
        "-fflags",
        "+igndts",
        "-fflags",
        "+genpts",
        "-avoid_negative_ts",
        "make_zero",
        "-use_wallclock_as_timestamps",
        "1",
        "-copyts",
        "-i",
        `${filename}.webm`,
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        "mpegts",
        `${filename}.ts`
      );

      const output = ffmpeg.FS("readFile", `${filename}.ts`);
      console.log(`[OK] Encoded ${filename}.ts`, output.length);

      const res = await fetch("http://localhost:3000/upload", {
        method: "POST",
        headers: {
          "x-filename": `${filename}.ts`,
          "Content-Type": "application/octet-stream",
        },
        body: output.buffer,
      });

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.statusText}`);
      }

      console.log(`[UPLOAD] ${filename}.ts uploaded successfully`);
    } catch (err) {
      console.error(`[ERR] Conversion or upload failed for ${filename}:`, err);
    } finally {
      try {
        ffmpeg.FS("unlink", `${filename}.webm`);
      } catch {}
      try {
        ffmpeg.FS("unlink", `${filename}.ts`);
      } catch {}
      processingRef.current = false;
      processQueue();
    }
  };

  return (
    <div>
      <h3>Audio Recorder</h3>
      <button
        onClick={recording ? stopRecording : startRecording}
        disabled={!ready}
      >
        {recording ? "Stop" : "Start"} Recording
      </button>
    </div>
  );
}
