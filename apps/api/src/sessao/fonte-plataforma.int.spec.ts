// Integração da fonte do login do ADMINISTRADOR DA PLATAFORMA (decisão do dono 2026-11-20, b) contra o MariaDB real,
// num banco plataforma de VALIDAÇÃO (plataforma_validacao_login), recriado a cada execução com db/plataforma/0001 e
// 0002 (nunca o banco plataforma de uso). Roda o SQL da FontePlataformaPropria pelo núcleo (lerPlataforma e
// escreverPlataforma): JOIN da credencial, situação do cliente, contagem e bloqueio por tentativas, zerar no login
// certo, troca de senha com o evento na linha do tempo do cliente e a colação (login só ASCII). Contas FICTÍCIAS; a
// senha é gerada a cada execução e nunca sai do processo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/sessao/fonte-plataforma.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FontePlataformaPropria, nucleoPlataforma } from './fonte-plataforma.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const BANCO = 'plataforma_validacao_login';
const RAPIDO = { memoria: 8_192, passes: 1, paralelismo: 1 };

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe.skipIf(SEM_BANCO)('FontePlataformaPropria contra o MariaDB (banco plataforma de validação)', () => {
  let nucleo: NucleoProprio;
  let fonte: FontePlataformaPropria;
  const senha = `P${randomUUID()}8`;
  const id: Record<string, number> = {};
  let relogio = new Date();

  const valor = (q: string): string => sql(BANCO, q).trim();

  beforeAll(async () => {
    sql(
      null,
      `DROP DATABASE IF EXISTS ${BANCO};
       CREATE DATABASE ${BANCO} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`,
    );
    for (const arq of ['0001_plataforma.sql', '0002_credencial_administrador.sql'])
      sql(BANCO, readFileSync(resolve(RAIZ, 'db/plataforma', arq), 'utf8'));
    const resumo = await cifrarSenha(senha, RAPIDO);
    sql(
      BANCO,
      `INSERT INTO cliente (codigo, nome, situacao, banco_nome, criado_em) VALUES
         ('cli_ativo', 'Cliente fictício ativo', 'implantacao', 'cliente_cli_ativo', NOW(3)),
         ('cli_suspenso', 'Cliente fictício suspenso', 'suspenso', 'cliente_cli_suspenso', NOW(3));
       INSERT INTO administrador_plataforma (nome, email, ativo, criado_em) VALUES
         ('Administrador fictício', 'adm.ok@exemplo.invalid', TRUE, NOW(3)),
         ('Administrador inativo', 'adm.inativo@exemplo.invalid', FALSE, NOW(3)),
         ('Administrador que erra', 'adm.erra@exemplo.invalid', TRUE, NOW(3));
       INSERT INTO credencial_administrador_plataforma
           (administrador_plataforma_id, login, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
         SELECT id, SUBSTRING_INDEX(email, '@', 1), '${resumo}', NOW(3), TRUE, NOW(3) FROM administrador_plataforma;`,
    );
    for (const l of valor(
      'SELECT CONCAT(login, "=", administrador_plataforma_id) FROM credencial_administrador_plataforma',
    ).split('\n')) {
      const [login, n] = l.split('=');
      if (login) id[login] = Number(n);
    }
    nucleo = new NucleoProprio({ env: { ...ambienteEfetivo().env, SGH_BANCO_PLATAFORMA: BANCO } });
    const np = nucleoPlataforma(nucleo);
    expect(np).not.toBe(null);
    if (!np) return;
    fonte = new FontePlataformaPropria(
      np,
      () => relogio,
      () => undefined,
      { limiteTentativas: 3, bloqueioSegundos: 600 },
    );
  });

  afterAll(async () => {
    await nucleo?.encerrar();
    sql(null, `DROP DATABASE IF EXISTS ${BANCO};`);
  });

  it('o núcleo expõe o banco plataforma (lerPlataforma/escreverPlataforma) e lista só os clientes ativos', async () => {
    expect(await fonte.clientes()).toEqual(['cli_ativo']);
  });

  it('login certo no cliente ativo: o ator com a troca obrigatória e o senha_alterada_em do banco', async () => {
    const r = await fonte.autenticar('adm.ok', senha, 'cli_ativo');
    expect(r).toMatchObject({
      desfecho: 'ok',
      ator: {
        tipo: 'plataforma',
        idAdministrador: id['adm.ok'],
        cliente: 'cli_ativo',
        trocaObrigatoria: true,
      },
    });
    const s = await fonte.situacao(id['adm.ok'] ?? -1);
    expect(s?.ativo).toBe(true);
    expect(r.desfecho === 'ok' ? r.ator.senhaAlteradaEm : -1).toBe(s?.senhaAlteradaEm);
  });

  it('conta inativa: impedida; cliente suspenso ou inexistente: indisponível (só depois da senha certa)', async () => {
    expect(await fonte.autenticar('adm.inativo', senha, 'cli_ativo')).toEqual({ desfecho: 'conta-impedida' });
    expect(await fonte.autenticar('adm.ok', senha, 'cli_suspenso')).toEqual({
      desfecho: 'cliente-indisponivel',
    });
    expect(await fonte.autenticar('adm.ok', senha, 'cli_nenhum')).toEqual({
      desfecho: 'cliente-indisponivel',
    });
    expect(await fonte.autenticar('adm.ok', `${senha}x`, 'cli_suspenso')).toEqual({
      desfecho: 'credencial-invalida',
    });
    expect(await fonte.autenticar('ninguem', senha, 'cli_ativo')).toEqual({
      desfecho: 'credencial-invalida',
    });
    expect((await fonte.situacao(id['adm.inativo'] ?? -1))?.ativo).toBe(false);
    expect(await fonte.situacao(999_999)).toBe(null);
  });

  it('senha errada conta pela credencial; no limite arma o bloqueio e zera; o login certo zera a contagem', async () => {
    const erra = id['adm.erra'] ?? -1;
    const contagem = () =>
      valor(
        `SELECT CONCAT(tentativas_falhas, ':', bloqueado_ate IS NOT NULL) FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = ${erra}`,
      );
    await fonte.autenticar('adm.erra', 'Errada#1', 'cli_ativo');
    expect(contagem()).toBe('1:0');
    // Senha certa zera.
    expect((await fonte.autenticar('adm.erra', senha, 'cli_ativo')).desfecho).toBe('ok');
    expect(contagem()).toBe('0:0');
    // Três erradas (limite 3): bloqueio armado e contagem a zero.
    for (let i = 0; i < 3; i++) await fonte.autenticar('adm.erra', 'Errada#1', 'cli_ativo');
    expect(contagem()).toBe('0:1');
    // Bloqueada: senha certa é impedida e senha errada não conta mais.
    expect(await fonte.autenticar('adm.erra', senha, 'cli_ativo')).toEqual({ desfecho: 'conta-impedida' });
    await fonte.autenticar('adm.erra', 'Errada#1', 'cli_ativo');
    expect(contagem()).toBe('0:1');
    expect(await fonte.conferir(erra, senha)).toBe(false);
    // Bloqueio vencido: a senha certa entra e limpa o bloqueio.
    relogio = new Date(relogio.getTime() + 601_000);
    expect((await fonte.autenticar('adm.erra', senha, 'cli_ativo')).desfecho).toBe('ok');
    expect(contagem()).toBe('0:0');
    relogio = new Date();
  });

  it('colação: só login ASCII minúsculo entra no banco (invisíveis e maiúsculas recusados pelo CHECK)', () => {
    // A colação iguala 'adm.ok' a variantes com caractere invisível: é isso que o CHECK e o contrato impedem.
    expect(
      valor(
        "SELECT COUNT(*) FROM credencial_administrador_plataforma WHERE login = CONCAT('adm', CONVERT(UNHEX('C2AD') USING utf8mb4), '.ok')",
      ),
    ).toBe('1');
    for (const login of [
      'ADM.NOVO',
      "CONCAT('adm', CONVERT(UNHEX('E2808B') USING utf8mb4), '.novo')",
      'adm novo',
      'ádm.novo',
    ]) {
      const expr = login.startsWith('CONCAT') ? login : `'${login}'`;
      expect(() =>
        sql(
          BANCO,
          `UPDATE credencial_administrador_plataforma SET login = ${expr} WHERE administrador_plataforma_id = ${id['adm.inativo'] ?? -1};`,
        ),
      ).toThrow(/4025|ck_credencial_adm_plataforma_login/);
    }
  });

  it('troca de senha: grava o resumo, zera a troca obrigatória e registra o evento do cliente na mesma transação', async () => {
    const ok = id['adm.ok'] ?? -1;
    const nova = await cifrarSenha(`N${randomUUID()}7`, RAPIDO);
    const em = await fonte.gravarSenha(ok, nova, 'correlacao-int', 'cli_ativo');
    expect((await fonte.situacao(ok))?.senhaAlteradaEm).toBe(em);
    expect(
      valor(
        `SELECT troca_obrigatoria FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = ${ok}`,
      ),
    ).toBe('0');
    expect(
      valor(
        `SELECT COUNT(*) FROM cliente_evento e JOIN cliente c ON c.id = e.cliente_id
          WHERE c.codigo = 'cli_ativo' AND e.tipo = 'senha_administrador_trocada' AND e.administrador_plataforma_id = ${ok}`,
      ),
    ).toBe('1');
    // Cliente inexistente: nada gravado (a transação inteira volta).
    const antes = valor(
      `SELECT versao FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = ${ok}`,
    );
    await expect(fonte.gravarSenha(ok, nova, 'correlacao-int', 'cli_nenhum')).rejects.toThrow();
    expect(
      valor(
        `SELECT versao FROM credencial_administrador_plataforma WHERE administrador_plataforma_id = ${ok}`,
      ),
    ).toBe(antes);
  });
});
