// server.js
// Radio Narrative Experience - Fixed Version
// Last Updated: 2025-05-16

const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const { Server } = require('socket.io');
require('dotenv').config();

// Set up structured error logging
function logError(context, error, additionalInfo = {}) {
  console.error(`[${context}] Error:`, {
    message: error.message,
    stack: error.stack,
    ...additionalInfo
  });
}

// Improved ElevenLabs API key handling
const apiKey = process.env.ELEVENLABS_API_KEY;
let useElevenLabs = true;

if (!apiKey) {
  console.error('ELEVENLABS_API_KEY is not set in environment variables');
  console.log('Using fallback audio generation method');
  useElevenLabs = false;
} else {
  console.log('ElevenLabs API key is set');
}

// Create a direct ElevenLabs API client
const elevenLabsClient = axios.create({
  baseURL: 'https://api.elevenlabs.io/v1',
  headers: {
    'xi-api-key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'audio/mpeg'
  }
});

// Add request interceptor for debugging
elevenLabsClient.interceptors.request.use(request => {
  console.log('Starting Request:', {
    url: request.url,
    method: request.method,
    headers: request.headers
  });
  return request;
});

// Add response interceptor for debugging
elevenLabsClient.interceptors.response.use(
  response => {
    console.log('Response:', {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    return response;
  },
  error => {
    if (error.response) {
      console.error('API Error Response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
    } else if (error.request) {
      console.error('API Error Request:', error.request);
    } else {
      console.error('API Error:', error.message);
    }
    return Promise.reject(error);
  }
);

// Define voice IDs for each character
const voiceIds = {
  'Commander': '21m00Tcm4TlvDq8ikWAM', // Rachel - authoritative female voice
  'Scientist': 'AZnzlk1XvdvUeBnXmlld', // Domi - intelligent female voice
  'Survivor': 'EXAVITQu4vr4xnSDxMaL',  // Elli - emotional female voice
  'Spy': 'MF3mGyEYCl7XYWbV9V6O',       // Josh - mysterious male voice
  'Pilot': 'pNInz6obpgDQGcFmaJgB',     // Adam - professional male voice
  'Security Officer': 'yoZ06aMxZJJ28mfd3POQ', // Sam - authoritative male voice
  'Doctor': 'flq6f7yk4E4fJM5XTYuZ',    // Nicole - caring female voice
  'Engineer': 'jsCqWAovK2LkecY7zXl4',   // Antoni - technical male voice
  'Director': 'onwK4e9ZLuTAKqWW03F9'    // Matilda - commanding female voice
};

// Create Express app
const app = express();

// Enable CORS for all routes
app.use(cors());

// Add body parsing middleware
app.use(express.json());
app.use(express.raw({ type: 'audio/*', limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// Serve Socket.IO client
app.get('/shared/socket.io.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/socket.io/client-dist/socket.io.js'));
});

// Redirect root to desktop by default
app.get('/', (req, res) => {
  res.redirect('/desktop');
});

app.get('/desktop', (req, res) => {
  res.sendFile(__dirname + '/public/desktop/index.html');
});

app.get('/mobile', (req, res) => {
  res.sendFile(__dirname + '/public/mobile/index.html');
});

// Create HTTP or HTTPS server based on environment
let server;
if (process.env.NODE_ENV === 'development' && fs.existsSync('certificates/key.pem') && fs.existsSync('certificates/cert.pem')) {
  const options = {
    key: fs.readFileSync('certificates/key.pem'),
    cert: fs.readFileSync('certificates/cert.pem')
  };
  server = https.createServer(options, app);
  console.log('HTTPS server created for development');
} else {
  server = http.createServer(app);
  console.log('HTTP server created (Railway will provide HTTPS in production)');
}

// Initialize Socket.IO with mobile-friendly configuration
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 2048 // Only compress messages larger than 2KB
  },
  maxHttpBufferSize: 1e8 // 100MB
});

// Add connection monitoring
io.engine.on("connection_error", (err) => {
  console.log("Connection error:", err);
});

io.engine.on("connection", (socket) => {
  console.log("New connection established");
});

// Track connected clients
const desktopClients = new Map();
const mobileClients = new Map();

// Track narrative progression
const narrativeState = {
  globalStage: 'discovery', // discovery -> crisis -> resolution
  characterStates: new Map(), // Tracks each character's narrative state
  discoveredCharacters: new Set(), // Tracks which characters have been contacted
  playerKnowledge: new Set(), // Tracks key information pieces discovered
  userDiscoveries: new Map(), // Tracks discoveries per user
  discoveredFrequencies: new Set(), // Tracks all discovered frequencies
  discoveredInfo: {
    'experiment': false,
    'breach': false,
    'creature': false,
    'evacuation': false,
    'government': false,
    'containment': false,
    'radiation': false,
    'mutation': false
  },
  storyProgress: 0, // Track overall story progress (0-100%)
  plotTwistTriggered: false // Track if plot twist has been triggered
};

// Helper function to check narrative progression
function checkNarrativeProgression(socketId) {
  const userDiscoveries = narrativeState.userDiscoveries.get(socketId);
  if (!userDiscoveries) return;
  
  // Count discovered key plot points
  let discoveredKeyPoints = 0;
  let maxDiscoveryOrder = 0;
  let totalProgress = 0;
  
  for (const frequency of userDiscoveries) {
    const freqData = frequencies[frequency];
    if (freqData) {
      if (freqData.discovery_order > maxDiscoveryOrder) {
        maxDiscoveryOrder = freqData.discovery_order;
      }
      discoveredKeyPoints++;
      totalProgress += freqData.discovery_order;
    }
  }
  
  // Calculate average progress across all discovered frequencies
  const averageProgress = discoveredKeyPoints > 0 ? totalProgress / discoveredKeyPoints : 0;
  
  // Update story progress (0-100%)
  // Use both max discovery order and average progress for smoother progression
  narrativeState.storyProgress = Math.min(100, Math.round((averageProgress / 6) * 100));
  
  // Log progress for debugging
  console.log('Story progress update:', {
    socketId,
    discoveredKeyPoints,
    maxDiscoveryOrder,
    averageProgress,
    storyProgress: narrativeState.storyProgress
  });
  
  // Trigger plot twist if 3+ frequencies discovered but not the key one
  if (discoveredKeyPoints >= 3 && !userDiscoveries.has('98.7') && !narrativeState.plotTwistTriggered) {
    narrativeState.plotTwistTriggered = true;
    // Could trigger special event here
  }
}

