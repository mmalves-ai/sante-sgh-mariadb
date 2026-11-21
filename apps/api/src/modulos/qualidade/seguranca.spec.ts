// Segurança do paciente, etapa 2 do M48, pela HTTP (regras 1, 3, 4 e 11), com a sessão real sobre a fonte sintética e
// a porta EM MEMÓRIA (nada conecta a banco; dados sintéticos): o gestor a quem a notificação foi distribuída analisa
// (sem ver quem notificou), o plano 5W2H com a situação e a eficácia, a conclusão que fecha o prazo; a sugestão
// automática do que o usuário registrou, resolvida ao notificar (a anônima guarda só a fonte) ou ao dispensar; a
// vigilância de produto com os expostos ao lote; o painel do plano de segurança com as parcelas.
import { criarAppQualidade } from './teste.spec-util.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { createHash } from 'node:crypto';
import { semeDaSugestaoResolvida } from '@sgh/dominio-qualidade';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  ATENDIMENTO_SINTETICO_NOTIFICACAO,
  LOTE_SINTETICO_EXPOSTOS,
  PortaQualidadeMemoria,
} from './porta-memoria.js';
import { inicioDoTurno, ResumoSugestao } from './servico-seguranca.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-22 13:00 em São Paulo. */
const agora = () => new Date('2026-10-22T16:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}

const porta = new PortaQualidadeMemoria({ agora });
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let seq = 0;

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
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m48e2-${String(++seq)}-${String(Date.now())}`,
    },
    payload: payload as object,
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

let enf: Sessao;
let nsp: Sessao;
let gestor: Sessao;
let id = 0;

async function idPorProtocolo(protocolo: string): Promise<number> {
  const r = await get(nsp, `/qualidade/nsp/notificacoes?protocolo=${protocolo}`);
  return (r.json().itens as { id: number }[])[0]!.id;
}

beforeAll(async () => {
  app = await criarAppQualidade(env, {
    trilha,
    qualidade: porta,
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  enf = await entrar('SINT.ENFERMEIRO');
  nsp = await entrar('SINT.NSP');
  gestor = await entrar('SINT.COORD.ENF');
}, 60_000);
afterAll(async () => {
  await app.close();
});

describe('análise de causa e plano de ação 5W2H', () => {
  it('a notificação distribuída ao gestor aparece para ele, sem quem notificou', async () => {
    const r = await post(enf, '/qualidade/notificacoes', notificacao());
    expect(r.statusCode, r.body).toBe(201);
    id = await idPorProtocolo(r.json().protocolo as string);
    const base = `/qualidade/nsp/notificacoes/${String(id)}`;
    const t = await post(nsp, `${base}/triar`, {
      versao: 1,
      tipo: 'queda',
      tipoOutro: null,
      classificacao: 'eventoAdverso',
      dano: 'leve',
      neverEvent: false,
      justificativa: null,
    });
    expect(t.statusCode, t.body).toBe(200);
    // Antes da distribuição, nem o NSP analisa.
    const cedo = await post(nsp, `/qualidade/analises/${String(id)}`, {
      versao: 0,
      conteudo: { metodo: 'cincoPorques', porques: ['Antes da distribuição'] },
      causaRaiz: null,
      fatores: [],
      licoes: null,
      concluir: false,
      semAcaoJustificativa: null,
    });
    expect(cedo.statusCode).toBe(404);
    const d = await post(nsp, `${base}/distribuir`, {
      versao: 2,
      gestor: 'sint.coord.enf',
      unidade: 3,
      prazoAnalise: '2026-11-30',
      orientacao: null,
    });
    expect(d.statusCode, d.body).toBe(200);
    const lista = await get(gestor, '/qualidade/analises');
    expect(lista.statusCode, lista.body).toBe(200);
    expect((lista.json().itens as { id: number }[]).map((x) => x.id)).toContain(id);
    const det = await get(gestor, `/qualidade/analises/${String(id)}`);
    expect(det.statusCode, det.body).toBe(200);
    expect(det.body).not.toContain('SINT.ENFERMEIRO');
    expect(det.json()).toMatchObject({ analise: null, acoes: [], gravacao: { acoes: { analisar: true } } });
    // Quem não é o gestor nem o NSP: sem a permissão, 403.
    expect((await get(enf, `/qualidade/analises/${String(id)}`)).statusCode).toBe(403);
  });

  it('o gestor inicia a análise (em análise), conclui só com causa raiz e plano', async () => {
    const url = `/qualidade/analises/${String(id)}`;
    const inicio = await post(gestor, url, {
      versao: 0,
      conteudo: {
        metodo: 'cincoPorques',
        porques: ['Paciente caiu ao levantar', 'Grade abaixada no plantão'],
      },
      causaRaiz: null,
      fatores: ['equipe'],
      licoes: null,
      concluir: false,
      semAcaoJustificativa: null,
    });
    expect(inicio.statusCode, inicio.body).toBe(200);
    const nsp1 = await get(nsp, `/qualidade/nsp/notificacoes/${String(id)}`);
    expect(nsp1.json().notificacao.situacao).toBe('emAnalise');
    const semAcao = await post(gestor, url, {
      versao: 1,
      conteudo: { metodo: 'cincoPorques', porques: ['Paciente caiu ao levantar'] },
      causaRaiz: 'Rotina de checagem da grade ausente no plantão noturno',
      fatores: [],
      licoes: null,
      concluir: true,
      semAcaoJustificativa: null,
    });
    expect(semAcao.statusCode).toBe(409);
    expect(semAcao.json().codigo).toBe('sem-acao');
    const passado = await post(gestor, `${url}/acoes`, {
      tipo: 'incluir',
      acao: {
        oQue: 'Checar a grade a cada ronda',
        porQue: 'Grade abaixada',
        onde: 'Unidade 3',
        quando: '2026-10-01',
        quem: 'SINT.NSP',
        como: 'Item novo no checklist da ronda',
        quanto: null,
      },
    });
    expect(passado.json().codigo).toBe('prazo-no-passado');
    const inativo = await post(gestor, `${url}/acoes`, {
      tipo: 'incluir',
      acao: {
        oQue: 'Checar a grade a cada ronda',
        porQue: 'Grade abaixada',
        onde: 'Unidade 3',
        quando: '2026-11-15',
        quem: 'SINT.NAOEXISTE',
        como: 'Item novo no checklist da ronda',
        quanto: null,
      },
    });
    expect(inativo.json().codigo).toBe('responsavel-inativo');
    const resp = await get(gestor, '/qualidade/acoes/responsaveis?busca=nsp');
    expect(resp.statusCode, resp.body).toBe(200);
    expect((resp.json().itens as { login: string }[]).map((x) => x.login.toLowerCase())).toContain(
      'sint.nsp',
    );
    expect((await get(gestor, '/qualidade/acoes/responsaveis?busca=n')).json().itens).toEqual([]);
    const acao = await post(gestor, `${url}/acoes`, {
      tipo: 'incluir',
      acao: {
        oQue: 'Checar a grade a cada ronda',
        porQue: 'Grade abaixada',
        onde: 'Unidade 3',
        quando: '2026-11-15',
        quem: 'sint.nsp',
        como: 'Item novo no checklist da ronda',
        quanto: 'sem custo',
      },
    });
    expect(acao.statusCode, acao.body).toBe(200);
    const minhas = await get(nsp, '/qualidade/acoes/minhas');
    expect((minhas.json().itens as { oQue: string }[]).map((x) => x.oQue)).toContain(
      'Checar a grade a cada ronda',
    );
    const concl = await post(gestor, url, {
      versao: 1,
      conteudo: { metodo: 'cincoPorques', porques: ['Paciente caiu ao levantar'] },
      causaRaiz: 'Rotina de checagem da grade ausente no plantão noturno',
      fatores: ['equipe', 'organizacao'],
      licoes: 'A ronda confere a grade.',
      concluir: true,
      semAcaoJustificativa: null,
    });
    expect(concl.statusCode, concl.body).toBe(200);
    const det = await get(gestor, url);
    expect(det.json()).toMatchObject({
      analise: { situacao: 'concluida', fatores: ['equipe', 'organizacao'], versao: 2 },
      plano: { total: 1, abertas: 1 },
      gravacao: { acoes: { analisar: false, planejar: true } },
    });
    expect(det.json().notificacao.situacao).toBe('concluida');
    const de = await get(nsp, `/qualidade/nsp/notificacoes/${String(id)}`);
    expect(
      (de.json().notificacao.eventos as { tipo: string }[])
        .map((e) => e.tipo)
        .filter((t) => t.startsWith('analise')),
    ).toEqual(['analiseIniciada', 'analiseConcluida']);
    // Concluída, a análise não muda; o plano continua.
    const depois = await post(gestor, url, {
      versao: 2,
      conteudo: { metodo: 'cincoPorques', porques: ['Tentativa depois de concluída'] },
      causaRaiz: null,
      fatores: [],
      licoes: null,
      concluir: false,
      semAcaoJustificativa: null,
    });
    expect(depois.json().codigo).toBe('analise-concluida');
  });

  it('a ação anda (evidência obrigatória), a eficácia uma vez, a versão velha é recusada', async () => {
    const url = `/qualidade/analises/${String(id)}`;
    const acao = ((await get(gestor, url)).json().acoes as { id: number; versao: number }[])[0]!;
    const sem = await post(gestor, `${url}/acoes`, {
      tipo: 'situacao',
      id: acao.id,
      versao: acao.versao,
      situacao: 'concluida',
      texto: null,
    });
    expect(sem.json().codigo).toBe('texto-obrigatorio');
    const ok = await post(gestor, `${url}/acoes`, {
      tipo: 'situacao',
      id: acao.id,
      versao: acao.versao,
      situacao: 'concluida',
      texto: 'Checklist da ronda atualizado e treinado.',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const velha = await post(gestor, `${url}/acoes`, {
      tipo: 'eficacia',
      id: acao.id,
      versao: acao.versao,
      eficacia: 'eficaz',
      texto: 'Nenhuma queda na unidade em 30 dias.',
    });
    expect(velha.json().codigo).toBe('versao-desatualizada');
    const ef = await post(gestor, `${url}/acoes`, {
      tipo: 'eficacia',
      id: acao.id,
      versao: acao.versao + 1,
      eficacia: 'eficaz',
      texto: 'Nenhuma queda na unidade em 30 dias.',
    });
    expect(ef.statusCode, ef.body).toBe(200);
    const de2 = await post(gestor, `${url}/acoes`, {
      tipo: 'eficacia',
      id: acao.id,
      versao: acao.versao + 2,
      eficacia: 'parcial',
      texto: 'Segunda verificação sintética.',
    });
    expect(de2.json().codigo).toBe('eficacia-ja-verificada');
    expect((await get(nsp, '/qualidade/acoes/minhas')).json().itens).toEqual([]);
    expect(trilha.eventos.filter((e) => e.evento === 'qualidade.planoAcao.registrado').length).toBe(3);
  });
});

describe('sugestão automática (regra 4)', () => {
  it('sugere ao próprio usuário; notificar a anônima resolve e grava só a fonte', async () => {
    porta.candidatosSinteticos['SINT.ENFERMEIRO'] = {
      checagens: [
        {
          id: 7,
          situacao: 'N',
          motivo: 'faltaItem',
          avisos: null,
          horaReal: '2026-10-21T10:00:00',
          atendimento: ATENDIMENTO_SINTETICO_NOTIFICACAO,
        },
        {
          id: 8,
          situacao: 'N',
          motivo: 'recusa',
          avisos: null,
          horaReal: '2026-10-21T11:00:00',
          atendimento: null,
        },
      ],
      reacoes: [{ id: 3, inicioEm: '2026-10-20T09:00:00', grau: 1, enviada: false }],
      checklists: [],
    };
    const s1 = await get(enf, '/qualidade/sugestoes');
    expect(s1.statusCode, s1.body).toBe(200);
    expect((s1.json().itens as { origem: string }[]).map((x) => x.origem)).toEqual(['omitida:7', 'reacao:3']);
    expect((await get(nsp, '/qualidade/sugestoes')).json().itens).toEqual([]);
    const r = await post(
      enf,
      '/qualidade/notificacoes',
      notificacao({
        tipo: 'medicacao',
        anonima: true,
        descricao: 'Dose não administrada por falta do item (sintético).',
        origem: { tela: '/enfermagem/checagem', sugestao: 'omitida:7' },
      }),
    );
    expect(r.statusCode, r.body).toBe(201);
    const nid = await idPorProtocolo(r.json().protocolo as string);
    const d = await get(nsp, `/qualidade/nsp/notificacoes/${String(nid)}`);
    expect(d.body).not.toContain('omitida:7');
    expect(d.body).not.toContain('SINT.ENFERMEIRO');
    // Regra 1: a anônima vinda de sugestão vai com a hora pelo início do turno (08:30 → 07:00), não o minuto do registro.
    expect(d.body).toContain('2026-10-22T07:00');
    expect(d.body).not.toContain('2026-10-22T08:30');
    expect(
      (await get(enf, '/qualidade/sugestoes')).json().itens.map((x: { origem: string }) => x.origem),
    ).toEqual(['reacao:3']);
    const antes = trilha.eventos.length;
    const dis = await post(enf, '/qualidade/sugestoes/dispensar', { origem: 'reacao:3' });
    expect(dis.statusCode, dis.body).toBe(200);
    expect((await get(enf, '/qualidade/sugestoes')).json().itens).toEqual([]);
    expect(JSON.stringify(trilha.eventos.slice(antes))).not.toContain('reacao:3');
    expect(
      (await post(enf, '/qualidade/sugestoes/dispensar', { origem: 'reacao:3' })).json().mensagem,
    ).toContain('já tinha');
    expect((await post(enf, '/qualidade/sugestoes/dispensar', { origem: 'outra:3' })).statusCode).toBe(400);
  });

  it('W0-03 M4: a LPP adquirida (grave no estágio 3) sugere ao autor; a admitida e a inativada não; dispensar resolve', async () => {
    const lpp = (id: number, o: Record<string, unknown> = {}) => ({
      id,
      estagio: 'estagio3' as const,
      presenteNaAdmissao: false,
      inativada: false,
      identificadaEm: '2026-10-21T06:00:00',
      atendimento: ATENDIMENTO_SINTETICO_NOTIFICACAO,
      ...o,
    });
    porta.candidatosSinteticos['SINT.ENFERMEIRO'] = {
      checagens: [],
      reacoes: [],
      checklists: [],
      lesoes: [lpp(21), lpp(22, { presenteNaAdmissao: true }), lpp(23, { inativada: true })],
    };
    const s1 = await get(enf, '/qualidade/sugestoes');
    expect(s1.statusCode, s1.body).toBe(200);
    const itens = s1.json().itens as { origem: string; tipo: string; descricao: string }[];
    expect(itens.map((x) => x.origem)).toEqual(['lesao:21']);
    expect(itens[0]).toMatchObject({ tipo: 'lesaoPressao' });
    expect(itens[0]!.descricao).toContain('evento adverso grave');
    // Dispensar resolve (notificar resolveria igual; o teste não cria notificação para não mudar o painel abaixo).
    const dis = await post(enf, '/qualidade/sugestoes/dispensar', { origem: 'lesao:21' });
    expect(dis.statusCode, dis.body).toBe(200);
    expect((await get(enf, '/qualidade/sugestoes')).json().itens).toEqual([]);
  });
});

describe('tecnovigilância e farmacovigilância', () => {
  let qid = 0;
  const abrir = (x: Record<string, unknown> = {}) => ({
    acao: 'abrir',
    area: 'tecnovigilancia',
    tipo: 'queixaTecnica',
    item: LOTE_SINTETICO_EXPOSTOS.item,
    produto: null,
    lote: LOTE_SINTETICO_EXPOSTOS.lote,
    serie: null,
    fabricante: 'Fabricante sintético',
    registroAnvisa: null,
    descricao: 'Equipo sintético com vazamento na conexão.',
    notificacao: null,
    alerta: null,
    conduta: 'segregado',
    ...x,
  });

  it('abre ligado ao lote, recusa o tipo fora da área e o produto fora do cadastro', async () => {
    expect(
      (await post(nsp, '/qualidade/tecnovigilancia', abrir({ tipo: 'reacaoAdversa' }))).json().codigo,
    ).toBe('tipo-fora-da-area');
    expect((await post(nsp, '/qualidade/tecnovigilancia', abrir({ item: 999 }))).json().codigo).toBe(
      'item-inexistente',
    );
    expect((await post(enf, '/qualidade/tecnovigilancia', abrir())).statusCode).toBe(403);
    const r = await post(nsp, '/qualidade/tecnovigilancia', abrir({ notificacao: id }));
    expect(r.statusCode, r.body).toBe(201);
    qid = r.json().id as number;
    const l = await get(nsp, '/qualidade/tecnovigilancia?situacao=aberta');
    expect(l.json().itens[0]).toMatchObject({ id: qid, itemNome: 'EQUIPO SINTETICO DE INFUSAO' });
    const d = await get(nsp, `/qualidade/tecnovigilancia/${String(qid)}`);
    expect(d.json()).toMatchObject({ calculaExpostos: true, registro: { situacao: 'aberta' } });
    expect(d.json().protocoloNotificacao).toMatch(/^NSP-2026-/);
    expect((await get(nsp, '/qualidade/tecnovigilancia/itens?busca=equipo')).json().itens).toHaveLength(1);
  });

  it('os expostos ao lote com o evento de auditoria; o andamento só para a frente', async () => {
    const x = await get(nsp, `/qualidade/tecnovigilancia/${String(qid)}/expostos`);
    expect(x.statusCode, x.body).toBe(200);
    expect(x.json().expostos).toHaveLength(2);
    expect(trilha.eventos.some((e) => e.evento === 'qualidade.expostos.consultados')).toBe(true);
    const url = `/qualidade/tecnovigilancia/${String(qid)}/andamento`;
    const semNumero = await post(nsp, url, {
      versao: 1,
      situacao: 'notificada',
      conduta: 'recolhido',
      notivisaNumero: null,
      texto: 'Recolhido das unidades (sintético).',
    });
    expect(semNumero.json().codigo).toBe('sem-numero-notivisa');
    const ok = await post(nsp, url, {
      versao: 1,
      situacao: 'notificada',
      conduta: 'recolhido',
      notivisaNumero: '2026.10.001',
      texto: 'Notificado e recolhido (sintético).',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const volta = await post(nsp, url, {
      versao: 2,
      situacao: 'aberta',
      conduta: 'recolhido',
      notivisaNumero: null,
      texto: 'Tentativa de voltar (sintético).',
    });
    expect(volta.json().codigo).toBe('situacao-nao-permite');
    const fim = await post(nsp, url, {
      versao: 2,
      situacao: 'encerrada',
      conduta: 'devolvido',
      notivisaNumero: null,
      texto: 'Devolvido ao fornecedor (sintético).',
    });
    expect(fim.statusCode, fim.body).toBe(200);
    const d = await get(nsp, `/qualidade/tecnovigilancia/${String(qid)}`);
    expect(d.json()).toMatchObject({
      registro: { situacao: 'encerrada', notivisaNumero: '2026.10.001' },
      gravacao: { registrar: false },
    });
    expect(d.json().eventos).toHaveLength(3);
  });

  it('a supervisão da farmácia não liga nem lê a notificação que não vê (mesma resposta da inexistente)', async () => {
    const farm = await entrar('SINT.SUP.FARMACIA');
    const ligada = await post(
      farm,
      '/qualidade/tecnovigilancia',
      abrir({
        area: 'farmacovigilancia',
        tipo: 'reacaoAdversa',
        item: null,
        produto: 'Produto sintético',
        lote: null,
        notificacao: id,
      }),
    );
    const inexistente = await post(
      farm,
      '/qualidade/tecnovigilancia',
      abrir({
        area: 'farmacovigilancia',
        tipo: 'reacaoAdversa',
        item: null,
        produto: 'Produto sintético',
        lote: null,
        notificacao: 999_999,
      }),
    );
    expect(ligada.statusCode, ligada.body).toBe(422);
    expect(inexistente.statusCode).toBe(422);
    expect(ligada.json().detail).toBe(inexistente.json().detail);
    const sem = await post(
      farm,
      '/qualidade/tecnovigilancia',
      abrir({
        area: 'farmacovigilancia',
        tipo: 'reacaoAdversa',
        item: null,
        produto: 'Produto sintético',
        lote: null,
      }),
    );
    expect(sem.statusCode, sem.body).toBe(201);
    // O registro do NSP ligado à notificação: a farmácia o lê, sem o número da notificação.
    const d = await get(farm, `/qualidade/tecnovigilancia/${String(qid)}`);
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json().protocoloNotificacao).toBeNull();
    expect(d.body).not.toMatch(/NSP-2026-/);
    expect((await get(nsp, `/qualidade/tecnovigilancia/${String(qid)}`)).json().protocoloNotificacao).toMatch(
      /^NSP-2026-/,
    );
  });
});

describe('painel do plano de segurança do paciente', () => {
  it('agregados com as parcelas; período limitado; só para quem tem a permissão', async () => {
    porta.adesaoSintetica = {
      checagens: 10,
      checagensComPulseira: 9,
      checklists: 2,
      checklistsConcluidos: 1,
      checklistsComPausa: 2,
      reavaliacoes: [{ escala: 'braden', devidas: 4, cumpridasNoPrazo: 3 }],
    };
    const r = await get(nsp, '/qualidade/nsp/painel');
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json().painel;
    expect(p.periodo).toEqual({ de: '2026-09-23', ate: '2026-10-22' });
    expect(p.notificacoes.total).toBe(2);
    expect(p.notificacoes.anonimas).toBe(1);
    expect(p.notificacoes.porTipo.find((t: { codigo: string }) => t.codigo === 'queda').quantidade).toBe(1);
    expect(p.analises).toMatchObject({
      comPrazo: 1,
      concluidas: 1,
      noPrazo: { numerador: 1, denominador: 1 },
    });
    expect(p.acoes).toMatchObject({
      concluidas: 1,
      eficacia: { numerador: 1, denominador: 1, percentual: 100 },
    });
    expect(p.adesao.find((i: { codigo: string }) => i.codigo === 'meta1-pulseira')).toMatchObject({
      numerador: 9,
      denominador: 10,
      percentual: 90,
    });
    expect(p.historicoRiscos).toHaveLength(3);
    expect(r.body).not.toContain('SINT.ENFERMEIRO');
    expect((await get(gestor, '/qualidade/nsp/painel')).statusCode).toBe(200);
    expect((await get(enf, '/qualidade/nsp/painel')).statusCode).toBe(403);
    expect((await get(nsp, '/qualidade/nsp/painel?de=2025-01-01&ate=2026-10-22')).json().codigo).toBe(
      'periodo-longo',
    );
    expect((await get(nsp, '/qualidade/nsp/painel?ate=2026-12-01')).json().codigo).toBe('fim-futuro');
  });
});

describe('lista das análises do NSP (situações filtradas no banco)', () => {
  it('a análise distribuída mais antiga aparece na primeira página, mesmo com 50+ notificações novas não triadas', async () => {
    for (let i = 0; i < 52; i++) {
      const r = await post(
        enf,
        '/qualidade/notificacoes',
        notificacao({ descricao: `Notificação sintética recebida ${String(i)}.` }),
      );
      expect(r.statusCode, r.body).toBe(201);
    }
    const l = await get(nsp, '/qualidade/analises');
    expect(l.statusCode, l.body).toBe(200);
    const itens = l.json().itens as { id: number; situacao: string }[];
    expect(itens.map((x) => x.id)).toContain(id);
    expect(itens.every((x) => ['distribuida', 'emAnalise', 'concluida'].includes(x.situacao))).toBe(true);
    expect(l.json().temMais).toBe(false);
    // Com a situação escolhida, só ela.
    const c = await get(nsp, '/qualidade/analises?situacao=concluida');
    expect((c.json().itens as { situacao: string }[]).every((x) => x.situacao === 'concluida')).toBe(true);
  });
});

describe('anonimato da sugestão (regra 1)', () => {
  it('o início do turno: 07h, 13h e 19h; a madrugada no turno das 19h do dia anterior', () => {
    expect(inicioDoTurno('2026-10-22T08:30')).toBe('2026-10-22T07:00');
    expect(inicioDoTurno('2026-10-22T13:00:15')).toBe('2026-10-22T13:00');
    expect(inicioDoTurno('2026-10-22T23:59')).toBe('2026-10-22T19:00');
    expect(inicioDoTurno('2026-11-01T03:10')).toBe('2026-10-31T19:00');
  });

  it('o resumo da sugestão resolvida é um HMAC: sem a chave, não se recalcula pelo SHA-256 da semente', () => {
    const a = new ResumoSugestao(Buffer.alloc(32, 7));
    const b = new ResumoSugestao(Buffer.alloc(32, 8));
    const r = a.resumo('pc', 'sint.enf', 'omitida:5');
    expect(r).toMatch(/^[0-9a-f]{64}$/);
    expect(r).toBe(a.resumo('pc', 'SINT.ENF', 'omitida:5'));
    expect(r).not.toBe(b.resumo('pc', 'sint.enf', 'omitida:5'));
    expect(r).not.toBe(
      createHash('sha256')
        .update(semeDaSugestaoResolvida('pc', 'sint.enf', 'omitida:5'), 'utf8')
        .digest('hex'),
    );
    expect(() => new ResumoSugestao(Buffer.alloc(16))).toThrow();
  });
});
