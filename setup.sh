#!/bin/bash

echo "🎬 YTmp4 - YouTube to MP4 Converter Setup"
echo "=========================================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js $(node -v) detected"
echo "✅ npm $(npm -v) detected"
echo ""

# Install yt-dlp if not present
if ! command -v yt-dlp &> /dev/null; then
    echo "📥 Installing yt-dlp..."
    pip install yt-dlp --quiet
    if [ $? -eq 0 ]; then
        echo "✅ yt-dlp installed successfully"
    else
        echo "⚠️ Trying alternative installation..."
        curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp 2>/dev/null || \
        wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O ~/.local/bin/yt-dlp 2>/dev/null
        chmod +x ~/.local/bin/yt-dlp 2>/dev/null || true
    fi
else
    echo "✅ yt-dlp $(yt-dlp --version) detected"
fi
echo ""

# Install npm dependencies
echo "📦 Installing Node.js dependencies..."
npm install
echo ""

# Create downloads directory
mkdir -p downloads
echo "✅ Downloads directory created"
echo ""

echo "=========================================="
echo "🚀 Setup complete!"
echo ""
echo "To start the server, run:"
echo "  npm start"
echo ""
echo "Then open: http://localhost:3000/Index.html"
echo ""
echo "Downloads will be saved to: ./downloads/"
echo "=========================================="
