// Unidade do complemento Q5 da porta própria da gestão da qualidade (fecho-1, qualidade-resto): o mapeamento do
// sorteio e da auditoria para o contrato, o filtro pelo estabelecimento, o login do médico pelo vínculo vigente e as
// gravações (aval, cancelamento da pendência, da reunião e da não conformidade): versão conferida, recusas sem gravar
// e a versão anterior na trilha.
import { ErroOperacao, type Executor, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import type { NucleoQualidade } from './apoio-propria.js';
import { METODOS_PORTA_GESTAO } from './porta-gestao.js';
import {
  gravacoesComplementoQ5,
  LeiturasGestaoComplementoQ5,
  METODOS_COMPLEMENTO_Q5,
} from './porta-propria-complemento-q5.js';

const C = { cliente: 'teste', estabelecimento: 3, usuario: 1, correlacao: 'x' } as never;
const GRAVACOES = ['avalRevisao', 'cancelarPendenciaRevisao', 'cancelarReuniao', 'cancelarNaoConformidade'];

function leiturasFalsas(respostas: Record<string, unknown[]>) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const achar = (sql: string) => Object.entries(respostas).find(([k]) => sql.includes(k))?.[1] ?? [];
  const leitor = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(achar(sql));
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(achar(sql)[0] ?? null);
    },
  };
  const nucleo = {
    lerSomente: (_c: unknown, fn: (l: typeof leitor) => Promise<unknown>) => fn(leitor),
    criarExecutor: () => ({}) as Executor,
  } as unknown as NucleoQualidade;
  return { leituras: new LeiturasGestaoComplementoQ5(nucleo), chamadas };
}

function txFalsa(travada: Record<string, unknown> | null, umas: Record<string, unknown> = {}) {
  const alteracoes: { tabela: string; id: number; versao: number; dados: Record<string, unknown> }[] = [];
  const tx = {
    consultarParaAtualizar: () => Promise.resolve(travada ? [travada] : []),
    uma: (sql: string) => {
      if (sql.includes('FROM usuario')) return Promise.resolve({ id: 77 });
      const k = Object.keys(umas).find((x) => sql.includes(x));
      return Promise.resolve(k ? umas[k] : null);
    },
    consultar: () => Promise.resolve([]),
    alterar: (tabela: string, id: number, versao: number, dados: Record<string, unknown>) => {
      alteracoes.push({ tabela, id, versao, dados });
      return Promise.resolve(versao + 1);
    },
  } as unknown as TxOperacao;
  return { tx, alteracoes };
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : String(e);
  }
}

const SORTEIO = {
  id: 8,
  comissao_hospitalar_id: 4,
  competencia: '2026-10',
  semente: 'semente-sint',
  quantidade: 5,
  universo_quantidade: 40,
  hash_universo: 'a'.repeat(64),
  sorteado_por: 'REVISOR',
  sorteado_em: new Date(2026, 10, 1, 9, 0, 0),
  situacao: 'cancelado',
  justificativa: 'Universo errado',
  alterado_em: new Date(2026, 10, 2, 10, 0, 0),
  alterado_por_login: 'GESTOR',
  versao: 2,
  checklist: 31,
  checklist_revisao: 3,
  revisados: 0,
};

const MUDANCA = {
  id: 5,
  versao: 2,
  justificativa: 'Motivo sintético',
  agora: '2026-11-02T10:00:00',
  usuario: 'g',
};

