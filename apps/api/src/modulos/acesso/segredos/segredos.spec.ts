// M59-F3: o serviço dos segredos de parceiros e das senhas secundárias (situação sem o valor, cofre, bloqueios das
// regras 1 e 7) e as rotas (permissões, trilha, reautenticação, receita desligada). Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { referenciaDaColuna } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { CofreMemoria, cofreIndisponivel } from '../../assinatura/public-api.js';
import { PortaSegredosMemoria } from './porta-memoria.js';
import { ServicoSegredos } from './servico.js';

const C = { rede: 'rede-teste', hospital: 'pc' };
const ATOR = { ...C, login: 'SINT.ADMIN', estacao: null, correlacao: 'c-1' };
const fechada = async () => ({ desligado: true, contingenciaAtiva: false });
const aberta = async () => ({ desligado: true, contingenciaAtiva: true });
const ligada = () => ({ ligada: true, motivo: null });
const desligada = () => ({ ligada: false, motivo: 'falta a assinatura' });

function servico(over: Partial<ConstructorParameters<typeof ServicoSegredos>[0]> = {}) {
  const porta = new PortaSegredosMemoria();
  const cofre = new CofreMemoria();
  const s = new ServicoSegredos({
    porta,
    cofre,
    receita: ligada,
    situacao: fechada,
    agora: () => 0,
    ...over,
  });
  return { s, porta, cofre };
}

