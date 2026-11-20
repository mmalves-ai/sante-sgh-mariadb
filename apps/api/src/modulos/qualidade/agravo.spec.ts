// API da notificação compulsória (M48, etapa 4) sobre a porta em memória (dados SINTÉTICOS): a fila de gatilhos por CID,
// resultado reagente e óbito; o caso com o prazo da periodicidade; a ficha SINAN pré-preenchida; a notificação e o
// descarte com a versão; os gatilhos de exame; a chave de liberação, as permissões e a trilha sem nome nem CID.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import { AGRAVO_SINTETICO as S, PortaAgravoMemoria } from './porta-agravo-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-27 12:00 em São Paulo. */
const agora = () => new Date('2026-10-27T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { semChave?: boolean } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'qualidade.agravos'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const porta = new PortaAgravoMemoria({ agora });
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    agravo: porta,
    vigiaEnfermagem: null,
    vigia: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    trilha,
    porta,
    async entrar(login: string): Promise<Sessao> {
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
    },
    get: (s: Sessao, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } }),
    post: (s: Sessao, url: string, payload: unknown = {}) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf },
        payload: payload as object,
      }),
  };
}

type App = Awaited<ReturnType<typeof montar>>;
let a: App;
let ve: Sessao;
beforeAll(async () => {
  a = await montar();
  ve = await a.entrar('SINT.VIGILANCIA');
});
afterAll(async () => {
  await a.app.close();
});

const R = '/qualidade/vigilancia/agravos';
const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;
interface Gatilho {
  chave: string;
  origem: string;
  atendimento: number;
  exame: number | null;
  paciente: { id: number; nome: string };
  cid: string;
  periodicidade: string;
  gatilhoEm: string;
  prazoEm: string;
  estadoPrazo: string;
}
const abrirDe = (g: Gatilho) => ({
  origem: g.origem,
  exame: g.exame,
  atendimento: g.atendimento,
  paciente: g.paciente.id,
  cid: g.cid,
  gatilhoEm: g.gatilhoEm.slice(0, 16),
  observacao: null,
});

describe('fila de gatilhos', () => {
  it('CID notificável, óbito (imediato, absorve o CID do atendimento) e VDRL reagente; IgG da dengue não', async () => {
    const r = await a.get(ve, `${R}/gatilhos`);
    expect(r.statusCode, r.body).toBe(200);
    const f = r.json() as { itens: Gatilho[]; cortada: boolean; desde: string };
    expect(f.cortada).toBe(false);
    expect(f.desde).toBe('2026-10-20T00:00:00');
    expect(f.itens.map((g) => [g.chave, g.periodicidade, g.estadoPrazo])).toEqual([
      ['cid:948002:A820', 'imediata', 'noPrazo'],
      ['obito:948004:A90', 'imediata', 'noPrazo'],
      ['cid:948001:A90', 'semanal', 'noPrazo'],
      ['exame:9480001:A539', 'semanal', 'noPrazo'],
    ]);
    // Raiva: entrada às 09:00 de 27/10 + 24 h.
    expect(f.itens[0]).toMatchObject({ gatilhoEm: '2026-10-27T09:00:00', prazoEm: '2026-10-28T09:00:00' });
    expect(f.itens[0]?.paciente.nome).toBe('PACIENTE SINTETICO RAIVA');
    const so = (await a.get(ve, `${R}/gatilhos?origem=exame`)).json() as { itens: Gatilho[] };
    expect(so.itens.map((g) => g.chave)).toEqual(['exame:9480001:A539']);
    expect((await a.get(ve, `${R}/gatilhos?dias=31`)).statusCode).toBe(400);
  });

  it('lista nacional e gatilhos de exame padrão', async () => {
    const c = (await a.get(ve, `${R}/cids?busca=raiva`)).json() as {
      itens: { cid: string; periodicidade: string }[];
    };
    expect(c.itens).toEqual([{ cid: 'A820', nome: 'RAIVA SILVESTRE', periodicidade: 'imediata' }]);
    const g = (await a.get(ve, `${R}/gatilhos-exame`)).json() as {
      itens: { fonte: string; padrao: string }[];
    };
    expect(g.itens.every((x) => x.fonte === 'padrao')).toBe(true);
    expect(g.itens.map((x) => x.padrao)).toContain('VDRL');
  });

  it('sem o perfil da vigilância nem a opção do prontuário, 403; a CCIH lê', async () => {
    const enf = await a.entrar('SINT.ENFERMEIRO');
    expect((await a.get(enf, `${R}/gatilhos`)).statusCode).toBe(403);
    const ccih = await a.entrar('SINT.CCIH');
    expect((await a.get(ccih, `${R}/resumo`)).statusCode).toBe(200);
  });

  it('a vigilância busca o paciente do caso sem sugestão (Pesquisa de pacientes, D-BUSCA-48.4)', async () => {
    const r = await a.get(ve, '/cadastros/pacientes?termo=PACIENTE%20SINT&tipo=auto');
    expect(r.statusCode, r.body).toBe(200);
  });

  it('a porta em memória completa os pacientes pelo cadastro sintético quando o recebe (D-BUSCA-48.4)', async () => {
    const extra = {
      id: 1001,
      nome: 'PACIENTE SINTETICO CADASTRO',
      prontuario: 1001,
      nascimento: null,
      sexo: null,
      mae: null,
      cns: null,
    } as const;
    const p = new PortaAgravoMemoria({
      agora,
      cadastro: (_c, ids) => Promise.resolve(ids.includes(1001) ? [extra] : []),
    });
    const ctx = { rede: 'sintetica', hospital: 'pc' };
    const m = await p.pacientes(ctx, [S.pacienteRaiva, 1001, 7]);
    expect([...m.keys()].sort()).toEqual([1001, S.pacienteRaiva].sort());
    expect((await new PortaAgravoMemoria({ agora }).pacientes(ctx, [1001])).size).toBe(0);
  });
});

