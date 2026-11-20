// Cores de cada pacote de marca (as únicas cores de marca em hexadecimal do código).
import type { CoresDaMarca } from './cores.js';

/** Rede Santé: vinho #83102c e cinza #96989a (BRIEF §1; cap-03 §3.3). */
export const CORES_REDE_SANTE: CoresDaMarca = { corPrimaria: '#83102c', corSecundaria: '#96989a' };

/** Marca NEUTRA: usada quando MARCA aponta para um pacote não registrado (nunca cai na marca de outra rede). */
export const CORES_NEUTRAS: CoresDaMarca = { corPrimaria: '#334155', corSecundaria: '#94a3b8' };
