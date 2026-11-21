// W1-01 (parte 6b) pela HTTP, sobre a fonte sintética (nada conecta a banco): as versões do termo de uso, a publicação
// pelo executor acesso.publicarTermo (senha e motivo; recusas da receita), o novo aceite no próximo acesso e os
// aceites da versão anterior consultáveis e intactos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { modulo } from './modulo.js';

const A = '/api/administracao/acesso';
let chave = 0;

async function subir(extra: Record<string, string>) {
  const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'administracao', ...extra };
  const trilha = new RegistradorTrilhaMemoria();
  const app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { administracao: async () => ({ modulo: (ctx) => modulo(ctx) }) },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, trilha };
}

function cliente(app: NestFastifyApplication) {
  const entrar = async (login: string, senha = SENHA) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      payload: { estabelecimento: 'aa', login, senha },
    });
    const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
    return {
      status: r.statusCode,
      corpo: r.statusCode < 300 ? r.json() : null,
      cookie: set.map((c) => c.split(';')[0]).join('; '),
      csrf:
        set
          .find((c) => c.startsWith('sgh_csrf='))
          ?.split(';')[0]
          ?.slice(9) ?? '',
    };
  };
  type S = Awaited<ReturnType<typeof entrar>>;
  const get = (s: S, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
  const post = (s: S, url: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        cookie: s.cookie,
        'x-csrf': s.csrf,
        'idempotency-key': `teste-w101-${++chave}-${Date.now()}`,
      },
      payload,
    });
  return { entrar, get, post };
}

describe('termo de uso: versões, publicar e novo aceite (W1-01, parte 6b)', () => {
  let app: NestFastifyApplication;
  let trilha: RegistradorTrilhaMemoria;
  beforeAll(async () => {
    ({ app, trilha } = await subir({}));
  });
  afterAll(async () => {
    await app.close();
  });

  const TEXTO_NOVO =
    'TERMO DE USO, versão revisada (texto sintético de teste). Declaro que usarei o prontuário só para a assistência.';
  const MOTIVO = 'Revisão anual do termo pela comissão';

  it('lista as versões, publica com senha e motivo, exige novo aceite e mantém os aceites da anterior', async () => {
    const c = cliente(app);
    const g = await c.entrar('SINT.GESTOR');
    const antes = (await c.get(g, `${A}/termo/versoes`)).json();
    expect(antes.publicarPossivel).toBe(true);
    expect(antes.versoes).toHaveLength(1);
    const vigente = antes.versoes[0];
    expect(vigente.vigente).toBe(true);
    expect(vigente.aceites).toBeGreaterThan(0);

    // Sem permissão de gestão: 403; sem a senha: 400; senha errada: 401.
    const f = await c.entrar('SINT.FATURISTA');
    const pedido = { termoAnterior: vigente.id, texto: TEXTO_NOVO, motivo: MOTIVO };
    expect((await c.post(f, `${A}/termo/publicar`, { ...pedido, senha: SENHA })).statusCode).toBe(403);
    expect((await c.post(g, `${A}/termo/publicar`, pedido)).statusCode).toBe(400);
    expect((await c.post(g, `${A}/termo/publicar`, { ...pedido, senha: 'errada-123' })).statusCode).toBe(401);
    // Versão desatualizada e texto igual: recusados, nada muda.
    const desat = await c.post(g, `${A}/termo/publicar`, { ...pedido, termoAnterior: 999_999, senha: SENHA });
    expect(desat.statusCode).toBeGreaterThanOrEqual(409);
    expect(desat.json().codigo ?? desat.json().type).toMatch(/termo-desatualizado/);
    const termoAtual = (await c.get(g, `${A}/termo`)).json();
    const igual = await c.post(g, `${A}/termo/publicar`, {
      ...pedido,
      texto: termoAtual.texto,
      senha: SENHA,
    });
    expect(igual.statusCode).toBeGreaterThanOrEqual(409);
    expect((await c.get(g, `${A}/termo/versoes`)).json().versoes).toHaveLength(1);

    const pub = await c.post(g, `${A}/termo/publicar`, { ...pedido, senha: SENHA });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({
      anterior: vigente.id,
      operacao: 'acesso.publicarTermo',
      destino: 'memoria',
    });
    const novo = pub.json().id as number;
    expect(novo).not.toBe(vigente.id);

    const depois = (await c.get(g, `${A}/termo/versoes`)).json().versoes;
    expect(depois.map((v: { id: number; vigente: boolean }) => [v.id, v.vigente])).toEqual([
      [novo, true],
      [vigente.id, false],
    ]);
    expect(depois[1].aceites).toBe(vigente.aceites);
    expect(depois[0].aceites).toBe(0);
    // A anterior continua consultável: texto e aceites (página 1).
    const ant = (await c.get(g, `${A}/termo/versoes/${vigente.id}`)).json();
    expect(ant).toMatchObject({
      id: vigente.id,
      vigente: false,
      aceites: vigente.aceites,
      pagina: 1,
      porPagina: 50,
    });
    expect(ant.texto.length).toBeGreaterThan(20);
    expect(ant.itens.length).toBe(Math.min(50, vigente.aceites));
    expect((await c.get(g, `${A}/termo/versoes/${vigente.id}?pagina=0`)).statusCode).toBe(400);
    expect((await c.get(g, `${A}/termo/versoes/987654`)).statusCode).toBe(404);

    // Próximo acesso: quem tinha aceito a anterior tem o termo novo pendente; aceitar limpa.
    const f2 = await c.entrar('SINT.FATURISTA');
    expect((await c.get(f2, '/api/sessao')).json().termoPendente).toBe(true);
    const ts = (await c.get(f2, `${A}/termo/sessao`)).json();
    expect(ts).toMatchObject({ pendente: true, termo: { id: novo } });
    expect((await c.post(f2, `${A}/termo/aceitar`, { termo: novo })).statusCode).toBe(200);
    expect((await c.get(f2, '/api/sessao')).json().termoPendente ?? false).toBe(false);
    const fim = (await c.get(g, `${A}/termo/versoes`)).json().versoes;
    expect(fim[0].aceites).toBe(1);
    expect(fim[1].aceites).toBe(vigente.aceites);

    // Varredura: nem a senha nem o texto do termo vão à trilha.
    const texto = JSON.stringify(trilha.eventos);
    expect(texto).not.toContain(SENHA);
    expect(texto).not.toContain('versão revisada');
    expect(
      trilha.eventos.some((e) => e.evento === 'acesso.termo.publicado' && e.usuario === 'SINT.GESTOR'),
    ).toBe(true);
  });
});
