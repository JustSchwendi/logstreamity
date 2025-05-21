// Configuration management module
export const saveConfig = (endpoint, token) => {
  const config = { endpoint, token };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'config.json';
  a.click();
  URL.revokeObjectURL(url);
};

export const loadConfig = async (file) => {
  try {
    const text = await file.text();
    const config = JSON.parse(text);
    return config;
  } catch (error) {
    console.error('Error loading config:', error);
    return null;
  }
};

export const autoLoadConfig = async () => {
  try {
    const response = await fetch('config.json');
    if (response.ok) {
      const config = await response.json();
      return config;
    }
  } catch (error) {
    console.error('No config file found:', error);
  }
  return null;
};