// W0-06, parte 6 (M3): a forma das solicitações do autoatendimento, da decisão do gestor e da leitura do atestado.
import { describe, expect, it } from 'vitest';
import {
  esquemaDecidirSolicitacao,
  esquemaDesistirSolicitacao,
  esquemaFiltroFilaSolicitacoes,
  esquemaIncluirSolicitacao,
  esquemaLerAtestado,
} from './autoatendimento-solicitacao.js';

const caminhos = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join('.'));

describe('inclusão da solicitação', () => {
  it('férias: padrões de abono e adiantamento; gozo de 5 a 30', () => {
    const r = esquemaIncluirSolicitacao.parse({ tipo: 'ferias', inicio: '2026-12-07', diasGozo: 20 });
    expect(r).toEqual({
      tipo: 'ferias',
      vinculo: null,
      inicio: '2026-12-07',
      diasGozo: 20,
      diasAbono: 0,
      adiantaDecimo: false,
      observacao: null,
    });
    expect(
      caminhos(esquemaIncluirSolicitacao.safeParse({ tipo: 'ferias', inicio: '2026-12-07', diasGozo: 4 })),
    ).toEqual(['diasGozo']);
    expect(
      caminhos(
        esquemaIncluirSolicitacao.safeParse({
          tipo: 'ferias',
          inicio: '2026-12-07',
          diasGozo: 20,
          diasAbono: 11,
        }),
      ),
    ).toEqual(['diasAbono']);
  });

  it('abono: período e motivo de pelo menos 10 caracteres; fim depois do início', () => {
    const base = {
      tipo: 'abono',
      inicio: '2026-11-16',
      fim: '2026-11-17',
      observacao: 'Consulta do meu filho',
    };
    expect(esquemaIncluirSolicitacao.safeParse(base).success).toBe(true);
    expect(caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, observacao: 'curto' }))).toEqual([
      'observacao',
    ]);
    expect(caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, fim: '2026-11-15' }))).toEqual(['fim']);
  });

  it('ajuste de ponto: os mesmos campos do ajuste, conforme o tipo', () => {
    const base = { tipo: 'ajuste_ponto', dia: '2026-11-16', observacao: 'Esqueci de bater a saída' };
    expect(
      esquemaIncluirSolicitacao.safeParse({ ...base, ajuste: 'inclusao', instante: '2026-11-16T19:00' })
        .success,
    ).toBe(true);
    expect(caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, ajuste: 'inclusao' }))).toEqual([
      'instante',
    ]);
    expect(caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, ajuste: 'desconsiderar' }))).toEqual([
      'marcacao',
    ]);
    expect(caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, ajuste: 'justificativa' }))).toEqual([
      'movimento',
    ]);
  });

  it('alteração cadastral: só o nome, com valor e motivo', () => {
    const base = {
      tipo: 'alteracao_cadastral',
      campo: 'nome',
      valorNovo: 'MARIA DA SILVA SOUZA',
      observacao: 'Casamento em outubro',
    };
    expect(esquemaIncluirSolicitacao.safeParse(base).success).toBe(true);
    expect(caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, campo: 'salario' }))).toEqual(['campo']);
  });

  it('atestado: CID-10 opcional em maiúsculas; arquivo só PDF/JPEG/PNG até 10 MB com SHA-256', () => {
    const base = {
      tipo: 'atestado',
      inicio: '2026-11-16',
      fim: '2026-11-18',
      atestado: {
        emitidoEm: '2026-11-16',
        dias: 3,
        cid: 'j11.1',
        emitente: 'Dra. Ana Lima',
        registroConselho: 'CRM 1234',
      },
    };
    const r = esquemaIncluirSolicitacao.parse(base);
    expect(r.tipo === 'atestado' && r.atestado.cid).toBe('J11.1');
    expect(r.tipo === 'atestado' && r.atestado.arquivo).toBeNull();
    expect(
      caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, atestado: { ...base.atestado, cid: '123' } })),
    ).toEqual(['atestado.cid']);
    const arquivo = { chave: 'atestados/1.pdf', hash: 'a'.repeat(64), tipo: 'application/zip', tamanho: 10 };
    expect(
      caminhos(esquemaIncluirSolicitacao.safeParse({ ...base, atestado: { ...base.atestado, arquivo } })),
    ).toEqual(['atestado.arquivo.tipo']);
    expect(
      esquemaIncluirSolicitacao.safeParse({
        ...base,
        atestado: { ...base.atestado, arquivo: { ...arquivo, tipo: 'application/pdf' } },
      }).success,
    ).toBe(true);
  });

  it('tipo desconhecido e campo a mais são recusados', () => {
    expect(esquemaIncluirSolicitacao.safeParse({ tipo: 'emprestimo' }).success).toBe(false);
    expect(
      esquemaIncluirSolicitacao.safeParse({
        tipo: 'ferias',
        inicio: '2026-12-07',
        diasGozo: 20,
        pedidoPor: 'X',
      }).success,
    ).toBe(false);
  });
});

describe('decisão, desistência, fila e leitura do atestado', () => {
  it('a recusa exige motivo; a aprovação não', () => {
    expect(
      esquemaDecidirSolicitacao.safeParse({ solicitacao: 1, versao: 0, decisao: 'aprovar' }).success,
    ).toBe(true);
    expect(
      caminhos(
        esquemaDecidirSolicitacao.safeParse({
          solicitacao: 1,
          versao: 0,
          decisao: 'recusar',
          motivo: ' curto ',
        }),
      ),
    ).toEqual(['motivo']);
  });
  it('a desistência exige motivo', () => {
    expect(
      caminhos(esquemaDesistirSolicitacao.safeParse({ solicitacao: 1, versao: 0, motivo: 'x' })),
    ).toEqual(['motivo']);
  });
  it('a fila abre nas pendentes', () => {
    expect(esquemaFiltroFilaSolicitacoes.parse({})).toEqual({ situacao: 'pendente' });
  });
  it('o atestado só se lê com finalidade; o CID só a pedido', () => {
    expect(esquemaLerAtestado.parse({ finalidade: 'Conferir os dias' })).toEqual({
      finalidade: 'Conferir os dias',
      verCid: false,
    });
    expect(caminhos(esquemaLerAtestado.safeParse({ finalidade: 'ver' }))).toEqual(['finalidade']);
  });
});
