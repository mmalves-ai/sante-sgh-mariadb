// W0-04 (programa CRUD completo): correção e cancelamento da gestão da qualidade pela HTTP, com a sessão real sobre a
// fonte sintética e a porta EM MEMÓRIA (dados sintéticos): a auditoria alterada com versão e a cancelada (recusa de
// órfão com a NC aberta dela); a ata retificada (a anterior acessível), assinada e a reunião com ata assinada que não se
// cancela; a NC duplicada cancelada; a manifestação corrigida antes do encaminhamento e cancelada com motivo.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCcihMemoria } from './porta-ccih-memoria.js';
import { PortaGestaoMemoria } from './porta-gestao-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-10-27 12:00 em São Paulo. */
const agora = () => new Date('2026-10-27T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}
let app: NestFastifyApplication;
let qu: Sessao;
let ou: Sessao;

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
    headers: { cookie: s.cookie, 'x-csrf': s.csrf },
    payload: payload as object,
  });
const json = <T = Record<string, unknown>>(r: { body: string }) => JSON.parse(r.body) as T;
const codigo = (r: { body: string }) => json<{ codigo?: string }>(r).codigo;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha: new RegistradorTrilhaMemoria(),
    gestao: new PortaGestaoMemoria({ agora }),
    ccih: new PortaCcihMemoria({ agora }),
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  qu = await entrar('SINT.QUALIDADE');
  ou = await entrar('SINT.OUVIDORIA');
});
afterAll(async () => {
  await app.close();
});

const aud = {
  titulo: 'Auditoria de identificação do paciente',
  area: 'UTI',
  referencial: 'interno',
  realizadaEm: '2026-10-20',
  auditores: 'Equipe da qualidade (sintético)',
  itens: [{ requisito: 'Pulseira no paciente', secao: 'Meta 1', resultado: 'conforme', evidencia: null }],
  conclusao: 'Identificação conforme na amostra.',
};
const nc = (idOrigem: number | null, origem = 'auditoria') => ({
  naoConformidade: null,
  versao: null,
  origem,
  idOrigem,
  descricao: 'Dupla checagem não realizada na UTI (sintético).',
  area: 'UTI',
  classificacao: 'maior',
  acaoImediata: null,
  causa: null,
  plano: null,
  responsavel: null,
  prazo: null,
  situacao: 'aberta',
  eficacia: null,
  eficaciaTexto: null,
});

