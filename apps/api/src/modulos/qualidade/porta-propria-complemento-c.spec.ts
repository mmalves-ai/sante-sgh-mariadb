// Unitário do complemento qualidade-c da porta própria: o mapeamento das linhas lidas para o contrato (situação "N" da
// checagem não administrada com o código do motivo, reação já notificada, exceção do checklist, LPP com o estágio do
// catálogo, contagens do painel e só Morse e Braden), com um leitor falso que devolve linhas pela tabela da consulta.
import { describe, expect, it } from 'vitest';
import type { ContextoQualidade } from './porta.js';
import { ComplementoQualidadeC, type NucleoComplementoC } from './porta-propria-complemento-c.js';

type Linha = Record<string, unknown>;
function nucleoFalso(linhas: (sql: string, p: readonly unknown[]) => Linha[]) {
  const sqls: { sql: string; p: readonly unknown[] }[] = [];
  const l = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      return Promise.resolve(linhas(sql, p));
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      return Promise.resolve(linhas(sql, p)[0] ?? null);
    },
  };
  const nucleo = {
    lerSomente: (_c: unknown, fn: (x: typeof l) => Promise<unknown>) => fn(l),
  } as unknown as NucleoComplementoC;
  return { nucleo, sqls };
}
const c: ContextoQualidade = { cliente: 't', estabelecimento: 7, usuario: 3, correlacao: 't' };

describe('complemento qualidade-c: candidatos', () => {
  it('mapeia as quatro fontes para o contrato da regra', async () => {
    const { nucleo, sqls } = nucleoFalso((sql) => {
      if (sql.includes('FROM usuario')) return [{ id: 3 }];
      if (sql.includes('horario_administracao_evento'))
        return [{ id: 11, motivo: 'recusa', ocorrido_em: '2026-11-20 08:00:00', atendimento_id: 5 }];
      if (sql.includes('reacao_transfusional'))
        return [
          {
            id: 21,
            inicio_em: '2026-11-20 09:00:00',
            grau: 2,
            notificacao_enviada_em: null,
            notificacao_incidente_id: null,
          },
          {
            id: 22,
            inicio_em: '2026-11-20 09:30:00',
            grau: 1,
            notificacao_enviada_em: null,
            notificacao_incidente_id: 9,
          },
        ];
      if (sql.includes('checklist_cirurgia_segura')) return [{ id: 31, excecao_em: '2026-11-20 10:00:00' }];
      if (sql.includes('lesao_pele_avaliacao'))
        return [
          {
            id: 41,
            estagio: 'estagio3',
            presente_na_admissao: 0,
            identificada_em: '2026-11-19 07:00:00',
            atendimento_id: 5,
            inativada: 0,
          },
          {
            id: 42,
            estagio: 'OUTRO',
            presente_na_admissao: 1,
            identificada_em: '2026-11-19 07:00:00',
            atendimento_id: null,
            inativada: 1,
          },
        ];
      return [];
    });
    const r = await new ComplementoQualidadeC(nucleo).candidatos(c, ' sint.enf ', '2026-11-01T00:00:00');
    expect(r.checagens).toEqual([
      {
        id: 11,
        situacao: 'N',
        motivo: 'recusa',
        avisos: null,
        horaReal: '2026-11-20T08:00:00',
        atendimento: 5,
      },
    ]);
    expect(r.reacoes.map((x) => [x.id, x.grau, x.enviada])).toEqual([
      [21, 2, false],
      [22, 1, true],
    ]);
    expect(r.checklists).toEqual([{ id: 31, excecaoEm: '2026-11-20T10:00:00' }]);
    expect(r.lesoes?.map((x) => [x.id, x.estagio, x.presenteNaAdmissao, x.inativada])).toEqual([
      [41, 'estagio3', false, false],
      [42, null, true, true],
    ]);
    expect(r.horarios).toEqual([]);
    // Todas as fontes pelo estabelecimento da sessão, pelo usuário e desde o instante (formato do banco).
    const fontes = sqls.filter((s) => !s.sql.includes('FROM usuario'));
    expect(fontes).toHaveLength(4);
    for (const s of fontes) expect(s.p).toEqual([7, 3, '2026-11-01 00:00:00']);
  });

  it('login que não existe: nenhum candidato, sem consultar as fontes', async () => {
    const { nucleo, sqls } = nucleoFalso(() => []);
    const r = await new ComplementoQualidadeC(nucleo).candidatos(c, 'NINGUEM', '2026-11-01T00:00:00');
    expect(r).toEqual({ checagens: [], reacoes: [], checklists: [], horarios: [], lesoes: [] });
    expect(sqls).toHaveLength(1);
  });
});

describe('complemento qualidade-c: painel de adesão', () => {
  it('contagens do período e só Morse e Braden', async () => {
    const { nucleo, sqls } = nucleoFalso((sql) => {
      if (sql.includes('horario_administracao_evento')) return [{ total: 10, pulseira: '7' }];
      if (sql.includes('checklist_cirurgia_segura')) return [{ total: 4, concluidos: 3, pausa: 2 }];
      if (sql.includes('reavaliacao_escala'))
        return [
          { escala: 'braden', devidas: 5, cumpridas: 4 },
          { escala: 'morse', devidas: 6, cumpridas: 6 },
        ];
      return [];
    });
    const r = await new ComplementoQualidadeC(nucleo).painelAdesao(
      c,
      '2026-11-01',
      '2026-12-01',
      '2026-11-24T10:00:00',
    );
    expect(r).toEqual({
      checagens: 10,
      checagensComPulseira: 7,
      checklists: 4,
      checklistsConcluidos: 3,
      checklistsComPausa: 2,
      reavaliacoes: [
        { escala: 'braden', devidas: 5, cumpridasNoPrazo: 4 },
        { escala: 'morse', devidas: 6, cumpridasNoPrazo: 6 },
      ],
    });
    expect(sqls[0]?.p).toEqual([7, '2026-11-01 00:00:00', '2026-12-01 00:00:00']);
    expect(sqls[1]?.p).toEqual([7, '2026-11-01 00:00:00', '2026-12-01 00:00:00', '2026-11-24 10:00:00']);
    expect(sqls[2]?.sql).toContain("r.situacao <> 'dispensada'");
  });

  it('sem linhas: zero, nunca indefinido', async () => {
    const { nucleo } = nucleoFalso(() => []);
    const r = await new ComplementoQualidadeC(nucleo).painelAdesao(
      c,
      '2026-11-01',
      '2026-12-01',
      '2026-11-24T10:00:00',
    );
    expect(r.checagens).toBe(0);
    expect(r.reavaliacoes).toEqual([]);
  });
});

describe('complemento qualidade-c: histórico de riscos', () => {
  it('falha fechada com 503 modelo-pendente', async () => {
    const { nucleo } = nucleoFalso(() => []);
    await expect(new ComplementoQualidadeC(nucleo).historicoRiscos(c)).rejects.toMatchObject({
      problema: { status: 503, codigo: 'modelo-pendente' },
    });
  });
});
