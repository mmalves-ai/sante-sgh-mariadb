// Unidade do complemento Q4 da porta própria da gestão da qualidade (qualidade-q4): o mapeamento da reunião para o
// contrato, o filtro pelo estabelecimento (pela comissão), a ordem das reuniões e a retificação da ata (versão
// conferida, assinatura limpa e guardada como anterior, versão anterior na trilha, recusas sem gravar).
import { ErroOperacao, type Executor, type TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoQualidade } from './apoio-propria.js';
import type { AnotacaoGravacao } from '../enfermagem/gravacao-direta.js';
import {
  gravadorComplementoQ4,
  LeiturasGestaoComplementoQ4,
  METODOS_COMPLEMENTO_Q4,
} from './porta-propria-complemento-q4.js';
import { METODOS_PORTA_GESTAO } from './porta-gestao.js';

const LINHA = {
  id: 21,
  comissao_hospitalar_id: 4,
  tipo: 'ordinaria',
  situacao: 'realizada',
  agendada_para: new Date(2026, 9, 5, 14, 0, 0),
  realizada_em: new Date(2026, 9, 5, 14, 30, 0),
  pauta: 'Pauta sintética',
  ata: 'Ata sintética',
  deliberacoes: null,
  presentes_registrados: '["MEMBRO A","MEMBRO B"]',
  membros_quantidade: 3,
  presentes_quantidade: 2,
  convidados: null,
  criado_em: new Date(2026, 9, 5, 16, 0, 0),
  registrada_por: 'SECRETARIA',
  versao: 2,
  ata_assinada_em: null,
  assinada_por: null,
  cancelada_em: null,
  motivo_cancelamento: null,
  assinatura_anterior_em: null,
  assinatura_anterior_por: null,
};

function leiturasFalsas(linhas: unknown[]) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const leitor = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(linhas);
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(linhas[0] ?? null);
    },
  };
  const nucleo = {
    lerSomente: (_c: unknown, fn: (l: typeof leitor) => Promise<unknown>) => fn(leitor),
    criarExecutor: () => ({}) as Executor,
  } as unknown as NucleoQualidade;
  return { leituras: new LeiturasGestaoComplementoQ4(nucleo), chamadas };
}
const C = { cliente: 'teste', estabelecimento: 3, usuario: 1, correlacao: 'x' } as never;

function txFalsa(travada: Record<string, unknown> | null) {
  const comandos: { sql: string; p: readonly unknown[] }[] = [];
  const tx = {
    consultarParaAtualizar: (sql: string, p: readonly unknown[]) => {
      comandos.push({ sql, p });
      return Promise.resolve(travada ? [travada] : []);
    },
    uma: (sql: string, p: readonly unknown[]) => {
      comandos.push({ sql, p });
      return Promise.resolve(sql.includes('FROM usuario') ? { id: 77 } : null);
    },
    consultar: () => Promise.resolve([]),
    executar: (sql: string, p: readonly unknown[]) => {
      comandos.push({ sql, p });
      return Promise.resolve(1);
    },
  } as unknown as TxOperacao;
  return { tx, comandos };
}

const RETIFICACAO = {
  id: 21,
  versao: 2,
  pauta: 'Pauta nova',
  ata: 'Ata nova',
  presentes: '["MEMBRO A"]',
  presentesTotal: 1,
  convidados: 'Convidado sintético',
  deliberacoes: null,
  justificativa: 'Correção do texto',
  assinaturaAtual: null,
  agora: '2026-11-02T10:00:00',
  usuario: 'gestor',
};

