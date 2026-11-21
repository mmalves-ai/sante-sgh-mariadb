// M17 pela HTTP, com a sessão real sobre a fonte sintética, o módulo registrado (API_MODULOS=agenda) e a porta da
// agenda EM MEMÓRIA (nada conecta a banco): permissões, liberação (POL-3: desligada sem a chave), busca de vaga, marcação com a disputa
// do mesmo horário, detalhe auditado, encaixe com motivo, cancelamento com motivo padronizado, remarcação,
// confirmação (tentativas registradas), falta, painel do dia, bloqueio por período, lista de espera, prévia e
// geração da grade (assinatura da prévia), escala planejada e indicadores.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloAgenda, pacientesSinteticos } from './modulo.js';
import { PortaAgendaMemoria } from './porta-memoria.js';

const HOJE = '2026-10-21'; // quarta-feira
const AMANHA = '2026-10-22';
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'agenda' };
const trilha = new RegistradorTrilhaMemoria();
const agenda = new PortaAgendaMemoria(
  null,
  async (_c, ids) => pacientesSinteticos(ids),
  () => ({ hoje: HOJE, hora: '07:00' }),
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: { agenda: async () => ({ modulo: (ctx) => moduloAgenda(ctx, { porta: agenda }) }) },
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
const A = '/api/agenda/consultas';
const h = (s: Sessao, k?: string) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': k ?? `teste-m17-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `${A}${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}, k?: string) =>
  app.inject({ method: 'POST', url: `${A}${url}`, headers: h(s, k), payload: payload as object });

const marcar = (s: Sessao, hora: string, extra: Record<string, unknown> = {}) =>
  post(s, '/marcacoes', {
    agenda: 901,
    data: AMANHA,
    hora,
    paciente: 1001,
    convenio: 10,
    retorno: false,
    canal: 'telefone',
    ...extra,
  });

describe('permissões e liberação', () => {
  it('sem as opções da agenda, 403; com elas, a lista e o estado da gravação ligado', async () => {
    const r = await entrar('SINT.RECEPCAO');
    expect((await get(r, '/agendas')).statusCode).toBe(403);
    const s = await entrar('SINT.AGENDA');
    const l = await get(s, '/agendas');
    expect(l.statusCode).toBe(200);
    expect(l.json().itens.map((a: { id: number }) => a.id)).toEqual(expect.arrayContaining([901, 902, 903]));
    const g = (await get(s, '/gravacao')).json();
    expect(g.ligada).toBe(true);
    expect(g.operacoes['agenda.agendarConsulta'].pode).toBe(true);
    const o = (await get(s, '/opcoes')).json();
    expect(o.motivosCancelamento.length).toBeGreaterThan(5);
    expect(JSON.stringify(o)).not.toMatch(/SPDATA|legado/i);
  });
});

describe('marcação, disputa, detalhe auditado e cancelamento', () => {
  it('busca a vaga, marca, recusa o mesmo horário e audita a leitura do contato', async () => {
    const s = await entrar('SINT.AGENDA');
    const v = await get(s, `/vagas?agenda=901&de=${AMANHA}&ate=${AMANHA}`);
    expect(v.statusCode).toBe(200);
    expect(v.json().vagas.length).toBe(16);
    const m = await marcar(s, '0800');
    expect(m.statusCode).toBe(201);
    const id = m.json().resultado.marcacao as number;
    expect(id).toBeGreaterThan(0);
    const de_novo = await marcar(s, '0800', { paciente: 1002 });
    expect(de_novo.statusCode).toBe(409);
    expect((await get(s, `/vagas?agenda=901&de=${AMANHA}&ate=${AMANHA}`)).json().vagas.length).toBe(15);
    const d = await get(s, `/marcacoes/${id}`);
    expect(d.statusCode).toBe(200);
    const lida = trilha.eventos.filter((e) => e.evento === 'agenda.marcacao.lida').at(-1);
    expect(lida?.tabelaAlvo).toBe('marcacao_horario');
    expect(lida?.idAlvo).toBe(String(id));
    expect(trilha.eventos.some((e) => e.evento === 'agenda.consulta.marcada')).toBe(true);
  });

  it('valida a entrada (hora fora do formato, canal desconhecido): 400', async () => {
    const s = await entrar('SINT.AGENDA');
    expect((await marcar(s, '25:00')).statusCode).toBe(400);
    expect((await marcar(s, '0815', { canal: 'pombo' })).statusCode).toBe(400);
  });

  it('cancela com motivo padronizado; "Outro" sem descrição é 400; aparece nos cancelamentos', async () => {
    const s = await entrar('SINT.AGENDA');
    const id = (await marcar(s, '0830')).json().resultado.marcacao as number;
    const sem = await post(s, `/marcacoes/${id}/cancelar`, { motivo: 'OUTRO', solicitante: 'paciente' });
    expect(sem.statusCode).toBe(400);
    const c = await post(s, `/marcacoes/${id}/cancelar`, { motivo: 'PAC-DESISTIU', solicitante: 'paciente' });
    expect(c.statusCode).toBe(200);
    const l = (await get(s, `/cancelamentos?de=${HOJE}&ate=${HOJE}`)).json();
    expect(l.itens.length).toBeGreaterThanOrEqual(1);
    expect(l.de).toBe(HOJE);
  });
});

describe('encaixe, remarcação, confirmação e falta', () => {
  it('encaixe exige motivo; a avaliação mostra os vetos; desfazer devolve a grade', async () => {
    const s = await entrar('SINT.AGENDA');
    const base = {
      agenda: 901,
      data: AMANHA,
      hora: '0807',
      paciente: 1002,
      convenio: 10,
      retorno: false,
      canal: 'presencial',
    };
    expect((await post(s, '/encaixes', { ...base, motivo: 'x' })).statusCode).toBe(400);
    const av = await get(s, `/encaixes/avaliacao?agenda=901&data=${AMANHA}&hora=08:07`);
    expect(av.statusCode).toBe(200);
    expect(av.json().vetos).toEqual([]);
    const e = await post(s, '/encaixes', { ...base, motivo: 'Retorno com exame urgente' });
    expect(e.statusCode).toBe(201);
    const id = e.json().resultado.marcacao as number;
    const d = await post(s, `/marcacoes/${id}/desfazer-encaixe`, {});
    expect(d.statusCode).toBe(200);
  });

  it('remarca transferindo; confirma; tentativa sem contato fica só no novo', async () => {
    const s = await entrar('SINT.AGENDA');
    const id = (await marcar(s, '0900')).json().resultado.marcacao as number;
    const r = await post(s, `/marcacoes/${id}/remarcar`, {
      destino: { agenda: 901, data: AMANHA, hora: '0915' },
      modo: 'transferir',
      canal: 'telefone',
    });
    expect(r.statusCode).toBe(200);
    const nova = r.json().resultado.marcacao as number;
    expect(nova).not.toBe(id);
    const t = await post(s, `/marcacoes/${nova}/confirmar`, {
      resultado: 'nao-confirmado',
      canal: 'telefone',
    });
    expect(t.statusCode).toBe(200);
    expect(t.json().mensagem).toMatch(/Tentativa registrada/);
    expect(trilha.eventos.some((e) => e.evento === 'agenda.confirmacao.registrada')).toBe(true);
    const c = await post(s, `/marcacoes/${nova}/confirmar`, { resultado: 'confirmado', canal: 'whatsapp' });
    expect(c.statusCode).toBe(200);
    expect((await get(s, `/marcacoes/${nova}`)).json().estado).toBeDefined();
  });

  it('falta antes da hora é recusada; o painel do dia lista as marcações de amanhã', async () => {
    const s = await entrar('SINT.AGENDA');
    const id = (await marcar(s, '1000')).json().resultado.marcacao as number;
    const f = await post(s, `/marcacoes/${id}/falta`);
    expect(f.statusCode).toBe(409);
    const p = await get(s, `/dia?data=${AMANHA}&agenda=901`);
    expect(p.statusCode).toBe(200);
    expect(JSON.stringify(p.json())).toContain(String(id));
  });

  it('remarcação em lote: um item por transação, com o resultado de cada um', async () => {
    const s = await entrar('SINT.AGENDA');
    const a = (await marcar(s, '1030')).json().resultado.marcacao as number;
    const r = await post(s, '/remarcar-lote', {
      itens: [
        { marcacao: a, destino: { agenda: 901, data: AMANHA, hora: '1045' } },
        { marcacao: a, destino: { agenda: 901, data: AMANHA, hora: '1100' } },
      ],
      modo: 'liberar',
      canal: 'telefone',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().feitos).toBe(1);
    expect(r.json().recusados).toBe(1);
  });
});

describe('bloqueio, lista de espera, grade, escala e indicadores', () => {
  it('bloqueia o período (vagos), mostra na lista e desbloqueia ao encerrar', async () => {
    const s = await entrar('SINT.AGENDA');
    const dia = '2026-10-27';
    const pv = await post(s, '/bloqueios/previa', { agenda: 903, inicio: dia, fim: dia });
    expect(pv.statusCode).toBe(200);
    expect(pv.json().horariosLivres.length).toBe(9);
    const b = await post(s, '/bloqueios', { agenda: 903, inicio: dia, fim: dia, motivo: 'CONGRESSO' });
    expect(b.statusCode).toBe(201);
    const l = (await get(s, '/bloqueios?agenda=903')).json();
    expect(l.itens.length).toBe(1);
    const e = await post(s, `/bloqueios/903/${l.itens[0].id}/encerrar`);
    expect(e.statusCode).toBe(200);
    expect((await get(s, '/bloqueios?agenda=903')).json().itens.length).toBe(0);
  });

  it('lista de espera: inclui, recusa a duplicata, ordena e marca a partir da fila', async () => {
    const s = await entrar('SINT.AGENDA');
    const i = await post(s, '/espera', { paciente: 1003, agenda: 902, prioridade: 'urgente' });
    expect(i.statusCode).toBe(201);
    expect((await post(s, '/espera', { paciente: 1003, agenda: 902, prioridade: 'normal' })).statusCode).toBe(
      409,
    );
    const l = (await get(s, '/espera')).json();
    expect(l.itens[0].posicao).toBe(1);
    const id = l.itens[0].id as number;
    const m = await post(s, `/espera/${id}/marcar`, {
      agenda: 902,
      data: AMANHA,
      hora: '0800',
      convenio: 10,
      canal: 'telefone',
    });
    expect(m.statusCode).toBe(201);
    expect((await get(s, '/espera')).json().itens.length).toBe(0);
  });

  it('prévia da grade e gravação com a assinatura; assinatura velha é 409', async () => {
    const s = await entrar('SINT.AGENDA');
    const pedido = { agenda: 903, de: '2026-11-16', ate: '2026-11-20' };
    const p = await post(s, '/grade/previa', pedido);
    expect(p.statusCode).toBe(200);
    const pv = p.json();
    expect(pv.assinatura).toMatch(/^[0-9a-f]{32}$/);
    const errada = await post(s, '/grade/gerar', { ...pedido, assinatura: '0'.repeat(32) });
    expect(errada.statusCode).toBe(409);
    const g = await post(s, '/grade/gerar', { ...pedido, assinatura: pv.assinatura });
    expect(g.statusCode).toBe(201);
  });

  it('planeja a escala com vigência futura; data passada é 400', async () => {
    const s = await entrar('SINT.AGENDA');
    const faixas = [{ semana: 2, inicio: '0800', fim: '1200' }];
    expect(
      (await post(s, '/escalas/901', { vigenteDesde: '2026-10-01', duracaoMinutos: 15, faixas })).statusCode,
    ).toBe(400);
    const r = await post(s, '/escalas/901', { vigenteDesde: '2026-11-02', duracaoMinutos: 15, faixas });
    expect(r.statusCode).toBe(201);
    const e = (await get(s, '/escalas/901')).json();
    expect(JSON.stringify(e)).toContain('2026-11-02');
  });

  it('indicadores agregados no período', async () => {
    const s = await entrar('SINT.AGENDA');
    const r = await get(s, `/indicadores?de=${HOJE}&ate=2026-10-31`);
    expect(r.statusCode).toBe(200);
    expect(r.json().funil).toBeDefined();
  });
});

describe('escopo da sessão (unidade e tipo de agenda) no servidor', () => {
  it('restrito à unidade 2: a agenda da unidade 1 some das listas e é 403 na leitura e na gravação', async () => {
    const todos = await entrar('SINT.AGENDA');
    const dia = '2026-10-28';
    const fora = (
      await post(todos, '/marcacoes', {
        agenda: 903,
        data: dia,
        hora: '1400',
        paciente: 1004,
        convenio: 10,
        retorno: false,
        canal: 'telefone',
      })
    ).json().resultado.marcacao as number;
    const u2 = await entrar('SINT.AGENDA.U2');
    const ids = (await get(u2, '/agendas')).json().itens.map((a: { id: number }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([901, 902]));
    expect(ids).not.toContain(903);
    expect((await get(u2, '/agendas/903')).statusCode).toBe(403);
    expect((await get(u2, `/grade?agenda=903&inicio=${dia}`)).statusCode).toBe(403);
    expect((await get(u2, `/vagas?agenda=903&de=${dia}&ate=${dia}`)).json().vagas).toEqual([]);
    const det = await get(u2, `/marcacoes/${fora}`);
    expect(det.statusCode).toBe(403);
    expect(det.body).not.toMatch(/telefone|celular/);
    const painel = (await get(u2, `/dia?data=${dia}`)).json();
    expect(painel.marcacoes.map((m: { id: number }) => m.id)).not.toContain(fora);
    expect(
      (await get(todos, `/dia?data=${dia}`)).json().marcacoes.map((m: { id: number }) => m.id),
    ).toContain(fora);
    expect(
      (await post(u2, `/marcacoes/${fora}/cancelar`, { motivo: 'PAC-DESISTIU', solicitante: 'paciente' }))
        .statusCode,
    ).toBe(403);
    const marcarFora = await post(u2, '/marcacoes', {
      agenda: 903,
      data: dia,
      hora: '1420',
      paciente: 1004,
      convenio: 10,
      retorno: false,
      canal: 'telefone',
    });
    expect(marcarFora.statusCode).toBe(403);
    expect(marcarFora.json().codigo).toBe('fora-do-escopo');
    expect((await get(u2, `/indicadores?de=${HOJE}&ate=${HOJE}`)).statusCode).toBe(403);
    // A agenda sem unidade informada vale para todas as unidades.
    expect((await get(u2, `/vagas?agenda=901&de=${dia}&ate=${dia}`)).json().vagas.length).toBeGreaterThan(0);
  });

  it('restrito a um tipo de agenda que nenhuma tem: nada aparece e nada grava', async () => {
    const t5 = await entrar('SINT.AGENDA.T5');
    expect((await get(t5, '/agendas')).json().itens).toEqual([]);
    expect((await get(t5, `/vagas?de=${AMANHA}&ate=${AMANHA}`)).json().vagas).toEqual([]);
    expect((await marcar(t5, '1130')).statusCode).toBe(403);
    expect((await get(t5, `/cancelamentos?de=${HOJE}&ate=${HOJE}`)).json().itens).toEqual([]);
  });

  it('a ligação revisada com unidade passa a valer no escopo e na busca de vaga por unidade', async () => {
    const todos = await entrar('SINT.AGENDA');
    const porUnidade = (await get(todos, `/vagas?unidade=1&de=${AMANHA}&ate=${AMANHA}`)).json();
    expect(new Set(porUnidade.vagas.map((v: { agenda: number }) => v.agenda))).toEqual(new Set([903]));
    const r = await post(todos, '/agendas/902/ligacao', {
      profissional: 502,
      especialidade: 3,
      local: 11,
      unidade: 1,
    });
    expect(r.statusCode).toBe(200);
    const d = (await get(todos, '/agendas/902')).json();
    expect(d.agenda.ligacao).toMatchObject({
      situacao: 'revisada',
      unidade: { codigo: 1 },
      local: { codigo: 11 },
      profissional: { id: 502 },
    });
    const u2 = await entrar('SINT.AGENDA.U2');
    expect((await get(u2, '/agendas/902')).statusCode).toBe(403);
    expect(
      (await get(todos, `/vagas?local=11&de=${AMANHA}&ate=${AMANHA}`))
        .json()
        .vagas.every((v: { agenda: number }) => v.agenda === 902),
    ).toBe(true);
  });
});

describe('cancelamentos por motivo e lista de espera mascarada', () => {
  it('filtra os cancelamentos pelo motivo padronizado', async () => {
    const s = await entrar('SINT.AGENDA');
    const id = (await marcar(s, '1145')).json().resultado.marcacao as number;
    await post(s, `/marcacoes/${id}/cancelar`, { motivo: 'CONV-NAO-AUTORIZOU', solicitante: 'paciente' });
    const so = (await get(s, `/cancelamentos?de=${HOJE}&ate=${HOJE}&motivo=CONV-NAO-AUTORIZOU`)).json();
    expect(so.itens.length).toBeGreaterThanOrEqual(1);
    expect(so.itens.every((c: { motivoCodigo: string }) => c.motivoCodigo === 'CONV-NAO-AUTORIZOU')).toBe(
      true,
    );
    const todos = (await get(s, `/cancelamentos?de=${HOJE}&ate=${HOJE}`)).json();
    expect(todos.total).toBeGreaterThan(so.total);
  });

  it('a lista de espera mostra o nome mascarado; a trilha aponta a tabela real e o pedido criado', async () => {
    const s = await entrar('SINT.AGENDA');
    const i = await post(s, '/espera', { paciente: 1002, agenda: 901, prioridade: 'normal' });
    expect(i.statusCode).toBe(201);
    const pedido = i.json().resultado.espera as number;
    const ev = trilha.eventos.filter((e) => e.evento === 'agenda.espera.alterada').at(-1);
    expect(ev?.idAlvo).toBe(String(pedido));
    const l = (await get(s, '/espera')).json();
    const item = l.itens.find((x: { id: number }) => x.id === pedido);
    // nomeMascarado: o primeiro nome e as iniciais dos demais.
    expect(item.paciente).toMatch(/^\S+( \S\.)+$/);
  });
});

describe('cobertura: marcados com o convênio e o histórico do paciente', () => {
  it('lista as marcações futuras com o convênio (nome mascarado) e o histórico traz as possíveis à parte', async () => {
    const s = await entrar('SINT.AGENDA');
    const id = (await marcar(s, '1115', { paciente: 1005, convenio: 306 })).json().resultado
      .marcacao as number;
    const r = await get(s, '/agendas/901/convenios/306/marcados');
    expect(r.statusCode).toBe(200);
    expect(r.json().itens.map((m: { id: number }) => m.id)).toContain(id);
    expect(r.json().itens.every((m: { convenio: number }) => m.convenio === 306)).toBe(true);
    const d = (await get(s, '/agendas/902')).json();
    expect(d.convenios.find((c: { codigo: number }) => c.codigo === 10)?.particular).toBe(true);
    expect(d.profissionais.length).toBeGreaterThan(0);
    const h = (await get(s, '/pacientes/1005/marcacoes')).json();
    expect(h.marcacoes.map((m: { id: number }) => m.id)).toContain(id);
    expect(h.possiveis).toEqual([]);
    expect(h.preCadastros).toEqual([]);
  });
});

describe('fechamento do dia', () => {
  it('os candidatos a falta do dia passado aparecem no painel e a falta grava um a um', async () => {
    const s = await entrar('SINT.AGENDA');
    const p = (await get(s, '/dia?data=2026-10-20&agenda=902')).json();
    expect(p.candidatosAFalta.length).toBe(2);
    const [a, b] = p.candidatosAFalta as number[];
    expect((await post(s, `/marcacoes/${a}/falta`)).statusCode).toBe(200);
    expect((await post(s, `/marcacoes/${b}/falta`)).statusCode).toBe(200);
    expect((await get(s, '/dia?data=2026-10-20&agenda=902')).json().candidatosAFalta).toEqual([]);
  });
});
