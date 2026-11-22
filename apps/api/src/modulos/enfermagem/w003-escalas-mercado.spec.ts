// W0-03, mercado M1 (critério de aceite 9): as escalas novas pela API — o total sempre calculado, a versão da regra
// gravada com o escore, o estorno desde o nascimento, a escala de TEV conferida com o perfil pelo parâmetro (Padua no
// clínico e Caprini no cirúrgico) e a profilaxia sugerida como pendência visível ao prescritor, que decide (prescrita,
// ou não prescrita com o motivo). Porta em memória; dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

async function montar(o: { semChave?: boolean; trr?: string; medico?: string } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const enfermagem = new PortaEnfermagemMemoria({ agora });
  const escores = new PortaEscoresMemoria({ agora });
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'enfermagem.escores'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      })
    : o.trr || o.medico
      ? fonteConfiguracaoMemoria(trilha, {
          chavesIniciais: chavesIniciaisSinteticas,
          prerequisitosIniciais: prerequisitosIniciaisSinteticos,
          parametrosIniciais: (hospital) => [
            ...parametrosIniciaisSinteticos(hospital),
            {
              id: 'teste-w003-medico',
              chave: 'enfermagem.news2.loginsMedico',
              nivel: 'estabelecimento',
              alvo: hospital,
              valor: o.medico ?? '',
              vigenteDesde: '2026-10-01T00:00:00.000Z',
              vigenteAte: null,
              justificativa: 'Teste sintético do aviso da profilaxia de TEV',
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
  a = await montar({ medico: 'SINT.MEDICO' });
});
afterAll(async () => {
  await a.app.close();
});

const UM = { paciente: 25001, atendimento: 25101, reg: 25201, unidade: 'UTI' };
/** Padua: câncer ativo (3) e 70 anos ou mais (1) = 4, alto risco (Barbar et al., 2010). */
const PADUA_4 = {
  cancer: 3,
  tevPrev: 0,
  mobilidade: 0,
  trombof: 0,
  trauma1m: 0,
  idade70: 1,
  icResp: 0,
  iamAvc: 0,
  infecReum: 0,
  obesidade: 0,
  hormonio: 0,
};

describe('W0-03, M1: escalas novas pela API', () => {
  it('PEWS: o total é calculado no servidor, a versão da regra vai com o escore e o estorno vale desde o nascimento', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(s, '/enfermagem/escores', {
      ...UM,
      escala: 'pews',
      itens: { comport: 1, cardio: 1, resp: 1, nebul: 2, vomito: 0 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ total: 5, faixa: 'alto', gatilho: 'trr' });
    const id = r.json().id as number;
    const gravado = a.escores.estado('aa').escores.find((x) => x.id === id)!;
    expect(gravado).toMatchObject({ escala: 'pews', versaoRegra: 1, total: 5 });
    // Peso fora da publicação: recusado (valor nunca visto).
    const fora = await a.post(s, '/enfermagem/escores', {
      ...UM,
      escala: 'pews',
      itens: { comport: 1, cardio: 1, resp: 1, nebul: 1, vomito: 0 },
    });
    expect(fora.statusCode).toBe(422);
    const e = await a.post(s, `/enfermagem/escores/${id}/estornar`, {
      motivo: 'escala lançada no paciente errado',
    });
    expect(e.statusCode).toBe(200);
    const h = (await a.get(s, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).json();
    expect(h.historico.find((x: { id: number }) => x.id === id).estorno).toMatchObject({ tipo: 'estorno' });
  });

  it('escala de TEV: perfil obrigatório e conferido com o parâmetro (Padua no clínico)', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const sem = await a.post(s, '/enfermagem/escores', { ...UM, escala: 'padua', itens: PADUA_4 });
    expect(sem.statusCode).toBe(400);
    const errada = await a.post(s, '/enfermagem/escores', {
      ...UM,
      escala: 'padua',
      perfilTev: 'cirurgico',
      itens: PADUA_4,
    });
    expect(errada.statusCode).toBe(422);
    expect(errada.json().codigo).toBe('escala-tev-do-perfil');
    expect(errada.json().detail).toMatch(/Caprini/);
  });

  it('Padua em risco: pendência visível ao prescritor (tela e central de avisos), decidida uma vez; o estorno a retira', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(enf, '/enfermagem/escores', {
      ...UM,
      escala: 'padua',
      perfilTev: 'clinico',
      itens: PADUA_4,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ total: 4, faixa: 'alto', gatilho: 'profilaxia' });
    expect(r.json().avisos.join(' ')).toMatch(/pendente ao prescritor/);
    const id = r.json().id as number;
    // O aviso na central foi para o prescritor do parâmetro.
    expect(
      a.escores.estado('aa').avisos.some((x) => x.login === 'SINT.MEDICO' && x.objeto === String(id)),
    ).toBe(true);
    // A tela do paciente e a da unidade mostram a pendência.
    const pac = (await a.get(enf, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).json();
    expect(pac.profilaxia).toMatchObject({ escore: id, escala: 'padua', decisao: null });
    expect(pac.profilaxia.sugestao).toMatch(/farmacológica/);
    // O prescritor vê a lista da unidade e decide; a enfermagem não decide.
    const med = await a.entrar('SINT.MEDICO');
    const tela = (await a.get(med, '/enfermagem/escores/unidade?unidade=UTI')).json();
    expect(tela.gravacao.decidirProfilaxia).toBe(true);
    expect(tela.profilaxiasPendentes.map((x: { escore: number }) => x.escore)).toContain(id);
    const lista = await a.get(med, '/enfermagem/escores/profilaxia?unidade=UTI');
    expect(lista.statusCode).toBe(200);
    expect(lista.json().pendentes.map((x: { escore: number }) => x.escore)).toContain(id);
    expect(lista.json().decidir).toBe(true);
    // Revisão W0-03: a tela própria do prescritor escolhe a unidade pela mesma leitura (sem a unidade, só a lista).
    expect(lista.json().unidades.map((x: { unidade: string }) => x.unidade)).toContain('UTI');
    const soUnidades = (await a.get(med, '/enfermagem/escores/profilaxia')).json();
    expect(soUnidades).toMatchObject({ unidade: null, pendentes: [], decidir: true });
    expect(soUnidades.unidades.length).toBeGreaterThan(0);
    expect(
      (await a.post(enf, `/enfermagem/escores/${id}/profilaxia`, { decisao: 'prescrita' })).statusCode,
    ).toBe(403);
    const semMotivo = await a.post(med, `/enfermagem/escores/${id}/profilaxia`, { decisao: 'nao-prescrita' });
    expect(semMotivo.statusCode).toBe(400);
    const d = await a.post(med, `/enfermagem/escores/${id}/profilaxia`, {
      decisao: 'nao-prescrita',
      motivo: 'plaquetopenia com risco alto de sangramento',
    });
    expect(d.statusCode).toBe(201);
    expect(
      (await a.post(med, `/enfermagem/escores/${id}/profilaxia`, { decisao: 'prescrita' })).statusCode,
    ).toBe(409);
    const depois = (await a.get(med, '/enfermagem/escores/profilaxia?unidade=UTI')).json();
    expect(depois.pendentes.some((x: { escore: number }) => x.escore === id)).toBe(false);
    const pac2 = (await a.get(enf, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).json();
    expect(pac2.profilaxia.decisao).toMatchObject({ decisao: 'nao-prescrita', usuario: 'SINT.MEDICO' });
    expect(a.trilha.eventos.some((t) => t.evento === 'enfermagem.profilaxiaTev.decidida')).toBe(true);
    expect(JSON.stringify(a.trilha.eventos)).not.toMatch(/plaquetopenia/);

    // Um escore novo em risco gera nova pendência; o estorno dele a retira (desde o nascimento).
    const r2 = await a.post(enf, '/enfermagem/escores', {
      ...UM,
      escala: 'padua',
      perfilTev: 'clinico',
      itens: { ...PADUA_4, mobilidade: 3 },
    });
    const id2 = r2.json().id as number;
    expect(
      (await a.get(med, '/enfermagem/escores/profilaxia?unidade=UTI'))
        .json()
        .pendentes.map((x: { escore: number }) => x.escore),
    ).toContain(id2);
    await a.post(enf, `/enfermagem/escores/${id2}/estornar`, { motivo: 'itens marcados no paciente errado' });
    const fim = (await a.get(med, '/enfermagem/escores/profilaxia?unidade=UTI')).json();
    expect(fim.pendentes.some((x: { escore: number }) => x.escore === id2)).toBe(false);
    // O estornado não se decide.
    expect(
      (await a.post(med, `/enfermagem/escores/${id2}/profilaxia`, { decisao: 'prescrita' })).statusCode,
    ).toBe(409);
  });

  it('revisão W0-03: a decisão de profilaxia se corrige pelo autor (fato novo); a anulação reabre a pendência', async () => {
    const enf = await a.entrar('SINT.ENF.PLANTAO');
    const med = await a.entrar('SINT.MEDICO');
    const r = await a.post(enf, '/enfermagem/escores', {
      ...UM,
      escala: 'padua',
      perfilTev: 'clinico',
      itens: { ...PADUA_4, mobilidade: 3 },
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as number;
    // "Prescrita" marcada por engano: a pendência some.
    expect(
      (await a.post(med, `/enfermagem/escores/${id}/profilaxia`, { decisao: 'prescrita' })).statusCode,
    ).toBe(201);
    const pendentes = async () =>
      (await a.get(med, '/enfermagem/escores/profilaxia?unidade=UTI'))
        .json()
        .pendentes.filter((x: { escore: number; decisao: unknown }) => x.escore === id && x.decisao === null);
    expect(await pendentes()).toHaveLength(0);
    const J = 'Marcada prescrita por engano: a profilaxia não foi feita';
    // A enfermagem não corrige (não é do prescritor); sem justificativa, 400.
    expect(
      (
        await a.post(enf, `/enfermagem/escores/${id}/profilaxia/retificar`, {
          decisao: 'anulada',
          justificativa: J,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await a.post(med, `/enfermagem/escores/${id}/profilaxia/retificar`, { decisao: 'anulada' }))
        .statusCode,
    ).toBe(400);
    const anul = await a.post(med, `/enfermagem/escores/${id}/profilaxia/retificar`, {
      decisao: 'anulada',
      justificativa: J,
    });
    expect(anul.statusCode, anul.body).toBe(201);
    // A pendência volta à lista do prescritor; o histórico mostra a original e a anulação.
    const [p] = await pendentes();
    expect(p).toBeDefined();
    expect(p.historico.map((h: { decisao: string }) => h.decisao)).toEqual(['prescrita', 'anulada']);
    expect(p.historico[1]).toMatchObject({ justificativa: J, usuario: 'SINT.MEDICO' });
    // A nova decisão depois da anulação; e a correção da não prescrita pelo autor.
    const nova = await a.post(med, `/enfermagem/escores/${id}/profilaxia`, {
      decisao: 'nao-prescrita',
      motivo: 'sangramento digestivo ativo nesta internação',
    });
    expect(nova.statusCode, nova.body).toBe(201);
    expect(await pendentes()).toHaveLength(0);
    const sem = await a.post(med, `/enfermagem/escores/${id}/profilaxia/retificar`, {
      decisao: 'nao-prescrita',
      motivo: 'sangramento digestivo ativo nesta internação',
      justificativa: 'Mesma decisão, só para testar',
    });
    expect(sem.json().codigo).toBe('sem-mudanca');
    expect(a.trilha.eventos.some((t) => t.evento === 'enfermagem.profilaxiaTev.decidida')).toBe(true);
    expect(JSON.stringify(a.trilha.eventos)).not.toMatch(/sangramento digestivo/);
  });
});
