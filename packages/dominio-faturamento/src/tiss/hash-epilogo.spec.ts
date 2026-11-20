// Regra 3 do M31: o hash MD5 do epílogo cobre todo o conteúdo do cabeçalho ao corpo; qualquer alteração depois de
// montado é detectada (o lote não fica "pronto").
import { beforeAll, describe, expect, it } from 'vitest';
import { cabecalho, spSadt } from './fixtures.spec-util.js';
import { conferirHashEpilogo, mensagemLoteGuias } from './lote.js';
import { type ArquivoEsquema, carregarEsquemas, conferirLote } from './validacao.js';
import { latin1 } from './xml.js';

let esquemas: ArquivoEsquema[];
beforeAll(async () => {
  esquemas = await carregarEsquemas();
});

describe('hash-epilogo', () => {
  it('o mesmo conteúdo dá o mesmo hash; outro conteúdo, outro hash', () => {
    const a = mensagemLoteGuias(cabecalho, '1', [spSadt]);
    const b = mensagemLoteGuias(cabecalho, '1', [spSadt]);
    const c = mensagemLoteGuias(cabecalho, '2', [spSadt]);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('valor alterado depois do hash: não confere e o lote é inválido', async () => {
    const m = mensagemLoteGuias(cabecalho, '3', [spSadt]);
    const xml = m.xml.replace('<ans:valorTotalGeral>24.70<', '<ans:valorTotalGeral>99.70<');
    expect(xml).not.toBe(m.xml);
    expect(conferirHashEpilogo(xml).confere).toBe(false);
    const c = await conferirLote({ ...m, xml, bytes: latin1(xml) }, esquemas);
    expect(c.estado).toBe('invalido');
    expect(c.erros).toContain('hash do epílogo não confere');
  });
});
