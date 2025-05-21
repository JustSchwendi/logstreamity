// UI management module
export const updateLabels = (isRandomized) => {
  const delayLabel = document.querySelector('label[for="delay"]');
  const volumeLabel = document.querySelector('label[for="lineVolume"]');
  
  if (isRandomized) {
    delayLabel.textContent = 'Maximum Randomized Delay between Lines (ms)';
    volumeLabel.textContent = 'Maximum Randomized Line Volume';
  } else {
    delayLabel.textContent = 'Delay Between Lines (ms)';
    volumeLabel.textContent = 'Line Volume';
  }
};

export const updateAttributeList = (attributeList, selectedAttributes) => {
  attributeList.innerHTML = '';
  selectedAttributes.forEach((value, key) => {
    const item = document.createElement('div');
    item.className = 'flex items-center space-x-2 mb-2';
    item.innerHTML = `
      <input type="text" value="${key}" readonly class="bg-gray-100 rounded px-2 py-1 flex-1" />
      <input type="text" value="${value}" 
        onchange="window.updateAttributeValue('${key}', this.value)"
        class="rounded border px-2 py-1 flex-1" />
      <button onclick="window.removeAttribute('${key}')" 
        class="bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">
        -
      </button>
    `;
    attributeList.appendChild(item);
  });
};