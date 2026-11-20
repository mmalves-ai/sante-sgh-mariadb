// W0-05 (programa CRUD completo) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada
// conecta a banco): a triagem retificada pelo próprio autor (a anterior inativa e visível, a fila com a ativa) e
// estornada; outro autor recusado (403) e a versão inativa não se corrige de novo (409); a meta da EMTN alterada (nova
// versão) e encerrada; a parenteral informada na ficha com o volume lido do balanço hídrico, o percentual diário e
// acumulado e o alerta de meta não atingida; o acompanhamento com o volume informado retificado e o da checagem
// recusado; a avaliação farmacêutica da NPT, que não se edita (409); o adendo e o estorno do serviço social (o motivo
// sob sigilo para as demais categorias); a refeição do acompanhante alterada com o histórico. Cada ação com o evento na
// trilha e com o motivo obrigatório. Dados sintéticos.
import { EVENTOS_AUDITAVEIS as E } from '@sgh/contratos';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaNutricaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
// 25/10/2026 às 15:00 (local): ontem é 24/10 e anteontem 23/10.
const nutricao = new PortaNutricaoMemoria(() => new Date(2026, 9, 25, 15, 0, 0));
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, nutricao, vigia: null });
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
  expect(r.statusCode, r.body).toBe(201);
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
  'idempotency-key': `teste-w0-05-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const eventos = (codigo: string) => trilha.eventos.filter((l) => l.evento === codigo).length;

const NRS = {
  instrumento: 'nrs2002',
  imcAbaixoDe20e5: false,
  perdaDePeso3Meses: true,
  ingestaoReduzidaSemana: true,
  gravementeDoente: false,
  estadoNutricional: 2,
  gravidade: 1,
};
const MOTIVO = 'Lançado com o dado errado (teste sintético)';

describe('W0-05: correção, estorno e versões da nutrição e do serviço social', () => {
  let nutri: Sessao;
  let social: Sessao;
  let medico: Sessao;
  let farma: Sessao;
  let copa: Sessao;

  beforeAll(async () => {
    nutri = await entrar('SINT.NUTRI.CLINICA');
    social = await entrar('SINT.SOCIAL');
    medico = await entrar('SINT.MEDICO');
    farma = await entrar('SINT.FARMACEUTICO');
    copa = await entrar('SINT.COPA');
  });

  it('triagem: retificação pelo próprio autor (nova versão; a anterior inativa e visível), estorno e as recusas', async () => {
    const r = await post(nutri, '/nutricao/triagens', { internacao: 950_003, respostas: NRS });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    // Sem o motivo, a retificação é recusada (400); outro autor (403).
    const sem = await post(nutri, `/nutricao/triagens/${id}/retificar`, { respostas: NRS });
    expect(sem.statusCode).toBe(400);
    // A triagem de outra nutricionista (gravada direto na porta sintética) não é corrigida por esta sessão.
    const alheia = nutricao.triagensGravadas.find((x) => x.id === id)!;
    nutricao.triagensGravadas.unshift({ ...alheia, id: 9_999_001, por: 'SINT.OUTRA.NUTRI' });
    const outro = await post(nutri, '/nutricao/triagens/9999001/retificar', {
      respostas: NRS,
      motivo: MOTIVO,
    });
    expect(outro.statusCode, outro.body).toBe(403);
    expect(outro.json().codigo).toBe('correcao-de-outro-autor');
    nutricao.triagensGravadas.shift();
    const antes = eventos(E.nutricaoRegistroCorrigido.codigo);
    const ret = await post(nutri, `/nutricao/triagens/${id}/retificar`, {
      respostas: { ...NRS, estadoNutricional: 3 },
      motivo: MOTIVO,
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const novo = ret.json().idNovo as number;
    expect(eventos(E.nutricaoRegistroCorrigido.codigo)).toBe(antes + 1);
    const t = (await get(nutri, '/nutricao/internacoes/950003/triagens')).json().itens;
    expect(t.find((x: { id: number }) => x.id === novo)).toMatchObject({ situacao: 'ativo', substitui: id });
    expect(t.find((x: { id: number }) => x.id === id)).toMatchObject({
      situacao: 'retificado',
      correcao: { acao: 'retificacao', idNovo: novo, motivo: MOTIVO, por: 'SINT.NUTRI.CLINICA' },
    });
    // A versão inativa não se corrige de novo.
    const de = await post(nutri, `/nutricao/triagens/${id}/estornar`, { motivo: MOTIVO });
    expect(de.statusCode).toBe(409);
    expect(de.json().codigo).toBe('registro-ja-corrigido');
    // O estorno da versão ativa: a fila volta a pedir a triagem (nenhuma ativa).
    const est = await post(nutri, `/nutricao/triagens/${novo}/estornar`, { motivo: MOTIVO });
    expect(est.statusCode, est.body).toBe(200);
    const f = (await get(nutri, '/nutricao/fila')).json();
    expect(f.itens.find((i: { internacao: number }) => i.internacao === 950_003).ultima).toBeNull();
    const t2 = (await get(nutri, '/nutricao/internacoes/950003/triagens')).json().itens;
    expect(t2.map((x: { situacao: string }) => x.situacao).sort()).toEqual(['estornado', 'retificado']);
  });

  it('revisão: a retificação não adia a reavaliação (conta do dia da triagem original, também em cadeia)', async () => {
    const SEM_RISCO = {
      ...NRS,
      perdaDePeso3Meses: false,
      ingestaoReduzidaSemana: false,
      estadoNutricional: 0,
      gravidade: 0,
    };
    const r = await post(nutri, '/nutricao/triagens', { internacao: 950_002, respostas: SEM_RISCO });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    // A triagem foi feita em 20/10 (reavaliação em 27/10); a retificação de hoje (25/10) mantém o 27/10.
    const i = nutricao.triagensGravadas.findIndex((x) => x.id === id);
    nutricao.triagensGravadas[i] = {
      ...nutricao.triagensGravadas[i]!,
      em: '2026-10-20T10:00',
      reavaliarEm: '2026-10-27',
    };
    const ret = await post(nutri, `/nutricao/triagens/${id}/retificar`, {
      respostas: { ...SEM_RISCO, imcAbaixoDe20e5: false },
      motivo: MOTIVO,
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const v2 = ret.json().idNovo as number;
    let t = (await get(nutri, '/nutricao/internacoes/950002/triagens')).json().itens;
    expect(t.find((x: { id: number }) => x.id === v2).reavaliarEm).toBe('2026-10-27');
    // Retificar a retificação continua contando da original (20/10), nunca de hoje (que daria 01/11).
    const ret2 = await post(nutri, `/nutricao/triagens/${v2}/retificar`, {
      respostas: SEM_RISCO,
      motivo: MOTIVO,
    });
    expect(ret2.statusCode, ret2.body).toBe(201);
    t = (await get(nutri, '/nutricao/internacoes/950002/triagens')).json().itens;
    expect(t.find((x: { id: number }) => x.id === ret2.json().idNovo).reavaliarEm).toBe('2026-10-27');
  });

  it('EMTN: meta alterada (nova versão) e encerrada; o acompanhamento só na meta vigente', async () => {
    const base = { pesoKg: 70, kcalPorKg: 25, proteinaGPorKg: 1.5, densidadeKcalMl: 1.5, proteinaGL: 60 };
    const m = await post(nutri, '/nutricao/terapias/metas', {
      internacao: 950_004,
      via: 'enteral',
      itemDieta: 970_004,
      ...base,
    });
    expect(m.statusCode, m.body).toBe(201);
    const v1 = m.json().id as number;
    const a = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_004,
      meta: v1,
      data: '2026-10-24',
      motivo: 'progressao',
    });
    expect(a.statusCode, a.body).toBe(201);
    const alt = await post(nutri, `/nutricao/terapias/metas/${v1}/alterar`, {
      itemDieta: 970_004,
      ...base,
      kcalPorKg: 30,
      motivo: 'Aumento da necessidade calórica (teste sintético)',
    });
    expect(alt.statusCode, alt.body).toBe(201);
    const v2 = alt.json().idNovo as number;
    const velha = await post(nutri, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_004,
      meta: v1,
      data: '2026-10-25',
      volumeInformadoMl: 500,
      motivo: 'progressao',
    });
    expect(velha.statusCode).toBe(409);
    expect(velha.json().codigo).toBe('meta-inativa');
    const t = (await get(nutri, '/nutricao/terapias/950004')).json();
    expect(t.metas.find((x: { id: number }) => x.id === v1)).toMatchObject({
      situacao: 'substituida',
      correcao: { acao: 'nova-versao', idNovo: v2 },
    });
    expect(t.metas.find((x: { id: number }) => x.id === v2)).toMatchObject({
      situacao: 'vigente',
      substitui: v1,
      metaKcal: 2100,
    });
    // O dia já registrado continua na versão anterior (1750 kcal): 1000 mL da checagem = 1500 kcal = 85,7%.
    expect(t.progresso).toHaveLength(1);
    expect(t.progresso[0]).toMatchObject({
      data: '2026-10-24',
      kcalMeta: 1750,
      kcalAtingida: 1500,
      pctKcal: 85.7,
    });
    const enc = await post(nutri, `/nutricao/terapias/metas/${v2}/encerrar`, {
      motivo: 'Alta da terapia enteral',
    });
    expect(enc.statusCode, enc.body).toBe(200);
    expect(
      (await post(nutri, `/nutricao/terapias/metas/${v2}/encerrar`, { motivo: MOTIVO })).statusCode,
    ).toBe(409);
    const t2 = (await get(nutri, '/nutricao/terapias/950004')).json();
    expect(t2.metas.find((x: { id: number }) => x.id === v2).situacao).toBe('encerrada');
  });

  it('revisão: a enteral e a NPT complementar vigentes juntas somam no dia (as parcelas por via); uma meta vigente por via', async () => {
    const enteral = await post(nutri, '/nutricao/terapias/metas', {
      internacao: 950_002,
      via: 'enteral',
      itemDieta: null,
      pesoKg: 60,
      kcalPorKg: 25,
      proteinaGPorKg: 1,
      densidadeKcalMl: 1,
      proteinaGL: 40,
    });
    expect(enteral.statusCode, enteral.body).toBe(201);
    // Outra meta na mesma via enquanto há uma vigente: 409 (a nova versão é pelo "Alterar").
    const dupla = await post(nutri, '/nutricao/terapias/metas', {
      internacao: 950_002,
      via: 'enteral',
      itemDieta: null,
      pesoKg: 60,
      kcalPorKg: 30,
      proteinaGPorKg: 1,
      densidadeKcalMl: 1,
      proteinaGL: 40,
    });
    expect(dupla.statusCode).toBe(409);
    expect(dupla.json().codigo).toBe('meta-vigente-na-via');
    const npt = await post(nutri, '/nutricao/terapias/metas', {
      internacao: 950_002,
      via: 'parenteral',
      itemDieta: null,
      pesoKg: 60,
      kcalPorKg: 10,
      proteinaGPorKg: 0.5,
      densidadeKcalMl: 1,
      proteinaGL: 50,
    });
    expect(npt.statusCode, npt.body).toBe(201);
    // No mesmo dia: 1200 mL da enteral (1200 kcal) e 500 mL da NPT (500 kcal); em qualquer ordem, o dia soma as duas.
    for (const [meta, volume] of [
      [npt.json().id as number, 500],
      [enteral.json().id as number, 1200],
    ] as const) {
      const r = await post(nutri, '/nutricao/terapias/acompanhamentos', {
        internacao: 950_002,
        meta,
        data: '2026-10-24',
        volumeInformadoMl: volume,
        motivo: 'progressao',
      });
      expect(r.statusCode, r.body).toBe(201);
    }
    const t = (await get(nutri, '/nutricao/terapias/950002')).json();
    expect(t.progresso).toHaveLength(1);
    // (1200 + 500) kcal de (1500 + 600) = 81%; nenhuma via descartada.
    expect(t.progresso[0]).toMatchObject({
      data: '2026-10-24',
      kcalMeta: 2100,
      kcalAtingida: 1700,
      pctKcal: 81,
      acumuladoKcalMeta: 2100,
      acumuladoKcalAtingida: 1700,
    });
    expect(
      t.progresso[0].vias.map((v: { via: string; kcalAtingida: number }) => [v.via, v.kcalAtingida]),
    ).toEqual([
      ['enteral', 1200],
      ['parenteral', 500],
    ]);
  });

  it('EMTN: a parenteral informada lê o volume do balanço, o percentual diário e acumulado, o alerta e a avaliação da NPT', async () => {
    const m = await post(medico, '/nutricao/terapias/metas', {
      internacao: 950_005,
      via: 'parenteral',
      itemDieta: null,
      pesoKg: 40,
      kcalPorKg: 25,
      proteinaGPorKg: 1.5,
      densidadeKcalMl: 1,
      proteinaGL: 60,
    });
    expect(m.statusCode, m.body).toBe(201);
    const meta = m.json().id as number;
    // 24/10: 1400 mL do balanço = 1400 kcal de 1000 (140%); 23/10: 1000 mL = 100%. Sem digitação.
    for (const data of ['2026-10-23', '2026-10-24']) {
      const r = await post(medico, '/nutricao/terapias/acompanhamentos', { internacao: 950_005, meta, data });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().mensagem).toMatch(/volume (do balanço|da checagem|informado)/);
    }
    // 25/10: o balanço não tem a NPT; sem o informado, recusa; com o informado à mão (errado), grava como informado.
    const sem = await post(medico, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_005,
      meta,
      data: '2026-10-25',
    });
    expect(sem.json().codigo).toBe('volume-ausente');
    const inf = await post(medico, '/nutricao/terapias/acompanhamentos', {
      internacao: 950_005,
      meta,
      data: '2026-10-25',
      volumeInformadoMl: 100,
      motivo: 'intolerancia',
    });
    expect(inf.statusCode, inf.body).toBe(201);
    let t = (await get(medico, '/nutricao/terapias/950005')).json();
    expect(t.acompanhamentos.map((a: { origemVolume: string }) => a.origemVolume).sort()).toEqual([
      'balanco',
      'balanco',
      'informado',
    ]);
    expect(t.balanco).toEqual([
      { data: '2026-10-24', lancamentos: 2, volumeMl: 1400 },
      { data: '2026-10-23', lancamentos: 1, volumeMl: 1000 },
    ]);
    // Acumulado: (1000 + 1400 + 100) kcal de 3000 = 83,3%.
    expect(
      t.progresso.map((p: { data: string; pctKcal: number; acumuladoPctKcal: number }) => [
        p.data,
        p.pctKcal,
        p.acumuladoPctKcal,
      ]),
    ).toEqual([
      ['2026-10-23', 100, 100],
      ['2026-10-24', 140, 120],
      ['2026-10-25', 10, 83.3],
    ]);
    expect(t.alerta).toBeNull();
    // O volume informado errado: a retificação pelo próprio autor (nova versão); a da fonte é recusada.
    const errado = t.acompanhamentos.find((a: { origemVolume: string }) => a.origemVolume === 'informado').id;
    const doBalanco = t.acompanhamentos.find(
      (a: { origemVolume: string }) => a.origemVolume === 'balanco',
    ).id;
    const r1 = await post(medico, `/nutricao/terapias/acompanhamentos/${doBalanco}/retificar`, {
      volumeInformadoMl: 900,
      motivo: MOTIVO,
    });
    expect(r1.json().codigo).toBe('volume-nao-informado');
    const r2 = await post(medico, `/nutricao/terapias/acompanhamentos/${errado}/retificar`, {
      volumeInformadoMl: 1000,
      motivo: MOTIVO,
    });
    expect(r2.statusCode, r2.body).toBe(201);
    t = (await get(medico, '/nutricao/terapias/950005')).json();
    expect(t.acompanhamentos.find((a: { id: number }) => a.id === errado)).toMatchObject({
      situacao: 'retificado',
      volumeInfundidoMl: 100,
    });
    expect(t.progresso.at(-1)).toMatchObject({ data: '2026-10-25', pctKcal: 100, acumuladoPctKcal: 113.3 });
    // A avaliação farmacêutica da NPT: só o farmacêutico; periférico acima de 900 mOsm/L não é adequada.
    const npt = {
      parecer: 'adequada',
      acesso: 'central',
      osmolaridade: 1200,
      estabilidade: true,
      compatibilidade: true,
    };
    const doMedico = await post(medico, `/nutricao/terapias/metas/${meta}/avaliacao-npt`, npt);
    expect(doMedico.statusCode).toBe(403);
    expect(doMedico.json().codigo).toBe('categoria-nao-autorizada');
    const per = await post(farma, `/nutricao/terapias/metas/${meta}/avaliacao-npt`, {
      parecer: 'adequada',
      acesso: 'periferico',
      osmolaridade: 1200,
      estabilidade: true,
      compatibilidade: true,
    });
    expect(per.json().codigo, per.body).toBe('npt-osmolaridade-periferica');
    const ok = await post(farma, `/nutricao/terapias/metas/${meta}/avaliacao-npt`, {
      parecer: 'adequada',
      acesso: 'central',
      osmolaridade: 1200,
      estabilidade: true,
      compatibilidade: true,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(eventos(E.nptAvaliada.codigo)).toBe(1);
    // A avaliação registrada não se edita.
    const de = await post(farma, `/nutricao/terapias/metas/${meta}/avaliacao-npt`, {
      parecer: 'ajustar',
      acesso: 'central',
      osmolaridade: 1200,
      estabilidade: true,
      compatibilidade: true,
      observacao: 'Reduzir o cálcio',
    });
    expect(de.statusCode).toBe(409);
    expect(de.json().codigo).toBe('avaliacao-registrada');
    t = (await get(medico, '/nutricao/terapias/950005')).json();
    expect(t.metas[0].avaliacaoNpt).toMatchObject({
      parecer: 'adequada',
      acesso: 'central',
      osmolaridade: 1200,
    });
    expect(t.metas[0].origemTerapia).toBe('informada');
    expect(t.nptOrigem).toBe('ficha-emtn');
  });

  it('EMTN: o alerta de meta não atingida aparece com 3 dias seguidos abaixo do adequado', async () => {
    nutricao.balancos.set(960_001, [
      { data: '2026-10-23', lancamentos: 1, volumeMl: 300 },
      { data: '2026-10-24', lancamentos: 1, volumeMl: 300 },
      { data: '2026-10-25', lancamentos: 1, volumeMl: 300 },
    ]);
    const m = await post(medico, '/nutricao/terapias/metas', {
      internacao: 950_001,
      via: 'parenteral',
      itemDieta: null,
      pesoKg: 50,
      kcalPorKg: 20,
      proteinaGPorKg: 1,
      densidadeKcalMl: 1,
      proteinaGL: 50,
    });
    const meta = m.json().id as number;
    for (const data of ['2026-10-23', '2026-10-24', '2026-10-25'])
      expect(
        (
          await post(medico, '/nutricao/terapias/acompanhamentos', {
            internacao: 950_001,
            meta,
            data,
            motivo: 'intolerancia',
          })
        ).statusCode,
      ).toBe(201);
    const t = (await get(medico, '/nutricao/terapias/950001')).json();
    expect(t.alerta).toMatchObject({ dias: 3, desde: '2026-10-23', ate: '2026-10-25' });
    expect(t.alerta.mensagem).toMatch(/3 dias seguidos/);
  });

  it('serviço social: adendo (o original continua ativo) e estorno pelo próprio autor; o motivo sob sigilo', async () => {
    const r = await post(social, '/servico-social/registros', {
      internacao: 950_002,
      tipo: 'avaliacao',
      redeApoio: 'presente',
      risco: 'baixo',
      parecer: 'Parecer social sintético com o contexto familiar.',
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    expect(
      (await post(social, `/servico-social/registros/${id}/adendo`, { texto: 'Família visitou.' }))
        .statusCode,
    ).toBe(400);
    const ad = await post(social, `/servico-social/registros/${id}/adendo`, {
      texto: 'Contato com a filha confirmado.',
      motivo: 'Informação nova da família',
    });
    expect(ad.statusCode, ad.body).toBe(201);
    const est = await post(social, `/servico-social/registros/${id}/estornar`, {
      motivo: 'Registrado no paciente errado',
    });
    expect(est.statusCode, est.body).toBe(200);
    expect(eventos(E.avaliacaoSocialCorrigida.codigo)).toBe(2);
    const lido = (await get(social, '/servico-social/internacoes/950002')).json();
    expect(lido.registros.find((x: { id: number }) => x.id === id)).toMatchObject({
      situacao: 'estornado',
      correcao: { acao: 'estorno', motivo: 'Registrado no paciente errado' },
    });
    expect(lido.registros.find((x: { tipo: string }) => x.tipo === 'adendo')).toMatchObject({
      adendoDe: id,
      situacao: 'ativo',
      parecer: 'Contato com a filha confirmado.',
    });
    // As demais categorias com vínculo não leem o parecer, o adendo nem o motivo do estorno.
    const outro = (await get(medico, '/servico-social/internacoes/950002')).json();
    expect(JSON.stringify(outro)).not.toMatch(/filha|paciente errado/);
    // Do estornado não se faz adendo.
    const ad2 = await post(social, `/servico-social/registros/${id}/adendo`, {
      texto: 'Mais um dado.',
      motivo: MOTIVO,
    });
    expect(ad2.json().codigo).toBe('registro-ja-corrigido');
  });

  it('refeição do acompanhante: a dieta e as refeições mudam sem encerrar, com o valor anterior no histórico', async () => {
    const r = await post(copa, '/nutricao/acompanhantes', {
      internacao: 950_001,
      baseLegal: 'idoso',
      refeicoes: [1, 2],
      inicio: '2026-10-25',
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    expect((await post(copa, `/nutricao/acompanhantes/${id}/alterar`, { refeicoes: [1] })).statusCode).toBe(
      400,
    );
    const a = await post(copa, `/nutricao/acompanhantes/${id}/alterar`, {
      dieta: 'Hipossódica',
      refeicoes: [1, 2, 4],
      motivo: 'Acompanhante hipertenso pediu a dieta',
    });
    expect(a.statusCode, a.body).toBe(200);
    expect(eventos(E.dietaAcompanhanteAlterada.codigo)).toBe(1);
    const l = (await get(copa, '/nutricao/acompanhantes/950001')).json().itens[0];
    expect(l).toMatchObject({ situacao: 'ativa', dieta: 'Hipossódica', refeicoes: [1, 2, 4] });
    expect(l.historico[0]).toMatchObject({
      evento: 'alterada',
      antes: '{"dieta":null,"refeicoes":[1,2],"fim":null,"observacao":null}',
      depois: '{"dieta":"Hipossódica","refeicoes":[1,2,4],"fim":null,"observacao":null}',
      motivo: 'Acompanhante hipertenso pediu a dieta',
    });
    // Revisão: a observação também entra no antes e no depois; o anterior da segunda é o que a primeira gravou (relido
    // na transação, não o que a tela leu).
    const b2 = await post(copa, `/nutricao/acompanhantes/${id}/alterar`, {
      dieta: 'Hipossódica',
      refeicoes: [1, 2, 4],
      observacao: 'Sem lactose',
      motivo: 'Acompanhante intolerante à lactose',
    });
    expect(b2.statusCode, b2.body).toBe(200);
    const c3 = await post(copa, `/nutricao/acompanhantes/${id}/alterar`, {
      dieta: 'Geral',
      refeicoes: [1],
      motivo: 'Acompanhante voltou à dieta geral',
    });
    expect(c3.statusCode, c3.body).toBe(200);
    const h = (await get(copa, '/nutricao/acompanhantes/950001')).json().itens[0].historico;
    expect(h[1]).toMatchObject({
      antes: '{"dieta":"Hipossódica","refeicoes":[1,2,4],"fim":null,"observacao":null}',
      depois: '{"dieta":"Hipossódica","refeicoes":[1,2,4],"fim":null,"observacao":"Sem lactose"}',
    });
    // A observação não enviada continua a anterior (e o log diz isso).
    expect(h[0]).toMatchObject({
      antes: '{"dieta":"Hipossódica","refeicoes":[1,2,4],"fim":null,"observacao":"Sem lactose"}',
      depois: '{"dieta":"Geral","refeicoes":[1],"fim":null,"observacao":"Sem lactose"}',
    });
  });
});
