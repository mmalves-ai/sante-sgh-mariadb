// M19 pela HTTP, com a sessão real sobre a fonte sintética e a porta da recepção EM MEMÓRIA (nada conecta a banco):
// permissões por opção do legado, liberação (a chave ligada na sessão sintética), guichê, emissão no balcão, chamada
// na ordem da fila, eventos com a permissão de cada um, encaminhamento, chegada do agendado (lista auditada), painel
// do supervisor, indicadores, fila por gerador, dispositivos (o token sai uma vez), totem (emissão e check-in pelo
// CPF), painel de chamada sem nome e o token que não abre rota de usuário.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { criarAppRecepcao } from './app-recepcao.spec-util.js';
import { PortaRecepcaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
// 08:30 no estabelecimento (America/Sao_Paulo).
const recepcao = new PortaRecepcaoMemoria(
  { estado: () => 'verde' },
  { agora: () => new Date('2026-10-21T11:30:00Z') },
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarAppRecepcao(env, { trilha, recepcao });
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
const R = '/api/recepcao';
const h = (s: Sessao, k?: string) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': k ?? `teste-m19-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `${R}${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}, k?: string) =>
  app.inject({ method: 'POST', url: `${R}${url}`, headers: h(s, k), payload: payload as object });
const put = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'PUT', url: `${R}${url}`, headers: h(s), payload: payload as object });
const doDispositivo = (metodo: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({
    method: metodo,
    url: `/api/dispositivo${url}`,
    headers: { 'x-sgh-dispositivo': token, 'idempotency-key': `totem-m19-${++chave}-${Date.now()}` },
    ...(payload ? { payload: payload as object } : {}),
  });

describe('permissões, liberação e apoio', () => {
  it('sem as opções da recepção, 403; com elas, o apoio e a gravação ligada; nenhum nome de sistema', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/apoio')).statusCode).toBe(403);
    const s = await entrar('SINT.SENHAS');
    const a = await get(s, '/apoio');
    expect(a.statusCode).toBe(200);
    expect(a.json().recepcoes.map((r: { id: number }) => r.id)).toEqual([2, 10]);
    expect(a.json().guichesEmUso).toEqual([
      { recepcao: 2, local: 2, guiche: 1, ocupadoPor: 'outro', usuario: null },
    ]);
    expect(JSON.stringify(a.json())).not.toMatch(/SPDATA|legado|TBSENHA/i);
    const g = (await get(s, '/gravacao')).json();
    expect(g.ligada).toBe(true);
    expect(g.operacoes['recepcao.chamarSenha'].pode).toBe(true);
    expect(g.operacoes['recepcao.emitirSenha'].pode).toBe(true);
  });
});

