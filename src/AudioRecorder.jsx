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
        ffmpeg.FS("writeFile", `${filename}.webm`, uint8Array);
        chunkQueueRef.current.push({ filename, blob });
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

  const getWebmDuration = async (blob) => {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const str = new TextDecoder().decode(bytes);
    const timecodes = [...str.matchAll(/\x2A\xD7\xB1.*?(\x44\x89.{3})/gs)];
    if (timecodes.length < 2) return 5;
    const extractTime = (entry) => {
      const match = entry[1].match(/.{2}/g);
      if (!match) return 0;
      const view = new DataView(
        new Uint8Array(match.map((h) => parseInt(h, 16))).buffer
      );
      return view.getUint32(0) / 1000;
    };
    const duration = extractTime(timecodes[timecodes.length - 1]);
    return Math.max(duration, 0.5);
  };

  const processQueue = async () => {
    if (processingRef.current || !ready || chunkQueueRef.current.length === 0)
      return;
    processingRef.current = true;

    const { filename, blob } = chunkQueueRef.current.shift();

    try {
      const duration = await getWebmDuration(blob);
      console.info(`⏱️ Detected duration: ${duration.toFixed(3)}s`);

      await ffmpeg.FS(
        "writeFile",
        `${filename}.webm`,
        new Uint8Array(await blob.arrayBuffer())
      );

      await ffmpeg.run(
        "-i",
        `${filename}.webm`,
        "-fflags",
        "+genpts",
        "-reset_timestamps",
        "1",
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
          "x-duration": duration.toFixed(3),
          "Content-Type": "application/octet-stream",
        },
        body: output.buffer,
      });

      if (!res.ok) {
        throw new Error(`Upload failed: ${res.statusText}`);
      }

      console.log(`[UPLOAD] ${filename}.ts uploaded successfully`);
    } catch (err) {
      console.error(`[ERR] Conversion or upload failed:`, err);
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
