import express from 'express';
import bodyParser from 'body-parser';
import puppeteer from 'puppeteer-core';
import Airtable from 'airtable';
import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// Add Airtable configuration
const base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base(process.env.AIRTABLE_BASE_ID);
const table = base(process.env.AIRTABLE_TABLE_NAME);

// Middleware to parse JSON bodies
app.use(bodyParser.json());

async function scrapeProducts() {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null,
            executablePath: '/usr/bin/google-chrome', //Comment this out for local testing
            args: ['--no-sandbox'],
            channel: 'chrome'
        });

        const page = await browser.newPage();
        page.setDefaultTimeout(2 * 60 * 1000);
        await page.goto(process.env.SCRAPING_URL);

        const products = await page.evaluate(() => {
            const productElements = document.querySelectorAll('.product');
            return Array.from(productElements).map(product => {
              const nameElement = product.querySelector('.product-name');
              const productType = product.querySelector('span > span.product-flash');
              const priceElement = product.querySelector('.price');
              const imageElement = product.querySelector('.product-image img');

              // Check for stock status
              let stockStatus;
              if (product.classList.contains('outofstock')) {
                stockStatus = 'Out of Stock';
                } else if (product.classList.contains('instock')) {
                    stockStatus = 'In Stock';
                } else {
                    stockStatus = 'Status Unknown';
                }

              return {
                name: nameElement ? nameElement.innerText.trim() : 'Name not found',
                product: productType ? productType.innerText.trim() : 'Product Type not found',
                price: priceElement ? priceElement.innerText.trim() : 'Price not found',
                imageUrl: imageElement ? imageElement.src : 'Image not found',
                stockStatus: stockStatus
              };
            });
        });

        return products;
    } catch (error) {
        console.error('scrape failed', error);
        throw error;
    } finally {
        await browser?.close();
    }
}

// Helper function to escape HTML special characters
function escapeHTML(unsafeText) {
    return unsafeText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

app.get('/getProducts', async (req, res) => {
    try {
        const scrapedProducts = await scrapeProducts();
        
        // Fetch all records from Airtable
        const airtableRecords = await table.select().all();
        
        // Initialize arrays to collect messages and updates
        let telegramMessages = [];
        let airtableUpdates = [];

        // Process each product
        for (const product of scrapedProducts) {
            const matchingRecord = airtableRecords.find(record => record.get('Item') === product.name);

            if (matchingRecord) {
                if (product.stockStatus !== matchingRecord.fields.Stock) {
                    // Stock status has changed, prepare Telegram message
                    const message = `<b>Item:</b> ${escapeHTML(product.name)} <i>Price:</i> ${escapeHTML(product.price)} <b>${escapeHTML(product.stockStatus)}</b>`;
                    telegramMessages.push(message);
                    
                    console.log(`Item name: ${matchingRecord.fields.Item} ID: ${matchingRecord.id}`);
                    //Prepare Airtable update
                    airtableUpdates.push({
                        id: matchingRecord.id,
                        fields: {
                            Price: product.price,
                            Stock: product.stockStatus
                        }
                    });
                } else {
                    console.log(`Stock status unchanged for ${product.name}`);
                }
            } else {
                console.log(`Product not found in Airtable: ${product.name}`);
            }
        }

        // After the loop, send batched Telegram messages
        if (telegramMessages.length > 0) {
            const batchedMessage = telegramMessages.join('\n\n');
            try {
                await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: process.env.TELEGRAM_CHAT_ID,
                    text: batchedMessage,
                    parse_mode: 'HTML'
                });
                console.log('Batched Telegram messages sent successfully');
            } catch (error) {
                console.error('Error sending batched Telegram messages:', error);
            }
        }

        // After the loop, update Airtable records in batches
        if (airtableUpdates.length > 0) {
            try {
                // Airtable allows up to 10 records per request, so we'll chunk the updates
                for (let i = 0; i < airtableUpdates.length; i += 10) {
                    const chunk = airtableUpdates.slice(i, i + 10);
                    await table.update(chunk);
                }
                console.log('Airtable records updated successfully');
            } catch (error) {
                console.error('Error updating Airtable records:', error);
            }
        }

        res.json({ message: 'Products scraped and Airtable updated successfully', count: scrapedProducts.length });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred while processing the request' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});