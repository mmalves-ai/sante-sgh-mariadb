import { describe, expect, it } from 'vitest';
import { modeloSintetico } from './fixtures.spec-util.js';
import { converterModelo } from './mapeamento.js';
import { relatorioMarkdown, totalizar } from './relatorio.js';

describe('relatório da conversão', () => {
  it('totaliza e escreve o Markdown com pendências e classes', async () => {
    const m = modeloSintetico();
    const ok = await converterModelo(m);
    const comPendencia = await converterModelo({
      ...m,
      modelo: { ...m.modelo, id: 9002, codigo: null },
      componentes: m.componentes.map((c) =>
        c.idVinculo === 3 ? { ...c, dfm: c.dfm.replace("'Grave'", "'Gravissimo'"), classe: c.classe } : c,
      ),
    });
    const t = totalizar([ok, comPendencia]);
    expect(t).toMatchObject({
      modelos: 2,
      componentes: 10,
      componentesMapeados: 10,
      classesDesconhecidas: 0,
    });
    expect(t.escolhasPendentes).toBe(1);
    const md = relatorioMarkdown([ok, comPendencia], {
      estabelecimento: 'zz',
      data: '2026-10-19',
      arquivoDe: (r) => `${r.modelo.id}.json`,
    });
    expect(md).toContain('| Componentes mapeados | 10 de 10 |');
    expect(md).toContain('Gravissimo');
    expect(md).toContain('`9002.json`');
    expect(md).toContain('| `TfRespAlergia` | 0 |');
    const vazio = relatorioMarkdown([ok], {
      estabelecimento: 'zz',
      data: '2026-10-19',
      arquivoDe: () => 'x.json',
    });
    expect(vazio).toContain('| (nenhuma) | 0 |');
    expect(vazio).toContain('Nenhuma.');
  });
});
