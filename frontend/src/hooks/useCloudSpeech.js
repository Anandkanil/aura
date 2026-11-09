import { useCallback, useEffect, useRef, useState } from "react";
import { recordingToWavBase64 } from "../lib/audio";

// Voice input that works in any browser with a microphone: records audio,
// notices when the person stops talking, and has Aura's server transcribe it.

const NO_SPEECH_TIMEOUT_MS = 8000;
const PAUSE_TO_STOP_MS = 1300;
const MAX_RECORDING_MS = 60000;

const pickMimeType = () => {
  const options = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  return options.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
};

export const useCloudSpeech = ({ lang = "en-US" } = {}) => {
  const isSupported =
    typeof window !== "undefined" && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);

  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);

  const sessionRef = useRef(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  const teardown = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    cancelAnimationFrame(session.raf);
    session.stream.getTracks().forEach((track) => track.stop());
    session.audioCtx?.close?.();
    sessionRef.current = null;
    setIsListening(false);
  }, []);

  // Stop recording and return the recorded blob (or null).
  const stopRecording = useCallback(
    () =>
      new Promise((resolve) => {
        const session = sessionRef.current;
        if (!session) return resolve(null);
        const { recorder, chunks, mimeType, spoke } = session;
        if (recorder.state === "inactive") {
          teardown();
          return resolve(spoke() ? new Blob(chunks, { type: mimeType || "audio/webm" }) : null);
        }
        recorder.onstop = () => {
          teardown();
          resolve(spoke() ? new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }) : null);
        };
        recorder.stop();
      }),
    [teardown]
  );

  const transcribe = useCallback(async (blob) => {
    if (!blob) return "";
    setIsTranscribing(true);
    try {
      const { base64, seconds } = await recordingToWavBase64(blob);
      if (seconds < 0.3) return "";
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, lang: langRef.current })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Aura couldn't understand the recording. Try again.");
      return (payload?.text || "").trim();
    } catch (err) {
      setError({ code: "transcribe-failed", message: err.message });
      return "";
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  // Stop listening and turn what was said into text.
  const stop = useCallback(async () => transcribe(await stopRecording()), [stopRecording, transcribe]);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.recorder.onstop = null;
    if (session.recorder.state !== "inactive") session.recorder.stop();
    teardown();
  }, [teardown]);

  // onPause is called when the person stops talking (hands-free mode).
  const start = useCallback(
    async ({ onPause } = {}) => {
      if (!isSupported || sessionRef.current) return false;
      setError(null);
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (err) {
        const code = err?.name === "NotAllowedError" || err?.name === "SecurityError" ? "not-allowed" : "audio-capture";
        setError({ code });
        return false;
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };

      // Simple voice activity detection from the microphone level.
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);

      const startedAt = performance.now();
      let noiseFloor = 0.01;
      let calibrated = 0;
      let heardSpeech = false;
      let lastVoiceAt = startedAt;

      const session = { stream, recorder, chunks, mimeType, audioCtx, raf: 0, spoke: () => heardSpeech };
      sessionRef.current = session;

      const tick = () => {
        if (sessionRef.current !== session) return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const now = performance.now();

        if (now - startedAt < 400) {
          noiseFloor = (noiseFloor * calibrated + rms) / (calibrated + 1);
          calibrated += 1;
        } else {
          const threshold = Math.max(0.015, noiseFloor * 3);
          if (rms > threshold) {
            heardSpeech = true;
            lastVoiceAt = now;
          }
          if (!heardSpeech && now - startedAt > NO_SPEECH_TIMEOUT_MS) {
            cancel();
            setError({ code: "silence-timeout" });
            return;
          }
          if (onPause && heardSpeech && now - lastVoiceAt > PAUSE_TO_STOP_MS) {
            onPause();
            return;
          }
          if (now - startedAt > MAX_RECORDING_MS) {
            onPause?.();
            return;
          }
        }
        session.raf = requestAnimationFrame(tick);
      };

      recorder.start(250);
      setIsListening(true);
      session.raf = requestAnimationFrame(tick);
      return true;
    },
    [cancel, isSupported]
  );

  useEffect(() => () => cancel(), [cancel]);

  return { isSupported, isListening, isTranscribing, error, start, stop, cancel };
};
