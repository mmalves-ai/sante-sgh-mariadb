// M44, etapa 1 (classificação de risco no PA) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM
// MEMÓRIA (nada conecta a banco): a fila (chegou e não classificou), o protocolo publicado com reautenticação e autor
// diferente do aprovador (regra 2), o simulador, a regra 1 (o técnico registra os sinais e não conclui; a recepção não
// vê), a cor proposta pelo discriminador e a sobreposição com justificativa e evento (regra 3), o quadro do PA com a
// cor e o cronômetro, o estouro do tempo-alvo com a reclassificação obrigatória (regra 4), a reclassificação
// concorrente, o painel de TV sem nome, as cores antigas e os indicadores com numerador e denominador (regra 5).
// Dados sintéticos.
import { PROTOCOLO_SINTETICO } from '@sgh/dominio-recepcao';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaAtendimentoMemoria } from '../atendimento/porta-memoria.js';
import { criarAppRecepcao } from './app-recepcao.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaClassificacaoMemoria } from './classificacao-porta-memoria.js';
import {
  atorDoVinculo,
  categoriaPeloCbo,
  encerradoNoPa,
  iniciais,
  ServicoClassificacao,
} from './classificacao-servico.js';
import { PortaRecepcaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const recepcao = new PortaRecepcaoMemoria({ estado: () => 'verde' });
const atendimento = new PortaAtendimentoMemoria(
  { estado: () => 'verde' },
  { lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), recepcao },
);
let desvioMin = 0;
const classificacao = new PortaClassificacaoMemoria({
  agora: () => new Date(Date.now() + desvioMin * 60_000),
  trilha,
});
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarAppRecepcao(env, {
    trilha,
    recepcao,
    classificacao,
    atendimento,
  });
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
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m44-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const SINAIS = {
  pas: 130,
  pad: 85,
  fc: 104,
  fr: 20,
  temperatura: 37.2,
  saturacao: 96,
  glicemia: null,
  dor: 9,
  glasgow: 15,
};

async function abrirPa(s: Sessao, paciente: number): Promise<number> {
  const r = await post(s, '/atendimento', {
    tipo: 'pa',
    paciente,
    convenio: 306,
    profissional: 7101,
    especialidade: 15,
    unidade: 3,
    centroCusto: 300400,
    procedimento: 10101039,
    carater: 'urgencia',
    cidPrincipal: 1,
    matricula: '900000000777',
  });
  expect(r.statusCode, r.body).toBe(201);
  return Number(r.json().resultado.reg);
}

