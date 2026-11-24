// Unidade do complemento Q1 da porta própria da gestão da qualidade (qualidade-q1): as altas do período no
// estabelecimento (hora civil, teto que marca `cortada`), e as gravações (cancelamento do sorteio, assinatura da ata e
// cancelamento da auditoria) com a conferência de versão, as recusas e a versão anterior anotada na trilha.
import { ErroOperacao, type Executor, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import type { NucleoQualidade } from './apoio-propria.js';
import { METODOS_PORTA_GESTAO } from './porta-gestao.js';
import {
  gravacoesComplementoQ1,
  LeiturasGestaoComplementoQ1,
  METODOS_COMPLEMENTO_Q1,
  TETO_ALTAS_REVISAO,
} from './porta-propria-complemento-q1.js';

const ALTA = {
  id: 77,
  paciente_id: 5,
  data_hora_alta: '2026-10-05 13:30:00',
  clinica: 'CLINICA SINT',
  medico_assistente_profissional_id: 9,
  medico_nome: 'MEDICO SINT',
};

function leitorFalso(respostas: Record<string, unknown[]>) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const achar = (sql: string) => respostas[Object.keys(respostas).find((x) => sql.includes(x)) ?? ''] ?? [];
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
  return { leituras: new LeiturasGestaoComplementoQ1(nucleo), chamadas };
}
const C = { cliente: 'teste', estabelecimento: 3, usuario: 1, correlacao: 'x' } as never;

function txFalsa(linhas: Record<string, unknown[]>) {
  const alteracoes: { tabela: string; id: number; versao: number; valores: Record<string, unknown> }[] = [];
  const achar = (sql: string) => linhas[Object.keys(linhas).find((x) => sql.includes(x)) ?? ''] ?? [];
  const tx = {
    consultarParaAtualizar: (sql: string) => Promise.resolve(achar(sql)),
    uma: (sql: string) => Promise.resolve(achar(sql)[0] ?? null),
    alterar: (tabela: string, id: number, versao: number, valores: Record<string, unknown>) => {
      alteracoes.push({ tabela, id, versao, valores });
      return Promise.resolve(versao + 1);
    },
  } as unknown as TxOperacao;
  return { tx, alteracoes };
}
const USUARIO = { 'FROM usuario': [{ id: 4 }] };
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao ? `${e.problema.status}:${e.problema.codigo}` : String(e);
  }
};

