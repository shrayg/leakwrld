#!/usr/bin/env node
/**
 * Checkout styles live in `client/src/pages/checkout/checkout-page.css`.
 * Previously this script scraped `<style>` from legacy `checkout.html`; that file was removed after the React migration.
 *
 * Usage: edit checkout-page.css directly (and run `npm run build` for production).
 */
console.log(
  'Skipping extract: checkout UI styles are maintained in client/src/pages/checkout/checkout-page.css',
);
