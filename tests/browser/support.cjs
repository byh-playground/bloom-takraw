const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || path.join(root, 'artifacts/verification'));
fs.mkdirSync(outputDir, { recursive: true });
const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8766/';
const ports = [Number(process.env.QA_HOST_PORT || 9331), Number(process.env.QA_GUEST_PORT || 9332)];
module.exports = { root, outputDir, baseURL, ports };