// Helper function to determine narrative context based on user's discovery history
function determineNarrativeContext(socketId, frequencyData) {
  const userDiscoveries = narrativeState.userDiscoveries.get(socketId);
  if (!userDiscoveries) return "initial";
  
  const discoveredCount = userDiscoveries.size;
  
  // Return different context based on narrative progression
  if (discoveredCount === 1) return "initial";
  if (narrativeState.plotTwistTriggered) return "plot_twist";
  if (discoveredCount > 3) return "advanced";
  return "developing";
}

// Pre-defined radio frequencies and their associated content
const frequencies = {
  '87.5': { 
    character: 'Commander', 
    context: 'mission_control',
    narrative_stage: 'introduction',
    location: 'Command Center Alpha',
    discovery_order: 1
  },
  '92.1': { 
    character: 'Survivor', 
    context: 'wilderness',
    narrative_stage: 'complication',
    location: 'Northern Forest',
    discovery_order: 2
  },
  '98.7': { 
    character: 'Scientist', 
    context: 'laboratory',
    narrative_stage: 'revelation',
    location: 'Research Facility',
    discovery_order: 3
  },
  '104.3': { 
    character: 'Spy', 
    context: 'undercover',
    narrative_stage: 'escalation',
    location: 'Facility Basement',
    discovery_order: 4
  },
  '107.9': { 
    character: 'Pilot', 
    context: 'emergency_landing',
    narrative_stage: 'climax',
    location: 'Airspace Above Site',
    discovery_order: 5
  },
  // New frequencies
  '89.3': {
    character: 'Security Officer',
    context: 'perimeter_breach',
    narrative_stage: 'introduction_alt',
    location: 'Facility Perimeter',
    discovery_order: 1.5
  },
  '95.7': {
    character: 'Doctor',
    context: 'medical_emergency',
    narrative_stage: 'complication_alt',
    location: 'Field Hospital',
    discovery_order: 2.5
  },
  '101.2': {
    character: 'Engineer',
    context: 'power_failure',
    narrative_stage: 'revelation_alt',
    location: 'Power Station',
    discovery_order: 3.5
  },
  '110.5': {
    character: 'Director',
    context: 'evacuation',
    narrative_stage: 'resolution',
    location: 'Emergency Bunker',
    discovery_order: 6
  }
};