describe('complemento Q5 da porta própria da gestão (unidade)', () => {
  it('as leituras cobertas são da porta da gestão; as gravações são do gravador', () => {
    for (const m of METODOS_COMPLEMENTO_Q5.filter((x) => !GRAVACOES.includes(x)))
      expect(METODOS_PORTA_GESTAO.has(m)).toBe(true);
    const { tx } = txFalsa(null);
    expect(Object.keys(gravacoesComplementoQ5(tx, 3)).sort()).toEqual([...GRAVACOES].sort());
  });

  it('o sorteio cancelado sai no contrato com o checklist das revisões e o cancelamento', async () => {
    const { leituras, chamadas } = leiturasFalsas({ sorteio_revisao_prontuario: [SORTEIO] });
    expect(await leituras.sorteioRevisao(C, 8)).toEqual({
      id: 8,
      comissao: 4,
      checklist: 31,
      checklistRevisao: 3,
      competencia: '2026-10',
      semente: 'semente-sint',
      quantidade: 5,
      universo: 40,
      resumoUniverso: 'a'.repeat(64),
      sorteadoPor: 'REVISOR',
      sorteadoEm: '2026-11-01T09:00:00',
      canceladoEm: '2026-11-02T10:00:00',
      canceladoPor: 'GESTOR',
      motivoCancelamento: 'Universo errado',
      revisados: 0,
      versao: 2,
    });
    expect(chamadas[0]?.sql).toContain('s.estabelecimento_id = ?');
    expect(chamadas[0]?.p).toEqual([3, 8]);
  });

  it('o sorteio ativo não traz cancelamento; o inexistente é nulo', async () => {
    const ativo = { ...SORTEIO, situacao: 'sorteado' };
    const { leituras } = leiturasFalsas({ sorteio_revisao_prontuario: [ativo] });
    const [s] = await leituras.sorteiosRevisao(C, 4);
    expect([s?.canceladoEm, s?.canceladoPor, s?.motivoCancelamento]).toEqual([null, null, null]);
    expect(await leiturasFalsas({}).leituras.sorteioRevisao(C, 9)).toBeNull();
  });

  it('a auditoria sai com a área, o referencial, os auditores em texto e o checklist do contrato', async () => {
    const { leituras } = leiturasFalsas({
      'FROM auditoria_interna_item': [
        { a: 2, pergunta: 'Requisito sintético', resultado: 'nao_conforme', evidencia: 'Evidência' },
      ],
      'FROM auditoria_interna a': [
        {
          id: 2,
          titulo: 'Auditoria sintética',
          area: 'POSTO SINTETICO',
          referencial: 'ona',
          inicio_realizado: '2026-10-10',
          inicio_previsto: '2026-10-09',
          auditores_descricao: 'AUDITOR A, AUDITOR B',
          itens_conformes: 0,
          itens_parciais: 0,
          itens_nao_conformes: 1,
          itens_nao_aplicaveis: 0,
          fechamento: 'Conclusão',
          registrada_por: 'GESTOR',
          criado_em: new Date(2026, 9, 10, 12, 0, 0),
          versao: 1,
          cancelada_em: null,
          motivo_cancelamento: null,
        },
      ],
    });
    const a = await leituras.auditoria(C, 2);
    expect(a).toMatchObject({
      area: 'POSTO SINTETICO',
      referencial: 'ona',
      realizadaEm: '2026-10-10',
      auditores: 'AUDITOR A, AUDITOR B',
      naoConformes: 1,
      conclusao: 'Conclusão',
      canceladaEm: null,
    });
    expect(JSON.parse(a?.itens ?? '[]')).toEqual([
      { requisito: 'Requisito sintético', secao: null, resultado: 'naoConforme', evidencia: 'Evidência' },
    ]);
  });

  it('o login do médico é o do vínculo vigente; sem vínculo, vazio', async () => {
    const { leituras, chamadas } = leiturasFalsas({
      usuario_profissional: [
        { p: 9, login: 'medico.novo' },
        { p: 9, login: 'medico.velho' },
      ],
    });
    const m = await leituras.loginsDosMedicos(C, [9, 10]);
    expect([...m]).toEqual([
      [9, 'medico.novo'],
      [10, ''],
    ]);
    expect(chamadas[0]?.sql).toContain('vigencia_fim IS NULL');
  });

  it('as revisões da competência só dos sorteios não cancelados da comissão', async () => {
    const { leituras, chamadas } = leiturasFalsas({});
    expect(await leituras.revisoesDaCompetencia(C, 4, '2026-10')).toEqual([]);
    expect(chamadas[0]?.sql).toContain("s.situacao <> 'cancelado'");
    expect(chamadas[0]?.p).toEqual([3, 3, 4, '2026-10-01']);
  });

  it('o aval da revisão concluída grava a situação avalizada; a pendência aberta recusa', async () => {
    const rev = { id: 5, versao: 2, revisada_em: new Date(), avalizada_em: null, situacao: 'concluida' };
    const ok = txFalsa(rev);
    const aval = { id: 5, versao: 2, agora: '2026-11-02T10:00:00', usuario: 'g' };
    expect(await gravacoesComplementoQ5(ok.tx, 3).avalRevisao(aval)).toEqual({ versao: 3 });
    expect(ok.alteracoes[0]).toMatchObject({
      tabela: 'revisao_prontuario',
      dados: { situacao: 'avalizada', avalizada_em: '2026-11-02 10:00:00', avalizada_por_usuario_id: 77 },
    });
    const pend = txFalsa(rev, { 'FROM pendencia_prontuario': { id: 1 } });
    expect(await codigo(gravacoesComplementoQ5(pend.tx, 3).avalRevisao(aval))).toBe(
      '409:versao-desatualizada',
    );
    expect(pend.alteracoes).toEqual([]);
    const sem = txFalsa({ ...rev, revisada_em: null, situacao: 'em_andamento' });
    expect(await codigo(gravacoesComplementoQ5(sem.tx, 3).avalRevisao(aval))).toBe(
      '409:versao-desatualizada',
    );
  });

  it('o cancelamento da pendência aberta grava o motivo e anota a versão anterior', async () => {
    const t = txFalsa({ id: 6, versao: 1, situacao: 'aberta' });
    const anotacao: AnotacaoGravacao = { motivo: null, dados: null };
    const m = { id: 6, versao: 1, motivo: 'Apontada por engano', agora: '2026-11-02T10:00:00', usuario: 'g' };
    expect(await gravacoesComplementoQ5(t.tx, 3, anotacao).cancelarPendenciaRevisao(m)).toEqual({
      versao: 2,
    });
    expect(t.alteracoes[0]?.dados).toMatchObject({ situacao: 'cancelada', resolucao: 'Apontada por engano' });
    expect(anotacao.dados?.['versaoAnterior']).toMatchObject({
      tabela: 'pendencia_prontuario',
      acao: 'cancelamento',
    });
    const resolvida = txFalsa({ id: 6, versao: 1, situacao: 'resolvida' });
    expect(await codigo(gravacoesComplementoQ5(resolvida.tx, 3).cancelarPendenciaRevisao(m))).toBe(
      '409:versao-desatualizada',
    );
  });

  it('a reunião com ata assinada não se cancela; a outra vai a cancelada', async () => {
    const base = {
      id: 5,
      versao: 2,
      situacao: 'agendada',
      cancelada_em: null,
      ata_assinada_em: null,
      assinatura_anterior_em: null,
    };
    const t = txFalsa(base);
    expect(await gravacoesComplementoQ5(t.tx, 3).cancelarReuniao(MUDANCA)).toEqual({ versao: 3 });
    expect(t.alteracoes[0]?.dados).toEqual({
      situacao: 'cancelada',
      cancelada_em: '2026-11-02 10:00:00',
      motivo_cancelamento: 'Motivo sintético',
    });
    const assinada = txFalsa({ ...base, situacao: 'realizada', ata_assinada_em: new Date() });
    expect(await codigo(gravacoesComplementoQ5(assinada.tx, 3).cancelarReuniao(MUDANCA))).toBe(
      '409:versao-desatualizada',
    );
    expect(assinada.alteracoes).toEqual([]);
  });

  it('a não conformidade aberta se cancela com a duplicada; dependente e duplicada inválida recusam', async () => {
    const nc = { id: 5, versao: 2, situacao: 'aberta', cancelada_em: null };
    const t = txFalsa(nc, { 'WHERE id = ?': { id: 4 } });
    expect(
      await gravacoesComplementoQ5(t.tx, 3).cancelarNaoConformidade({ ...MUDANCA, duplicadaDe: 4 }),
    ).toEqual({ versao: 3 });
    expect(t.alteracoes[0]?.dados).toMatchObject({
      situacao: 'cancelada',
      cancelada_por_usuario_id: 77,
      motivo_cancelamento: 'Motivo sintético',
      duplicada_de_id: 4,
    });
    const propria = txFalsa(nc);
    expect(
      await codigo(
        gravacoesComplementoQ5(propria.tx, 3).cancelarNaoConformidade({ ...MUDANCA, duplicadaDe: 5 }),
      ),
    ).toBe('409:duplicada-inexistente');
    const dep = txFalsa(nc, { 'WHERE duplicada_de_id = ?': { id: 9 } });
    expect(
      await codigo(
        gravacoesComplementoQ5(dep.tx, 3).cancelarNaoConformidade({ ...MUDANCA, duplicadaDe: null }),
      ),
    ).toBe('409:com-dependentes');
    expect(dep.alteracoes).toEqual([]);
    const tratada = txFalsa({ ...nc, situacao: 'em_tratamento' });
    expect(
      await codigo(
        gravacoesComplementoQ5(tratada.tx, 3).cancelarNaoConformidade({ ...MUDANCA, duplicadaDe: null }),
      ),
    ).toBe('409:versao-desatualizada');
  });
});
