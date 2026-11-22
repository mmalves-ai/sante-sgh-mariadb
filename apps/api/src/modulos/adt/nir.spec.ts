// M44, etapa 2 (NIR) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco):
// permissões pelas opções de leitos (quem não tem, 403), a indicação de internação como ato médico (regra 9), a fila
// priorizada com a situação equivalente do de-para (regra 10), a reserva com o perfil, a exceção do supervisor com a
// senha e a vaga única (regra 11), o leito reservado no mapa que só admite o paciente da solicitação, a admissão vinda
// do NIR que conclui a solicitação, a reserva expirada pelo relógio, o conflito da ocupação por fora (regra 12), a alta
// prevista versionada pelo médico, as barreiras, o quadro de permanência com as cores (regra 13), a calibragem, os
// limites e o de-para aprovado, cada um com o evento na trilha (regra 15). Dados sintéticos.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro,adt',
};
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const pasta = resolve(import.meta.dirname, '../../../../../.tmp/nir-spec');
const porFora = resolve(pasta, 'por-fora.json');
// O mapa sintético depende do dia (o movimento é gerado pela data): o relógio fixo deixa o teste determinístico (em
// 2026-10-26 nenhum leito livre de outro tipo de acomodação aparecia para o pedido). M47.2: correção de portão, como
// a do adt.spec no M47.3.
const painel = new FonteInternacaoMemoria({
  arquivoPorFora: porFora,
  agora: () => Date.UTC(2026, 9, 23, 12, 0),
});
let avancoMin = 0;
const estadoNir = new EstadoNirMemoria({ agora: () => new Date(Date.now() + avancoMin * 60_000) });
const adt = new PortaAdtMemoria(
  { estado: () => 'verde' },
  { painel, lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), nir: estadoNir },
);
const nir = new PortaNirMemoria(estadoNir, adt, trilha, (c, ids) => cadastro.lerPacientes(c, ids));
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  mkdirSync(pasta, { recursive: true });
  rmSync(porFora, { force: true });
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
  rmSync(pasta, { recursive: true, force: true });
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
  'idempotency-key': `teste-m44-nir-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const pedido = (paciente: number, x: Record<string, unknown> = {}) => ({
  origem: 'eletiva',
  paciente,
  prioridade: 'urgente',
  perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [] },
  clinica: 'M',
  justificativa: 'Indicação sintética: pneumonia com necessidade de antibiótico venoso',
  ...x,
});
const admissao = (paciente: number, leito: { bloco: string; acomodacao: string; leito: string }, x = {}) => ({
  paciente,
  leito,
  convenio: 901,
  acomodacaoPlano: 'ENFERMARIA',
  carater: 'urgencia',
  clinica: 'M',
  especialidade: 11,
  medicoAssistente: 7101,
  medicoSolicitante: 7101,
  cidPrincipal: 50001,
  procedimento: 303010037,
  centroCusto: 300100,
  unidade: 4,
  origem: 'ambulatorio',
  ...x,
});
interface ItemFila {
  id: number;
  estado: string;
  paciente: { id: number };
  reserva: { id: number; chave: string } | null;
  situacaoEquivalente: { codigo: number } | null;
  prazoEstourado: boolean;
}
const fila = async (s: Sessao) =>
  (await get(s, '/nir/fila')).json() as { itens: ItemFila[]; conflitos: unknown[] };
const item = async (s: Sessao, id: number) => (await fila(s)).itens.find((x) => x.id === id);

describe('NIR: permissões, ato médico e a fila', () => {
  it('sem as opções de leitos, 403; a recepção interna não pede leito (ato médico); o médico pede', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/nir/fila')).statusCode).toBe(403);
    const nirS = await entrar('SINT.INTERNACAO');
    expect((await get(nirS, '/nir/fila')).statusCode).toBe(200);
    expect((await post(nirS, '/nir/solicitacoes', pedido(1001))).statusCode).toBe(403);
    const g = (await get(nirS, '/nir/gravacao')).json();
    expect(g.ligada).toBe(true);
    expect(g.operacoes.reservar.pode).toBe(true);
    expect(g.operacoes.solicitar.pode).toBe(false);
    const med = await entrar('SINT.MEDICO.NIR');
    const gm = (await get(med, '/nir/gravacao')).json();
    expect(gm.medico).toBe(true);
    expect(gm.operacoes.solicitar.pode).toBe(true);
    const r = await post(med, '/nir/solicitacoes', pedido(1001));
    expect(r.statusCode, r.body).toBe(201);
    const dup = await post(med, '/nir/solicitacoes', pedido(1001));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('solicitacao-aberta');
    expect(
      (await post(med, '/nir/solicitacoes', { ...pedido(1001), justificativa: 'curta' })).statusCode,
    ).toBe(400);
    const f = await fila(nirS);
    const i = f.itens.find((x) => x.id === r.json().id);
    expect(i).toMatchObject({ estado: 'solicitado', situacaoEquivalente: { codigo: 7 }, reserva: null });
    expect(trilha.eventos.some((x) => x.evento === 'internacao.solicitacaoLeito.criada')).toBe(true);
    expect(trilha.eventos.some((x) => x.evento === 'internacao.solicitacaoLeito.lida')).toBe(true);
    expect(JSON.stringify(f)).not.toMatch(/SPDATA|legado|sistema atual/i);
    const o = (await get(med, '/nir/origens')).json();
    expect(Array.isArray(o.pa) && Array.isArray(o.internados) && Array.isArray(o.cirurgias)).toBe(true);
  });

  it('a transição confere o estado visto e a permissão; priorizar pede o motivo; a máquina recusa o salto', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1002, { prioridade: 'eletivo' }))).json()
      .id as number;
    const t = (b: unknown) => post(nirS, `/nir/solicitacoes/${id}/transicoes`, b);
    expect((await t({ acao: 'transito', estadoVisto: 'solicitado' })).json().codigo).toBe(
      'transicao-invalida',
    );
    expect((await t({ acao: 'analisar', estadoVisto: 'em_analise' })).json().codigo).toBe(
      'solicitacao-desatualizada',
    );
    expect((await t({ acao: 'analisar', estadoVisto: 'solicitado' })).statusCode).toBe(200);
    expect(
      (await t({ acao: 'priorizar', estadoVisto: 'em_analise', prioridade: 'emergencia' })).statusCode,
    ).toBe(400);
    expect(
      (
        await t({
          acao: 'priorizar',
          estadoVisto: 'em_analise',
          prioridade: 'emergencia',
          motivo: 'Piora clínica',
        })
      ).statusCode,
    ).toBe(200);
    const f = await fila(nirS);
    expect(f.itens[0]?.id).toBe(id);
    expect(f.itens[0]).toMatchObject({ estado: 'em_analise', situacaoEquivalente: { codigo: 1 } });
    // O médico não opera a fila (sem o controle central de leitos).
    expect(
      (await post(med, `/nir/solicitacoes/${id}/transicoes`, { acao: 'analisar', estadoVisto: 'em_analise' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await t({ acao: 'rejeitar', estadoVisto: 'em_analise', motivo: 'Sem indicação de internação' }))
        .statusCode,
    ).toBe(200);
    expect(await item(nirS, id)).toBeUndefined();
  });
});

describe('NIR: reserva, mapa, admissão e expiração', () => {
  it('reserva só o leito do perfil; a exceção pede a senha; o mapa mostra reservado; só o paciente dele é admitido', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1003))).json().id as number;
    const l = (await get(nirS, `/nir/solicitacoes/${id}/leitos`)).json();
    expect(l.compativeis).toBeGreaterThan(0);
    const uti = l.leitos.find((x: { intensiva: boolean }) => x.intensiva);
    const enf = l.leitos.find((x: { compativel: boolean }) => x.compativel);
    expect(uti.compativel).toBe(false);
    const rUti = await post(nirS, '/nir/reservas', { solicitacao: id, leito: uti.leito });
    expect(rUti.statusCode).toBe(409);
    expect(rUti.json().codigo).toBe('leito-incompativel');
    // A exceção do supervisor exige a senha (crítica).
    expect(
      (
        await post(nirS, '/nir/reservas', {
          solicitacao: id,
          leito: uti.leito,
          excecao: 'Único leito livre na madrugada',
        })
      ).statusCode,
    ).toBe(400);
    const r = await post(nirS, '/nir/reservas', { solicitacao: id, leito: enf.leito });
    expect(r.statusCode, r.body).toBe(201);
    expect(await item(nirS, id)).toMatchObject({ estado: 'reservado', situacaoEquivalente: { codigo: 5 } });
    // A vaga é única: outra solicitação no mesmo leito, recusada.
    const id2 = (await post(med, '/nir/solicitacoes', pedido(1004))).json().id as number;
    const dupla = await post(nirS, '/nir/reservas', { solicitacao: id2, leito: enf.leito });
    expect(dupla.statusCode).toBe(409);
    expect(dupla.json().codigo).toBe('leito-reservado');
    const mapa = (await get(nirS, '/leitos/mapa')).json();
    const noMapa = mapa.leitos.find((x: { chave: string }) => x.chave === enf.chave);
    expect(noMapa).toMatchObject({ situacao: 'reservado', admissivel: false, reserva: { solicitacao: id } });
    expect(mapa.resumo.reservados).toBe(1);
    // Outro paciente no leito reservado: recusado; o da solicitação, admitido (a solicitação conclui).
    const outro = await post(nirS, '/internacoes', admissao(1004, enf.leito));
    expect(outro.statusCode).toBe(409);
    expect(outro.json().codigo).toBe('leito-reservado');
    const doMapa = (await get(nirS, `/leitos/mapa?paciente=1003&solicitacao=${id}`)).json();
    expect(doMapa.leitos.find((x: { chave: string }) => x.chave === enf.chave).admissivel).toBe(true);
    expect((await post(nirS, `/nir/reservas/${r.json().id}/confirmar`)).statusCode).toBe(200);
    const adm = await post(nirS, '/internacoes', admissao(1003, enf.leito, { solicitacaoNir: id }));
    expect(adm.statusCode, adm.body).toBe(201);
    expect(await item(nirS, id)).toBeUndefined();
    const reservas = (await get(nirS, '/nir/reservas')).json();
    expect(reservas.encerradas.find((x: { id: number }) => x.id === r.json().id).situacao).toBe('consumida');
    for (const ev of ['internacao.reservaLeito.registrada', 'internacao.reservaLeito.confirmada'])
      expect(trilha.eventos.some((x) => x.evento === ev)).toBe(true);
  });

  it('a reserva vencida expira (o leito volta a livre e a solicitação à análise); cancelar devolve à análise', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1005))).json().id as number;
    const l = (await get(nirS, `/nir/solicitacoes/${id}/leitos`)).json();
    const enf = l.leitos.find((x: { compativel: boolean }) => x.compativel);
    const r = await post(nirS, '/nir/reservas', { solicitacao: id, leito: enf.leito, validadeMin: 15 });
    expect(r.statusCode).toBe(201);
    avancoMin += 20;
    expect(await item(nirS, id)).toMatchObject({ estado: 'em_analise', reserva: null });
    const mapa = (await get(nirS, '/leitos/mapa')).json();
    expect(mapa.leitos.find((x: { chave: string }) => x.chave === enf.chave).situacao).toBe('livre');
    expect(trilha.eventos.some((x) => x.evento === 'internacao.reservaLeito.expirada')).toBe(true);
    const r2 = await post(nirS, '/nir/reservas', { solicitacao: id, leito: enf.leito });
    expect(r2.statusCode).toBe(201);
    expect(
      (await post(nirS, `/nir/reservas/${r2.json().id}/cancelar`, { motivo: 'Paciente piorou: pedir UTI' }))
        .statusCode,
    ).toBe(200);
    expect(await item(nirS, id)).toMatchObject({ estado: 'em_analise' });
    expect(
      (await post(nirS, `/nir/reservas/${r2.json().id}/cancelar`, { motivo: 'De novo' })).json().codigo,
    ).toBe('reserva-desatualizada');
  });

  it('regra 12: a ocupação por fora do leito reservado aparece no mapa como incoerência, sem gravação na leitura', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const id = (await post(med, '/nir/solicitacoes', pedido(1006))).json().id as number;
    const l = (await get(nirS, `/nir/solicitacoes/${id}/leitos`)).json();
    const enf = l.leitos.find((x: { compativel: boolean }) => x.compativel);
    expect((await post(nirS, '/nir/reservas', { solicitacao: id, leito: enf.leito })).statusCode).toBe(201);
    writeFileSync(
      porFora,
      JSON.stringify({
        reg: 990_044,
        bloco: enf.leito.bloco,
        acomodacao: enf.leito.acomodacao,
        leito: enf.leito.leito,
        iniciais: 'S.N.',
        sexo: 'M',
        nascimento: '1960-01-01',
        convenio: 'CONVENIO SINTETICO',
      }),
    );
    const m = (await get(nirS, '/leitos/mapa')).json();
    const c = m.leitos.find((x: { chave: string }) => x.chave === enf.chave);
    expect(c.situacao).toBe('conflito');
    // Só leitura: o mapa mostra a incoerência e não grava conflito (no banco a internação no leito reservado é recusada).
    expect(c.conflito).toMatchObject({ internacao: 990_044, registrado: false });
    const f = await fila(nirS);
    expect(f.conflitos).toHaveLength(0);
    await get(nirS, '/leitos/mapa');
    expect(trilha.eventos.filter((x) => x.evento === 'internacao.reservaLeito.conflito')).toHaveLength(0);
    rmSync(porFora, { force: true });
    // O NIR cancela a reserva e a solicitação volta à análise (nunca desfaz a ocupação do outro sistema).
    const reservas = (await get(nirS, '/nir/reservas')).json();
    const rid = reservas.vigentes.find((x: { solicitacao: number }) => x.solicitacao === id).id;
    expect(
      (await post(nirS, `/nir/reservas/${rid}/cancelar`, { motivo: 'Leito ocupado pelo outro terminal' }))
        .statusCode,
    ).toBe(200);
  });
});

describe('NIR: alta prevista, barreiras, permanência, calibragem e de-para', () => {
  it('a DPA é do médico, versionada (mudar pede o motivo); as barreiras; o quadro com as cores e a reunião', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const a = (await get(nirS, '/nir/altas-previstas')).json();
    expect(a.itens.length).toBeGreaterThan(0);
    const i = a.itens[0];
    const hoje = a.hoje as string;
    const amanha = new Date(Date.parse(`${hoje}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(
      (await post(nirS, '/nir/dpa', { internacao: i.internacao, data: amanha, anterior: null })).statusCode,
    ).toBe(403);
    expect(
      (await post(med, '/nir/dpa', { internacao: i.internacao, data: '2020-01-01', anterior: null }))
        .statusCode,
    ).toBe(422);
    const d = await post(med, '/nir/dpa', { internacao: i.internacao, data: amanha, anterior: null });
    expect(d.statusCode, d.body).toBe(201);
    expect(
      (await post(med, '/nir/dpa', { internacao: i.internacao, data: amanha, anterior: null })).json().codigo,
    ).toBe('dpa-desatualizada');
    expect(
      (await post(med, '/nir/dpa', { internacao: i.internacao, data: amanha, anterior: d.json().id }))
        .statusCode,
    ).toBe(400);
    const b = await post(nirS, '/nir/barreiras', {
      internacao: i.internacao,
      tipo: 'exame',
      descricao: 'Tomografia de tórax agendada',
      responsavel: 'Imagem',
      prazo: amanha,
    });
    expect(b.statusCode, b.body).toBe(201);
    const q = (await get(nirS, '/nir/permanencia')).json();
    const naColuna = q.colunas.amarelo.find((x: { internacao: number }) => x.internacao === i.internacao);
    expect(naColuna).toMatchObject({ cor: 'amarelo', motivoCor: 'Alta prevista para amanhã.' });
    expect(naColuna.barreiras[0]).toMatchObject({ tipo: 'exame', situacao: 'aberta', vencida: false });
    expect(q.reuniao.altasAmanha).toContain(i.internacao);
    expect(q.reuniao.indicadores.map((x: { codigo: string }) => x.codigo)).toEqual([
      'nir.esperaMedia',
      'nir.dentroDoPrazo',
      'nir.vermelhos',
      'nir.altasPrevistasHoje',
    ]);
    // Dois dias depois, a DPA vencida vira vermelho (o relógio avança).
    avancoMin += 2 * 24 * 60;
    const q2 = (await get(nirS, '/nir/permanencia')).json();
    const v = q2.colunas.vermelho.find((x: { internacao: number }) => x.internacao === i.internacao);
    expect(v).toMatchObject({ cor: 'vermelho', motivoCor: 'Alta prevista vencida.' });
    expect(v.barreiras[0].vencida).toBe(true);
    expect(
      (await post(nirS, `/nir/barreiras/${b.json().id}/resolver`, { observacao: 'Exame feito' })).statusCode,
    ).toBe(200);
    expect((await post(nirS, `/nir/barreiras/${b.json().id}/resolver`, {})).json().codigo).toBe(
      'barreira-resolvida',
    );
    for (const ev of [
      'internacao.altaPrevista.alterada',
      'internacao.barreiraAlta.registrada',
      'internacao.barreiraAlta.resolvida',
    ])
      expect(trilha.eventos.some((x) => x.evento === ev)).toBe(true);
  });

  it('a calibragem com as duas réguas; o limite definido vale no quadro; o de-para aprovado perde a marca', async () => {
    const nirS = await entrar('SINT.INTERNACAO');
    const c = (await get(nirS, '/nir/permanencia/calibragem?escopo=clinica')).json();
    const m = c.linhas.find((x: { chave: string }) => x.chave === 'M');
    expect(m.portaria312.n).toBeGreaterThan(0);
    expect(m.diariasFaturaveis.p50).toBeGreaterThan(m.portaria312.p50);
    expect(m.proposta).not.toBeNull();
    const l = await post(nirS, '/nir/limites', {
      escopo: 'clinica',
      chave: 'M',
      amareloDias: 1,
      vermelhoDias: 2,
      origem: 'manual',
    });
    expect(l.statusCode).toBe(200);
    expect(
      (
        await post(nirS, '/nir/limites', {
          escopo: 'clinica',
          chave: 'M',
          amareloDias: 3,
          vermelhoDias: 2,
          origem: 'manual',
        })
      ).statusCode,
    ).toBe(400);
    const q = (await get(nirS, '/nir/permanencia')).json();
    const todos = [...q.colunas.verde, ...q.colunas.amarelo, ...q.colunas.vermelho];
    expect(
      todos
        .filter((x: { clinica: string; limite: { escopo: string } }) => x.clinica === 'M')
        .every((x: { limite: { escopo: string } }) => x.limite.escopo === 'clinica'),
    ).toBe(true);
    const s = (await get(nirS, '/nir/situacoes')).json();
    expect(s.itens).toHaveLength(23);
    expect(s.aConfirmar).toBe(6);
    expect((await post(nirS, '/nir/situacoes/4/aprovar', { estado: 'internado' })).statusCode).toBe(200);
    expect((await post(nirS, '/nir/situacoes/99/aprovar', { estado: 'internado' })).statusCode).toBe(404);
    const s2 = (await get(nirS, '/nir/situacoes')).json();
    expect(s2.aConfirmar).toBe(5);
    expect(s2.itens.find((x: { situacao: number }) => x.situacao === 4)).toMatchObject({
      estado: 'internado',
      aConfirmar: false,
    });
    const med = await entrar('SINT.MEDICO.NIR');
    expect(
      (
        await post(med, '/nir/limites', {
          escopo: 'clinica',
          chave: 'C',
          amareloDias: 3,
          vermelhoDias: 5,
          origem: 'manual',
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('NIR: correções da revisão (M44.2)', () => {
  it('o médico só com as opções do grupo dos médicos vê a fila, as origens com os tipos e as altas previstas', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    expect((await get(med, '/nir/fila')).statusCode).toBe(200);
    expect((await get(med, '/nir/altas-previstas')).statusCode).toBe(200);
    const o = (await get(med, '/nir/origens')).json() as {
      tiposAcomodacao: { codigo: number; nome: string }[];
    };
    expect(o.tiposAcomodacao.length).toBeGreaterThan(1);
    expect(new Set(o.tiposAcomodacao.map((x) => x.codigo)).size).toBe(o.tiposAcomodacao.length);
    // O médico não opera a fila nem reserva (sem o controle central de leitos).
    expect(
      (
        await post(med, '/nir/reservas', {
          solicitacao: 1,
          leito: { bloco: 'X', acomodacao: 'Y', leito: '1' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('o pedido com o tipo de leito: o leito de outro tipo sai incompatível com o motivo', async () => {
    const med = await entrar('SINT.MEDICO.NIR');
    const nirS = await entrar('SINT.INTERNACAO');
    const o0 = (await get(med, '/nir/origens')).json() as {
      tiposAcomodacao: { codigo: number; nome: string }[];
    };
    // M52.3 (correção do teste): pede a enfermaria, que não é o tipo dos apartamentos livres na massa sintética (a
    // primeira opção da lista, o apartamento, deixava todos os leitos livres de enfermaria ou UTI de fora do teste).
    const tipo = o0.tiposAcomodacao.find((x) => /enfermaria/i.test(x.nome)) ?? o0.tiposAcomodacao[0]!;
    const o = { tiposAcomodacao: [tipo] };
    const sem = (await get(nirS, '/nir/solicitacoes/0/leitos')).statusCode;
    expect(sem).toBe(404);
    const r = await post(
      med,
      '/nir/solicitacoes',
      pedido(1002, {
        perfil: { intensiva: false, precaucao: null, tiposAcomodacao: [o.tiposAcomodacao[0]!.codigo] },
      }),
    );
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    const f = await item(nirS, id);
    expect((f as unknown as { perfil: { tiposAcomodacao: number[] } }).perfil.tiposAcomodacao).toEqual([
      o.tiposAcomodacao[0]!.codigo,
    ]);
    const l = (await get(nirS, `/nir/solicitacoes/${id}/leitos`)).json() as {
      leitos: { compativel: boolean; motivo: string | null; intensiva: boolean }[];
    };
    expect(
      l.leitos.some(
        (x) =>
          !x.compativel &&
          x.motivo === 'O tipo de acomodação do leito não está entre os aceitos pelo pedido.',
      ),
    ).toBe(true);
    expect(
      (
        await post(nirS, `/nir/solicitacoes/${id}/transicoes`, {
          acao: 'cancelar',
          estadoVisto: 'solicitado',
          motivo: 'Pedido de teste sintético',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('a admissão do paciente B com a solicitação do paciente A é recusada; A segue com o leito reservado', async () => {
    const nirS = await entrar('SINT.INTERNACAO');
    const a = await item(nirS, (await fila(nirS)).itens.find((x) => x.paciente.id === 1005)!.id);
    expect(a?.estado).toBe('em_analise');
    const l = (await get(nirS, `/nir/solicitacoes/${a!.id}/leitos`)).json();
    const enf = l.leitos.find((x: { compativel: boolean }) => x.compativel);
    const r = await post(nirS, '/nir/reservas', { solicitacao: a!.id, leito: enf.leito });
    expect(r.statusCode, r.body).toBe(201);
    const adm = await post(nirS, '/internacoes', admissao(1007, enf.leito, { solicitacaoNir: a!.id }));
    expect(adm.statusCode, adm.body).toBe(409);
    expect(adm.json().codigo).toBe('solicitacao-de-outro-paciente');
    expect(await item(nirS, a!.id)).toMatchObject({ estado: 'reservado', reserva: { id: r.json().id } });
    const mapa = (await get(nirS, '/leitos/mapa')).json();
    expect(mapa.leitos.find((x: { chave: string }) => x.chave === enf.chave).situacao).toBe('reservado');
  });

  it('a solicitação a caminho com a reserva vencida ou cancelada volta à análise (nunca em trânsito sem leito)', async () => {
    const nirS = await entrar('SINT.INTERNACAO');
    const a = (await fila(nirS)).itens.find((x) => x.paciente.id === 1005)!;
    expect(a.estado).toBe('reservado');
    const t = await post(nirS, `/nir/solicitacoes/${a.id}/transicoes`, {
      acao: 'transito',
      estadoVisto: 'reservado',
    });
    expect(t.statusCode, t.body).toBe(200);
    avancoMin += 24 * 60;
    expect(await item(nirS, a.id)).toMatchObject({ estado: 'em_analise', reserva: null });
    const l = (await get(nirS, `/nir/solicitacoes/${a.id}/leitos`)).json();
    const enf = l.leitos.find((x: { compativel: boolean }) => x.compativel);
    const r = await post(nirS, '/nir/reservas', { solicitacao: a.id, leito: enf.leito });
    expect(r.statusCode, r.body).toBe(201);
    expect(
      (
        await post(nirS, `/nir/solicitacoes/${a.id}/transicoes`, {
          acao: 'transito',
          estadoVisto: 'reservado',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await post(nirS, `/nir/reservas/${r.json().id}/cancelar`, { motivo: 'Setor de destino recusou' }))
        .statusCode,
    ).toBe(200);
    expect(await item(nirS, a.id)).toMatchObject({ estado: 'em_analise', reserva: null });
  });
});
