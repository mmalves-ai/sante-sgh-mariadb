// M45, etapa 2 (escores, classificação de pacientes e índices de UTI) pela HTTP, com a sessão real sobre a fonte
// sintética e as portas EM MEMÓRIA (nada conecta a banco): permissões pelas opções do perfil; a unidade com as
// reavaliações vencidas; a aferição com o NEWS2 7 (TRR) e a mudança de quadro programada; Braden com os cuidados
// preventivos decididos e a baixa da programada; CAM-ICU com RASS -4 recusado; a reavaliação programada, repetida e
// dispensada; as faixas publicadas com a senha; Fugulin só do enfermeiro, uma por turno, e a carga; APACHE II e SOFA
// registrados e validados só pelo médico com a senha; a SMR; a chave desligada recusa. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { REGRAS_PADRAO } from '@sgh/dominio-enfermagem';
import { CONFIGURACAO_INDICES_SINTETICA, categoriasDoTipo, comImpressao } from '@sgh/dominio-pep';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarAppComEnfermagem } from './app-enfermagem.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { PortaEscoresMemoria } from './escores-porta-memoria.js';
import { PortaEnfermagemMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-25 13:00 em São Paulo (turno diurno). */
const RELOGIO = '2026-10-25T16:00:00Z';
const agora = () => new Date(RELOGIO);

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { semChave?: boolean; trr?: string } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria({ agora });
  const escores = new PortaEscoresMemoria({ agora });
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'enfermagem.escores'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      })
    : o.trr
      ? fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: (hospital) => [
            ...parametrosIniciaisSinteticos(hospital),
            {
              id: 'teste-m45e2-trr',
              chave: 'enfermagem.news2.loginsTrr',
              nivel: 'estabelecimento',
              alvo: hospital,
              valor: o.trr!,
              vigenteDesde: '2026-10-01T00:00:00.000Z',
              vigenteAte: null,
              justificativa: 'Teste sintético do aviso do NEWS2',
              autor: 'SINT.ADMIN',
            },
          ],
        })
      : undefined;
  const app: NestFastifyApplication = await criarAppComEnfermagem(env, {
    trilha,
    enfermagem,
    escores,
    vigiaEnfermagem: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
    escores,
    async entrar(login: string): Promise<Sessao> {
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
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          'idempotency-key': `teste-m45e2-${++seq}-${Date.now()}`,
        },
        payload: payload as object,
      }),
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;
let a: Montado;
beforeAll(async () => {
  a = await montar();
});
afterAll(async () => {
  await a.app.close();
});

// Paciente UM da UTI sintética: paciente 25001, atendimento 25101, internação 25201.
const UM = { paciente: 25001, atendimento: 25101, reg: 25201, unidade: 'UTI' };
const NEWS2_7 = { fr: 26, spo2: 93, o2: 2, pas: 120, fc: 72, acvpu: 0, temperatura: 36.8 };
const BRADEN_ALTO = { percepcao: 2, umidade: 2, atividade: 1, mobilidade: 2, nutricao: 2, friccao: 1 };

