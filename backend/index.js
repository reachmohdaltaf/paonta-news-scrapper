const express = require('express');
const Parser = require('rss-parser');
const cors = require('cors');
const sharp = require('sharp'); // npm install sharp
const fetch = require('node-fetch'); // npm install node-fetch
require('dotenv').config(); // npm install dotenv

const app = express();
app.use(cors());
app.use(express.json());

const parser = new Parser();
const DEFAULT_RSS = 'https://news.google.com/rss/search?q=Paonta+Sahib&hl=hi&gl=IN&ceid=IN:hi';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Put your Gemini API key in .env

// Function to clean headline by removing news source
function cleanHeadline(headline) {
  const cleaned = headline.replace(/\s-\s[^-]*$/, '');
  return cleaned.trim();
}

// Fetch news
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

// Generate post image endpoint
app.post('/generate-post', async (req, res) => {
  try {
    const { headline } = req.body;
    if (!headline) return res.status(400).json({ error: 'Headline is required' });

    const cleanedHeadline = cleanHeadline(headline);
    const width = 1080, height = 1080;

    const svgPost = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .title-text { font-family: 'Arial', sans-serif; font-size: 48px; font-weight: bold; fill: white; text-anchor: middle; dominant-baseline: middle; }
      .brand-text { font-family: 'Arial', sans-serif; font-size: 36px; font-weight: bold; fill: #FFDE59; text-anchor: start; dominant-baseline: middle; }
      .date-text { font-family: 'Arial', sans-serif; font-size: 24px; fill: #cccccc; text-anchor: end; dominant-baseline: middle; }
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

// Generate AI description + hashtags with Gemini
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
        "X-goog-api-key": "AIzaSyABbhtCpI3qj1m6jMvSAPtynWbuhxs4hFM"
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

// Helper to wrap SVG text
function wrapText(text, x, y, fontSize, lineHeight, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = [];

  words.forEach(word => {
    const testLine = [...currentLine, word].join(' ');
    const textWidth = testLine.length * (fontSize * 0.6);
    if (textWidth <= maxWidth && currentLine.length < 8) currentLine.push(word);
    else { if (currentLine.length > 0) { lines.push(currentLine.join(' ')); currentLine = [word]; } }
  });

  if (currentLine.length > 0) lines.push(currentLine.join(' '));
  const totalHeight = lines.length * lineHeight;
  const startY = y - (totalHeight / 2) + (lineHeight / 2);
  return lines.map((line, index) => `<text x="${x}" y="${startY + (index * lineHeight)}" class="title-text">${line}</text>`).join('\n  ');
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Paonta News Scraper running on port ${PORT}`));
