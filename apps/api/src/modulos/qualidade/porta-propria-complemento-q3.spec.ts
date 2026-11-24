// Unidade do complemento Q3 da gestão da qualidade (revisão de prontuários): o mapeamento das linhas do modelo para o
// contrato e as recusas das gravações com uma transação falsa (a integração contra o banco está no .int.spec).
import type { TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  codigoChecklistRevisao,
  gravacoesComplementoQ3,
  METODOS_COMPLEMENTO_Q3,
  pendencia,
  prontuario,
  TABELAS_COMPLEMENTO_Q3,
} from './porta-propria-complemento-q3.js';

const BASE_PEND = {
  id: 5,
  prontuario: 3,
  atendimento_id: 77,
  item: 'assinatura',
  descricao: 'Falta assinatura.',
  profissional: 9,
  profissional_nome: 'NOME',
  profissional_login: 'MEDICO',
  prazo_em: new Date(2026, 10, 10),
  resolucao: null,
  resolvida_em: null,
  resolvida_por: null,
  apontada_em: new Date(2026, 10, 1, 8, 30, 0),
  versao: 1,
};

describe('complemento Q3: mapeamento', () => {
  it('cobre os métodos do terceiro quarto e grava só as tabelas do checklist e da pendência', () => {
    expect([...METODOS_COMPLEMENTO_Q3].sort()).toEqual(
      [
        'pendenciaRevisao',
        'pendenciasDoLogin',
        'pendenciasDosProntuarios',
        'prontuarioRevisao',
        'prontuariosDoSorteio',
        'publicarChecklistRevisao',
        'responderPendenciaRevisao',
      ].sort(),
    );
    expect(TABELAS_COMPLEMENTO_Q3).toContain('pendencia_prontuario');
    expect(codigoChecklistRevisao(12)).toBe('revisao_prontuario_12');
  });

  it('pendência: aberta, resolvida (com resposta) e cancelada (quem, quando e motivo)', () => {
    const aberta = pendencia({ ...BASE_PEND, situacao: 'em_resolucao' });
    expect([aberta.situacao, aberta.prazo, aberta.criadaEm, aberta.resposta]).toEqual([
      'aberta',
      '2026-11-10',
      '2026-11-01T08:30:00',
      null,
    ]);
    const quando = new Date(2026, 10, 3, 9, 0, 0);
    const resolvida = pendencia({
      ...BASE_PEND,
      situacao: 'justificada',
      resolucao: 'Feito.',
      resolvida_em: quando,
      resolvida_por: 'X',
    });
    expect([resolvida.situacao, resolvida.resposta, resolvida.resolvidaPor, resolvida.canceladaPor]).toEqual([
      'resolvida',
      'Feito.',
      'X',
      null,
    ]);
    const cancelada = pendencia({
      ...BASE_PEND,
      situacao: 'cancelada',
      resolucao: 'Revisão corrigida.',
      resolvida_em: quando,
      resolvida_por: 'Y',
    });
    expect([
      cancelada.situacao,
      cancelada.resposta,
      cancelada.canceladaPor,
      cancelada.canceladaEm,
      cancelada.motivoCancelamento,
    ]).toEqual(['cancelada', null, 'Y', '2026-11-03T09:00:00', 'Revisão corrigida.']);
  });

  it('prontuário: sem data de revisão é aRevisar (sem revisor); revisado leva o resultado e o revisor', () => {
    const base = {
      id: 3,
      sorteio: 2,
      ordem: 1,
      atendimento_id: 77,
      paciente_id: 4,
      alta: null,
      clinica: null,
      medico: null,
      medico_nome: null,
      observacao: null,
      revisor: 'REV',
      aval_por: null,
      avalizada_em: null,
      versao: 1,
    };
    const a = prontuario({ ...base, revisada_em: null, resultado: null, situacao: 'em_andamento' }, null);
    expect([a.situacao, a.revisadoPor, a.revisadoEm, a.alta, a.clinica]).toEqual([
      'aRevisar',
      null,
      null,
      '',
      '',
    ]);
    const r = prontuario(
      {
        ...base,
        revisada_em: new Date(2026, 10, 2, 10, 0, 0),
        resultado: 'nao_conforme',
        situacao: 'concluida',
      },
      '[]',
    );
    expect([r.situacao, r.revisadoPor, r.revisadoEm, r.respostas]).toEqual([
      'naoConforme',
      'REV',
      '2026-11-02T10:00:00',
      '[]',
    ]);
  });
});

/** Transação falsa: devolve as linhas dadas para cada consulta e registra as alterações. */
function txFalsa(linhas: Record<string, unknown>[]): { tx: TxOperacao; alteracoes: unknown[] } {
  const alteracoes: unknown[] = [];
  const tx = {
    consultarParaAtualizar: () => Promise.resolve(linhas),
    uma: () => Promise.resolve({ id: 1 }),
    alterar: (...a: unknown[]) => {
      alteracoes.push(a);
      return Promise.resolve(2);
    },
    incluir: () => Promise.resolve(10),
  } as unknown as TxOperacao;
  return { tx, alteracoes };
}

describe('complemento Q3: gravações', () => {
  const resposta = { id: 5, versao: 1, resposta: 'Ok.', agora: '2026-11-02T09:00:00', usuario: 'U' };

  it('responder: inexistente, versão diferente ou já resolvida recusam 409 sem alterar', async () => {
    for (const linhas of [
      [],
      [{ id: 5, versao: 2, situacao: 'aberta' }],
      [{ id: 5, versao: 1, situacao: 'resolvida' }],
    ]) {
      const { tx, alteracoes } = txFalsa(linhas);
      await expect(gravacoesComplementoQ3(tx, 1).responderPendenciaRevisao(resposta)).rejects.toMatchObject({
        problema: { status: 409 },
      });
      expect(alteracoes).toEqual([]);
    }
  });

  it('responder: a aberta passa a resolvida com a resposta, quem e quando', async () => {
    const { tx, alteracoes } = txFalsa([{ id: 5, versao: 1, situacao: 'aberta' }]);
    await expect(gravacoesComplementoQ3(tx, 1).responderPendenciaRevisao(resposta)).resolves.toEqual({
      versao: 2,
    });
    expect(alteracoes).toEqual([
      [
        'pendencia_prontuario',
        5,
        1,
        {
          situacao: 'resolvida',
          resolucao: 'Ok.',
          resolvida_em: '2026-11-02 09:00:00',
          resolvida_por_usuario_id: 1,
        },
      ],
    ]);
  });

  it('publicar: checklist sem itens recusa antes de gravar', async () => {
    const { tx, alteracoes } = txFalsa([]);
    await expect(
      gravacoesComplementoQ3(tx, 1).publicarChecklistRevisao({
        comissao: 1,
        itens: '[]',
        motivo: null,
        vigente: null,
        agora: '2026-11-02T09:00:00',
        usuario: 'U',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'checklist-sem-itens' } });
    expect(alteracoes).toEqual([]);
  });
});