describe('caso de agravo', () => {
  let fila: Gatilho[];
  beforeAll(async () => {
    fila = ((await a.get(ve, `${R}/gatilhos`)).json() as { itens: Gatilho[] }).itens;
  });
  const gat = (chave: string) => {
    const g = fila.find((x) => x.chave === chave);
    if (!g) throw new Error(`sem o gatilho ${chave}`);
    return g;
  };

  it('abre pelo gatilho do CID com o prazo semanal; o mesmo de novo é recusado; a fila não o repete', async () => {
    const r = await a.post(ve, `${R}/casos`, abrirDe(gat('cid:948001:A90')));
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ periodicidade: 'semanal', prazoEm: '2026-11-02T10:00:00' });
    const de_novo = await a.post(ve, `${R}/casos`, abrirDe(gat('cid:948001:A90')));
    expect(de_novo.statusCode).toBe(409);
    expect(codigo(de_novo)).toBe('caso-ja-aberto');
    const f = (await a.get(ve, `${R}/gatilhos`)).json() as { itens: Gatilho[] };
    expect(f.itens.map((g) => g.chave)).not.toContain('cid:948001:A90');
    const resumo = (await a.get(ve, `${R}/resumo`)).json();
    expect(resumo).toMatchObject({
      abertos: 1,
      imediatosAbertos: 0,
      vencidos: 0,
      notificadosNoMes: 0,
      gatilhosSemCaso: 3,
      ligada: true,
      motivo: null,
      podeNotificar: true,
    });
    expect(resumo.agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('recusas da abertura: paciente de outro atendimento, CID fora do atendimento, CID inexistente, futuro', async () => {
    const g = gat('cid:948002:A820');
    const outro = await a.post(ve, `${R}/casos`, { ...abrirDe(g), paciente: S.pacienteDengue });
    expect(codigo(outro)).toBe('atendimento-de-outro-paciente');
    const semCid = await a.post(ve, `${R}/casos`, { ...abrirDe(g), cid: 'A90' });
    expect(codigo(semCid)).toBe('gatilho-nao-confirmado');
    const inexistente = await a.post(ve, `${R}/casos`, {
      ...abrirDe(g),
      origem: 'manual',
      atendimento: null,
      cid: 'Z999',
      observacao: 'Suspeita sintética de agravo.',
    });
    expect(codigo(inexistente)).toBe('cid-inexistente');
    const futuro = await a.post(ve, `${R}/casos`, { ...abrirDe(g), gatilhoEm: '2026-10-27T13:00' });
    expect(codigo(futuro)).toBe('gatilho-futuro');
    const exameDeOutro = await a.post(ve, `${R}/casos`, {
      ...abrirDe(gat('exame:9480001:A539')),
      paciente: S.pacienteRaiva,
      atendimento: S.atendimentoRaiva,
    });
    expect(codigo(exameDeOutro)).toBe('exame-de-outro-paciente');
  });

  it('óbito vira caso imediato; o VDRL abre com a ficha individual genérica (sífilis adquirida sem ficha própria)', async () => {
    const o = await a.post(ve, `${R}/casos`, abrirDe(gat('obito:948004:A90')));
    expect(o.statusCode, o.body).toBe(201);
    expect(o.json()).toMatchObject({ periodicidade: 'imediata', prazoEm: '2026-10-28T10:00:00' });
    const v = await a.post(ve, `${R}/casos`, abrirDe(gat('exame:9480001:A539')));
    expect(v.statusCode, v.body).toBe(201);
    const ficha = (await a.get(ve, `${R}/casos/${String((v.json() as { id: number }).id)}/ficha`)).json() as {
      modelo: { nome: string };
      generica: boolean;
    };
    expect(ficha).toMatchObject({ modelo: { nome: 'Padrão/Individual' }, generica: true });
  });

  it('a ficha da dengue vem do modelo A90/A92 com a identificação preenchida', async () => {
    const lista = (await a.get(ve, `${R}/casos?situacao=aberto`)).json() as {
      itens: { id: number; cid: string; origem: string }[];
      total: number;
    };
    expect(lista.total).toBe(3);
    const dengue = lista.itens.find((x) => x.origem === 'cid');
    const f = (await a.get(ve, `${R}/casos/${String(dengue?.id)}/ficha`)).json() as {
      modelo: { nome: string };
      perguntas: { texto: string; valor: string | null }[];
      preenchidas: number;
      generica: boolean;
    };
    expect(f.modelo.nome).toBe('A90/A92');
    expect(f.generica).toBe(false);
    const v = (t: string) => f.perguntas.find((p) => p.texto === t)?.valor;
    expect(v('Nome do paciente')).toBe('PACIENTE SINTETICO DENGUE');
    expect(v('Data de nascimento')).toBe('01/05/1990');
    expect(v('Código (CID10)')).toBe('A90');
    expect(v('Data da notificação')).toBe('27/10/2026');
    expect(v('U.F.')).toBe('RJ');
    expect(v('Sexo')).toBe('F - Feminino');
    expect(f.preenchidas).toBe(11);
  });

  it('notifica com o número pelo canal e a versão; o encerrado não volta; o descarte exige a justificativa', async () => {
    const lista = (await a.get(ve, `${R}/casos?situacao=aberto&periodicidade=imediata`)).json() as {
      itens: { id: number; versao: number; estadoPrazo: string; horasRestantes: number }[];
    };
    const [x] = lista.itens;
    expect(x).toMatchObject({ versao: 1, estadoPrazo: 'noPrazo', horasRestantes: 22 });
    const base = {
      versao: 1,
      autoridade: 'SMS',
      canal: 'sinanOnline',
      numero: null,
      notificadoEm: '2026-10-27T11:30',
      recebidoPor: null,
      observacao: null,
    };
    const semNumero = await a.post(ve, `${R}/casos/${String(x?.id)}/notificacao`, base);
    expect(semNumero.statusCode).toBe(400);
    const ok = await a.post(ve, `${R}/casos/${String(x?.id)}/notificacao`, { ...base, numero: '1234567' });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toEqual({ versao: 2, comAtraso: false });
    const de_novo = await a.post(ve, `${R}/casos/${String(x?.id)}/notificacao`, {
      ...base,
      numero: '1234567',
    });
    expect(codigo(de_novo)).toBe('versao-desatualizada');
    const c = (await a.get(ve, `${R}/casos/${String(x?.id)}`)).json();
    expect(c).toMatchObject({
      situacao: 'notificado',
      estadoPrazo: 'cumprido',
      numero: '1234567',
      autoridade: 'SMS',
    });
    const aberto = (await a.get(ve, `${R}/casos?situacao=aberto`)).json() as { itens: { id: number }[] };
    const alvo = aberto.itens[0]?.id;
    expect(
      (
        await a.post(ve, `${R}/casos/${String(alvo)}/descarte`, {
          versao: 1,
          motivo: 'outro',
          justificativa: 'x',
        })
      ).statusCode,
    ).toBe(400);
    const d = await a.post(ve, `${R}/casos/${String(alvo)}/descarte`, {
      versao: 1,
      motivo: 'jaNotificado',
      justificativa: 'Notificado pela unidade de origem (sintético).',
    });
    expect(d.statusCode, d.body).toBe(201);
    const resumo = (await a.get(ve, `${R}/resumo`)).json() as { abertos: number; notificadosNoMes: number };
    expect(resumo).toMatchObject({ abertos: 1, notificadosNoMes: 1 });
  });

  it('a trilha tem os eventos com o ID da linha SGH_, sem nome nem CID', () => {
    const linhas = a.trilha.eventos.filter((l) => l.evento.startsWith('qualidade.agravo.'));
    const eventos = new Set(linhas.map((l) => l.evento));
    for (const e of [
      'qualidade.agravo.casoAberto',
      'qualidade.agravo.notificado',
      'qualidade.agravo.descartado',
    ])
      expect(eventos.has(e)).toBe(true);
    const texto = JSON.stringify(linhas);
    expect(texto).not.toContain('PACIENTE SINTETICO');
    expect(texto).not.toContain('A820');
  });
});

describe('gatilhos de exame e a chave', () => {
  it('a configuração substitui a lista padrão; duplicado e versão velha recusados', async () => {
    const g = { gatilho: null, versao: null, padrao: 'Dengue', exceto: 'IGG', cid: 'A90', ativo: true };
    const r = await a.post(ve, `${R}/gatilhos-exame`, g);
    expect(r.statusCode, r.body).toBe(201);
    const { id } = r.json() as { id: number };
    expect(codigo(await a.post(ve, `${R}/gatilhos-exame`, g))).toBe('gatilho-duplicado');
    expect(codigo(await a.post(ve, `${R}/gatilhos-exame`, { ...g, gatilho: id, versao: 5 }))).toBe(
      'versao-desatualizada',
    );
    expect(codigo(await a.post(ve, `${R}/gatilhos-exame`, { ...g, cid: 'Z999' }))).toBe('cid-inexistente');
    const lista = (await a.get(ve, `${R}/gatilhos-exame`)).json() as { itens: { fonte: string }[] };
    expect(lista.itens).toEqual([expect.objectContaining({ fonte: 'configurado', padrao: 'Dengue' })]);
    // Sem o VDRL na configuração, o resultado reagente dele não é mais gatilho (o caso já aberto continua).
    const f = (await a.get(ve, `${R}/gatilhos?origem=exame`)).json() as { itens: unknown[] };
    expect(f.itens).toEqual([]);
  });

  it('com a chave desligada a fila é lida, mas nada é gravado', async () => {
    const b = await montar({ semChave: true });
    try {
      const s = await b.entrar('SINT.VIGILANCIA');
      const f = (await b.get(s, `${R}/gatilhos`)).json() as { itens: Gatilho[] };
      expect(f.itens.length).toBe(4);
      const r = await b.post(s, `${R}/casos`, abrirDe(f.itens[0] as Gatilho));
      expect(r.statusCode).toBe(403);
      expect(codigo(r)).toBe('recurso-desligado');
      expect((await b.get(s, `${R}/resumo`)).json()).toMatchObject({ ligada: false, podeNotificar: false });
    } finally {
      await b.app.close();
    }
  });
});
