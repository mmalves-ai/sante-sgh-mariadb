// Erros do executor em Problem Details (M04): recusa, prova pós-escrita, trava ocupada, restrição única e a
// tradução de um erro qualquer (só códigos e nomes de coluna; nenhuma mensagem crua do banco).
import { describe, expect, it } from 'vitest';
import {
  ErroOperacao,
  ErroProva,
  ehTravaOcupada,
  erroConflitoVersao,
  exigirEfeito,
  problemaDaOperacao,
  recusa,
  restricaoUnicaViolada,
} from './erros-operacao.js';

describe('erros da operação', () => {
  it('recusa: 409 com o código, com e sem campos', () => {
    expect(recusa('x-y', 'Não pode.').problema).toMatchObject({ status: 409, codigo: 'x-y' });
    expect(recusa('x-y', 'Não pode.', { campos: ['nome'] }).problema.campos).toEqual(['nome']);
  });

  it('exigirEfeito: passa com a condição e lança ErroProva sem ela', () => {
    expect(() => exigirEfeito(1, 'linha')).not.toThrow();
    expect(() => exigirEfeito(0, 'linha')).toThrow(ErroProva);
  });

  it('trava ocupada e restrição única só a partir de Error', () => {
    expect(ehTravaOcupada(new Error('lock time-out on wait transaction'))).toBe(true);
    expect(ehTravaOcupada(new Error('outra coisa'))).toBe(false);
    expect(ehTravaOcupada('lock time-out')).toBe(false);
    expect(restricaoUnicaViolada(new Error('violation of UNIQUE KEY constraint "uk_x"'))).toBe('UK_X');
    expect(restricaoUnicaViolada(new Error('sem restrição'))).toBeNull();
    // M19: índice único do legado sem restrição declarada (TBGERASENHA0).
    expect(
      restricaoUnicaViolada(
        new Error(
          'attempt to store duplicate value (visible to active transactions) in unique index "TBGERASENHA0"\n-Problematic key value is (...)',
        ),
      ),
    ).toBe('TBGERASENHA0');
    expect(restricaoUnicaViolada('violation of UNIQUE KEY constraint "UK_X"')).toBeNull();
  });

  it('problemaDaOperacao: ErroOperacao, prova, trava e erro do legado', () => {
    expect(problemaDaOperacao(erroConflitoVersao(['NOME'])).codigo).toBe('conflito-versao');
    expect(problemaDaOperacao(new ErroProva('linha')).codigo).toBe('acao_sem_efeito');
    expect(problemaDaOperacao(new Error('deadlock')).codigo).toBe('registro-em-edicao');
    expect(problemaDaOperacao(new Error('qualquer'))).toBeTypeOf('object');
    expect(new ErroOperacao(400, 'a', 't', 'd') instanceof Error).toBe(true);
  });
});
