// src/attributes.js

export function loadAttributes() {
  try {
    const data = JSON.parse(localStorage.getItem('logstreamityAttrs'));
    return new Map(Object.entries(data || {}));
  } catch {
    return new Map();
  }
}

export function saveAttributes(map) {
  const obj = Object.fromEntries(map);
  localStorage.setItem('logstreamityAttrs', JSON.stringify(obj));
}

export function loadAttributesFromFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const obj = JSON.parse(e.target.result);
        resolve(new Map(Object.entries(obj)));
      } catch {
        alert('Invalid JSON in file');
        resolve(new Map());
      }
    };
    reader.readAsText(file);
  });
}

export function fuzzySearchAttributes(search) {
  try {
    const data = JSON.parse(localStorage.getItem('logstreamityAttrs')) || {};
    const keys = Object.keys(data);
    const query = search.toLowerCase().trim();
    return keys.filter(k => k.toLowerCase().includes(query)).slice(0, 8);
  } catch {
    return [];
  }
}
