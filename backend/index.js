const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const sharp = require('sharp'); 
const fetch = require('node-fetch');
require('dotenv').config();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- Serve frontend (index.html + css) ---
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const parser = new Parser();
const DEFAULT_RSS = 'https://news.google.com/rss/search?q=Paonta+Sahib&hl=hi&gl=IN&ceid=IN:hi';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Helper: Clean headline ---
function cleanHeadline(headline) {
  const cleaned = headline.replace(/\s-\s[^-]*$/, '');
  return cleaned.trim();
}

// --- Fetch news ---
app.get('/scrape', async (req, res) => {
  try {
    const url = req.query.customUrl || DEFAULT_RSS;
    const feed = await parser.parseURL(url);
    const today = new Date().toDateString();

    const newsItems = feed.items
      .filter(item => new Date(item.pubDate).toDateString() === today)
      .map(item => ({
        headline: cleanHeadline(item.title),
        url: item.link,
        date: item.pubDate,
        content: item.contentSnippet
      }));

    res.json({ news: newsItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch news.' });
  }
});

// --- Generate post image ---
app.post('/generate-post', async (req, res) => {
  try {
    const { headline } = req.body;
    if (!headline) return res.status(400).json({ error: 'Headline is required' });

    const cleanedHeadline = cleanHeadline(headline);
    const width = 1080, height = 1080;

    // SVG with Google Fonts embed (Noto Sans)
    const svgPost = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap');
      .title-text { font-family: 'Noto Sans', sans-serif; font-size: 48px; font-weight: bold; fill: white; text-anchor: middle; dominant-baseline: middle; }
      .brand-text { font-family: 'Noto Sans', sans-serif; font-size: 36px; font-weight: bold; fill: #FFDE59; text-anchor: start; dominant-baseline: middle; }
      .date-text { font-family: 'Noto Sans', sans-serif; font-size: 24px; fill: #cccccc; text-anchor: end; dominant-baseline: middle; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#22201F"/>
  <text x="60" y="100" class="brand-text">Zafaroo News</text>
  <text x="${width-60}" y="100" class="date-text">${new Date().toLocaleDateString('hi-IN', { day:'numeric', month:'long', year:'numeric' })}</text>
  ${wrapText(cleanedHeadline, width/2, height/2, 48, 60, width-120)}
  <rect x="60" y="${height-120}" width="${width-120}" height="4" fill="#FFDE59"/>
</svg>
`;

    const imageBuffer = await sharp(Buffer.from(svgPost)).png().toBuffer();
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="zafaroo-news-post-${Date.now()}.png"`
    });
    res.send(imageBuffer);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate post image' });
  }
});

// --- Generate AI description ---
app.post('/generate-ai', async (req, res) => {
  try {
    const { headline } = req.body;
    if (!headline) return res.status(400).json({ error: 'Headline is required' });

    const apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const payload = {
      contents: [
        { parts: [ { text: `Write a short social media description with hashtags for this headline: "${headline}"` } ] }
      ]
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const aiContent = data.candidates?.[0]?.content?.[0]?.text || "Failed to generate content";

    res.json({ content: aiContent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate AI content' });
  }
});

// --- Helper: wrap text in SVG ---
function wrapText(text, x, y, fontSize, lineHeight, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = [];

  words.forEach(word => {
    const testLine = [...currentLine, word].join(' ');
    const textWidth = testLine.length * (fontSize * 0.6);
    if (textWidth <= maxWidth && currentLine.length < 8) currentLine.push(word);
    else {
      if (currentLine.length > 0) {
        lines.push(currentLine.join(' '));
        currentLine = [word];
      }
    }
  });

  if (currentLine.length > 0) lines.push(currentLine.join(' '));
  const totalHeight = lines.length * lineHeight;
  const startY = y - (totalHeight / 2) + (lineHeight / 2);
  return lines.map((line, index) =>
    `<text x="${x}" y="${startY + (index * lineHeight)}" class="title-text">${line}</text>`
  ).join('\n  ');
}

// --- Start server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Paonta News Scraper running on port ${PORT}`));
