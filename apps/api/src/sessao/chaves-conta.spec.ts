// Chaves do serviço de sessão por cliente e por conta (F2-L): a credencial vale para o cliente inteiro e o banco
// compara o login sem caixa nem acento (utf8mb4_uca1400_ai_ci). Então: (1) as grafias do mesmo login somam no mesmo
// contador; (2) outro estabelecimento do cliente não dá rodada nova; (3) a redefinição derruba as sessões em todos
// os estabelecimentos; (4) o cookie de um cliente não vale na API de outro que divida o armazém; (5) a fonte própria
// não sobe sem CLIENTE_PADRAO. Fonte sintética e armazém em memória.
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from './armazem.js';
import { clienteDaSessao } from './montar.js';
import { chaveDoLogin } from './servico-sessao.js';
import { portaSenhaMemoria } from '../modulos/acesso/senha/porta-senha.js';
import { REDE, SENHA, entrada, montar } from './teste.spec-util.js';

const ORIGEM = { estacao: 'SGH-WEB:teste', correlacao: 'teste-chaves' };

describe('chaves da sessão por conta e por cliente', () => {
  it('chaveDoLogin: a mesma igualdade da colação (caixa, acento, traço, ß, espaço à direita)', () => {
    const k = chaveDoLogin('admin');
    for (const g of ['Admin', 'ADMIN', 'ädmin', 'ÁDMÍN', 'admin  ', 'ａｄｍｉｎ'])
      expect(chaveDoLogin(g)).toBe(k);
    expect(chaveDoLogin('Straße')).toBe(chaveDoLogin('STRASSE'));
    expect(chaveDoLogin('Søren')).toBe(chaveDoLogin('soren'));
    expect(chaveDoLogin('admin')).not.toBe(chaveDoLogin('admim'));
  });

  it("'Admin', 'ADMIN' e 'ädmin' somam no mesmo contador: a porta fecha para a conta", async () => {
    const { servico } = montar();
    const grafias = ['sint.usuario', 'Sint.Usuario', 'SINT.USUÁRIO', 'sïnt.usuario', 'SINT.USUARIO'];
    for (let i = 0; i < 10; i++)
      await servico.entrar(entrada(grafias[i % grafias.length]!, 'errada'), REDE).catch(() => null);
    await expect(servico.entrar(entrada('SINT.USUARIO'), REDE)).rejects.toMatchObject({
      tipo: 'muitas-tentativas',
    });
  });

  it('outro estabelecimento do cliente não dá rodada nova de tentativas', async () => {
    const { servico } = montar();
    for (let i = 0; i < 5; i++)
      await servico.entrar(entrada('SINT.USUARIO', 'errada', 'aa'), REDE).catch(() => null);
    for (let i = 0; i < 5; i++)
      await servico.entrar(entrada('SINT.USUARIO', 'errada', 'bb'), REDE).catch(() => null);
    for (const est of ['aa', 'bb'])
      await expect(servico.entrar(entrada('SINT.USUARIO', SENHA, est), REDE)).rejects.toMatchObject({
        tipo: 'muitas-tentativas',
      });
  });

  it('a redefinição pelo gestor em um estabelecimento derruba as sessões do usuário nos dois', async () => {
    const { servico } = montar({ config: { senha: portaSenhaMemoria() } });
    const emA = await servico.entrar(entrada('SINT.USUARIO', SENHA, 'aa'), REDE);
    const emB = await servico.entrar(entrada('SINT.USUARIO', SENHA, 'bb'), REDE);
    await servico.redefinirSenha(
      { rede: REDE, estabelecimento: 'aa', login: 'SINT.GESTOR' },
      'sint.usuario',
      ORIGEM,
      Date.now(),
    );
    expect(await servico.ler(emA.idSessao, REDE)).toBeNull();
    expect(await servico.ler(emB.idSessao, REDE)).toBeNull();
  });

  it('o bloqueio (revogação) vale no cliente inteiro, com qualquer grafia do login', async () => {
    const { servico } = montar();
    const emB = await servico.entrar(entrada('SINT.USUARIO', SENHA, 'bb'), REDE);
    await servico.revogarSessoesDoUsuario(REDE, 'aa', 'Sint.Usuario');
    expect(await servico.ler(emB.idSessao, REDE)).toBeNull();
  });

  it('dois clientes no mesmo armazém: o cookie de um não vale no outro', async () => {
    const armazem = new ArmazemMemoria();
    const a = montar({ armazem, config: { cliente: 'cliente_a' } });
    const b = montar({ armazem, config: { cliente: 'cliente_b' } });
    const r = await a.servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(await a.servico.ler(r.idSessao, REDE)).not.toBeNull();
    expect(await b.servico.ler(r.idSessao, REDE)).toBeNull();
    // As tentativas também não se misturam: 10 falhas no cliente A não fecham a porta no B.
    for (let i = 0; i < 10; i++)
      await a.servico.entrar(entrada('SINT.USUARIO', 'errada'), REDE).catch(() => null);
    await expect(b.servico.entrar(entrada('SINT.USUARIO'), REDE)).resolves.toBeTruthy();
  });

  it('a fonte própria não sobe sem CLIENTE_PADRAO (nem com ele fora do formato)', () => {
    expect(() => clienteDaSessao({ AMBIENTE: 'dev' }, true)).toThrow(/CLIENTE_PADRAO ausente/);
    expect(() => clienteDaSessao({ AMBIENTE: 'dev', CLIENTE_PADRAO: 'Cliente A' }, true)).toThrow(/inválido/);
    expect(clienteDaSessao({ AMBIENTE: 'dev', CLIENTE_PADRAO: 'teste_login' }, true)).toBe('teste_login');
    expect(clienteDaSessao({ AMBIENTE: 'ci' }, false)).toBeNull();
  });
});
