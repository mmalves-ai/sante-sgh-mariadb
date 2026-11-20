// M44, etapa 3 (protocolos gerenciados no PA) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM
// MEMÓRIA (nada conecta a banco): a definição publicada só pela diretoria clínica (reautenticação, autor ≠ aprovador),
// a sugestão pelo discriminador da classificação, a inclusão pelo enfermeiro ou pelo médico (o técnico não inclui; a
// recepção não vê), o relógio com a meta "ECG em 10 min", a meta perdida com o motivo (regra 8), a hora real conferida,
// o chip no quadro do PA, o encerramento e a adesão com numerador e denominador; cada gravação com o evento na trilha.
// Dados sintéticos.
import { PROTOCOLO_SINTETICO, PROTOCOLOS_GERENCIADOS_SINTETICOS } from '@sgh/dominio-recepcao';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaAtendimentoMemoria } from '../atendimento/porta-memoria.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { PortaClassificacaoMemoria } from './classificacao-porta-memoria.js';
import { PortaRecepcaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const recepcao = new PortaRecepcaoMemoria({ estado: () => 'verde' });
const atendimento = new PortaAtendimentoMemoria(
  { estado: () => 'verde' },
  { lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids), recepcao },
);
const classificacao = new PortaClassificacaoMemoria({ trilha });
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    cadastro,
    recepcao,
    atendimento,
    classificacao,
    vigia: null,
  });
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
  'idempotency-key': `teste-m44-ger-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const DOR = PROTOCOLOS_GERENCIADOS_SINTETICOS.find((p) => p.tipo === 'dor-toracica')!;
const SINAIS = {
  pas: 130,
  pad: 85,
  fc: 104,
  fr: 20,
  temperatura: 37.2,
  saturacao: 96,
  glicemia: null,
  dor: 6,
  glasgow: 15,
};
const hhmm = (iso: string, mais = 0) =>
  new Date(Date.parse(`${iso.slice(0, 19)}Z`) + mais * 60_000).toISOString().slice(0, 16);

describe('protocolos gerenciados no PA (M44, etapa 3)', () => {
  let enf: Sessao;
  let dir: Sessao;
  let reg = 0;
  let versao = 0;
  let protocolo = 0;

  it('a definição: só a diretoria clínica publica, com a senha e outro autor; a vigente aparece no relógio', async () => {
    enf = await entrar('SINT.ENFERMEIRO.PA');
    dir = await entrar('SINT.DIRETOR.CLINICO');
    const base = { autor: 'SINT.ENFERMEIRO.PA', conteudo: DOR, notas: 'Primeira versão sintética' };
    expect(
      (await post(enf, '/pa/protocolos-gerenciados/definicoes', { ...base, senha: SENHA })).statusCode,
    ).toBe(403);
    expect(
      (await post(dir, '/pa/protocolos-gerenciados/definicoes', { ...base, senha: 'errada' })).statusCode,
    ).toBe(401);
    const auto = await post(dir, '/pa/protocolos-gerenciados/definicoes', {
      ...base,
      autor: 'SINT.DIRETOR.CLINICO',
      senha: SENHA,
    });
    expect(auto.json().codigo).toBe('autoaprovacao');
    const r = await post(dir, '/pa/protocolos-gerenciados/definicoes', { ...base, senha: SENHA });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().versao).toBe(1);
    versao = r.json().id;
    const d = (await get(enf, '/pa/protocolos-gerenciados/definicoes')).json();
    expect(d[0].versao).toMatchObject({ id: versao, vigente: true, aprovador: 'SINT.DIRETOR.CLINICO' });
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.protocoloGerenciado.publicado')).toBe(true);
    // O protocolo de classificação (etapa 1) para a sugestão pelo discriminador.
    const pc = await post(dir, '/pa/protocolos', {
      autor: 'SINT.ENFERMEIRO.PA',
      conteudo: PROTOCOLO_SINTETICO,
      notas: 'Classificação sintética',
      senha: SENHA,
    });
    expect(pc.statusCode, pc.body).toBe(201);
    const f = (await get(enf, '/pa/classificacao/fila')).json();
    reg = f.itens[0].reg;
    const c = await post(enf, `/pa/classificacao/${reg}`, {
      versaoProtocolo: pc.json().id,
      fluxograma: 'dor-toracica',
      discriminadores: ['dor-precordial'],
      sinais: SINAIS,
      queixa: 'Dor no peito em aperto',
      corFinal: 'laranja',
    });
    expect(c.statusCode, c.body).toBe(201);
  });

  it('a classificação sugere a dor torácica; o técnico não inclui; a recepção não vê; o enfermeiro inclui', async () => {
    const rel = await get(enf, '/pa/protocolos-gerenciados/relogio');
    expect(rel.statusCode, rel.body).toBe(200);
    const x = rel.json();
    expect(x.sugestoes).toEqual([
      expect.objectContaining({ reg, tipo: 'dor-toracica', discriminador: 'dor-precordial' }),
    ]);
    expect(x.acoes).toEqual({ iniciar: true, registrar: true, motivo: null });
    expect(x.vigentes.map((v: { versao: { tipo: string } }) => v.versao.tipo)).toEqual(['dor-toracica']);
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.protocoloPaciente.lido')).toBe(true);
    const tec = await entrar('SINT.TECNICO.PA');
    const t = await get(tec, '/pa/protocolos-gerenciados/relogio');
    expect(t.statusCode).toBe(200);
    expect(t.json().acoes.iniciar).toBe(false);
    const corpo = {
      atendimento: reg,
      tipo: 'dor-toracica',
      versao,
      sugeridoPor: 'dor-precordial',
      criterios: ['dor-precordial'],
    };
    expect((await post(tec, '/pa/protocolos-gerenciados', corpo)).statusCode).toBe(403);
    const rec = await entrar('SINT.SUPERVISOR.ATD');
    expect((await get(rec, '/pa/protocolos-gerenciados/relogio')).statusCode).toBe(403);
    expect(
      (await post(enf, '/pa/protocolos-gerenciados', { ...corpo, versao: versao + 9 })).json().codigo,
    ).toBe('versao-desatualizada');
    expect(
      (await post(enf, '/pa/protocolos-gerenciados', { ...corpo, criterios: ['inventado'] })).json().codigo,
    ).toBe('criterio-desconhecido');
    expect((await post(enf, '/pa/protocolos-gerenciados', { ...corpo, tipo: 'sepse' })).json().codigo).toBe(
      'sem-definicao',
    );
    // Revisão do M44.3: a origem "sugerido" só com o discriminador da classificação vigente que sugere o protocolo.
    const inventada = await post(enf, '/pa/protocolos-gerenciados', { ...corpo, sugeridoPor: 'qualquer' });
    expect(inventada.statusCode, inventada.body).toBe(422);
    expect(inventada.json().codigo).toBe('sugestao-invalida');
    const r = await post(enf, '/pa/protocolos-gerenciados', corpo);
    expect(r.statusCode, r.body).toBe(201);
    protocolo = r.json().id;
    expect((await post(enf, '/pa/protocolos-gerenciados', corpo)).json().codigo).toBe('ja-incluido');
    const depois = (await get(enf, '/pa/protocolos-gerenciados/relogio')).json();
    expect(depois.sugestoes).toEqual([]);
    const p = depois.ativos.find((a: { id: number }) => a.id === protocolo);
    expect(p).toMatchObject({ tipo: 'dor-toracica', origem: 'sugerido', sugeridoPor: 'dor-precordial' });
    expect(p.metas.map((m: { codigo: string }) => m.codigo)).toEqual([
      'ecg',
      'avaliacao-medica',
      'troponina',
      'aas',
    ]);
    expect(p.proxima.titulo).toBe('ECG de 12 derivações');
    // O cartão do quadro do PA ganha o relógio do protocolo.
    const med = await entrar('SINT.MEDICO.PA');
    const q = (await get(med, '/pa/quadro')).json();
    const k = q.colunas
      .flatMap((c: { cartoes: { reg: number }[] }) => c.cartoes)
      .find((c: { reg: number }) => c.reg === reg);
    expect(k.protocolos).toEqual([
      expect.objectContaining({ tipo: 'dor-toracica', nomeTipo: 'Dor torácica' }),
    ]);
    // Revisão do M44.3: quem lê o quadro sem `recepcao.protocoloPaciente.ler` recebe o cartão sem o protocolo.
    const qr = await get(rec, '/pa/quadro');
    expect(qr.statusCode, qr.body).toBe(200);
    const kr = qr
      .json()
      .colunas.flatMap((c: { cartoes: { reg: number }[] }) => c.cartoes)
      .find((c: { reg: number }) => c.reg === reg);
    expect(kr).toBeDefined();
    expect(kr.protocolos).toBeUndefined();
  });

  it('regra 8: a meta no prazo é cumprida; a não feita exige o motivo; a hora no futuro é recusada; uma vez cada', async () => {
    const rel = (await get(enf, '/pa/protocolos-gerenciados/relogio')).json();
    const p = rel.ativos.find((a: { id: number }) => a.id === protocolo);
    const agora = rel.lidoEm as string;
    const url = `/pa/protocolos-gerenciados/${protocolo}/metas`;
    const futuro = await post(enf, url, { item: 'ecg', tipo: 'meta', feita: true, quando: hhmm(agora, 30) });
    expect(futuro.json().codigo).toBe('hora-no-futuro');
    const ecg = await post(enf, url, {
      item: 'ecg',
      tipo: 'meta',
      feita: true,
      quando: hhmm(p.chegadaEm, 1),
    });
    expect(ecg.statusCode, ecg.body).toBe(201);
    expect(ecg.json().mensagem).toMatch(/cumprida/);
    expect(
      (await post(enf, url, { item: 'ecg', tipo: 'meta', feita: true, quando: hhmm(p.chegadaEm, 1) })).json()
        .codigo,
    ).toBe('ja-registrado');
    const sem = await post(enf, url, { item: 'troponina', tipo: 'meta', feita: false });
    expect(sem.statusCode).toBe(422);
    expect(sem.json().codigo).toBe('motivo-obrigatorio');
    const perdida = await post(enf, url, {
      item: 'troponina',
      tipo: 'meta',
      feita: false,
      motivo: 'Laboratório sem reagente',
    });
    expect(perdida.statusCode, perdida.body).toBe(201);
    expect(perdida.json().mensagem).toMatch(/perdida/);
    expect(
      (await post(enf, url, { item: 'nao-existe', tipo: 'meta', feita: false, motivo: 'xxxxx' })).json()
        .codigo,
    ).toBe('meta-desconhecida');
    const chk = await post(enf, url, { item: 'aas', tipo: 'checklist', feita: true, quando: hhmm(agora) });
    expect(chk.statusCode, chk.body).toBe(201);
    const depois = (await get(enf, '/pa/protocolos-gerenciados/relogio'))
      .json()
      .ativos.find((a: { id: number }) => a.id === protocolo);
    const sit = depois.metas.map((m: { situacao: string }) => m.situacao);
    expect([sit[0], sit[2], sit[3]]).toEqual(['cumprida', 'perdida', 'feito']);
    expect(['no_prazo', 'vencendo', 'vencida']).toContain(sit[1]);
    expect(
      trilha.eventos.filter((e) => e.evento === 'recepcao.protocoloPaciente.metaRegistrada').length,
    ).toBe(3);
  });

  it('o encerramento com meta sem registro pede o motivo; depois dele nada entra; a adesão com numerador e denominador', async () => {
    const url = `/pa/protocolos-gerenciados/${protocolo}/encerrar`;
    expect((await post(enf, url, { desfecho: 'concluido' })).json().codigo).toBe('motivo-obrigatorio');
    const r = await post(enf, url, { desfecho: 'transferido', motivo: 'Encaminhado à hemodinâmica' });
    expect(r.statusCode, r.body).toBe(201);
    const meta = await post(enf, `/pa/protocolos-gerenciados/${protocolo}/metas`, {
      item: 'avaliacao-medica',
      tipo: 'meta',
      feita: false,
      motivo: 'Depois do encerramento',
    });
    expect(meta.json().codigo).toBe('protocolo-encerrado');
    expect((await post(enf, url, { desfecho: 'concluido', motivo: 'De novo' })).json().codigo).toBe(
      'protocolo-encerrado',
    );
    const rel = (await get(enf, '/pa/protocolos-gerenciados/relogio')).json();
    expect(rel.ativos.some((a: { id: number }) => a.id === protocolo)).toBe(false);
    expect(rel.encerradosHoje.find((a: { id: number }) => a.id === protocolo).encerrado).toMatchObject({
      desfecho: 'transferido',
    });
    expect(rel.adesao.find((a: { meta: string }) => a.meta === 'ecg')).toMatchObject({
      cumpridas: 1,
      registradas: 1,
      percentual: 100,
    });
    expect(rel.adesaoPeriodo).toMatchObject({ inclusoes: 1, truncado: false });
    expect(rel.adesao.find((a: { meta: string }) => a.meta === 'troponina')).toMatchObject({
      cumpridas: 0,
      registradas: 1,
    });
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.protocoloPaciente.encerrado')).toBe(true);
    // O médico com conselho também inclui (regra 8): as opções da evolução que o grupo dos médicos tem.
    const med = await entrar('SINT.MEDICO.NIR');
    const m = (await get(med, '/pa/protocolos-gerenciados/relogio')).json();
    expect(m.acoes.iniciar).toBe(true);
    expect(
      (
        await post(enf, '/pa/protocolos-gerenciados/999999/metas', {
          item: 'ecg',
          tipo: 'meta',
          feita: false,
          motivo: 'xxxxx',
        })
      ).statusCode,
    ).toBe(404);
  });
});
