import { describe, expect, it } from 'vitest';
import {
  codigosNaUnificacao,
  dadosNaUnificacao,
  errosDesfazerUnificacao,
  errosUnificacao,
  registroNaAlteracao,
  situacaoAoDesfazerUnificacao,
  solicitanteVigente,
} from './unificacao.js';

const vivo = (id: number) => ({ id, ativo: true, sucessor: null });
const MOTIVO = 'mesmo médico digitado duas vezes';

describe('unificação de solicitante externo (02-CAD linha 20)', () => {
  it('aceita unificar um cadastro vivo ou inativo num cadastro vivo, com o motivo', () => {
    expect(errosUnificacao({ mantido: vivo(1), absorvido: vivo(2), motivo: MOTIVO })).toEqual([]);
    expect(
      errosUnificacao({
        mantido: vivo(1),
        absorvido: { id: 2, ativo: false, sucessor: null },
        motivo: MOTIVO,
      }),
    ).toEqual([]);
  });

  it('recusa o mesmo cadastro, o já unificado, o destino inativo ou unificado e o motivo curto', () => {
    expect(errosUnificacao({ mantido: vivo(1), absorvido: vivo(1), motivo: MOTIVO })).toEqual([
      'mesmo-cadastro',
    ]);
    expect(
      errosUnificacao({ mantido: vivo(1), absorvido: { id: 2, ativo: false, sucessor: 3 }, motivo: MOTIVO }),
    ).toEqual(['absorvido-ja-unificado']);
    expect(
      errosUnificacao({ mantido: { id: 1, ativo: false, sucessor: 9 }, absorvido: vivo(2), motivo: MOTIVO }),
    ).toEqual(['mantido-unificado']);
    expect(
      errosUnificacao({
        mantido: { id: 1, ativo: false, sucessor: null },
        absorvido: vivo(2),
        motivo: ' curto  ',
      }),
    ).toEqual(['mantido-inativo', 'motivo-curto']);
  });

  it('herda o código só na fonte em que o cadastro que continua não tem linha; aponta a divergência', () => {
    const r = codigosNaUnificacao(
      [
        { fonte: 10, codigo: 'AB-1', ativo: true },
        { fonte: 11, codigo: 'x9', ativo: true },
        { fonte: 12, codigo: 'ANTIGO', ativo: false },
      ],
      [
        { fonte: 10, codigo: 'AB-2', ativo: true }, // diverge: fica o do que continua
        { fonte: 11, codigo: ' X9 ', ativo: true }, // igual sem caixa nem espaço: nada a fazer
        { fonte: 12, codigo: 'NOVO', ativo: true }, // o que continua já tem linha (inativa): não herda
        { fonte: 13, codigo: 'H-1', ativo: true }, // herda
        { fonte: 14, codigo: 'H-2', ativo: false }, // inativo no absorvido: não herda
      ],
    );
    expect(r.herdar).toEqual([{ fonte: 13, codigo: 'H-1', ativo: true }]);
    expect(r.divergentes).toEqual([10]);
  });

  it('desfazer exige que o cadastro esteja unificado e o motivo', () => {
    expect(
      errosDesfazerUnificacao({ absorvido: { id: 2, ativo: false, sucessor: 1 }, motivo: MOTIVO }),
    ).toEqual([]);
    expect(errosDesfazerUnificacao({ absorvido: vivo(2), motivo: 'curto' })).toEqual([
      'nao-unificado',
      'motivo-curto',
    ]);
  });

  it('o cadastro que responde hoje segue o ponteiro até o fim e não gira em ciclo', () => {
    const m = new Map<number, number | null>([
      [1, null],
      [2, 1],
      [3, 2],
      [7, 8],
      [8, 7],
    ]);
    expect(solicitanteVigente(3, m)).toBe(1);
    expect(solicitanteVigente(1, m)).toBe(1);
    expect(solicitanteVigente(99, m)).toBe(99);
    expect(solicitanteVigente(7, m)).toBe(7);
  });

  it('o que continua recebe do duplicado só o dado que não tem; a instituição vem inteira ou não vem', () => {
    const semNada = {
      cpf: null,
      cns: null,
      ocupacao: null,
      especialidade: null,
      instituicaoNome: null,
      instituicaoCnpj: null,
      instituicaoCnes: null,
      telefone: null,
      email: null,
    };
    const r = dadosNaUnificacao(
      {
        ...semNada,
        cpf: '11111111111',
        email: 'a@sintetico.test',
        instituicaoNome: 'CLINICA A',
        telefone: ' ',
      },
      {
        ...semNada,
        cpf: '22222222222', // os dois têm e diferem: fica o do que continua
        cns: '700000000000001', // falta: herda
        ocupacao: 7,
        email: 'A@SINTETICO.TEST', // igual sem caixa
        telefone: '3100000000', // o que continua só tem espaço: herda
        instituicaoNome: 'CLINICA B', // diverge
        instituicaoCnpj: '11111111000191', // não herda: o que continua já tem instituição
      },
    );
    expect(r.herdar).toEqual({ cns: '700000000000001', ocupacao: 7, telefone: '3100000000' });
    expect(r.divergentes).toEqual(['cpf', 'instituicaoNome']);
    const inst = dadosNaUnificacao(semNada, {
      ...semNada,
      instituicaoNome: 'CLINICA B',
      instituicaoCnes: '1234567',
    });
    expect(inst.herdar).toEqual({ instituicaoNome: 'CLINICA B', instituicaoCnes: '1234567' });
    expect(inst.divergentes).toEqual([]);
  });

  it('desfazer devolve a situação anterior: quem já estava inativo não é reativado', () => {
    expect(situacaoAoDesfazerUnificacao(true)).toEqual({ reativar: true });
    expect(situacaoAoDesfazerUnificacao(false)).toEqual({ reativar: false });
    expect(situacaoAoDesfazerUnificacao(null)).toEqual({ reativar: true });
  });

  it('o registro do que continua pode assumir o do duplicado unificado nele (troca); o de outro cadastro é recusa', () => {
    const reg = (numero: string) => ({ conselho: 'CRM', uf: 'MG', numero });
    const meu = { id: 1, anterior: reg('100'), novo: reg('200') };
    // o duplicado unificado neste cadastro tem o número certo: troca com ele
    expect(registroNaAlteracao({ ...meu, iguais: [{ id: 2, sucessor: 1, registro: reg('200') }] })).toEqual({
      recusar: [],
      trocarCom: 2,
    });
    // mesma chave, texto diferente (zero à esquerda): não precisa trocar, a chave única do banco não colide
    expect(registroNaAlteracao({ ...meu, iguais: [{ id: 2, sucessor: 1, registro: reg('0200') }] })).toEqual({
      recusar: [],
      trocarCom: null,
    });
    // cadastro de fora, ou unificado em OUTRO: recusa
    expect(
      registroNaAlteracao({
        ...meu,
        iguais: [
          { id: 2, sucessor: 1, registro: reg('200') },
          { id: 3, sucessor: null, registro: reg('0200') },
          { id: 4, sucessor: 9, registro: reg('00200') },
        ],
      }),
    ).toEqual({ recusar: [3, 4], trocarCom: null });
    // sem mudar o registro, o próprio unificado com a mesma chave não impede gravar os outros campos
    expect(
      registroNaAlteracao({
        id: 1,
        anterior: reg('200'),
        novo: reg('200'),
        iguais: [{ id: 2, sucessor: 1, registro: reg('0200') }],
      }),
    ).toEqual({ recusar: [], trocarCom: null });
  });
});