describe('guichê, emissão, chamada e eventos', () => {
  it('abre o guichê, emite no balcão, chama a prioritária primeiro e conduz a senha', async () => {
    const s = await entrar('SINT.SENHAS');
    expect((await post(s, '/guiche/abrir', { recepcao: 2, local: 2, guiche: 1 })).json().codigo).toBe(
      'guiche-ocupado',
    );
    expect((await post(s, '/guiche/abrir', { recepcao: 2, local: 2, guiche: 3 })).statusCode).toBe(201);
    const p = await post(s, '/senhas', { gerador: 29, prioridade: '1', grupo: 4, origem: 'balcao' });
    expect(p.statusCode).toBe(201);
    const recusada = await post(s, '/senhas', { gerador: 23, prioridade: '1', origem: 'balcao' });
    expect(recusada.statusCode).toBe(409);
    expect(recusada.json().codigo).toBe('prioridade-nao-oferecida');
    expect(
      (await post(s, '/senhas', { gerador: 23, prioridade: '2', origem: 'totem', dispositivo: 1 }))
        .statusCode,
    ).toBe(400);
    const f = await get(s, '/fila?recepcao=2&local=2&guiche=3&geradores=23,24,29');
    expect(f.statusCode).toBe(200);
    expect(f.json().guicheAberto).toBe(true);
    expect(f.json().aguardando[0].prioridade).toBe('1');
    expect(f.json().emAtendimento).toHaveLength(1);
    const c = await post(s, '/senhas/chamar', { recepcao: 2, local: 2, guiche: 3, geradores: [23, 24, 29] });
    expect(c.statusCode).toBe(201);
    const senha = c.json().resultado.senha as number;
    expect(senha).toBe(p.json().resultado.senha);
    const ev = (evento: string, extra: Record<string, unknown> = {}) =>
      post(s, `/senhas/${senha}/eventos`, { evento, local: 2, guiche: 3, ...extra });
    expect((await ev('rechamar')).statusCode).toBe(201);
    expect((await ev('suspender', { motivo: 'DOCUMENTO' })).statusCode).toBe(201);
    expect((await ev('retomar')).statusCode).toBe(201);
    const fim = await ev('liberar');
    expect(fim.statusCode).toBe(201);
    expect((await ev('finalizar')).json().codigo).toBe('letra-nunca-vista');
    const depois = (await get(s, '/fila?recepcao=2&local=2&guiche=3&geradores=23,24,29')).json();
    expect(depois.noGuiche).toHaveLength(0);
    // Trilha: a condução registrada com o evento do catálogo.
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.senha.conduzida')).toBe(true);
  });

  it('cada evento com a sua permissão: o encaminhamento pede a opção do encaminhamento', async () => {
    const g = await entrar('SINT.GUICHE');
    const s = await entrar('SINT.SENHAS');
    const f = (await get(s, '/fila?recepcao=2&local=2&guiche=3')).json();
    const atendida = f.emAtendimento[0].id as number;
    const proibido = await post(g, `/senhas/${atendida}/eventos`, {
      evento: 'encaminhar',
      local: 12,
      guiche: 0,
      destino: 13,
    });
    expect(proibido.statusCode).toBe(403);
    const fora = await post(s, `/senhas/${atendida}/eventos`, {
      evento: 'encaminhar',
      local: 12,
      guiche: 0,
      destino: 2,
    });
    expect(fora.json().codigo).toBe('destino-nao-permitido');
    const ok = await post(s, `/senhas/${atendida}/eventos`, {
      evento: 'encaminhar',
      local: 12,
      guiche: 0,
      destino: 13,
    });
    expect(ok.statusCode).toBe(201);
  });

  it('fechar o guichê de outra pessoa pede a liberação (supervisor) e a justificativa', async () => {
    const g = await entrar('SINT.GUICHE');
    const sem = await post(g, '/guiche/fechar', {
      recepcao: 2,
      local: 2,
      guiche: 1,
      justificativa: 'esqueceu aberto',
    });
    expect(sem.statusCode).toBe(403);
    const s = await entrar('SINT.SENHAS');
    expect((await post(s, '/guiche/fechar', { recepcao: 2, local: 2, guiche: 1 })).json().codigo).toBe(
      'guiche-de-outro',
    );
    const ok = await post(s, '/guiche/fechar', {
      recepcao: 2,
      local: 2,
      guiche: 1,
      justificativa: 'Esqueceu aberto',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().mensagem).toMatch(/liberado/);
  });
});

describe('chegada, supervisor, indicadores e fila por gerador', () => {
  it('os agendados do dia (nome mascarado, auditado) e a chegada ligando a senha', async () => {
    const s = await entrar('SINT.SENHAS');
    const a = await get(s, '/agendados');
    expect(a.statusCode).toBe(200);
    expect(a.json().cortada).toBe(false);
    expect(a.json().itens[0].paciente).toMatch(/^[A-Z]\*\*\*/);
    // A busca do guichê: CPF, prontuário, parte do nome da agenda; entrada inválida recusa.
    expect((await get(s, '/agendados?cpf=33366699957')).json().itens).toMatchObject([
      { tipo: 'exame', marcacao: 8001 },
    ]);
    expect((await get(s, '/agendados?prontuario=900002')).json().itens).toMatchObject([{ marcacao: 7002 }]);
    expect((await get(s, '/agendados?agenda=cardio')).json().itens).toMatchObject([{ marcacao: 7001 }]);
    expect((await get(s, '/agendados?cpf=123')).statusCode).toBe(400);
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.agendados.lidos')).toBe(true);
    const e = await post(s, '/senhas', { gerador: 1, prioridade: '2', origem: 'balcao' });
    const senha = e.json().resultado.senha as number;
    // A senha de serviços diversos não liga a marcação.
    const diversa = (await post(s, '/senhas', { gerador: 23, prioridade: '2', origem: 'balcao' })).json()
      .resultado.senha as number;
    expect(
      (await post(s, `/senhas/${diversa}/chegada`, { tipo: 'consulta', marcacao: 7001 })).json().codigo,
    ).toBe('senha-de-servico-diverso');
    const ch = await post(s, `/senhas/${senha}/chegada`, {
      tipo: 'consulta',
      marcacao: a.json().itens[0].marcacao,
    });
    expect(ch.statusCode).toBe(201);
    const de_novo = await post(s, `/senhas/${senha}/chegada`, { tipo: 'exame', marcacao: 8001 });
    expect(de_novo.json().codigo).toBe('senha-ja-ligada');
    expect((await get(s, '/agendados')).json().itens[0].chegou).toBe(true);
  });

  it('desfazer a chegada: motivo obrigatório, a marcação fica livre de novo; sem chegada recusa', async () => {
    const s = await entrar('SINT.SENHAS');
    const senha = (await post(s, '/senhas', { gerador: 1, prioridade: '2', origem: 'balcao' })).json()
      .resultado.senha as number;
    type Ag = { tipo: string; marcacao: number; chegou: boolean };
    const livre = ((await get(s, '/agendados')).json().itens as Ag[]).find(
      (x) => !x.chegou && x.tipo === 'consulta',
    );
    const marcacao = livre?.marcacao as number;
    expect((await post(s, `/senhas/${senha}/chegada`, { tipo: 'consulta', marcacao })).statusCode).toBe(201);
    expect((await post(s, `/senhas/${senha}/chegada/desfazer`, { motivo: 'curto' })).statusCode).toBe(400);
    const d = await post(s, `/senhas/${senha}/chegada/desfazer`, { motivo: 'Chegada no paciente errado' });
    expect(d.statusCode).toBe(201);
    expect(d.json().resultado).toMatchObject({ senha, marcacao, tipo: 'consulta' });
    const depois = ((await get(s, '/agendados')).json().itens as Ag[]).find((x) => x.marcacao === marcacao);
    expect(depois?.chegou).toBe(false);
    const de_novo = await post(s, `/senhas/${senha}/chegada/desfazer`, {
      motivo: 'Chegada no paciente errado',
    });
    expect(de_novo.json().codigo).toBe('sem-chegada');
  });

  it('o painel do supervisor, os indicadores (366 dias no máximo) e a fila configurada', async () => {
    const s = await entrar('SINT.SENHAS');
    const p = await get(s, '/supervisor?recepcao=2');
    expect(p.statusCode).toBe(200);
    expect(p.json().filas.length).toBeGreaterThan(2);
    expect(p.json().maisAntigas.length).toBeGreaterThan(0);
    const i = await get(s, '/indicadores?de=2026-10-21&ate=2026-10-21');
    expect(i.statusCode).toBe(200);
    expect(i.json().total).toBeGreaterThan(3);
    expect(i.json().esperas.medidas).toBeGreaterThan(0);
    expect(i.json().porGuiche.length).toBeGreaterThan(0);
    expect(i.json().porGuiche[0]).toMatchObject({ recepcao: 2, chamadas: expect.any(Number) });
    expect(i.json().esperaPorHora.length).toBeGreaterThan(0);
    expect((await get(s, '/indicadores?de=2025-01-01&ate=2026-10-21')).statusCode).toBe(400);
    const cfg = await put(s, '/filas/23', {
      ordem: 'intercalada',
      intercalar: 2,
      tempoAlvoMinutos: 15,
      rotuloTotem: 'Exames',
      noTotem: true,
    });
    expect(cfg.statusCode).toBe(200);
    const g = (await get(s, '/apoio')).json().recepcoes[0].geradores.find((x: { id: number }) => x.id === 23);
    expect(g).toMatchObject({ ordem: 'intercalada', tempoAlvoMinutos: 15, rotuloTotem: 'Exames' });
    expect((await entrar('SINT.GUICHE').then((x) => get(x, '/supervisor'))).statusCode).toBe(403);
  });
});

describe('dispositivos (perfil Painel/Totem)', () => {
  it('o token sai uma vez; o totem emite e faz o check-in pelo CPF; o painel mostra a chamada sem nome', async () => {
    const s = await entrar('SINT.SENHAS');
    const tecnicos = (await get(s, '/usuarios-tecnicos')).json() as string[];
    const totem = await post(s, '/dispositivos', {
      tipo: 'totem',
      nome: 'Totem da entrada',
      recepcao: 2,
      locais: [],
      geradores: [1, 23, 29],
      conteudo: null,
      portalOrdem: null,
      usuarioLegado: tecnicos[0],
      validadeDias: 30,
      voz: false,
    });
    expect(totem.statusCode).toBe(201);
    const tokenTotem = totem.json().token as string;
    expect(tokenTotem).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const lista = (await get(s, '/dispositivos')).json();
    expect(JSON.stringify(lista)).not.toContain(tokenTotem);
    // O token do dispositivo não abre rota de usuário.
    const usuario = await app.inject({
      method: 'GET',
      url: `${R}/apoio`,
      headers: { 'x-sgh-dispositivo': tokenTotem },
    });
    expect([401, 403]).toContain(usuario.statusCode);
    expect(JSON.stringify(usuario.json())).not.toMatch(/recepcoes/);
    const cfg = await doDispositivo('GET', '/totem', tokenTotem);
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json().servicos.map((x: { gerador: number }) => x.gerador)).toEqual([1, 23, 29]);
    const emitida = await doDispositivo('POST', '/totem/senhas', tokenTotem, { gerador: 29, grupo: 0 });
    expect(emitida.statusCode).toBe(201);
    expect(emitida.json()).toMatchObject({ prioridade: '0' });
    expect(emitida.json().texto).toMatch(/^CP \d{3}$/);
    // O check-in só em serviço de recepção (o 23 é de serviços diversos).
    expect(
      (await doDispositivo('POST', '/totem/checkin', tokenTotem, { cpf: '22255588846', gerador: 23 })).json()
        .codigo,
    ).toBe('servico-fora-do-totem');
    const fora = await doDispositivo('POST', '/totem/senhas', tokenTotem, { gerador: 24 });
    expect(fora.json().codigo).toBe('servico-fora-do-totem');
    const ck = await doDispositivo('POST', '/totem/checkin', tokenTotem, { cpf: '22255588846', gerador: 1 });
    expect(ck.statusCode).toBe(201);
    expect(ck.json().agendamento).toEqual({ tipo: 'consulta', hora: '08:30' });
    expect(
      (await doDispositivo('POST', '/totem/checkin', tokenTotem, { cpf: '99999999999', gerador: 1 }))
        .statusCode,
    ).toBe(404);
    // O código do agendamento (consulta C, exame E) vai SEMPRE com o CPF de quem está no totem.
    expect(
      (await doDispositivo('POST', '/totem/checkin', tokenTotem, { codigo: 'E8001', gerador: 1 })).statusCode,
    ).toBe(400);
    expect(
      (
        await doDispositivo('POST', '/totem/checkin', tokenTotem, {
          codigo: 'C7001',
          cpf: '33366699957',
          gerador: 1,
        })
      ).json().codigo,
    ).toBe('agendamento-nao-encontrado');
    const exame = await doDispositivo('POST', '/totem/checkin', tokenTotem, {
      codigo: 'E8001',
      cpf: '33366699957',
      gerador: 1,
    });
    expect(exame.statusCode).toBe(201);
    expect(exame.json().agendamento).toEqual({ tipo: 'exame', hora: '09:00' });
    // Cinco recusas em um minuto (duas acima e três aqui) bloqueiam o aparelho (429); o bloqueio vai à trilha.
    const antesBloqueio = trilha.eventos.filter((e) => e.evento === 'recepcao.dispositivo.recusado').length;
    const respostas: number[] = [];
    for (let i = 0; i < 3; i++)
      respostas.push(
        (await doDispositivo('POST', '/totem/checkin', tokenTotem, { cpf: `9999999990${i}`, gerador: 1 }))
          .statusCode,
      );
    const bloqueado = await doDispositivo('POST', '/totem/checkin', tokenTotem, {
      cpf: '22255588846',
      gerador: 1,
    });
    expect(respostas).toEqual([404, 404, 404]);
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.json().codigo).toBe('muitas-tentativas');
    expect(trilha.eventos.filter((e) => e.evento === 'recepcao.dispositivo.recusado').length).toBe(
      antesBloqueio + 1,
    );
    // A emissão comum continua (o bloqueio é só do check-in).
    expect((await doDispositivo('POST', '/totem/senhas', tokenTotem, { gerador: 23 })).statusCode).toBe(201);

    const painel = await post(s, '/dispositivos', {
      tipo: 'painel',
      nome: 'TV da recepção',
      recepcao: 2,
      locais: [],
      geradores: [],
      conteudo: null,
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: true,
    });
    const tokenPainel = painel.json().token as string;
    expect((await doDispositivo('GET', '/totem', tokenPainel)).statusCode).toBe(403);
    // Uma chamada pelo guichê aparece no painel (texto, destino e a fala; nenhum nome).
    await post(s, '/guiche/abrir', { recepcao: 2, local: 2, guiche: 4 });
    const c = await post(s, '/senhas/chamar', { recepcao: 2, local: 2, guiche: 4, geradores: [23, 24] });
    expect(c.statusCode).toBe(201);
    const p = await doDispositivo('GET', '/painel', tokenPainel);
    expect(p.statusCode).toBe(200);
    expect(p.json().atual).toMatchObject({ destino: 'Guichê 4', origem: 'novo' });
    expect(p.json().atual.fala).toMatch(/^Senha .+, guichê 4$/);
    expect(p.json().bilhete).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(p.json())).not.toMatch(/SINTETICO|ANA|BRUNO|CARLA/);
    // Revogado: o painel recusa e a recusa vai à trilha.
    await post(s, `/dispositivos/${painel.json().id}/revogar`);
    const r = await doDispositivo('GET', '/painel', tokenPainel);
    expect(r.statusCode).toBe(401);
    expect(r.json().codigo).toBe('dispositivo-revogado');
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.dispositivo.recusado')).toBe(true);
    expect((await doDispositivo('GET', '/painel', 'x'.repeat(43))).statusCode).toBe(401);
  });

  it('o painel de TV de setor e a lista dos painéis do outro sistema', async () => {
    const s = await entrar('SINT.SENHAS');
    const lista = (await get(s, '/paineis-tv')).json();
    expect(lista.map((x: { conteudo: string }) => x.conteudo)).toEqual(['leitos', 'higienizacao', 'bloco']);
    const tv = await post(s, '/dispositivos', {
      tipo: 'paineltv',
      nome: 'TV do 2º andar',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'higienizacao',
      portalOrdem: 10,
      usuarioLegado: null,
      validadeDias: 30,
      voz: false,
    });
    expect(tv.statusCode).toBe(201);
    const t = await doDispositivo('GET', '/paineltv', tv.json().token);
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ nome: 'TV do 2º andar', conteudo: 'higienizacao', linhas: [] });
    const renovado = await post(s, `/dispositivos/${tv.json().id}/renovar`, { validadeDias: 10 });
    expect(renovado.json().token).not.toBe(tv.json().token);
    expect((await doDispositivo('GET', '/paineltv', tv.json().token)).statusCode).toBe(401);
  });

  it('W1-04: alterar nome, conteúdo e recepção não reemite o token (o aparelho segue entrando)', async () => {
    const s = await entrar('SINT.SENHAS');
    const tv = await post(s, '/dispositivos', {
      tipo: 'paineltv',
      nome: 'TV do 3º andar',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'leitos',
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: false,
    });
    const token = tv.json().token as string;
    const id = tv.json().id as number;
    const validoAte = tv.json().validoAte;
    const alt = await put(s, `/dispositivos/${id}`, {
      nome: 'TV do 4º andar',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'higienizacao',
      voz: true,
    });
    expect(alt.statusCode).toBe(200);
    expect(alt.json()).toMatchObject({ id, nome: 'TV do 4º andar', conteudo: 'higienizacao', voz: true });
    expect(alt.json()).not.toHaveProperty('token');
    expect(alt.json().validoAte).toBe(validoAte);
    const t = await doDispositivo('GET', '/paineltv', token);
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ nome: 'TV do 4º andar', conteudo: 'higienizacao' });
    // Regra do tipo: o painel de TV precisa do conteúdo; o corpo não aceita tipo nem validade.
    const semConteudo = await put(s, `/dispositivos/${id}`, {
      nome: 'TV',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: null,
      voz: false,
    });
    expect(semConteudo.statusCode).toBe(400);
    const comTipo = await put(s, `/dispositivos/${id}`, {
      nome: 'TV',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'leitos',
      voz: false,
      tipo: 'totem',
    });
    expect(comTipo.statusCode).toBe(400);
    await post(s, `/dispositivos/${id}/revogar`);
    const revogado = await put(s, `/dispositivos/${id}`, {
      nome: 'TV',
      recepcao: null,
      locais: [],
      geradores: [],
      conteudo: 'leitos',
      voz: false,
    });
    expect(revogado.statusCode).toBeGreaterThanOrEqual(400);
  });
});