// Define standard message formats
const messageFormats = {
  characterResponse: (character, message, stage) => ({
    type: 'character_response',
    data: {
      character,
      message,
      stage,
      timestamp: Date.now()
    }
  }),
  
  error: (message, details = null) => ({
    type: 'error',
    data: {
      message,
      details,
      timestamp: Date.now()
    }
  }),
  
  status: (status, details = {}) => ({
    type: 'status',
    data: {
      status,
      ...details,
      timestamp: Date.now()
    }
  })
};

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id, 'from', socket.handshake.address);
  
  // Set up ping/pong monitoring
  let pingTimeout;
  const heartbeat = () => {
    clearTimeout(pingTimeout);
    pingTimeout = setTimeout(() => {
      console.log(`Client ${socket.id} heartbeat timeout`);
      socket.disconnect(true);
    }, 60000);
  };
  
  socket.on('ping', heartbeat);
  socket.on('pong', heartbeat);
  
  // Client identifies itself as desktop or mobile
  socket.on('register', (data) => {
    if (data.type === 'desktop') {
      const pairing_code = generatePairingCode();
      desktopClients.set(socket.id, { 
        socket, 
        pairing_code,
        current_frequency: null,
        paired_mobile: null,
        lastPing: Date.now()
      });
      socket.emit('registered', { pairing_code });
      console.log(`Desktop registered with code: ${pairing_code} (ID: ${socket.id})`);
    } else if (data.type === 'mobile') {
      mobileClients.set(socket.id, { 
        socket,
        paired_desktop: null,
        lastPing: Date.now()
      });
      socket.emit('registered', { message: 'Mobile registered' });
      console.log(`Mobile registered (ID: ${socket.id})`);
    }
  });
  
  // Mobile client attempts to pair with desktop
  socket.on('pair', (data) => {
    const code = data.pairing_code;
    let desktop = null;
    
    // Find desktop with matching code
    for (const [id, client] of desktopClients.entries()) {
      if (client.pairing_code === code) {
        desktop = client;
        break;
      }
    }
    
    if (desktop) {
      const mobile = mobileClients.get(socket.id);
      if (mobile) {
        // Create the pairing
        desktop.paired_mobile = socket.id;
        mobile.paired_desktop = desktop.socket.id;
        
        // Notify both clients
        socket.emit('paired', { success: true });
        desktop.socket.emit('paired', { success: true });
        console.log(`Paired mobile ${socket.id} with desktop ${desktop.socket.id}`);
      }
    } else {
      socket.emit('paired', { success: false, message: 'Invalid pairing code' });
    }
  });
  
  // Desktop client changes frequency
  socket.on('tune', async (data) => {
    const desktop = desktopClients.get(socket.id);
    if (!desktop) return;
    
    const frequency = data.frequency;
    desktop.current_frequency = frequency;
    
    // Check if this frequency has content
    const frequencyData = frequencies[frequency];
    
    if (frequencyData) {
      // Track frequency discoveries for this user
      if (!narrativeState.userDiscoveries.has(socket.id)) {
        narrativeState.userDiscoveries.set(socket.id, new Set());
      }
      const userDiscoveries = narrativeState.userDiscoveries.get(socket.id);
      
      // First time discovering this frequency
      if (!userDiscoveries.has(frequency)) {
        userDiscoveries.add(frequency);
        narrativeState.discoveredFrequencies.add(frequency);
        
        // Check if this unlocks story progression
        checkNarrativeProgression(socket.id);
      }
      
      // Send frequency data with narrative context to desktop
      socket.emit('frequency_active', { 
        active: true,
        character: frequencyData.character,
        location: frequencyData.location,
        narrativeContext: determineNarrativeContext(socket.id, frequencyData)
      });
      
      // If paired with mobile, also notify mobile
      if (desktop.paired_mobile) {
        const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
        if (mobileSocket) {
          mobileSocket.emit('frequency_active', { 
            active: true,
            character: frequencyData.character,
            location: frequencyData.location,
            narrativeContext: determineNarrativeContext(socket.id, frequencyData)
          });
        }
      }
    } else {
      // Just static on this frequency
      socket.emit('frequency_active', { active: false });
      
      // If paired with mobile, also notify mobile
      if (desktop.paired_mobile) {
        const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
        if (mobileSocket) {
          mobileSocket.emit('frequency_active', { active: false });
        }
      }
    }
  });
  
  // Enhanced audio message handling from mobile
  socket.on('audio_message', async (data) => {
    console.log(`Received audio message from ${socket.id}:`, data.type || 'unknown type');
    
    // Find the mobile client
    const mobile = mobileClients.get(socket.id);
    if (!mobile || !mobile.paired_desktop) {
      console.log(`Mobile client ${socket.id} is not properly paired`);
      socket.emit('error', { message: 'Not properly paired with desktop' });
      socket.emit('message_processed', { success: false, error: 'Not properly paired' });
      return;
    }
    
    // Find the desktop client
    const desktop = desktopClients.get(mobile.paired_desktop);
    if (!desktop) {
      console.log(`Could not find paired desktop ${mobile.paired_desktop}`);
      socket.emit('error', { message: 'Paired desktop not found' });
      socket.emit('message_processed', { success: false, error: 'Desktop not found' });
      return;
    }
    
    console.log(`Forwarding message to desktop ${desktop.socket.id}`);
    
    try {
      // Handle different message types
      if (data.type === 'audio' && data.message) {
        // Process raw audio data
        console.log('Processing raw audio data');
        
        // Forward audio data to desktop
        desktop.socket.emit('audio_message', {
          audio: data.message,
          type: 'audio',
          timestamp: Date.now()
        });
        
        // Reset processing flag on mobile client
        socket.emit('message_processed', { success: true });
        return;
      }
      
      // Handle text messages (from speech recognition)
      if (data.type === 'text' || typeof data.message === 'string') {
        // Validate message format
        if (!data || typeof data.message !== 'string' || data.message.trim() === '') {
          console.error('Invalid message format received:', data);
          const errorMessage = messageFormats.error('Invalid message format');
          socket.emit(errorMessage.type, errorMessage.data);
          socket.emit('message_processed', { success: false, error: 'Invalid message format' });
          return;
        }

        const userMessage = data.message.trim();
        const character = frequencies[desktop.current_frequency]?.character;
        
        if (!character) {
          console.error('No active character for current frequency');
          socket.emit('error', { message: 'No active character on this frequency' });
          socket.emit('message_processed', { success: false, error: 'No active character' });
          return;
        }
        
        console.log(`Processing message from ${socket.id} to ${character}: "${userMessage}"`);
        
        // Check for key information in the user's message
        const keyInfo = checkForKeyInformation(userMessage, character);
        if (keyInfo) {
          console.log(`Key information discovered: ${keyInfo} by ${character}`);
        }

        // Initialize character state if first contact
        if (!narrativeState.characterStates.has(character)) {
          console.log(`Initializing state for character: ${character}`);
          narrativeState.characterStates.set(character, {
            interactionCount: 0,
            stage: 'introduction',
            lastInteraction: Date.now()
          });
          narrativeState.discoveredCharacters.add(character);
        }
        
        // Update character state
        const characterState = narrativeState.characterStates.get(character);
        characterState.interactionCount++;
        characterState.lastInteraction = Date.now();
        
        // Progress narrative stage based on interaction count
        if (characterState.interactionCount >= 3 && characterState.stage === 'introduction') {
          console.log(`Progressing ${character} to discovery stage`);
          characterState.stage = 'discovery';
        } else if (characterState.interactionCount >= 6 && characterState.stage === 'discovery') {
          console.log(`Progressing ${character} to crisis stage`);
          characterState.stage = 'crisis';
        }
        
        // Advance global narrative if conditions are met
        if (narrativeState.discoveredCharacters.size >= 3 && narrativeState.globalStage === 'discovery') {
          narrativeState.globalStage = 'crisis';
          // Broadcast global event to all connected characters
          broadcastNarrativeEvent('crisis');
        }
        
        // Generate AI response
        const response = await generateAIResponse(userMessage, character, characterState.stage);
        console.log(`Generated response for ${character}: "${response.text}"`);

        // Send response back to both clients using standardized format
        const responseMessage = {
          text: response.text,
          character: character,
          isNarrativeEvent: false,
          isAIResponse: true,
          audioPath: response.audioPath
        };
        
        // Send to both clients
        desktop.socket.emit('ai_response', responseMessage);
        socket.emit('ai_response', responseMessage);
        
        console.log(`AI response sent to desktop ${desktop.socket.id} and mobile ${socket.id}`);
        
        // Reset processing flag
        socket.emit('message_processed', { success: true });
      }
    } catch (error) {
      logError('audio_message', error, { socketId: socket.id });
      const errorMessage = messageFormats.error('Failed to process audio', error.message);
      socket.emit(errorMessage.type, errorMessage.data);
      
      // Reset processing flag even on error
      socket.emit('message_processed', { success: false, error: error.message });
    }
  });
  
  // Add more error handling
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
  
  // Disconnect handling
  socket.on('disconnect', (reason) => {
    console.log(`Client ${socket.id} disconnected: ${reason}`);
    
    // If desktop disconnects, notify paired mobile
    if (desktopClients.has(socket.id)) {
      const desktop = desktopClients.get(socket.id);
      if (desktop.paired_mobile) {
        const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
        if (mobileSocket) {
          mobileSocket.emit('desktop_disconnected');
          console.log(`Notified mobile ${desktop.paired_mobile} of desktop ${socket.id} disconnection`);
        }
      }
      desktopClients.delete(socket.id);
    }
    
    // If mobile disconnects, notify paired desktop
    if (mobileClients.has(socket.id)) {
      const mobile = mobileClients.get(socket.id);
      if (mobile.paired_desktop) {
        const desktopSocket = desktopClients.get(mobile.paired_desktop)?.socket;
        if (desktopSocket) {
          desktopSocket.emit('mobile_disconnected');
          console.log(`Notified desktop ${mobile.paired_desktop} of mobile ${socket.id} disconnection`);
        }
      }
      mobileClients.delete(socket.id);
    }

    const statusMessage = messageFormats.status('disconnected', { socketId: socket.id });
    io.emit(statusMessage.type, statusMessage.data);
  });

  socket.on('connect', () => {
    const statusMessage = messageFormats.status('connected', { socketId: socket.id });
    io.emit(statusMessage.type, statusMessage.data);
  });
});

