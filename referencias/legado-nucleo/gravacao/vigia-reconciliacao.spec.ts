// W0-02 (D-CRUD-SEM-GATILHO): a comparação pura dos retratos da vigia de reconciliação (a leitura e a gravação são
// provadas na cópia, em packages/testes/src/integracao/crud-motor-w002.int.spec.ts).
import type { DeclaracaoDominio } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { BancoRoteiro } from '../banco-roteiro.spec-util.js';
import {
  chavesDoAchado,
  chavesQueCabem,
  compararRetratos,
  excluidasPeloSanteDesde,
  inicioDaBusca,
  lerRetratoVigia,
  MARGEM_VIGIA_MS,
  TAMANHO_CHAVES_ACHADO,
  relatorioExclusoesFora,
  type RetratoVigia,
  rodarVigia,
  TETO_CHAVES_VIGIA,
  ultimoRetratoVigia,
  vigiaLigada,
} from './vigia-reconciliacao.js';

const r = (chaves: string[], checksum = chaves.length): RetratoVigia => ({
  tabela: 'T',
  contagem: chaves.length,
  checksum,
  chaves,
});

describe('vigia de reconciliação: comparação dos retratos', () => {
  it('sem mudança de contagem nem de checksum: nada a relatar', () => {
    expect(compararRetratos(r(['1', '2']), r(['1', '2']), new Set())).toBeNull();
  });
  it('separa as chaves que o Sante excluiu das que sumiram por fora', () => {
    expect(compararRetratos(r(['1', '2', '3']), r(['1']), new Set(['2']))).toEqual({
      tabela: 'T',
      contagemAntes: 3,
      contagemDepois: 1,
      peloSante: ['2'],
      foraDoSante: ['3'],
    });
  });
  it('só exclusões do Sante (ou só inclusões): nada a relatar', () => {
    expect(compararRetratos(r(['1', '2']), r(['1']), new Set(['2']))).toBeNull();
    expect(compararRetratos(r(['1']), r(['1', '9'], 99), new Set())).toBeNull();
  });
  it('sem as chaves (acima do teto): a queda da contagem além das do Sante conta como de fora', () => {
    const antes: RetratoVigia = { tabela: 'T', contagem: 30_000, checksum: 1, chaves: [] };
    const depois: RetratoVigia = { tabela: 'T', contagem: 29_997, checksum: 2, chaves: [] };
    expect(compararRetratos(antes, depois, new Set(['5']))?.foraDoSante).toEqual(['?1', '?2']);
  });
});

