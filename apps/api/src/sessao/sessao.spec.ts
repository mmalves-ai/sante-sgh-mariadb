// Sessão no servidor (ficha do M05, regras 6, 8 e 9): login sintético, cookie, inatividade gravada no
// servidor, duração máxima, rede presa ao endereço (ARQ-2), CSRF guardado, rotação do identificador e
// cache da política. Sem banco (fonte sintética) e sem dado pessoal.
import { describe, expect, it, vi } from 'vitest';
import { cookieCsrf, cookieSessao, cookiesApagados, lerCookie, lerCookieSessao } from './cookies.js';
import { ResolvedorRedeConfigurado, nomeDoHost } from './rede.js';
import { ErroSessao } from './servico-sessao.js';
import { REDE, SENHA, entrada, envTeste, montar } from './teste.spec-util.js';
import { FonteAcessoSintetica } from '../modulos/acesso/fonte-sintetica.js';

describe('cookies da sessão (regra 8)', () => {
  it('sempre HttpOnly, Secure e SameSite=Strict; __Host- fora de dev/ci', () => {
    const c = cookieSessao('abc', { maxIdadeSegundos: 60, prefixoHost: true });
    expect(c).toContain('__Host-sgh_sessao=abc');
    for (const parte of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(c).toContain(parte);
    const dev = cookieSessao('abc', { maxIdadeSegundos: 60, prefixoHost: false });
    expect(dev).toMatch(/^sgh_sessao=abc/);
    expect(dev).toContain('Secure');
    expect(cookieCsrf('t', { maxIdadeSegundos: 60, prefixoHost: false })).toContain('Secure');
    expect(cookieCsrf('t', { maxIdadeSegundos: 60, prefixoHost: false })).not.toContain('HttpOnly');
  });
  it('lê e apaga', () => {
    expect(lerCookie('a=1; __Host-sgh_sessao=xyz', '__Host-sgh_sessao')).toBe('xyz');
    expect(lerCookieSessao('sgh_sessao=zzz', false)).toBe('zzz');
    expect(cookiesApagados(true).every((c) => c.includes('Max-Age=0') && c.includes('Secure'))).toBe(true);
  });
});

describe('resolvedor de rede pelo endereço (ARQ-2)', () => {
  it('loopback = REDE_PADRAO só em dev/ci; desconhecido = null em qualquer ambiente', () => {
    const r = new ResolvedorRedeConfigurado(envTeste);
    expect(r.resolver('localhost:5300')).toBe(REDE);
    expect(r.resolver('127.0.0.1')).toBe(REDE);
    expect(r.resolver('[::1]:3300')).toBe(REDE);
    expect(r.resolver('outra.rede.exemplo')).toBeNull();
    expect(r.resolver(undefined)).toBeNull();
    const prod = new ResolvedorRedeConfigurado({ ...envTeste, AMBIENTE: 'producao' });
    expect(prod.resolver('localhost')).toBeNull();
  });
  it('dev: os endereços próprios da máquina (DEV_ENDERECOS) também são a rede padrão; produção ignora', () => {
    const dev = new ResolvedorRedeConfigurado({ ...envTeste, DEV_ENDERECOS: '192.168.237.128, 10.0.0.5' });
    expect(dev.resolver('192.168.237.128:5300')).toBe(REDE);
    expect(dev.resolver('10.0.0.5')).toBe(REDE);
    expect(dev.resolver('192.168.237.129:5300')).toBeNull();
    const prod = new ResolvedorRedeConfigurado({
      ...envTeste,
      AMBIENTE: 'producao',
      DEV_ENDERECOS: '192.168.237.128',
    });
    expect(prod.resolver('192.168.237.128:5300')).toBeNull();
  });
  it('cadastro explícito e subdomínio do domínio-base', () => {
    const r = new ResolvedorRedeConfigurado({
      ...envTeste,
      AMBIENTE: 'producao',
      REDE_ENDERECOS: 'sgh.hospital-a.exemplo=rede-a; sgh.hospital-b.exemplo=rede-b',
      DOMINIO_BASE: 'sgh.exemplo',
    });
    expect(r.resolver('SGH.Hospital-A.exemplo:443')).toBe('rede-a');
    expect(r.resolver('sgh.hospital-b.exemplo')).toBe('rede-b');
    expect(r.resolver('rede-c.sgh.exemplo')).toBe('rede-c');
    expect(r.resolver('x.y.sgh.exemplo')).toBeNull();
    expect(r.resolver('sgh.exemplo')).toBeNull();
  });
  it('nome do host sem porta', () => {
    expect(nomeDoHost('Exemplo:80')).toBe('exemplo');
    expect(nomeDoHost('::1')).toBe('::1');
    expect(nomeDoHost('')).toBeNull();
  });
});

describe('sessão no servidor (regra 6)', () => {
  it('entra com usuário sintético, guarda ID e NOME exatos e não devolve token no corpo', async () => {
    const { servico } = montar();
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(r.idSessao).toBeTruthy();
    expect(r.csrf).toBeTruthy();
    expect(r.sessao.sintetica).toBe(false);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(r.sessao.usuario.id).toBe('900000');
    expect(r.sessao.estabelecimentoAtivo).toBe('aa');
    expect(JSON.stringify(r.sessao)).not.toMatch(new RegExp(`${SENHA}|${r.csrf}|${r.idSessao}`));
    expect((await servico.ler(r.idSessao, REDE))?.sessao.usuario.login).toBe('SINT.USUARIO');
  });

  it('M49 (etapa 3): entrar com certificado abre a sessão de sempre, sem senha e sem troca de senha', async () => {
    const { servico } = montar();
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    const r = await servico.entrarComCertificado(
      { estabelecimento: 'aa', login: 'SINT.USUARIO' },
      REDE,
      a.idSessao,
    );
    expect(r.idSessao).not.toBe(a.idSessao);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(r.sessao.trocaSenha).toBeNull();
    expect(await servico.ler(a.idSessao, REDE)).toBeNull();
    await expect(
      servico.entrarComCertificado({ estabelecimento: 'aa', login: 'SINT.NAOEXISTE' }, REDE),
    ).rejects.toMatchObject({ tipo: 'credencial-invalida' });
    await expect(
      servico.entrarComCertificado({ estabelecimento: 'zz', login: 'SINT.USUARIO' }, REDE),
    ).rejects.toMatchObject({ tipo: 'estabelecimento-invalido' });
    await expect(
      servico.entrarComCertificado({ estabelecimento: 'aa', login: 'SINT.USUARIO' }, 'outra-rede'),
    ).rejects.toBeInstanceOf(ErroSessao);
  });

  it('login com caixa diferente é outro usuário (igualdade exata)', async () => {
    const { servico } = montar();
    await expect(servico.entrar(entrada('sint.usuario'), REDE)).rejects.toMatchObject({
      tipo: 'credencial-invalida',
    });
  });

  it('identificador novo a cada login; a sessão anterior trazida pelo navegador é apagada', async () => {
    const { servico } = montar();
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    const b = await servico.entrar(entrada('SINT.USUARIO'), REDE, a.idSessao);
    expect(b.idSessao).not.toBe(a.idSessao);
    expect(await servico.ler(a.idSessao, REDE)).toBeNull();
    expect(await servico.ler(b.idSessao, REDE)).not.toBeNull();
  });

  it('sessão aberta numa rede não vale noutra; endereço desconhecido é recusado', async () => {
    const { servico, armazem } = montar();
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    await expect(servico.ler(r.idSessao, 'outra-rede')).rejects.toMatchObject({ tipo: 'rede-desconhecida' });
    await expect(servico.ler(r.idSessao, null)).rejects.toMatchObject({ tipo: 'rede-desconhecida' });
    await expect(servico.entrar(entrada('SINT.USUARIO'), null)).rejects.toMatchObject({
      tipo: 'rede-desconhecida',
    });
    expect(() => servico.estabelecimentos('outra-rede')).toThrow(ErroSessao);
    // Mesmo com a chave copiada para o prefixo de outra rede, o registro diz de que rede é.
    const outra = montar({
      armazem,
      fonte: new FonteAcessoSintetica({ ...envTeste, REDE_PADRAO: 'outra-rede' }),
    }).servico;
    const bruto = await armazem.obter(`${REDE}:sessao:${r.idSessao}`);
    await armazem.gravar(`outra-rede:sessao:${r.idSessao}`, bruto ?? '', 60);
    expect(await outra.ler(r.idSessao, 'outra-rede')).toBeNull();
  });

  it('CSRF confere contra o token GUARDADO na sessão', async () => {
    const { servico } = montar();
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(await servico.csrfConfere(r.idSessao, REDE, r.csrf)).toBe(true);
    expect(await servico.csrfConfere(r.idSessao, REDE, 'forjado')).toBe(false);
    expect(await servico.csrfConfere(r.idSessao, REDE, undefined)).toBe(false);
    expect(await servico.csrfConfere('outra', REDE, r.csrf)).toBe(false);
  });

  it('inatividade bloqueia e o bloqueio fica GRAVADO: ler, tocar e ler de novo continua bloqueada', async () => {
    let t = 1_000_000;
    const { servico } = montar({ agora: () => t });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    t += 1801 * 1000; // passou da inatividade efetiva (menor entre a política e o padrão do perfil)
    expect((await servico.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(true);
    await servico.tocar(r.idSessao, REDE);
    t += 1000;
    expect((await servico.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(true);
    await expect(servico.escolherUnidade(r.idSessao, REDE, 1)).rejects.toMatchObject({
      tipo: 'sessao-bloqueada',
    });
    const reaut = await servico.reautenticar(r.idSessao, REDE, SENHA);
    expect(reaut.bloqueada).toBe(false);
    expect((await servico.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(false);
  });

  it('atividade adia a inatividade', async () => {
    let t = 1_000_000;
    const { servico } = montar({ agora: () => t });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    t += 600 * 1000;
    await servico.tocar(r.idSessao, REDE);
    t += 600 * 1000;
    expect((await servico.ler(r.idSessao, REDE))?.sessao.bloqueada).toBe(false);
  });

  it('duração máxima (12 h) expira a sessão', async () => {
    let t = 1_000_000;
    const { servico } = montar({ agora: () => t });
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    t += 12 * 3600 * 1000 + 1000;
    expect(await servico.ler(r.idSessao, REDE)).toBeNull();
  });

  it('seletor lista os estabelecimentos da rede, com a situação; indisponível não entra', async () => {
    const { servico } = montar({
      fonte: new FonteAcessoSintetica({ ...envTeste, ACESSO_SINTETICO_INDISPONIVEL: 'zz:Fora do ar' }),
    });
    expect(servico.estabelecimentos(REDE).estabelecimentos.map((e) => [e.codigo, e.disponivel])).toEqual([
      ['aa', true],
      ['bb', true],
      ['zz', false],
    ]);
    await expect(servico.entrar(entrada('SINT.USUARIO', SENHA, 'zz'), REDE)).rejects.toMatchObject({
      tipo: 'estabelecimento-invalido',
    });
  });

  it('sair apaga a sessão no servidor', async () => {
    const { servico } = montar();
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    await servico.sair(r.idSessao, REDE);
    expect(await servico.ler(r.idSessao, REDE)).toBeNull();
  });

  it('política (TBCFGLOGIN) lida uma vez e servida do cache de 5 min', async () => {
    let t = 1_000_000;
    const fonte = new FonteAcessoSintetica(envTeste);
    const leitura = vi.spyOn(fonte, 'configLogin');
    const { servico } = montar({ agora: () => t, fonte });
    await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(leitura).toHaveBeenCalledTimes(1);
    t += 301 * 1000;
    await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(leitura).toHaveBeenCalledTimes(2);
  });

  it('falha ao ler a política vira "indisponível", nunca um padrão sem limite', async () => {
    const fonte = new FonteAcessoSintetica(envTeste);
    vi.spyOn(fonte, 'configLogin').mockRejectedValue(new Error('banco fora'));
    const { servico } = montar({ fonte });
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'indisponivel',
    });
  });

  it('último acesso válido e falhas desde então (no novo)', async () => {
    let t = Date.UTC(2026, 9, 20, 8);
    const { servico } = montar({ agora: () => t });
    const a = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(a.sessao.ultimoAcesso).toEqual({ em: null, falhasDesde: 0 });
    t += 60_000;
    await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    const b = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(b.sessao.ultimoAcesso).toEqual({ em: '2026-10-20T08:00:00.000Z', falhasDesde: 2 });
  });

  it('unidade: escolhe só entre as do acesso do usuário', async () => {
    const { servico } = montar();
    const r = await servico.entrar(entrada('SINT.MULTIUNIDADE'), REDE);
    expect(r.sessao.unidadeAtiva).toBeNull();
    expect((await servico.escolherUnidade(r.idSessao, REDE, 2)).unidadeAtiva).toBe(2);
    await expect(servico.escolherUnidade(r.idSessao, REDE, 99)).rejects.toMatchObject({
      tipo: 'estabelecimento-invalido',
    });
  });
});
