import express from 'express';
import puppeteer from 'puppeteer-core';

const app = express();
const port = process.env.PORT || 8080;

async function scrapeProducts() {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null,
            executablePath: '/usr/bin/google-chrome',
            args: ['--no-sandbox'],
            channel: 'chrome'
        });

        const page = await browser.newPage();
        page.setDefaultTimeout(2 * 60 * 1000);
        await page.goto('https://www.marukyu-koyamaen.co.jp/english/shop/products/category/matcha/?viewall=1');

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

app.get('/getProducts', async (req, res) => {
    const targetUrl = req.query.targetUrl;

    try {
        const products = await scrapeProducts();
        
        if (targetUrl) {
            // Send the products data to the specified URL
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(products),
            });

            if (!response.ok) {
                throw new Error(`Failed to send data to ${targetUrl}`);
            }

            res.json({ message: 'Products scraped and sent successfully', count: products.length });
        } else {
            // If no targetUrl is provided, return the products JSON directly
            res.json(products);
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'An error occurred while processing the request' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});