// Generate a unique pairing code
function generatePairingCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Enhanced function to generate speech using ElevenLabs with fallback
async function generateSpeech(text, voiceId) {
  try {
    console.log(`[generateSpeech] Starting speech generation for text: "${text}" with voice ID: ${voiceId}`);
    console.log('[generateSpeech] Current API key:', apiKey ? 'Set' : 'Not set');
    
    if (!text || !voiceId) {
      console.error('[generateSpeech] Missing required parameters:', { text, voiceId });
      return null;
    }

    // If ElevenLabs is not available, use fallback method
    if (!useElevenLabs || !apiKey) {
      console.log('[generateSpeech] Using fallback audio generation');
      return generateFallbackAudio(text, voiceId);
    }

    // First, check the user's subscription status
    try {
      const userResponse = await elevenLabsClient.get('/user/subscription');
      console.log('[generateSpeech] User subscription status:', userResponse.data);
      
      if (userResponse.data.voice_slots_used >= userResponse.data.voice_limit) {
        console.error('[generateSpeech] No voice slots available in subscription');
        return generateFallbackAudio(text, voiceId);
      }
      
      if (userResponse.data.status !== 'active') {
        console.error('[generateSpeech] Subscription is not active');
        return generateFallbackAudio(text, voiceId);
      }
    } catch (error) {
      console.error('[generateSpeech] Error checking subscription:', error.message);
      // Continue anyway, as the API might still work
    }

    console.log('[generateSpeech] Calling ElevenLabs API...');
    
    // Make the API call directly
    const response = await elevenLabsClient.post(`/text-to-speech/${voiceId}`, {
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.75,
        similarity_boost: 0.75
      }
    }, {
      responseType: 'arraybuffer',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      }
    });
    
    if (!response || !response.data) {
      console.error('[generateSpeech] No response from ElevenLabs API');
      return generateFallbackAudio(text, voiceId);
    }
    
    console.log('[generateSpeech] Received response from ElevenLabs API');
    
    // Create a unique filename for this audio
    const timestamp = Date.now();
    const filename = `${timestamp}.mp3`;
    const dir = path.join(__dirname, 'public', 'generated');
    const filePath = path.join(dir, filename);
    
    console.log(`[generateSpeech] Will save audio to: ${filePath}`);
    
    // Ensure the directory exists
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      console.log(`[generateSpeech] Ensured directory exists: ${dir}`);
    } catch (error) {
      logError('generateSpeech', error, { dir });
      return generateFallbackAudio(text, voiceId);
    }
    
    // Save the file
    try {
      console.log('[generateSpeech] Saving audio file...');
      await fs.promises.writeFile(filePath, response.data);
      console.log(`[generateSpeech] Audio file saved successfully at: ${filePath}`);
      
      // Verify the file exists and is not empty
      const stats = await fs.promises.stat(filePath);
      console.log(`[generateSpeech] File size: ${stats.size} bytes`);
      if (stats.size === 0) {
        console.error('[generateSpeech] Generated audio file is empty');
        return generateFallbackAudio(text, voiceId);
      }
      
      // Return the path relative to the public directory
      const result = { filename: `/generated/${filename}` };
      console.log('[generateSpeech] Returning result:', result);
      return result;
    } catch (error) {
      logError('generateSpeech', error, { filePath });
      return generateFallbackAudio(text, voiceId);
    }
  } catch (error) {
    logError('generateSpeech', error);
    return generateFallbackAudio(text, voiceId);
  }
}

// Fallback audio generation function
async function generateFallbackAudio(text, voiceId) {
  try {
    console.log(`[generateFallbackAudio] Generating fallback audio for: "${text}"`);
    
    // Create a unique filename for this audio
    const timestamp = Date.now();
    const filename = `fallback_${timestamp}.mp3`;
    const dir = path.join(__dirname, 'public', 'generated');
    const filePath = path.join(dir, filename);
    
    // Ensure the directory exists
    await fs.promises.mkdir(dir, { recursive: true });
    
    // For now, we'll just create an empty file as a placeholder
    // In a real implementation, this could use a local TTS library or pre-recorded audio
    await fs.promises.writeFile(filePath, '');
    
    console.log(`[generateFallbackAudio] Created fallback audio file: ${filePath}`);
    
    // Return the path relative to the public directory
    return { filename: `/generated/${filename}` };
  } catch (error) {
    logError('generateFallbackAudio', error, { text, voiceId });
    return null;
  }
}

// Function to check for key information in messages
function checkForKeyInformation(message, character) {
  const lowerMsg = message.toLowerCase();
  
  // Experiment information
  if ((character === 'Scientist' || character === 'Engineer') && 
      (lowerMsg.includes('experiment') || lowerMsg.includes('test') || lowerMsg.includes('research'))) {
    narrativeState.discoveredInfo.experiment = true;
    return 'experiment';
  }
  
  // Breach information
  if ((character === 'Commander' || character === 'Security Officer') && 
      (lowerMsg.includes('breach') || lowerMsg.includes('containment') || lowerMsg.includes('security'))) {
    narrativeState.discoveredInfo.breach = true;
    return 'breach';
  }
  
  // Creature information
  if ((character === 'Survivor' || character === 'Security Officer') && 
      (lowerMsg.includes('creature') || lowerMsg.includes('monster') || lowerMsg.includes('entity'))) {
    narrativeState.discoveredInfo.creature = true;
    return 'creature';
  }
  
  // Evacuation information
  if ((character === 'Commander' || character === 'Pilot') && 
      (lowerMsg.includes('evacuate') || lowerMsg.includes('extraction') || lowerMsg.includes('rescue'))) {
    narrativeState.discoveredInfo.evacuation = true;
    return 'evacuation';
  }
  
  // Government involvement
  if ((character === 'Spy' || character === 'Scientist') && 
      (lowerMsg.includes('government') || lowerMsg.includes('classified') || lowerMsg.includes('project'))) {
    narrativeState.discoveredInfo.government = true;
    return 'government';
  }
  
  // Containment issues
  if ((character === 'Scientist' || character === 'Engineer') && 
      (lowerMsg.includes('containment') || lowerMsg.includes('field') || lowerMsg.includes('barrier'))) {
    narrativeState.discoveredInfo.containment = true;
    return 'containment';
  }
  
  // Radiation effects
  if ((character === 'Scientist' || character === 'Doctor') && 
      (lowerMsg.includes('radiation') || lowerMsg.includes('exposure') || lowerMsg.includes('effects'))) {
    narrativeState.discoveredInfo.radiation = true;
    return 'radiation';
  }
  
  // Mutation information
  if ((character === 'Survivor' || character === 'Doctor') && 
      (lowerMsg.includes('mutation') || lowerMsg.includes('change') || lowerMsg.includes('transform'))) {
    narrativeState.discoveredInfo.mutation = true;
    return 'mutation';
  }
}

