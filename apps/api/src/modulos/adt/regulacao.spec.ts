// M44, etapa 3 (regulação estadual no NIR) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA:
// as permissões pelas opções do NIR e da central de regulação (quem não tem, 403), o número sempre registrável à mão
// (regra 14), a sucessão sobre a vigente vista (colisão e pedido novo depois de negada), o número de outra solicitação,
// a configuração de regulação em consulta e o conector desligado com o motivo; cada registro com o evento na trilha.
// Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo as moduloAdt } from './modulo.js';
import { FonteInternacaoMemoria } from '../internacao/fonte-memoria.js';
import { EstadoNirMemoria } from './nir-memoria.js';
import { PortaNirMemoria } from './nir-porta-memoria.js';
import { PortaAdtMemoria } from './porta-memoria.js';
import { registroDe } from './regulacao.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'configuracao_teste,cadastro,adt' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const painel = new FonteInternacaoMemoria({});
const estadoNir = new EstadoNirMemoria({});
const adt = new PortaAdtMemoria(
  { estado: () => 'verde' },
  { painel, lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), nir: estadoNir },
);
const nir = new PortaNirMemoria(estadoNir, adt, trilha, (c, ids) => cadastro.lerPacientes(c, ids));
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro },
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        adt: (ctx) => moduloAdt(ctx, { adt, nir }),
      },
    ),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m44-reg-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const pedido = (paciente: number) => ({
  origem: 'eletiva',
  paciente,
  prioridade: 'urgente',
  perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
  clinica: 'M',
  justificativa: 'Indicação sintética: vaga regulada para outro hospital de referência',
});
const reg = (solicitacao: number, x: Record<string, unknown> = {}) => ({
  solicitacao,
  central: 'estadual',
  sentido: 'saida',
  numero: 'rj-2026-000123',
  situacao: 'solicitada',
  anterior: null,
  observacao: null,
  ...x,
});

