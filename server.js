const express = require('express');
const ergogen = require('ergogen');
const yaml = require('js-yaml');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/process', async (req, res) => {
    try {
        const config = yaml.load(req.body.yaml);
        
        // Pass the config to the official Ergogen engine!
        const result = await ergogen.process(config, true, () => {});
        
        // Ergogen computes EVERYTHING for us. We just need the points.
        res.json({
            points: result.points,
            units: result.units // Evaluated units (u, kx, ky, px, py)
        });
    } catch (error) {
        console.error("Ergogen error:", error);
        res.status(500).json({ error: error.toString() });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Ergogen Outline Tool running at http://localhost:${PORT}`);
});