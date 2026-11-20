// Regras 2 e 5 (M34) pela HTTP: a triagem dos relatórios de SQL livre (cada um com destino e dono; a decisão da área
// com o motivo, auditada; o destino "catálogo" só com um relatório do catálogo), os pedidos de relatório novo (quem pede
// vê os seus; o curador responde) e o envio agendado (os parâmetros relativos aceitos, o próximo envio calculado, o
// "enviar agora" sem a fila vira "sem-fila" e fica registrado). Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { PortaRelatorioMemoria } from '../porta-memoria.js';
import { baseDoLink } from '../relatorio.controller.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const relatorio = new PortaRelatorioMemoria(trilha);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, relatorio, vigia: null });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
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
type S = Awaited<ReturnType<typeof entrar>>;
const get = (s: S, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: S, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m34-g-${++chave}-${Date.now()}`,
    },
    payload: payload as object,
  });

describe('triagem (regra 2)', () => {
  it('todos com destino e dono; a decisão da área fica confirmada, com quem e o motivo', async () => {
    const s = await entrar('SINT.ADMIN');
    const p = (await get(s, '/relatorios/triagem')).json();
    expect(p.resumo).toMatchObject({ total: 12, semDestino: 0, semDono: 0, confirmadas: 0 });
    expect(p.itens.find((x: { nome: string }) => /eSocial/.test(x.nome))).toMatchObject({ marco: 'M53' });
    const id = p.itens.find((x: { nome: string }) => x.nome === 'Teste relatório novo').id;
    const ruim = await post(s, `/relatorios/triagem/${id}`, {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'naoExiste',
      papelDono: 'diretoria',
      onda: 0,
      motivo: 'Teste do destino inválido',
    });
    expect(ruim.statusCode).toBe(400);
    const ok = await post(s, `/relatorios/triagem/${id}`, {
      destino: 'descartado',
      marco: null,
      artefato: 'Relatório de teste do editor',
      papelDono: 'curador do catálogo (TI)',
      onda: null,
      motivo: 'Relatório de teste, sem uso.',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      situacao: 'confirmada',
      destino: 'descartado',
      decididoPor: 'SINT.ADMIN',
    });
    expect((await get(s, '/relatorios/triagem?situacao=confirmada')).json().total).toBe(1);
    expect(trilha.eventos.some((e) => e.evento === 'relatorio.triagem.decidida')).toBe(true);
    const sem = await entrar('SINT.RECEPCAO');
    expect((await get(sem, '/relatorios/triagem')).statusCode).toBe(403);
  });
});

describe('pedidos de relatório novo', () => {
  it('quem pede vê os seus; o curador publica com um relatório do catálogo', async () => {
    const area = await entrar('SINT.LEITOS');
    const r = await post(area, '/relatorios/pedidos', {
      titulo: 'Leitos bloqueados por mês',
      descricao: 'Quantidade de leitos bloqueados por motivo e unidade, mês a mês, com o total.',
      finalidade: 'Planejamento de manutenção dos leitos.',
      area: 'Coordenação de leitos',
      prazo: '2099-12-31',
    });
    expect(r.statusCode).toBe(201);
    expect((await get(area, '/relatorios/pedidos')).json()).toHaveLength(1);
    const outro = await entrar('SINT.DIRETORIA');
    expect((await get(outro, '/relatorios/pedidos')).json()).toHaveLength(0);
    expect((await post(area, `/relatorios/pedidos/${r.json().id}/resposta`, {})).statusCode).toBe(403);
    const cur = await entrar('SINT.ADMIN');
    const pub = await post(cur, `/relatorios/pedidos/${r.json().id}/resposta`, {
      situacao: 'publicado',
      relatorio: 'internadosNaData',
      resposta: 'Atendido pelo relatório de internados com o filtro.',
    });
    expect(pub.statusCode).toBe(200);
    expect((await get(area, '/relatorios/pedidos')).json()[0]).toMatchObject({
      situacao: 'publicado',
      relatorio: 'internadosNaData',
    });
  });
});

describe('envio agendado (regra 5)', () => {
  it('cria com os relativos e calcula o próximo; o histórico de origem só em contagens; enviar sem fila', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await post(s, '/relatorios/agendamentos', {
      relatorio: 'atendimentosPorDia',
      titulo: 'Atendimentos de ontem',
      parametros: { inicio: 'ontem', fim: 'ontem' },
      grupos: [],
      enderecos: ['diretoria@exemplo.invalid'],
      periodicidade: 'diaria',
      hora: 700,
      diaSemana: null,
      diaMes: null,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().proximoEnvio).toMatch(/T07:00:00$/);
    const l = (await get(s, '/relatorios/agendamentos')).json();
    expect(l.agendamentos[0]).toMatchObject({ titulo: 'Atendimentos de ontem', enderecos: 1, ativo: true });
    expect(JSON.stringify(l)).not.toContain('diretoria@exemplo.invalid');
    expect(l.origem.naoEnviados).toBe(420);
    const e = await post(s, `/relatorios/agendamentos/${r.json().id}/enviar`);
    expect(e.json()).toMatchObject({ situacao: 'sem-fila' });
    expect(e.json().link).toMatch(/\/relatorios\?.*relatorio=atendimentosPorDia/);
    // Semanal sem dia, relatório desconhecido e parâmetro inválido são recusados.
    expect(
      (
        await post(s, '/relatorios/agendamentos', {
          relatorio: 'atendimentosPorDia',
          titulo: 'Teste 1',
          parametros: {},
          grupos: ['G'],
          enderecos: [],
          periodicidade: 'semanal',
          hora: 700,
          diaSemana: null,
          diaMes: null,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(s, '/relatorios/agendamentos', {
          relatorio: 'nada',
          titulo: 'Teste 2',
          parametros: {},
          grupos: ['G'],
          enderecos: [],
          periodicidade: 'diaria',
          hora: 700,
          diaSemana: null,
          diaMes: null,
        })
      ).statusCode,
    ).toBe(404);
    // Desativar.
    expect(
      (
        await post(s, `/relatorios/agendamentos/${r.json().id}`, {
          relatorio: 'atendimentosPorDia',
          titulo: 'Atendimentos de ontem',
          parametros: { inicio: 'ontem', fim: 'ontem' },
          grupos: [],
          enderecos: ['diretoria@exemplo.invalid'],
          periodicidade: 'diaria',
          hora: 700,
          diaSemana: null,
          diaMes: null,
          ativo: false,
          motivo: 'Envio suspenso no teste',
        })
      ).statusCode,
    ).toBe(200);
    expect((await get(s, '/relatorios/agendamentos')).json().agendamentos[0]).toMatchObject({
      ativo: false,
      proximoEnvio: null,
    });
  });
});

describe('enviar agora: a base do link', () => {
  it('o link do "enviar agora" usa WEB_ENDERECO, nunca o Origin do pedido (revisão do M34)', async () => {
    expect(baseDoLink({ WEB_ENDERECO: 'https://sante.exemplo.invalid' })).toBe(
      'https://sante.exemplo.invalid',
    );
    expect(baseDoLink({})).toBe('http://127.0.0.1:5300');
    const antes = process.env['WEB_ENDERECO'];
    process.env['WEB_ENDERECO'] = 'https://sante.exemplo.invalid';
    try {
      const s = await entrar('SINT.ADMIN');
      const r = await post(s, '/relatorios/agendamentos', {
        relatorio: 'atendimentosPorDia',
        titulo: 'Origem forjada',
        parametros: { inicio: 'ontem', fim: 'ontem' },
        grupos: [],
        enderecos: ['diretoria@exemplo.invalid'],
        periodicidade: 'diaria',
        hora: 700,
        diaSemana: null,
        diaMes: null,
      });
      expect(r.statusCode).toBe(201);
      const e = await app.inject({
        method: 'POST',
        url: `/api/relatorios/agendamentos/${r.json().id}/enviar`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          origin: 'https://sante-login.exemplo.net',
          'idempotency-key': `teste-m34-g-${++chave}-${Date.now()}`,
        },
        payload: {},
      });
      expect(e.statusCode).toBe(200);
      expect(e.json().link).toMatch(/^https:\/\/sante\.exemplo\.invalid\/relatorios\?/);
      expect(e.json().link).not.toContain('sante-login.exemplo.net');
    } finally {
      if (antes === undefined) delete process.env['WEB_ENDERECO'];
      else process.env['WEB_ENDERECO'] = antes;
    }
  });
});
