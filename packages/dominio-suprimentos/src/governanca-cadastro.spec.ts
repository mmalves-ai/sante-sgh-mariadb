// C2-082 (05-SUP linha 2): governança do cadastro de itens. A solicitação pela comissão de padronização (forma,
// duplicidade, transições com segregação, parecer e motivo, inativação sem saldo), a unificação (absorvidos, tipos,
// transições, conversão, saldo transferível) e a substituição (de-para).
import { describe, expect, it } from 'vitest';
import {
  conferirDuplicidadeInclusao,
  conferirInativacaoItem,
  conferirItensDaUnificacao,
  conferirSaldoTransferivel,
  conferirSolicitacaoCadastro,
  conferirSubstituicao,
  conferirUnificacao,
  fatorReferenciaConvertido,
  normalizarDescricaoItem,
  proximaSituacaoSolicitacao,
  proximaSituacaoUnificacao,
  quantidadeConvertida,
} from './index.js';

const JUST = 'Item usado no centro cirúrgico sem equivalente no cadastro.';
const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);

describe('solicitação de cadastro', () => {
  it('a inclusão bem formada passa; sem justificativa, com item ou com descrição curta é recusada', () => {
    expect(
      conferirSolicitacaoCadastro({
        tipo: 'inclusao',
        item: null,
        descricao: 'Luva nitrílica M',
        justificativa: JUST,
      }),
    ).toEqual([]);
    expect(
      codigos(
        conferirSolicitacaoCadastro({ tipo: 'inclusao', item: 5, descricao: 'Lu', justificativa: 'curta' }),
      ),
    ).toEqual(['item-na-inclusao', 'descricao-invalida', 'justificativa-curta']);
    expect(
      codigos(
        conferirSolicitacaoCadastro({
          tipo: 'inativacao',
          item: null,
          descricao: 'Luva',
          justificativa: JUST,
        }),
      ),
    ).toEqual(['sem-item']);
  });

  it('a descrição já existente (sem acento, pontuação e caixa) recusa a inclusão', () => {
    expect(normalizarDescricaoItem('  Seringa  descartável, 10 mL ')).toBe('SERINGA DESCARTAVEL 10 ML');
    const r = conferirDuplicidadeInclusao('SERINGA DESCARTAVEL, 10 ML', [
      { id: 1, nome: 'Seringa descartável 10 mL' },
    ]);
    expect(r?.codigo).toBe('item-ja-existe');
    expect(conferirDuplicidadeInclusao('Seringa 20 mL', [{ id: 1, nome: 'Seringa 10 mL' }])).toBeNull();
  });

  it('transições: enviar, aprovar só por outra pessoa e com parecer, reprovar com motivo, cancelar só por quem pediu', () => {
    const outro = { solicitante: 1, usuario: 2 } as const;
    const proprio = { solicitante: 1, usuario: 1 } as const;
    const parecer = 'Aprovado pela comissão';
    expect(proximaSituacaoSolicitacao({ ...proprio, situacao: 'rascunho', acao: 'enviar' })).toEqual({
      situacao: 'enviada',
    });
    expect(
      proximaSituacaoSolicitacao({ ...proprio, situacao: 'enviada', acao: 'aprovar', parecer }),
    ).toMatchObject({ codigo: 'segregacao' });
    expect(
      proximaSituacaoSolicitacao({ ...outro, situacao: 'enviada', acao: 'aprovar', parecer: 'ok' }),
    ).toMatchObject({ codigo: 'sem-parecer' });
    expect(
      proximaSituacaoSolicitacao({ ...outro, situacao: 'em_analise', acao: 'aprovar', parecer }),
    ).toEqual({
      situacao: 'aprovada',
    });
    expect(proximaSituacaoSolicitacao({ ...outro, situacao: 'enviada', acao: 'reprovar' })).toMatchObject({
      codigo: 'sem-motivo',
    });
    expect(
      proximaSituacaoSolicitacao({
        ...outro,
        situacao: 'enviada',
        acao: 'reprovar',
        motivo: 'Já existe equivalente',
      }),
    ).toEqual({ situacao: 'reprovada' });
    expect(
      proximaSituacaoSolicitacao({
        ...outro,
        situacao: 'enviada',
        acao: 'cancelar',
        motivo: 'Pedido em duplicidade',
      }),
    ).toMatchObject({ codigo: 'cancelar-so-solicitante' });
    expect(
      proximaSituacaoSolicitacao({
        ...proprio,
        situacao: 'enviada',
        acao: 'cancelar',
        motivo: 'Pedido em duplicidade',
      }),
    ).toEqual({ situacao: 'cancelada' });
    expect(
      proximaSituacaoSolicitacao({ ...outro, situacao: 'reprovada', acao: 'aprovar', parecer }),
    ).toMatchObject({ codigo: 'situacao-invalida' });
    expect(proximaSituacaoSolicitacao({ ...proprio, situacao: 'aprovada', acao: 'concluir' })).toEqual({
      situacao: 'concluida',
    });
  });

  it('a inativação aprovada usa a regra do cadastro: com saldo é recusada', () => {
    expect(conferirInativacaoItem({ motivo: 'Parecer da comissão', saldoTotal: 3 })?.codigo).toBe(
      'inativar-com-saldo',
    );
    expect(conferirInativacaoItem({ motivo: 'Parecer da comissão', saldoTotal: 0 })).toBeNull();
  });
});

