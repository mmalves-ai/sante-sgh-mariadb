// Integração do complemento da porta PRÓPRIA da segurança do paciente (modulos-proprios-2, família qualidade-c) contra o
// MariaDB do cliente de teste (f22_o4): as leituras de outros módulos rodam sobre o DDL real (colunas, junções e
// verificações), devolvem o formato do contrato e, no estabelecimento sintético sem registros, nada inventado (zero e
// listas vazias); o histórico de riscos continua fechado (503) e sem estabelecimento a leitura recusa (409 sem-estabelecimento).
// Massa positiva (f22_o2, massa sintética da enfermagem): eventos do horário no formato exato do gravador da checagem
// (enfermagem/operacoes.ts, evento(): o código do motivo e os avisos em `dados`, a pulseira lida em
// `dados.pulseiraLida`, a coluna do catálogo de motivos vazia), conferidos pela leitura e pela regra da sugestão.
import { sugestoesDoUsuario } from '@sgh/dominio-qualidade';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ctxBanco,
  encerrarMassaQualidade,
  type MassaQualidade,
  prepararMassaQualidade,
  SEM_BANCO_QUA,
} from './massa.spec-util.js';
import type { ContextoQualidade } from './porta.js';
import {
  CLIENTE as CLIENTE_ENF,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
} from '../enfermagem/massa-enfermagem.spec-util.js';
import { localNoFuso } from '../enfermagem/banco-apoio.js';
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
    expect(await codigo(porta.painelAdesao(sem, '2026-01-01', '2026-02-01', '2026-11-24T10:00:00'))).toBe(
      '409:sem-estabelecimento',
    );
    expect(await codigo(porta.candidatos(sem, m.login, '2026-01-01T00:00:00'))).toBe(
      '409:sem-estabelecimento',
    );
  });
});

describe.skipIf(SEM_BANCO_QUA)(
  'complemento qualidade-c: checagens gravadas no formato do gravador (f22_o2)',
  () => {
    const nucleo = new NucleoProprio();
    let m: MassaEnfermagem | null = null;
    let porta: ComplementoQualidadeC;
    let c: ContextoQualidade;
    let fuso = 'America/Sao_Paulo';
    const base = new Date(Date.now() - 30 * 60_000);
    const em = (min: number) => new Date(base.getTime() + min * 60_000);

    beforeAll(async () => {
      garantirCliente();
      m = await montarMassa(nucleo, 'QC24');
      const mm = m;
      porta = new ComplementoQualidadeC(nucleo);
      c = { cliente: CLIENTE_ENF, estabelecimento: mm.est, usuario: mm.usuario, correlacao: 't-qc24' };
      await nucleo.escrever({ cliente: CLIENTE_ENF, correlacao: 't-qc24-eventos' }, async (e) => {
        const r = await e.uma<{ f: string | null }>(
          'SELECT fuso_horario AS f FROM estabelecimento WHERE id = ?',
          [mm.est],
        );
        fuso = r?.f || fuso;
        const dados = (x: Record<string, unknown>) =>
          JSON.stringify({
            ato: 'principal',
            pulseiraLida: false,
            motivoSemPulseira: null,
            gtin: null,
            lote: null,
            validade: null,
            conferente: null,
            dispositivo: null,
            origemOffline: false,
            avisos: [],
            observacao: null,
            motivo: null,
            ...x,
          });
        const evento = (
          ev: string,
          min: number,
          motivo: string | null,
          canal: string,
          d: Record<string, unknown>,
        ) =>
          e.executar(
            `INSERT INTO horario_administracao_evento (horario_administracao_id, operacao, dados, ocorrido_em, usuario_id,
             evento, motivo, canal_registro, criado_em) VALUES (?, 'alteracao', ?, ?, ?, ?, ?, ?, ?)`,
            [mm.horario, dados(d), em(min), mm.usuario, ev, motivo, canal, new Date()],
          );
        // Não administrados: a omissão (código da lista em dados.motivo, o texto em motivo) e o interceptado (avisos).
        await evento('nao_administrado', 1, 'Falta na farmácia', 'estacao', { motivo: 'faltaItem' });
        await evento('nao_administrado', 2, 'Paciente recusou', 'beira_leito', {
          motivo: 'recusa',
          avisos: ['Alergia registrada ao princípio ativo'],
          dispositivo: 'COLETOR-1',
        });
        // Checagens: à beira do leito SEM a pulseira lida e na estação COM a pulseira lida.
        await evento('checagem', 3, null, 'beira_leito', {
          pulseiraLida: false,
          motivoSemPulseira: 'Pulseira ilegível',
        });
        await evento('checagem', 4, null, 'estacao', { pulseiraLida: true });
      });
    }, 120_000);
    afterAll(async () => {
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    });

    it('candidatos: o motivo e os avisos gravados em dados viram omissão e interceptação na regra', async () => {
      const desde = localNoFuso(new Date(base.getTime() - 60_000), fuso);
      const r = await porta.candidatos(c, m!.login, desde);
      expect(r.checagens.map((x) => [x.motivo, x.avisos, x.horaReal])).toEqual([
        ['recusa', 'Alergia registrada ao princípio ativo', localNoFuso(em(2), fuso)],
        ['faltaItem', null, localNoFuso(em(1), fuso)],
      ]);
      expect(r.checagens.every((x) => x.situacao === 'N' && x.atendimento === m!.atendimento)).toBe(true);
      const s = sugestoesDoUsuario(r, () => false).filter((x) => x.tipo === 'medicacao');
      expect(s.map((x) => x.fonte).sort()).toEqual(['interceptado', 'omitida']);
      // A janela é civil do estabelecimento: depois do último evento, nada.
      const depois = await porta.candidatos(c, m!.login, localNoFuso(em(5), fuso));
      expect(depois.checagens).toEqual([]);
    });

    it('painel de adesão: a pulseira lida conta, o canal não', async () => {
      const hoje = localNoFuso(new Date(), fuso);
      const ontem = localNoFuso(new Date(Date.now() - 86_400_000), fuso).slice(0, 10);
      const amanha = localNoFuso(new Date(Date.now() + 86_400_000), fuso).slice(0, 10);
      const r = await porta.painelAdesao(c, ontem, amanha, hoje);
      expect([r.checagens, r.checagensComPulseira]).toEqual([2, 1]);
    });
  },
);
