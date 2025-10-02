/**
 * Example: Using Sticky Sessions with Steel Browser
 *
 * This example demonstrates how to use sticky sessions to maintain
 * browser state (cookies, localStorage, fingerprint) across multiple sessions.
 */

import Steel from 'steel-sdk';
import puppeteer from 'puppeteer-core';

const client = new Steel({
  baseURL: "http://localhost:3000",
});

// User UUID for sticky session
const userId = "550e8400-e29b-41d4-a716-446655440000";

async function firstSession() {
  console.log("=== First Session: Setting up user data ===");

  // Create session with userId to enable sticky sessions
  const session = await client.sessions.create({
    userId,
    blockAds: true,
    dimensions: { width: 1280, height: 800 },
  });

  console.log(`Session created: ${session.id}`);

  // Connect with Puppeteer
  const browser = await puppeteer.connect({
    browserWSEndpoint: session.websocketUrl,
  });

  const page = await browser.newPage();

  // Visit a website and set some data
  await page.goto('https://example.com');

  // Set localStorage data
  await page.evaluate(() => {
    localStorage.setItem('user_preference', 'dark_mode');
    localStorage.setItem('language', 'en');
  });

  // Set a cookie
  await page.setCookie({
    name: 'session_token',
    value: 'abc123xyz',
    domain: 'example.com',
  });

  console.log("Data set in first session");

  await browser.close();

  // Release the session (this saves data to Redis)
  await client.sessions.release(session.id);
  console.log("Session released and data persisted");
}

async function secondSession() {
  console.log("\n=== Second Session: Restoring user data ===");

  // Create a new session with the same userId
  const session = await client.sessions.create({
    userId, // Same user ID = data will be restored!
    blockAds: true,
    dimensions: { width: 1280, height: 800 },
  });

  console.log(`Session created: ${session.id}`);

  // Connect with Puppeteer
  const browser = await puppeteer.connect({
    browserWSEndpoint: session.websocketUrl,
  });

  const page = await browser.newPage();
  await page.goto('https://example.com');

  // Verify localStorage data is restored
  const [preference, language] = await page.evaluate(() => {
    return [
      localStorage.getItem('user_preference'),
      localStorage.getItem('language'),
    ];
  });

  console.log(`Restored localStorage - preference: ${preference}, language: ${language}`);

  // Verify cookies are restored
  const cookies = await page.cookies();
  const sessionCookie = cookies.find(c => c.name === 'session_token');

  console.log(`Restored cookie - session_token: ${sessionCookie?.value}`);

  await browser.close();
  await client.sessions.release(session.id);
  console.log("Session released");
}

// Run the example
async function main() {
  try {
    await firstSession();

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 2000));

    await secondSession();

    console.log("\n✅ Sticky session example completed successfully!");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
