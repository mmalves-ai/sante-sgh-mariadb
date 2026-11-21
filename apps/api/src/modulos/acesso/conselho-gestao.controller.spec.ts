// W1-01 (parte 11d): conferência do conselho pela HTTP sobre a app inteira (fonte da gestão em memória, estado
// sintético). Prova: o gestor vê o registro do papel ativo sem conferência; registra a conferência com reautenticação
// (situação, dia, fonte, observação); a conferência "suspenso" retira os atos privativos (perfil
// 'assistencial-com-conselho') da sessão do médico NA HORA, pelo parâmetro padrão; conferir de novo "ativo" devolve;
// ninguém confere o próprio registro; recusas de entrada; consulta automática desligada; trilha sem a senha.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ConselhoUsuarioTela } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { hojeNoEstabelecimento } from '../../autorizacao/conselho.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { REGISTRO_TESTE_ACESSO } from './registro-teste.spec-util.js';
import { reiniciarEstadoAcessoSintetico } from './fonte-sintetica.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'acesso' };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;
type Pote = Map<string, string>;
const potes: Record<string, Pote> = {};
const URL = '/api/acesso/gestao/usuarios/SINT.MEDICO/conselho';

const cab = (quem: string) => {
  const c = potes[quem] ?? new Map<string, string>();
  return {
    cookie: [...c].map(([k, v]) => `${k}=${v}`).join('; '),
    'x-csrf': c.get('sgh_csrf') ?? '',
    'idempotency-key': `teste-conselho-${++chave}-${Date.now()}`,
  };
};
const post = (quem: string, url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: cab(quem), payload });
const get = (quem: string, url: string) => app.inject({ method: 'GET', url, headers: cab(quem) });

async function entrar(login: string): Promise<void> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    headers: { host: 'localhost' },
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode, login).toBe(201);
  const pote: Pote = new Map();
  const set = r.headers['set-cookie'];
  for (const c of Array.isArray(set) ? set : set ? [set] : []) {
    const [par] = c.split(';');
    const i = par?.indexOf('=') ?? -1;
    if (par && i > 0) pote.set(par.slice(0, i), par.slice(i + 1));
  }
  potes[login] = pote;
}

async function complementares(login: string): Promise<string[]> {
  const r = await get(login, '/api/sessao');
  expect(r.statusCode).toBe(200);
  return (r.json() as { perfil?: { complementares?: string[] } }).perfil?.complementares ?? [];
}

beforeAll(async () => {
  reiniciarEstadoAcessoSintetico();
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, armazem: new ArmazemMemoria(), registro: REGISTRO_TESTE_ACESSO });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  for (const l of ['SINT.GESTOR', 'SINT.MEDICO']) await entrar(l);
});
afterAll(async () => {
  await app.close();
  reiniciarEstadoAcessoSintetico();
});

describe('W1-01 (parte 11d): conferência do conselho na ficha do usuário', () => {
  it('confere, bloqueia os atos privativos na hora pelo parâmetro e libera de novo', async () => {
    const hoje = hojeNoEstabelecimento(Date.now());
    expect(await complementares('SINT.MEDICO')).toContain('assistencial-com-conselho');

    const t0 = (await get('SINT.GESTOR', URL)).json() as ConselhoUsuarioTela;
    expect(t0.parametros).toMatchObject({
      bloqueio: 'irregular',
      validadeDias: 365,
      consultaAutomatica: false,
    });
    expect(t0.parametros.motivoConsultaAutomatica).toMatch(/convênio ou da credencial/);
    expect(t0.registros).toHaveLength(1);
    expect(t0.registros[0]).toMatchObject({
      registro: 1,
      estado: 'nao-conferido',
      liberaAtosPrivativos: true,
    });
    expect(t0).toMatchObject({ atosPrivativos: true, historico: [], podeConferir: true });

    const corpo = {
      registro: 1,
      situacao: 'suspenso',
      conferidoEm: hoje,
      fonte: 'documento',
      observacao: 'ofício do conselho regional: suspensão cautelar',
    };
    const semSenha = await post('SINT.GESTOR', `${URL}/conferencias`, corpo);
    expect(semSenha.statusCode).toBe(400);
    const errada = await post('SINT.GESTOR', `${URL}/conferencias`, { ...corpo, senha: 'errada-123' });
    expect([401, 403]).toContain(errada.statusCode);

    const r = await post('SINT.GESTOR', `${URL}/conferencias`, { ...corpo, senha: SENHA });
    expect(r.statusCode, r.body).toBe(200);
    const feito = r.json() as {
      anterior: string | null;
      atual: string;
      destino: string;
      tela: ConselhoUsuarioTela;
    };
    expect(feito).toMatchObject({
      anterior: null,
      atual: `suspenso em ${hoje} (documento)`,
      destino: 'memoria',
    });
    expect(feito.tela).toMatchObject({ atosPrivativos: false });
    expect(feito.tela.motivoBloqueio).toMatch(/suspenso no conselho/);
    expect(feito.tela.historico[0]).toMatchObject({ situacao: 'suspenso', criadoPor: 'SINT.GESTOR' });
    // Na hora, sem esperar o cache: a sessão do médico perde a categoria com conselho.
    expect(await complementares('SINT.MEDICO')).not.toContain('assistencial-com-conselho');

    const volta = await post('SINT.GESTOR', `${URL}/conferencias`, {
      ...corpo,
      situacao: 'ativo',
      fonte: 'portal-conselho',
      observacao: 'portal do conselho: registro ativo de novo',
      senha: SENHA,
    });
    expect(volta.statusCode, volta.body).toBe(200);
    expect((volta.json() as { anterior: string }).anterior).toBe(`suspenso em ${hoje} (documento)`);
    expect(await complementares('SINT.MEDICO')).toContain('assistencial-com-conselho');

    const ev = trilha.eventos.filter((x) => x.evento === 'acesso.conselho.conferido');
    expect(ev).toHaveLength(2);
    expect(JSON.stringify(trilha.eventos)).not.toContain(SENHA);
  });

  it('recusas: o próprio registro, data futura, registro que não é do usuário, situação fora da lista', async () => {
    const amanha = hojeNoEstabelecimento(Date.now() + 2 * 86_400_000);
    const base = {
      registro: 1,
      situacao: 'ativo',
      conferidoEm: hojeNoEstabelecimento(Date.now()),
      fonte: 'portal-conselho',
      observacao: 'conferência no portal do conselho',
      senha: SENHA,
    };
    const propria = await post('SINT.MEDICO', `${URL}/conferencias`, base);
    expect([403, 409]).toContain(propria.statusCode);
    const futura = await post('SINT.GESTOR', `${URL}/conferencias`, { ...base, conferidoEm: amanha });
    expect(futura.statusCode).toBe(409);
    expect(futura.json()).toMatchObject({ codigo: 'data-futura' });
    const outro = await post('SINT.GESTOR', `${URL}/conferencias`, { ...base, registro: 99 });
    expect(outro.statusCode).toBe(409);
    expect(outro.json()).toMatchObject({ codigo: 'registro-nao-vinculado' });
    const sit = await post('SINT.GESTOR', `${URL}/conferencias`, { ...base, situacao: 'regular' });
    expect(sit.statusCode).toBe(400);
    const semRegistro = (
      await get('SINT.GESTOR', '/api/acesso/gestao/usuarios/SINT.USUARIO/conselho')
    ).json() as ConselhoUsuarioTela;
    expect(semRegistro).toMatchObject({ registros: [], atosPrivativos: false, podeConferir: false });
  });
});