describe('regulação estadual (M44, etapa 3)', () => {
  let nirS: Sessao;
  let sol = 0;
  let sol2 = 0;

  it('sem as opções do NIR nem da central, 403; o NIR vê as solicitações abertas e o conector desligado', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/nir/regulacao')).statusCode).toBe(403);
    const med = await entrar('SINT.MEDICO.NIR');
    const a = await post(med, '/nir/solicitacoes', pedido(1001));
    expect(a.statusCode, a.body).toBe(201);
    sol = a.json().id;
    const b = await post(med, '/nir/solicitacoes', pedido(1002));
    expect(b.statusCode, b.body).toBe(201);
    sol2 = b.json().id;
    // O médico pede o leito mas não registra a regulação (não tem a opção do NIR nem da central).
    expect((await post(med, '/nir/regulacao', reg(sol))).statusCode).toBe(403);
    nirS = await entrar('SINT.INTERNACAO');
    const t = await get(nirS, '/nir/regulacao');
    expect(t.statusCode, t.body).toBe(200);
    const x = t.json();
    expect(x.solicitacoes.map((s: { solicitacao: number }) => s.solicitacao)).toEqual(
      expect.arrayContaining([sol, sol2]),
    );
    expect(x.contagens['sem-numero']).toBeGreaterThanOrEqual(2);
    expect(x.conector).toMatchObject({ ligado: false, modo: 'desligado' });
    expect(x.conector.motivo).toMatch(/à mão/);
    expect(x.acoes.registrar).toBe(true);
    expect(trilha.eventos.some((e) => e.evento === 'internacao.solicitacaoLeito.lida')).toBe(true);
  });

  it('regra 14: o número à mão; a mudança sobre a vigente; colisão; outro número na regulação em andamento', async () => {
    const r1 = await post(nirS, '/nir/regulacao', reg(sol));
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json().mensagem).toMatch(/registrada/);
    const v1 = r1.json().id;
    // A primeira de novo (anterior nulo) colide: outra pessoa registrou.
    const col = await post(nirS, '/nir/regulacao', reg(sol, { situacao: 'em_analise' }));
    expect(col.statusCode).toBe(409);
    expect(col.json().codigo).toBe('regulacao-desatualizada');
    const outro = await post(
      nirS,
      '/nir/regulacao',
      reg(sol, { numero: 'RJ-2026-000999', anterior: v1, situacao: 'autorizada' }),
    );
    expect(outro.json().codigo).toBe('numero-diferente');
    const r2 = await post(
      nirS,
      '/nir/regulacao',
      reg(sol, { anterior: v1, situacao: 'negada', observacao: 'Sem vaga na referência' }),
    );
    expect(r2.statusCode, r2.body).toBe(201);
    // Negada: um pedido novo com outro número.
    const mesmo = await post(nirS, '/nir/regulacao', reg(sol, { anterior: r2.json().id }));
    expect(mesmo.json().codigo).toBe('regulacao-encerrada');
    const r3 = await post(
      nirS,
      '/nir/regulacao',
      reg(sol, { anterior: r2.json().id, numero: 'RJ-2026-000124' }),
    );
    expect(r3.statusCode, r3.body).toBe(201);
    // O número de uma solicitação não serve a outra.
    const emUso = await post(nirS, '/nir/regulacao', reg(sol2, { numero: 'RJ-2026-000124' }));
    expect(emUso.statusCode).toBe(409);
    expect(emUso.json().codigo).toBe('numero-em-uso');
    // Formato do número e solicitação inexistente.
    expect((await post(nirS, '/nir/regulacao', reg(sol2, { numero: 'a b' }))).statusCode).toBe(400);
    expect((await post(nirS, '/nir/regulacao', reg(999_999_9))).statusCode).toBe(404);
    const t = (await get(nirS, '/nir/regulacao')).json();
    const linha = t.solicitacoes.find((s: { solicitacao: number }) => s.solicitacao === sol);
    expect(linha.vigente).toMatchObject({
      numero: 'RJ-2026-000124',
      situacao: 'solicitada',
      origem: 'manual',
    });
    expect(linha.historico.map((x: { situacao: string }) => x.situacao)).toEqual([
      'solicitada',
      'negada',
      'solicitada',
    ]);
    expect(t.contagens.solicitada).toBeGreaterThanOrEqual(1);
    expect(
      trilha.eventos.filter((e) => e.evento === 'internacao.regulacao.registrada').length,
    ).toBeGreaterThanOrEqual(3);
    // Revisão do M44.3: A negada → B cancelada → A de novo é recusado (o número encerrado não volta a valer).
    const r4 = await post(
      nirS,
      '/nir/regulacao',
      reg(sol, { anterior: r3.json().id, numero: 'RJ-2026-000124', situacao: 'cancelada' }),
    );
    expect(r4.statusCode, r4.body).toBe(201);
    const volta = await post(nirS, '/nir/regulacao', reg(sol, { anterior: r4.json().id }));
    expect(volta.statusCode).toBe(409);
    expect(volta.json().codigo).toBe('regulacao-encerrada');
  });

  it('a configuração de regulação é só consulta (sem endereço); a forma do registro', async () => {
    const c = await get(nirS, '/nir/regulacao/configuracao');
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json().sistemas.length).toBe(2);
    expect(JSON.stringify(c.json())).not.toMatch(/https?:/);
    expect(
      registroDe({
        id: 1,
        solicitacao: 2,
        central: 'sisreg',
        sentido: 'entrada',
        numero: 'X-1234',
        situacao: 'autorizada',
        origem: 'conector',
        observacao: null,
        anterior: null,
        mensagemHash: 'a'.repeat(64),
        por: 'SGH.CONECTOR',
        em: '2026-10-24T10:00:00',
      }),
    ).toMatchObject({ central: 'sisreg', origem: 'conector' });
  });
});
