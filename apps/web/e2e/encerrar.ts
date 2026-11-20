// globalTeardown do Playwright: apaga a pasta temporária curta do Chrome, se foi preciso criá-la.
import { resolve } from 'node:path';
import { limparTmpDoNavegador } from './navegador.js';

export default function encerrar(): void {
  limparTmpDoNavegador(resolve(import.meta.dirname, '../../..'));
}
