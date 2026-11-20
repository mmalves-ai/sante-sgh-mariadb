// M50, etapa 2 (agendamento online, pré-check-in, pagamento e pesquisa) pela HTTP, com a sessão real sobre a fonte
// sintética e as portas EM MEMÓRIA (nada conecta a banco): as opções e os horários do portal só das agendas liberadas,
// a marcação pelo canal "portal", a colisão com outro canal (o próximo livre oferecido), o cancelamento e a remarcação
// pelo portal, o pré-check-in enviado, recusado, reenviado e conferido (só o aprovado vai ao cadastro, pela receita do
// M11), o pagamento no gateway simulado com a confirmação repetida que não paga duas vezes, a pesquisa uma vez, a
// configuração da agenda online e as permissões das telas internas. Pacientes e e-mails SINTÉTICOS.
import { codigoTotp } from '@sgh/dominio-acesso';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { ErroOperacao } from '@sgh/legado';
import { PORTA_CADASTRO, type PortaCadastro } from '../../cadastro/porta.js';
import { PortaDocumentosMemoria } from '../../pep/documentos-porta-memoria.js';
import { PortaSadtMemoria } from '../../sadt/porta-memoria.js';
import { GatewaySimulado } from './gateway.js';
import { SERVICO_AGENDA_PORTAL } from './portal-agenda.controller.js';
import { PortaAgendaOnlineMemoria, sementeAgendaOnline } from './porta-memoria.js';
import type { ServicoAgendaPortal } from './servico.js';

