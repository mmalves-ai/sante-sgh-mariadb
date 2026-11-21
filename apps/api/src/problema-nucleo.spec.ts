// F2-L: o filtro de Problem Details traduz os erros do núcleo próprio (ErroOperacao e erros do driver do MariaDB)
// para o contrato da tela, sem valor de coluna nem mensagem crua do banco. Dados sintéticos.
import type { ArgumentsHost } from '@nestjs/common';
import { esquemaProblema, urnProblema } from '@sgh/contratos';
import { erroConflitoVersao, erroRegistroEmEdicao, recusa } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import { ProblemaFilter } from './problema.filter.js';

function capturar(erro: unknown): { status: number; corpo: Record<string, unknown> } {
  let corpo: Record<string, unknown> = {};
  let status = 0;
  const resposta = {
    status: (s: number) => ((status = s), resposta),
    header: () => resposta,
    send: (c: Record<string, unknown>) => (corpo = c),
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => resposta }),
  } as unknown as ArgumentsHost;
  new ProblemaFilter().catch(erro, host);
  return { status, corpo };
}

describe('Problem Details: erros do núcleo próprio', () => {
  it('conflito de versão vira conflito-de-versao com as colunas em campos', () => {
    const { status, corpo } = capturar(erroConflitoVersao(['nome']));
    expect(status).toBe(409);
    expect(corpo).toMatchObject({
      type: urnProblema('conflito-de-versao'),
      codigo: 'conflito-versao',
      campos: ['nome'],
    });
    expect(esquemaProblema.safeParse(corpo).success).toBe(true);
  });

  it('recusa de negócio leva o código próprio', () => {
    const { status, corpo } = capturar(recusa('login-em-uso', 'Já existe um usuário com este login.'));
    expect(status).toBe(409);
    expect(corpo).toMatchObject({ type: urnProblema('recusa-de-negocio'), codigo: 'login-em-uso' });
  });

  it('registro em edição tem tipo próprio', () => {
    expect(capturar(erroRegistroEmEdicao()).corpo['type']).toBe(urnProblema('registro-em-edicao'));
  });

  it('chave única do driver vira registro-duplicado, sem a mensagem do banco', () => {
    const driver = Object.assign(new Error("Duplicate entry 'VALOR-SECRETO' for key 'uq_usuario_login'"), {
      errno: 1062,
      code: 'ER_DUP_ENTRY',
      sqlMessage: "Duplicate entry 'VALOR-SECRETO' for key 'uq_usuario_login'",
    });
    const { status, corpo } = capturar(driver);
    expect(status).toBe(409);
    expect(corpo['codigo']).toBe('registro-duplicado');
    expect(JSON.stringify(corpo)).not.toContain('VALOR-SECRETO');
  });

  it('erro qualquer sai 500 genérico, sem detalhe', () => {
    const { status, corpo } = capturar(new Error('falha interna com dado'));
    expect(status).toBe(500);
    expect(corpo).toMatchObject({ type: urnProblema('erro-interno'), codigo: 'erro-interno' });
    expect(corpo['detail']).toBeUndefined();
  });

  it('banco fora do ar sai 503 indisponível', () => {
    const { status, corpo } = capturar(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    expect(status).toBe(503);
    expect(corpo['type']).toBe(urnProblema('indisponivel'));
  });
});
