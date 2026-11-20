// `pnpm sgh:aplicar` sobre a cópia (ficha do M04, seção 10): os scripts estão aplicados e registrados com o
// hash do arquivo; a nova execução não aplica nada (idempotente).
import { resolve } from 'node:path';
import { lerScriptsSgh } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, PODE_ESCREVER, prepararAmbiente, raiz } from './escrita.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('sgh:aplicar de novo (idempotente)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('0 aplicado; todos já registrados com o hash do arquivo', async () => {
    const scripts = lerScriptsSgh(resolve(raiz, 'packages/legado/src'));
    // A cópia de dev é compartilhada pelos ramos em paralelo (um marco por worktree): os registros de outro ramo
    // são aceitos só em dev, como no `pnpm sgh:aplicar -- --aceitar-outros-ramos`; o hash dos daqui é conferido.
    const r = await a.nucleo.aplicarScriptsSgh(a.cod, scripts, {
      ambiente: 'dev',
      aceitarDeOutrosRamos: true,
    });
    expect(r.aplicados).toHaveLength(0);
    expect(r.jaAplicados).toBe(scripts.length);
    console.log(`[${a.cod}] sgh:aplicar de novo: 0 aplicado; ${r.jaAplicados} já registrados`);
  });
});