describe('escores: permissões, unidade e aferição', () => {
  it('sem as opções, 403; a enfermeira vê a UTI com as reavaliações vencidas e as faixas vigentes', async () => {
    const agenda = await a.entrar('SINT.AGENDA');
    expect((await a.get(agenda, '/enfermagem/escores/unidade?unidade=UTI')).statusCode).toBe(403);
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.get(s, '/enfermagem/escores/unidade?unidade=UTI');
    expect(r.statusCode).toBe(200);
    const u = r.json();
    expect(u.pacientes).toHaveLength(3);
    expect(u.gravacao).toMatchObject({ ligada: true, registrar: true });
    // Internados há 30 h sem escore: Braden e Morse da admissão vencidos (o UM tem Braden em formulário de 30 h: diária).
    const um = u.pacientes.find((p: { paciente: number }) => p.paciente === 25001);
    expect(
      um.reavaliacoes.map((x: { escala: string; motivo: string }) => `${x.escala}:${x.motivo}`).sort(),
    ).toEqual(['braden:diaria', 'morse:admissao']);
    expect(u.resumo.vencidas).toBeGreaterThanOrEqual(6);
    // W0-03, M1: as 7 escalas do M45 e as 8 do mercado.
    expect(u.regras).toHaveLength(15);
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.escore.lido')).toBe(true);
    expect(JSON.stringify(u)).not.toMatch(/SPDATA|legado|sistema atual/i);
  });
  it('aferição com NEWS2 7: os 7 sinais e o escore numa gravação, TRR, Braden e Morse devidos (mudança de quadro)', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(s, '/enfermagem/escores/afericao', {
      ...UM,
      sinais: NEWS2_7,
      confirmadoForaDaFaixa: true,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ total: 7, faixa: 'alto', gatilho: 'trr' });
    expect(r.json().conduta).toMatch(/Time de Resposta Rápida/);
    expect(r.json().avisos.join(' ')).toMatch(/Braden e Morse ficaram devidos/);
    expect(r.json().avisos.join(' ')).toMatch(/telefone da unidade/);
    const st = a.escores.estado('aa');
    expect(st.sinais).toBe(7);
    expect(st.escores.at(-1)).toMatchObject({
      escala: 'news2',
      total: 7,
      origem: 'afericao',
      gatilho: 'trr',
    });
    expect(st.reavaliacoes.filter((x) => x.motivo === 'mudanca-quadro')).toHaveLength(2);
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.escore.registrado')).toBe(true);
    const u = (await a.get(s, '/enfermagem/escores/unidade?unidade=UTI')).json();
    expect(u.pacientes.find((p: { paciente: number }) => p.paciente === 25001).gatilhoAberto).toBe('trr');
    expect(u.resumo.news2Alto).toBe(1);
  });
  it('sinal fora da faixa sem a confirmação e paciente de outro atendimento são recusados', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const fora = await a.post(s, '/enfermagem/escores/afericao', { ...UM, sinais: NEWS2_7 });
    expect(fora.statusCode).toBe(422);
    expect(fora.json().codigo).toBe('sinal-confirmar');
    const outro = await a.post(s, '/enfermagem/escores/afericao', {
      ...UM,
      paciente: 25002,
      sinais: { ...NEWS2_7, fr: 16, spo2: 98, o2: 0 },
    });
    expect(outro.statusCode).toBe(404);
  });
});

describe('NEWS2 a cada aferição pela tela dos sinais vitais (M25)', () => {
  it('os sete parâmetros registrados juntos geram o NEWS2 com a origem no primeiro sinal; incompleta, não', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const corpo = (sinais: Record<string, number>) => ({
      sinais: Object.entries(sinais).map(([tipo, valor]) => ({
        atendimento: 25102,
        tipo,
        valor,
        metodo: null,
        confirmadoForaDaFaixa: true,
      })),
    });
    const antes = a.escores.estado('aa').escores.length;
    const r = await a.post(
      s,
      '/enfermagem/pacientes/25002/sinais-vitais',
      corpo({ ...NEWS2_7, fc: 115, fr: 22, spo2: 97, o2: 0 }),
    );
    expect(r.statusCode).toBe(201);
    expect(r.json().news2).toMatchObject({ total: 4, gatilho: 'nenhum', rotuloFaixa: expect.any(String) });
    expect(r.json().news2.conduta).toEqual(expect.any(String));
    expect(r.json().news2.avisos).toEqual([]);
    expect(a.escores.estado('aa').escores.length).toBe(antes + 1);
    expect(a.escores.estado('aa').escores.at(-1)).toMatchObject({
      paciente: 25002,
      escala: 'news2',
      origem: 'afericao',
    });
    const parcial = await a.post(s, '/enfermagem/pacientes/25002/sinais-vitais', corpo({ fc: 80, fr: 16 }));
    expect(parcial.json().news2).toBeNull();
    const semInternacao = await a.post(s, '/enfermagem/pacientes/25002/sinais-vitais', {
      sinais: corpo(NEWS2_7).sinais.map((x) => ({ ...x, atendimento: null })),
    });
    expect(semInternacao.json().news2.motivo).toMatch(/internação/);
  });
});

