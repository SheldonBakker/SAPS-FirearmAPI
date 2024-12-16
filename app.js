require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const NodeCache = require('node-cache');
const genericPool = require('generic-pool');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');

const app = express();
app.use(express.json()); // For parsing JSON request bodies
app.use(compression());

// Swagger definition
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SA Firearm API',
      version: '3.2.2',
      description: 'API for searching and retrieving South African firearm data.',
      contact: {
        name: 'API Support',
        email: 'support@remlic.co.za',
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

// Enhanced SwaggerUI setup with custom options
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs, {
  customSiteTitle: "SA Firearm API Documentation",
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { font-size: 36px; color: #2c3e50; }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui .scheme-container { box-shadow: none; }
    .swagger-ui .info .description { font-size: 16px; line-height: 1.6; }
    .swagger-ui .opblock-tag { font-size: 24px; border-bottom: 2px solid #eee; }
    .swagger-ui .opblock { margin: 0 0 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .swagger-ui .opblock .opblock-summary { padding: 15px; }
    .swagger-ui .btn { border-radius: 4px; }
    .swagger-ui select { border-radius: 4px; }
    .swagger-ui .parameter__name { font-weight: 600; color: #2c3e50; }
    .swagger-ui .parameter__type { color: #34495e; }
    .swagger-ui table tbody tr td { padding: 10px; }
    .swagger-ui .responses-table { background: #fff; }
    /* Logo styles */
    .swagger-ui .topbar-wrapper img {
      content: url('https://i.ibb.co/Yfq9bxj/SAPSAPI.png');
      width: 150px;
      height: auto;
      margin-right: 10px;
    }
    /* Add logo before the title */
    .swagger-ui .info::before {
      content: '';
      background: url('https://i.ibb.co/Yfq9bxj/SAPSAPI.png') no-repeat center;
      background-size: contain;
      display: block;
      width: 200px;
      height: 60px;
      margin-bottom: 20px;
    }
  `,
  customfavIcon: "https://i.ibb.co/Yfq9bxj/SAPSAPI.png",
  swaggerOptions: {
    persistAuthorization: true,
    filter: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 3,
    defaultModelExpandDepth: 3,
    tryItOutEnabled: true,
    showExtensions: true,
    showCommonExtensions: true
  }
}));

// Redirect root to API documentation
app.get('/', (req, res) => {
    res.redirect('/api-docs');
});

// Create a pool of browser instances
const browserPool = genericPool.createPool({
    create: async () => {
        return await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    },
    destroy: async (browser) => {
        await browser.close();
    }
}, {
    min: 2, // Minimum browsers in pool
    max: 10 // Maximum browsers in pool
});

// Extract the scraping logic into a single function
async function performScraping(data) {
    const browser = await browserPool.acquire();
    const page = await browser.newPage();
    
    try {
        // Set timeout for navigation
        await page.setDefaultNavigationTimeout(30000);
        await page.setDefaultTimeout(30000);
        
        // Improved request interception
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue().catch(() => {});
            }
        });
        
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
    } catch (error) {
        console.error('Scraping error:', error);
        throw new Error('Failed to fetch data');
    } finally {
        await browserPool.release(browser);
    }
}

/**
 * @swagger
 * components:
 *   schemas:
 *     FirearmSearch:
 *       type: object
 *       description: |
 *         Search parameters for firearm lookup. There are three search options available:
 *         1. Reference Number + ID/Institution Number
 *         2. Serial Number + Reference Number
 *         3. ID/Institution Number + Serial Number
 *         You must provide exactly one pair of parameters.
 *       properties:
 *         fref:
 *           type: string
 *           description: Reference Number for Option 1
 *           example: "REF123456"
 *           minLength: 1
 *         frid:
 *           type: string
 *           description: ID/Institution Number for Option 1
 *           example: "8001015009087"
 *           minLength: 1
 *         fserial:
 *           type: string
 *           description: Serial Number for Option 2
 *           example: "SN789012"
 *           minLength: 1
 *         fsref:
 *           type: string
 *           description: Reference Number for Option 2
 *           example: "REF456789"
 *           minLength: 1
 *         fid:
 *           type: string
 *           description: ID/Institution Number for Option 3
 *           example: "8001015009087"
 *           minLength: 1
 *         fiserial:
 *           type: string
 *           description: Serial Number for Option 3
 *           example: "SN123456"
 *           minLength: 1
 *       oneOf:
 *         - required: ['fref', 'frid']
 *         - required: ['fserial', 'fsref']
 *         - required: ['fid', 'fiserial']
 *       examples:
 *         option1:
 *           value:
 *             fref: "REF123456"
 *             frid: "8001015009087"
 *         option2:
 *           value:
 *             fserial: "SN789012"
 *             fsref: "REF456789"
 *         option3:
 *           value:
 *             fid: "8001015009087"
 *             fiserial: "SN123456"
 *     SearchResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indicates if the search operation was successful
 *           example: true
 *         result:
 *           type: string
 *           description: Detailed information about the firearm search result
 *           example: "Firearm status: Valid license. Owner: John Doe. Type: Handgun."
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Detailed error message explaining what went wrong
 *           example: "Invalid input parameters. Please provide either fref+frid, fserial+fsref, or fid+fiserial."
 *         code:
 *           type: string
 *           description: Error code for programmatic handling
 *           example: "INVALID_PARAMETERS"
 */

/**
 * @swagger
 * tags:
 *   - name: Firearms
 *     description: Operations related to firearm information lookup
 * 
 * /api/firearms/search:
 *   post:
 *     tags:
 *       - Firearms
 *     summary: Search for firearm information
 *     description: |
 *       Search for firearm details using various identification parameters.
 *       This endpoint allows three different search combinations:
 *       1. Reference Number + ID/Institution Number
 *       2. Serial Number + Reference Number
 *       3. ID/Institution Number + Serial Number
 *       
 *       **Note:** Only one combination should be used per request.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FirearmSearch'
 *           examples:
 *             searchByRefAndId:
 *               summary: Search by Reference and ID
 *               value:
 *                 fref: "REF123456"
 *                 frid: "8001015009087"
 *             searchBySerialAndRef:
 *               summary: Search by Serial and Reference
 *               value:
 *                 fserial: "SN789012"
 *                 fsref: "REF456789"
 *     responses:
 *       200:
 *         description: Successfully retrieved firearm information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchResponse'
 *             example:
 *               success: true
 *               result: "Firearm status: Valid license. Owner: John Doe. Type: Handgun."
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid input parameters. Please provide either fref+frid, fserial+fsref, or fid+fiserial."
 *               code: "INVALID_PARAMETERS"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "An unexpected error occurred while processing your request."
 *               code: "INTERNAL_SERVER_ERROR"
 */

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Swagger documentation available at http://localhost:${PORT}/api-docs`);
});

const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);

// Add this validation middleware before your route handler
const validateFirearmSearch = [
    body().custom((value, { req }) => {
        const { fref, frid, fserial, fsref, fid, fiserial } = req.body;
        
        // Check if exactly one pair of parameters is provided
        const pairs = [
            !!(fref && frid),
            !!(fserial && fsref),
            !!(fid && fiserial)
        ];
        
        if (pairs.filter(Boolean).length !== 1) {
            throw new Error('Please provide exactly one valid pair of parameters');
        }
        
        // Validate individual fields if present
        if (fref) {
            if (!/^[A-Za-z0-9]{6,}$/.test(fref)) {
                throw new Error('Reference number must be at least 6 alphanumeric characters');
            }
        }
        
        if (frid) {
            if (!/^\d{13}$/.test(frid)) {
                throw new Error('ID number must be exactly 13 digits');
            }
        }
        
        if (fserial) {
            if (!/^[A-Za-z0-9]{4,}$/.test(fserial)) {
                throw new Error('Serial number must be at least 4 alphanumeric characters');
            }
        }
        
        if (fsref) {
            if (!/^[A-Za-z0-9]{6,}$/.test(fsref)) {
                throw new Error('Reference number must be at least 6 alphanumeric characters');
            }
        }
        
        if (fid) {
            if (!/^\d{13}$/.test(fid)) {
                throw new Error('ID number must be exactly 13 digits');
            }
        }
        
        if (fiserial) {
            if (!/^[A-Za-z0-9]{4,}$/.test(fiserial)) {
                throw new Error('Serial number must be at least 4 alphanumeric characters');
            }
        }
        
        return true;
    }),
    // Sanitize all inputs
    body('*').trim().escape()
];

// Modify your route to use the validation
app.post('/api/firearms/search', validateFirearmSearch, async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array(),
                code: 'VALIDATION_ERROR'
            });
        }

        // Create a cache key from the request parameters
        const cacheKey = JSON.stringify(req.body);
        
        // Check cache first
        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            return res.json({
                success: true,
                result: cachedResult
            });
        }

        // If not in cache, perform scraping
        const result = await performScraping(req.body);
        
        // Store in cache
        cache.set(cacheKey, result);
        
        res.json({
            success: true,
            result: result
        });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({
            success: false,
            error: 'An unexpected error occurred while processing your request.',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
});
