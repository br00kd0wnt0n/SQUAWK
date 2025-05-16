// Mobile Interface Logic - public/mobile/mobile.js
// Version: 1.1.0
// Last Updated: 2025-05-16
// Changes: Fixed speech recognition, improved error handling, and added message processing acknowledgment
console.log('Mobile interface initializing... Version: 1.1.0');

document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const statusElement = document.querySelector('.status');
  const pairingCodeInput = document.getElementById('pairing-code');
  const pairButton = document.getElementById('pair-button');
  const pushToTalkButton = document.getElementById('push-to-talk');
  const activeFrequencyElement = document.querySelector('.active-frequency');
  const messagesElement = document.getElementById('messages');
  const staticAudio = document.getElementById('static-audio');
  
  // State
  let socket = null;
  let isPaired = false;
  let isFrequencyActive = false;
  let currentCharacter = null;
  let isTransmitting = false;
  let audioContext = null;
  let staticGainNode = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let speechRecognition = null;
  let buttonSoundGainNode = null;
  let recognitionTimeout = null;
  let audioAnalyser = null;
  let visualizerCanvas = null;
  let visualizerContext = null;
  let visualizerData = null;
  let currentStream = null;
  let currentMediaRecorder = null;
  let visualizerAnimationFrame = null;
  let currentProcessor = null;
  let currentSource = null;
  let currentAudioContext = null;
  let currentAudioChunks = [];
  let currentFrequency = null;
  let isProcessingMessage = false;  // Flag to prevent duplicate messages
  let processingTimeout = null;     // Timeout to reset processing flag
  
  // Initialize audio context immediately
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log('Audio context initialized');
    
    // Create gain node for button sounds
    buttonSoundGainNode = audioContext.createGain();
    buttonSoundGainNode.gain.value = 0.3;
    buttonSoundGainNode.connect(audioContext.destination);
  } catch (error) {
    console.error('Failed to initialize audio context:', error);
    addMessage('SYSTEM', 'Audio initialization failed. Some features may not work.', 'system');
  }

  // Initialize speech recognition immediately
  function initSpeechRecognition() {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      console.log('Speech recognition not supported');
      addMessage('SYSTEM', 'Speech recognition not supported in this browser. Please try Chrome or Edge.', 'system');
      return false;
    }

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      speechRecognition = new SpeechRecognition();
      speechRecognition.continuous = false;
      speechRecognition.interimResults = true;
      speechRecognition.maxAlternatives = 3;
      speechRecognition.lang = 'en-US';

      speechRecognition.onstart = function() {
        console.log('Speech recognition started');
        const speechStatus = document.querySelector('.speech-status');
        if (speechStatus) {
          speechStatus.textContent = 'Listening...';
          speechStatus.classList.add('active');
          speechStatus.classList.remove('error');
        }
      };

      speechRecognition.onresult = function(event) {
        console.log('Speech recognition result:', event);
        const speechText = document.querySelector('.speech-text');
        if (!speechText) return;

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        // Always update the display with interim results
        if (interimTranscript) {
          speechText.innerHTML = `<span class="interim">${interimTranscript}</span>`;
        }

        // Update with final results and add to message feed
        if (finalTranscript) {
          speechText.textContent = finalTranscript;
          if (finalTranscript.trim() !== '' && socket && socket.connected && !isProcessingMessage) {
            console.log('Sending text message:', finalTranscript);
            addMessage('YOU', finalTranscript, 'user');
            // Send text message with proper format
            sendTextMessage(finalTranscript);
          }
        }
      };

      speechRecognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        const speechStatus = document.querySelector('.speech-status');
        if (speechStatus) {
          speechStatus.textContent = `Error: ${event.error}`;
          speechStatus.classList.remove('active');
          speechStatus.classList.add('error');
        }
        
        // Attempt recovery based on error type
        switch(event.error) {
          case 'network':
            // Network error - try again after a delay
            setTimeout(() => {
              if (isTransmitting) {
                console.log('Attempting to restart speech recognition after network error');
                try {
                  speechRecognition.start();
                } catch (e) {
                  console.error('Failed to restart speech recognition:', e);
                  fallbackToTextInput();
                }
              }
            }, 2000);
            break;
            
          case 'not-allowed':
          case 'service-not-allowed':
            // Permission issues - fall back to text input
            console.log('Microphone permission denied, falling back to text input');
            fallbackToTextInput();
            break;
            
          case 'aborted':
            // User aborted - no action needed
            break;
            
          default:
            // For other errors, try once more then fall back
            if (isTransmitting) {
              console.log('Attempting to restart speech recognition after error');
              try {
                speechRecognition.start();
              } catch (e) {
                console.error('Failed to restart speech recognition:', e);
                fallbackToTextInput();
              }
            }
        }
      };

      speechRecognition.onend = function() {
        console.log('Speech recognition ended');
        if (!isTransmitting) {
          const speechStatus = document.querySelector('.speech-status');
          if (speechStatus) {
            speechStatus.textContent = 'Ready';
            speechStatus.classList.remove('active', 'error');
          }
        }
      };

      console.log('Speech recognition initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize speech recognition:', error);
      addMessage('SYSTEM', 'Speech recognition initialization failed. Please try another browser.', 'system');
      return false;
    }
  }

  // Initialize speech recognition immediately
  initSpeechRecognition();

  // Request microphone permissions proactively
  async function requestMicrophonePermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone permission granted');
      stream.getTracks().forEach(track => track.stop()); // Stop the stream after getting permission
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);
      addMessage('SYSTEM', 'Microphone access denied. Voice input will not work.', 'system');
      return false;
    }
  }

  // Request microphone permission immediately
  requestMicrophonePermission();

  // Fallback to text input when speech recognition fails
  function fallbackToTextInput() {
    console.log('Falling back to text input mode');
    
    // Show text input UI
    const speechDisplay = document.querySelector('.speech-display');
    if (speechDisplay) {
      speechDisplay.innerHTML = `
        <div class="fallback-input">
          <input type="text" id="fallback-text" placeholder="Type your message..." class="fallback-text-input">
          <button id="fallback-send">Send</button>
        </div>
        <div class="speech-status error">Speech recognition unavailable. Using text input.</div>
      `;
      
      // Set up event listeners for the fallback input
      const fallbackInput = document.getElementById('fallback-text');
      const fallbackSend = document.getElementById('fallback-send');
      
      if (fallbackInput && fallbackSend) {
        fallbackSend.addEventListener('click', () => {
          const text = fallbackInput.value.trim();
          if (text && socket && socket.connected) {
            sendTextMessage(text);
            fallbackInput.value = '';
          }
        });
        
        fallbackInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            const text = fallbackInput.value.trim();
            if (text && socket && socket.connected) {
              sendTextMessage(text);
              fallbackInput.value = '';
            }
          }
        });
        
        // Focus the input
        fallbackInput.focus();
      }
    }
  }

  // Helper function to send text messages
  function sendTextMessage(text) {
    if (!text || !socket || !socket.connected || isProcessingMessage) return;
    
    console.log('Sending text message:', text);
    addMessage('YOU', text, 'user');
    
    isProcessingMessage = true;
    
    // Set timeout to reset processing flag if no response
    processingTimeout = setTimeout(() => {
      console.log('Message processing timeout - resetting flag');
      isProcessingMessage = false;
    }, 10000); // 10 second timeout
    
    socket.emit('audio_message', {
      message: text,
      type: 'text',
      frequency: currentFrequency || 'unknown',
      timestamp: Date.now()
    });
  }

  // Update push-to-talk button setup
  async function setupPushToTalk() {
    console.log('Setting up push-to-talk button');
    
    // Prevent any default touch behaviors on the button
    pushToTalkButton.style.touchAction = 'none';
    pushToTalkButton.style.webkitTouchCallout = 'none';
    pushToTalkButton.style.webkitUserSelect = 'none';
    pushToTalkButton.style.userSelect = 'none';
    
    // Touch events for mobile
    pushToTalkButton.addEventListener('touchstart', async (e) => {
      e.preventDefault();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await startTransmitting(e, stream);
      } catch (error) {
        console.error('Failed to get audio stream:', error);
        addMessage('SYSTEM', 'Failed to access microphone: ' + error.message, 'system');
        fallbackToTextInput();
      }
    }, { passive: false });

    pushToTalkButton.addEventListener('touchend', stopTransmitting);
    pushToTalkButton.addEventListener('touchcancel', stopTransmitting);

    // Mouse events for desktop testing
    pushToTalkButton.addEventListener('mousedown', async (e) => {
      e.preventDefault();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await startTransmitting(e, stream);
      } catch (error) {
        console.error('Failed to get audio stream:', error);
        addMessage('SYSTEM', 'Failed to access microphone: ' + error.message, 'system');
        fallbackToTextInput();
      }
    });

    pushToTalkButton.addEventListener('mouseup', stopTransmitting);
    pushToTalkButton.addEventListener('mouseleave', stopTransmitting);

    // Add visual feedback
    pushToTalkButton.addEventListener('touchstart', () => {
      pushToTalkButton.classList.add('pressed');
    });

    pushToTalkButton.addEventListener('touchend', () => {
      pushToTalkButton.classList.remove('pressed');
    });

    pushToTalkButton.addEventListener('touchcancel', () => {
      pushToTalkButton.classList.remove('pressed');
    });
  }

  // Update startTransmitting function
  async function startTransmitting(e, stream) {
    e.preventDefault();
    e.stopPropagation();

    if (!isPaired || !isFrequencyActive || isTransmitting) {
      console.log('Cannot transmit:', { isPaired, isFrequencyActive, isTransmitting });
      return;
    }

    console.log('Starting transmission...');
    isTransmitting = true;
    pushToTalkButton.classList.add('active');
    document.querySelector('.transmission-indicator').classList.add('active');

    // Show speech display
    const speechDisplay = document.querySelector('.speech-display');
    if (speechDisplay) {
      speechDisplay.style.display = 'block';
      speechDisplay.classList.add('active');
    }

    // Play button sound
    playButtonSound('start');

    try {
      // Resume audio context if it's suspended
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Start speech recognition immediately
      if (speechRecognition) {
        try {
          if (speechRecognition.state === 'listening') {
            speechRecognition.stop();
          }
          speechRecognition.start();
          console.log('Speech recognition started');
        } catch (error) {
          console.error('Speech recognition start error:', error);
          fallbackToTextInput();
        }
      } else {
        console.log('Speech recognition not available, falling back to text input');
        fallbackToTextInput();
      }

    } catch (error) {
      console.error('Transmission error:', error);
      addMessage('SYSTEM', `Error: ${error.message}`, 'system');
      isTransmitting = false;
      pushToTalkButton.classList.remove('active');
      document.querySelector('.transmission-indicator').classList.remove('active');
    }
  }

  // Stop transmitting function
  function stopTransmitting() {
    if (!isTransmitting) return;
    
    console.log('Stopping transmission...');
    isTransmitting = false;
    pushToTalkButton.classList.remove('active');
    document.querySelector('.transmission-indicator').classList.remove('active');
    
    // Play button sound
    playButtonSound('stop');
    
    // Stop speech recognition
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (error) {
        console.error('Error stopping speech recognition:', error);
      }
    }
    
    // Clean up any resources
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    
    if (currentProcessor) {
      currentProcessor.disconnect();
      currentProcessor = null;
    }
    
    if (currentSource) {
      currentSource.disconnect();
      currentSource = null;
    }
  }
  
  // Play button sound
  function playButtonSound(type) {
    if (!audioContext || !buttonSoundGainNode) return;
    
    try {
      // Create oscillator
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'square';
      
      if (type === 'start') {
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1760, audioContext.currentTime + 0.1);
      } else {
        oscillator.frequency.setValueAtTime(1760, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.1);
      }
      
      // Connect to gain node
      oscillator.connect(buttonSoundGainNode);
      
      // Start and stop
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
      console.error('Error playing button sound:', error);
    }
  }
  
  // Connect to WebSocket server
  function connectSocket() {
    // Configure Socket.IO with mobile-specific options
    socket = io({
      transports: ['websocket', 'polling'],  // Try WebSocket first, fall back to polling
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true
    });
    
    // Add connection monitoring
    socket.on('connect', () => {
      console.log("Socket connected:", socket.id);
      if (statusElement) {
        statusElement.textContent = 'Connected';
        statusElement.classList.add('active');
      }
      
      // Register as mobile client
      socket.emit('register', { type: 'mobile' });
    });
    
    socket.on('connect_error', (error) => {
      console.error("Socket connection error:", error);
      if (statusElement) {
        statusElement.textContent = 'Connection failed';
        statusElement.classList.add('error');
      }
      addMessage('SYSTEM', 'Connection error. Please check your network.', 'system');
      
      // Try to reconnect with polling if WebSocket fails
      if (socket.io.opts.transports[0] === 'websocket') {
        console.log("Falling back to polling transport");
        socket.io.opts.transports = ['polling', 'websocket'];
      }
    });
    
    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log("Reconnection attempt:", attemptNumber);
      if (statusElement) {
        statusElement.textContent = `Reconnecting (${attemptNumber}/5)...`;
        statusElement.classList.add('active');
      }
    });
    
    socket.on('reconnect', (attemptNumber) => {
      console.log("Reconnected after", attemptNumber, "attempts");
      if (statusElement) {
        statusElement.textContent = 'Reconnected';
        statusElement.classList.add('active');
      }
      addMessage('SYSTEM', 'Connection restored', 'system');
      
      // Re-register as mobile client
      socket.emit('register', { type: 'mobile' });
    });
    
    socket.on('reconnect_error', (error) => {
      console.error("Reconnection error:", error);
      if (statusElement) {
        statusElement.textContent = 'Reconnection failed';
        statusElement.classList.add('error');
      }
    });
    
    socket.on('reconnect_failed', () => {
      console.error("Failed to reconnect");
      if (statusElement) {
        statusElement.textContent = 'Connection lost';
        statusElement.classList.add('error');
      }
      addMessage('SYSTEM', 'Connection lost. Please reload the page.', 'system');
    });
    
    socket.on('disconnect', (reason) => {
      console.log("Socket disconnected:", reason);
      if (statusElement) {
        statusElement.textContent = 'Disconnected';
        statusElement.classList.add('error');
      }
      
      // Provide more specific guidance based on disconnect reason
      let message = 'Disconnected: ';
      switch (reason) {
        case 'io server disconnect':
          message += 'Server closed the connection. Please reload the page.';
          break;
        case 'io client disconnect':
          message += 'Client disconnected. Please check your network.';
          break;
        case 'ping timeout':
          message += 'Connection timed out. Please check your network.';
          break;
        case 'transport close':
          message += 'Connection closed. Please check your network.';
          break;
        default:
          message += reason;
      }
      
      addMessage('SYSTEM', message, 'system');
      
      // Disable push-to-talk button
      pushToTalkButton.disabled = true;
      
      // Reset pairing state
      isPaired = false;
    });
    
    // Handle message processing acknowledgment
    socket.on('message_processed', (data) => {
      console.log('Message processing completed:', data);
      isProcessingMessage = false;
      
      // Update UI to show message was processed
      const speechStatus = document.querySelector('.speech-status');
      if (speechStatus) {
        if (data.success) {
          speechStatus.textContent = 'Message sent';
          speechStatus.classList.remove('error');
        } else {
          speechStatus.textContent = `Error: ${data.error || 'Failed to process message'}`;
          speechStatus.classList.add('error');
        }
      }
      
      // Clear any timeout that might have been set
      if (processingTimeout) {
        clearTimeout(processingTimeout);
        processingTimeout = null;
      }
    });
    
    // Handle registration confirmation
    socket.on('registered', (data) => {
      console.log('Registered as mobile client:', data);
      addMessage('SYSTEM', 'Registered as mobile client. Please enter pairing code.', 'system');
    });
    
    // Handle pairing result
    socket.on('paired', (data) => {
      if (data.success) {
        console.log('Successfully paired with desktop');
        if (statusElement) {
          statusElement.textContent = 'Paired with desktop';
          statusElement.classList.add('active');
        }
        isPaired = true;
        
        // Enable push-to-talk button
        pushToTalkButton.disabled = false;
        
        addMessage('SYSTEM', 'Successfully paired with desktop. Ready for transmission.', 'system');
      } else {
        console.error('Pairing failed:', data.message);
        if (statusElement) {
          statusElement.textContent = 'Pairing failed';
          statusElement.classList.add('error');
        }
        
        addMessage('SYSTEM', `Pairing failed: ${data.message}`, 'system');
      }
    });
    
    // Handle active frequency updates
    socket.on('frequency_active', (data) => {
      console.log('Frequency active update:', data);
      
      isFrequencyActive = data.active;
      currentFrequency = data.active ? data.character : null;
      
      if (data.active && activeFrequencyElement) {
        activeFrequencyElement.textContent = `Frequency: ${data.character} at ${data.location}`;
        activeFrequencyElement.classList.add('active');
        currentCharacter = data.character;
        
        // Enable push-to-talk button if paired
        if (isPaired) {
          pushToTalkButton.disabled = false;
        }
        
        addMessage('SYSTEM', `Tuned to ${data.character} at ${data.location}`, 'system');
      } else if (activeFrequencyElement) {
        activeFrequencyElement.textContent = 'Frequency: --.--- MHz';
        activeFrequencyElement.classList.remove('active');
        currentCharacter = null;
        
        // Disable push-to-talk button
        pushToTalkButton.disabled = true;
        
        addMessage('SYSTEM', 'No active frequency. Ask desktop user to tune radio.', 'system');
      }
    });
    
    // Handle AI responses
    socket.on('ai_response', (data) => {
      console.log('Received AI response:', data);
      
      if (data && (data.message || data.text)) {
        const message = data.message || data.text;
        const character = data.character || 'SYSTEM';
        
        addMessage(character, message, 'character');
      }
    });
    
    // Handle desktop disconnection
    socket.on('desktop_disconnected', () => {
      console.log('Desktop disconnected');
      if (statusElement) {
        statusElement.textContent = 'Desktop disconnected';
        statusElement.classList.add('error');
      }
      
      // Disable push-to-talk button
      pushToTalkButton.disabled = true;
      
      // Reset pairing state
      isPaired = false;
      
      addMessage('SYSTEM', 'Desktop disconnected. Please reload and pair again.', 'system');
    });
    
    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      addMessage('SYSTEM', `Error: ${error.message || 'Unknown error'}`, 'system');
    });
  }
  
  // Add message to the message log
  function addMessage(sender, content, type = 'system') {
    // Only show system messages related to connection status
    const connectionMessages = [
      'Connected',
      'Connection failed',
      'Reconnecting',
      'Reconnected',
      'Connection lost',
      'Disconnected',
      'Registered as mobile client',
      'Paired with desktop',
      'Pairing failed',
      'Desktop disconnected',
      'Connection error',
      'Connection restored'
    ];

    // Check if this is a connection-related message
    const isConnectionMessage = connectionMessages.some(msg => content.includes(msg));
    
    // Only add the message if it's a connection-related system message
    if (type === 'system' && isConnectionMessage) {
      const messageElement = document.createElement('div');
      messageElement.className = `message ${type}`;
      
      const headerElement = document.createElement('div');
      headerElement.className = 'message-header';
      headerElement.textContent = 'STATUS';
      
      const contentElement = document.createElement('div');
      contentElement.className = 'message-content';
      contentElement.textContent = content;
      
      messageElement.appendChild(headerElement);
      messageElement.appendChild(contentElement);
      
      // Keep only the last 5 messages
      while (messagesElement.children.length >= 5) {
        messagesElement.removeChild(messagesElement.firstChild);
      }
      
      messagesElement.appendChild(messageElement);
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }
  
  // Initialize the application
  function init() {
    // Add initial system message
    addMessage('SYSTEM', 'Mobile interface initializing...', 'system');
    
    // Set up pair button
    pairButton.addEventListener('click', () => {
      const code = pairingCodeInput.value.trim();
      if (code && socket && socket.connected) {
        console.log('Attempting to pair with code:', code);
        socket.emit('pair', { pairing_code: code });
        
        // Update status
        if (statusElement) {
          statusElement.textContent = 'Pairing...';
          statusElement.classList.add('active');
        }
        
        addMessage('SYSTEM', 'Attempting to pair...', 'system');
      } else {
        addMessage('SYSTEM', 'Please enter a valid pairing code', 'system');
      }
    });
    
    // Set up push-to-talk button
    setupPushToTalk();
    
    // Connect to server
    connectSocket();
    
    // Add welcome message
    addMessage('SYSTEM', 'Connecting to server...', 'system');
  }
  
  // Start the application
  init();
});
