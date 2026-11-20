// Notificação de incidentes pela HTTP (M48, etapa 1; regras 1, 2, 3 e 11), com a sessão real sobre a fonte sintética e
// a porta EM MEMÓRIA (nada conecta a banco; dados sintéticos): qualquer pessoa notifica (identificada ou anônima), com
// o contexto relido pelo atendimento; o reenvio pela chave devolve o mesmo número e o mesmo código; a anônima não deixa
// o login em lugar nenhum (detalhe, linha do tempo, trilha); o acompanhamento pelo número e código, com o limite de
// tentativas; o NSP lista, tria (reclassificar exige justificativa; a versão velha é recusada), descarta, distribui,
// devolve e transcreve no Notivisa; a fila de prazos com o óbito em 72 h; os campos do Notivisa só com as iniciais; a
// chave desligada deixa tudo em consulta.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, REDE, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/configuracao-fonte.js';
import {
  CONTAS_PLATAFORMA_SINTETICAS,
  RepositorioPlataformaMemoria,
  SENHA_PLATAFORMA_SINTETICA,
} from '../suporte/repositorio.js';
import { ATENDIMENTO_SINTETICO_NOTIFICACAO, PortaQualidadeMemoria } from './porta-memoria.js';
import { codigoAcompanhamento, codigoConfere, resumoSha256 } from './servico.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-22 13:00 em São Paulo. */
const agora = () => new Date('2026-10-22T16:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}

async function montar(o: { semChave?: boolean } = {}) {
  const trilha = new RegistradorTrilhaMemoria();
  const configuracao = o.semChave
    ? fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => chavesIniciaisSinteticas().filter((c) => c.chave !== 'qualidade.notificacao'),
        prerequisitosIniciais: prerequisitosIniciaisSinteticos,
        parametrosIniciais: parametrosIniciaisSinteticos,
      })
    : undefined;
  const app: NestFastifyApplication = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    qualidade: new PortaQualidadeMemoria({ agora }),
    vigiaEnfermagem: null,
    vigia: null,
    ...(configuracao ? { configuracao } : {}),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  let seq = 0;
  return {
    app,
    trilha,
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
    post: (s: Sessao, url: string, payload: unknown = {}, chave?: string | null) =>
      app.inject({
        method: 'POST',
        url: `/api${url}`,
        headers: {
          cookie: s.cookie,
          'x-csrf': s.csrf,
          ...(chave === null
            ? {}
            : { 'idempotency-key': chave ?? `teste-m48e1-${String(++seq)}-${String(Date.now())}` }),
        },
        payload: payload as object,
      }),
  };
}

type App = Awaited<ReturnType<typeof montar>>;
let a: App;
beforeAll(async () => {
  a = await montar();
});
afterAll(async () => {
  await a.app.close();
});

const notificacao = (x: Record<string, unknown> = {}) => ({
  atendimento: ATENDIMENTO_SINTETICO_NOTIFICACAO,
  unidade: null,
  local: null,
  ocorridoEm: '2026-10-22T08:30',
  tipo: 'queda',
  tipoOutro: null,
  chegouAoPaciente: true,
  danoPercebido: 'leve',
  descricao: 'Paciente sintético escorregou ao sair do leito, sem fratura.',
  anonima: false,
  origem: { tela: '/pep/prontuario/48001' },
  ...x,
});