describe('complemento Q4 da porta própria da gestão (unidade)', () => {
  it('as leituras cobertas são da porta da gestão; a retificação é do gravador', () => {
    for (const m of METODOS_COMPLEMENTO_Q4.filter((x) => x !== 'retificarAta'))
      expect(METODOS_PORTA_GESTAO.has(m)).toBe(true);
    const { tx } = txFalsa(null);
    expect(Object.keys(gravadorComplementoQ4(tx, 3, { motivo: null, dados: null }))).toEqual([
      'retificarAta',
    ]);
  });

  it('a reunião sai no contrato, lida no estabelecimento pela comissão', async () => {
    const { leituras, chamadas } = leiturasFalsas([LINHA]);
    expect(await leituras.reuniao(C, 21)).toEqual({
      id: 21,
      comissao: 4,
      tipo: 'ordinaria',
      realizadaEm: '2026-10-05T14:30:00',
      pauta: 'Pauta sintética',
      ata: 'Ata sintética',
      presentes: '["MEMBRO A","MEMBRO B"]',
      membrosTotal: 3,
      presentesTotal: 2,
      convidados: null,
      deliberacoes: null,
      registradaPor: 'SECRETARIA',
      registradaEm: '2026-10-05T16:00:00',
      versao: 2,
      ataAssinadaEm: null,
      ataAssinadaPor: null,
      canceladaEm: null,
      motivoCancelamento: null,
      assinaturaAnteriorEm: null,
      assinaturaAnteriorPor: null,
    });
    expect(chamadas[0]?.sql).toContain('c.estabelecimento_id = ?');
    expect(chamadas[0]?.sql).toContain('r.excluido_em IS NULL');
    expect(chamadas[0]?.p).toEqual([3, 21]);
  });

  it('a reunião inexistente é nula; a sem presentes registrados devolve a lista vazia', async () => {
    expect(await leiturasFalsas([]).leituras.reuniao(C, 99)).toBeNull();
    const r = await leiturasFalsas([
      { ...LINHA, presentes_registrados: null, membros_quantidade: null, realizada_em: null },
    ]).leituras.reuniao(C, 21);
    expect(r).toMatchObject({ presentes: '[]', membrosTotal: 0, realizadaEm: '2026-10-05T14:00:00' });
  });

  it('as reuniões da comissão vêm da mais recente para a mais antiga, no estabelecimento', async () => {
    const { leituras, chamadas } = leiturasFalsas([LINHA]);
    expect((await leituras.reunioes(C, 4)).map((x) => x.id)).toEqual([21]);
    expect(chamadas[0]?.sql).toMatch(
      /ORDER BY COALESCE\(r\.realizada_em, r\.agendada_para\) DESC, r\.id DESC/,
    );
    expect(chamadas[0]?.p).toEqual([3, 4]);
  });

  it('retificar a ata grava o texto novo, sobe a versão e põe a versão anterior na trilha', async () => {
    const { tx, comandos } = txFalsa({ ...LINHA, ata_assinada_em: null, ata_assinada_por_usuario_id: null });
    const anotacao: AnotacaoGravacao = { motivo: null, dados: null };
    expect(await gravadorComplementoQ4(tx, 3, anotacao).retificarAta(RETIFICACAO)).toEqual({ versao: 3 });
    expect(comandos[0]?.sql).toContain('c.estabelecimento_id = ?');
    expect(comandos[0]?.p).toEqual([21, 3]);
    const upd = comandos.find((x) => x.sql.includes('UPDATE reuniao_comissao'))!;
    expect(upd.sql).not.toContain('assinatura_anterior_em');
    expect(upd.p).toEqual([
      'Pauta nova',
      'Ata nova',
      '["MEMBRO A"]',
      1,
      'Convidado sintético',
      null,
      '2026-11-02 10:00:00',
      77,
      21,
      2,
    ]);
    expect(anotacao.motivo).toBe('Correção do texto');
    expect(anotacao.dados?.['versaoAnterior']).toMatchObject({
      tabela: 'reuniao_comissao',
      id: 21,
      versao: 2,
      acao: 'retificacao',
      motivo: 'Correção do texto',
      dados: { ata: 'Ata sintética', realizada_em: '2026-10-05T14:30:00' },
    });
  });

  it('retificar a ata assinada limpa a assinatura e a guarda como a anterior', async () => {
    const { tx, comandos } = txFalsa({
      ...LINHA,
      ata_assinada_em: new Date(2026, 9, 6, 9, 0, 0),
      ata_assinada_por_usuario_id: 9,
    });
    await gravadorComplementoQ4(tx, 3, { motivo: null, dados: null }).retificarAta({
      ...RETIFICACAO,
      assinaturaAtual: { em: '2026-10-06T09:00:00', por: 'PRESIDENTE' },
    });
    const upd = comandos.find((x) => x.sql.includes('UPDATE reuniao_comissao'))!;
    expect(upd.sql).toMatch(/assinatura_anterior_em = ata_assinada_em/);
    expect(upd.sql).toMatch(/ata_assinada_em = NULL, ata_assinada_por_usuario_id = NULL/);
  });

  it.each([
    ['inexistente ou de outro estabelecimento', null, {}],
    ['com a versão divergente', LINHA, { versao: 1 }],
    ['cancelada', { ...LINHA, situacao: 'cancelada', cancelada_em: new Date() }, {}],
    ['assinada sem a tela saber', { ...LINHA, ata_assinada_em: new Date() }, {}],
    [
      'lida como assinada e já sem assinatura',
      LINHA,
      { assinaturaAtual: { em: '2026-10-06T09:00:00', por: 'PRESIDENTE' } },
    ],
  ])('a reunião %s recusa sem gravar', async (_caso, travada, mudanca) => {
    const { tx, comandos } = txFalsa(travada as Record<string, unknown> | null);
    const anotacao: AnotacaoGravacao = { motivo: null, dados: null };
    const e = await gravadorComplementoQ4(tx, 3, anotacao)
      .retificarAta({ ...RETIFICACAO, ...mudanca })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroOperacao);
    expect((e as ErroOperacao).problema.codigo).toBe('versao-desatualizada');
    expect(comandos.some((x) => x.sql.includes('UPDATE'))).toBe(false);
    expect(anotacao.dados).toBeNull();
  });
});
