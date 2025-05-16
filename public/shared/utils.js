// Shared utility functions for both desktop and mobile clients
// Version: 1.1.0
// Last Updated: 2025-05-16

/**
 * Creates an audio visualizer on a canvas element
 * @param {HTMLCanvasElement} canvas - The canvas element to draw on
 * @param {AudioContext} audioContext - The audio context
 * @param {MediaStream|null} stream - Optional media stream to visualize
 * @returns {Object} Visualizer object with methods and properties
 */
function createAudioVisualizer(canvas, audioContext, stream = null) {
  if (!canvas || !audioContext) {
    console.error('Canvas or audio context not provided');
    return null;
  }
  
  const canvasCtx = canvas.getContext('2d');
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  // Connect to audio context destination
  analyser.connect(audioContext.destination);
  
  // If stream is provided, connect it to the analyser
  let source = null;
  if (stream) {
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
  }
  
  // Function to draw the visualizer
  let animationFrame = null;
  function draw() {
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    canvasCtx.clearRect(0, 0, width, height);
    
    // Get frequency data
    analyser.getByteFrequencyData(dataArray);
    
    // Draw frequency bars
    const barWidth = (width / bufferLength) * 2.5;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = dataArray[i] / 255 * height;
      
      // Color based on frequency
      const hue = i / bufferLength * 360;
      canvasCtx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
    
    animationFrame = requestAnimationFrame(draw);
  }
  
  // Start drawing
  draw();
  
  // Return visualizer object
  return {
    analyser,
    dataArray,
    bufferLength,
    start: function() {
      if (!animationFrame) {
        draw();
      }
    },
    stop: function() {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    },
    connectSource: function(newSource) {
      if (source) {
        source.disconnect();
      }
      source = newSource;
      source.connect(analyser);
    }
  };
}

/**
 * Creates a radio static effect for audio
 * @param {AudioContext} audioContext - The audio context
 * @param {number} volume - Initial volume (0-1)
 * @returns {Object} Static generator object with methods and properties
 */
function createRadioStatic(audioContext, volume = 0.5) {
  if (!audioContext) {
    console.error('Audio context not provided');
    return null;
  }
  
  // Create a buffer for noise
  const bufferSize = 2 * audioContext.sampleRate;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  
  // Fill the buffer with noise
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  
  // Create a buffer source node
  const whiteNoise = audioContext.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;
  
  // Create filter to shape noise into more "radio static" sound
  const staticFilterNode = audioContext.createBiquadFilter();
  staticFilterNode.type = 'bandpass';
  staticFilterNode.frequency.value = 1000;
  staticFilterNode.Q.value = 0.5;
  
  // Create gain node for volume control
  const staticGainNode = audioContext.createGain();
  staticGainNode.gain.value = volume;
  
  // Connect nodes
  whiteNoise.connect(staticFilterNode);
  staticFilterNode.connect(staticGainNode);
  staticGainNode.connect(audioContext.destination);
  
  // Start the noise
  whiteNoise.start();
  
  // Return static generator object
  return {
    whiteNoise,
    staticFilterNode,
    staticGainNode,
    setVolume: function(newVolume) {
      staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
      staticGainNode.gain.linearRampToValueAtTime(newVolume, audioContext.currentTime + 0.1);
    },
    setFrequency: function(frequency) {
      staticFilterNode.frequency.setValueAtTime(staticFilterNode.frequency.value, audioContext.currentTime);
      staticFilterNode.frequency.linearRampToValueAtTime(frequency, audioContext.currentTime + 0.1);
    },
    setQ: function(q) {
      staticFilterNode.Q.setValueAtTime(staticFilterNode.Q.value, audioContext.currentTime);
      staticFilterNode.Q.linearRampToValueAtTime(q, audioContext.currentTime + 0.1);
    },
    stop: function() {
      whiteNoise.stop();
    }
  };
}

/**
 * Applies radio effect to an audio element
 * @param {HTMLAudioElement} audioElement - The audio element
 * @param {AudioContext} audioContext - The audio context
 * @returns {Object} Audio processing chain
 */
function applyRadioEffect(audioElement, audioContext) {
  if (!audioElement || !audioContext) {
    console.error('Audio element or context not provided');
    return null;
  }
  
  // Create source from audio element
  const source = audioContext.createMediaElementSource(audioElement);
  
  // Create radio effect filter chain
  const bandpass = audioContext.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 1800;
  bandpass.Q.value = 0.7;
  
  const highpass = audioContext.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 500;
  
  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 2500;
  
  // Create distortion for radio "crunch"
  const distortion = audioContext.createWaveShaper();
  distortion.curve = createDistortionCurve(20);
  distortion.oversample = "4x";
  
  // Connect nodes
  source.connect(bandpass);
  bandpass.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(distortion);
  distortion.connect(audioContext.destination);
  
  // Return processing chain
  return {
    source,
    bandpass,
    highpass,
    lowpass,
    distortion
  };
}

/**
 * Creates a distortion curve for audio effects
 * @param {number} amount - Amount of distortion
 * @returns {Float32Array} Distortion curve
 */
function createDistortionCurve(amount) {
  const k = typeof amount === 'number' ? amount : 50;
  const n_samples = 44100;
  const curve = new Float32Array(n_samples);
  const deg = Math.PI / 180;
  
  for (let i = 0; i < n_samples; ++i) {
    const x = i * 2 / n_samples - 1;
    curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
  }
  
  return curve;
}

/**
 * Formats a timestamp into a readable time string
 * @param {number} timestamp - Timestamp in milliseconds
 * @returns {string} Formatted time string
 */
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  
  return `${hours}:${minutes}:${seconds}`;
}

// Export utilities if in a module environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createAudioVisualizer,
    createRadioStatic,
    applyRadioEffect,
    createDistortionCurve,
    formatTimestamp
  };
}
