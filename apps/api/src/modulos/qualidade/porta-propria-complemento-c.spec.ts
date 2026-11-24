// Unitário do complemento qualidade-c da porta própria: o mapeamento das linhas lidas para o contrato (situação "N" da
// checagem não administrada com o código do motivo e os avisos gravados em `dados`, reação já notificada, exceção do
// checklist pela trilha da dispensa, só a ficha de LPP, contagens do painel com a pulseira lida e o dia da cirurgia, só
// Morse e Braden) e o fuso do estabelecimento (parâmetros civis convertidos em instante UTC e saídas na hora civil), com
// um leitor falso que devolve as linhas (instantes UTC, como o pool) pela tabela da consulta.
import { describe, expect, it } from 'vitest';
import type { ContextoQualidade } from './porta.js';
import {
  avisosDoJson,
  ComplementoQualidadeC,
  type NucleoComplementoC,
  textoDoJson,
} from './porta-propria-complemento-c.js';

type Linha = Record<string, unknown>;
function nucleoFalso(linhas: (sql: string, p: readonly unknown[]) => Linha[]) {
  const sqls: { sql: string; p: readonly unknown[] }[] = [];
  const fuso = (sql: string) =>
    sql.includes('fuso_horario') ? [{ fuso_horario: 'America/Sao_Paulo' }] : null;
  const l = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      return Promise.resolve(fuso(sql) ?? linhas(sql, p));
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      sqls.push({ sql, p });
      return Promise.resolve((fuso(sql) ?? linhas(sql, p))[0] ?? null);
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
        return [
          {
            id: 11,
            motivo_lista: null,
            motivo_dados: '"faltaItem"',
            texto_motivo: 'Falta na farmácia',
            avisos_dados: '[]',
            ocorrido_em: '2026-11-20 11:00:00',
            atendimento_id: 5,
          },
          {
            id: 12,
            motivo_lista: null,
            motivo_dados: 'null',
            texto_motivo: 'Paciente recusou',
            avisos_dados: '["Alergia ao princípio ativo", " "]',
            ocorrido_em: '2026-11-20 10:00:00',
            atendimento_id: 5,
          },
          {
            id: 13,
            motivo_lista: 'ausente',
            motivo_dados: null,
            texto_motivo: 'x',
            avisos_dados: null,
            ocorrido_em: '2026-11-20 09:00:00',
            atendimento_id: null,
          },
        ];
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
      if (sql.includes('checklist_cirurgia_segura')) return [{ id: 31, excecao_em: '2026-11-20 13:00:00' }];
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
    // O código do motivo vem do catálogo (carga) ou de `dados.motivo` (o gravador); sem os dois, o texto do evento.
    expect(r.checagens).toEqual([
      {
        id: 11,
        situacao: 'N',
        motivo: 'faltaItem',
        avisos: null,
        horaReal: '2026-11-20T08:00:00',
        atendimento: 5,
      },
      {
        id: 12,
        situacao: 'N',
        motivo: 'Paciente recusou',
        avisos: 'Alergia ao princípio ativo',
        horaReal: '2026-11-20T07:00:00',
        atendimento: 5,
      },
      {
        id: 13,
        situacao: 'N',
        motivo: 'ausente',
        avisos: null,
        horaReal: '2026-11-20T06:00:00',
        atendimento: null,
      },
    ]);
    expect(r.reacoes.map((x) => [x.id, x.grau, x.enviada])).toEqual([
      [21, 2, false],
      [22, 1, true],
    ]);
    expect(r.checklists).toEqual([{ id: 31, excecaoEm: '2026-11-20T10:00:00' }]);
    expect(r.lesoes?.[0]?.identificadaEm).toBe('2026-11-19T04:00:00');
    expect(r.lesoes?.map((x) => [x.id, x.estagio, x.presenteNaAdmissao, x.inativada])).toEqual([
      [41, 'estagio3', false, false],
      [42, null, true, true],
    ]);
    expect(r.horarios).toEqual([]);
    // Todas as fontes pelo estabelecimento da sessão, pelo usuário e desde o instante (a hora civil de São Paulo em UTC).
    const fontes = sqls.filter((s) => !s.sql.includes('FROM usuario') && !s.sql.includes('fuso_horario'));
    expect(fontes).toHaveLength(4);
    for (const s of fontes) expect(s.p).toEqual([7, 3, new Date('2026-11-01T03:00:00Z')]);
    const sql = (t: string) => fontes.find((s) => s.sql.includes(t))?.sql ?? '';
    // A checagem lê o motivo e os avisos de `dados` (o gravador não preenche a coluna do catálogo).
    expect(sql('horario_administracao_evento')).toContain("JSON_EXTRACT(ev.dados, '$.motivo')");
    expect(sql('horario_administracao_evento')).toContain("JSON_EXTRACT(ev.dados, '$.avisos')");
    // A exceção sai da trilha da dispensa (autor e instante fixos), com o checklist sem ato pelo agendamento.
    expect(sql('checklist_cirurgia_segura')).toContain('FROM trilha_auditoria t');
    expect(sql('checklist_cirurgia_segura')).toContain("JSON_ARRAY('dispensado_urgencia')");
    expect(sql('checklist_cirurgia_segura')).toContain('LEFT JOIN ato_cirurgico a');
    expect(sql('checklist_cirurgia_segura')).not.toContain('alterado_por');
    // Só a ficha não inativada; a lesão inativada (ou excluída) vai marcada.
    expect(sql('lesao_pele_avaliacao')).toContain("av.tipo_avaliacao = 'ficha' AND av.inativada = FALSE");
    expect(sql('lesao_pele_avaliacao')).toContain(
      '(lp.inativada = TRUE OR lp.excluido_em IS NOT NULL) AS inativada',
    );
  });

  it('login que não existe: nenhum candidato, sem consultar as fontes', async () => {
    const { nucleo, sqls } = nucleoFalso(() => []);
    const r = await new ComplementoQualidadeC(nucleo).candidatos(c, 'NINGUEM', '2026-11-01T00:00:00');
    expect(r).toEqual({ checagens: [], reacoes: [], checklists: [], horarios: [], lesoes: [] });
    expect(sqls.filter((s) => !s.sql.includes('FROM usuario'))).toEqual([]);
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
    const fontes = sqls.filter((s) => !s.sql.includes('fuso_horario'));
    const ini = new Date('2026-11-01T03:00:00Z');
    const fim = new Date('2026-12-01T03:00:00Z');
    expect(fontes[0]?.p).toEqual([7, ini, fim]);
    // A identificação é a pulseira lida, não o canal do registro.
    expect(fontes[0]?.sql).toContain("JSON_VALUE(ev.dados, '$.pulseiraLida')");
    expect(fontes[0]?.sql).not.toContain('canal_registro');
    // O checklist pelo dia da cirurgia (ato ou agendamento) já iniciada; o aberto sem ato entra pelo agendamento.
    expect(fontes[1]?.p).toEqual([7, ini, fim, new Date('2026-11-24T13:00:00Z')]);
    expect(fontes[1]?.sql).toContain(
      'COALESCE(a.inicio_cirurgia_em, a.entrada_sala_em, g.inicio_previsto_em)',
    );
    expect(fontes[1]?.sql).not.toContain('k.criado_em');
    expect(fontes[2]?.sql).toContain("r.situacao <> 'dispensada'");
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

describe('complemento qualidade-c: campos JSON da checagem', () => {
  it('texto e avisos', () => {
    expect(textoDoJson('"faltaItem"')).toBe('faltaItem');
    expect(textoDoJson('null')).toBeNull();
    expect(textoDoJson(null)).toBeNull();
    expect(textoDoJson('"  "')).toBeNull();
    expect(avisosDoJson('[]')).toBeNull();
    expect(avisosDoJson(['a', 'b'])).toBe('a; b');
    expect(avisosDoJson('["Dose acima do máximo"]')).toBe('Dose acima do máximo');
    expect(avisosDoJson('"aviso único"')).toBe('aviso único');
    expect(avisosDoJson('null')).toBeNull();
  });
});