describe('o botão global "Notificar incidente"', () => {
  let enf: Sessao;
  let nsp: Sessao;
  const ids: Record<string, number> = {};
  let anonimo = { protocolo: '', codigo: '' };

  it('o formulário: a chave ligada, as unidades e a anônima permitida', async () => {
    enf = await a.entrar('SINT.ENFERMEIRO');
    nsp = await a.entrar('SINT.NSP');
    const r = await a.get(enf, '/qualidade/notificacoes/formulario');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ ligada: true, anonimaPermitida: true });
    expect(r.json().unidades.length).toBeGreaterThan(0);
    expect((await a.get(enf, '/qualidade/notificacoes/botao')).json()).toEqual({ ligada: true });
  });

  it('identificada a partir do prontuário: o número do ano e o código; o reenvio pela chave devolve os mesmos', async () => {
    const r = await a.post(enf, '/qualidade/notificacoes', notificacao(), 'chave-notif-identificada-1');
    expect(r.statusCode, r.body).toBe(201);
    const b = r.json();
    expect(b.protocolo).toBe('NSP-2026-000001');
    expect(b.codigoAcompanhamento).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    const doEvento = () =>
      a.trilha.eventos.filter((x) => x.evento === 'qualidade.incidente.notificado').length;
    const antes = doEvento();
    const rep = await a.post(enf, '/qualidade/notificacoes', notificacao(), 'chave-notif-identificada-1');
    expect(rep.statusCode).toBe(201);
    expect(rep.json()).toEqual({ ...b, repetida: true });
    // O reenvio não grava nada: nenhuma linha nova de trilha da notificação.
    expect(doEvento()).toBe(antes);
    // A resposta nunca traz o paciente.
    expect(r.body).not.toContain('SINTETICO');
  });

  it('regra 1: a anônima não deixa o login em lugar nenhum (trilha por anonimo, sem estação)', async () => {
    const antes = a.trilha.eventos.length;
    const r = await a.post(
      enf,
      '/qualidade/notificacoes',
      notificacao({
        anonima: true,
        atendimento: null,
        unidade: 3,
        tipo: 'medicacao',
        danoPercebido: 'obito',
      }),
    );
    expect(r.statusCode, r.body).toBe(201);
    anonimo = { protocolo: r.json().protocolo, codigo: r.json().codigoAcompanhamento };
    const novos = a.trilha.eventos.slice(antes);
    const doEvento = novos.filter((e) => e.evento === 'qualidade.incidente.notificado');
    expect(doEvento).toHaveLength(1);
    expect(doEvento[0]!.usuario).toBe('anonimo');
    expect(JSON.stringify(novos)).not.toContain('SINT.ENFERMEIRO');
  });

  it('recusa o atendimento inexistente (sem dizer de quem é), a unidade fora da lista e a ocorrência no futuro', async () => {
    const sem = await a.post(enf, '/qualidade/notificacoes', notificacao({ atendimento: 999_999 }));
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe('sem-atendimento');
    const un = await a.post(enf, '/qualidade/notificacoes', notificacao({ atendimento: null, unidade: 77 }));
    expect(un.statusCode).toBe(422);
    const fut = await a.post(enf, '/qualidade/notificacoes', notificacao({ ocorridoEm: '2026-10-23T08:00' }));
    expect(fut.statusCode).toBe(422);
    expect(fut.json().codigo).toBe('instante-futuro');
    const inv = await a.post(enf, '/qualidade/notificacoes', notificacao({ descricao: 'curta' }));
    expect(inv.statusCode).toBe(400);
  });

  it('o acompanhamento pelo número e o código: resposta igual para número e código errados; limite por minuto', async () => {
    const outra = await a.entrar('SINT.ENFERMEIRO');
    const ok = await a.post(outra, '/qualidade/notificacoes/acompanhar', anonimo);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ protocolo: anonimo.protocolo, situacao: 'recebida', devolutivas: [] });
    const errado = await a.post(outra, '/qualidade/notificacoes/acompanhar', {
      ...anonimo,
      codigo: 'ZZZZZZZZZZ',
    });
    const inexistente = await a.post(outra, '/qualidade/notificacoes/acompanhar', {
      protocolo: 'NSP-2026-999999',
      codigo: anonimo.codigo,
    });
    expect(errado.statusCode).toBe(404);
    expect(inexistente.statusCode).toBe(404);
    expect(errado.json().detail).toBe(inexistente.json().detail);
    await a.post(outra, '/qualidade/notificacoes/acompanhar', anonimo);
    await a.post(outra, '/qualidade/notificacoes/acompanhar', anonimo);
    const limite = await a.post(outra, '/qualidade/notificacoes/acompanhar', anonimo);
    expect(limite.statusCode).toBe(429);
  });

  it('o NSP: quem não é do núcleo não vê; a lista e o detalhe com o notificador só da identificada', async () => {
    expect((await a.get(enf, '/qualidade/nsp/notificacoes')).statusCode).toBe(403);
    const l = await a.get(nsp, '/qualidade/nsp/notificacoes');
    expect(l.statusCode, l.body).toBe(200);
    const itens = l.json().itens as {
      id: number;
      protocolo: string;
      anonima: boolean;
      classificacao: string;
    }[];
    expect(itens).toHaveLength(2);
    ids['identificada'] = itens.find((x) => !x.anonima)!.id;
    ids['anonima'] = itens.find((x) => x.anonima)!.id;
    expect(itens.find((x) => x.anonima)!.classificacao).toBe('eventoAdverso');
    const d = await a.get(nsp, `/qualidade/nsp/notificacoes/${String(ids['identificada'])}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().notificacao).toMatchObject({
      notificador: 'SINT.ENFERMEIRO',
      paciente: { nome: 'PACIENTE SINTETICO QUALIDADE', leito: 'S-201' },
      versao: 1,
    });
    const an = await a.get(nsp, `/qualidade/nsp/notificacoes/${String(ids['anonima'])}`);
    expect(an.json().notificacao.notificador).toBeNull();
    expect(an.json().notificacao.eventos[0]).toMatchObject({ tipo: 'recebida', por: 'anonimo' });
    expect(an.body).not.toContain('SINT.ENFERMEIRO');
    // Triar próxima: o óbito (atenção imediata) antes da mais antiga.
    const p = await a.get(nsp, '/qualidade/nsp/notificacoes/proxima');
    expect(p.json().id).toBe(ids['anonima']);
    expect((await a.get(nsp, '/qualidade/nsp/notificacoes/987654')).statusCode).toBe(404);
  });

  it('a triagem: reclassificar exige justificativa; a versão velha é recusada; sem mudança não grava', async () => {
    const url = `/qualidade/nsp/notificacoes/${String(ids['identificada'])}/triar`;
    const t = {
      versao: 1,
      tipo: 'queda',
      tipoOutro: null,
      classificacao: 'eventoAdverso',
      dano: 'moderado',
      neverEvent: false,
    };
    const sem = await a.post(nsp, url, { ...t, justificativa: null });
    expect(sem.statusCode).toBe(409);
    expect(sem.json().codigo).toBe('justificativa-obrigatoria');
    const incoerente = await a.post(nsp, url, {
      ...t,
      classificacao: 'quaseErro',
      justificativa: 'Nao atingiu o paciente',
    });
    expect(incoerente.json().codigo).toBe('dano-sem-ter-atingido');
    const ok = await a.post(nsp, url, { ...t, justificativa: 'Fratura sintética no exame de imagem' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().versao).toBe(2);
    const velha = await a.post(nsp, url, { ...t, justificativa: 'Fratura sintética no exame de imagem' });
    expect(velha.json().codigo).toBe('versao-desatualizada');
    const igual = await a.post(nsp, url, { ...t, versao: 2, justificativa: null });
    expect(igual.json()).toMatchObject({ versao: 2, mensagem: 'Nada mudou.' });
    // A da anônima: confirmada como está (óbito).
    const an = await a.post(nsp, `/qualidade/nsp/notificacoes/${String(ids['anonima'])}/triar`, {
      versao: 1,
      tipo: 'medicacao',
      tipoOutro: null,
      classificacao: 'eventoAdverso',
      dano: 'obito',
      neverEvent: false,
      justificativa: null,
    });
    expect(an.statusCode, an.body).toBe(200);
  });

  it('a busca do gestor da área: só o NSP, termo com 2 letras ou mais, contas ativas', async () => {
    expect((await a.get(enf, '/qualidade/nsp/gestores?busca=escala')).statusCode).toBe(403);
    expect((await a.get(nsp, '/qualidade/nsp/gestores?busca=e')).json()).toEqual({ itens: [] });
    const r = await a.get(nsp, '/qualidade/nsp/gestores?busca=escala');
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json().itens as { login: string }[]).map((x) => x.login)).toContain('SINT.ESCALA');
  });

  it('a distribuição ao gestor ativo, a devolutiva e o notificador anônimo lê a devolutiva', async () => {
    const base = `/qualidade/nsp/notificacoes/${String(ids['anonima'])}`;
    const sem = await a.post(nsp, `${base}/distribuir`, {
      versao: 2,
      gestor: 'SINT.NAOEXISTE',
      unidade: 3,
      prazoAnalise: '2026-12-01',
      orientacao: null,
    });
    expect(sem.statusCode).toBe(422);
    const passado = await a.post(nsp, `${base}/distribuir`, {
      versao: 2,
      gestor: 'SINT.ESCALA',
      unidade: 3,
      prazoAnalise: '2026-10-01',
      orientacao: null,
    });
    expect(passado.json().codigo).toBe('prazo-no-passado');
    const ok = await a.post(nsp, `${base}/distribuir`, {
      versao: 2,
      gestor: 'sint.escala',
      unidade: 3,
      prazoAnalise: '2026-12-01',
      orientacao: 'Análise de causa raiz com a farmácia',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const dv = await a.post(nsp, `${base}/devolutiva`, {
      versao: 3,
      texto: 'Revisamos a dupla checagem da medicação.',
    });
    expect(dv.statusCode, dv.body).toBe(200);
    const leitor = await a.entrar('SINT.ENFERMAGEM');
    const ac = await a.post(leitor, '/qualidade/notificacoes/acompanhar', anonimo);
    expect(ac.json()).toMatchObject({
      situacao: 'distribuida',
      devolutivas: [{ texto: 'Revisamos a dupla checagem da medicação.' }],
    });
    expect(ac.body).not.toContain('SINT.ESCALA');
  });

  it('a fila de prazos (regra 3): o óbito em 72 h e o evento adverso no 15º dia útil do mês seguinte', async () => {
    const r = await a.get(nsp, '/qualidade/nsp/prazos');
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    const obito = b.itens.find((x: { id: number }) => x.id === ids['anonima']);
    expect(obito.proximoPrazo).toMatchObject({ tipo: 'notivisaObito', venceEm: '2026-10-25T08:30:00' });
    const mensal = b.itens.find((x: { id: number }) => x.id === ids['identificada']);
    expect(mensal.proximoPrazo.tipo).toBe('notivisaMensal');
    expect(b.itens[0].id).toBe(ids['anonima']);
    // Os móveis de 2026 e 2027 não estão no cadastro sintético: a tela avisa.
    expect(b.resumo.feriadosAusentes.length).toBeGreaterThan(0);
    const filtro = await a.get(nsp, '/qualidade/nsp/notificacoes?prazo=noPrazo');
    expect(
      filtro
        .json()
        .itens.map((x: { id: number }) => x.id)
        .sort(),
    ).toEqual([ids['anonima'], ids['identificada']].sort());
    const resumo = await a.get(nsp, '/qualidade/nsp/prazos/resumo');
    expect(resumo.json().porSituacao.noPrazo).toBe(2);
    expect((await a.get(enf, '/qualidade/nsp/prazos')).statusCode).toBe(403);
  });

  it('os campos do Notivisa só com as iniciais, sexo e idade; a transcrição para o relógio', async () => {
    const base = `/qualidade/nsp/notificacoes/${String(ids['identificada'])}`;
    const antes = a.trilha.eventos.filter((e) => e.evento === 'qualidade.notivisa.exportada').length;
    const c = await a.post(nsp, `${base}/notivisa/campos`);
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json().campos.paciente).toEqual({ iniciais: 'P.S.Q.', sexo: 'F', idade: 76 });
    expect(c.body).not.toContain('SINTETICO');
    await a.post(nsp, `${base}/notivisa/campos`);
    expect(a.trilha.eventos.filter((e) => e.evento === 'qualidade.notivisa.exportada').length).toBe(
      antes + 1,
    );
    const futuro = await a.post(nsp, `${base}/notivisa/transcricao`, {
      versao: 2,
      numeroNotivisa: '2026.000123',
      transcritaEm: '2026-10-23T10:00',
    });
    expect(futuro.json().codigo).toBe('instante-futuro');
    const ok = await a.post(nsp, `${base}/notivisa/transcricao`, {
      versao: 2,
      numeroNotivisa: '2026.000123',
      transcritaEm: '2026-10-22T12:00',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const fila = await a.get(nsp, '/qualidade/nsp/prazos');
    expect(fila.json().itens.map((x: { id: number }) => x.id)).not.toContain(ids['identificada']);
    const ja = await a.post(nsp, `${base}/notivisa/transcricao`, {
      versao: 3,
      numeroNotivisa: '2026.000124',
      transcritaEm: '2026-10-22T12:00',
    });
    expect(ja.json().codigo).toBe('ja-transcrita');
  });

  it('o descarte (duplicada exige a original) e a recebida não vai ao Notivisa', async () => {
    const r = await a.post(
      enf,
      '/qualidade/notificacoes',
      notificacao({ chegouAoPaciente: false, danoPercebido: 'nenhum' }),
    );
    const l = await a.get(nsp, `/qualidade/nsp/notificacoes?protocolo=${r.json().protocolo as string}`);
    const id = l.json().itens[0].id as number;
    expect(l.json().itens[0].classificacao).toBe('quaseErro');
    expect((await a.post(nsp, `/qualidade/nsp/notificacoes/${String(id)}/notivisa/campos`)).statusCode).toBe(
      409,
    );
    const sem = await a.post(nsp, `/qualidade/nsp/notificacoes/${String(id)}/descartar`, {
      versao: 1,
      motivo: 'duplicada',
      justificativa: 'Mesma queda notificada antes',
      duplicadaDe: null,
    });
    expect(sem.json().codigo).toBe('duplicada-sem-protocolo');
    const naoExiste = await a.post(nsp, `/qualidade/nsp/notificacoes/${String(id)}/descartar`, {
      versao: 1,
      motivo: 'duplicada',
      justificativa: 'Mesma queda notificada antes',
      duplicadaDe: 'NSP-2026-888888',
    });
    expect(naoExiste.statusCode).toBe(422);
    const ok = await a.post(nsp, `/qualidade/nsp/notificacoes/${String(id)}/descartar`, {
      versao: 1,
      motivo: 'duplicada',
      justificativa: 'Mesma queda notificada antes',
      duplicadaDe: 'NSP-2026-000001',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const de = await a.get(nsp, '/qualidade/nsp/notificacoes?situacao=descartada');
    expect(de.json().itens).toHaveLength(1);
  });

  it('regra 1, o gestor da área: só as distribuídas a ele, sem o notificador nem o autor dos passos', async () => {
    const r = await a.post(enf, '/qualidade/notificacoes', notificacao({ tipo: 'lesaoPressao' }));
    expect(r.statusCode, r.body).toBe(201);
    const l = await a.get(nsp, `/qualidade/nsp/notificacoes?protocolo=${r.json().protocolo as string}`);
    const id = l.json().itens[0].id as number;
    const base = `/qualidade/nsp/notificacoes/${String(id)}`;
    const t = await a.post(nsp, `${base}/triar`, {
      versao: 1,
      tipo: 'lesaoPressao',
      tipoOutro: null,
      classificacao: 'eventoAdverso',
      dano: 'leve',
      neverEvent: false,
      justificativa: null,
    });
    expect(t.statusCode, t.body).toBe(200);
    // Ainda não distribuída: o gestor não a vê (a mesma resposta de "não existe").
    const gestor = await a.entrar('SINT.ESCALA');
    expect((await a.get(gestor, `/qualidade/gestor/notificacoes/${String(id)}`)).statusCode).toBe(404);
    const d = await a.post(nsp, `${base}/distribuir`, {
      versao: t.json().versao as number,
      gestor: 'SINT.ESCALA',
      unidade: 3,
      prazoAnalise: '2026-12-01',
      orientacao: null,
    });
    expect(d.statusCode, d.body).toBe(200);
    const lg = await a.get(gestor, '/qualidade/gestor/notificacoes');
    expect(lg.statusCode, lg.body).toBe(200);
    // A anônima (distribuída antes) e esta; nenhuma das outras.
    expect((lg.json().itens as { id: number }[]).map((x) => x.id).sort()).toEqual(
      [ids['anonima'], id].sort(),
    );
    const dg = await a.get(gestor, `/qualidade/gestor/notificacoes/${String(id)}`);
    expect(dg.statusCode, dg.body).toBe(200);
    const det = dg.json().notificacao as {
      notificador: string | null;
      eventos: { tipo: string; por: string | null }[];
    };
    expect(det.notificador).toBeNull();
    expect(det.eventos.map((x) => x.tipo)).toEqual(['recebida', 'triada', 'distribuida']);
    expect(det.eventos.every((x) => x.por === null)).toBe(true);
    expect(dg.body).not.toContain('SINT.ENFERMEIRO');
    expect(dg.body).not.toContain('SINT.NSP');
    // A identificada de outro fluxo (não distribuída a ele) e a inexistente: 404; quem não é gestor: lista vazia.
    expect(
      (await a.get(gestor, `/qualidade/gestor/notificacoes/${String(ids['identificada'])}`)).statusCode,
    ).toBe(404);
    expect((await a.get(gestor, '/qualidade/gestor/notificacoes/987654')).statusCode).toBe(404);
    expect((await a.get(enf, '/qualidade/gestor/notificacoes')).json().itens).toEqual([]);
    expect((await a.get(enf, `/qualidade/gestor/notificacoes/${String(id)}`)).statusCode).toBe(404);
  });
});

describe('a chave desligada e o código de acompanhamento', () => {
  it('sem a chave qualidade.notificacao, o botão fica em consulta e o NSP não grava', async () => {
    const d = await montar({ semChave: true });
    try {
      const enf = await d.entrar('SINT.ENFERMEIRO');
      expect((await d.get(enf, '/qualidade/notificacoes/formulario')).json().ligada).toBe(false);
      expect((await d.get(enf, '/qualidade/notificacoes/botao')).json()).toEqual({ ligada: false });
      const r = await d.post(enf, '/qualidade/notificacoes', notificacao());
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('recurso-desligado');
    } finally {
      await d.app.close();
    }
  });

  it('o código derivado da chave é estável; sem a chave, ao acaso; a conferência é pelo resumo', () => {
    expect(codigoAcompanhamento('pc', 'k-12345678')).toBe(codigoAcompanhamento('pc', 'k-12345678'));
    expect(codigoAcompanhamento('pc', 'k-12345678')).not.toBe(codigoAcompanhamento('hs', 'k-12345678'));
    const x = codigoAcompanhamento('pc', null);
    expect(codigoConfere(x, resumoSha256(x))).toBe(true);
    expect(codigoConfere(x, 'a'.repeat(64))).toBe(false);
    expect(codigoConfere(x, 'curto')).toBe(false);
  });
});

describe('a sessão "como" do suporte (ADR 0021; D-COMO-48.1)', () => {
  it('a anônima é recusada (422); a identificada e os passos do NSP levam a marca do suporte técnico', async () => {
    const envComo: Record<string, string> = { ...env, SUPORTE_SESSAO_MINUTOS: '60' };
    const trilha = new RegistradorTrilhaMemoria();
    const repo = RepositorioPlataformaMemoria.sintetico(REDE, ['aa', 'bb'], (x) =>
      cifrarSenha(x, { memoria: 8_192, passes: 1, paralelismo: 1 }),
    );
    const app: NestFastifyApplication = await criarApp(lerConfiguracao(envComo), null, envComo, {
      trilha,
      armazem: new ArmazemMemoria(),
      plataforma: repo,
      qualidade: new PortaQualidadeMemoria({ agora }),
      vigiaEnfermagem: null,
      vigia: null,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const jar = new Map<string, string>();
      const guardar = (set: string | string[] | undefined) => {
        for (const c of Array.isArray(set) ? set : set ? [set] : []) {
          const [par] = c.split(';');
          const i = par?.indexOf('=') ?? -1;
          if (!par || i < 0) continue;
          if (/Max-Age=0/.test(c) || par.slice(i + 1) === '') jar.delete(par.slice(0, i));
          else jar.set(par.slice(0, i), par.slice(i + 1));
        }
      };
      const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const p = await app.inject({
        method: 'POST',
        url: '/api/plataforma/sessao',
        payload: { email: CONTAS_PLATAFORMA_SINTETICAS.plataforma, senha: SENHA_PLATAFORMA_SINTETICA },
      });
      expect(p.statusCode, p.body).toBe(200);
      guardar(p.headers['set-cookie']);
      const c = await app.inject({
        method: 'POST',
        url: '/api/plataforma/como',
        headers: { cookie: cookie(), 'x-csrf-plataforma': jar.get('sgh_pcsrf') ?? '' },
        payload: { estabelecimento: 'aa', login: 'SINT.ENFERMEIRO', motivo: 'CHAMADO-M48-1' },
      });
      expect(c.statusCode, c.body).toBe(201);
      guardar(c.headers['set-cookie']);
      let seq = 0;
      const postComo = (payload: unknown) =>
        app.inject({
          method: 'POST',
          url: '/api/qualidade/notificacoes',
          headers: {
            cookie: cookie(),
            'x-csrf': jar.get('sgh_csrf') ?? '',
            'idempotency-key': `teste-m48e1-como-${String(++seq)}-${String(Date.now())}`,
          },
          payload: payload as object,
        });
      const f = await app.inject({
        method: 'GET',
        url: '/api/qualidade/notificacoes/formulario',
        headers: { cookie: cookie() },
      });
      expect(f.json().anonimaPermitida).toBe(false);
      const an = await postComo(notificacao({ anonima: true }));
      expect(an.statusCode).toBe(422);
      expect(an.json().codigo).toBe('anonima-no-suporte');
      expect(an.json().detail ?? an.json().detalhe).toMatch(/marca do suporte técnico/);
      const ok = await postComo(notificacao());
      expect(ok.statusCode, ok.body).toBe(201);

      // O NSP (sessão direta) vê a notificação como registrada pelo suporte em nome do alvo, não só pelo alvo.
      const s = await app.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login: 'SINT.NSP', senha: SENHA },
      });
      expect(s.statusCode).toBe(201);
      const nspCookie = (s.headers['set-cookie'] as string[]).map((x) => x.split(';')[0]).join('; ');
      const l = await app.inject({
        method: 'GET',
        url: `/api/qualidade/nsp/notificacoes?protocolo=${ok.json().protocolo as string}`,
        headers: { cookie: nspCookie },
      });
      const id = l.json().itens[0].id as number;
      const d = await app.inject({
        method: 'GET',
        url: `/api/qualidade/nsp/notificacoes/${String(id)}`,
        headers: { cookie: nspCookie },
      });
      expect(d.statusCode, d.body).toBe(200);
      const det = d.json().notificacao as { notificador: string; eventos: { tipo: string; por: string }[] };
      expect(det.notificador).toBe('Registrado pelo suporte técnico em nome de SINT.ENFERMEIRO');
      expect(det.eventos[0]).toMatchObject({
        tipo: 'recebida',
        por: 'Registrado pelo suporte técnico em nome de SINT.ENFERMEIRO',
      });
      // A trilha da requisição "como" leva o ator real na origem (a marca do guarda).
      const ev = trilha.eventos.filter((x) => x.evento === 'qualidade.incidente.notificado');
      expect(ev).toHaveLength(1);
      expect(ev[0]?.como).not.toBeNull();
    } finally {
      await app.close();
    }
  });
});

// W0-04 (programa CRUD completo; matriz, linha "Notificação de evento adverso (NSP)"): o relato original é preservado
// e o notificador não edita. Não existe rota de alteração nem de exclusão da notificação, e as ações do NSP (triar,
// reclassificar, descartar, devolver) exigem a permissão do núcleo, que o notificador não tem.
describe('W0-04: o notificador não edita a notificação', () => {
  it('sem rota de edição ou exclusão; triar e descartar pelo notificador: 403', async () => {
    const enf = await a.entrar('SINT.ENFERMEIRO');
    const r = await a.post(
      enf,
      '/qualidade/notificacoes',
      notificacao({ descricao: 'Queda sintética do W0-04, sem dano.' }),
    );
    expect(r.statusCode, r.body).toBe(201);
    const nsp = await a.entrar('SINT.NSP');
    const lista = (await a.get(nsp, '/qualidade/nsp/notificacoes')).json() as { itens: { id: number }[] };
    const id = lista.itens[0]!.id;
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const x = await a.app.inject({
        method,
        url: `/api/qualidade/notificacoes/${String(id)}`,
        headers: { cookie: enf.cookie, 'x-csrf': enf.csrf },
        payload: { descricao: 'Relato reescrito pelo notificador' },
      });
      expect(x.statusCode, `${method} ${x.body}`).toBe(404);
    }
    const triar = await a.post(enf, `/qualidade/nsp/notificacoes/${String(id)}/triar`, {
      versao: 1,
      classificacao: 'eventoAdverso',
    });
    expect(triar.statusCode).toBe(403);
    const descartar = await a.post(enf, `/qualidade/nsp/notificacoes/${String(id)}/descartar`, {
      versao: 1,
      justificativa: 'O notificador tentando apagar o próprio relato',
    });
    expect(descartar.statusCode).toBe(403);
  });
});