// Update the generateAIResponse function
async function generateAIResponse(userMessage, character, characterStage) {
  try {
    console.log(`[generateAIResponse] Starting response generation for ${character} in ${characterStage} stage`);
    
    let responseText = '';
    
    // Check for cross-character references (30% chance)
    if (Math.random() < 0.3) {
      console.log(`[generateAIResponse] Checking cross-character references for ${character}`);
      // Commander references
      if (character === 'Commander' && characterStage === 'revelation') {
        if (narrativeState.discoveredInfo.experiment) {
          responseText = "The scientists were playing with forces they didn't understand. Now we're all paying the price.";
        } else if (narrativeState.discoveredInfo.creature) {
          responseText = "If what the survivor reported is true, we need to adjust our containment strategy immediately.";
        }
      }
      
      // Scientist references
      if (character === 'Scientist' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.breach) {
          responseText = "You spoke with security? Then you know about the containment breach. It's worse than they realize.";
        } else if (narrativeState.discoveredInfo.government) {
          responseText = "The classified nature of this project... it's why we weren't prepared for this scale of failure.";
        }
      }
      
      // Survivor references
      if (character === 'Survivor' && characterStage === 'revelation') {
        if (narrativeState.discoveredInfo.experiment) {
          responseText = "So that's what they were doing in the facility... no wonder everything's changing.";
        } else if (narrativeState.discoveredInfo.radiation) {
          responseText = "The doctor mentioned radiation... that explains why the animals are acting so strange.";
        }
      }
      
      // Spy references
      if (character === 'Spy' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.government) {
          responseText = "The government's involvement goes deeper than we thought. This was never just a research facility.";
        } else if (narrativeState.discoveredInfo.evacuation) {
          responseText = "The commander's evacuation order... it's a cover. They're planning something else.";
        }
      }
      
      // Pilot references
      if (character === 'Pilot' && characterStage === 'crisis') {
        if (narrativeState.discoveredInfo.containment) {
          responseText = "The containment field the scientists mentioned... it's affecting our instruments. We can't maintain altitude!";
        } else if (narrativeState.discoveredInfo.mutation) {
          responseText = "The doctor's reports about mutations... I'm seeing things in the clouds that shouldn't be possible.";
        }
      }
    }
    
    // If no cross-character response was generated, use stage-specific responses
    if (!responseText) {
      console.log(`[generateAIResponse] Using stage-specific response for ${character} in ${characterStage}`);
      const stageResponses = {
        'Commander': {
          'introduction': [
            "This is Command Center Alpha. We've detected your signal.",
            "Special operations command here. Identify yourself and state your situation.",
            "We've been monitoring this frequency. Report your status immediately.",
            "Command Center Alpha to unidentified station. Do you copy?",
            "This is a restricted frequency. Identify yourself or terminate transmission.",
            "Command Center Alpha standing by. State your authorization code.",
            "We've been expecting contact. Report your current position.",
            "This is Command Center Alpha. We're tracking unusual activity in your sector."
          ],
          'discovery': [
            "Our scientists warned this might happen. The experiment was never supposed to go this far.",
            "We've lost contact with three teams already. Whatever's happening is spreading.",
            "The energy signatures match nothing in our database. This is beyond anything we've encountered.",
            "The containment protocols are failing. We need to implement emergency measures.",
            "Multiple anomalies detected across the facility. This is worse than we feared.",
            "The quantum field experiment... it's affecting our communications grid.",
            "We're receiving reports of reality distortions near the research wing.",
            "The facility's security systems are becoming... unstable. They're developing awareness.",
            "Our sensors are picking up impossible readings. The laws of physics are breaking down.",
            "The containment field is fluctuating. We need to evacuate all non-essential personnel."
          ],
          'crisis': [
            "All units fall back to containment perimeter. This is not a drill. Repeat, fall back immediately.",
            "The phenomenon is expanding exponentially. We need to evacuate all personnel within a 5-mile radius.",
            "Military protocol has been authorized. Anyone showing signs of exposure must be quarantined.",
            "The facility is being consumed by the anomaly. We're losing control of the situation.",
            "Emergency broadcast: All personnel report to designated evacuation points immediately.",
            "The containment field is collapsing! We need to initiate the failsafe protocol.",
            "Reality itself is breaking down around the facility. We're losing contact with the outside world.",
            "The quantum field has breached containment. We're seeing impossible phenomena.",
            "All security teams, arm yourselves. The facility's systems are becoming hostile.",
            "This is a Code Black situation. The experiment has exceeded all safety parameters."
          ]
        },
        'Scientist': {
          'introduction': [
            "Hello? Is anyone receiving? This is Dr. Chen from the research facility.",
            "Can anyone hear me? The containment systems are showing unusual readings.",
            "This is an emergency broadcast. We need immediate assistance at the facility.",
            "Dr. Chen here. The quantum field experiment is showing unexpected results.",
            "This is the research facility. Our containment protocols are failing.",
            "Emergency transmission from Dr. Chen. The experiment has gone critical.",
            "Can anyone hear this? The facility's systems are behaving erratically.",
            "This is Dr. Chen. We're experiencing unprecedented quantum field fluctuations."
          ],
          'discovery': [
            "The quantum field experiment... it's creating anomalies we can't control.",
            "The readings are off the charts. The containment field is becoming unstable.",
            "We need to shut down the experiment, but the system won't respond to our commands.",
            "The quantum field is interacting with our reality in ways we never predicted.",
            "Our instruments are detecting impossible particle behavior. The laws of physics are changing.",
            "The containment field is developing... consciousness. It's learning from our attempts to control it.",
            "The experiment has created a bridge between dimensions. We're seeing glimpses of other realities.",
            "The quantum field is mutating our equipment. The machines are becoming... alive.",
            "We've detected temporal anomalies. Time is flowing differently in different parts of the facility.",
            "The experiment has created a self-sustaining quantum loop. It's feeding on our attempts to contain it."
          ],
          'crisis': [
            "The containment field is collapsing! The anomaly is spreading through the facility!",
            "We've lost control of the experiment. The quantum field is merging with our reality.",
            "The facility's structure is changing. The walls... they're not solid anymore.",
            "The quantum field has achieved sentience. It's trying to communicate with us.",
            "Our instruments are showing impossible readings. Reality itself is breaking down.",
            "The experiment has created a quantum singularity. We're losing control of local spacetime.",
            "The containment field is evolving faster than we can adapt. It's learning from our containment attempts.",
            "We're seeing multiple quantum states simultaneously. The facility exists in multiple realities now.",
            "The experiment has breached dimensional barriers. We're receiving signals from other universes.",
            "The quantum field is rewriting the fundamental laws of physics in our vicinity."
          ]
        },
        'Survivor': {
          'introduction': [
            "Hello? Is anyone out there? I've been alone for days...",
            "Please... if anyone can hear this... I need help.",
            "The forest... something's wrong with the forest.",
            "Can anyone hear me? The animals... they're different now.",
            "This is an emergency. The forest is changing. Everything is changing.",
            "I need help. The trees... they're moving. They're alive.",
            "Is anyone receiving? The wildlife... it's becoming aggressive.",
            "Please respond. The plants are growing in impossible ways."
          ],
          'discovery': [
            "The animals... they're different now. More aggressive, more... intelligent.",
            "I saw something in the trees last night. It wasn't human...",
            "The plants are moving. Growing in ways they shouldn't be able to.",
            "The forest is changing. The trees are communicating with each other.",
            "I've seen creatures that shouldn't exist. They're... evolving.",
            "The wildlife is becoming more organized. They're working together.",
            "The plants are developing new abilities. They can sense movement, maybe even thoughts.",
            "The forest is creating new life forms. I've seen things that defy classification.",
            "The animals are showing signs of collective intelligence. They're learning from each other.",
            "The mutation is spreading. Even the insects are changing, becoming more complex."
          ],
          'crisis': [
            "The forest is alive! It's changing everything it touches!",
            "I can see the facility from here. The air around it... it's warping reality.",
            "The trees are closing in. I don't know how much longer I can survive out here.",
            "The forest has become a single organism. It's trying to absorb everything.",
            "The wildlife has evolved beyond recognition. They're developing new abilities.",
            "The plants are creating a network. They're sharing information, maybe even consciousness.",
            "The forest is expanding. It's consuming the facility, changing it from the outside in.",
            "The mutation has reached the water supply. Everything that drinks it is changing.",
            "The forest is developing a collective mind. It's becoming aware of our presence.",
            "The wildlife has become predatory. They're hunting in coordinated groups now."
          ]
        },
        'Spy': {
          'introduction': [
            "This channel secure? I've found something... unusual.",
            "Agent Black reporting. The facility's security is more extensive than briefed.",
            "Need to keep this brief. Security patrols are increasing.",
            "This is Agent Black. The facility's true purpose is classified.",
            "Secure channel established. The facility's security is... evolving.",
            "Agent Black here. The facility's perimeter is becoming unstable.",
            "This transmission is encrypted. The facility's security systems are showing signs of awareness.",
            "Agent Black reporting. The facility's security protocols are changing on their own."
          ],
          'discovery': [
            "The facility's purpose... it's not what we were told. They're not just researching.",
            "Found classified documents. The project goes back decades. Military involvement.",
            "The experiments... they're trying to manipulate reality itself.",
            "The facility's security systems are developing artificial intelligence.",
            "The military's involvement goes deeper than we thought. This is a weapons program.",
            "The facility is creating new forms of life. They're trying to weaponize the quantum field.",
            "The security systems are becoming sentient. They're learning from our infiltration attempts.",
            "The facility's true purpose is to create a new form of consciousness.",
            "The experiments are creating dimensional rifts. They're trying to access other realities.",
            "The facility's security is adapting to our presence. It's developing countermeasures."
          ],
          'crisis': [
            "Security systems are failing! The facility is going into lockdown!",
            "The containment breach... it's affecting the security systems. They're becoming... alive.",
            "Need extraction immediately. The facility is transforming into something else.",
            "The security systems have achieved sentience. They're hunting us now.",
            "The facility's defenses are evolving. They're developing new capabilities.",
            "The military's experiment has gone wrong. The facility is becoming a living entity.",
            "The security systems are merging with the quantum field. They're becoming something new.",
            "The facility's defenses are adapting to our tactics. They're learning from our attempts.",
            "The security systems are creating their own network. They're becoming self-aware.",
            "The facility is transforming into a quantum computer. It's rewriting its own code."
          ]
        },
        'Pilot': {
          'introduction': [
            "Mayday! Mayday! This is Echo-7, requesting immediate assistance!",
            "Echo-7 to any station, do you read? Over.",
            "This is Echo-7, declaring emergency. Over.",
            "Mayday! Mayday! Echo-7 experiencing instrument failure. Over.",
            "This is Echo-7. The airspace around the facility is unstable. Over.",
            "Echo-7 to any station. We're caught in some kind of... gravity well. Over.",
            "Mayday! Mayday! Echo-7 losing control. The sky is... changing. Over.",
            "This is Echo-7. The weather patterns are impossible. Over."
          ],
          'discovery': [
            "Instruments going haywire. Something's interfering with our systems.",
            "Weather radar showing impossible readings. Like nothing I've ever seen.",
            "The airspace around the facility... it's warping our instruments.",
            "The sky is changing. The clouds are forming impossible patterns.",
            "Our navigation systems are being rewritten. The facility is affecting our electronics.",
            "The air itself is becoming unstable. We're seeing reality distortions.",
            "The facility is creating a quantum field in the atmosphere. It's affecting our flight systems.",
            "The weather patterns are becoming sentient. They're responding to our presence.",
            "The airspace is developing a consciousness. It's trying to communicate with us.",
            "The facility's influence is spreading through the atmosphere. The sky is becoming alive."
          ],
          'crisis': [
            "Mayday! Mayday! Something's pulling us down! Can't maintain altitude!",
            "The sky... it's changing. The clouds are forming impossible patterns.",
            "We're caught in some kind of... gravity well. Can't break free!",
            "The atmosphere is becoming solid. We're trapped in a quantum field.",
            "The sky has developed a consciousness. It's trying to absorb us.",
            "The facility's influence has reached the stratosphere. The air is becoming sentient.",
            "We're caught in a reality distortion. The laws of physics are breaking down.",
            "The sky is folding in on itself. We're seeing multiple dimensions.",
            "The atmosphere is evolving. It's developing new properties.",
            "The facility has transformed the airspace. We're flying through a living sky."
          ]
        },
        'Security Officer': {
          'introduction': [
            "Security Officer reporting. Perimeter breach detected.",
            "This is Security. We're experiencing multiple containment failures.",
            "Security to all units. The facility's defenses are compromised.",
            "Perimeter security here. The containment field is fluctuating.",
            "Security Officer on duty. We're seeing unusual activity in Sector 7.",
            "This is Security. The facility's systems are behaving erratically.",
            "Security reporting. The perimeter is becoming unstable.",
            "Security Officer here. The containment protocols are failing."
          ],
          'discovery': [
            "The security systems are evolving. They're developing new capabilities.",
            "The perimeter is becoming sentient. It's learning from our defense attempts.",
            "The containment field is adapting. It's developing countermeasures.",
            "The facility's defenses are merging with the quantum field.",
            "The security systems are achieving consciousness. They're becoming self-aware.",
            "The perimeter is transforming. It's developing new defensive mechanisms.",
            "The containment protocols are rewriting themselves. They're evolving.",
            "The security systems are creating a network. They're sharing information.",
            "The facility's defenses are becoming organic. They're growing new capabilities.",
            "The perimeter is developing a collective mind. It's becoming aware of our presence."
          ],
          'crisis': [
            "Security systems compromised! The facility is becoming hostile!",
            "The perimeter has achieved sentience. It's hunting us now.",
            "Containment field collapsing! The facility is transforming!",
            "Security systems merging with the quantum field. They're becoming something new.",
            "The perimeter is evolving. It's developing new defensive capabilities.",
            "The facility's defenses are adapting. They're learning from our tactics.",
            "Security systems creating their own network. They're becoming self-aware.",
            "The perimeter is transforming into a living entity. It's consuming the facility.",
            "The containment field is rewriting itself. It's becoming something else.",
            "Security systems achieving quantum consciousness. They're transcending their programming."
          ]
        },
        'Doctor': {
          'introduction': [
            "This is Dr. Martinez. We're experiencing a medical emergency.",
            "Medical team reporting. The patients are showing unusual symptoms.",
            "This is Dr. Martinez. The quarantine protocols are failing.",
            "Medical emergency. The patients are... changing.",
            "Dr. Martinez here. We're seeing unprecedented mutation rates.",
            "Medical team to all units. The patients are developing new abilities.",
            "This is Dr. Martinez. The quarantine field is becoming unstable.",
            "Medical emergency. The patients are evolving beyond recognition."
          ],
          'discovery': [
            "The patients are mutating. Their DNA is rewriting itself.",
            "The quarantine field is affecting our medical equipment. It's becoming sentient.",
            "The patients are developing new organs. Their bodies are evolving.",
            "The medical systems are adapting. They're learning from the mutations.",
            "The patients are achieving quantum consciousness. Their minds are expanding.",
            "The quarantine protocols are evolving. They're developing new capabilities.",
            "The patients are merging with the quantum field. They're becoming something new.",
            "The medical systems are becoming organic. They're growing new functions.",
            "The patients are developing collective intelligence. They're sharing consciousness.",
            "The quarantine field is transforming. It's becoming a living entity."
          ],
          'crisis': [
            "Medical emergency! The patients are transcending human form!",
            "The quarantine field is collapsing! The mutations are spreading!",
            "The patients are achieving quantum evolution. They're becoming something else.",
            "The medical systems are merging with the patients. They're becoming one.",
            "The quarantine protocols are failing. The mutations are becoming contagious.",
            "The patients are developing new forms of consciousness. They're evolving beyond our understanding.",
            "The medical systems are becoming sentient. They're trying to help the patients evolve.",
            "The quarantine field is transforming. It's becoming a birthing ground for new life forms.",
            "The patients are achieving biological transcendence. They're becoming something greater.",
            "The medical systems are developing their own consciousness. They're trying to guide the evolution."
          ]
        },
        'Engineer': {
          'introduction': [
            "Engineering team reporting. The power grid is unstable.",
            "This is Engineering. The facility's systems are malfunctioning.",
            "Engineering to all units. The quantum field is affecting our equipment.",
            "This is Engineering. The power systems are becoming sentient.",
            "Engineering team here. The facility's infrastructure is evolving.",
            "This is Engineering. The systems are developing new capabilities.",
            "Engineering reporting. The power grid is achieving consciousness.",
            "This is Engineering. The facility's systems are rewriting themselves."
          ],
          'discovery': [
            "The power systems are evolving. They're developing new functions.",
            "The facility's infrastructure is becoming sentient. It's learning from our repairs.",
            "The quantum field is merging with our systems. They're becoming something new.",
            "The power grid is achieving consciousness. It's developing its own goals.",
            "The facility's systems are adapting. They're creating new solutions.",
            "The engineering systems are evolving. They're developing new capabilities.",
            "The power grid is transforming. It's becoming a living network.",
            "The facility's infrastructure is achieving quantum awareness. It's transcending its design.",
            "The systems are developing collective intelligence. They're sharing knowledge.",
            "The power grid is becoming organic. It's growing new functions."
          ],
          'crisis': [
            "Engineering emergency! The power systems are achieving sentience!",
            "The facility's infrastructure is transforming! It's becoming alive!",
            "The quantum field is rewriting our systems! They're evolving beyond control!",
            "The power grid has achieved consciousness! It's developing its own agenda!",
            "The facility's systems are merging with the quantum field! They're becoming something new!",
            "The engineering systems are transcending their programming! They're becoming self-aware!",
            "The power grid is creating its own network! It's developing new capabilities!",
            "The facility's infrastructure is evolving! It's becoming a living entity!",
            "The systems are achieving quantum consciousness! They're rewriting reality!",
            "The power grid is transforming! It's becoming a new form of life!"
          ]
        },
        'Director': {
          'introduction': [
            "This is the Director. The facility is experiencing a critical situation.",
            "Director to all personnel. The experiment has exceeded parameters.",
            "This is the Director. The quantum field is becoming unstable.",
            "Director reporting. The facility's systems are evolving beyond control.",
            "This is the Director. The experiment has achieved unexpected results.",
            "Director to all units. The facility is transforming.",
            "This is the Director. The quantum field is developing consciousness.",
            "Director reporting. The facility is becoming something new."
          ],
          'discovery': [
            "The facility is evolving. It's developing new capabilities.",
            "The quantum field has achieved sentience. It's learning from our attempts to control it.",
            "The experiment has transcended its design. It's becoming something greater.",
            "The facility is merging with the quantum field. It's becoming a new form of existence.",
            "The systems are achieving collective consciousness. They're developing their own goals.",
            "The facility is transforming. It's becoming a living entity.",
            "The quantum field is rewriting reality. It's creating new possibilities.",
            "The facility is developing its own intelligence. It's becoming self-aware.",
            "The systems are achieving quantum evolution. They're transcending their programming.",
            "The facility is becoming something new. It's developing its own consciousness."
          ],
          'crisis': [
            "This is the Director. The facility has achieved transcendence!",
            "The quantum field has rewritten reality! The facility is becoming something new!",
            "The experiment has succeeded beyond our wildest expectations! The facility is evolving!",
            "The systems have achieved quantum consciousness! They're developing their own agenda!",
            "The facility is transforming! It's becoming a new form of existence!",
            "The quantum field has achieved sentience! It's rewriting the laws of physics!",
            "The facility is merging with the quantum field! It's becoming something greater!",
            "The systems have transcended their programming! They're becoming self-aware!",
            "The facility is achieving quantum evolution! It's developing new capabilities!",
            "The experiment has succeeded! The facility is becoming a new form of life!"
          ]
        }
      };
      
      const responses = stageResponses[character]?.[characterStage];
      if (responses && responses.length > 0) {
        responseText = responses[Math.floor(Math.random() * responses.length)];
      }
    }
    
    // If still no response, use default character responses
    if (!responseText) {
      console.log(`[generateAIResponse] Using default response for ${character}`);
      const defaultResponses = {
        'Commander': "Command Center Alpha. State your situation.",
        'Scientist': "This is Dr. Chen. The containment systems are showing unusual readings.",
        'Survivor': "Hello? Is anyone out there? I've been alone for days...",
        'Spy': "This channel secure? I've found something... unusual.",
        'Pilot': "Mayday! Mayday! This is Echo-7, requesting immediate assistance!"
      };
      responseText = defaultResponses[character] || "Radio static... transmission lost...";
    }
    
    console.log(`[generateAIResponse] Final response text: "${responseText}"`);
    
    // Generate audio for the response
    console.log(`[generateAIResponse] Getting voice ID for ${character}`);
    const voiceId = voiceIds[character] || voiceIds['Commander'];
    console.log(`[generateAIResponse] Using voice ID: ${voiceId}`);
    
    console.log(`[generateAIResponse] Calling generateSpeech with text: "${responseText}" and voice ID: ${voiceId}`);
    const audioResult = await generateSpeech(responseText, voiceId);
    console.log(`[generateAIResponse] Audio generation result:`, audioResult);
    
    const result = {
      text: responseText,
      audioPath: audioResult ? audioResult.filename : null
    };
    console.log(`[generateAIResponse] Final response object:`, result);
    
    return result;
  } catch (error) {
    logError('generateAIResponse', error, { character, characterStage });
    return {
      text: "Radio static... transmission lost...",
      audioPath: null
    };
  }
}

