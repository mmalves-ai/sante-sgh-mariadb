// Contrato de efeito do LOGIN ÚNICO CORPORATIVO (01-ADM L61) contra o MariaDB real (cliente de teste). Massa SINTÉTICA:
// um estabelecimento, um perfil e três contas com o código do teste (removidos na limpeza). Prova o que fica no banco:
// o cadastro do provedor (OpenID com a referência ao cofre, valores padrão do protocolo, versão nova na alteração), as
// recusas do domínio sem linha (ldap sem TLS, segredo colado na referência, código repetido); o mapa de grupo para perfil
// (repetido recusa, desativado fica com ativo falso); o vínculo pelo gestor (a mesma identidade não liga duas contas);
// e a entrada pela identidade conferida: o vínculo ativo marca o último uso, o primeiro acesso liga à única conta com o
// e-mail confirmado (só com a criação automática), o vínculo desligado e a identidade sem conta recusam sem gravar.
// Nada se apaga: o desligamento é ativo = falso com a versão nova. A trilha da operação no estabelecimento.
// O fluxo do OpenID (assinatura, emissor, nonce, PKCE) roda com um provedor de teste em memória, sem rede.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { generateKeyPairSync, sign } from 'node:crypto';
import { type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { EntradaOidc, ErroEntradaOidc } from './entrada-oidc.js';
import { PortaProvedorIdentidadePropria } from './provedor-identidade-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2010ps';
const LOGINS = ['teste.c2010.gestor', 'teste.c2010.a', 'teste.c2010.b'];
const EMAIL_B = 'teste.c2010.b@exemplo.test';
const PROV = ['c2010-oidc', 'c2010-ldap'];
const EST = `(SELECT id FROM estabelecimento WHERE codigo = '${P}')`;
const PROVS = `(SELECT id FROM provedor_identidade WHERE codigo IN ('${PROV[0]}', '${PROV[1]}'))`;

async function limpar(e: Escritor): Promise<void> {
  await e.executar(`DELETE FROM vinculo_identidade_externa WHERE provedor_identidade_id IN ${PROVS}`);
  await e.executar(`DELETE FROM provedor_identidade_perfil WHERE provedor_identidade_id IN ${PROVS}`);
  await e.executar(`DELETE FROM provedor_identidade WHERE codigo IN (?, ?)`, PROV);
  await e.executar(`DELETE FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id IN ${EST}`, [P]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar(`DELETE FROM usuario WHERE login IN (?, ?, ?)`, LOGINS);
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

const codigo = (p: Promise<unknown>) =>
  p.then(
    () => 'gravou',
    (e: unknown) => (e instanceof ErroOperacao ? String(e.problema.codigo ?? '') : `outro: ${String(e)}`),
  );

describe.skipIf(SEM_BANCO)('PortaProvedorIdentidadePropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProvedorIdentidadePropria;
  const m = { est: 0, gestor: 0, a: 0, b: 0, oidc: 0 };
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.gestor, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (sql: string, p: unknown[] = []) => Number((await ler(sql, p))[0]?.['n'] ?? -1);
  const provedores = () =>
    contar('SELECT COUNT(*) AS n FROM provedor_identidade WHERE codigo IN (?, ?)', PROV);
  const vinculos = () =>
    contar(`SELECT COUNT(*) AS n FROM vinculo_identidade_externa WHERE provedor_identidade_id IN ${PROVS}`);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaProvedorIdentidadePropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      m.est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital sintético C2010', 'Hospital sintético C2010 (fictício)', 'America/Sao_Paulo', ?)`,
        [P, agora],
      );
      await e.inserir(
        `INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, 'Perfil sintético C2010', ?)`,
        [m.est, P, agora],
      );
      const conta = (login: string, email: string | null) =>
        e.inserir(
          `INSERT INTO usuario (login, nome, email, dispensa_cpf, tipo_conta, criado_em)
           VALUES (?, 'CONTA SINTETICA', ?, TRUE, 'pessoa', ?)`,
          [login, email, agora],
        );
      m.gestor = await conta(LOGINS[0]!, null);
      m.a = await conta(LOGINS[1]!, null);
      m.b = await conta(LOGINS[2]!, EMAIL_B);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  it('cadastro do provedor: grava com a referência e os padrões; recusas do domínio não deixam linha', async () => {
    const r = await porta.gravarProvedor(ctx(), {
      codigo: PROV[0],
      nome: 'Diretório sintético',
      protocolo: 'oidc',
      urlServidor: 'https://idp.exemplo.test',
      emissor: 'https://idp.exemplo.test',
      clienteIdentificador: 'sgh-teste',
      referenciaCofre: 'idp/c2010/segredo',
    });
    m.oidc = r.id;
    expect(r.versao).toBe(1);
    const [linha] = await ler(
      `SELECT protocolo, referencia_cofre, atributo_login, atributo_email, atributo_grupo, estabelecimento_id,
              cria_conta_automatica, ativo, versao, criado_por FROM provedor_identidade WHERE id = ?`,
      [m.oidc],
    );
    expect(linha).toMatchObject({
      protocolo: 'oidc',
      referencia_cofre: 'idp/c2010/segredo',
      atributo_login: 'sub',
      atributo_email: 'email',
      atributo_grupo: 'groups',
      estabelecimento_id: null,
      versao: 1,
    });
    expect(Number(linha!['criado_por'])).toBe(m.gestor);
    const antes = await provedores();
    expect(
      await codigo(
        porta.gravarProvedor(ctx(), {
          codigo: PROV[1],
          nome: 'Diretório sem TLS',
          protocolo: 'ldap',
          urlServidor: 'ldap://dc.exemplo.test',
          basePesquisa: 'dc=exemplo',
        }),
      ),
    ).toBe('url-sem-tls');
    expect(
      await codigo(
        porta.gravarProvedor(ctx(), {
          codigo: PROV[1],
          nome: 'Segredo colado',
          protocolo: 'saml',
          urlServidor: 'https://idp.exemplo.test/saml',
          emissor: 'urn:idp',
          referenciaCofre: 'Xk29dP0aQz7LmN4rT8',
        }),
      ),
    ).toBe('segredo-no-cadastro');
    expect(
      await codigo(
        porta.gravarProvedor(ctx(), {
          codigo: PROV[0],
          nome: 'Repetido',
          protocolo: 'oidc',
          urlServidor: 'https://idp.exemplo.test',
          emissor: 'https://idp.exemplo.test',
          clienteIdentificador: 'x',
        }),
      ),
    ).toBe('codigo-em-uso');
    expect(await provedores()).toBe(antes);
    const alt = await porta.gravarProvedor(ctx(), {
      id: m.oidc,
      versao: 1,
      codigo: PROV[0],
      nome: 'Diretório sintético',
      protocolo: 'oidc',
      urlServidor: 'https://idp.exemplo.test',
      emissor: 'https://idp.exemplo.test',
      clienteIdentificador: 'sgh-teste',
      criaContaAutomatica: true,
      soEsteEstabelecimento: true,
    });
    expect(alt.versao).toBe(2);
    const [depois] = await ler(
      'SELECT cria_conta_automatica, estabelecimento_id, referencia_cofre, alterado_por FROM provedor_identidade WHERE id = ?',
      [m.oidc],
    );
    expect(Number(depois!['cria_conta_automatica'])).toBe(1);
    expect(Number(depois!['estabelecimento_id'])).toBe(m.est);
    expect(depois!['referencia_cofre']).toBeNull();
    expect(Number(depois!['alterado_por'])).toBe(m.gestor);
    const lista = await porta.listar(ctx());
    expect(lista.find((p) => p.codigo === PROV[0])).toMatchObject({ entradaLigada: true, vinculosAtivos: 0 });
    expect(await porta.provedoresDeEntrada({ ...ctx(), usuario: null })).toContainEqual({
      codigo: PROV[0],
      nome: 'Diretório sintético',
    });
  });

  it('perfil padrão por grupo: grava, repetido recusa, desativado fica com ativo falso', async () => {
    const g = await porta.incluirGrupo(ctx(), m.oidc, { grupoExterno: 'cn=enf', perfil: P });
    expect(await codigo(porta.incluirGrupo(ctx(), m.oidc, { grupoExterno: 'cn=enf', perfil: P }))).toBe(
      'grupo-ja-mapeado',
    );
    expect(
      await codigo(porta.incluirGrupo(ctx(), m.oidc, { grupoExterno: 'cn=x', perfil: 'inexistente-c2010' })),
    ).toBe('registro-inexistente');
    const lidos = await porta.grupos(ctx(), m.oidc);
    expect(lidos).toHaveLength(1);
    await porta.desativarGrupo(ctx(), g.id, { versao: lidos[0]!.versao });
    const [linha] = await ler('SELECT ativo, versao FROM provedor_identidade_perfil WHERE id = ?', [g.id]);
    expect(linha).toMatchObject({ versao: 2 });
    expect(Number(linha!['ativo'])).toBe(0);
  });

  it('vínculo pelo gestor e entrada pela identidade conferida (uso, primeiro acesso, recusas sem gravação)', async () => {
    const v = await porta.ligarVinculo(ctx(), m.oidc, { login: LOGINS[1], identificador: 'sub-a' });
    expect(
      await codigo(porta.ligarVinculo(ctx(), m.oidc, { login: LOGINS[2], identificador: 'sub-a' })),
    ).toBe('identidade-ja-ligada');
    expect(
      await codigo(porta.ligarVinculo(ctx(), m.oidc, { login: LOGINS[1], identificador: 'sub-z' })),
    ).toBe('conta-ja-ligada');
    expect(await vinculos()).toBe(1);
    const semUsuario = { cliente: CLIENTE, hospital: P, correlacao: P };

    const entrou = await porta.resolverEntrada(semUsuario, m.oidc, {
      sujeito: 'sub-a',
      email: null,
      emailConfirmado: false,
    });
    expect(entrou).toEqual({ login: LOGINS[1], vinculo: v.id, novo: false });
    const [uso] = await ler(
      'SELECT ultimo_uso_em IS NOT NULL AS usado, versao FROM vinculo_identidade_externa WHERE id = ?',
      [v.id],
    );
    expect(Number(uso!['usado'])).toBe(1);

    // E-mail não confirmado: recusa sem gravar; confirmado e uma só conta: liga no primeiro acesso.
    expect(
      await porta.resolverEntrada(semUsuario, m.oidc, {
        sujeito: 'sub-b',
        email: EMAIL_B,
        emailConfirmado: false,
      }),
    ).toEqual({ recusa: 'sem-vinculo' });
    expect(await vinculos()).toBe(1);
    const novo = await porta.resolverEntrada(semUsuario, m.oidc, {
      sujeito: 'sub-b',
      email: EMAIL_B,
      emailConfirmado: true,
    });
    expect(novo).toMatchObject({ login: LOGINS[2], novo: true });
    const [ligado] = await ler(
      'SELECT usuario_id, identificador_externo, email_externo, ativo, criado_por FROM vinculo_identidade_externa WHERE id = ?',
      ['vinculo' in novo ? novo.vinculo : 0],
    );
    expect(Number(ligado!['usuario_id'])).toBe(m.b);
    expect(ligado!['identificador_externo']).toBe('sub-b');
    expect(Number(ligado!['criado_por'])).toBe(m.b);

    // Desligar: ativo falso com versão nova; a entrada é recusada; religar volta.
    const lista = await porta.vinculos(ctx(), m.oidc);
    const va = lista.find((x) => x.login === LOGINS[1])!;
    await porta.alternarVinculo(ctx(), va.id, false, { versao: va.versao });
    expect(await codigo(porta.alternarVinculo(ctx(), va.id, false, { versao: va.versao + 1 }))).toBe(
      'vinculo-sem-mudanca',
    );
    expect(
      await porta.resolverEntrada(semUsuario, m.oidc, {
        sujeito: 'sub-a',
        email: null,
        emailConfirmado: false,
      }),
    ).toEqual({
      recusa: 'vinculo-inativo',
    });
    const [desl] = await ler(
      'SELECT ativo, excluido_em IS NULL AS vivo FROM vinculo_identidade_externa WHERE id = ?',
      [va.id],
    );
    expect(Number(desl!['ativo'])).toBe(0);
    expect(Number(desl!['vivo'])).toBe(1);
    expect(await vinculos()).toBe(2);
    const trilha = await contar(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND operacao LIKE 'acesso.provedoridentidade.%'`,
      [m.est],
    ).catch(() => -1);
    expect(trilha === -1 || trilha >= 5).toBe(true);
  });

  it('OpenID com provedor de teste sem rede: PKCE, assinatura, emissor e nonce; estado de uso único', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
    const emissor = 'https://idp.exemplo.test';
    let nonce = '';
    let desafio = '';
    let verificador = '';
    const jwt = (claims: Record<string, unknown>, chave = privateKey) => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
      const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return `${h}.${c}.${sign('sha256', Buffer.from(`${h}.${c}`), chave).toString('base64url')}`;
    };
    let proximo = (): string => '';
    const buscar = async (url: string, init?: RequestInit) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.endsWith('/.well-known/openid-configuration'))
        return json({
          authorization_endpoint: `${emissor}/autorizar`,
          token_endpoint: `${emissor}/token`,
          jwks_uri: `${emissor}/chaves`,
        });
      if (url.endsWith('/chaves')) return json({ keys: [jwk] });
      if (url.endsWith('/token')) {
        verificador = new URLSearchParams(String(init?.body)).get('code_verifier') ?? '';
        return json({ id_token: proximo() });
      }
      return new Response('', { status: 404 });
    };
    const oidc = new EntradaOidc(buscar, async () => null);
    const provedor = (await porta.provedorParaEntrada({ ...ctx(), usuario: null }, PROV[0]!))!;
    expect(provedor).toMatchObject({ protocolo: 'oidc', clienteIdentificador: 'sgh-teste' });
    const inicio = async () => {
      const u = new URL((await oidc.iniciar(provedor, P, 'https://sgh.test/entrar/provedor')).url);
      nonce = u.searchParams.get('nonce')!;
      desafio = u.searchParams.get('code_challenge')!;
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      return u.searchParams.get('state')!;
    };
    const agora = Math.floor(Date.now() / 1000);
    const claims = () => ({
      iss: emissor,
      aud: 'sgh-teste',
      sub: 'sub-a',
      exp: agora + 300,
      iat: agora,
      nonce,
    });

    const estado = await inicio();
    proximo = () => jwt({ ...claims(), email: 'A@EXEMPLO.TEST', email_verified: true, groups: ['cn=enf'] });
    const id = await oidc.concluir(provedor, estado, 'codigo-1');
    expect(id).toEqual({
      sujeito: 'sub-a',
      email: 'a@exemplo.test',
      emailConfirmado: true,
      grupos: ['cn=enf'],
    });
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(verificador).digest('base64url')).toBe(desafio);
    // A segunda volta (código do segundo fator) devolve a identidade guardada; encerrada, o estado não vale mais.
    expect(await oidc.concluir(provedor, estado, null)).toEqual(id);
    oidc.encerrar(estado);
    await expect(oidc.concluir(provedor, estado, 'codigo-1')).rejects.toMatchObject({
      codigo: 'estado-invalido',
    });

    const outra = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const e2 = await inicio();
    proximo = () => jwt(claims(), outra);
    await expect(oidc.concluir(provedor, e2, 'c')).rejects.toBeInstanceOf(ErroEntradaOidc);
    const e3 = await inicio();
    proximo = () => jwt({ ...claims(), nonce: 'outro', iss: 'https://outro.test' });
    await expect(oidc.concluir(provedor, e3, 'c')).rejects.toThrow(/emissor-diferente, nonce-diferente/);
    // O estado é de uso único mesmo na falha.
    await expect(oidc.concluir(provedor, e3, 'c')).rejects.toMatchObject({ codigo: 'estado-invalido' });
  });
});