describe('ServicoSegredos: segredos de parceiros', () => {
  it('situação por tabela e por linha; sem cofre para a linha, falta-no-cofre; nenhuma resposta com valor', async () => {
    const { s } = servico();
    const r = await s.situacaoSegredos(C);
    expect(r.contingenciaLigada).toBe(false);
    expect(r.tabelas.find((t) => t.tabela === 'TBCONVEN')).toMatchObject({ comValor: '<5', noCofre: 0 });
    expect(r.linhas.find((l) => l.chave === 'COD=901')).toMatchObject({
      bloqueio: 'falta-no-cofre',
      noCofre: [],
    });
    expect(r.excecoes.map((e) => e.objeto)).toEqual(['TBINFBANCO', 'SP_MODULO_USUARIO']);
    expect(JSON.stringify(r)).not.toMatch(/cofre:parceiro/);
  });

  it('guardar grava no cofre e registra a referência; a linha fica liberada; o valor não volta', async () => {
    const { s, porta, cofre } = servico();
    const r = await s.guardar(ATOR, {
      tabela: 'TBCONVEN',
      chave: 'COD=901',
      coluna: 'SENHA',
      valor: 'nova-sintetica',
      rotacionado: true,
    });
    expect(r).toEqual({ guardado: true, novo: true });
    const ref = referenciaDaColuna('pc', 'TBCONVEN', 'COD=901', 'SENHA');
    expect(await cofre.ler(ref)).toBe('nova-sintetica');
    expect(porta.registros[0]).toMatchObject({ referencia: ref, rotacionado: true });
    const sit = await s.situacaoSegredos(C);
    const l = sit.linhas.find((x) => x.chave === 'COD=901')!;
    expect(l).toMatchObject({ noCofre: ['SENHA'], bloqueio: null });
    expect(l.rotacionadoEm).not.toBeNull();
    expect(JSON.stringify(sit)).not.toContain('nova-sintetica');
    await expect(s.conferirRetiradaSegredo(C, 'TBCONVEN', 'COD=901')).resolves.toBeUndefined();
  });

  it('linha com duas colunas: só libera com as duas no cofre; retirada vira linha retirada pelo registro', async () => {
    const { s, porta } = servico();
    await s.guardar(ATOR, {
      tabela: 'TBHOSPIT',
      chave: 'COD=1',
      coluna: 'SENHA_PROXY',
      valor: 'x',
      rotacionado: false,
    });
    await expect(s.conferirRetiradaSegredo(C, 'TBHOSPIT', 'COD=1')).rejects.toMatchObject({
      extras: { codigo: 'falta-no-cofre' },
    });
    await s.guardar(ATOR, {
      tabela: 'TBHOSPIT',
      chave: 'COD=1',
      coluna: 'SENHAPROV',
      valor: 'y',
      rotacionado: false,
    });
    // A credencial guardada é a mesma de antes: a retirada espera a troca com o parceiro.
    await expect(s.conferirRetiradaSegredo(C, 'TBHOSPIT', 'COD=1')).rejects.toMatchObject({
      extras: { codigo: 'rotacao-pendente' },
    });
    expect((await s.situacaoSegredos(C)).linhas.find((x) => x.tabela === 'TBHOSPIT')).toMatchObject({
      bloqueio: 'rotacao-pendente',
    });
    for (const coluna of ['SENHA_PROXY', 'SENHAPROV'])
      await s.guardar(ATOR, { tabela: 'TBHOSPIT', chave: 'COD=1', coluna, valor: 'nova', rotacionado: true });
    await s.conferirRetiradaSegredo(C, 'TBHOSPIT', 'COD=1');
    porta.retirar('TBHOSPIT', 'COD=1');
    const l = (await s.situacaoSegredos(C)).linhas.find((x) => x.tabela === 'TBHOSPIT')!;
    expect(l).toMatchObject({ comValor: [], bloqueio: 'sem-valor' });
    expect(l.retiradoEm).not.toBeNull();
  });

  it('guardar, retirar, o segredo reaparece, guardar de novo e retirar: o registro volta a valer', async () => {
    const { s, porta } = servico();
    const guardar = () =>
      s.guardar(ATOR, {
        tabela: 'TBCONVEN',
        chave: 'COD=901',
        coluna: 'SENHA',
        valor: 'n',
        rotacionado: true,
      });
    await guardar();
    await s.conferirRetiradaSegredo(C, 'TBCONVEN', 'COD=901');
    porta.retirar('TBCONVEN', 'COD=901');
    porta.reaparecer('TBCONVEN', 'COD=901', ['SENHA']);
    await expect(s.conferirRetiradaSegredo(C, 'TBCONVEN', 'COD=901')).rejects.toMatchObject({
      extras: { codigo: 'falta-no-cofre' },
    });
    await guardar();
    expect(porta.registros.find((r) => r.chave === 'COD=901')?.retiradoEm).toBeNull();
    await expect(s.conferirRetiradaSegredo(C, 'TBCONVEN', 'COD=901')).resolves.toBeUndefined();
  });

  it('recusas: contingência aberta ou sistema anterior ligado, receita desligada, cofre indisponível, coluna fora do catálogo, linha inexistente', async () => {
    const rec = async (over: Parameters<typeof servico>[0]) => {
      const { s } = servico(over);
      return s
        .conferirRetiradaSegredo(C, 'TBCONVEN', 'COD=901')
        .catch((e: { extras?: { codigo?: string } }) => e.extras?.codigo);
    };
    expect(await rec({ situacao: aberta })).toBe('contingencia-ativa');
    expect(await rec({ situacao: async () => ({ desligado: false, contingenciaAtiva: false }) })).toBe(
      'contingencia-ativa',
    );
    expect(await rec({ receita: desligada })).toBe('operacao-desligada');
    expect(await rec({ cofre: cofreIndisponivel })).toBe('cofre-indisponivel');
    const { s } = servico();
    await expect(
      s.guardar(ATOR, {
        tabela: 'TBCONVEN',
        chave: 'COD=901',
        coluna: 'NOME',
        valor: 'x',
        rotacionado: false,
      }),
    ).rejects.toMatchObject({ tipo: 'entrada-invalida' });
    await expect(
      s.guardar(ATOR, {
        tabela: 'TBCONVEN',
        chave: 'COD=999',
        coluna: 'SENHA',
        valor: 'x',
        rotacionado: false,
      }),
    ).rejects.toMatchObject({ tipo: 'nao-encontrado' });
    const semCofre = servico({ cofre: cofreIndisponivel }).s;
    await expect(
      semCofre.guardar(ATOR, {
        tabela: 'TBCONVEN',
        chave: 'COD=901',
        coluna: 'SENHA',
        valor: 'x',
        rotacionado: false,
      }),
    ).rejects.toMatchObject({ tipo: 'indisponivel' });
  });
});

describe('ServicoSegredos: senhas secundárias', () => {
  it('agregados protegidos, página e a própria marcada; recusas da retirada', async () => {
    const { s } = servico();
    const r = await s.senhasSecundarias(C, { pagina: 1 }, 'SINT.FATURAMENTO');
    expect(r.usuariosComSenha).toBe('<5');
    expect(r.usuarios.find((u) => u.login === 'SINT.FATURAMENTO')?.proprio).toBe(true);
    expect((await s.senhasSecundarias(C, { busca: 'sint.enf', pagina: 1 }, 'X')).total).toBe(1);
    await expect(
      s.conferirRetiradaSenhaSecundaria(C, 'SINT.ENFERMAGEM', 'SINT.GESTOR'),
    ).resolves.toBeUndefined();
    await expect(s.conferirRetiradaSenhaSecundaria(C, 'SINT.GESTOR', 'SINT.GESTOR')).rejects.toMatchObject({
      extras: { codigo: 'a-si-mesmo' },
    });
    await expect(
      servico({ situacao: aberta }).s.conferirRetiradaSenhaSecundaria(C, 'SINT.ENFERMAGEM', 'G'),
    ).rejects.toMatchObject({ extras: { codigo: 'contingencia-ativa' } });
    await expect(
      servico({ receita: desligada }).s.conferirRetiradaSenhaSecundaria(C, 'SINT.ENFERMAGEM', 'G'),
    ).rejects.toMatchObject({ extras: { codigo: 'operacao-desligada' } });
  });
});