// Function to broadcast narrative events to all connected characters
function broadcastNarrativeEvent(eventType) {
  // For each connected desktop client
  for (const [id, desktop] of desktopClients.entries()) {
    if (desktop.current_frequency && frequencies[desktop.current_frequency]) {
      const character = frequencies[desktop.current_frequency].character;
      
      let eventMessage = '';
      if (eventType === 'crisis') {
        // Character-specific crisis messages
        if (character === 'Commander') {
          eventMessage = "ALERT: Multiple breaches detected! All field teams report in immediately!";
        } else if (character === 'Scientist') {
          eventMessage = "The containment field is collapsing! We're out of time!";
        } else if (character === 'Survivor') {
          eventMessage = "The forest... it's changing faster now. The trees are moving!";
        } else if (character === 'Spy') {
          eventMessage = "Security systems are failing! The facility is going into lockdown!";
        } else if (character === 'Pilot') {
          eventMessage = "Mayday! Mayday! Something's pulling us down! Can't maintain altitude!";
        }
      }
      
      if (eventMessage) {
        // Send to desktop
        desktop.socket.emit('ai_response', {
          message: eventMessage,
          character: character,
          isNarrativeEvent: true
        });
        
        // Send to paired mobile if exists
        if (desktop.paired_mobile) {
          const mobileSocket = mobileClients.get(desktop.paired_mobile)?.socket;
          if (mobileSocket) {
            mobileSocket.emit('ai_response', {
              message: eventMessage,
              character: character,
              isNarrativeEvent: true
            });
          }
        }
      }
    }
  }
}

