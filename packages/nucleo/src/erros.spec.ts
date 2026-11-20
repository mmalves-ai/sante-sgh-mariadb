import { describe, expect, it } from 'vitest';
import { erroDoBanco } from './duble-banco.spec-util.js';
import {
  ErroOperacao,
  ErroTempoEsgotado,
  erroConflitoVersao,
  erroDeConexao,
  ehTravaOcupada,
  problemaDaOperacao,
  problemaDoBanco,
  recusa,
  restricaoUnicaViolada,
  restricaoViolada,
  traduzirErro,
} from './erros.js';

describe('erros do núcleo', () => {
  it('ErroOperacao vira Problem Details com código e extras', () => {
    const e = erroConflitoVersao(['versao']);
    expect(e.problema).toMatchObject({ status: 409, codigo: 'conflito-versao', colunas: ['versao'] });
    expect(e.problema.type).toBe('https://sgh.invalid/problemas/conflito-versao');
    expect(recusa('x-y', 'Motivo.').problema.status).toBe(409);
  });

  it('identifica a restrição violada só pelo nome', () => {
    expect(
      restricaoViolada(erroDoBanco(1062, 'ER_DUP_ENTRY', "Duplicate entry 'abc-1' for key 'uq_tipo_codigo'")),
    ).toEqual({
      tipo: 'unica',
      nome: 'uq_tipo_codigo',
    });
    expect(
      restricaoUnicaViolada(erroDoBanco(1062, 'ER_DUP_ENTRY', "Duplicate entry 'x' for key 'tabela.uq_a'")),
    ).toBe('uq_a');
    expect(
      restricaoViolada(
        erroDoBanco(
          1452,
          'ER_NO_REFERENCED_ROW_2',
          'Cannot add or update a child row: a foreign key constraint fails (`b`.`t`, CONSTRAINT `fk_t_x` FOREIGN KEY (`x`) REFERENCES `y` (`id`))',
        ),
      ),
    ).toEqual({ tipo: 'referencia_inexistente', nome: 'fk_t_x' });
    expect(
      restricaoViolada(
        erroDoBanco(
          1451,
          'ER_ROW_IS_REFERENCED_2',
          'Cannot delete or update a parent row: a foreign key constraint fails (`b`.`t`, CONSTRAINT `fk_z` FOREIGN KEY)',
        ),
      ),
    ).toEqual({ tipo: 'com_dependentes', nome: 'fk_z' });
    expect(
      restricaoViolada(
        erroDoBanco(4025, 'ER_CONSTRAINT_FAILED', 'CONSTRAINT `ck_usuario_cpf` failed for `b`.`usuario`'),
      ),
    ).toEqual({
      tipo: 'checagem',
      nome: 'ck_usuario_cpf',
    });
    expect(
      restricaoViolada(erroDoBanco(1048, 'ER_BAD_NULL_ERROR', "Column 'descricao' cannot be null")),
    ).toEqual({
      tipo: 'nulo',
      nome: 'descricao',
    });
    expect(
      restricaoViolada(erroDoBanco(1406, 'ER_DATA_TOO_LONG', "Data too long for column 'codigo' at row 1")),
    ).toEqual({
      tipo: 'tamanho',
      nome: 'codigo',
    });
    expect(restricaoViolada(new Error('qualquer'))).toBeNull();
  });

  it('traduz sem levar valor ao problema nem ao log', () => {
    const e = erroDoBanco(1062, 'ER_DUP_ENTRY', "Duplicate entry 'VALOR-SECRETO' for key 'uq_a'");
    const t = problemaDoBanco(e);
    expect(t.problema).toMatchObject({ status: 409, codigo: 'registro-duplicado', restricao: 'uq_a' });
    expect(t.log).toEqual({ classe: 'Error', errno: 1062, codigo: 'ER_DUP_ENTRY', restricao: 'uq_a' });
    expect(JSON.stringify(t)).not.toContain('VALOR-SECRETO');
  });

  it('traduz trava, tempo, conexão, checagem, nulo e erro desconhecido', () => {
    expect(ehTravaOcupada(erroDoBanco(1205, 'ER_LOCK_WAIT_TIMEOUT', 'Lock wait timeout exceeded'))).toBe(
      true,
    );
    expect(ehTravaOcupada(erroDoBanco(1213, 'ER_LOCK_DEADLOCK', 'Deadlock found'))).toBe(true);
    expect(problemaDaOperacao(erroDoBanco(1213, 'ER_LOCK_DEADLOCK', 'Deadlock')).codigo).toBe(
      'registro-em-edicao',
    );
    expect(problemaDaOperacao(new ErroTempoEsgotado('x')).codigo).toBe('tempo-esgotado');
    const caiu = Object.assign(new Error('socket'), { code: 'ER_SOCKET_UNEXPECTED_CLOSE', fatal: true });
    expect(erroDeConexao(caiu)).toBe(true);
    expect(problemaDaOperacao(caiu)).toMatchObject({ status: 503, codigo: 'banco-indisponivel' });
    expect(
      problemaDaOperacao(erroDoBanco(4025, 'ER_CONSTRAINT_FAILED', 'CONSTRAINT `ck_a` failed for `b`.`t`')),
    ).toMatchObject({
      status: 422,
      codigo: 'regra-do-banco',
    });
    expect(
      problemaDaOperacao(erroDoBanco(1048, 'ER_BAD_NULL_ERROR', "Column 'nome' cannot be null")),
    ).toMatchObject({
      status: 400,
      campos: ['nome'],
    });
    expect(problemaDaOperacao(erroDoBanco(1451, 'X', 'CONSTRAINT `fk_q` FOREIGN KEY')).codigo).toBe(
      'registro-com-dependentes',
    );
    expect(problemaDaOperacao(erroDoBanco(1452, 'X', 'CONSTRAINT `fk_q` FOREIGN KEY')).codigo).toBe(
      'referencia-inexistente',
    );
    expect(problemaDaOperacao(new Error('mensagem com dado'))).toMatchObject({
      status: 500,
      codigo: 'erro-interno',
    });
    expect(erroDeConexao(null)).toBe(false);
  });

  it('traduzirErro mantém o ErroOperacao e converte o resto', () => {
    const e = recusa('ja-existe', 'Já existe.');
    expect(traduzirErro(e)).toBe(e);
    const t = traduzirErro(erroDoBanco(1062, 'ER_DUP_ENTRY', "Duplicate entry 'x' for key 'uq_b'"));
    expect(t).toBeInstanceOf(ErroOperacao);
    expect(t.problema).toMatchObject({ codigo: 'registro-duplicado', restricao: 'uq_b' });
  });
});
