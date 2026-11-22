// Recusa de senha com o código de cada regra, a mensagem em português e o log sem senha. A troca recusada traz as
// falhas (códigos) e o login; a lista das regras vigentes sai do serviço; a linha do log tem só rota, status, códigos
// e login. Dados SINTÉTICOS.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mensagemRegraSenha, politicaEfetiva, regrasDaPolitica } from '@sgh/dominio-acesso';
import { registrarRecusa, registroRecusa } from '../modulos/acesso/acesso.controller.js';
import { portaSenhaMemoria } from '../modulos/acesso/senha/porta-senha.js';
import { logger } from '../logger.js';
import { ErroSessao } from './servico-sessao.js';
import { REDE, SENHA, entrada, montar } from './teste.spec-util.js';

const LEGADO = {
  minimoCaracteres: 10,
  exigeLetra: true,
  exigeNumero: true,
  exigeEspecial: true,
  exigeMinuscula: false,
  exigeMaiuscula: false,
  periodoTrocaDias: 0,
  periodoReutilizacaoDias: 30,
};

afterEach(() => vi.restoreAllMocks());

describe('regras da política de senha', () => {
  it('lista as regras vigentes com código, valor, mensagem e se a tela confere ao vivo', () => {
    const regras = regrasDaPolitica(politicaEfetiva(LEGADO));
    expect(regras.map((r) => r.codigo)).toEqual([
      'curta',
      'sem-letra',
      'sem-numero',
      'sem-especial',
      'deriva-do-login',
      'igual-atual',
      'repetida',
    ]);
    expect(regras[0]).toMatchObject({ valor: 10, aoVivo: true, mensagem: 'Ter pelo menos 10 caracteres.' });
    expect(regras.find((r) => r.codigo === 'repetida')).toMatchObject({ valor: 30, aoVivo: false });
    expect(mensagemRegraSenha('deriva-do-login')).toBe('Não conter o login (nem ao contrário).');
  });
});

describe('troca recusada: códigos e login', () => {
  it('a senha que contém o login é recusada com deriva-do-login e o erro leva o login', async () => {
    const m = montar({ config: { senha: portaSenhaMemoria() } });
    const r = await m.servico.entrar(entrada('SINT.USUARIO'), REDE);
    const e = await m.servico
      .trocarSenha(r.idSessao, REDE, { senhaAtual: SENHA, senhaNova: 'Sint.Usuario#2026' })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroSessao);
    const erro = e as ErroSessao;
    expect(erro.tipo).toBe('senha-recusada');
    expect(erro.falhas).toContain('deriva-do-login');
    expect(erro.login).toBe('SINT.USUARIO');
    const p = await m.servico.regrasSenha(r.idSessao, REDE);
    expect(p.login).toBe('SINT.USUARIO');
    expect(p.regras.map((x) => x.codigo)).toContain('deriva-do-login');
  });
});

describe('log da recusa', () => {
  it('registra rota, status, códigos e login; nunca a senha nem o resumo', () => {
    const senha = 'Admin#Segredo2026';
    const espia = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const erro = new ErroSessao('senha-recusada', 'x', 'senha-politica', [
      'deriva-do-login',
      'curta',
    ]).doLogin('admin');
    registrarRecusa('POST /api/sessao/senha', erro, null);
    registrarRecusa('POST /api/sessao/plataforma', new ErroSessao('credencial-invalida', 'x'), 'admin');
    expect(espia).toHaveBeenCalledTimes(2);
    expect(espia.mock.calls[0]?.[0]).toEqual({
      rota: 'POST /api/sessao/senha',
      status: 422,
      codigos: ['deriva-do-login', 'curta'],
      login: 'admin',
    });
    expect(espia.mock.calls[1]?.[0]).toEqual({
      rota: 'POST /api/sessao/plataforma',
      status: 401,
      codigos: ['credencial-invalida'],
      login: 'admin',
    });
    const tudo = JSON.stringify(espia.mock.calls);
    expect(tudo).not.toContain(senha);
    expect(tudo).not.toMatch(/argon2|senhaNova|senhaAtual|resumo/);
  });

  it('erro que não é recusa (5xx ou desconhecido) não vai ao log de recusa', () => {
    const espia = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    registrarRecusa('POST /api/sessao', new ErroSessao('indisponivel', 'x'), 'admin');
    registrarRecusa('POST /api/sessao', new Error('qualquer'), 'admin');
    expect(espia).not.toHaveBeenCalled();
    expect(registroRecusa('r', new Error('x'), null)).toBeNull();
  });
});