describe('auditoria interna e não conformidade', () => {
  it('altera com versão (a anterior acessível); cancela com motivo e senha; a NC aberta dela impede (órfão)', async () => {
    const r = await post(qu, '/qualidade/gestao/auditorias', aud);
    expect(r.statusCode, r.body).toBe(201);
    const id = json<{ id: number }>(r).id;
    const alt = await post(qu, `/qualidade/gestao/auditorias/${String(id)}/alteracao`, {
      versao: 1,
      titulo: aud.titulo,
      area: 'UTI adulto',
      realizadaEm: aud.realizadaEm,
      auditores: aud.auditores,
      itens: [
        ...aud.itens,
        {
          requisito: 'Dupla checagem',
          secao: 'Meta 1',
          resultado: 'naoConforme',
          evidencia: '2 de 10 sem dupla checagem',
        },
      ],
      conclusao: 'Necessita reforço na dupla checagem.',
      justificativa: 'Item de dupla checagem esquecido no lançamento',
    });
    expect(alt.statusCode, alt.body).toBe(201);
    const v = json<{ itens: { versao: number; acao: string; dados: { area: string } }[] }>(
      await get(qu, `/qualidade/gestao/versoes/auditoria/${String(id)}`),
    );
    expect(v.itens[0]).toMatchObject({ versao: 1, acao: 'correcao', dados: { area: 'UTI' } });
    const lida = json<{ area: string; versao: number }>(
      await get(qu, `/qualidade/gestao/auditorias/${String(id)}`),
    );
    expect(lida).toMatchObject({ area: 'UTI adulto', versao: 2 });
    const n = await post(qu, '/qualidade/gestao/nao-conformidades', nc(id));
    expect(n.statusCode, n.body).toBe(201);
    const ncId = json<{ id: number }>(n).id;
    const semSenha = await post(qu, `/qualidade/gestao/auditorias/${String(id)}/cancelamento`, {
      versao: 2,
      justificativa: 'Auditoria lançada em duplicidade',
    });
    expect(semSenha.statusCode).toBe(401);
    const orfa = await post(qu, `/qualidade/gestao/auditorias/${String(id)}/cancelamento`, {
      versao: 2,
      justificativa: 'Auditoria lançada em duplicidade',
      senha: SENHA,
    });
    expect([orfa.statusCode, codigo(orfa)]).toEqual([409, 'com-dependentes']);
    expect(json<{ avisos: string[] }>(orfa).avisos).toEqual([
      `Não conformidades da auditoria (1): nº ${String(ncId)}.`,
    ]);
    // A NC aberta por engano se cancela (com motivo e senha); depois a auditoria também.
    const cn = await post(qu, `/qualidade/gestao/nao-conformidades/${String(ncId)}/cancelamento`, {
      versao: 1,
      duplicadaDe: null,
      justificativa: 'Aberta por engano na auditoria errada',
      senha: SENHA,
    });
    expect(cn.statusCode, cn.body).toBe(201);
    const ca = await post(qu, `/qualidade/gestao/auditorias/${String(id)}/cancelamento`, {
      versao: 2,
      justificativa: 'Auditoria lançada em duplicidade',
      senha: SENHA,
    });
    expect(ca.statusCode, ca.body).toBe(201);
    const lista = json<{
      itens: { id: number; canceladaEm: string | null; motivoCancelamento: string | null }[];
    }>(await get(qu, '/qualidade/gestao/auditorias'));
    expect(lista.itens.find((x) => x.id === id)).toMatchObject({
      canceladaEm: expect.any(String),
      motivoCancelamento: 'Auditoria lançada em duplicidade',
    });
    const de_novo = await post(qu, `/qualidade/gestao/auditorias/${String(id)}/alteracao`, {
      ...aud,
      versao: 3,
      justificativa: 'Tentativa depois do cancelamento',
    });
    expect([de_novo.statusCode, codigo(de_novo)]).toEqual([409, 'registro-cancelado']);
  });

  it('a NC duplicada se cancela apontando a original; a em tratamento não', async () => {
    const a1 = json<{ id: number }>(
      await post(qu, '/qualidade/gestao/nao-conformidades', nc(null, 'externa')),
    ).id;
    const a2 = json<{ id: number }>(
      await post(qu, '/qualidade/gestao/nao-conformidades', nc(null, 'externa')),
    ).id;
    const desi = await post(qu, `/qualidade/gestao/nao-conformidades/${String(a2)}/cancelamento`, {
      versao: 1,
      duplicadaDe: a2,
      justificativa: 'Duplicada da NC aberta antes',
      senha: SENHA,
    });
    expect([desi.statusCode, codigo(desi)]).toEqual([422, 'duplicada-de-si']);
    const ok = await post(qu, `/qualidade/gestao/nao-conformidades/${String(a2)}/cancelamento`, {
      versao: 1,
      duplicadaDe: a1,
      justificativa: 'Duplicada da NC aberta antes',
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(201);
    // A original com uma duplicada apontando para ela não se cancela (o vínculo ficaria órfão).
    const orig = await post(qu, `/qualidade/gestao/nao-conformidades/${String(a1)}/cancelamento`, {
      versao: 1,
      duplicadaDe: null,
      justificativa: 'Tentativa de cancelar a original',
      senha: SENHA,
    });
    expect([orig.statusCode, codigo(orig)]).toEqual([409, 'com-dependentes']);
  });
});

describe('reunião e ata', () => {
  let reuniao = 0;
  it('retifica a ata por versão (a anterior acessível); assinada, a reunião não se cancela e pede a retificação', async () => {
    const c = await post(qu, '/qualidade/gestao/comissoes', {
      comissao: null,
      versao: null,
      tipo: 'ccih',
      nome: 'Comissão de controle de infecção (W0-04)',
      periodicidade: 'mensal',
      membros: [
        { nome: 'Médica infectologista', funcao: 'Presidente', login: null },
        { nome: 'Enfermeira da CCIH', funcao: 'Secretária', login: 'SINT.CCIH' },
      ],
      ativa: true,
    });
    expect(c.statusCode, c.body).toBe(201);
    const comissao = json<{ id: number }>(c).id;
    const r = await post(qu, `/qualidade/gestao/comissoes/${String(comissao)}/reunioes`, {
      tipo: 'ordinaria',
      realizadaEm: '2026-10-20T14:00',
      pauta: 'Indicadores de setembro',
      ata: 'Apresentada a densidade de IPCS; aprovado o reforço do bundle (sintético).',
      versaoComissao: 1,
      presentes: [0],
      convidados: null,
      deliberacoes: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    reuniao = json<{ id: number }>(r).id;
    const ret = await post(qu, `/qualidade/gestao/reunioes/${String(reuniao)}/retificacao`, {
      versao: 1,
      pauta: 'Indicadores de setembro',
      ata: 'Apresentada a densidade de IPCS de setembro; aprovado o reforço do bundle de CVC (sintético).',
      presentes: [0, 1],
      convidados: null,
      deliberacoes: null,
      justificativa: 'Faltou a presença da enfermeira da CCIH',
    });
    expect(ret.statusCode, ret.body).toBe(201);
    const v = json<{ itens: { acao: string; dados: { presentesTotal: number } }[] }>(
      await get(qu, `/qualidade/gestao/versoes/reuniao/${String(reuniao)}`),
    );
    expect(v.itens[0]).toMatchObject({ acao: 'retificacao', dados: { presentesTotal: 1 } });
    const ass = await post(qu, `/qualidade/gestao/reunioes/${String(reuniao)}/assinatura`, {
      versao: 2,
      senha: SENHA,
    });
    expect(ass.statusCode, ass.body).toBe(201);
    const can = await post(qu, `/qualidade/gestao/reunioes/${String(reuniao)}/cancelamento`, {
      versao: 3,
      justificativa: 'Reunião lançada na comissão errada',
      senha: SENHA,
    });
    expect([can.statusCode, codigo(can)]).toEqual([409, 'ata-assinada']);
    expect(json<{ detail: string }>(can).detail).toMatch(/Retifique a ata/);
    const rs = json<{
      itens: { id: number; versao: number; ataAssinadaEm: string | null; presentesTotal: number }[];
    }>(await get(qu, `/qualidade/gestao/comissoes/${String(comissao)}/reunioes`));
    expect(rs.itens.find((x) => x.id === reuniao)).toMatchObject({
      versao: 3,
      ataAssinadaEm: expect.any(String),
      presentesTotal: 2,
    });
    // A reunião sem ata assinada se cancela com motivo e fica visível como cancelada.
    const r2 = await post(qu, `/qualidade/gestao/comissoes/${String(comissao)}/reunioes`, {
      tipo: 'extraordinaria',
      realizadaEm: '2026-10-21T14:00',
      pauta: 'Surto (lançada errado)',
      ata: 'Reunião lançada na comissão errada, sem conteúdo (sintético).',
      versaoComissao: 1,
      presentes: [0],
      convidados: null,
      deliberacoes: null,
    });
    const id2 = json<{ id: number }>(r2).id;
    const ok = await post(qu, `/qualidade/gestao/reunioes/${String(id2)}/cancelamento`, {
      versao: 1,
      justificativa: 'Reunião lançada na comissão errada',
      senha: SENHA,
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });
});

describe('ouvidoria', () => {
  it('corrige tipo, área e relato antes do encaminhamento; depois, recusa; cancela com motivo', async () => {
    const m = await post(ou, '/qualidade/ouvidoria/manifestacoes', {
      canal: 'telefone',
      tipo: 'reclamacao',
      identificada: true,
      paciente: null,
      manifestante: 'Manifestante sintético',
      contato: null,
      area: 'Recepção',
      relato: 'Demora no atendimento da recepção (sintético).',
      recebidaEm: '2026-10-26T10:00',
      pesquisa: null,
    });
    expect(m.statusCode, m.body).toBe(201);
    const id = json<{ id: number }>(m).id;
    const c = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(id)}/correcao`, {
      versao: 1,
      tipo: 'sugestao',
      area: 'Recepção central',
      relato: 'Sugestão de senha eletrônica na recepção (sintético).',
      justificativa: 'Tipo e relato registrados errado no telefone',
    });
    expect(c.statusCode, c.body).toBe(201);
    const enc = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(id)}/encaminhamento`, {
      versao: 2,
      encaminhadaA: 'Coordenação da recepção',
      observacao: null,
    });
    expect(enc.statusCode, enc.body).toBe(201);
    const tarde = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(id)}/correcao`, {
      versao: 3,
      tipo: 'reclamacao',
      area: 'Recepção central',
      relato: 'Sugestão de senha eletrônica na recepção (sintético).',
      justificativa: 'Tentativa depois do encaminhamento',
    });
    expect([tarde.statusCode, codigo(tarde)]).toEqual([409, 'manifestacao-encaminhada']);
    const can = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(id)}/cancelamento`, {
      versao: 3,
      justificativa: 'Manifestação registrada em duplicidade',
      senha: SENHA,
    });
    expect(can.statusCode, can.body).toBe(201);
    const lida = json<{ canceladaEm: string | null; motivoCancelamento: string | null; protocolo: string }>(
      await get(ou, `/qualidade/ouvidoria/manifestacoes/${String(id)}`),
    );
    expect(lida).toMatchObject({
      canceladaEm: expect.any(String),
      protocolo: expect.stringMatching(/^OUV-/),
    });
    const resp = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(id)}/resposta`, {
      versao: 4,
      resposta: 'Resposta depois do cancelamento',
      procedente: true,
    });
    expect([resp.statusCode, codigo(resp)]).toEqual([409, 'registro-cancelado']);
  });
});

describe('ouvidoria (M4): canal de origem, prazo parametrizável e indicadores', () => {
  const nova = (canal: string, tipo: string, area: string, recebidaEm: string) => ({
    canal,
    tipo,
    identificada: false,
    paciente: null,
    manifestante: null,
    contato: null,
    area,
    relato: 'Relato sintético da manifestação do M4 (sintético).',
    recebidaEm,
    pesquisa: null,
  });

  it('o canal da Hal-AI fica desligado pelo parâmetro (padrão); o portal entra com o prazo padrão de 10 dias úteis', async () => {
    const h = await post(
      ou,
      '/qualidade/ouvidoria/manifestacoes',
      nova('halai', 'elogio', 'UTI', '2026-10-26T09:00'),
    );
    expect([h.statusCode, codigo(h)]).toEqual([422, 'canal-halai-desligado']);
    expect(json<{ detail: string }>(h).detail).toMatch(/ainda não foi configurado/);
    const p = await post(
      ou,
      '/qualidade/ouvidoria/manifestacoes',
      nova('portal', 'elogio', 'UTI', '2026-10-26T09:00'),
    );
    expect(p.statusCode, p.body).toBe(201);
    // 26/10/2026 (segunda): 10 dias úteis sem contar o dia, com o feriado de 02/11 → 10/11.
    expect(json<{ prazoEm: string }>(p).prazoEm).toBe('2026-11-10T23:59:59');
    const l = json<{ prazoDiasUteis: number; canalHalai: boolean }>(
      await get(ou, '/qualidade/ouvidoria/manifestacoes'),
    );
    expect(l).toMatchObject({ prazoDiasUteis: 10, canalHalai: false });
  });

  it('indicadores da competência: no prazo, por tipo, por área e por canal, sem as canceladas', async () => {
    const a = await post(
      ou,
      '/qualidade/ouvidoria/manifestacoes',
      nova('telefone', 'reclamacao', 'Recepção', '2026-10-20T08:00'),
    );
    const ida = json<{ id: number }>(a).id;
    const r = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(ida)}/resposta`, {
      versao: 1,
      resposta: 'Escala reforçada (sintético).',
      procedente: true,
    });
    expect(r.statusCode, r.body).toBe(201);
    const c = await post(
      ou,
      '/qualidade/ouvidoria/manifestacoes',
      nova('presencial', 'sugestao', 'Farmácia', '2026-10-21T08:00'),
    );
    const idc = json<{ id: number }>(c).id;
    const canc = await post(ou, `/qualidade/ouvidoria/manifestacoes/${String(idc)}/cancelamento`, {
      versao: 1,
      justificativa: 'Registrada em duplicidade no balcão',
      senha: SENHA,
    });
    expect(canc.statusCode, canc.body).toBe(201);
    const i = await get(ou, '/qualidade/ouvidoria/indicadores?competencia=2026-10');
    expect(i.statusCode, i.body).toBe(200);
    const x = json<{
      total: number;
      canceladas: number;
      respondidas: number;
      prazoDiasUteis: number;
      noPrazo: { numerador: number; denominador: number; conta: string | null };
      porTipo: { chave: string; total: number }[];
      porArea: { chave: string; total: number }[];
      porCanal: { chave: string; total: number }[];
    }>(i);
    expect(x.prazoDiasUteis).toBe(10);
    expect(x.canceladas).toBeGreaterThanOrEqual(1);
    expect(x.respondidas).toBeGreaterThanOrEqual(1);
    expect(x.noPrazo.numerador).toBeGreaterThanOrEqual(1);
    expect(x.noPrazo.conta).toMatch(/÷/);
    expect(x.porTipo.find((g) => g.chave === 'reclamacao')?.total).toBeGreaterThanOrEqual(1);
    expect(x.porArea.find((g) => g.chave === 'Farmácia')).toBeUndefined();
    expect(x.porCanal.find((g) => g.chave === 'portal')?.total).toBe(1);
    const fora = await get(ou, '/qualidade/ouvidoria/indicadores?competencia=2026-09');
    expect(json<{ total: number }>(fora).total).toBe(0);
  });
});
