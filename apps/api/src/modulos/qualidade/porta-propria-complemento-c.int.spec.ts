// Integração do complemento da porta PRÓPRIA da segurança do paciente (modulos-proprios-2, família qualidade-c) contra o
// MariaDB do cliente de teste (f22_o4): as leituras de outros módulos rodam sobre o DDL real (colunas, junções e
// verificações), devolvem o formato do contrato e, no estabelecimento sintético sem registros, nada inventado (zero e
// listas vazias); o histórico de riscos continua fechado (503) e sem estabelecimento a leitura recusa.
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import type { ContextoQualidade } from './porta.js';
import { ComplementoQualidadeC } from './porta-propria-complemento-c.js';

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? `${e.problema.status}:${String(e.problema.codigo)}` : String(e);
  }
};

describe.skipIf(SEM_BANCO_QUA)('complemento qualidade-c da porta própria, contra o MariaDB', () => {
  let m: MassaQualidade;
  let porta: ComplementoQualidadeC;
  let c: ContextoQualidade;

  beforeAll(async () => {
    m = await prepararMassaQualidade('QC');
    porta = new ComplementoQualidadeC(m.nucleo);
    c = ctxBanco(m.est, m.codigoEst, m.usuario);
  }, 60_000);
  afterAll(async () => {
    await encerrarMassaQualidade(m);
  });

  it('candidatos: as quatro fontes leem o banco real; o login sintético sem registro não tem candidato', async () => {
    const r = await porta.candidatos(c, m.login, '2026-01-01T00:00:00');
    expect(r).toEqual({ checagens: [], reacoes: [], checklists: [], horarios: [], lesoes: [] });
    const semConta = await porta.candidatos(c, 'LOGIN-QUE-NAO-EXISTE', '2026-01-01T00:00:00');
    expect(semConta.checagens).toEqual([]);
  });

  it('painel de adesão: as contagens do período rodam sobre o banco real (zero no estabelecimento sintético)', async () => {
    const r = await porta.painelAdesao(c, '2026-01-01', '2026-12-01', '2026-11-24T10:00:00');
    expect(r).toEqual({
      checagens: 0,
      checagensComPulseira: 0,
      checklists: 0,
      checklistsConcluidos: 0,
      checklistsComPausa: 0,
      reavaliacoes: [],
    });
  });

  it('protocolos gerenciados: versões e inclusões pela leitura da classificação', async () => {
    const r = await porta.protocolosGerenciados(c, '2026-01-01T00:00:00', '2026-12-01T00:00:00');
    expect(Array.isArray(r.versoes)).toBe(true);
    expect(r.protocolos).toEqual([]);
    for (const v of r.versoes) expect(typeof v.tipo).toBe('string');
  });

  it('expostos: o rastreio reverso do lote (sem saída nem consumo: lista vazia)', async () => {
    const r = await porta.expostos(c, 987659999, 'LOTE-SINT-QC');
    expect(r.expostos).toEqual([]);
    expect(r.cortada).toBe(false);
  });

  it('histórico de riscos: falha fechada (503 modelo-pendente), nunca zero', async () => {
    expect(await codigo(porta.historicoRiscos(c))).toBe('503:modelo-pendente');
  });

  it('sem estabelecimento na sessão, a leitura recusa', async () => {
    const sem = { ...c, estabelecimento: null };
    expect(await codigo(porta.painelAdesao(sem, '2026-01-01', '2026-02-01', '2026-11-24T10:00:00'))).not.toBe(
      'ok',
    );
    expect(await codigo(porta.candidatos(sem, m.login, '2026-01-01T00:00:00'))).not.toBe('ok');
  });
});
