// Desktop Interface Logic - public/desktop/desktop.js
// Version: 1.1.0
// Last Updated: 2025-05-16
// Changes: Fixed audio playback and improved error handling
console.log('Desktop interface initializing... Version: 1.1.0');

document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const tuningKnob = document.getElementById('tuning-knob');
  const currentFrequencyDisplay = document.getElementById('current-frequency');
  const volumeControl = document.getElementById('volume');
  const statusElement = document.getElementById('status');
  const pairingCodeElement = document.getElementById('pairing-code');
  const messagesElement = document.getElementById('messages');
  const staticAudio = document.getElementById('static-audio');
  const signalStrength = document.getElementById('signal-strength');
  const signalBars = signalStrength ? Array.from(signalStrength.children) : [];
  const resetButton = document.getElementById('reset-button');
  const clearButton = document.getElementById('clear-button');
  
  // State
  let rotation = -90; // Start at top (0 degrees)
  let currentFrequency = 87.5; // Starting frequency
  let isDragging = false;
  let lastMouseX = 0;
  let isFrequencyActive = false;
  let socket = null;
  let desktopVisualizer = null;
  let lastActiveFrequency = null; // Track last active frequency
  let lastActiveCharacter = null; // Track last active character
  let messageDebounceTimer = null; // For debouncing messages
  let pairingCode = null; // Store pairing code
  
  // Active frequencies that have content
  const activeFrequencies = ['87.5', '89.3', '92.1', '95.7', '98.7', '101.2', '104.3', '107.9', '110.5'];
  
  // Initialize audio context after user interaction
  let audioContext = null;
  let noiseGenerator = null;
  let staticGainNode = null;
  
  function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      createNoiseGenerator();
    }
  }
  
  function createNoiseGenerator() {
    if (!audioContext) return;
    
    try {
      const bufferSize = 2 * audioContext.sampleRate;
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      
      noiseGenerator = audioContext.createBufferSource();
      noiseGenerator.buffer = noiseBuffer;
      noiseGenerator.loop = true;
      
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.1; // Reduced volume
      
      noiseGenerator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      console.log('Continuous static generator initialized');
    } catch (error) {
      console.error('Error initializing noise generator:', error);
    }
  }
  
  // Add click handler to initialize audio
  document.addEventListener('click', function initAudio() {
    if (!audioContext) {
      initAudioContext();
      if (noiseGenerator) {
        noiseGenerator.start();
      }
    }
    document.removeEventListener('click', initAudio);
  }, { once: true });
  
  // Connect to WebSocket server
  function connectSocket() {
    socket = io({
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });
    
    // Add connection monitoring
    socket.on('connect', () => {
      console.log("Socket connected:", socket.id);
      addMessage('SYSTEM', 'Connected to server', 'system');
      
      // Register as desktop client
      socket.emit('register', { type: 'desktop' });
    });
    
    socket.on('connect_error', (error) => {
      console.error("Socket connection error:", error);
      addMessage('SYSTEM', 'Connection error. Please check your network.', 'system');
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log("Reconnection attempt:", attemptNumber);
      addMessage('SYSTEM', `Reconnecting (${attemptNumber}/5)...`, 'system');
    });
    
    socket.on('reconnect', (attemptNumber) => {
      console.log("Reconnected after", attemptNumber, "attempts");
      addMessage('SYSTEM', 'Connection restored', 'system');
      
      // Re-register as desktop client
      socket.emit('register', { type: 'desktop' });
    });
    
    socket.on('disconnect', (reason) => {
      console.log("Socket disconnected:", reason);
      addMessage('SYSTEM', `Disconnected: ${reason}. Try reloading.`, 'system');
    });

    // Enhanced AI response handling
    socket.on('ai_response', (data) => {
      console.log("Received AI response:", data);
      if (data && (data.message || data.text)) {
        addMessage(data.character, data.message || data.text, 'character');
        
        // Play audio if available
        if (data.audioPath) {
          console.log('Playing audio from path:', data.audioPath);
          playGeneratedAudio(data.audioPath);
        } else {
          console.log('No audio path available in response');
        }
      } else {
        console.error("Invalid AI response data:", data);
        addMessage('SYSTEM', 'Received invalid response from server', 'system');
      }
    });
    
    // Add audio message handling
    socket.on('audio_message', (data) => {
      console.log('Received audio message:', data);
      
      if (data.audio) {
        try {
          // Convert base64 to blob
          const byteCharacters = atob(data.audio);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const audioBlob = new Blob([byteArray], { type: 'audio/webm;codecs=opus' });
          
          // Create audio element
          const audio = new Audio(URL.createObjectURL(audioBlob));
          
          // Add radio effect
          if (audioContext) {
            const source = audioContext.createMediaElementSource(audio);
            
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
            
            // Lower static volume during speech
            if (staticGainNode) {
              staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
              staticGainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.2);
            }
            
            // Connect nodes
            source.connect(bandpass);
            bandpass.connect(highpass);
            highpass.connect(lowpass);
            lowpass.connect(distortion);
            distortion.connect(audioContext.destination);
          }
          
          // Play audio
          audio.play().catch(error => {
            console.error('Error playing audio:', error);
            addMessage('SYSTEM', 'Error playing audio transmission', 'system');
          });
          
          // Restore static volume when finished
          audio.onended = function() {
            console.log('Audio playback finished');
            if (staticGainNode) {
              adjustStaticVolume();
            }
          };
          
          // Add message to log
          addMessage('MOBILE', 'Transmission received', 'system');
        } catch (error) {
          console.error('Error processing audio message:', error);
          addMessage('SYSTEM', 'Error processing audio transmission', 'system');
        }
      } else if (data.message) {
        // Handle text message
        addMessage('MOBILE', data.message, 'user');
      }
    });
    
    socket.on('registered', (data) => {
      if (data && data.pairing_code) {
        pairingCode = data.pairing_code;
        const pairingDisplay = document.getElementById('pairing-code-display');
        if (pairingDisplay) {
          pairingDisplay.textContent = `Pairing Code: ${pairingCode}`;
        }
        addMessage('SYSTEM', `Pairing code: ${pairingCode}`, 'system');
      }
    });
    
    socket.on('paired', (data) => {
      if (data && data.success) {
        addMessage('SYSTEM', 'Successfully paired with mobile device', 'system');
      }
    });
    
    socket.on('mobile_disconnected', () => {
      addMessage('SYSTEM', 'Mobile device disconnected', 'system');
    });
    
    socket.on('frequency_active', (data) => {
      console.log("Frequency active event received:", data);
      isFrequencyActive = data.active;
      updateFrequencyDisplay();
      
      if (data.active) {
        console.log("Setting active signal strength");
        updateSignalBars(5); // Full signal when on active frequency
        
        // Update frequency display with active status
        if (currentFrequencyDisplay) {
          currentFrequencyDisplay.textContent = `[ACTIVE] ${currentFrequency.toFixed(1)}`;
        }
        
        // Add message for active frequency discovery
        if (data.character && data.location) {
          addMessage('SYSTEM', `Discovered ${data.character} at ${data.location}`, 'system');
        }
        
        // Update last active tracking
        lastActiveFrequency = currentFrequency.toFixed(1);
        lastActiveCharacter = data.character;
      } else {
        console.log("Setting inactive signal strength");
        // Calculate signal strength based on proximity to active frequencies
        let minDistance = 100;
        for (const freq of activeFrequencies) {
          const distance = Math.abs(currentFrequency - parseFloat(freq));
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
        
        // Map distance to signal strength (0-4)
        let signalStrength = 0;
        if (minDistance < 0.1) signalStrength = 4;
        else if (minDistance < 0.3) signalStrength = 3;
        else if (minDistance < 0.7) signalStrength = 2;
        else if (minDistance < 1.5) signalStrength = 1;
        
        updateSignalBars(signalStrength);
        
        // Update frequency display without active status
        if (currentFrequencyDisplay) {
          currentFrequencyDisplay.textContent = currentFrequency.toFixed(1);
        }
      }
    });
    
    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      addMessage('SYSTEM', `Error: ${error.message || 'Unknown error'}`, 'system');
    });
  }
  
  // Create distortion curve for radio effect
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
  
  // Update the frequency display
  function updateFrequencyDisplay() {
    // Always format to one decimal place for display
    currentFrequencyDisplay.textContent = currentFrequency.toFixed(1);
    
    // Visual feedback for active frequency
    if (isFrequencyActive) {
      currentFrequencyDisplay.classList.add('frequency-active');
    } else {
      currentFrequencyDisplay.classList.remove('frequency-active');
    }
    
    // Adjust static volume
    adjustStaticVolume();
  }
  
  // Update signal bars based on signal strength (0-5)
  function updateSignalBars(signalStrength = 0) {
    console.log(`Frequency: ${currentFrequency.toFixed(1)}, Signal strength: ${signalStrength}`);
    
    // Update the visual signal bars
    signalBars.forEach((bar, index) => {
      if (index < signalStrength) {
        bar.classList.add('active');
      } else {
        bar.classList.remove('active');
      }
    });
  }
  
  // Adjust static volume based on proximity to active frequency
  function adjustStaticVolume() {
    if (!staticGainNode || !audioContext) return;
    
    // Find distance to nearest active frequency
    let minDistance = 20; // Initialize with a large value
    
    for (const freq of activeFrequencies) {
      const distance = Math.abs(currentFrequency - freq);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    
    // Static gets quieter as we get closer to an active frequency
    let staticVolume;
    if (isFrequencyActive) {
      staticVolume = 0.1; // Very quiet when on active frequency
    } else {
      // Scale from 0.3 to 1.0 based on distance
      staticVolume = 0.3 + (0.7 * Math.min(minDistance * 5, 1.0));
    }
    
    // Apply volume with a smooth transition
    staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
    staticGainNode.gain.linearRampToValueAtTime(
      staticVolume * (volumeControl.value / 100), 
      audioContext.currentTime + 0.2
    );
  }
  
  // Add message to the message log with filtering and debouncing
  function addMessage(sender, content, type = 'system') {
    // Clear any existing debounce timer
    if (messageDebounceTimer) {
      clearTimeout(messageDebounceTimer);
    }

    // Filter out routine frequency change messages
    if (type === 'system' && content.includes('Only static on frequency')) {
      return; // Skip static frequency messages
    }

    // For active frequency messages, check if it's a duplicate
    if (type === 'system' && content.startsWith('Discovered')) {
      const frequency = currentFrequency.toFixed(1);
      const character = content.split(' ')[1]; // Extract character name
      
      // If this is the same frequency and character as last time, skip it
      if (frequency === lastActiveFrequency && character === lastActiveCharacter) {
        return;
      }
      
      // Update last active tracking
      lastActiveFrequency = frequency;
      lastActiveCharacter = character;
    }
    
    // Debounce the message display
    messageDebounceTimer = setTimeout(() => {
      const messageElement = document.createElement('div');
      messageElement.className = `message ${type}`;
      
      const headerElement = document.createElement('div');
      headerElement.className = 'message-header';
      headerElement.textContent = sender;
      
      const contentElement = document.createElement('div');
      contentElement.className = 'message-content';
      contentElement.textContent = content;
      
      messageElement.appendChild(headerElement);
      messageElement.appendChild(contentElement);
      
      messagesElement.appendChild(messageElement);
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }, 100); // 100ms debounce
  }
  
  // Add a finding to the findings list
  function addFinding(character, frequency, location, info) {
    const findingsElement = document.getElementById('findings');
    
    // Check if this finding already exists
    const existingFindings = findingsElement.querySelectorAll('.finding');
    for (const finding of existingFindings) {
      if (finding.dataset.frequency === frequency.toString()) {
        return; // Skip if already exists
      }
    }
    
    const findingElement = document.createElement('div');
    findingElement.className = 'finding';
    findingElement.dataset.frequency = frequency;
    findingElement.textContent = `${frequency} MHz: ${character}`;
    
    findingsElement.appendChild(findingElement);
  }
  
  // Create a display element if it doesn't exist
  function createDisplayElement(className) {
    // First check if element already exists
    const existingElement = document.querySelector(`.${className}`);
    if (existingElement) {
      return existingElement;
    }

    // Create the element
    const element = document.createElement('div');
    element.className = className;

    // Get or create the frequency-info container
    let frequencyInfo = document.querySelector('.frequency-info');
    if (!frequencyInfo) {
      frequencyInfo = document.createElement('div');
      frequencyInfo.className = 'frequency-info';
      const displayPanel = document.querySelector('.display-panel');
      if (displayPanel) {
        // Insert after the frequency display but before the signal strength
        const frequencyDisplay = displayPanel.querySelector('.frequency-display');
        const signalStrength = displayPanel.querySelector('.signal-strength');
        if (frequencyDisplay && signalStrength) {
          displayPanel.insertBefore(frequencyInfo, signalStrength);
        } else {
          displayPanel.appendChild(frequencyInfo);
        }
      }
    }

    // Append the new element to the frequency-info container
    if (frequencyInfo) {
      frequencyInfo.appendChild(element);
    }

    return element;
  }
  
  // Update narrative progress display
  function updateNarrativeProgress(progress, context) {
    // Could implement a progress bar or other visual indicator
    console.log(`Narrative progress: ${progress}%, Context: ${context}`);
  }
  
  // Set up desktop audio visualizer
  function setupDesktopVisualizer() {
    const canvas = document.getElementById('visualizer');
    if (!canvas || !audioContext) return null;
    
    const canvasCtx = canvas.getContext('2d');
    
    // Create analyzer node
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Connect to audio context destination
    analyser.connect(audioContext.destination);
    
    // Function to draw the visualizer
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
        
        // Color based on frequency and whether we're on an active frequency
        const hue = isFrequencyActive ? 200 : 120; // Blue for active, green for inactive
        const saturation = 70;
        const lightness = 50;
        
        canvasCtx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
      
      requestAnimationFrame(draw);
    }
    
    // Start drawing
    draw();
    
    return {
      analyser,
      dataArray,
      bufferLength
    };
  }
  
  // Function to play generated audio from server
  function playGeneratedAudio(audioPath) {
    try {
      // Create audio element
      const audio = new Audio(audioPath);
      
      // Add radio effect if audio context is available
      if (audioContext) {
        // Resume audio context if suspended
        if (audioContext.state === 'suspended') {
          audioContext.resume();
        }
        
        const source = audioContext.createMediaElementSource(audio);
        
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
        
        // Connect to visualizer if available
        if (desktopVisualizer && desktopVisualizer.analyser) {
          source.connect(desktopVisualizer.analyser);
        }
        
        // Lower static volume during speech
        if (staticGainNode) {
          staticGainNode.gain.setValueAtTime(staticGainNode.gain.value, audioContext.currentTime);
          staticGainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.2);
        }
        
        // Connect nodes
        source.connect(bandpass);
        bandpass.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(distortion);
        distortion.connect(audioContext.destination);
      }
      
      // Play audio
      audio.play().catch(error => {
        console.error('Error playing audio:', error);
        addMessage('SYSTEM', 'Error playing audio response', 'system');
      });
      
      // Restore static volume when finished
      audio.onended = function() {
        console.log('Audio playback finished');
        if (staticGainNode) {
          adjustStaticVolume();
        }
      };
      
      return true;
    } catch (error) {
      console.error('Error playing generated audio:', error);
      addMessage('SYSTEM', 'Error playing audio response', 'system');
      return false;
    }
  }
  
  // Initialize tuning knob interaction
  function initTuningKnob() {
    let lastEmitTime = 0;
    const emitInterval = 100; // Minimum time between emit events in ms

    // Generate dial marks
    const dialMarks = document.getElementById('dial-marks');
    if (dialMarks) {
      // Clear any existing marks
      dialMarks.innerHTML = '';
      
      // Generate 36 marks (every 10 degrees)
      for (let i = 0; i < 36; i++) {
        const mark = document.createElement('div');
        mark.className = 'dial-mark';
        // Make every 3rd mark a major mark (every 30 degrees)
        if (i % 3 === 0) {
          mark.classList.add('major');
        }
        mark.style.transform = `rotate(${i * 10}deg)`;
        dialMarks.appendChild(mark);
      }
    }

    // Set initial knob position
    tuningKnob.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

    // Mouse events
    tuningKnob.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      lastMouseX = e.clientX;
      document.body.style.cursor = 'grabbing';
      tuningKnob.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - lastMouseX;
      lastMouseX = e.clientX;
      
      // Update rotation
      rotation += deltaX;
      tuningKnob.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      
      // Update frequency (87.5 - 108.0 MHz)
      const frequencyRange = 108.0 - 87.5;
      const rotationRange = 360; // One full rotation
      const frequencyChange = (deltaX / rotationRange) * frequencyRange;
      
      currentFrequency = Math.max(87.5, Math.min(108.0, currentFrequency + frequencyChange));
      
      // Update display
      updateFrequencyDisplay();
      
      // Throttle emit events
      const now = Date.now();
      if (now - lastEmitTime >= emitInterval) {
        if (socket && socket.connected) {
          socket.emit('tune', { frequency: currentFrequency.toFixed(1) });
          lastEmitTime = now;
        }
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = 'default';
        tuningKnob.style.cursor = 'grab';
      }
    });
    
    // Touch events for mobile
    tuningKnob.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isDragging = true;
      lastMouseX = e.touches[0].clientX;
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.touches[0].clientX - lastMouseX;
      lastMouseX = e.touches[0].clientX;
      
      // Update rotation
      rotation += deltaX;
      tuningKnob.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
      
      // Update frequency (87.5 - 108.0 MHz)
      const frequencyRange = 108.0 - 87.5;
      const rotationRange = 360; // One full rotation
      const frequencyChange = (deltaX / rotationRange) * frequencyRange;
      
      currentFrequency = Math.max(87.5, Math.min(108.0, currentFrequency + frequencyChange));
      
      // Update display
      updateFrequencyDisplay();
      
      // Prevent default to avoid page scrolling
      e.preventDefault();
    }, { passive: false });
    
    document.addEventListener('touchend', () => {
      isDragging = false;
    });
    
    // Prevent context menu on long press
    tuningKnob.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }
  
  // Initialize control buttons
  function initControlButtons() {
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        currentFrequency = 87.5;
        rotation = -90;
        tuningKnob.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
        updateFrequencyDisplay();
        if (socket && socket.connected) {
          socket.emit('tune', { frequency: currentFrequency.toFixed(1) });
        }
        addMessage('SYSTEM', 'Radio reset to 87.5 MHz', 'system');
      });
    }
    
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        if (messagesElement) {
          messagesElement.innerHTML = '';
          addMessage('SYSTEM', 'Message log cleared', 'system');
        }
      });
    }
  }
  
  // Initialize the application
  function init() {
    console.log('Desktop interface initializing... Version: 1.1.0');
    
    // Initialize socket connection
    connectSocket();
    
    // Initialize tuning knob
    initTuningKnob();
    
    // Initialize control buttons
    initControlButtons();
    
    // Add initial message
    addMessage('SYSTEM', 'Radio interface initialized. Click anywhere to start audio.');
  }
  
  // Start the application
  init();
});