describe('vigia de reconciliação sobre o banco por roteiro (leitura e gravação só em SGH_)', () => {
  const decl = {
    tabela: 'TBDOM',
    chave: 'ID',
    publico: {},
  } as unknown as DeclaracaoDominio;

  it('desligada: nada é lido nem gravado', async () => {
    const b = new BancoRoteiro();
    expect(await rodarVigia(b.tx(), 'pc', [decl])).toEqual({ ligada: false, tabelas: 0, achados: [] });
    expect(b.de(/TBDOM/)).toHaveLength(0);
    expect(await vigiaLigada(b.tx(), 'pc')).toBe(false);
  });

  it('ligada: primeira leitura só guarda o retrato; a seguinte acha a chave que sumiu por fora', async () => {
    let retratos: Record<string, unknown>[] = [];
    const b = new BancoRoteiro()
      .quando(/FROM SGH_CFG_PARAMETRO/, [{ VALOR: 'sim ' }])
      .quando(/SELECT COUNT\(\*\) N, COALESCE\(SUM/, () =>
        retratos.length === 0 ? [{ N: 3, S: 30 }] : [{ N: 1, S: 10 }],
      )
      .quando(/SELECT .* K FROM TBDOM/, () =>
        retratos.length === 0 ? [{ K: '1' }, { K: '2' }, { K: '3' }] : [{ K: '1' }],
      )
      .quando(/FROM SGH_CRUD_VIGIA_RETRATO/, () =>
        retratos.length === 0
          ? []
          : [
              {
                ID: '5',
                CONTAGEM: 3,
                CHECKSUM: 30,
                CHAVES: Buffer.from('["1","2","3"]'),
                LIDO_EM: new Date(),
              },
            ],
      )
      .quando(/INSERT INTO SGH_CRUD_VIGIA_RETRATO/, (p) => {
        retratos = [...retratos, { p }];
        return { ID: String(retratos.length + 5) };
      })
      .quando(/FROM SGH_CRUD_EVENTO WHERE/, [{ CHAVE: '2' }])
      .quando(/FROM SGH_HIST_EXCLUSAO WHERE/, []);
    const primeira = await rodarVigia(b.tx(), 'pc', [decl, decl]);
    expect(primeira).toEqual({ ligada: true, tabelas: 1, achados: [] });
    const segunda = await rodarVigia(b.tx(), 'pc', [decl]);
    expect(segunda.achados).toEqual([
      { tabela: 'TBDOM', contagemAntes: 3, contagemDepois: 1, peloSante: ['2'], foraDoSante: ['3'] },
    ]);
    const achado = b.de(/INSERT INTO SGH_CRUD_VIGIA_ACHADO/)[0]!;
    expect(achado.parametros.slice(0, 7)).toEqual(['pc', 'TBDOM', 3, 1, 1, 1, '["3"]']);
  });

  it('o retrato guardado em texto, sem chaves e o relatório com o rótulo de produto', async () => {
    const b = new BancoRoteiro()
      .quando(/FROM SGH_CRUD_VIGIA_RETRATO/, [
        { ID: '9', CONTAGEM: 2, CHECKSUM: 4, CHAVES: null, LIDO_EM: 'x' },
      ])
      .quando(/FROM SGH_CRUD_VIGIA_ACHADO/, [
        {
          TABELA: 'TBDOM',
          CONTAGEM_ANTES: 3,
          CONTAGEM_DEPOIS: 1,
          FORA_DO_SANTE: 1,
          CHAVES: '["3"]',
          DETECTADO_EM: new Date(Date.UTC(2026, 10, 18)),
        },
        {
          TABELA: 'TBOUTRA',
          CONTAGEM_ANTES: 2,
          CONTAGEM_DEPOIS: 1,
          FORA_DO_SANTE: 1,
          CHAVES: null,
          DETECTADO_EM: '2026-11-18',
        },
      ]);
    expect(await ultimoRetratoVigia(b.tx(), 'pc', 'TBDOM')).toMatchObject({
      id: '9',
      chaves: [],
      lidoEm: null,
    });
    const rel = await relatorioExclusoesFora(
      b.tx(),
      'pc',
      (t) => (t === 'TBDOM' ? 'Domínios' : undefined),
      new Date(),
    );
    expect(rel.map((x) => [x.rotulo, x.foraDoSante, x.chaves.join(',')])).toEqual([
      ['Domínios', 1, '3'],
      ['Cadastro', 1, ''],
    ]);
    const sem = await relatorioExclusoesFora(b.tx(), 'pc', () => undefined);
    expect(sem).toHaveLength(2);
    expect(await excluidasPeloSanteDesde(b.tx(), 'pc', 'TBDOM', null)).toEqual(new Set());
  });

  it('acima do teto não guarda as chaves; nome inválido é recusado', async () => {
    const b = new BancoRoteiro().quando(/SELECT COUNT\(\*\) N, COALESCE\(SUM/, [
      { N: TETO_CHAVES_VIGIA + 1, S: 7 },
    ]);
    expect(await lerRetratoVigia(b.tx(), 'TBDOM', ['ID', 'COD'])).toEqual({
      tabela: 'TBDOM',
      contagem: TETO_CHAVES_VIGIA + 1,
      checksum: 7,
      chaves: [],
    });
    expect(b.de(/K FROM TBDOM/)).toHaveLength(0);
    await expect(lerRetratoVigia(b.tx(), 'tb; drop', ['ID'])).rejects.toThrow(/inválida/);
  });
});

describe('vigia de reconciliação: revisão do W0-02', () => {
  const decl = { tabela: 'TBDOM', chave: 'ID', publico: {} } as unknown as DeclaracaoDominio;

  it('a exclusão do Sante ainda sem COMMIT na leitura (evento antes do retrato) não vira "feita fora"', async () => {
    // Linha do tempo: o Sante grava o evento da chave 2 em Te; a vigia lê a tabela em T1 > Te (a transação do Sante
    // ainda aberta: a chave 2 aparece) e o retrato fica com LIDO_EM = T1. Na rodada seguinte a chave 2 sumiu.
    const te = new Date(Date.UTC(2026, 10, 18, 10, 0, 0));
    const t1 = new Date(te.getTime() + 2_000);
    let desde: unknown = null;
    const b = new BancoRoteiro()
      .quando(/FROM SGH_CFG_PARAMETRO/, [{ VALOR: 'sim' }])
      .quando(/CURRENT_TIMESTAMP T FROM RDB\$DATABASE/, [{ T: new Date(t1.getTime() + 3_600_000) }])
      .quando(/SELECT COUNT\(\*\) N, COALESCE\(SUM/, [{ N: 1, S: 10 }])
      .quando(/SELECT .* K FROM TBDOM/, [{ K: '1' }])
      .quando(/FROM SGH_CRUD_VIGIA_RETRATO/, [
        { ID: '5', CONTAGEM: 2, CHECKSUM: 30, CHAVES: Buffer.from('["1","2"]'), LIDO_EM: t1 },
      ])
      .quando(/INSERT INTO SGH_CRUD_VIGIA_RETRATO/, { ID: '6' })
      .quando(/FROM SGH_CRUD_EVENTO WHERE/, (p) => {
        desde = p[2];
        // O banco devolve o evento só se CRIADO_EM (Te) >= o início da busca.
        return p[2] instanceof Date && te.getTime() >= p[2].getTime() ? [{ CHAVE: '2' }] : [];
      })
      .quando(/FROM SGH_HIST_EXCLUSAO WHERE/, []);
    const r = await rodarVigia(b.tx(), 'pc', [decl]);
    expect(r.achados).toEqual([]);
    expect(desde).toEqual(new Date(t1.getTime() - MARGEM_VIGIA_MS));
    expect(b.de(/INSERT INTO SGH_CRUD_VIGIA_ACHADO/)).toHaveLength(0);
    // O retrato novo leva o instante do banco lido ANTES da tabela.
    const ins = b.de(/INSERT INTO SGH_CRUD_VIGIA_RETRATO/)[0]!;
    expect(ins.sql).toMatch(/LIDO_EM/);
    expect(ins.parametros.at(-1)).toEqual(new Date(t1.getTime() + 3_600_000));
    expect(inicioDaBusca(null)).toBeNull();
  });

  it('as chaves do achado cabem inteiras em CHAVES (JSON válido) e o relatório não cai com linha ilegível', async () => {
    const longas = Array.from({ length: 100 }, (_, i) => `${'CONVÊNIO-ÇÃO|'.repeat(4)}${i}`);
    const cabem = chavesQueCabem(longas);
    expect(cabem.length).toBeGreaterThan(0);
    expect(cabem.length).toBeLessThan(100);
    const texto = JSON.stringify(cabem).replace(
      /[\u0080-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    expect(texto.length).toBeLessThanOrEqual(TAMANHO_CHAVES_ACHADO);
    expect(JSON.parse(texto)).toEqual(cabem);
    expect(chavesDoAchado('["1","2')).toEqual([]);
    expect(chavesDoAchado('{"a":1}')).toEqual([]);
    expect(chavesDoAchado('')).toEqual([]);
    const b = new BancoRoteiro().quando(/FROM SGH_CRUD_VIGIA_ACHADO/, [
      {
        TABELA: 'TBDOM',
        CONTAGEM_ANTES: 3,
        CONTAGEM_DEPOIS: 1,
        FORA_DO_SANTE: 2,
        CHAVES: '["1","2',
        DETECTADO_EM: 'x',
      },
      {
        TABELA: 'TBDOM',
        CONTAGEM_ANTES: 3,
        CONTAGEM_DEPOIS: 2,
        FORA_DO_SANTE: 1,
        CHAVES: '["7"]',
        DETECTADO_EM: 'y',
      },
    ]);
    const rel = await relatorioExclusoesFora(b.tx(), 'pc', () => 'Domínios');
    expect(rel.map((x) => x.chaves)).toEqual([[], ['7']]);
  });

  it('a rodada grava no achado só o JSON que cabe', async () => {
    const chaves = Array.from({ length: 100 }, (_, i) => `${'X'.repeat(60)}${i}`);
    const b = new BancoRoteiro()
      .quando(/FROM SGH_CFG_PARAMETRO/, [{ VALOR: 'sim' }])
      .quando(/SELECT COUNT\(\*\) N, COALESCE\(SUM/, [{ N: 0, S: 0 }])
      .quando(/SELECT .* K FROM TBDOM/, [])
      .quando(/FROM SGH_CRUD_VIGIA_RETRATO/, [
        { ID: '5', CONTAGEM: 100, CHECKSUM: 30, CHAVES: Buffer.from(JSON.stringify(chaves)), LIDO_EM: null },
      ])
      .quando(/INSERT INTO SGH_CRUD_VIGIA_RETRATO/, { ID: '6' })
      .quando(/FROM SGH_CRUD_EVENTO WHERE/, [])
      .quando(/FROM SGH_HIST_EXCLUSAO WHERE/, []);
    const r = await rodarVigia(b.tx(), 'pc', [decl]);
    expect(r.achados[0]?.foraDoSante).toHaveLength(100);
    const gravado = String(b.de(/INSERT INTO SGH_CRUD_VIGIA_ACHADO/)[0]!.parametros[6]);
    expect(gravado.length).toBeLessThanOrEqual(TAMANHO_CHAVES_ACHADO);
    expect((JSON.parse(gravado) as string[]).length).toBeLessThan(100);
  });
});