describe('complemento Q1 da porta própria da gestão (unidade)', () => {
  it('a leitura coberta é da porta da gestão e as gravações são do gravador', () => {
    expect(METODOS_PORTA_GESTAO.has('altasParaRevisao')).toBe(true);
    const g = gravacoesComplementoQ1({} as TxOperacao, 3);
    for (const m of METODOS_COMPLEMENTO_Q1)
      expect(m === 'altasParaRevisao' || typeof g[m as keyof typeof g] === 'function').toBe(true);
  });

  it('as altas do período leem no estabelecimento, em UTC, e saem na hora civil', async () => {
    const { leituras, chamadas } = leitorFalso({
      fuso_horario: [{ fuso_horario: 'America/Sao_Paulo' }],
      'FROM internacao': [ALTA],
    });
    const r = await leituras.altasParaRevisao(C, '2026-10-01', '2026-11-01');
    expect(r).toEqual({
      itens: [
        {
          reg: 77,
          paciente: 5,
          alta: '2026-10-05T10:30:00',
          clinica: 'CLINICA SINT',
          medicoRegistro: 9,
          medicoNome: 'MEDICO SINT',
        },
      ],
      cortada: false,
    });
    const q = chamadas.find((x) => x.sql.includes('FROM internacao'))!;
    expect(q.sql).toContain("i.situacao = 'alta'");
    expect(q.p[0]).toBe(3);
    expect((q.p[1] as Date).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect((q.p[2] as Date).toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('o excedente do teto marca cortada, sem erro nem corte mudo', async () => {
    const muitas = Array.from({ length: TETO_ALTAS_REVISAO + 1 }, (_, i) => ({ ...ALTA, id: i + 1 }));
    const { leituras } = leitorFalso({ 'FROM internacao': muitas });
    const r = await leituras.altasParaRevisao(C, '2026-10-01', '2026-11-01');
    expect(r.cortada).toBe(true);
    expect(r.itens).toHaveLength(TETO_ALTAS_REVISAO);
  });

  it('cancela o sorteio sem prontuário revisado e anota a versão anterior', async () => {
    const { tx, alteracoes } = txFalsa({
      'FROM sorteio_revisao_prontuario': [{ id: 8, versao: 2, situacao: 'sorteado' }],
      ...USUARIO,
    });
    const anotacao: AnotacaoGravacao = { motivo: null, dados: null };
    const g = gravacoesComplementoQ1(tx, 3, anotacao);
    const r = await g.cancelarSorteioRevisao({
      id: 8,
      versao: 2,
      motivo: 'Lançado errado',
      agora: '2026-11-02T09:00',
      usuario: 'a',
    });
    expect(r).toEqual({ versao: 3 });
    expect(alteracoes[0]).toEqual({
      tabela: 'sorteio_revisao_prontuario',
      id: 8,
      versao: 2,
      valores: { situacao: 'cancelado', justificativa: 'Lançado errado' },
    });
    expect(anotacao.dados).toMatchObject({
      versaoAnterior: { tabela: 'sorteio_revisao_prontuario', id: 8, versao: 2, acao: 'cancelamento' },
    });
  });

  it('recusa cancelar o sorteio com prontuário revisado, já cancelado ou com versão velha', async () => {
    const m = { id: 8, versao: 2, motivo: 'x', agora: '2026-11-02T09:00', usuario: 'a' };
    const revisado = txFalsa({
      'FROM sorteio_revisao_prontuario': [{ id: 8, versao: 2, situacao: 'em_revisao' }],
      'FROM revisao_prontuario': [{ id: 1 }],
      ...USUARIO,
    });
    expect(await codigo(gravacoesComplementoQ1(revisado.tx, 3).cancelarSorteioRevisao(m))).toBe(
      '409:versao-desatualizada',
    );
    expect(revisado.alteracoes).toEqual([]);
    const cancelado = txFalsa({
      'FROM sorteio_revisao_prontuario': [{ id: 8, versao: 2, situacao: 'cancelado' }],
    });
    expect(await codigo(gravacoesComplementoQ1(cancelado.tx, 3).cancelarSorteioRevisao(m))).toBe(
      '409:versao-desatualizada',
    );
    const velha = txFalsa({
      'FROM sorteio_revisao_prontuario': [{ id: 8, versao: 1, situacao: 'sorteado' }],
    });
    expect(await codigo(gravacoesComplementoQ1(velha.tx, 3).cancelarSorteioRevisao(m))).toBe(
      '409:versao-desatualizada',
    );
  });

  it('assina a ata da reunião realizada e recusa a assinada ou a não realizada', async () => {
    const r = { id: 6, versao: 1, agora: '2026-11-02T09:00', usuario: 'a' };
    const ok = txFalsa({
      'FROM reuniao_comissao': [{ id: 6, versao: 1, situacao: 'realizada', ata_assinada_em: null }],
      ...USUARIO,
    });
    expect(await gravacoesComplementoQ1(ok.tx, 3).assinarAta(r)).toEqual({ versao: 2 });
    expect(ok.alteracoes[0]?.valores).toEqual({
      ata_assinada_em: '2026-11-02 09:00',
      ata_assinada_por_usuario_id: 4,
    });
    const assinada = txFalsa({
      'FROM reuniao_comissao': [{ id: 6, versao: 1, situacao: 'realizada', ata_assinada_em: new Date() }],
    });
    expect(await codigo(gravacoesComplementoQ1(assinada.tx, 3).assinarAta(r))).toBe(
      '409:versao-desatualizada',
    );
    const cancelada = txFalsa({
      'FROM reuniao_comissao': [{ id: 6, versao: 1, situacao: 'cancelada', ata_assinada_em: null }],
    });
    expect(await codigo(gravacoesComplementoQ1(cancelada.tx, 3).assinarAta(r))).toBe(
      '409:versao-desatualizada',
    );
  });

  it('cancela a auditoria sem dependentes e recusa a que tem não conformidade', async () => {
    const a = { id: 5, versao: 3, justificativa: 'Duplicada', agora: '2026-11-02T09:00', usuario: 'a' };
    const ok = txFalsa({
      'FROM auditoria_interna': [{ id: 5, versao: 3, situacao: 'concluida' }],
      ...USUARIO,
    });
    const anotacao: AnotacaoGravacao = { motivo: null, dados: null };
    expect(await gravacoesComplementoQ1(ok.tx, 3, anotacao).cancelarAuditoria(a)).toEqual({ versao: 4 });
    expect(ok.alteracoes[0]?.valores).toEqual({
      situacao: 'cancelada',
      cancelada_em: '2026-11-02 09:00',
      motivo_cancelamento: 'Duplicada',
    });
    expect(anotacao.motivo).toBe('Duplicada');
    const dep = txFalsa({
      'FROM auditoria_interna': [{ id: 5, versao: 3, situacao: 'concluida' }],
      'FROM nao_conformidade_qualidade': [{ id: 1 }],
      ...USUARIO,
    });
    expect(await codigo(gravacoesComplementoQ1(dep.tx, 3).cancelarAuditoria(a))).toBe('409:com-dependentes');
    expect(dep.alteracoes).toEqual([]);
  });
});