const tmp = mkdtempSync(join(tmpdir(), 'sgh-m502-'));
const PORFORA = join(tmp, 'agenda-por-fora.json');
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', AGENDA_SINTETICA_POR_FORA: PORFORA };
const trilha = new RegistradorTrilhaMemoria();
const documentos = new PortaDocumentosMemoria(trilha, null);
const sadt = new PortaSadtMemoria({ estado: () => 'verde' }, documentos);
const agendaOnline = new PortaAgendaOnlineMemoria(undefined, sementeAgendaOnline);
const gateway = new GatewaySimulado();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    documentos,
    sadt,
    vigia: null,
    agendaOnline,
    gatewayPortal: gateway,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  vi.useRealTimers();
  rmSync(tmp, { recursive: true, force: true });
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
const interno = (s: Sessao, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api${url}`,
    headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `teste-m502-${++chave}-${Date.now()}` },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

interface Portal {
  cookie: string;
  csrf: string;
}
function cookiesDe(set: string[] | string | undefined, base = ''): Portal {
  const lista = Array.isArray(set) ? set : set ? [set] : [];
  const mapa = new Map<string, string>();
  for (const c of base.split('; ').filter(Boolean)) mapa.set(c.split('=')[0]!, c);
  for (const c of lista) {
    const par = c.split(';')[0]!;
    const [k, v] = [par.split('=')[0]!, par.slice(par.indexOf('=') + 1)];
    if (v === '') mapa.delete(k);
    else mapa.set(k, par);
  }
  return {
    cookie: [...mapa.values()].join('; '),
    csrf: (mapa.get('sgh_pac_csrf') ?? '').slice('sgh_pac_csrf='.length),
  };
}
const p = (s: Portal, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `/api/paciente${url}`,
    headers: { cookie: s.cookie, 'x-csrf-paciente': s.csrf },
    remoteAddress: '10.50.2.1',
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

async function primeiroAcesso(paciente: number, nascimento: string, email: string): Promise<Portal> {
  const r = await entrar('SINT.RECEPCAO');
  const conv = await interno(r, 'POST', `/portal-paciente/pacientes/${paciente}/convite`, {
    origem: 'recepcao',
  });
  expect(conv.statusCode).toBe(201);
  const codigo = conv.json().codigo as string;
  const a = await app.inject({
    method: 'POST',
    url: '/api/paciente/aa/convite',
    payload: { codigo, nascimento },
    remoteAddress: '10.50.2.9',
  });
  expect(a.statusCode).toBe(204);
  let s = cookiesDe(a.headers['set-cookie'] as string[]);
  const ini = await p(s, 'POST', '/ativacao', {
    codigo,
    nascimento,
    email,
    senha: 'frase-sintetica-longa',
    confirmacao: 'frase-sintetica-longa',
    termoUso: '2026.1',
    politicaPrivacidade: '2026.1',
  });
  expect(ini.statusCode).toBe(200);
  const segredo = new URL(ini.json().otpauth as string).searchParams.get('secret') ?? '';
  const fim = await p(s, 'POST', '/ativacao/segundo-fator', { codigo: codigoTotp(segredo, Date.now()) });
  expect(fim.statusCode).toBe(200);
  s = cookiesDe(fim.headers['set-cookie'] as string[], s.cookie);
  return s;
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 1),
]);
let cinthya: Portal;
const dh = (x: { data: string; hora: string }) => ({ data: x.data, hora: x.hora });

describe('agendamento online pelo portal', () => {
  beforeAll(async () => {
    cinthya = await primeiroAcesso(1003, '1990-07-01', 'cinthya-m502@portal.test');
  });

  it('opções e horários só das agendas liberadas; a marcação pelo canal portal; a colisão oferece o próximo', async () => {
    const o = await p(cinthya, 'GET', '/agenda/opcoes?tipo=consulta');
    expect(o.statusCode).toBe(200);
    expect(o.json().agendas.map((a: { agenda: number }) => a.agenda)).toEqual([902]);
    expect(
      o
        .json()
        .convenios.map((c: { codigo: number }) => c.codigo)
        .sort(),
    ).toEqual([10, 306]);
    const sem = await p(cinthya, 'GET', '/agenda/horarios?tipo=consulta&convenio=305');
    expect(sem.json().itens).toEqual([]);
    const h = await p(cinthya, 'GET', '/agenda/horarios?tipo=consulta&convenio=10');
    expect(h.statusCode).toBe(200);
    const horarios = h.json().itens as { agenda: number; data: string; hora: string }[];
    expect(horarios.length).toBeGreaterThan(3);
    expect(horarios.every((x) => x.agenda === 902)).toBe(true);
    // Sem CSRF, a escrita é recusada.
    const semCsrf = await app.inject({
      method: 'POST',
      url: '/api/paciente/agenda/marcacoes',
      headers: { cookie: cinthya.cookie },
      payload: {
        tipo: 'consulta',
        agenda: 902,
        data: horarios[0]!.data,
        hora: horarios[0]!.hora,
        convenio: 10,
      },
    });
    expect(semCsrf.statusCode).toBe(403);
    // Outro canal (o call center) ocupa o primeiro horário depois da leitura: o portal oferece o próximo.
    const agenda = await entrar('SINT.AGENDA');
    const fora = await interno(agenda, 'POST', '/agenda/consultas/marcacoes', {
      agenda: 902,
      data: horarios[0]!.data,
      hora: horarios[0]!.hora,
      paciente: 1001,
      convenio: 10,
      retorno: false,
      canal: 'telefone',
    });
    expect(fora.statusCode).toBe(201);
    const col = await p(cinthya, 'POST', '/agenda/marcacoes', {
      tipo: 'consulta',
      agenda: 902,
      data: horarios[0]!.data,
      hora: horarios[0]!.hora,
      convenio: 10,
    });
    expect(col.statusCode).toBe(200);
    expect(col.json()).toMatchObject({ ok: false, agendamento: null });
    const prox = col.json().proximo as { data: string; hora: string };
    expect(prox).toMatchObject({ agenda: 902 });
    expect(`${prox.data}${prox.hora}` > `${horarios[0]!.data}${horarios[0]!.hora}`).toBe(true);
    const ok = await p(cinthya, 'POST', '/agenda/marcacoes', {
      tipo: 'consulta',
      agenda: 902,
      ...dh(prox),
      convenio: 10,
    });
    expect(ok.json()).toMatchObject({ ok: true, agendamento: { peloPortal: true, situacao: 'marcado' } });
    const ag = ok.json().agendamento;
    expect(ag.pagamento).toEqual({ valor: 150, situacao: null });
    expect(ag.cancelar.pode).toBe(true);
    // A agenda fora do portal e o convênio sem cobertura são recusados.
    expect(
      (
        await p(cinthya, 'POST', '/agenda/marcacoes', {
          tipo: 'consulta',
          agenda: 901,
          ...dh(prox),
          convenio: 10,
        })
      ).json(),
    ).toMatchObject({ codigo: 'agenda-fora-do-portal' });
    expect(
      (
        await p(cinthya, 'POST', '/agenda/marcacoes', {
          tipo: 'consulta',
          agenda: 902,
          ...dh(horarios[3]!),
          convenio: 305,
        })
      ).json(),
    ).toMatchObject({ codigo: 'convenio-nao-liberado' });
    // Remarcar para outro horário livre e depois cancelar pelo portal.
    const destino = horarios.find((x) => `${x.data}${x.hora}` > `${prox.data}${prox.hora}`)!;
    const rem = await p(cinthya, 'POST', `/agenda/marcacoes/consulta/${ag.id}/remarcacao`, {
      destino: { agenda: 902, ...dh(destino) },
    });
    expect(rem.json()).toMatchObject({ ok: true });
    const nova = rem.json().agendamento.id as string;
    const can = await p(cinthya, 'POST', `/agenda/marcacoes/consulta/${nova}/cancelamento`, {
      motivo: 'PAC-DESISTIU',
    });
    expect(can.statusCode).toBe(200);
    expect(can.json().itens.some((x: { id: string }) => x.id === nova)).toBe(false);
    // A trilha do portal com a conta (sem dado pessoal).
    expect(
      agendaOnline.trilhas.some(
        (t) => t.evento === 'portal.agendamento.registrado' && t.usuario.startsWith('SGH.PORTAL.C'),
      ),
    ).toBe(true);
  });

  it('pré-check-in: enviado, recusado com o motivo, reenviado e conferido (só o aprovado vai ao cadastro)', async () => {
    const h = (await p(cinthya, 'GET', '/agenda/horarios?tipo=consulta&convenio=10')).json().itens as {
      data: string;
      hora: string;
    }[];
    const ok = await p(cinthya, 'POST', '/agenda/marcacoes', {
      tipo: 'consulta',
      agenda: 902,
      ...dh(h[0]!),
      convenio: 10,
    });
    const id = ok.json().agendamento.id as string;
    const arq = await p(cinthya, 'POST', '/pre-checkin/arquivo', {
      tipo: 'image/png',
      conteudo: PNG.toString('base64'),
    });
    expect(arq.statusCode).toBe(201);
    const falso = await p(cinthya, 'POST', '/pre-checkin/arquivo', {
      tipo: 'image/png',
      conteudo: Buffer.from('nao e png de verdade').toString('base64'),
    });
    expect(falso.statusCode).toBe(400);
    const envio = {
      dados: { celular: '(22) 99999-0000', email: 'novo-m502@portal.test' },
      documentos: [{ tipo: 'identidade', arquivo: arq.json().arquivo }],
      carteirinha: null,
      termo: '2026.1',
    };
    const e1 = await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio);
    expect(e1.statusCode).toBe(200);
    expect(e1.json()).toMatchObject({ situacao: 'enviado', proposto: { celular: '22999990000' } });
    // O mesmo arquivo não serve duas vezes; a recepção sem a permissão não confere.
    expect((await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio)).json()).toMatchObject({
      codigo: 'arquivo-desconhecido',
    });
    const semPerm = await entrar('SINT.AGENDA');
    expect((await interno(semPerm, 'GET', '/recepcao/pre-checkin')).statusCode).toBe(403);
    const rec = await entrar('SINT.PRECHECKIN');
    const fila = await interno(rec, 'GET', `/recepcao/pre-checkin?data=${h[0]!.data}`);
    expect(fila.statusCode).toBe(200);
    const item = fila.json().itens.find((x: { paciente: { id: number } }) => x.paciente.id === 1003);
    expect(item).toMatchObject({ situacao: 'enviado', campos: 2, documentos: 1 });
    const det = (await interno(rec, 'GET', `/recepcao/pre-checkin/${item.id}`)).json();
    expect(det.campos.map((c: { campo: string; muda: boolean }) => [c.campo, c.muda])).toEqual([
      ['celular', true],
      ['email', true],
    ]);
    const doc = await interno(rec, 'GET', `/recepcao/pre-checkin/${item.id}/documentos/0`);
    expect(doc.json()).toMatchObject({ tipo: 'image/png' });
    const recusa = await interno(rec, 'POST', `/recepcao/pre-checkin/${item.id}/recusa`, {
      versao: det.versao,
      motivo: 'Foto do documento ilegível: envie outra.',
    });
    expect(recusa.json()).toMatchObject({ motivoRecusa: 'Foto do documento ilegível: envie outra.' });
    const visto = (await p(cinthya, 'GET', `/pre-checkin/consulta/${id}`)).json();
    expect(visto).toMatchObject({
      situacao: 'recusado',
      motivoRecusa: 'Foto do documento ilegível: envie outra.',
    });
    const arq2 = await p(cinthya, 'POST', '/pre-checkin/arquivo', {
      tipo: 'image/png',
      conteudo: PNG.toString('base64'),
    });
    const e2 = await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, {
      ...envio,
      documentos: [{ tipo: 'identidade', arquivo: arq2.json().arquivo }],
    });
    expect(e2.json()).toMatchObject({ situacao: 'enviado' });
    const det2 = (await interno(rec, 'GET', `/recepcao/pre-checkin/${item.id}`)).json();
    // A versão velha recusa; o campo que o paciente não mandou não é aprovado.
    expect(
      (
        await interno(rec, 'POST', `/recepcao/pre-checkin/${item.id}/conferencia`, {
          versao: det.versao,
          versaoCadastro: det2.versaoCadastro,
          campos: ['celular'],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await interno(rec, 'POST', `/recepcao/pre-checkin/${item.id}/conferencia`, {
          versao: det2.versao,
          versaoCadastro: det2.versaoCadastro,
          campos: ['bairro'],
        })
      ).json(),
    ).toMatchObject({ codigo: 'campo-nao-proposto' });
    const conf = await interno(rec, 'POST', `/recepcao/pre-checkin/${item.id}/conferencia`, {
      versao: det2.versao,
      versaoCadastro: det2.versaoCadastro,
      campos: ['celular'],
    });
    expect(conf.statusCode).toBe(200);
    expect(conf.json()).toMatchObject({
      item: { situacao: 'conferido' },
      camposGravados: ['celular'],
      conferidoPor: 'SINT.PRECHECKIN',
    });
    // O cadastro mudou só no celular (o e-mail proposto não foi aprovado).
    const cad = (await p(cinthya, 'GET', `/pre-checkin/consulta/${id}`)).json();
    expect(cad.atual.celular).toBe('22999990000');
    expect(cad.atual.email).not.toBe('novo-m502@portal.test');
    expect((await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio)).json()).toMatchObject({
      codigo: 'precheckin-fechado',
    });
  });

  it('pagamento no gateway simulado: a confirmação repetida não paga duas vezes', async () => {
    const lista = (await p(cinthya, 'GET', '/agenda/marcacoes')).json().itens as {
      id: string;
      tipo: string;
      pagamento: { valor: number | null };
      situacao: string;
    }[];
    const m = lista.find((x) => x.pagamento.valor === 150 && x.situacao === 'marcado')!;
    const c = await p(cinthya, 'POST', `/pagamentos/consulta/${m.id}`, { forma: 'pix' });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ situacao: 'pendente', valor: 150, simulado: true });
    expect(c.json().pixCopiaECola).toMatch(/^SIMULADO-PIX\|/);
    expect((await p(cinthya, 'POST', `/pagamentos/consulta/${m.id}`, { forma: 'pix' })).json()).toMatchObject(
      {
        codigo: 'situacao',
      },
    );
    const conf0 = await p(cinthya, 'POST', `/pagamentos/cobrancas/${c.json().id}/conferencia`);
    expect(conf0.json().situacao).toBe('pendente');
    const sim = await p(cinthya, 'POST', `/pagamentos/cobrancas/${c.json().id}/simulacao`, { aprovar: true });
    expect(sim.json()).toMatchObject({ situacao: 'confirmado' });
    const transacao = (await agendaOnline.pagamentoPorId({ rede: '', hospital: 'aa' }, Number(c.json().id)))!
      .transacao;
    // O retorno do gateway chega de novo (e a conferência do paciente também): nada mais é gravado no caixa.
    const ret = await app.inject({
      method: 'POST',
      url: '/api/paciente/pagamentos/retorno',
      payload: { transacao, hospital: 'aa' },
    });
    expect(ret.statusCode).toBe(204);
    await p(cinthya, 'POST', `/pagamentos/cobrancas/${c.json().id}/conferencia`);
    expect(agendaOnline.caixaDoPortal('aa').filter((x) => x.transacao === transacao)).toHaveLength(1);
    expect((await p(cinthya, 'POST', `/pagamentos/consulta/${m.id}`, { forma: 'pix' })).json()).toMatchObject(
      {
        detail: 'Esta marcação já está paga.',
      },
    );
    // A lista dos agendamentos mostra a marcação paga (sem o "Pagar").
    const depoisDePagar = (await p(cinthya, 'GET', '/agenda/marcacoes'))
      .json()
      .itens.find((x: { id: string }) => x.id === m.id);
    expect(depoisDePagar.pagamento).toEqual({ valor: 150, situacao: 'confirmado' });
    const pags = (await p(cinthya, 'GET', '/pagamentos')).json();
    expect(pags.ligado).toBe(true);
    expect(pags.itens[0]).toMatchObject({ situacao: 'confirmado', pixCopiaECola: null });
    // A marcação no convênio não tem cobrança.
    expect((await p(cinthya, 'POST', `/pagamentos/consulta/999999`, { forma: 'pix' })).statusCode).toBe(404);
  });

  it('pesquisa de satisfação: aberta depois do atendimento, uma vez', async () => {
    const lista = (await p(cinthya, 'GET', '/agenda/marcacoes')).json().itens as {
      id: string;
      tipo: string;
      pesquisa: string | null;
      situacao: string;
    }[];
    const atendida = lista.find((x) => x.pesquisa === 'pendente')!;
    expect(atendida.situacao).toBe('atendido');
    const r = await p(cinthya, 'POST', `/pesquisas/consulta/${atendida.id}`, {
      nota: 9,
      comentario: 'Atendimento pontual.',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().itens.find((x: { id: string }) => x.id === atendida.id).pesquisa).toBe('respondida');
    expect(
      (await p(cinthya, 'POST', `/pesquisas/consulta/${atendida.id}`, { nota: 3 })).json(),
    ).toMatchObject({
      codigo: 'pesquisa-fechada',
    });
    const futura = lista.find((x) => x.situacao === 'marcado')!;
    expect((await p(cinthya, 'POST', `/pesquisas/consulta/${futura.id}`, { nota: 5 })).json()).toMatchObject({
      codigo: 'pesquisa-fechada',
    });
    // A chegada registrada pela recepção (por fora) também abre a pesquisa no dia (aqui só confere o estado).
    writeFileSync(PORFORA, JSON.stringify({ chegar: [{ id: 'm502-1', marcacao: Number(futura.id) }] }));
    const depois = (await p(cinthya, 'GET', '/agenda/marcacoes'))
      .json()
      .itens.find((x: { id: string }) => x.id === futura.id);
    expect(depois.situacao).toBe('atendido');
    expect(depois.cancelar.pode).toBe(false);
  });
});

describe('exame pelo portal', () => {
  it('a agenda de exames liberada na tela interna aparece no portal; marca e cancela pelas receitas do M18', async () => {
    const ag = await entrar('SINT.AGENDA');
    const l = (await interno(ag, 'GET', '/agenda/online')).json();
    const ex = l.itens.find((x: { tipo: string; agenda: number }) => x.tipo === 'exame' && x.agenda === 951);
    expect(ex).toBeDefined();
    const cfg = await interno(ag, 'PUT', '/agenda/online', {
      tipo: 'exame',
      agenda: 951,
      ativa: true,
      convenios: [],
      servicos: [],
      antecedenciaHoras: 2,
      horizonteDias: 21,
      cancelaAteHoras: 2,
      precheckin: true,
      valorParticular: null,
      versao: null,
    });
    expect(cfg.statusCode).toBe(200);
    const o = (await p(cinthya, 'GET', '/agenda/opcoes?tipo=exame')).json();
    expect(o.agendas.map((a: { agenda: number }) => a.agenda)).toEqual([951]);
    const h = (await p(cinthya, 'GET', '/agenda/horarios?tipo=exame&convenio=306')).json().itens as {
      data: string;
      hora: string;
    }[];
    expect(h.length).toBeGreaterThan(0);
    const r = await p(cinthya, 'POST', '/agenda/marcacoes', {
      tipo: 'exame',
      agenda: 951,
      ...dh(h[0]!),
      convenio: 306,
    });
    expect(r.json()).toMatchObject({ ok: true, agendamento: { tipo: 'exame', peloPortal: true } });
    const antigo = r.json().agendamento.id as string;
    // W0-10: o exame também se remarca pelo portal (agenda.remarcarExame, a receita verde do M18).
    expect(r.json().agendamento.remarcar.pode).toBe(true);
    expect(r.json().agendamento.pagamento.valor).toBeNull();
    const rem = await p(cinthya, 'POST', `/agenda/marcacoes/exame/${antigo}/remarcacao`, {
      destino: { agenda: 951, ...dh(h[1]!) },
      motivo: 'PAC-SAUDE',
    });
    expect(rem.statusCode).toBe(200);
    expect(rem.json()).toMatchObject({
      ok: true,
      mensagem: 'Exame remarcado. O horário anterior foi liberado.',
      agendamento: { tipo: 'exame', ...dh(h[1]!) },
    });
    const id = rem.json().agendamento.id as string;
    expect(id).not.toBe(antigo);
    const lista = (await p(cinthya, 'GET', '/agenda/marcacoes')).json().itens as {
      tipo: string;
      id: string;
    }[];
    expect(lista.some((x) => x.tipo === 'exame' && x.id === antigo)).toBe(false);
    // A trilha do portal com a operação certa e a tabela das marcações de exame.
    expect(
      agendaOnline.trilhas.some(
        (t) =>
          t.evento === 'portal.agendamento.registrado' &&
          t.operacao === 'agenda.remarcarExame' &&
          t.tabelaAlvo === 'SIPACAGD' &&
          t.idAlvo === id,
      ),
    ).toBe(true);
    // Um motivo fora da lista do portal é recusado pelo contrato (400), sem tocar a marcação.
    const ruim = await p(cinthya, 'POST', `/agenda/marcacoes/exame/${id}/remarcacao`, {
      destino: { agenda: 951, ...dh(h[2] ?? h[0]!) },
      motivo: 'INVENTADO',
    });
    expect(ruim.statusCode).toBe(400);
    const can = await p(cinthya, 'POST', `/agenda/marcacoes/exame/${id}/cancelamento`, {
      motivo: 'PAC-SAUDE',
    });
    expect(can.statusCode).toBe(200);
    expect(
      can.json().itens.some((x: { tipo: string; id: string }) => x.tipo === 'exame' && x.id === id),
    ).toBe(false);
  });
});

describe('configuração da agenda online (tela interna)', () => {
  it('lista as agendas, libera e retira com a versão; sem a permissão, 403', async () => {
    const ag = await entrar('SINT.AGENDA');
    const l = await interno(ag, 'GET', '/agenda/online');
    expect(l.statusCode).toBe(200);
    expect(l.json()).toMatchObject({ portalLigado: true, podeConfigurar: true });
    // A lista não carrega os convênios nem os serviços de cada agenda: só o detalhe, ao abrir.
    expect(l.json().itens[0]).not.toHaveProperty('conveniosDaAgenda');
    const d902 = await interno(ag, 'GET', '/agenda/online/consulta/902');
    expect(d902.statusCode).toBe(200);
    expect(
      d902
        .json()
        .conveniosDaAgenda.map((c: { codigo: number }) => c.codigo)
        .sort(),
    ).toEqual([10, 306]);
    expect(d902.json().servicosDaAgenda.length).toBeGreaterThan(0);
    expect((await interno(ag, 'GET', '/agenda/online/consulta/999999')).statusCode).toBe(404);
    expect((await interno(ag, 'GET', '/agenda/online/outro/902')).statusCode).toBe(404);
    const a901 = l
      .json()
      .itens.find((x: { tipo: string; agenda: number }) => x.tipo === 'consulta' && x.agenda === 901);
    expect(a901.config).toBeNull();
    const base = {
      tipo: 'consulta',
      agenda: 901,
      ativa: true,
      convenios: [],
      servicos: [],
      antecedenciaHoras: 24,
      horizonteDias: 14,
      cancelaAteHoras: 12,
      precheckin: false,
      valorParticular: null,
      versao: null,
    };
    const c1 = await interno(ag, 'PUT', '/agenda/online', base);
    expect(c1.statusCode).toBe(200);
    const k = c1
      .json()
      .itens.find((x: { tipo: string; agenda: number }) => x.tipo === 'consulta' && x.agenda === 901);
    expect(k.config).toMatchObject({ ativa: true, horizonteDias: 14, versao: 1, alteradoPor: 'SINT.AGENDA' });
    expect((await interno(ag, 'PUT', '/agenda/online', base)).statusCode).toBe(409);
    const c2 = await interno(ag, 'PUT', '/agenda/online', { ...base, ativa: false, versao: 1 });
    expect(
      c2.json().itens.find((x: { agenda: number; tipo: string }) => x.tipo === 'consulta' && x.agenda === 901)
        .config.ativa,
    ).toBe(false);
    // Convênio que a agenda não aceita é recusado (a 902 aceita só 10 e 306).
    const k902 = c2
      .json()
      .itens.find((x: { agenda: number; tipo: string }) => x.tipo === 'consulta' && x.agenda === 902);
    expect(
      (
        await interno(ag, 'PUT', '/agenda/online', {
          ...base,
          agenda: 902,
          convenios: [305],
          versao: k902.config.versao,
        })
      ).json(),
    ).toMatchObject({ codigo: 'convenio-fora-da-agenda' });
    const rec = await entrar('SINT.RECEPCAO');
    expect((await interno(rec, 'GET', '/agenda/online')).statusCode).toBe(403);
    expect((await interno(rec, 'PUT', '/agenda/online', base)).statusCode).toBe(403);
  });
});

describe('correções da revisão do M50.2', () => {
  const ctx = { rede: '', hospital: 'aa' };
  const servico = () => app.get<ServicoAgendaPortal>(SERVICO_AGENDA_PORTAL);
  const cadastro = () => app.get<PortaCadastro>(PORTA_CADASTRO);

  async function marcar(): Promise<string> {
    const h = (await p(cinthya, 'GET', '/agenda/horarios?tipo=consulta&convenio=10')).json().itens as {
      data: string;
      hora: string;
    }[];
    for (const x of h) {
      const r = await p(cinthya, 'POST', '/agenda/marcacoes', {
        tipo: 'consulta',
        agenda: 902,
        ...dh(x),
        convenio: 10,
      });
      if (r.json().ok) return r.json().agendamento.id as string;
    }
    throw new Error('sem horário livre');
  }
  const envio = (celular: string) => ({
    dados: { celular },
    documentos: [],
    carteirinha: null,
    termo: '2026.1',
  });
  async function preEnviado(celular: string) {
    const id = await marcar();
    expect((await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio(celular))).statusCode).toBe(200);
    const pre = (await agendaOnline.preCheckinDaMarcacao(ctx, 'consulta', Number(id)))!;
    return { id, pre };
  }

  it('reenvio concorrente: a conferência reserva o pré-check-in antes do M11 e o reenvio no meio é recusado', async () => {
    const { pre } = await preEnviado('(22) 98888-0001');
    const rec = await entrar('SINT.PRECHECKIN');
    const det = (await interno(rec, 'GET', `/recepcao/pre-checkin/${pre.id}`)).json();
    const reenvio: { status: number; codigo: string }[] = [];
    const original = cadastro().alterar.bind(cadastro());
    const espia = vi.spyOn(cadastro(), 'alterar').mockImplementationOnce(async (...a) => {
      // O paciente reenvia exatamente enquanto a receita do M11 grava o cadastro.
      const r = await p(cinthya, 'PUT', `/pre-checkin/consulta/${pre.marcacao}`, envio('(22) 97777-0001'));
      reenvio.push({ status: r.statusCode, codigo: r.json().codigo });
      return original(...a);
    });
    const conf = await interno(rec, 'POST', `/recepcao/pre-checkin/${pre.id}/conferencia`, {
      versao: det.versao,
      versaoCadastro: det.versaoCadastro,
      campos: ['celular'],
    });
    espia.mockRestore();
    expect(reenvio).toEqual([{ status: 409, codigo: 'situacao' }]);
    expect(conf.statusCode).toBe(200);
    expect(conf.json()).toMatchObject({
      item: { situacao: 'conferido' },
      camposGravados: ['celular'],
      conferidoPor: 'SINT.PRECHECKIN',
      reservadoPor: null,
    });
    // O registro do portal e o cadastro contam a mesma história: o celular conferido é o que foi gravado.
    const visto = (await p(cinthya, 'GET', `/pre-checkin/consulta/${pre.marcacao}`)).json();
    expect(visto.proposto.celular).toBe('22988880001');
    expect(visto.atual.celular).toBe('22988880001');
    expect(
      agendaOnline.trilhas.filter((t) => t.idAlvo === String(pre.id)).map((t) => t.chaveNaturalAlvo),
    ).toEqual(expect.arrayContaining(['reserva', 'conferido:celular']));
  });

  it('a reserva de outra pessoa barra a conferência e o reenvio; a receita do M11 recusada desfaz a reserva', async () => {
    const { id, pre } = await preEnviado('(22) 98888-0002');
    const rec = await entrar('SINT.PRECHECKIN');
    await agendaOnline.gravar(ctx, (g) => g.reservarConferencia(pre.id, pre.versao, 'SINT.OUTRA'), null);
    const det = (await interno(rec, 'GET', `/recepcao/pre-checkin/${pre.id}`)).json();
    expect(det.reservadoPor).toBe('SINT.OUTRA');
    expect(
      (
        await interno(rec, 'POST', `/recepcao/pre-checkin/${pre.id}/conferencia`, {
          versao: det.versao,
          versaoCadastro: det.versaoCadastro,
          campos: ['celular'],
        })
      ).json(),
    ).toMatchObject({ codigo: 'em-conferencia' });
    expect(
      (await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio('(22) 97777-0002'))).json(),
    ).toMatchObject({ codigo: 'situacao' });
    await agendaOnline.gravar(ctx, (g) => g.liberarConferencia(pre.id, det.versao), null);
    const livre = (await interno(rec, 'GET', `/recepcao/pre-checkin/${pre.id}`)).json();
    const espia = vi
      .spyOn(cadastro(), 'alterar')
      .mockRejectedValueOnce(new ErroOperacao(409, 'conflito-versao', 'Registro alterado', 'Recarregue.'));
    const falha = await interno(rec, 'POST', `/recepcao/pre-checkin/${pre.id}/conferencia`, {
      versao: livre.versao,
      versaoCadastro: livre.versaoCadastro,
      campos: ['celular'],
    });
    espia.mockRestore();
    expect(falha.statusCode).toBe(409);
    const depois = (await interno(rec, 'GET', `/recepcao/pre-checkin/${pre.id}`)).json();
    expect(depois).toMatchObject({ reservadoPor: null, item: { situacao: 'enviado' } });
    expect(depois.versao).toBe(livre.versao + 2);
    expect(
      (await p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio('(22) 97777-0002'))).statusCode,
    ).toBe(200);
  });

  it('a marcação cancelada por outro canal: a fila mostra, a conferência recusa e encerra, o cadastro não muda', async () => {
    const { id, pre } = await preEnviado('(22) 98888-0003');
    const antes = (await p(cinthya, 'GET', `/pre-checkin/consulta/${id}`)).json().atual.celular;
    const ag = await entrar('SINT.AGENDA');
    const can = await interno(ag, 'POST', `/agenda/consultas/marcacoes/${id}/cancelar`, {
      motivo: 'PAC-DESISTIU',
      solicitante: 'paciente',
    });
    expect(can.statusCode).toBe(200);
    const rec = await entrar('SINT.PRECHECKIN');
    const fila = (await interno(rec, 'GET', `/recepcao/pre-checkin?data=${pre.data}`)).json();
    expect(fila.itens.find((x: { id: string }) => x.id === String(pre.id))).toMatchObject({
      marcacaoCancelada: true,
    });
    const det = (await interno(rec, 'GET', `/recepcao/pre-checkin/${pre.id}`)).json();
    expect(det.item.marcacaoCancelada).toBe(true);
    const conf = await interno(rec, 'POST', `/recepcao/pre-checkin/${pre.id}/conferencia`, {
      versao: det.versao,
      versaoCadastro: det.versaoCadastro,
      campos: ['celular'],
    });
    expect(conf.json()).toMatchObject({ codigo: 'marcacao-cancelada' });
    expect((await agendaOnline.preCheckinPorId(ctx, pre.id))?.situacao).toBe('cancelado');
    const [pac] = await cadastro().lerPacientes(ctx, [1003]);
    expect(pac?.celular).toBe(antes);
  });

  it('a fila busca por nome do paciente (a busca do cadastro)', async () => {
    const { pre } = await preEnviado('(22) 98888-0004');
    const rec = await entrar('SINT.PRECHECKIN');
    const achou = await interno(rec, 'GET', `/recepcao/pre-checkin?data=${pre.data}&termo=CINTHYA%20VIANNA`);
    expect(achou.statusCode).toBe(200);
    expect(achou.json().itens.some((x: { id: string }) => x.id === String(pre.id))).toBe(true);
    expect(achou.json().buscaTruncada).toBe(false);
    const outro = await interno(
      rec,
      'GET',
      `/recepcao/pre-checkin?data=${pre.data}&termo=ANTONIO%20CONCEICAO`,
    );
    expect(outro.json().itens.some((x: { id: string }) => x.id === String(pre.id))).toBe(false);
  });

  it('com portal.agenda desligada: pesquisa, arquivo, marcação e pré-check-in recusados (POL-3) e a pesquisa não é oferecida', async () => {
    const id = await marcar();
    const espia = vi.spyOn(servico(), 'agendaLigada').mockResolvedValue(false);
    const trilhas = agendaOnline.trilhas.length;
    try {
      const respostas = await Promise.all([
        p(cinthya, 'POST', '/pre-checkin/arquivo', { tipo: 'image/png', conteudo: PNG.toString('base64') }),
        p(cinthya, 'POST', `/pesquisas/consulta/${id}`, { nota: 8 }),
        p(cinthya, 'POST', '/agenda/marcacoes', {
          tipo: 'consulta',
          agenda: 902,
          data: '2099-01-05',
          hora: '0900',
          convenio: 10,
        }),
        p(cinthya, 'PUT', `/pre-checkin/consulta/${id}`, envio('(22) 98888-0005')),
      ]);
      for (const r of respostas) expect([r.statusCode, r.json().codigo]).toEqual([403, 'recurso-desligado']);
      const lista = (await p(cinthya, 'GET', '/agenda/marcacoes')).json().itens as {
        pesquisa: string | null;
      }[];
      expect(lista.some((x) => x.pesquisa === 'pendente')).toBe(false);
      expect(agendaOnline.trilhas.length).toBe(trilhas);
    } finally {
      espia.mockRestore();
    }
  });

  it('pagamento: a cobrança vencida paga no fim do prazo é confirmada antes de outra; a paga em dobro vira duplicado', async () => {
    const saltar = async () => {
      // 33 minutos em três saltos (a sessão do portal vence com 20 minutos parada).
      for (let i = 0; i < 3; i++) {
        vi.setSystemTime(new Date(Date.now() + 11 * 60_000));
        expect((await p(cinthya, 'GET', '/pagamentos')).statusCode).toBe(200);
      }
    };
    const transacao = async (cobranca: string) =>
      (await agendaOnline.pagamentoPorId(ctx, Number(cobranca)))!.transacao;
    try {
      // 1) Paga no minuto 29, o retorno do gateway se perde: a nova cobrança relê a vencida e a confirma.
      const m1 = await marcar();
      const a = (await p(cinthya, 'POST', `/pagamentos/consulta/${m1}`, { forma: 'pix' })).json();
      // O copia e cola fica na própria intenção (não em memória do processo).
      expect((await agendaOnline.pagamentoPorId(ctx, Number(a.id)))?.pixCopiaECola).toMatch(
        /^SIMULADO-PIX\|/,
      );
      gateway.simularPagamento(await transacao(a.id), true);
      await saltar();
      const nova = await p(cinthya, 'POST', `/pagamentos/consulta/${m1}`, { forma: 'pix' });
      expect(nova.json()).toMatchObject({ detail: 'Esta marcação já está paga.' });
      expect((await agendaOnline.pagamentoPorId(ctx, Number(a.id)))?.situacao).toBe('confirmado');
      const ta = await transacao(a.id);
      expect(agendaOnline.caixaDoPortal('aa').filter((x) => x.transacao === ta)).toHaveLength(1);
      // 2) A vencida dá lugar a outra; depois as DUAS são pagas: a primeira confirma, a segunda vira duplicado.
      const m2 = await marcar();
      const a2 = (await p(cinthya, 'POST', `/pagamentos/consulta/${m2}`, { forma: 'pix' })).json();
      await saltar();
      const b2 = (await p(cinthya, 'POST', `/pagamentos/consulta/${m2}`, { forma: 'pix' })).json();
      expect(b2).toMatchObject({ situacao: 'pendente' });
      expect((await agendaOnline.pagamentoPorId(ctx, Number(a2.id)))?.situacao).toBe('expirado');
      const [ta2, tb2] = [await transacao(a2.id), await transacao(b2.id)];
      gateway.simularPagamento(ta2, true);
      const retorno = (t: string) =>
        app.inject({
          method: 'POST',
          url: '/api/paciente/pagamentos/retorno',
          payload: { transacao: t, hospital: 'aa' },
        });
      expect((await retorno(ta2)).statusCode).toBe(204);
      expect((await agendaOnline.pagamentoPorId(ctx, Number(a2.id)))?.situacao).toBe('confirmado');
      expect((await agendaOnline.pagamentoPorId(ctx, Number(b2.id)))?.situacao).toBe('expirado');
      gateway.simularPagamento(tb2, true);
      expect((await retorno(tb2)).statusCode).toBe(204);
      expect((await agendaOnline.pagamentoPorId(ctx, Number(b2.id)))?.situacao).toBe('duplicado');
      expect(
        agendaOnline.caixaDoPortal('aa').filter((x) => x.transacao === ta2 || x.transacao === tb2),
      ).toHaveLength(2);
      const item = (await p(cinthya, 'GET', '/agenda/marcacoes'))
        .json()
        .itens.find((x: { id: string }) => x.id === m2);
      expect(item.pagamento.situacao).toBe('confirmado');
    } finally {
      vi.useRealTimers();
      vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    }
  });
});

describe('W0-10: tesouraria das cobranças do portal', () => {
  const ctx = { rede: '', hospital: 'aa' };
  const hoje = () => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  };
  async function pago(marcacao: number, valor = 150): Promise<string> {
    const transacao = `SIM-W010-${marcacao}`;
    const { id } = await agendaOnline.gravar(
      ctx,
      async (g) => {
        const r = await g.iniciarPagamento({
          conta: 1,
          paciente: 4242,
          tipo: 'consulta',
          marcacao,
          valor,
          forma: 'pix',
          conector: 'simulado',
          transacao,
          expiraEm: new Date(Date.now() + 1_800_000),
          pixCopiaECola: null,
          enderecoCartao: null,
        });
        await g.confirmarPagamento({ transacao, resultado: 'aprovado', comprovante: 'SIM', por: 'retorno' });
        return r;
      },
      null,
    );
    return String(id);
  }

  it('lista, concilia (divergência e baixa), segrega e estorna pelo gateway; sem permissão 403; trilha', async () => {
    const id = await pago(2_000_070_001);
    const conc = await entrar('SINT.FIN.CONCILIA');
    const tes = await entrar('SINT.FIN.TESFIS');
    const rec = await entrar('SINT.PRECHECKIN');
    const url = `/tesouraria/portal/pagamentos?de=${hoje()}&ate=${hoje()}`;
    expect((await interno(rec, 'GET', url)).statusCode).toBe(403);
    expect(
      (await interno(conc, 'GET', `/tesouraria/portal/pagamentos?de=${hoje()}&ate=2000-01-01`)).statusCode,
    ).toBe(400);
    const lista = await interno(conc, 'GET', url);
    expect(lista.statusCode).toBe(200);
    const item = lista.json().itens.find((x: { id: string }) => x.id === id);
    expect(item).toMatchObject({ situacao: 'a-conciliar', valor: 150, cobradoPor: 'SGH.PORTAL', atos: [] });
    expect(lista.json().estornoDisponivel).toBe(true);
    // Estorno antes da baixa por quem não tem a permissão de estornar: 403.
    expect(
      (await interno(rec, 'POST', `/tesouraria/portal/pagamentos/${id}/estorno`, { motivo: 'teste' }))
        .statusCode,
    ).toBe(403);
    // Valor do extrato diferente: a baixa recusa e pede a divergência.
    const errado = await interno(conc, 'POST', `/tesouraria/portal/pagamentos/${id}/conciliacao`, {
      acao: 'conciliado',
      valor: 140,
      referencia: 'EXT-9',
    });
    expect(errado.statusCode).toBe(409);
    expect(errado.json().codigo).toBe('valor');
    const semMotivo = await interno(conc, 'POST', `/tesouraria/portal/pagamentos/${id}/conciliacao`, {
      acao: 'divergente',
      valor: 140,
      referencia: null,
      motivo: '',
    });
    expect(semMotivo.statusCode).toBe(400);
    const div = await interno(conc, 'POST', `/tesouraria/portal/pagamentos/${id}/conciliacao`, {
      acao: 'divergente',
      valor: 140,
      referencia: 'EXT-9',
      motivo: 'extrato com tarifa descontada',
    });
    expect(div.statusCode).toBe(200);
    expect(div.json().situacao).toBe('divergente');
    const baixa = await interno(conc, 'POST', `/tesouraria/portal/pagamentos/${id}/conciliacao`, {
      acao: 'conciliado',
      valor: 150,
      referencia: 'EXT-10',
    });
    expect(baixa.json()).toMatchObject({ situacao: 'conciliado' });
    expect(baixa.json().atos.map((a: { acao: string }) => a.acao)).toEqual(['divergente', 'conciliado']);
    // Depois da baixa, só o estorno; quem conciliou não estorna (segregação).
    const outra = await interno(tes, 'POST', `/tesouraria/portal/pagamentos/${id}/conciliacao`, {
      acao: 'divergente',
      valor: 150,
      referencia: null,
      motivo: 'depois da baixa',
    });
    expect(outra.json().codigo).toBe('situacao');
    const mesmo = await interno(conc, 'POST', `/tesouraria/portal/pagamentos/${id}/estorno`, {
      motivo: 'cobrança em dobro',
      senha: SENHA,
    });
    expect(mesmo.statusCode).toBe(409);
    expect(mesmo.json().codigo).toBe('segregacao');
    // Operação crítica: sem a senha da reautenticação, 401.
    expect(
      (
        await interno(tes, 'POST', `/tesouraria/portal/pagamentos/${id}/estorno`, {
          motivo: 'cobrança em dobro',
        })
      ).statusCode,
    ).toBe(401);
    const est = await interno(tes, 'POST', `/tesouraria/portal/pagamentos/${id}/estorno`, {
      motivo: 'cobrança em dobro',
      senha: SENHA,
    });
    expect(est.statusCode).toBe(200);
    expect(est.json().situacao).toBe('estornado');
    expect(est.json().atos[2]).toMatchObject({ acao: 'estorno', usuario: 'SINT.FIN.TESFIS' });
    expect(est.json().atos[2].referencia).toMatch(/^SIM-EST-/);
    expect(
      (
        await interno(tes, 'POST', `/tesouraria/portal/pagamentos/${id}/estorno`, {
          motivo: 'de novo, de novo',
          senha: SENHA,
        })
      ).json().codigo,
    ).toBe('situacao');
    const eventos = agendaOnline.trilhas.filter((l) => l.idAlvo === id).map((l) => l.evento);
    expect(eventos).toEqual([
      'portal.pagamento.conciliado',
      'portal.pagamento.conciliado',
      'portal.pagamento.estornado',
    ]);
  });
});
