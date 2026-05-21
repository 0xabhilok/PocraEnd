// The local AI models a user can choose from.
// Accuracy figures come from the 28-case benchmark in test-accuracy.js.

export const MODELS = [
  {
    id: 'qwen2.5:0.5b',
    name: 'Qwen 2.5 — 0.5B',
    disk: '~0.4 GB',
    ramGB: 3,
    accuracy: '71%',
    blurb: 'Tiny and fast, but weak — it flags almost everything as a distraction. Only for very old or low-RAM PCs.',
    weak: true
  },
  {
    id: 'qwen2.5:1.5b',
    name: 'Qwen 2.5 — 1.5B',
    disk: '~1 GB',
    ramGB: 4,
    accuracy: '89%',
    blurb: 'Lightweight and decent. A good fit for older laptops or limited RAM.'
  },
  {
    id: 'phi3.5',
    name: 'Phi-3.5',
    disk: '~2.2 GB',
    ramGB: 8,
    accuracy: '100%',
    blurb: 'Best accuracy in our tests. The recommended choice for most computers.'
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 — 3B',
    disk: '~2 GB',
    ramGB: 8,
    accuracy: '96%',
    blurb: 'A strong alternative to Phi-3.5, from Meta.'
  }
];

export const DEFAULT_MODEL = 'phi3.5';

// Pick the best model the device can comfortably run, based on total RAM.
export function recommendedModel(totalRamGB) {
  if (!totalRamGB || totalRamGB >= 8) return 'phi3.5';
  if (totalRamGB >= 4) return 'qwen2.5:1.5b';
  return 'qwen2.5:0.5b';
}

export function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}
