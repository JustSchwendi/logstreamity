// Log ingestion module
export const processEndpointUrl = (url) => {
  url = url.trim().replace(/\/$/, '');
  url = url.replace('.apps.', '.');
  
  if (!url.endsWith('/api/v2/logs/ingest')) {
    url = url.split('/').slice(0, 3).join('/');
    url = `${url}/api/v2/logs/ingest`;
  }
  
  return url;
};

export const buildPayload = (line, selectedAttributes) => {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    payload = { content: line };
  }

  selectedAttributes.forEach((value, key) => {
    payload[key] = value;
  });

  return payload;
};

export const sendLogBatch = async (endpoint, token, lines, selectedAttributes) => {
  const payloads = lines.map(line => buildPayload(line, selectedAttributes));
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payloads)
    });

    return response.ok;
  } catch (error) {
    console.error('Network error:', error);
    return false;
  }
};