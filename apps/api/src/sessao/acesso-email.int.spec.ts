// Família acesso-email (modulos-proprios-2) contra o MariaDB real: o fluxo completo pedido → e-mail → troca.
//   - usuário do cliente (cliente de teste f22_o5, 02_ADM/96 aplicada aqui): "Esqueci a senha" pelo
//     ServicoRecuperacaoSenha com o envio próprio (e-mail lido de `usuario`), token de uso único, senha provisória
//     gravada pela porta de senha do Executor com troca obrigatória; escolha do segundo fator (Executor e trilha) e o
//     código no e-mail;
//   - administrador da plataforma: banco plataforma de VALIDAÇÃO (plataforma_validacao_acesso_email, recriado a cada
//     execução com 0001, 0002 e 0092; nunca o banco plataforma de uso): pedido, token, senha provisória com troca
//     obrigatória conferida pela FontePlataformaPropria, e o código no e-mail.
// Contas FICTÍCIAS e fixas (criadas se faltarem; nunca apagadas). E-mail em memória; com SMTP_URL no ambiente, um
// envio vai também à captura local (Mailpit). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run -c apps/api/vitest.integracao.config.ts src/sessao/acesso-email.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cifrarSenha, conferirSenha } from '@sgh/dominio-acesso';
import { NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../autorizacao/trilha.js';
import type { FonteConfiguracao } from '../modulos/config/public-api.js';
import { portaSenhaDoNucleo } from '../modulos/acesso/senha/porta-senha.js';
import { montarAcessoEmailProprio, type ServicosAcessoEmail } from './acesso-email-proprio.js';
import { ArmazemMemoria } from './armazem.js';
import { emailAcessoDoAmbiente, emailAcessoMemoria } from './email-acesso.js';
import { FonteAcessoPropria } from './fonte-propria.js';
import { FontePlataformaPropria, nucleoPlataforma } from './fonte-plataforma.js';
import { ServicoSessao } from './servico-sessao.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const CLIENTE = process.env['SGH_CLIENTE_TESTE_ACESSO_EMAIL']?.trim() || 'f22_o5';
const BANCO = `cliente_${CLIENTE}`;
const PLAT = 'plataforma_validacao_acesso_email';
const REDE = 'rede-teste';
const HOSPITAL = 'aem01';
/** Estabelecimento fictício SEM vínculo com as contas aem (o pedido por ele não manda e-mail). */
const OUTRO = 'aem02';
const LOGIN = 'aem.maria';
const SEM_EMAIL = 'aem.semail';
const RAPIDO = { memoria: 8_192, passes: 1, paralelismo: 1 };
const ORIGEM = { estacao: 'teste-acesso-email', correlacao: 'aem-int' };

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const tokenDe = (texto: string) => /token=([A-Za-z0-9_-]{43})/.exec(texto)?.[1] ?? '';
const codigoDe = (texto: string) => /(\d{6})/.exec(texto)?.[1] ?? '';

/** A configuração com a chave acesso.recuperacaoSenha ligada no estabelecimento inteiro e o pré-requisito cumprido. */
const configuracao = {
  chaves: () =>
    Promise.resolve([{ chave: 'acesso.recuperacaoSenha', tipo: 'recurso', ligada: true, escopo: 'hospital', valor: '*' }]),
  prerequisitos: () =>
    Promise.resolve([{ recurso: 'acesso.recuperacaoSenha', tipo: 'aprovacao', situacao: 'cumprido', validade: null }]),
  valoresParametro: () => Promise.resolve([]),
} as unknown as FonteConfiguracao & { valoresParametro: () => Promise<[]> };

describe.skipIf(SEM_BANCO)('acesso por e-mail no banco próprio (cliente de teste e plataforma de validação)', () => {
  let nucleo: NucleoProprio;
  let nucleoPlat: NucleoProprio;
  let s: ServicosAcessoEmail;
  const email = emailAcessoMemoria();
  const senhaAdm = `P${randomUUID()}8`;
  let idEst = 0;

  beforeAll(async () => {
    for (const arq of ['96_segundo_fator_email_tabelas.sql', '96_segundo_fator_email_chaves.sql'])
      sql(BANCO, readFileSync(resolve(RAIZ, 'db/migracoes/02_ADM', arq), 'utf8'));
    const resumo = await cifrarSenha(`U${randomUUID()}7`, RAPIDO);
    sql(
      BANCO,
      `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em)
         SELECT x.c, 'Hospital fictício aem', 'Hospital fictício aem (teste)', NOW(3)
           FROM (SELECT '${HOSPITAL}' AS c UNION ALL SELECT '${OUTRO}') x
          WHERE NOT EXISTS (SELECT 1 FROM estabelecimento WHERE codigo = x.c);
       INSERT INTO usuario (login, nome, dispensa_cpf, email, criado_em)
         SELECT l, 'Conta fictícia aem', TRUE, e, NOW(3)
           FROM (SELECT '${LOGIN}' AS l, 'aem.maria@exemplo.invalid' AS e UNION ALL SELECT '${SEM_EMAIL}', NULL) x
          WHERE NOT EXISTS (SELECT 1 FROM usuario u WHERE u.login = x.l);
       INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em)
         SELECT u.id, e.id, '2026-01-01', NOW(3) FROM usuario u JOIN estabelecimento e ON e.codigo = '${HOSPITAL}'
          WHERE u.login IN ('${LOGIN}', '${SEM_EMAIL}')
            AND NOT EXISTS (SELECT 1 FROM usuario_estabelecimento ue WHERE ue.usuario_id = u.id AND ue.estabelecimento_id = e.id);
       INSERT INTO credencial_usuario (usuario_id, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
         SELECT u.id, '${resumo}', NOW(3), FALSE, NOW(3) FROM usuario u
          WHERE u.login IN ('${LOGIN}', '${SEM_EMAIL}')
            AND NOT EXISTS (SELECT 1 FROM credencial_usuario c WHERE c.usuario_id = u.id);
       UPDATE credencial_usuario c JOIN usuario u ON u.id = c.usuario_id SET c.troca_obrigatoria = FALSE
        WHERE u.login IN ('${LOGIN}', '${SEM_EMAIL}');
       DELETE p FROM preferencia_segundo_fator p JOIN usuario u ON u.id = p.usuario_id
        WHERE u.login IN ('${LOGIN}', '${SEM_EMAIL}');`,
    );
    idEst = Number(sql(BANCO, `SELECT id FROM estabelecimento WHERE codigo = '${HOSPITAL}'`).trim());

    sql(null, `DROP DATABASE IF EXISTS ${PLAT}; CREATE DATABASE ${PLAT} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`);
    for (const arq of ['0001_plataforma.sql', '0002_credencial_administrador.sql', '0092_recuperacao_segundo_fator.sql'])
      sql(PLAT, readFileSync(resolve(RAIZ, 'db/plataforma', arq), 'utf8'));
    const resumoAdm = await cifrarSenha(senhaAdm, RAPIDO);
    sql(
      PLAT,
      `INSERT INTO cliente (codigo, nome, situacao, banco_nome, criado_em) VALUES
         ('cli_ativo', 'Cliente fictício ativo', 'implantacao', 'cliente_cli_ativo', NOW(3));
       INSERT INTO administrador_plataforma (nome, email, ativo, criado_em) VALUES
         ('Administrador fictício', 'adm.ok@exemplo.invalid', TRUE, NOW(3)),
         ('Administrador inativo', 'adm.inativo@exemplo.invalid', FALSE, NOW(3));
       INSERT INTO credencial_administrador_plataforma
           (administrador_plataforma_id, login, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em)
         SELECT id, SUBSTRING_INDEX(email, '@', 1), '${resumoAdm}', NOW(3), FALSE, NOW(3) FROM administrador_plataforma;`,
    );

    nucleo = new NucleoProprio();
    nucleoPlat = new NucleoProprio({ env: { ...ambienteEfetivo().env, SGH_BANCO_PLATAFORMA: PLAT } });
    const fonte = new FonteAcessoPropria(nucleo, CLIENTE, REDE, () => undefined);
    await fonte.carregar();
    const executor = nucleo.criarExecutor();
    const sessao = new ServicoSessao(fonte, new ArmazemMemoria(), () => Date.now(), {
      senha: portaSenhaDoNucleo(nucleo, () => executor, CLIENTE),
    });
    s = montarAcessoEmailProprio({
      nucleo,
      cliente: CLIENTE,
      sessao,
      armazem: new ArmazemMemoria(),
      email,
      configuracao: () => configuracao,
      estabelecimento: (h) => (h === HOSPITAL ? idEst : null),
      trilha: new RegistradorTrilhaMemoria(),
      urlPublica: 'http://127.0.0.1:5173/',
      plataforma: nucleoPlataforma(nucleoPlat),
    });
  }, 120_000);

  afterAll(async () => {
    sql(
      BANCO,
      `DELETE p FROM preferencia_segundo_fator p JOIN usuario u ON u.id = p.usuario_id
        WHERE u.login IN ('${LOGIN}', '${SEM_EMAIL}');`,
    );
    sql(null, `DROP DATABASE IF EXISTS ${PLAT};`);
    await nucleo?.encerrar();
    await nucleoPlat?.encerrar();
  });

  it('usuário: pedido igual para todos, e-mail só para a conta com e-mail, token vira senha provisória uma vez', async () => {
    expect(await s.recuperacao.disponivel(REDE, HOSPITAL)).toEqual({ disponivel: true });
    const antes = email.enviadas.length;
    for (const login of [LOGIN, SEM_EMAIL, 'aem.ninguem'])
      expect(await s.recuperacao.pedir(REDE, { estabelecimento: HOSPITAL, login }, '10.0.0.9', ORIGEM)).toHaveProperty(
        'mensagem',
      );
    // Conta existente, mas sem vínculo com o estabelecimento pedido: a mesma resposta e nenhum e-mail.
    expect(await s.recuperacao.disponivel(REDE, OUTRO)).toEqual({ disponivel: true });
    expect(
      await s.recuperacao.pedir(REDE, { estabelecimento: OUTRO, login: LOGIN }, '10.0.0.9', ORIGEM),
    ).toHaveProperty('mensagem');
    await s.recuperacao.aguardarEnvios();
    const novas = email.enviadas.slice(antes);
    expect(novas.map((m) => m.para)).toEqual(['aem.maria@exemplo.invalid']);
    expect(novas[0]?.texto).toContain(`no estabelecimento ${HOSPITAL}`);
    expect(novas[0]?.texto).toContain('http://127.0.0.1:5173/recuperar-senha?token=');
    const token = tokenDe(novas[0]?.texto ?? '');
    const r = await s.recuperacao.usar(REDE, token, ORIGEM);
    const [resumo, troca] = sql(
      BANCO,
      `SELECT c.resumo_senha, c.troca_obrigatoria FROM credencial_usuario c JOIN usuario u ON u.id = c.usuario_id
        WHERE u.login = '${LOGIN}'`,
    )
      .trim()
      .split('\t');
    expect(troca).toBe('1');
    expect(await conferirSenha(r.senhaProvisoria, resumo ?? null)).toBe(true);
    await expect(s.recuperacao.usar(REDE, token, ORIGEM)).rejects.toMatchObject({ status: 400 });
    // A resposta diz a troca obrigatória que o banco gravou (por último: o efeito no banco já foi conferido acima).
    expect(r.trocaObrigatoria).toBe(true);
  }, 60_000);

  it('usuário: escolhe o código no e-mail (Executor) e confere o código uma vez', async () => {
    const ator = { rede: REDE, hospital: HOSPITAL, login: LOGIN, estacao: null, correlacao: 'aem-escolha' };
    expect(await s.preferencia.metodo(REDE, HOSPITAL, LOGIN)).toBe('aplicativo');
    const codigos = s.codigoUsuario;
    expect(codigos).not.toBe(null);
    if (!codigos) return;
    // Quem usa o aplicativo não recebe nem confere código por e-mail (nada de trocar por um fator mais fraco).
    const antesApp = email.enviadas.length;
    await expect(codigos.emitir(REDE, HOSPITAL, LOGIN)).rejects.toMatchObject({ codigo: 'metodo-nao-escolhido' });
    await expect(codigos.conferir(REDE, HOSPITAL, LOGIN, '123456')).rejects.toMatchObject({
      codigo: 'metodo-nao-escolhido',
    });
    expect(email.enviadas.length).toBe(antesApp);
    expect(await s.preferencia.escolher(ator, 'email')).toEqual({ anterior: 'aplicativo' });
    expect(await s.preferencia.metodo(REDE, HOSPITAL, LOGIN)).toBe('email');
    expect(await s.preferencia.escolher(ator, 'aplicativo')).toEqual({ anterior: 'email' });
    await s.preferencia.escolher(ator, 'email');
    await expect(s.preferencia.escolher({ ...ator, login: SEM_EMAIL }, 'email')).rejects.toMatchObject({
      problema: { codigo: 'sem-email' },
    });
    const antes = email.enviadas.length;
    await codigos.emitir(REDE, HOSPITAL, LOGIN);
    const codigo = codigoDe(email.enviadas[antes]?.texto ?? '');
    expect(email.enviadas[antes]?.para).toBe('aem.maria@exemplo.invalid');
    expect(await codigos.conferir(REDE, HOSPITAL, LOGIN, codigo)).toBe('ok');
    expect(await codigos.conferir(REDE, HOSPITAL, LOGIN, codigo)).toBe('invalido');
    // A conta sem e-mail não consegue escolher o e-mail; continua no aplicativo e não recebe código.
    await expect(codigos.emitir(REDE, HOSPITAL, SEM_EMAIL)).rejects.toMatchObject({ codigo: 'metodo-nao-escolhido' });
  }, 60_000);

  it('administrador da plataforma: esqueci a senha, troca obrigatória e código no e-mail', async () => {
    const rp = s.recuperacaoPlataforma;
    expect(rp).not.toBe(null);
    if (!rp) return;
    const np = nucleoPlataforma(nucleoPlat);
    if (!np) throw new Error('núcleo sem plataforma');
    const fonte = new FontePlataformaPropria(np);
    const antes = email.enviadas.length;
    for (const e of ['ADM.OK@exemplo.invalid', 'adm.inativo@exemplo.invalid', 'ninguem@exemplo.invalid'])
      await rp.pedir(e, '10.0.0.8', 'aem-plat');
    await rp.aguardarEnvios();
    const novas = email.enviadas.slice(antes);
    expect(novas.map((m) => m.para)).toEqual(['adm.ok@exemplo.invalid']);
    const r = await rp.usar(tokenDe(novas[0]?.texto ?? ''), '10.0.0.8', 'aem-plat');
    expect(r.login).toBe('adm.ok');
    expect(await fonte.autenticar('adm.ok', senhaAdm, 'cli_ativo')).toEqual({ desfecho: 'credencial-invalida' });
    const ok = await fonte.autenticar('adm.ok', r.senhaProvisoria, 'cli_ativo');
    expect(ok).toMatchObject({ desfecho: 'ok', ator: { trocaObrigatoria: true } });
    const id = ok.desfecho === 'ok' ? ok.ator.idAdministrador : 0;

    await rp.escolherMetodoSegundoFator(id, 'email', '10.0.0.8', 'aem-plat');
    expect(await rp.metodoSegundoFator(id)).toBe('email');
    const n = email.enviadas.length;
    await rp.emitirCodigo(id, '10.0.0.8', 'aem-plat');
    const codigo = codigoDe(email.enviadas[n]?.texto ?? '');
    expect(await rp.conferirCodigo(id, codigo, '10.0.0.8', 'aem-plat')).toBe('ok');
    expect(await rp.conferirCodigo(id, codigo, '10.0.0.8', 'aem-plat')).toBe('invalido');
    expect(
      sql(PLAT, 'SELECT GROUP_CONCAT(tipo ORDER BY id) FROM credencial_administrador_evento').trim().split(','),
    ).toEqual([
      'recuperacao_pedida',
      'senha_recuperada',
      'segundo_fator_metodo_alterado',
      'codigo_email_enviado',
      'codigo_email_conferido',
      'codigo_email_recusado',
    ]);
    expect(sql(PLAT, 'SELECT COUNT(*) FROM credencial_administrador_evento WHERE origem_resumo IS NULL').trim()).toBe('0');
  }, 60_000);

  it('com SMTP_URL no ambiente, a mensagem chega à captura local', async () => {
    const smtp = emailAcessoDoAmbiente(process.env);
    if (!smtp) return;
    await expect(
      smtp.enviar({ para: 'aem.teste@exemplo.invalid', assunto: 'Teste da captura local', texto: 'Sem dado real.' }),
    ).resolves.toBeUndefined();
  }, 30_000);
});