describe('rotas dos segredos e das senhas secundárias', () => {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
  let app: NestFastifyApplication;
  const trilha = new RegistradorTrilhaMemoria();
  const porta = new PortaSegredosMemoria();
  const cofre = new CofreMemoria();
  let n = 0;
  beforeAll(async () => {
    app = await criarApp(lerConfiguracao(env), null, env, { trilha, segredos: porta, cofreSegredos: cofre });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const entrar = async (login: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha: SENHA },
    });
    expect(r.statusCode).toBe(201);
    const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    return {
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };
  const get = (s: { cookie: string }, url: string) =>
    app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
  const post = (s: { cookie: string; csrf: string }, url: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m59-3-${++n}-${Date.now()}` },
      payload,
    });
  const S = '/api/administracao/integracao/segredos-legado';
  const U = '/api/administracao/acesso/senhas-secundarias';

  it('leitura: administrador e auditor; recepção 403; trilha com o evento', async () => {
    for (const login of ['SINT.ADMIN', 'SINT.AUDITOR']) {
      const antes = trilha.eventos.length;
      const r = await get(await entrar(login), S);
      expect(r.statusCode, login).toBe(200);
      expect(r.json().hospital).toBe('aa');
      expect(
        trilha.eventos
          .slice(antes)
          .some((e) => e.evento === EVENTOS_AUDITAVEIS.segredosLegadoConsultados.codigo),
      ).toBe(true);
    }
    expect((await get(await entrar('SINT.RECEPCAO'), S)).statusCode).toBe(403);
  });

  it('guardar exige a senha e a permissão de gerir; com a senha, o valor vai ao cofre e não volta', async () => {
    const adm = await entrar('SINT.ADMIN');
    const corpo = {
      tabela: 'TBCONVEN',
      chave: 'COD=901',
      coluna: 'SENHA',
      valor: 'sintetica-1',
      rotacionado: true,
    };
    expect((await post(adm, `${S}/guardar`, { ...corpo, senha: 'errada' })).statusCode).toBe(401);
    const ok = await post(adm, `${S}/guardar`, { ...corpo, senha: SENHA });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain('sintetica-1');
    expect(await cofre.ler(referenciaDaColuna('aa', 'TBCONVEN', 'COD=901', 'SENHA'))).toBe('sintetica-1');
    expect(
      (await post(await entrar('SINT.AUDITOR'), `${S}/guardar`, { ...corpo, senha: SENHA })).statusCode,
    ).toBe(403);
    const sit = await get(adm, S);
    expect(sit.body).not.toContain('sintetica-1');
  });

  it('retirar: sem o desligamento do sistema anterior, 409 contingência; sem Idempotency-Key, 400', async () => {
    const adm = await entrar('SINT.ADMIN');
    const r = await post(adm, `${S}/retirar`, { tabela: 'TBCONVEN', chave: 'COD=901', senha: SENHA });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('contingencia-ativa');
    const sem = await app.inject({
      method: 'POST',
      url: `${S}/retirar`,
      headers: { cookie: adm.cookie, 'x-csrf': adm.csrf },
      payload: { tabela: 'TBCONVEN', chave: 'COD=901', senha: SENHA },
    });
    expect(sem.statusCode).toBe(400);
  });

  it('senhas secundárias: gestor de acessos lê e tenta retirar (contingência aberta: 409); recepção 403', async () => {
    const g = await entrar('SINT.GESTOR');
    const r = await get(g, `${U}?busca=SINT&pagina=1`);
    expect(r.statusCode).toBe(200);
    expect(r.json().usuarios.length).toBeGreaterThan(0);
    const x = await post(g, `${U}/SINT.ENFERMAGEM/retirar`, { senha: SENHA });
    expect(x.statusCode).toBe(409);
    expect(x.json().codigo).toBe('contingencia-ativa');
    expect((await get(await entrar('SINT.RECEPCAO'), U)).statusCode).toBe(403);
  });
});