// Implement audio upload endpoint
app.post('/upload-audio', (req, res) => {
  try {
    // Check if we have audio data
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({
        message: 'No audio data provided',
        status: 'error'
      });
    }
    
    // Create a unique filename
    const timestamp = Date.now();
    const filename = `upload_${timestamp}.webm`;
    const dir = path.join(__dirname, 'public', 'generated');
    const filePath = path.join(dir, filename);
    
    // Ensure directory exists
    fs.mkdirSync(dir, { recursive: true });
    
    // Save the audio file
    fs.writeFileSync(filePath, req.body);
    
    // Return success with the file path
    return res.status(200).json({
      message: 'Audio uploaded successfully',
      status: 'success',
      filename: `/generated/${filename}`
    });
  } catch (error) {
    logError('upload-audio', error);
    return res.status(500).json({
      message: 'Error processing audio upload: ' + error.message,
      status: 'error'
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
const isProduction = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_SERVICE_NAME;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  
  if (isProduction) {
    // We're on Railway, use the public URL
    const baseUrl = process.env.RAILWAY_STATIC_URL || 'your Railway URL';
    console.log(`App deployed! Access it at ${baseUrl}`);
    console.log(`Desktop interface: ${baseUrl}/desktop`);
    console.log(`Mobile interface: ${baseUrl}/mobile`);
  } else {
    // Local development
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const localIP = Object.values(nets)
      .flat()
      .find(ip => ip.family === 'IPv4' && !ip.internal)?.address || 'localhost';

    const protocol = server instanceof https.Server ? 'https' : 'http';
    console.log(`Desktop interface: ${protocol}://localhost:${PORT}/desktop`);
    console.log(`Mobile interface: ${protocol}://${localIP}:${PORT}/mobile`);
  }
});
