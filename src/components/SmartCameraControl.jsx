import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box,
  Typography,
  Paper,
  CardContent,
  Card,
} from "@mui/material";
import { Camera } from "@mediapipe/camera_utils";
import gifshot from "gifshot";
import SnapshotPreview from "./SnapshotPreview";
import { getExactAddress, getDeviceType } from "./Helper";
import { useSomething } from "../utils/hooks/useSomething";
import {
  computeClarity,
  computeContrastScore,
  computeLightingScore,
  computeSharpnessScore,
} from "../utils/imageQualityHelpers";
import { initializeMediaPipeModels } from "../utils/mediaipipeInit";
import Snapshots from "./Snapshots";
import VerificationChallenges from "./VerificationChallenges";
import GIFPreview from "./GIFPreview";
import ActionControl from "./ActionControl";
import CameraControl from "./CameraControl";

const SmartCameraControl = ({ blurEnabled = true }) => {
  const videoRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const personCanvasRef = useRef(null);
  const segmentationRef = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraRef = useRef(null);
  const challengeImageCaptureRef = useRef(null);
  const [facingMode, setFacingMode] = useState( getDeviceType() === "mobile" ? "environment" : "user");

  const [blurAmount, setBlurAmount] = useState(12);
  const [brightness, setBrightness] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isReady, setIsReady] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);

  // Snapshot + Preview states
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [qualityScore, setQualityScore] = useState({
    lighting: 0,
    sharpness: 0,
    clarity: 0,
  });

  // GIF creation
  const [gifSrc, setGifSrc] = useState(null);
  const [isCreatingGif, setIsCreatingGif] = useState(false);
  const [cameraQuality, setCameraQuality] = useState("Good");

  // Refs for dynamic values
  const blurRef = useRef(blurAmount);
  const brightnessRef = useRef(brightness);
  const zoomRef = useRef(zoom);
  const aspectRef = useRef(aspectRatio);

  // Function to capture and save image when challenge is completed
  const handleChallengeImageCapture = useCallback(
    (challengeIndex, challengeName) => {
      const canvas = outputCanvasRef.current;
      if (!canvas) return;

      // Capture image from canvas
      const imageData = canvas.toDataURL("image/png");

      // Add to snapshots for display and storage with challenge name
      setSnapshots((prev) => [
        ...prev,
        { image: imageData, challengeName: challengeName || null },
      ]);
    },
    []
  );

  // Update the ref whenever the callback changes
  useEffect(() => {
    challengeImageCaptureRef.current = handleChallengeImageCapture;
  }, [handleChallengeImageCapture]);

  const onChallengeCompleteCallback = useCallback(
    (challengeIndex, challengeName) => {
      if (challengeImageCaptureRef.current) {
        challengeImageCaptureRef.current(challengeIndex, challengeName);
      }
    },
    []
  );

  // useSomething hook
  const {
    isVerifying,
    completedChallenges,
    detectLivenessActions,
    handleStartVerification,
    handleStopVerification,
    isAllVerified,
  } = useSomething(onChallengeCompleteCallback);

  useEffect(() => {
    blurRef.current = blurAmount;
  }, [blurAmount]);
  useEffect(() => {
    brightnessRef.current = brightness;
  }, [brightness]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    aspectRef.current = aspectRatio;
  }, [aspectRatio]);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      const address = await getExactAddress(lat, lon);
      setLocation(address);
    });
  }, []);

  useEffect(() => {
    const clarity = qualityScore.clarity;
    let quality = "Fair";
    
    if (clarity >= 80) {
      quality = "Excellent";
    } else if (clarity >= 60) {
      quality = "Good";
    } else if (clarity >= 40) {
      quality = "Fair";
    } else {
      quality = "Poor";
    }
    
    setCameraQuality(quality);
  }, [qualityScore.clarity]);

  const startCamera = useCallback(
    async (video, mounted, facing = facingMode) => {
      try {
        if (!video) return;
        // Stop current camera if running
        if (cameraRef.current) {
          cameraRef.current.stop();
        }

        cameraRef.current = new Camera(video, {
          onFrame: async () => {
            await segmentationRef.current?.send({ image: video });
            if (isVerifying && faceMeshRef.current) {
              await faceMeshRef.current.send({ image: video });
            }
          },
          width: 1280,
          height: 720,
          facingMode: facing,
        });
        await cameraRef.current.start();
        if (mounted) setIsReady(true);
      } catch (err) {
        console.log("Camera start error:", err);
        setError(
          "Camera access is blocked by your browser. Go to Settings → Site Permissions to enable it."
        );
        setIsReady(false);
      }
    },
    [isVerifying, facingMode]
  );

  useEffect(() => {
    let mounted = true;
    const video = videoRef.current;

    if (!bgCanvasRef.current)
      bgCanvasRef.current = document.createElement("canvas");
    if (!personCanvasRef.current)
      personCanvasRef.current = document.createElement("canvas");

    const bgCanvas = bgCanvasRef.current;
    const personCanvas = personCanvasRef.current;

    const initializeModels = async () => {
      try {
        // Use the centralized MediaPipe initialization utility
        const { segmentation: selfieSegmentation, faceMesh } =
          await initializeMediaPipeModels();

        selfieSegmentation.onResults((results) => {
          if (!mounted || !video || !outputCanvasRef.current) return;

          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return;

          const targetAspect = aspectRef.current;
          let outputW = w;
          let outputH = w / targetAspect;
          if (outputH > h) {
            outputH = h;
            outputW = h * targetAspect;
          }

          const offsetX = (w - outputW) / 2;
          const offsetY = (h - outputH) / 2;

          const outputCanvas = outputCanvasRef.current;
          outputCanvas.width = outputW;
          outputCanvas.height = outputH;

          bgCanvas.width = outputW;
          bgCanvas.height = outputH;
          personCanvas.width = outputW;
          personCanvas.height = outputH;

          const outCtx = outputCanvas.getContext("2d");
          const bgCtx = bgCanvas.getContext("2d");
          const personCtx = personCanvas.getContext("2d");

          const bAmount = blurRef.current;
          const bright = brightnessRef.current;
          const z = zoomRef.current;

          // Crop region to maintain aspect ratio
          const srcX = offsetX;
          const srcY = offsetY;
          const srcW = outputW;
          const srcH = outputH;

          // Background
          bgCtx.save();
          bgCtx.filter = `${
            blurEnabled && bAmount > 0 ? `blur(${bAmount}px)` : ""
          } brightness(${bright})`;
          bgCtx.drawImage(
            results.image,
            srcX,
            srcY,
            srcW,
            srcH,
            0,
            0,
            outputW,
            outputH
          );
          bgCtx.restore();

          // Person
          personCtx.save();
          personCtx.filter = `brightness(${bright})`;
          personCtx.drawImage(
            results.image,
            srcX,
            srcY,
            srcW,
            srcH,
            0,
            0,
            outputW,
            outputH
          );
          personCtx.globalCompositeOperation = "destination-in";
          personCtx.drawImage(
            results.segmentationMask,
            srcX,
            srcY,
            srcW,
            srcH,
            0,
            0,
            outputW,
            outputH
          );
          personCtx.restore();

          // Compose
          outCtx.save();
          outCtx.clearRect(0, 0, outputW, outputH);

          // Flip horizontally to show true camera view
          outCtx.translate(outputW, 0);
          outCtx.scale(-1, 1);

          // Flip horizontally only for front camera to show true camera view
          if (facingMode === "user") {
            outCtx.translate(outputW, 0);
            outCtx.scale(-1, 1);
          }

          // Apply zoom
          outCtx.translate(outputW / 2, outputH / 2);
          outCtx.scale(z, z);
          outCtx.translate(-outputW / 2, -outputH / 2);

          outCtx.drawImage(bgCanvas, 0, 0, outputW, outputH);
          outCtx.drawImage(personCanvas, 0, 0, outputW, outputH);

          // === Quality Scoring ===
          if (blurEnabled && outputCanvasRef.current) {
            try {
              const frame = personCtx.getImageData(0, 0, outputW, outputH);
              // compute robust metrics (fast thanks to downsampling)
              const lighting = computeLightingScore(frame); // 0..100
              const sharpness = computeSharpnessScore(frame); // 0..100 (higher = sharper)
              const contrast = computeContrastScore(frame); // 0..100
              const clarity = computeClarity(lighting, sharpness, contrast);

              setQualityScore({
                lighting,
                sharpness,
                clarity,
              });
            } catch (e) {
              console.log("Quality scoring error:", e);
            }
          }

          outCtx.restore();
        });

        segmentationRef.current = selfieSegmentation;

        faceMesh?.onResults((results) => {
          if (!mounted || !isVerifying) return;

          if (
            results?.multiFaceLandmarks &&
            results?.multiFaceLandmarks?.length > 0
          ) {
            const landmarks = results?.multiFaceLandmarks[0];
            detectLivenessActions(landmarks);
          }
        });

        faceMeshRef.current = faceMesh;
        if (mounted) {
          await startCamera(video, mounted);
        }
      } catch (err) {
        console.error("Model initialization error:", err);
        if (mounted) {
          setError(
            "Failed to initialize camera models. Please refresh the page."
          );
        }
      }
    };

    if (video) {
      initializeModels();
    }

    return () => {
      mounted = false;
      cameraRef.current?.stop();
      cameraRef.current = null;
      segmentationRef.current = null;
      faceMeshRef.current = null;
    };
  }, [
    blurEnabled,
    isVerifying,
    detectLivenessActions,
    startCamera,
    facingMode,
  ]);
  const handleSnapshot = () => {
    const canvas = outputCanvasRef.current;
    if (!canvas) return;
    const imageData = canvas.toDataURL("image/png");
    setPreviewImage(imageData);
    setPreviewOpen(true);
  };

  const switchCamera = useCallback(async () => {
    if (!isReady || !videoRef.current) return;

    try {
      setIsReady(false);
      const newFacingMode = facingMode === "user" ? "environment" : "user";
      setFacingMode(newFacingMode);

      await startCamera(videoRef.current, true, newFacingMode);
    } catch (error) {
      console.error("Error switching camera:", error);
      setError("Failed to switch camera. Please try again.");
    }
  }, [facingMode, isReady, startCamera]);

  const handleKeepSnapshot = () => {
    setSnapshots((prev) => [
      ...prev,
      { image: previewImage, challengeName: null },
    ]);
    setPreviewOpen(false);
    setPreviewImage(null);
  };

  const handleRetakeSnapshot = () => {
    setPreviewOpen(false);
    setPreviewImage(null);
  };

  // ===== GIF CREATION =====
  const createGifFromSnapshots = () => {
    if (snapshots.length < 2) {
      alert("Please capture at least 2 snapshots to create a GIF.");
      return;
    }

    setIsCreatingGif(true);
    // Extract just the image URLs from snapshot objects
    const imageUrls = snapshots.map((snap) => snap.image);
    gifshot.createGIF(
      {
        images: imageUrls,
        gifWidth: 480,
        gifHeight: 480 / aspectRatio,
        interval: 0.5, // frame delay in seconds
        numFrames: snapshots.length,
        frameDuration: 1,
        sampleInterval: 10,
        progressCallback: () => {},
      },
      (obj) => {
        setIsCreatingGif(false);
        if (!obj.error) {
          setGifSrc(obj.image);
        } else {
          console.log("GIF creation failed:", obj.error);
        }
      }
    );
  };

  return (
    <>
      <Card
        elevation={6}
        sx={{
          maxWidth: 650,
          margin: "auto",
          mt: 5,
          borderRadius: 4,
          p: 2,
          background: "#ffffff",
        }}
      >
        <CardContent>
          {/* TITLE */}
          <Typography
            variant="h5"
            align="center"
            sx={{ fontWeight: 700, mb: 3 }}
          >
            Smart Camera
          </Typography>
          <Paper
            elevation={4}
            sx={{
              position: "relative",
              overflow: "hidden",
              borderRadius: 3,
              mb: 3,
            }}
          >
            {error ? (
              <Box mb={2} p={2} bgcolor="#fdecea" borderRadius={1}>
                <Typography color="#b71c1c">{error}</Typography>
              </Box>
            ) : (
              <>
                {/* === Camera View === */}
                <CameraControl
                  videoRef={videoRef}
                  outputCanvasRef={outputCanvasRef}
                  aspectRatio={aspectRatio}
                  isReady={isReady}
                  qualityScore={qualityScore}
                  cameraQuality={cameraQuality}
                />
                {/* === Action Controls === */}
                <ActionControl
                  blurAmount={blurAmount}
                  setBlurAmount={setBlurAmount}
                  brightness={brightness}
                  setBrightness={setBrightness}
                  zoom={zoom}
                  setZoom={setZoom}
                  aspectRatio={aspectRatio}
                  setAspectRatio={setAspectRatio}
                  isReady={isReady}
                  switchCamera={switchCamera}
                  handleSnapshot={handleSnapshot}
                  isVerifying={isVerifying}
                  handleStartVerification={handleStartVerification}
                  handleStopVerification={handleStopVerification}
                />

                {/* === Verification Challenges === */}
                <VerificationChallenges
                  isVerifying={isVerifying}
                  completedChallenges={completedChallenges}
                  isAllVerified={isAllVerified}
                />
                {/* === Snapshots Preview === */}
                <Snapshots
                  snapshots={snapshots}
                  createGifFromSnapshots={createGifFromSnapshots}
                  isCreatingGif={isCreatingGif}
                />

                {/* === Generated GIF Preview === */}
                <GIFPreview gifSrc={gifSrc} />

                {/* Snapshot Preview Dialog */}
                <SnapshotPreview
                  open={previewOpen}
                  imageSrc={previewImage}
                  onKeep={handleKeepSnapshot}
                  onRetake={handleRetakeSnapshot}
                  location={location}
                />
              </>
            )}
          </Paper>
        </CardContent>
      </Card>
    </>
  );
};

export default SmartCameraControl;
