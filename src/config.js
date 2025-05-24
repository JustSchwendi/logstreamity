// Config save/load/auto logic for Logstreamity

const CONFIG_KEY = 'logstreamityConfig';

export function saveConfig(endpoint, token) {
  const config = { endpoint, token };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  alert('Configuration saved to browser storage.');
}

export async function loadConfig(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const config = JSON.parse(e.target.result);
        if (config.endpoint && config.token) {
          resolve(config);
        } else {
          alert('Invalid config file.');
          resolve(null);
        }
      } catch (e) {
        alert('Could not parse config file.');
        resolve(null);
      }
    };
    reader.readAsText(file);
  });
}

export async function autoLoadConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
