// Integração da recusa de senha contra o MariaDB real, num cliente de teste PRÓPRIO (senhaui_int), criado aqui por
// `python3 -I tools/db/criar_cliente.py --plataforma plataforma_validacao_recusa_senha` e apagado no fim (banco do
// cliente e o banco plataforma de VALIDAÇÃO, recriado a cada execução; nunca o banco plataforma de uso). Conta
// FICTÍCIA; a senha é gerada a cada execução e nunca sai do processo. Confere: a política lida do banco do cliente vira
// a lista de regras; a troca que contém o login é recusada com o código deriva-do-login; o log da recusa (de login e de
// troca) leva rota, status, códigos e login, nunca a senha. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/sessao/recusa-senha.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { logger } from '../logger.js';
import { registrarRecusa } from '../modulos/acesso/acesso.controller.js';
import { portaSenhaDoNucleo } from '../modulos/acesso/senha/porta-senha.js';
import { ArmazemMemoria } from './armazem.js';
import { FonteAcessoPropria } from './fonte-propria.js';
import { ErroSessao, ServicoSessao } from './servico-sessao.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const CLIENTE = 'senhaui_int';
const REDE = 'rede-teste';
const LOGIN = 'admin';
/** Banco plataforma de validação, só deste arquivo (o registro do cliente nunca vai ao banco plataforma de uso). */
const PLAT = 'plataforma_validacao_recusa_senha';

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function apagarCliente(): void {
  sql(null, `DROP DATABASE IF EXISTS cliente_${CLIENTE}; DROP DATABASE IF EXISTS ${PLAT};`);
}

describe.skipIf(SEM_BANCO)('recusa de senha contra o MariaDB (cliente senhaui_int)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoSessao;
  const senha = `T${randomUUID()}9`;

  beforeAll(async () => {
    apagarCliente();
    execFileSync(
      'python3',
      [
        '-I',
        'tools/db/criar_cliente.py',
        CLIENTE,
        'Teste da recusa de senha',
        '--plataforma',
        PLAT,
        '--json',
      ],
      {
        cwd: RAIZ,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    // O núcleo resolve o cliente pelo banco plataforma de validação (onde o criar_cliente o registrou).
    nucleo = new NucleoProprio({ env: { ...ambienteEfetivo().env, SGH_BANCO_PLATAFORMA: PLAT } });
    const resumo = await cifrarSenha(senha);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-senhaui' }, async (e) => {
      const agora = new Date();
      const est = await e.inserir(
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        ['sui', 'Hospital fictício senhaui', 'Hospital fictício senhaui (teste)', agora],
      );
      await e.inserir(
        `INSERT INTO politica_senha (estabelecimento_id, tamanho_minimo, exige_numero, tentativas_ate_bloqueio,
           inatividade_sessao_minutos, aviso_fim_sessao_minutos, validade_dias, criado_em) VALUES (?, 10, TRUE, 4, 20, 2, 60, ?)`,
        [est, agora],
      );
      const id = await e.inserir(
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, 'Conta fictícia administradora', agora],
      );
      await e.inserir(
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [id, est, '2026-01-01', agora],
      );
      await e.inserir(
        'INSERT INTO credencial_usuario (usuario_id, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em) VALUES (?, ?, ?, TRUE, ?)',
        [id, resumo, agora, agora],
      );
    });
    const fonte = new FonteAcessoPropria(nucleo, CLIENTE, REDE, () => undefined);
    await fonte.carregar();
    const porta = portaSenhaDoNucleo(
      nucleo,
      () => {
        throw new Error('este teste não grava senha');
      },
      CLIENTE,
    );
    servico = new ServicoSessao(fonte, new ArmazemMemoria(), () => Date.now(), { senha: porta });
  });

  afterAll(async () => {
    await nucleo?.encerrar();
    apagarCliente();
  });

  it('a lista de regras vem da política do banco do cliente; a senha com o login é recusada com o código', async () => {
    const r = await servico.entrar({ estabelecimento: 'sui', login: LOGIN, senha }, REDE);
    expect(r.sessao.trocaSenha).toBeTruthy();
    const p = await servico.regrasSenha(r.idSessao, REDE);
    expect(p.login).toBe(LOGIN);
    expect(p.regras.find((x) => x.codigo === 'curta')).toMatchObject({ valor: 10, aoVivo: true });
    expect(p.regras.map((x) => x.codigo)).toEqual(expect.arrayContaining(['sem-numero', 'deriva-do-login']));

    const espia = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
    const nova = 'Admin#Forte2026x';
    const e = await servico
      .trocarSenha(r.idSessao, REDE, { senhaAtual: senha, senhaNova: nova })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroSessao);
    expect((e as ErroSessao).falhas).toEqual(['deriva-do-login']);
    registrarRecusa('POST /api/sessao/senha', e, null);

    const errada = await servico
      .entrar({ estabelecimento: 'sui', login: LOGIN, senha: `${senha}x` }, REDE)
      .catch((x: unknown) => x);
    registrarRecusa('POST /api/sessao', errada, LOGIN);

    expect(espia.mock.calls.map((c) => c[0])).toEqual([
      { rota: 'POST /api/sessao/senha', status: 422, codigos: ['deriva-do-login'], login: LOGIN },
      { rota: 'POST /api/sessao', status: 401, codigos: ['credencial-invalida'], login: LOGIN },
    ]);
    const tudo = JSON.stringify(espia.mock.calls);
    expect(tudo).not.toContain(nova);
    expect(tudo).not.toContain(senha);
    expect(tudo).not.toContain('argon2');
    espia.mockRestore();
  });
});
