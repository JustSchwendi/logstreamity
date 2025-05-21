// Attributes management module
export const loadAttributes = async () => {
  try {
    const response = await fetch('attributes.json');
    const attributes = await response.json();
    return attributes;
  } catch (error) {
    console.error('Error loading attributes:', error);
    return [];
  }
};

export const saveAttributes = (attributes) => {
  const attributeObject = {};
  attributes.forEach((key, value) => {
    attributeObject[key] = value;
  });
  
  const blob = new Blob([JSON.stringify(attributeObject, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'attributes.json';
  a.click();
  URL.revokeObjectURL(url);
};

export const loadAttributesFromFile = async (file) => {
  try {
    const text = await file.text();
    return JSON.parse(text);
  } catch (error) {
    console.error('Error loading attributes from file:', error);
    return {};
  }
};