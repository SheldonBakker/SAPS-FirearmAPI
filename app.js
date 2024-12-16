require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app = express();
app.use(express.json()); // For parsing JSON request bodies

// Swagger definition
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Firearm Data API',
      version: '3.0.0',
      description: 'API for searching and retrieving South African firearm data',
      contact: {
        name: 'API Support',
        email: 'support@remlic.co.za'
      },
    },
    servers: [
      {
        url: 'https://saps-firearmapi.onrender.com',
        description: 'Production server'
      },
    ],
  },
  apis: [__dirname + '/app.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Extract the scraping logic into a single function
async function performScraping(data) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(process.env.WEBSITE_URL, { waitUntil: 'networkidle2' });

        // Fill in the form fields based on the provided data
        if (data.fref && data.frid) {
            await page.type('#fref', data.fref);
            await page.type('#frid', data.frid);
        } else if (data.fserial && data.fsref) {
            await page.type('#fserial', data.fserial);
            await page.type('#fsref', data.fsref);
        } else if (data.fid && data.fiserial) {
            await page.type('#fid', data.fid);
            await page.type('#fiserial', data.fiserial);
        }

        await page.click('#submit');
        await page.waitForSelector('#response-field');

        const responseHTML = await page.content();
        const $ = cheerio.load(responseHTML);
        const result = $('#response-field').text().trim();

        return result;
    } finally {
        await browser.close();
    }
}

/**
 * @swagger
 * components:
 *   schemas:
 *     FirearmSearch:
 *       type: object
 *       description: Search parameters for firearm lookup
 *       properties:
 *         fref:
 *           type: string
 *           description: Reference number of the firearm
 *           example: "REF123456"
 *         frid:
 *           type: string
 *           description: ID number associated with the firearm
 *           example: "ID789012"
 *         fserial:
 *           type: string
 *           description: Serial number of the firearm
 *           example: "SER345678"
 *         fsref:
 *           type: string
 *           description: Secondary reference number
 *           example: "SREF901234"
 *         fid:
 *           type: string
 *           description: Unique firearm identifier
 *           example: "FID567890"
 *         fiserial:
 *           type: string
 *           description: Internal serial number
 *           example: "ISER123456"
 *     SearchResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the search was successful
 *         result:
 *           type: string
 *           description: The search result data
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 */

/**
 * @swagger
 * /api/firearms/search:
 *   post:
 *     tags:
 *       - Firearms
 *     summary: Search for firearm information
 *     description: Search for firearm details using various identification parameters
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FirearmSearch'
 *     responses:
 *       200:
 *         description: Successful search
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchResponse'
 *       400:
 *         description: Invalid input parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
});

app.post('/api/firearms/search', async (req, res) => {
});