describe('aviso do NEWS2 na central (regra 1)', () => {
  it('com o TRR configurado, o NEWS2 7 avisa o login do TRR com o link que abre o paciente; a tela dos sinais mostra a conduta', async () => {
    const b = await montar({ trr: 'SINT.MEDICO.UTI' });
    try {
      const s = await b.entrar('SINT.ENF.PLANTAO');
      const r = await b.post(s, '/enfermagem/escores/afericao', {
        ...UM,
        sinais: NEWS2_7,
        confirmadoForaDaFaixa: true,
      });
      expect(r.statusCode).toBe(201);
      expect(r.json().avisos.join(' ')).not.toMatch(/telefone da unidade/);
      const avisos = b.escores.estado('aa').avisos;
      expect(avisos).toEqual([
        {
          login: 'SINT.MEDICO.UTI',
          evento: 'enfermagem.escore.registrado',
          objeto: String(r.json().id),
          link: `/enfermagem/escores?atendimento=${UM.atendimento}`,
          gravidade: 'grave',
        },
      ]);
      // O link abre o paciente: a tela lê o atendimento da consulta, e a API o resolve.
      expect((await b.get(s, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).statusCode).toBe(200);
      // Pela tela dos sinais vitais (M25): a conduta e os avisos voltam na resposta.
      const sv = await b.post(s, '/enfermagem/pacientes/25002/sinais-vitais', {
        sinais: Object.entries(NEWS2_7).map(([tipo, valor]) => ({
          atendimento: 25102,
          tipo,
          valor,
          metodo: null,
          confirmadoForaDaFaixa: true,
        })),
      });
      expect(sv.statusCode).toBe(201);
      expect(sv.json().news2).toMatchObject({ total: 7, gatilho: 'trr', faixa: 'alto' });
      expect(sv.json().news2.conduta).toMatch(/Time de Resposta Rápida/);
      expect(sv.json().news2.avisos.join(' ')).toMatch(/Braden e Morse ficaram devidos/);
      expect(b.escores.estado('aa').avisos.at(-1)).toMatchObject({
        login: 'SINT.MEDICO.UTI',
        link: '/enfermagem/escores?atendimento=25102',
      });
    } finally {
      await b.app.close();
    }
  });
});

describe('escalas da tela, reavaliação e faixas', () => {
  it('cuidados preventivos: só o enfermeiro decide (D-CUIDADO-45); o técnico registra o escore sem as decisões', async () => {
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const u = (await a.get(tec, '/enfermagem/escores/unidade?unidade=UTI')).json();
    expect(u.gravacao).toMatchObject({ registrar: true, decidirCuidados: false });
    const recusa = await a.post(tec, '/enfermagem/escores', {
      ...UM,
      escala: 'braden',
      itens: BRADEN_ALTO,
      cuidados: [{ codigo: 'mudancaDecubito', decisao: 'recusado', motivo: 'Paciente dormindo agora' }],
    });
    expect(recusa.statusCode).toBe(403);
    expect(recusa.json().codigo).toBe('so-enfermeiro');
    const antes = a.escores.estado('aa').cuidados.length;
    const ok = await a.post(tec, '/enfermagem/escores', { ...UM, escala: 'braden', itens: BRADEN_ALTO });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ total: 10, gatilho: 'prevencao' });
    expect(ok.json().avisos.join(' ')).toMatch(/ficam para o enfermeiro/);
    expect(a.escores.estado('aa').cuidados.length).toBe(antes);
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.get(enf, '/enfermagem/escores/unidade?unidade=UTI')).json().gravacao).toMatchObject({
      decidirCuidados: true,
    });
  });

  it('Braden em risco exige a decisão de cada cuidado; registrado, cumpre a programada', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const sem = await a.post(s, '/enfermagem/escores', { ...UM, escala: 'braden', itens: BRADEN_ALTO });
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe('cuidado-sem-decisao');
    const cuidados = [
      { codigo: 'mudancaDecubito', decisao: 'aceito' },
      { codigo: 'superficieRedistribuicao', decisao: 'aceito' },
      { codigo: 'hidratacaoPele', decisao: 'recusado', motivo: 'Pele íntegra e hidratada no banho' },
      { codigo: 'protecaoProeminencias', decisao: 'aceito' },
      { codigo: 'avaliacaoNutricional', decisao: 'aceito' },
    ];
    const ok = await a.post(s, '/enfermagem/escores', {
      ...UM,
      escala: 'braden',
      itens: BRADEN_ALTO,
      cuidados,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ total: 10, faixa: 'alto', gatilho: 'prevencao' });
    expect(ok.json().avisos[0]).toMatch(/Hidratação da pele/);
    const st = a.escores.estado('aa');
    expect(st.cuidados.filter((c) => c.escore === ok.json().id)).toHaveLength(5);
    expect(
      st.reavaliacoes.find((x) => x.escala === 'braden' && x.motivo === 'mudanca-quadro')?.situacao,
    ).toBe('cumprida');
    // O total digitado não vale: a recusa do item fora das opções (regra 15).
    const nunca = await a.post(s, '/enfermagem/escores', {
      ...UM,
      escala: 'morse',
      itens: { historiaQueda: 10 },
    });
    expect(nunca.json().codigo).toBe('item-faltando');
  });
  it('CAM-ICU com RASS -4 não se avalia; com RASS 0, delirium', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    expect(
      (await a.post(s, '/enfermagem/escores', { ...UM, escala: 'rass', itens: { rass: -4 } })).statusCode,
    ).toBe(201);
    const cam = { inicioAgudo: 1, desatencao: 1, consciencia: 1, pensamento: 0 };
    const r = await a.post(s, '/enfermagem/escores', { ...UM, escala: 'camicu', itens: cam });
    expect(r.json().codigo).toBe('avaliacao-impossivel');
    expect(
      (await a.post(s, '/enfermagem/escores', { ...UM, escala: 'rass', itens: { rass: 0 } })).statusCode,
    ).toBe(201);
    const ok = await a.post(s, '/enfermagem/escores', { ...UM, escala: 'camicu', itens: cam });
    expect(ok.json()).toMatchObject({ total: 1, faixa: 'positivo', gatilho: 'avisar-medico' });
  });
  it('a reavaliação programada à mão; a repetida no mesmo minuto é recusada; a dispensa com o motivo, uma vez', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const corpo = { ...UM, escala: 'morse', motivo: 'admissao', observacao: 'Transferida de outra unidade' };
    const r = await a.post(s, '/enfermagem/escores/reavaliacoes', corpo);
    expect(r.statusCode).toBe(201);
    expect((await a.post(s, '/enfermagem/escores/reavaliacoes', corpo)).json().codigo).toBe('ja-programada');
    const d = await a.post(s, `/enfermagem/escores/reavaliacoes/${r.json().id}/dispensar`, {
      motivo: 'Avaliada no formulário do prontuário',
    });
    expect(d.statusCode).toBe(200);
    const de = await a.post(s, `/enfermagem/escores/reavaliacoes/${r.json().id}/dispensar`, {
      motivo: 'Avaliada no formulário do prontuário',
    });
    expect(de.json().codigo).toBe('reavaliacao-encerrada');
    const p = (await a.get(s, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).json();
    expect(p.formularios).toEqual([
      expect.objectContaining({ modelo: 'ENF021', escala: 'braden', total: 14 }),
    ]);
    expect(p.historico.length).toBeGreaterThanOrEqual(4);
  });
  it('as faixas: a nova versão com a senha (crítica); igual à vigente é recusada; a vigente passa a valer', async () => {
    const adm = await a.entrar('SINT.ADMIN');
    const faixas = [
      { codigo: 'baixo', rotulo: 'Risco baixo', minimo: 0, maximo: 29, risco: false },
      { codigo: 'moderado', rotulo: 'Risco moderado', minimo: 30, maximo: 49, risco: true },
      { codigo: 'alto', rotulo: 'Risco alto', minimo: 50, maximo: 125, risco: true },
    ];
    const notas = 'Faixas aprovadas pela gerência de enfermagem (sintético)';
    expect(
      (await a.post(adm, '/enfermagem/escores/regras', { escala: 'morse', faixas, notas })).statusCode,
    ).toBe(400);
    const igual = await a.post(adm, '/enfermagem/escores/regras', {
      escala: 'morse',
      faixas: REGRAS_PADRAO.morse.faixas,
      notas,
      senha: SENHA,
    });
    expect(igual.json().codigo).toBe('sem-mudanca');
    const buraco = await a.post(adm, '/enfermagem/escores/regras', {
      escala: 'morse',
      faixas: [faixas[0], { ...faixas[2], minimo: 40 }],
      notas,
      senha: SENHA,
    });
    expect(buraco.json().codigo).toBe('faixas-invalidas');
    const r = await a.post(adm, '/enfermagem/escores/regras', {
      escala: 'morse',
      faixas,
      notas,
      senha: SENHA,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ versao: 2 });
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const rg = (await a.get(s, '/enfermagem/escores/regras')).json();
    expect(rg.vigentes.find((x: { escala: string }) => x.escala === 'morse').versao).toBe(2);
    expect(rg.historicas[0]).toMatchObject({ escala: 'braden', historica: true });
    const m = await a.post(s, '/enfermagem/escores', {
      ...UM,
      escala: 'morse',
      itens: {
        historiaQueda: 25,
        diagnosticoSecundario: 0,
        auxilioDeambulacao: 0,
        terapiaEndovenosa: 0,
        marcha: 0,
        estadoMental: 0,
      },
    });
    expect(m.json()).toMatchObject({ total: 25, faixa: 'baixo', gatilho: 'nenhum' });
    expect(a.trilha.eventos.some((e) => e.evento === 'enfermagem.regraEscore.publicada')).toBe(true);
  });
});

