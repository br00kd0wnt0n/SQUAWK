# Radio Narrative Experience

An interactive radio-based narrative experience that combines a desktop radio interface with a mobile walkie-talkie interface. Built with Node.js, Socket.IO, and modern web technologies.

## Features

- Desktop radio interface with tuning dial and signal strength indicators
- Mobile walkie-talkie interface with push-to-talk functionality
- Real-time communication between desktop and mobile clients
- Speech recognition for voice input
- Retro 80s ham radio aesthetic
- Responsive design for both desktop and mobile devices

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Modern web browser (Chrome, Firefox, Safari, Edge)
- For mobile: iOS Safari or Android Chrome recommended

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/fixed-radio-narrative-experience.git
cd fixed-radio-narrative-experience
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your ElevenLabs API key:
```
ELEVENLABS_API_KEY=your_api_key_here
```

4. Start the server:
```bash
npm start
```

The application will be available at:
- Desktop interface: http://localhost:3000/desktop
- Mobile interface: http://localhost:3000/mobile

## Usage

1. Open the desktop interface in a web browser
2. Open the mobile interface on a mobile device (must be on the same network)
3. Enter the pairing code shown on the desktop interface into the mobile interface
4. Use the tuning dial on the desktop to find frequencies
5. Use the push-to-talk button on mobile to communicate

## Development

- `server.js` - Main server file
- `public/desktop/` - Desktop interface files
- `public/mobile/` - Mobile interface files
- `public/shared/` - Shared resources

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request 