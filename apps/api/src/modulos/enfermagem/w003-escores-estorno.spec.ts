// W0-03 (programa CRUD completo; "teste do serviço de escores"): o escore estornado aparece inativo e visível no
// histórico e na exportação, com o motivo; o alerta NEWS2 que ele disparou é reavaliado (encerrado ou mantido); a
// classificação estornada sai da carga e se relança no mesmo turno; o índice de UTI estornado fica inativo. Nada se
// apaga (o original continua na porta). Porta em memória; dados sintéticos.
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

const UM = { paciente: 25001, atendimento: 25101, reg: 25201, unidade: 'UTI' };
const NEWS2_7 = { fr: 26, spo2: 93, o2: 2, pas: 120, fc: 72, acvpu: 0, temperatura: 36.8 };
const NEWS2_5 = { fr: 22, spo2: 95, o2: 0, pas: 110, fc: 95, acvpu: 0, temperatura: 38.5 };
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

describe('W0-03: estorno do escore e reavaliação do alerta NEWS2', () => {
  it('o único NEWS2 com gatilho estornado: alerta encerrado; o escore fica inativo e visível no histórico e na exportação', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const r = await a.post(s, '/enfermagem/escores/afericao', {
      ...UM,
      sinais: NEWS2_7,
      confirmadoForaDaFaixa: true,
    });
    expect(r.json()).toMatchObject({ gatilho: 'trr' });
    const id = r.json().id as number;
    const antes = (await a.get(s, '/enfermagem/escores/unidade?unidade=UTI')).json();
    expect(antes.pacientes.find((p: { paciente: number }) => p.paciente === 25001).gatilhoAberto).toBe('trr');
    expect((await a.post(s, `/enfermagem/escores/${id}/estornar`, { motivo: 'curto' })).statusCode).toBe(400);
    const e = await a.post(s, `/enfermagem/escores/${id}/estornar`, {
      motivo: 'frequência respiratória digitada errada',
    });
    expect(e.statusCode).toBe(200);
    expect(e.json()).toMatchObject({ alerta: 'encerrado', escoreMantem: null });
    expect(e.json().mensagem).toMatch(/alerta do NEWS2 foi encerrado/);
    const depois = (await a.get(s, '/enfermagem/escores/unidade?unidade=UTI')).json();
    expect(depois.pacientes.find((p: { paciente: number }) => p.paciente === 25001).gatilhoAberto).toBeNull();
    const h = (await a.get(s, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).json();
    const x = h.historico.find((y: { id: number }) => y.id === id);
    expect(x.estorno).toMatchObject({
      tipo: 'estorno',
      motivo: 'frequência respiratória digitada errada',
      alerta: 'encerrado',
    });
    expect(h.ultimos.some((y: { id: number }) => y.id === id)).toBe(false);
    const csv = (await a.get(s, `/enfermagem/escores/atendimentos/${UM.atendimento}/exportar`)).json()
      .csv as string;
    expect(csv).toContain(`"${id}";"news2"`);
    expect(csv).toMatch(/"estornado";"frequência respiratória digitada errada";"SINT.ENF.PLANTAO"/);
    // Nada se apaga: o escore continua na porta; o segundo estorno é recusado.
    expect(a.escores.estado('aa').escores.some((y) => y.id === id)).toBe(true);
    const de2 = await a.post(s, `/enfermagem/escores/${id}/estornar`, { motivo: 'de novo, por engano' });
    expect(de2.statusCode).toBe(409);
    expect(a.trilha.eventos.some((t) => t.evento === 'enfermagem.registro.estornado')).toBe(true);
    expect(JSON.stringify(a.trilha.eventos)).not.toMatch(/digitada errada/);
  });

  it('revisão: o Braden estornado reabre a reavaliação que cumpria (pendente de novo, ou cumprida pelo Braden válido seguinte); a baixa original fica', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const SEM_RISCO = { percepcao: 4, umidade: 4, atividade: 4, mobilidade: 4, nutricao: 4, friccao: 3 };
    const p = await a.post(s, '/enfermagem/escores/reavaliacoes', {
      ...UM,
      escala: 'braden',
      motivo: 'admissao',
      observacao: 'Revisão do estorno',
    });
    expect(p.statusCode).toBe(201);
    const programada = p.json().id as number;
    const braden = async () => {
      const r = await a.post(s, '/enfermagem/escores', { ...UM, escala: 'braden', itens: SEM_RISCO });
      expect(r.statusCode).toBe(201);
      return r.json().id as number;
    };
    const reavs = () =>
      a.escores.estado('aa').reavaliacoes.filter((x) => x.paciente === UM.paciente && x.escala === 'braden');
    const b1 = await braden();
    expect(reavs().find((x) => x.id === programada)).toMatchObject({ situacao: 'cumprida', escore: b1 });
    // (O NEWS2 dos testes anteriores programou a reavaliação de mudança de quadro, que o mesmo Braden também cumpre.)
    const porB1 = reavs().filter((x) => x.situacao === 'cumprida' && x.escore === b1).length;
    expect(porB1).toBeGreaterThanOrEqual(1);
    const e1 = await a.post(s, `/enfermagem/escores/${b1}/estornar`, {
      motivo: 'lançado no paciente errado',
    });
    expect(e1.statusCode).toBe(200);
    expect(e1.json().vinculados).toMatchObject({ reavaliacoes: porB1 });
    expect(e1.json().mensagem).toMatch(new RegExp(`cumpria ${porB1} reavaliação`));
    // A baixa original não muda; a linha nova volta às pendentes, com a chave sufixada.
    expect(reavs().find((x) => x.id === programada)).toMatchObject({ situacao: 'cumprida', escore: b1 });
    const reaberta = reavs().find((x) => x.chave.endsWith(`:r${programada}`))!;
    expect(reaberta).toMatchObject({ situacao: 'pendente', escore: null });
    const u = (await a.get(s, `/enfermagem/escores/atendimentos/${UM.atendimento}`)).json();
    expect(JSON.stringify(u)).toContain(`"id":${reaberta.id}`);
    // O Braden seguinte cumpre a reaberta; com outro Braden válido depois, o estorno a deixa cumprida por ele.
    const b2 = await braden();
    expect(reavs().find((x) => x.id === reaberta.id)).toMatchObject({ situacao: 'cumprida', escore: b2 });
    const b3 = await braden();
    const porB2 = reavs().filter((x) => x.situacao === 'cumprida' && x.escore === b2).length;
    const e2 = await a.post(s, `/enfermagem/escores/${b2}/estornar`, { motivo: 'itens de outro paciente' });
    expect(e2.json().vinculados).toMatchObject({ reavaliacoes: porB2 });
    expect(reavs().find((x) => x.chave.endsWith(`:r${reaberta.id}`))).toMatchObject({
      situacao: 'cumprida',
      escore: b3,
    });
    expect(a.trilha.eventos.some((t) => t.evento === 'enfermagem.registro.estornado')).toBe(true);
    // Estornado também o Braden que a cumpria por último, sem outro válido depois: pendente de novo.
    const porB3 = reavs().find((x) => x.chave.endsWith(`:r${reaberta.id}`))!;
    const e3 = await a.post(s, `/enfermagem/escores/${b3}/estornar`, { motivo: 'itens de outro paciente' });
    expect(e3.json().vinculados).toMatchObject({ reavaliacoes: porB2 });
    expect(reavs().find((x) => x.chave.endsWith(`:r${porB3.id}`))).toMatchObject({ situacao: 'pendente' });
  });

  it('outro NEWS2 válido com gatilho nas 12 h: o alerta é mantido por ele', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const primeiro = await a.post(s, '/enfermagem/escores/afericao', {
      ...UM,
      sinais: NEWS2_5,
      confirmadoForaDaFaixa: true,
    });
    expect(primeiro.json().gatilho).not.toBe('nenhum');
    const segundo = await a.post(s, '/enfermagem/escores/afericao', {
      ...UM,
      sinais: NEWS2_7,
      confirmadoForaDaFaixa: true,
    });
    const e = await a.post(s, `/enfermagem/escores/${segundo.json().id}/estornar`, {
      tipo: 'invalidacao',
      motivo: 'aferição lançada no paciente errado',
    });
    expect(e.json()).toMatchObject({ alerta: 'mantido', escoreMantem: primeiro.json().id });
    const u = (await a.get(s, '/enfermagem/escores/unidade?unidade=UTI')).json();
    expect(u.pacientes.find((p: { paciente: number }) => p.paciente === 25001).gatilhoAberto).toBe(
      primeiro.json().gatilho,
    );
  });
});