describe('classificação de pacientes', () => {
  const FUGULIN = {
    estadoMental: 2,
    oxigenacao: 2,
    sinaisVitais: 2,
    motilidade: 2,
    deambulacao: 2,
    alimentacao: 2,
    cuidadoCorporal: 2,
    eliminacao: 2,
    terapeutica: 2,
    integridadeCutanea: 2,
    curativo: 2,
    tempoCurativo: 2,
  };
  it('Fugulin do enfermeiro, uma por turno; o técnico não classifica; a carga com as parcelas', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const base = { ...UM, data: '2026-10-25', turno: 'diurno', instrumento: 'fugulin', itens: FUGULIN };
    const r = await a.post(s, '/enfermagem/classificacao', base);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ total: 24, categoria: 'altaDependencia', horas24h: 10 });
    expect((await a.post(s, '/enfermagem/classificacao', base)).json().codigo).toBe('ja-classificado');
    const nas = await a.post(s, '/enfermagem/classificacao', {
      ...base,
      instrumento: 'nas',
      itens: { '1': '1b', '4': '4a', '17': 'sim' },
    });
    expect(nas.json()).toMatchObject({ total: 23.2 });
    const tec = await a.entrar('SINT.TECNICO.ENF');
    const t = await a.post(tec, '/enfermagem/classificacao', {
      ...base,
      paciente: 25002,
      atendimento: 25102,
      reg: 25202,
    });
    expect(t.statusCode).toBe(403);
    expect(t.json().codigo).toBe('so-enfermeiro');
    const futuro = await a.post(s, '/enfermagem/classificacao', { ...base, data: '2026-10-26' });
    expect(futuro.json().codigo).toBe('turno-fora');
    const c = (await a.get(s, '/enfermagem/classificacao?unidade=UTI')).json();
    expect(c).toMatchObject({ data: '2026-10-25', turno: 'diurno' });
    expect(
      c.carga.fugulin.porCategoria.find((x: { codigo: string }) => x.codigo === 'altaDependencia'),
    ).toMatchObject({
      pacientes: 1,
      horas: 10,
    });
    expect(c.carga.nas).toMatchObject({ pacientes: 1, soma: 23.2 });
    expect(c.carga.naoClassificados).toBe(2);
    expect(c.gravacao.registrar).toBe(true);
  });
});

