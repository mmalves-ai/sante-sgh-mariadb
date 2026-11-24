// Família acesso-ligacao (modulos-proprios-3) contra o MariaDB real e a captura local de e-mail (Mailpit): a entrada
// por e-mail LIGADA (fontes tardias, ServicoSessao com o segundo fator por e-mail), de ponta a ponta:
//   - administrador da plataforma (banco plataforma de VALIDAÇÃO plataforma_validacao_acesso_ligacao, recriado a cada
//     execução e apagado no fim; nunca o banco plataforma de uso): "Esqueci a senha" → e-mail capturado no Mailpit →
//     link de uso único → senha provisória → escolha do código por e-mail → entrada pede o código → código lido do
//     Mailpit → entrada → troca obrigatória da senha → a senha nova entra (com outro código);
//   - usuário do cliente (cliente de teste f22_o5): escolha do código por e-mail → entrada pede o código → código do
//     Mailpit → entrada; código errado recusado.
// Contas FICTÍCIAS (e-mail .invalid com sufixo aleatório por execução, para achar só as mensagens desta execução).
// Precisa do sgh-mailpit (SMTP 127.0.0.1:1325, API 127.0.0.1:8325). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run -c apps/api/vitest.integracao.config.ts src/sessao/acesso-email-ligacao.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../autorizacao/trilha.js';
import { portaSenhaDoNucleo } from '../modulos/acesso/senha/porta-senha.js';
import {
  FontesAcessoTardias,
  montarLigacaoAcessoEmail,
  SegundoFatorEmailTardio,
  type LigacaoAcessoEmail,
} from './acesso-email-tardio.js';
import { ArmazemMemoria } from './armazem.js';
import { emailAcessoDoAmbiente } from './email-acesso.js';
import { FonteAcessoPropria } from './fonte-propria.js';
import { FontePlataformaPropria, nucleoPlataforma } from './fonte-plataforma.js';
import { ErroSessao, ServicoSessao } from './servico-sessao.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const CLIENTE = process.env['SGH_CLIENTE_TESTE_ACESSO_EMAIL']?.trim() || 'f22_o5';
const BANCO = `cliente_${CLIENTE}`;
const PLAT = 'plataforma_validacao_acesso_ligacao';
const REDE = 'rede-teste';
const HOSPITAL = 'alg01';
const LOGIN = 'alg.ana';
const MAILPIT = 'http://127.0.0.1:8325';
const SUFIXO = randomUUID().slice(0, 8);
const EMAIL_ADM = `adm.alg.${SUFIXO}@exemplo.invalid`;
const EMAIL_USU = `alg.ana.${SUFIXO}@exemplo.invalid`;
const RAPIDO = { memoria: 8_192, passes: 1, paralelismo: 1 };
const ORIGEM = { estacao: 'teste-acesso-ligacao', correlacao: 'alg-int' };

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Os textos das mensagens capturadas para o endereço (mais nova primeiro), esperando chegar `minimo`. */
async function caixa(para: string, minimo: number): Promise<string[]> {
  for (let i = 0; i < 50; i++) {
    const r = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`)
    ).json()) as { messages: { ID: string }[] };
    if (r.messages.length >= minimo) {
      const textos: string[] = [];
      for (const m of r.messages)
        textos.push(
          ((await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string }).Text,
        );
      return textos;
    }
    await new Promise((p) => setTimeout(p, 200));
  }
  throw new Error(`a captura não recebeu ${minimo} mensagem(ns)`);
}

const tokenDe = (texto: string) => /token=([A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? '';
const codigoDe = (texto: string) => /\b(\d{6})\b/.exec(texto)?.[1] ?? '';

async function recusa(p: Promise<unknown>): Promise<ErroSessao> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroSessao);
  return e as ErroSessao;
}

describe.skipIf(SEM_BANCO)('entrada por e-mail ligada (banco próprio e captura local)', () => {
  let nucleo: NucleoProprio;
  let nucleoPlat: NucleoProprio;
  let sessao: ServicoSessao;
  let lig: LigacaoAcessoEmail;
  const senhaUsu = `U${randomUUID()}7a`;

  beforeAll(async () => {
    const info = await fetch(`${MAILPIT}/api/v1/info`);
    expect(info.ok).toBe(true);
    for (const arq of ['96_segundo_fator_email_tabelas.sql', '96_segundo_fator_email_chaves.sql'])
      sql(BANCO, readFileSync(resolve(RAIZ, 'db/migracoes/02_ADM', arq), 'utf8'));
    const resumo = await cifrarSenha(senhaUsu, RAPIDO);
    sql(
      BANCO,
      `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em)
         SELECT '${HOSPITAL}', 'Hospital fictício alg', 'Hospital fictício alg (teste)', NOW(3)
          WHERE NOT EXISTS (SELECT 1 FROM estabelecimento WHERE codigo = '${HOSPITAL}');
       INSERT INTO usuario (login, nome, dispensa_cpf, email, criado_em)
         SELECT '${LOGIN}', 'Conta fictícia alg', TRUE, '${EMAIL_USU}', NOW(3)
          WHERE NOT EXISTS (SELECT 1 FROM usuario u WHERE u.login = '${LOGIN}');
       UPDATE usuario SET email = '${EMAIL_USU}' WHERE login = '${LOGIN}';
       INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em)
         SELECT u.id, e.id, '2026-01-01', NOW(3) FROM usuario u JOIN estabelecimento e ON e.codigo = '${HOSPITAL}'
          WHERE u.login = '${LOGIN}'
            AND NOT EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = e.id);
       INSERT INTO credencial_usuario (usuario_id, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
         SELECT u.id, '${resumo}', NOW(3), FALSE, NOW(3) FROM usuario u
          WHERE u.login = '${LOGIN}' AND NOT EXISTS (SELECT 1 FROM credencial_usuario c WHERE c.usuario_id = u.id);
       UPDATE credencial_usuario c JOIN usuario u ON u.id = c.usuario_id
          SET c.resumo_senha = '${resumo}', c.troca_obrigatoria = FALSE, c.senha_alterada_em = NOW(3)
        WHERE u.login = '${LOGIN}';
       DELETE p FROM preferencia_segundo_fator p JOIN usuario u ON u.id = p.usuario_id WHERE u.login = '${LOGIN}';`,
    );

    sql(
      null,
      `DROP DATABASE IF EXISTS ${PLAT}; CREATE DATABASE ${PLAT} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`,
    );
    for (const arq of [
      '0001_plataforma.sql',
      '0002_credencial_administrador.sql',
      '0092_recuperacao_segundo_fator.sql',
    ])
      sql(PLAT, readFileSync(resolve(RAIZ, 'db/plataforma', arq), 'utf8'));
    const resumoAdm = await cifrarSenha(`P${randomUUID()}8`, RAPIDO);
    sql(
      PLAT,
      `INSERT INTO cliente (codigo, nome, situacao, banco_nome, criado_em) VALUES
         ('${CLIENTE}', 'Cliente fictício', 'implantacao', '${BANCO}', NOW(3));
       INSERT INTO administrador_plataforma (nome, email, ativo, criado_em) VALUES
         ('Administrador fictício alg', '${EMAIL_ADM}', TRUE, NOW(3));
       INSERT INTO credencial_administrador_plataforma
           (administrador_plataforma_id, login, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
         SELECT id, 'adm.alg', '${resumoAdm}', NOW(3), FALSE, NOW(3) FROM administrador_plataforma;`,
    );

    nucleo = new NucleoProprio();
    nucleoPlat = new NucleoProprio({ env: { ...ambienteEfetivo().env, SGH_BANCO_PLATAFORMA: PLAT } });
    const np = nucleoPlataforma(nucleoPlat);
    if (!np) throw new Error('núcleo sem o banco plataforma');
    const fonte = new FonteAcessoPropria(nucleo, CLIENTE, REDE, () => undefined);
    await fonte.carregar();
    const armazem = new ArmazemMemoria();
    const email = emailAcessoDoAmbiente({ SMTP_URL: 'smtp://127.0.0.1:1325', AMBIENTE: 'dev' });
    const fontes = new FontesAcessoTardias();
    fontes.ligarEstabelecimento((h) => fonte.idEstabelecimento(h));
    const segundoFator = new SegundoFatorEmailTardio();
    const executor = nucleo.criarExecutor();
    sessao = new ServicoSessao(fonte, armazem, () => Date.now(), {
      senha: portaSenhaDoNucleo(nucleo, () => executor, CLIENTE),
      plataforma: new FontePlataformaPropria(np, () => new Date()),
      cliente: CLIENTE,
      ...segundoFator.paraSessao(),
    });
    lig = montarLigacaoAcessoEmail(
      {
        nucleo,
        cliente: CLIENTE,
        sessao,
        armazem,
        email,
        trilha: new RegistradorTrilhaMemoria(),
        urlPublica: 'http://127.0.0.1:5173',
        plataforma: np,
      },
      fontes,
      segundoFator,
      { recuperacao: Symbol('r'), trocaRapida: Symbol('t') },
      new Set(['certificado', 'recuperacao', 'trocaRapida']),
    );
    expect([...lig.naoMigrados]).toEqual(['certificado']);
    expect(segundoFator.ligado).toBe(true);
  }, 180_000);

  afterAll(async () => {
    sql(
      BANCO,
      `DELETE p FROM preferencia_segundo_fator p JOIN usuario u ON u.id = p.usuario_id WHERE u.login = '${LOGIN}';`,
    );
    sql(null, `DROP DATABASE IF EXISTS ${PLAT};`);
    await nucleo?.encerrar();
    await nucleoPlat?.encerrar();
  });

  it('plataforma: pedido, e-mail capturado, link, senha provisória, código no e-mail e troca', async () => {
    const p = lig.servicos.recuperacaoPlataforma!;
    await p.pedir(EMAIL_ADM, '127.0.0.1', 'alg-int');
    await p.aguardarEnvios();
    const [link] = await caixa(EMAIL_ADM, 1);
    const token = tokenDe(link ?? '');
    expect(token).toHaveLength(43);
    const usado = await p.usar(token, '127.0.0.1', 'alg-int');
    expect(usado.trocaObrigatoria).toBe(true);
    await expect(p.usar(token, '127.0.0.1', 'alg-int')).rejects.toMatchObject({ codigo: 'token-invalido' });
    const id = Number(
      sql(PLAT, `SELECT id FROM administrador_plataforma WHERE email = '${EMAIL_ADM}'`).trim(),
    );
    await p.escolherMetodoSegundoFator(id, 'email', '127.0.0.1', 'alg-int');

    const ent = { estabelecimento: HOSPITAL, login: 'adm.alg', senha: usado.senhaProvisoria };
    const pede = await recusa(sessao.entrarPlataforma(ent, REDE, null, ORIGEM));
    expect(pede.codigo).toBe('segundo-fator-email');
    const [cod] = await caixa(EMAIL_ADM, 2);
    const codigo = codigoDe(cod ?? '');
    expect(codigo).toMatch(/^\d{6}$/);
    const r = await sessao.entrarPlataforma({ ...ent, codigoSegundoFator: codigo }, REDE, null, ORIGEM);
    expect(r.sessao.trocaSenha).toBe('senha-provisoria');
    // Código de uso único: o mesmo não serve de novo.
    expect(
      (await recusa(sessao.entrarPlataforma({ ...ent, codigoSegundoFator: codigo }, REDE))).codigo,
    ).toMatch(/^segundo-fator-(invalido|email-esgotado)$/);

    const nova = `Nova#${randomUUID().slice(0, 12)}Ab9`;
    const depois = await sessao.trocarSenha(
      r.idSessao,
      REDE,
      { senhaAtual: usado.senhaProvisoria, senhaNova: nova },
      ORIGEM,
    );
    expect(depois.trocaSenha).toBeNull();
    const ent2 = { ...ent, senha: nova };
    expect((await recusa(sessao.entrarPlataforma(ent2, REDE))).codigo).toBe('segundo-fator-email');
    const [cod2] = await caixa(EMAIL_ADM, 3);
    const r2 = await sessao.entrarPlataforma({ ...ent2, codigoSegundoFator: codigoDe(cod2 ?? '') }, REDE);
    expect(r2.sessao.trocaSenha).toBeNull();
  }, 180_000);

  it('usuário do cliente: escolhe o código por e-mail, a entrada pede o código e entra com ele', async () => {
    await lig.servicos.preferencia.escolher(
      { rede: REDE, hospital: HOSPITAL, login: LOGIN, estacao: 'teste', correlacao: 'alg-int' },
      'email',
    );
    const ent = { estabelecimento: HOSPITAL, login: LOGIN, senha: senhaUsu };
    expect((await recusa(sessao.entrar(ent, REDE, null, ORIGEM))).codigo).toBe('segundo-fator-email');
    const [cod] = await caixa(EMAIL_USU, 1);
    const codigo = codigoDe(cod ?? '');
    const errado = codigo === '000000' ? '111111' : '000000';
    expect((await recusa(sessao.entrar({ ...ent, codigoSegundoFator: errado }, REDE))).codigo).toBe(
      'segundo-fator-invalido',
    );
    const r = await sessao.entrar({ ...ent, codigoSegundoFator: codigo }, REDE, null, ORIGEM);
    expect(r.sessao.usuario.login).toBe(LOGIN);
  }, 180_000);
});