describe('W0-03: estorno da classificação e do índice de UTI', () => {
  it('a classificação estornada sai da carga, fica visível e se relança no mesmo turno', async () => {
    const s = await a.entrar('SINT.ENF.PLANTAO');
    const base = { ...UM, data: '2026-10-25', turno: 'diurno', instrumento: 'fugulin', itens: FUGULIN };
    const r = await a.post(s, '/enfermagem/classificacao', base);
    expect(r.statusCode).toBe(201);
    expect((await a.post(s, '/enfermagem/classificacao', base)).json().codigo).toBe('ja-classificado');
    const e = await a.post(s, `/enfermagem/classificacao/${r.json().id}/estornar`, {
      motivo: 'itens marcados no paciente errado',
    });
    expect(e.statusCode).toBe(200);
    const k = (await a.get(s, '/enfermagem/classificacao?unidade=UTI&data=2026-10-25&turno=diurno')).json();
    const um = k.pacientes.find((p: { paciente: number }) => p.paciente === 25001);
    expect(um.classificacoes[0].estorno.motivo).toBe('itens marcados no paciente errado');
    expect(k.carga.naoClassificados).toBe(3);
    const de2 = await a.post(s, '/enfermagem/classificacao', base);
    expect(de2.statusCode).toBe(201);
  });

  it('o índice de UTI estornado fica inativo e visível', async () => {
    const med = await a.entrar('SINT.MEDICO.UTI');
    const sofa = await a.post(med, '/pep/uti/indices', {
      ...UM,
      indice: 'sofa',
      coletadoEm: '2026-10-25T09:00',
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
    expect(sofa.statusCode).toBe(201);
    const e = await a.post(med, `/pep/uti/indices/${sofa.json().id}/estornar`, {
      motivo: 'plaquetas de outro exame',
    });
    expect(e.statusCode).toBe(200);
    const d = (await a.get(med, `/pep/uti/indices/${UM.atendimento}`)).json();
    const x = d.indices.find((i: { id: number }) => i.id === sofa.json().id);
    expect(x.estorno).toMatchObject({ tipo: 'estorno', motivo: 'plaquetas de outro exame' });
    // Revisão: o índice estornado não recebe a validação médica (a tela antiga ou a API direta).
    const v = await a.post(med, `/pep/uti/indices/${sofa.json().id}/validar`, { senha: SENHA });
    expect(v.statusCode).toBe(409);
    expect(v.json().codigo).toBe('indice-estornado');
    expect(a.trilha.eventos.some((t) => t.evento === 'pep.indiceUti.validado')).toBe(false);
  });
});