describe('índices de UTI', () => {
  it('APACHE II e SOFA registrados pela configuração; só o médico valida, com a senha; a SMR com as parcelas', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    expect((await a.get(enf, `/pep/uti/indices/${UM.atendimento}`)).statusCode).toBe(403);
    const med = await a.entrar('SINT.MEDICO.UTI');
    const d = (await a.get(med, `/pep/uti/indices/${UM.atendimento}`)).json();
    expect(d.configuracao.variaveis).toHaveLength(109);
    expect(d.configuracao.impressao).toBe((await comImpressao(CONFIGURACAO_INDICES_SINTETICA)).impressao);
    expect(d.gravacao).toMatchObject({ ligada: true, registrar: true, validar: true });
    expect(d.saps3.motivo).toMatch(/DP-20/);
    const sepse = categoriasDoTipo(d.configuracao, 'nao-cirurgico').find((c) => c.nome === 'Sepse')!;
    const r = await a.post(med, '/pep/uti/indices', {
      ...UM,
      indice: 'apache2',
      coletadoEm: '2026-10-25T08:00',
      variaveis: {
        TEMP: 39.2,
        PAM: 65,
        FC: 125,
        FR: 28,
        FIO2: 0.4,
        PAO2: 68,
        PH: 7.3,
        NASERICO: 138,
        KSERICO: 3.2,
        CREATININA: 1.8,
        HEMATOCRITO: 32,
        LEUCOCITO: 18000,
      },
      glasgow: { ocular: 3, verbal: 8, motora: 15 },
      apache: {
        idade: 67,
        tipoAdmissao: 'nao-cirurgico',
        categoria: sepse.id,
        insuficienciaCronica: false,
        falhaRenalAguda: false,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ pontuacao: 22 });
    expect(r.json().mortalidade).toBeCloseTo(0.4521, 3);
    const sofa = await a.post(med, '/pep/uti/indices', {
      ...UM,
      indice: 'sofa',
      coletadoEm: '2026-10-25T08:00',
      variaveis: {
        PAO2: 80,
        FIO2: 0.5,
        PLAQUETAS: 90,
        BILIRRUBINA: 2.5,
        PAM: 65,
        EPI_NORA: 0.2,
        CREATININA: 3.6,
        DEBURINARIO: 400,
      },
      glasgow: { ocular: 17, verbal: 22, motora: 27 },
    });
    expect(sofa.json()).toMatchObject({ pontuacao: 16 });
    const semApache = await a.post(med, '/pep/uti/indices', {
      ...UM,
      indice: 'apache2',
      coletadoEm: '2026-10-25T08:00',
      variaveis: {},
      glasgow: { ocular: 3, verbal: 8, motora: 15 },
    });
    expect(semApache.statusCode).toBe(400);
    // A enfermeira não valida (sem a permissão); o médico valida com a senha, uma vez.
    expect((await a.post(enf, `/pep/uti/indices/${r.json().id}/validar`, { senha: SENHA })).statusCode).toBe(
      403,
    );
    expect(
      (await a.post(med, `/pep/uti/indices/${r.json().id}/validar`, { senha: 'errada' })).statusCode,
    ).toBe(401);
    expect((await a.post(med, `/pep/uti/indices/${r.json().id}/validar`, { senha: SENHA })).statusCode).toBe(
      200,
    );
    expect(
      (await a.post(med, `/pep/uti/indices/${r.json().id}/validar`, { senha: SENHA })).json().codigo,
    ).toBe('ja-validado');
    const lista = (await a.get(med, `/pep/uti/indices/${UM.atendimento}`)).json();
    expect(
      lista.indices.map((x: { indice: string; situacao: string }) => `${x.indice}:${x.situacao}`).sort(),
    ).toEqual(['apache2:validado', 'sofa:registrado']);
    const smr = (await a.get(med, '/pep/uti/smr?de=2026-10-01&ate=2026-10-31')).json();
    expect(smr).toMatchObject({ indices: 1, comDesfecho: 0, semDesfecho: 1, smr: null });
    expect((await a.get(med, '/pep/uti/smr?de=2026-10-31&ate=2026-10-01')).statusCode).toBe(400);
    const pac = (await a.get(med, '/pep/uti/pacientes?unidade=UTI')).json();
    expect(pac.pacientes.find((p: { paciente: number }) => p.paciente === 25001)).toMatchObject({
      apache2: { pontuacao: 22, situacao: 'validado' },
      sofa: { pontuacao: 16 },
    });
    expect(a.trilha.eventos.some((e) => e.evento === 'pep.indiceUti.validado')).toBe(true);
  });
});

describe('chave desligada (POL-3)', () => {
  it('a tela fica em consulta com o motivo; a gravação responde 403 recurso-desligado', async () => {
    const b = await montar({ semChave: true });
    try {
      const s = await b.entrar('SINT.ENF.PLANTAO');
      const u = (await b.get(s, '/enfermagem/escores/unidade?unidade=UTI')).json();
      expect(u.gravacao).toMatchObject({ ligada: false, registrar: false });
      expect(u.gravacao.motivo).toMatch(/Funcionalidades por estabelecimento/);
      const r = await b.post(s, '/enfermagem/escores', { ...UM, escala: 'rass', itens: { rass: 0 } });
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await b.app.close();
    }
  });
});