describe('classificação de risco no PA (M44, etapa 1)', () => {
  let enf: Sessao;
  let reg = 0;
  let versao = 0;

  it('sem protocolo publicado: a fila mostra quem chegou e a tela fica em consulta com o motivo', async () => {
    enf = await entrar('SINT.ENFERMEIRO.PA');
    const f = await get(enf, '/pa/classificacao/fila');
    expect(f.statusCode, f.body).toBe(200);
    expect(f.json().protocoloVigente).toBeNull();
    expect(f.json().itens.length).toBeGreaterThan(0);
    reg = f.json().itens[0].reg;
    const t = await get(enf, `/pa/classificacao/${reg}`);
    expect(t.statusCode, t.body).toBe(200);
    expect(t.json().acoes).toEqual([]);
    expect(t.json().motivoSemAcao).toMatch(/Nenhum protocolo/);
    expect(t.json().prontuario.ligado).toBe(false);
    // A leitura da tela é leitura de prontuário auditada.
    expect(trilha.eventos.some((e) => e.evento === 'pep.registro.lido')).toBe(true);
  });

  it('regra 2: só a diretoria clínica publica, com reautenticação e um autor real diferente dela; publica imutável', async () => {
    const dir = await entrar('SINT.DIRETOR.CLINICO');
    const base = {
      autor: 'SINT.ENFERMEIRO.PA',
      conteudo: PROTOCOLO_SINTETICO,
      notas: 'Primeira versão sintética',
    };
    // O enfermeiro com conselho lê protocolos, mas não publica (permissão só do perfil diretoria clínica).
    expect(
      (await post(enf, '/pa/protocolos', { ...base, autor: 'SINT.DIRETOR.CLINICO', senha: SENHA }))
        .statusCode,
    ).toBe(403);
    expect((await post(dir, '/pa/protocolos', { ...base, senha: 'errada' })).statusCode).toBe(401);
    const auto = await post(dir, '/pa/protocolos', { ...base, autor: 'sint.diretor.clinico', senha: SENHA });
    expect(auto.statusCode).toBe(422);
    expect(auto.json().codigo).toBe('autoaprovacao');
    // O autor não é texto livre: tem de existir, estar ativo e ler protocolos.
    const inexistente = await post(dir, '/pa/protocolos', {
      ...base,
      autor: 'SINT.NINGUEM.AQUI',
      senha: SENHA,
    });
    expect(inexistente.statusCode, inexistente.body).toBe(422);
    expect(inexistente.json().codigo).toBe('autor-invalido');
    const bloqueado = await post(dir, '/pa/protocolos', { ...base, autor: 'SINT.BLOQUEADO', senha: SENHA });
    expect(bloqueado.json().codigo).toBe('autor-invalido');
    const semAcesso = await post(dir, '/pa/protocolos', { ...base, autor: 'SINT.FATURISTA', senha: SENHA });
    expect(semAcesso.statusCode, semAcesso.body).toBe(422);
    expect(semAcesso.json().codigo).toBe('autor-sem-permissao');
    const manchester = await post(dir, '/pa/protocolos', {
      ...base,
      conteudo: { ...PROTOCOLO_SINTETICO, tipo: 'manchester' },
      senha: SENHA,
    });
    expect(manchester.statusCode).toBe(422);
    expect(manchester.json().codigo).toBe('licenca-ausente');
    const r = await post(dir, '/pa/protocolos', { ...base, senha: SENHA });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ versao: 1 });
    versao = r.json().id;
    const vs = (await get(enf, '/pa/protocolos')).json();
    expect(vs[0]).toMatchObject({
      id: versao,
      situacao: 'publicado',
      autor: 'SINT.ENFERMEIRO.PA',
      aprovador: 'SINT.DIRETOR.CLINICO',
    });
    const v = (await get(enf, `/pa/protocolos/${versao}`)).json();
    expect(v.conteudo.fluxogramas.length).toBe(3);
    expect(v.versao.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.protocolo.publicado')).toBe(true);
  });

  it('o simulador propõe a cor pela regra do discriminador, sem gravar', async () => {
    const r = await post(enf, '/pa/protocolos/simular', {
      conteudo: PROTOCOLO_SINTETICO,
      fluxograma: 'dor-toracica',
      sinais: SINAIS,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ cor: 'laranja', automaticos: ['dor-intensa'], tempoAlvoMin: 10 });
    expect(r.json().problemas).toEqual([]);
  });

  it('regra 1: o técnico registra os sinais e não conclui; a recepção não vê a fila', async () => {
    const tec = await entrar('SINT.TECNICO.PA');
    const t = await get(tec, `/pa/classificacao/${reg}`);
    expect(t.json().acoes).toEqual(['registrarSinais']);
    expect(t.json().motivoSemAcao).toMatch(/privativa do enfermeiro/);
    const s = await post(tec, `/pa/classificacao/${reg}/sinais`, { sinais: SINAIS });
    expect(s.statusCode, s.body).toBe(201);
    expect(s.json().registrados).toBe(8);
    const c = await post(tec, `/pa/classificacao/${reg}`, {
      versaoProtocolo: versao,
      fluxograma: 'dor-toracica',
      discriminadores: [],
      sinais: SINAIS,
      queixa: 'Dor no peito',
      corFinal: 'laranja',
    });
    expect([403]).toContain(c.statusCode);
    const fila = (await get(enf, '/pa/classificacao/fila')).json();
    expect(fila.itens.find((i: { reg: number }) => i.reg === reg).comSinais).toBe(true);
    const rec = await entrar('SINT.SUPERVISOR.ATD');
    expect((await get(rec, '/pa/classificacao/fila')).statusCode).toBe(403);
  });

  it('regra 3: a cor proposta é a do discriminador; sobrepor exige justificativa e gera o evento', async () => {
    const t = (await get(enf, `/pa/classificacao/${reg}`)).json();
    expect(t.acoes).toEqual(['registrarSinais', 'concluir']);
    expect(t.sinaisRecentes.dor).toBe(9);
    const corpo = {
      versaoProtocolo: versao,
      fluxograma: 'dor-toracica',
      discriminadores: [],
      sinais: SINAIS,
      queixa: 'Dor no peito há duas horas (ação, atenção)',
      corFinal: 'vermelho',
    };
    const sem = await post(enf, `/pa/classificacao/${reg}`, corpo);
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe('justificativa-obrigatoria');
    const velha = await post(enf, `/pa/classificacao/${reg}`, { ...corpo, versaoProtocolo: versao + 99 });
    expect(velha.json().codigo).toBe('protocolo-substituido');
    // Sem trilha, sem dado: o evento da cor sobreposta vai na mesma transação; a trilha caída desfaz a classificação.
    const eventosAntes = trilha.eventos.length;
    trilha.falhar = true;
    const semTrilha = await post(enf, `/pa/classificacao/${reg}`, {
      ...corpo,
      justificativaSobreposicao: 'Piora visível na espera',
    });
    trilha.falhar = false;
    expect(semTrilha.statusCode, semTrilha.body).toBeGreaterThanOrEqual(500);
    expect(trilha.eventos.length).toBe(eventosAntes);
    const t2 = (await get(enf, `/pa/classificacao/${reg}`)).json();
    expect(t2.vigente).toBeNull();
    expect(t2.acoes).toEqual(['registrarSinais', 'concluir']);
    const r = await post(enf, `/pa/classificacao/${reg}`, {
      ...corpo,
      corFinal: 'laranja',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().classificacao).toMatchObject({
      cor: 'laranja',
      nomeCor: 'Muito urgente',
      corProposta: 'laranja',
      sobreposta: false,
      tempoAlvoMin: 10,
      motivo: 'inicial',
      prontuario: { situacao: 'desligado' },
    });
    expect(r.json().avisos[0]).toMatch(/só neste sistema/);
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.classificacao.concluida')).toBe(true);
    const de2 = await post(enf, `/pa/classificacao/${reg}`, { ...corpo, corFinal: 'laranja' });
    expect(de2.json().codigo).toBe('ja-classificado');
  });

  it('o quadro do PA ganha a cor, o cronômetro e a contagem por cor; o painel de TV sem nome', async () => {
    const med = await entrar('SINT.MEDICO.PA');
    const q = (await get(med, '/pa/quadro')).json();
    const cartoes = q.colunas.flatMap((c: { cartoes: { reg: number; risco: unknown }[] }) => c.cartoes);
    const k = cartoes.find((c: { reg: number }) => c.reg === reg);
    expect(k.risco).toMatchObject({ cor: 'laranja', nomeCor: 'Muito urgente', estourado: false });
    expect(q.porCor.find((x: { cor: string }) => x.cor === 'laranja').total).toBe(1);
    const sv = new ServicoClassificacao(classificacao, {
      paAbertos: (c) => atendimento.paAbertos(c as Parameters<typeof atendimento.paAbertos>[0]),
      pacienteDoAtendimento: async () => ({ id: 1005, nascimento: null }),
    });
    const p = await sv.painel({ rede: 'rede-sintetica', hospital: 'aa' });
    const texto = JSON.stringify(p);
    expect(texto).not.toMatch(/MARIA|APARECIDA|JOSÉ/);
    expect(p.linhas.some((l) => l.cor === 'laranja' && l.nomeCor === 'Muito urgente')).toBe(true);
  });

  it('regra 4: o estouro sem médico obriga a reclassificar; a concorrente perde; mudança de quadro exige descrição', async () => {
    const t0 = (await get(enf, `/pa/classificacao/${reg}`)).json();
    const anterior = t0.vigente.id;
    const corpo = {
      versaoProtocolo: versao,
      fluxograma: 'dor-toracica',
      discriminadores: [],
      sinais: SINAIS,
      queixa: 'Dor no peito',
      corFinal: 'laranja',
      anterior,
      motivo: 'estouro',
    };
    const cedo = await post(enf, `/pa/classificacao/${reg}/reclassificar`, corpo);
    // O atendimento médico já começou (a marca do quadro): o relógio parou, sem estouro.
    expect(['sem-estouro']).toContain(cedo.json().codigo);
    const mud = await post(enf, `/pa/classificacao/${reg}/reclassificar`, {
      ...corpo,
      motivo: 'mudanca_quadro',
    });
    expect(mud.statusCode).toBe(400);
    const ok = await post(enf, `/pa/classificacao/${reg}/reclassificar`, {
      ...corpo,
      motivo: 'mudanca_quadro',
      descricaoMudanca: 'Dor passou a irradiar para o braço esquerdo',
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json().classificacao.motivo).toBe('mudanca_quadro');
    const de2 = await post(enf, `/pa/classificacao/${reg}/reclassificar`, {
      ...corpo,
      motivo: 'mudanca_quadro',
      descricaoMudanca: 'Outra mudança registrada ao mesmo tempo',
    });
    expect(de2.json().codigo).toBe('anterior-desatualizada');
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.classificacao.reclassificada')).toBe(true);
  });

  it('regra 4 (estouro): um amarelo sem médico estoura, entra na fila de reclassificação e é avisado uma vez', async () => {
    // Um atendimento do PA novo, sem atendimento médico.
    const atd = await entrar('SINT.ATENDIMENTO');
    const novo = await abrirPa(atd, 1001);
    const r = await post(enf, `/pa/classificacao/${novo}`, {
      versaoProtocolo: versao,
      fluxograma: 'geral',
      discriminadores: [],
      sinais: { ...SINAIS, dor: 6 },
      queixa: 'Mal-estar',
      corFinal: 'amarelo',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().classificacao.cor).toBe('amarelo');
    desvioMin = 61;
    const fila = (await get(enf, '/pa/classificacao/fila')).json();
    expect(fila.reclassificarAgora.map((x: { reg: number }) => x.reg)).toContain(novo);
    const sv = new ServicoClassificacao(classificacao, {
      paAbertos: (c) => atendimento.paAbertos(c as Parameters<typeof atendimento.paAbertos>[0]),
      pacienteDoAtendimento: async () => null,
    });
    const c = { rede: 'rede-sintetica', hospital: 'aa' };
    const est = await sv.estourados(c);
    expect(est.some((e) => e.reg === novo)).toBe(true);
    const alvo = est.find((e) => e.reg === novo)!;
    const a1 = await classificacao.gravar(c, null, (g) => g.avisarEstouro(alvo));
    const a2 = await classificacao.gravar(c, null, (g) => g.avisarEstouro(alvo));
    expect([a1, a2]).toEqual([true, false]);
    expect((await sv.estourados(c)).some((e) => e.reg === novo)).toBe(false);
    const t = (await get(enf, `/pa/classificacao/${novo}`)).json();
    expect(t.risco).toMatchObject({ estourado: true, reclassificar: true });
    const rr = await post(enf, `/pa/classificacao/${novo}/reclassificar`, {
      versaoProtocolo: versao,
      fluxograma: 'geral',
      discriminadores: [],
      sinais: { ...SINAIS, dor: 6 },
      queixa: 'Mal-estar',
      corFinal: 'laranja',
      justificativaSobreposicao: 'Piora na espera, mais de uma hora',
      anterior: t.vigente.id,
      motivo: 'estouro',
    });
    expect(rr.statusCode, rr.body).toBe(201);
    expect(rr.json().classificacao).toMatchObject({ cor: 'laranja', sobreposta: true, motivo: 'estouro' });
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.classificacao.corSobreposta')).toBe(true);
    desvioMin = 0;
  });

  it('as cores antigas (consulta) e os indicadores com numerador e denominador', async () => {
    const cores = (await get(enf, '/pa/cores-legado')).json();
    expect(cores).toHaveLength(7);
    expect(cores[1]).toMatchObject({ corHex: '#ff8000', corEquivalente: 'laranja' });
    expect(cores[6].corEquivalente).toBeNull();
    const i = await get(enf, '/pa/classificacao/indicadores');
    expect(i.statusCode, i.body).toBe(200);
    expect(i.json().reclassificacoes.denominador).toBeGreaterThan(0);
    expect(i.json().dentroDoAlvo).toHaveLength(5);
    expect(
      (await get(enf, '/pa/classificacao/indicadores?inicio=2026-10-10&fim=2026-10-01')).statusCode,
    ).toBe(400);
  });
});

describe('indicadores do período pelo motor do domínio (regra 5)', () => {
  const c = { rede: 'sintetica', hospital: 'zz' };
  let relogio = '';
  const porta = new PortaClassificacaoMemoria({ agora: () => new Date(`${relogio}-03:00`) });
  const servico = new ServicoClassificacao(
    porta,
    {
      paAbertos: async () => ({ itens: [], cortada: false }),
      pacienteDoAtendimento: async () => null,
    },
    null,
  );
  async function classificar(
    cab: string,
    em: string,
    cor: string,
    tempoAlvoMin: number,
    anterior: number | null,
  ) {
    relogio = em;
    return porta.gravar(c, null, (g) =>
      g.classificar({
        cabecalho: cab,
        queixa: 'Mal-estar (SINTETICO)',
        reg: Number(cab),
        paciente: 900 + Number(cab),
        versaoProtocolo: 1,
        fluxograma: 'mal-estar',
        discriminadores: [],
        automaticos: [],
        sinais: { ...SINAIS },
        corProposta: cor,
        corFinal: cor,
        justificativa: null,
        motivo: anterior === null ? 'inicial' : 'estouro',
        descricaoMudanca: null,
        anterior,
        tempoAlvoMin,
        horaSinais: em,
        e08: { situacao: 'desligado' },
        autor: 'SINT.ENFERMEIRO.PA',
      }),
    );
  }

  it('um universo só (abertos e encerrados do período); o prazo vencido sem médico fica fora do tempo-alvo', async () => {
    // 1: amarelo (60 min) às 10:05, sem médico até as 12:00 → fora do tempo-alvo; reclassificado às 11:10.
    const p1 = await classificar('1', '2026-10-20T10:05:00', 'amarelo', 60, null);
    await classificar('1', '2026-10-20T11:10:00', 'laranja', 10, p1.id);
    // 2: verde (120 min), já encerrado: médico às 08:30, saída às 09:00 → dentro do tempo-alvo.
    await classificar('2', '2026-10-20T08:10:00', 'verde', 120, null);
    // 3: laranja (10 min) às 11:55, ainda no prazo às 12:00 → fora do denominador.
    await classificar('3', '2026-10-20T11:55:00', 'laranja', 10, null);
    // 4: chegou e não foi classificado (conta nos atendimentos, não no tempo-alvo).
    const marcas = [
      { cabecalho: '1', etapa: 'abertura', em: '2026-10-20T10:00:00' },
      { cabecalho: '2', etapa: 'abertura', em: '2026-10-20T08:00:00' },
      { cabecalho: '2', etapa: 'atendimentoMedico', em: '2026-10-20T08:30:00' },
      { cabecalho: '2', etapa: 'saida', em: '2026-10-20T09:00:00' },
      { cabecalho: '3', etapa: 'abertura', em: '2026-10-20T11:50:00' },
      { cabecalho: '4', etapa: 'abertura', em: '2026-10-20T11:58:00' },
    ];
    const r = await servico.indicadores(c, '2026-10-20', '2026-10-20', marcas, '2026-10-20T12:00:00');
    const cor = (k: string) => r.dentroDoAlvo.find((x) => x.cor === k);
    expect(cor('amarelo')).toMatchObject({ numerador: 0, denominador: 1, percentual: 0 });
    expect(cor('verde')).toMatchObject({ numerador: 1, denominador: 1, percentual: 100 });
    expect(cor('laranja')).toMatchObject({ numerador: 0, denominador: 0, percentual: null });
    expect(r.portaClassificacao).toEqual({ medianaMin: 5, atendimentos: 4, comMarca: 3 });
    expect(r.portaMedico).toEqual({ medianaMin: 30, atendimentos: 4, comMarca: 1 });
    // Reclassificados entre os classificados do mesmo universo (1 de 3), não as linhas soltas do período.
    expect(r.reclassificacoes).toEqual({ numerador: 1, denominador: 3, percentual: 33.3 });
    // Outro período: nenhum atendimento, nenhuma razão.
    const vazio = await servico.indicadores(c, '2026-10-01', '2026-10-02', [], '2026-10-20T12:00:00');
    expect(vazio.portaClassificacao.atendimentos).toBe(0);
    expect(vazio.reclassificacoes.percentual).toBeNull();
  });
});

describe('peças puras do serviço', () => {
  it('categoria pelo CBO, o ator, o encerrado e as iniciais', () => {
    expect(categoriaPeloCbo('223505')).toBe('enfermeiro');
    expect(categoriaPeloCbo('322205')).toBe('tecnico-enfermagem');
    expect(categoriaPeloCbo('225125')).toBe('medico');
    expect(categoriaPeloCbo('411010')).toBe('outra');
    expect(categoriaPeloCbo(null)).toBe('administrativo');
    expect(atorDoVinculo(null)).toEqual({
      categoria: 'administrativo',
      conselhoAtivo: false,
      vinculoAssistencial: false,
    });
    expect(encerradoNoPa({ saida: null, marcas: [{ etapa: 'decisao', em: '' }] })).toBe(true);
    expect(encerradoNoPa({ saida: 'alta', marcas: [] })).toBe(true);
    expect(encerradoNoPa({ saida: null, marcas: [] })).toBe(false);
    expect(iniciais('MARIA DA SILVA SANTOS')).toBe('M. S. S.');
  });
});

describe('W1-04 (revisão): nome social e sigiloso no painel de TV do PA e na fila da classificação', () => {
  const c = { rede: 'sintetica', hospital: 'ns' };
  const porta = new PortaClassificacaoMemoria({ agora: () => new Date('2026-11-19T10:00:00-03:00') });
  const item = (reg: number, paciente: string, prontuario: number, nomeSocial: string | null) => ({
    reg,
    cabecalho: String(7000 + reg),
    paciente,
    nascimento: '1990-01-01',
    senha: null,
    prioridade: '2' as const,
    chegada: '2026-11-19 09:30:00',
    profissional: '',
    marcas: [],
    leito: null,
    observacaoDesde: null,
    comMarcas: false,
    saida: null,
    prontuario,
    nomeSocial,
  });
  const servico = new ServicoClassificacao(porta, {
    sigilosos: async (_c, ps) => new Set(ps.filter((p) => p === 3)),
    paAbertos: async () => ({
      itens: [
        item(1, 'JOAO DA SILVA', 1, 'Ana Souza'),
        item(2, 'MARIA APARECIDA', 2, null),
        item(3, 'PEDRO SIGILOSO SANTOS', 3, 'Paula Santos'),
      ],
      cortada: false,
    }),
    pacienteDoAtendimento: async () => null,
  });

  it('o painel de TV usa as iniciais do nome social e o sigiloso fica sem iniciais', async () => {
    const p = await servico.painel(c);
    const rotulos = p.linhas.map((l) => l.rotulo);
    expect(rotulos).toContain('A. S.');
    expect(rotulos).toContain('M. A.');
    expect(rotulos).not.toContain('J. D. S.');
    expect(rotulos).not.toContain('J. S.');
    expect(rotulos.filter((r) => r === '')).toHaveLength(1);
    expect(JSON.stringify(p)).not.toMatch(/P\. S\.|PEDRO|Paula/);
  });

  it('a fila da classificação mostra o nome social e mascara o sigiloso', async () => {
    const f = await servico.fila(c);
    const nomes = f.itens.map((i) => i.paciente);
    expect(nomes).toEqual(expect.arrayContaining(['Ana Souza', 'MARIA APARECIDA', 'Paciente sigiloso']));
    expect(JSON.stringify(f)).not.toMatch(/JOAO|PEDRO|Paula/);
  });
});
