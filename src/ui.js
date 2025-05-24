// src/ui.js

export function updateLabels(isRandomized) {
  const delayLabel = document.querySelector('label[for="delay"]');
  const volumeLabel = document.querySelector('label[for="lineVolume"]');
  if (!delayLabel || !volumeLabel) return;
  delayLabel.textContent = isRandomized ? 'Maximum Randomized Delay between Lines (ms)' : 'Delay Between Lines (ms)';
  volumeLabel.textContent = isRandomized ? 'Maximum Randomized Line Volume' : 'Line Volume';
}

export function updateAttributeList(attributeList, selectedAttributes) {
  if (!attributeList) return;
  attributeList.innerHTML = '';
  selectedAttributes.forEach((value, key) => {
    const item = document.createElement('div');
    item.className = 'flex items-center space-x-2 mb-2';
    item.innerHTML = `
      <input type="text" value="${key}" readonly class="bg-gray-100 rounded px-2 py-1 flex-1" />
      <input type="text" value="${value}" onchange="window.updateAttributeValue('${key}', this.value)" class="rounded border px-2 py-1 flex-1" />
      <button onclick="window.removeAttribute('${key}')" class="bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">-</button>
    `;
    attributeList.appendChild(item);
  });
}

export function showAttributeDropdown(input, results, onPick) {
  let dropdown = document.getElementById('attribute-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'attribute-dropdown';
    dropdown.className = 'absolute z-10 w-full bg-white border rounded-b shadow max-h-40 overflow-y-auto';
    input.parentElement.appendChild(dropdown);
  }
  dropdown.innerHTML = '';
  results.forEach(key => {
    const option = document.createElement('div');
    option.className = 'p-2 hover:bg-gray-100 cursor-pointer';
    option.textContent = key;
    option.onclick = () => {
      onPick(key);
      dropdown.style.display = 'none';
    };
    dropdown.appendChild(option);
  });
  dropdown.style.display = results.length ? 'block' : 'none';
}

// Optional: Hide dropdown on click outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('attribute-dropdown');
  if (dropdown && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});