describe('unificação de itens', () => {
  it('absorvidos distintos, nenhum igual ao que permanece, fator positivo e motivo', () => {
    expect(
      conferirUnificacao({
        permanece: 1,
        absorvidos: [
          { item: 2, fator: 1 },
          { item: 3, fator: 0.5 },
        ],
        motivo: 'Cadastro duplicado',
      }),
    ).toEqual([]);
    expect(
      codigos(
        conferirUnificacao({
          permanece: 1,
          absorvidos: [
            { item: 1, fator: 1 },
            { item: 2, fator: 0 },
            { item: 2, fator: 1 },
          ],
          motivo: 'dup',
        }),
      ),
    ).toEqual(['absorve-a-si', 'fator-invalido', 'absorvido-repetido', 'sem-motivo']);
    expect(
      codigos(conferirUnificacao({ permanece: 1, absorvidos: [], motivo: 'Cadastro duplicado' })),
    ).toEqual(['sem-absorvidos']);
  });

  it('só itens ativos e do mesmo tipo', () => {
    const p = { id: 1, nome: 'A', tipo: 'material', ativo: true };
    expect(conferirItensDaUnificacao(p, [{ id: 2, nome: 'B', tipo: 'material', ativo: true }])).toBeNull();
    expect(
      conferirItensDaUnificacao(p, [{ id: 2, nome: 'B', tipo: 'medicamento', ativo: true }])?.codigo,
    ).toBe('tipos-diferentes');
    expect(conferirItensDaUnificacao(p, [{ id: 2, nome: 'B', tipo: 'material', ativo: false }])?.codigo).toBe(
      'absorvido-inativo',
    );
    expect(conferirItensDaUnificacao({ ...p, ativo: false }, [])?.codigo).toBe('permanece-inativo');
  });

  it('transições: aprovação por outra pessoa, execução só aprovada, cancelamento com motivo', () => {
    const t = (x: Partial<Parameters<typeof proximaSituacaoUnificacao>[0]>) =>
      proximaSituacaoUnificacao({
        situacao: 'aguardando_aprovacao',
        acao: 'aprovar',
        solicitante: 1,
        usuario: 2,
        ...x,
      });
    expect(t({ usuario: 1 })).toMatchObject({ codigo: 'segregacao' });
    expect(t({})).toEqual({ situacao: 'aprovada' });
    expect(t({ acao: 'executar' })).toMatchObject({ codigo: 'situacao-invalida' });
    expect(t({ situacao: 'aprovada', acao: 'executar', usuario: 1 })).toEqual({ situacao: 'concluida' });
    expect(t({ situacao: 'aprovada', acao: 'cancelar' })).toMatchObject({ codigo: 'sem-motivo' });
    expect(t({ situacao: 'concluida', acao: 'cancelar', motivo: 'Unificação indevida' })).toMatchObject({
      codigo: 'situacao-invalida',
    });
  });

  it('conversão da quantidade e do fator das referências', () => {
    expect(quantidadeConvertida(7, 0.5)).toBe(3.5);
    expect(quantidadeConvertida(3, 1 / 3)).toBe(1);
    expect(fatorReferenciaConvertido(10, 0.5)).toBe(5);
  });

  it('saldo reservado, consignado ou sem lote (quando o que permanece controla lote) impede a transferência', () => {
    const s = { local: 'Almoxarifado', quantidade: 10, reservada: 0, consignada: 0, emLotes: 10 };
    expect(conferirSaldoTransferivel(s, true)).toBeNull();
    expect(conferirSaldoTransferivel({ ...s, reservada: 2 }, false)?.codigo).toBe('saldo-reservado');
    expect(conferirSaldoTransferivel({ ...s, consignada: 1 }, false)?.codigo).toBe('saldo-consignado');
    expect(conferirSaldoTransferivel({ ...s, emLotes: 4 }, true)?.codigo).toBe('saldo-sem-lote');
    expect(conferirSaldoTransferivel({ ...s, emLotes: 4 }, false)).toBeNull();
  });
});

describe('substituição (de-para)', () => {
  it('itens distintos, tipo, fator e vigência em ordem', () => {
    const s = {
      item: 1,
      substituto: 2,
      tipo: 'generico',
      fator: 1,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    } as const;
    expect(conferirSubstituicao(s)).toEqual([]);
    expect(
      codigos(conferirSubstituicao({ ...s, substituto: 1, fator: 0, vigenciaFim: '2025-12-31' })),
    ).toEqual(['substitui-a-si', 'fator-invalido', 'vigencia-invertida']);
  });
});
