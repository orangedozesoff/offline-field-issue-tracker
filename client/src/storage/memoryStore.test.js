import { defineStoreContract } from './storeContract.js';
import { createMemoryStore } from './memoryStore.js';

defineStoreContract('memory store', () => createMemoryStore());
