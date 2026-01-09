const express = require('express');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Create downloads folder
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Get video info
app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const command = `yt-dlp --dump-json --no-download "${url}"`;
        
        exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('Error:', error.message);
                return res.status(500).json({ error: 'Failed to fetch video info' });
            }

            try {
                const info = JSON.parse(stdout);
                
                // Get available formats
                const formats = info.formats
                    .filter(f => f.vcodec !== 'none' && f.acodec !== 'none')
                    .map(f => ({
                        format_id: f.format_id,
                        quality: f.height || 0,
                        ext: f.ext,
                        filesize: f.filesize || f.filesize_approx || 0
                    }))
                    .filter(f => f.quality > 0);

                // Get best formats for each quality
                const qualityMap = {};
                info.formats.forEach(f => {
                    if (f.height && !qualityMap[f.height]) {
                        qualityMap[f.height] = f.format_id;
                    }
                });

                res.json({
                    id: info.id,
                    title: info.title,
                    thumbnail: info.thumbnail,
                    duration: info.duration,
                    view_count: info.view_count,
                    uploader: info.uploader,
                    available_qualities: Object.keys(qualityMap).map(Number).sort((a, b) => b - a),
                    formats: qualityMap
                });
            } catch (parseError) {
                console.error('Parse error:', parseError);
                res.status(500).json({ error: 'Failed to parse video info' });
            }
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Store download progress
const downloadProgress = new Map();

// Download video
app.post('/api/download', async (req, res) => {
    const { url, quality } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const downloadId = Date.now().toString();
    downloadProgress.set(downloadId, { progress: 0, status: 'starting', filename: '' });

    res.json({ downloadId, message: 'Download started' });

    try {
        // Build yt-dlp command for best quality up to requested
        const qualityNum = parseInt(quality) || 1080;
        const formatString = `bestvideo[height<=${qualityNum}]+bestaudio/best[height<=${qualityNum}]/best`;
        
        const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s');
        
        const args = [
            '-f', formatString,
            '--merge-output-format', 'mp4',
            '-o', outputTemplate,
            '--newline',
            '--progress',
            url
        ];

        const ytdlp = spawn('yt-dlp', args);
        let filename = '';

        ytdlp.stdout.on('data', (data) => {
            const output = data.toString();
            console.log(output);

            // Parse progress
            const progressMatch = output.match(/(\d+\.?\d*)%/);
            if (progressMatch) {
                downloadProgress.set(downloadId, {
                    progress: parseFloat(progressMatch[1]),
                    status: 'downloading',
                    filename
                });
            }

            // Parse filename
            const filenameMatch = output.match(/Destination: (.+)/);
            if (filenameMatch) {
                filename = path.basename(filenameMatch[1]);
            }

            // Check for merge
            if (output.includes('Merging')) {
                downloadProgress.set(downloadId, {
                    progress: 95,
                    status: 'merging',
                    filename
                });
            }
        });

        ytdlp.stderr.on('data', (data) => {
            console.error('stderr:', data.toString());
        });

        ytdlp.on('close', (code) => {
            if (code === 0) {
                // Find the downloaded file
                const files = fs.readdirSync(DOWNLOADS_DIR)
                    .map(f => ({
                        name: f,
                        time: fs.statSync(path.join(DOWNLOADS_DIR, f)).mtime.getTime()
                    }))
                    .sort((a, b) => b.time - a.time);

                const latestFile = files[0]?.name || filename;

                downloadProgress.set(downloadId, {
                    progress: 100,
                    status: 'complete',
                    filename: latestFile,
                    downloadUrl: `/downloads/${encodeURIComponent(latestFile)}`
                });
            } else {
                downloadProgress.set(downloadId, {
                    progress: 0,
                    status: 'error',
                    error: 'Download failed'
                });
            }
        });

    } catch (err) {
        console.error('Download error:', err);
        downloadProgress.set(downloadId, {
            progress: 0,
            status: 'error',
            error: err.message
        });
    }
});

// Get download progress
app.get('/api/progress/:id', (req, res) => {
    const { id } = req.params;
    const progress = downloadProgress.get(id);
    
    if (!progress) {
        return res.status(404).json({ error: 'Download not found' });
    }

    res.json(progress);
});

// List downloaded files
app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv'))
            .map(f => {
                const stats = fs.statSync(path.join(DOWNLOADS_DIR, f));
                return {
                    name: f,
                    size: stats.size,
                    created: stats.mtime,
                    downloadUrl: `/downloads/${encodeURIComponent(f)}`
                };
            })
            .sort((a, b) => new Date(b.created) - new Date(a.created));

        res.json(files);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// Delete a file
app.delete('/api/files/:filename', (req, res) => {
    const { filename } = req.params;
    const filepath = path.join(DOWNLOADS_DIR, filename);

    try {
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ message: 'File deleted' });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 YTmp4 Server running at http://localhost:${PORT}`);
    console.log(`📁 Downloads will be saved to: ${DOWNLOADS_DIR}`);
});
