// service-worker.js
self.addEventListener('fetch', event => {
  if (event.request.url.endsWith('/api/webhook') && event.request.method === 'POST') {
    event.respondWith(handleWebhook(event.request));
  }
});

async function handleWebhook(request) {
  // Simulate custom API logic
  return new Response('Webhook handled by Service Worker!', { status: 200 });
}
