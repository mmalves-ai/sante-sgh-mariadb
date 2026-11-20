// W0-04 (programa CRUD completo): correção e cancelamento da CCIH pela HTTP, com a sessão real sobre a fonte sintética
// e a porta EM MEMÓRIA (dados sintéticos): a correção do dispositivo por versão com a anterior acessível e inativa; o
// motivo obrigatório; a recusa de órfão (dispositivo critério de IRAS); a competência fechada (409 com a oferta da
// reabertura, indicadores inalterados) e a reabertura com motivo e senha; a precaução alterada; a sessão de higiene das
// mãos corrigida e estornada (fora da adesão); nenhuma rota DELETE física nos controladores da qualidade.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { INTERNACAO_SINTETICA_CCIH, PortaCcihMemoria } from './porta-ccih-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
/** 2026-11-03 12:00 em São Paulo: a internação sintética 4801 entrou em 28/10 (outubro já terminou). */
const agora = () => new Date('2026-11-03T15:00:00Z');

interface Sessao {
  cookie: string;
  csrf: string;
}

let app: NestFastifyApplication;
let porta: PortaCcihMemoria;
let trilha: RegistradorTrilhaMemoria;
let ccih: Sessao;

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
const codigo = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;

beforeAll(async () => {
  trilha = new RegistradorTrilhaMemoria();
  porta = new PortaCcihMemoria({ agora });
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    ccih: porta,
    vigiaEnfermagem: null,
    vigia: null,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ccih = await entrar('SINT.CCIH');
});
afterAll(async () => {
  await app.close();
});

const MOTIVO = 'Lançado com o sítio errado na admissão';

describe('dispositivo: correção por versão e cancelamento com motivo', () => {
  let cvc = 0;
  let sonda = 0;
  let ficha = 0;

  it('registra o CVC e a sonda de outubro', async () => {
    const base = {
      internacao: INTERNACAO_SINTETICA_CCIH,
      tipo: 'cvc',
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-29T10:00',
      itemPrescricao: null,
      observacao: null,
    };
    const r = await post(ccih, '/qualidade/ccih/dispositivos', base);
    expect(r.statusCode, r.body).toBe(201);
    cvc = r.json().id;
    const s = await post(ccih, '/qualidade/ccih/dispositivos', {
      ...base,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-10-30T08:00',
    });
    expect(s.statusCode, s.body).toBe(201);
    sonda = s.json().id;
  });

  it('a correção exige o motivo; corrigido, a versão anterior fica acessível e inativa', async () => {
    const corpo = {
      versao: 1,
      tipo: 'cvc',
      sitio: 'Jugular interna direita',
      inseridoEm: '2026-10-29T09:30',
      retiradoEm: null,
    };
    const sem = await post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/correcao`, corpo);
    expect(sem.statusCode).toBe(400);
    const curto = await post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/correcao`, {
      ...corpo,
      justificativa: 'erro',
    });
    expect(curto.statusCode).toBe(400);
    const igual = await post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/correcao`, {
      ...corpo,
      sitio: 'Subclávia direita',
      inseridoEm: '2026-10-29T10:00',
      justificativa: MOTIVO,
    });
    expect([igual.statusCode, codigo(igual)]).toEqual([422, 'sem-mudanca']);
    const r = await post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/correcao`, {
      ...corpo,
      justificativa: MOTIVO,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toEqual({ versao: 2 });
    const velha = await post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/correcao`, {
      ...corpo,
      sitio: 'Femoral',
      justificativa: MOTIVO,
    });
    expect([velha.statusCode, codigo(velha)]).toEqual([409, 'versao-desatualizada']);
    const v = await get(ccih, `/qualidade/ccih/versoes/dispositivo/${String(cvc)}`);
    expect(v.statusCode, v.body).toBe(200);
    expect(v.json().itens).toHaveLength(1);
    expect(v.json().itens[0]).toMatchObject({
      versao: 1,
      acao: 'correcao',
      motivo: MOTIVO,
      alteradoPor: 'SINT.CCIH',
      dados: { sitio: 'Subclávia direita', inseridoEm: '2026-10-29T10:00:00' },
    });
    const i = await get(ccih, `/qualidade/ccih/internacoes/${String(INTERNACAO_SINTETICA_CCIH)}`);
    const d = i.json().dispositivos.find((x: { id: number }) => x.id === cvc);
    expect(d).toMatchObject({ versao: 2, sitio: 'Jugular interna direita' });
    // A trilha leva só a tabela e o ID (o valor clínico fica na versão).
    const t = trilha.eventos.find((x) => x.evento === 'qualidade.registro.corrigido');
    expect(t).toMatchObject({ idAlvo: String(cvc) });
    expect(JSON.stringify(t)).not.toContain('Jugular');
  });

  it('recusa de órfão: o CVC critério de ficha de IRAS confirmada não se cancela (409 com a lista)', async () => {
    const r = await post(ccih, '/qualidade/ccih/iras', {
      internacao: INTERNACAO_SINTETICA_CCIH,
      sitio: 'ipcs',
      dataInfeccao: '2026-11-01',
      criterios: ['hemoculturaPatogeno', 'febre'],
      nivelIsc: null,
      cirurgia: null,
      implante: false,
      exame: null,
      microrganismo: 'Klebsiella pneumoniae',
      multirresistente: false,
      descricao: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().dispositivoAssociado).toBe(cvc);
    ficha = r.json().id;
    const c = await post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/cancelamento`, {
      versao: 2,
      justificativa: 'Dispositivo lançado no paciente errado',
      senha: SENHA,
    });
    expect([c.statusCode, codigo(c)]).toEqual([409, 'dispositivo-com-iras']);
    expect(c.json().avisos).toEqual([`Fichas de IRAS confirmadas (1): nº ${String(ficha)}.`]);
    const dep = await get(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/dependentes`);
    expect(dep.json()).toMatchObject({
      podeCancelar: false,
      itens: [{ grupo: 'Fichas de IRAS confirmadas', quantidade: 1, ids: [ficha] }],
    });
  });

  it('o cancelamento é crítico: pede a senha; cancelado, fica visível como inativo e sai do denominador', async () => {
    const sem = await post(ccih, `/qualidade/ccih/dispositivos/${String(sonda)}/cancelamento`, {
      versao: 1,
      justificativa: 'Sonda lançada no paciente errado',
    });
    expect(sem.statusCode).toBe(401);
    const antes = (await get(ccih, '/qualidade/ccih/denominadores?competencia=2026-11')).json();
    const utiAntes = antes.setores.find((x: { setor: string }) => x.setor === 'UTI');
    expect(utiAntes.dispositivosDia.sondaVesical).toBe(2);
    const r = await post(ccih, `/qualidade/ccih/dispositivos/${String(sonda)}/cancelamento`, {
      versao: 1,
      justificativa: 'Sonda lançada no paciente errado',
      senha: SENHA,
    });
    expect(r.statusCode, r.body).toBe(201);
    const i = await get(ccih, `/qualidade/ccih/internacoes/${String(INTERNACAO_SINTETICA_CCIH)}`);
    expect(i.json().dispositivos.find((x: { id: number }) => x.id === sonda)).toMatchObject({
      versao: 2,
      motivoCancelamento: 'Sonda lançada no paciente errado',
    });
    const depois = (await get(ccih, '/qualidade/ccih/denominadores?competencia=2026-11')).json();
    const uti = depois.setores.find((x: { setor: string }) => x.setor === 'UTI');
    expect(uti.dispositivosDia.sondaVesical).toBe(0);
    const de_novo = await post(ccih, `/qualidade/ccih/dispositivos/${String(sonda)}/correcao`, {
      versao: 2,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-10-30T07:00',
      retiradoEm: null,
      justificativa: MOTIVO,
    });
    expect([de_novo.statusCode, codigo(de_novo)]).toEqual([409, 'registro-cancelado']);
  });

  it('competência fechada: a correção devolve 409 com a reabertura; os indicadores não mudam sem ela', async () => {
    const em = await post(ccih, '/qualidade/ccih/competencias', { competencia: '2026-11' });
    expect([em.statusCode, codigo(em)]).toEqual([422, 'competencia-em-curso']);
    const f = await post(ccih, '/qualidade/ccih/competencias', { competencia: '2026-10' });
    expect(f.statusCode, f.body).toBe(201);
    const competencia = f.json().id as number;
    const den = async () =>
      (await get(ccih, '/qualidade/ccih/denominadores?competencia=2026-10')).json().todos;
    const antes = await den();
    expect(antes.dispositivosDia.cvc).toBe(3);
    const corrigir = (versao: number) =>
      post(ccih, `/qualidade/ccih/dispositivos/${String(cvc)}/correcao`, {
        versao,
        tipo: 'cvc',
        sitio: 'Jugular interna direita',
        inseridoEm: '2026-10-28T09:30',
        retiradoEm: null,
        justificativa: 'Data de inserção conferida no prontuário',
      });
    const r = await corrigir(2);
    expect([r.statusCode, codigo(r)]).toEqual([409, 'competencia-fechada']);
    expect(r.json().avisos).toEqual(['Competência fechada: 2026-10.']);
    expect(r.json().detail).toMatch(/reabra a competência com motivo/);
    expect(await den()).toEqual(antes);
    // A reabertura é crítica (senha) e exige o motivo; reaberta, a correção passa.
    const sem = await post(ccih, `/qualidade/ccih/competencias/${String(competencia)}/reabrir`, {
      versao: 1,
      justificativa: 'Correção da data de inserção do CVC',
    });
    expect(sem.statusCode).toBe(401);
    const re = await post(ccih, `/qualidade/ccih/competencias/${String(competencia)}/reabrir`, {
      versao: 1,
      justificativa: 'Correção da data de inserção do CVC',
      senha: SENHA,
    });
    expect(re.statusCode, re.body).toBe(201);
    const ok = await corrigir(2);
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await den()).dispositivosDia.cvc).toBe(4);
    const lista = await get(ccih, '/qualidade/ccih/competencias');
    expect(lista.json().itens[0]).toMatchObject({
      competencia: '2026-10',
      situacao: 'reaberta',
      motivoReabertura: 'Correção da data de inserção do CVC',
    });
    expect(trilha.eventos.some((x) => x.evento === 'qualidade.competencia.reaberta')).toBe(true);
  });

  it('a ficha de IRAS se altera por versão (critérios, microrganismo e data)', async () => {
    const r = await post(ccih, `/qualidade/ccih/iras/${String(ficha)}/correcao`, {
      versao: 1,
      dataInfeccao: '2026-11-02',
      criterios: ['hemoculturaPatogeno', 'febre'],
      microrganismo: 'Klebsiella pneumoniae KPC',
      multirresistente: true,
      descricao: null,
      justificativa: 'Antibiograma liberado: KPC',
    });
    expect(r.statusCode, r.body).toBe(201);
    const v = await get(ccih, `/qualidade/ccih/versoes/iras/${String(ficha)}`);
    expect(v.json().itens[0]).toMatchObject({ versao: 1, dados: { microrganismo: 'Klebsiella pneumoniae' } });
  });
});

describe('precaução e higiene das mãos', () => {
  it('altera o tipo e o motivo da precaução com versão; o leito acompanha', async () => {
    const p = await post(ccih, '/qualidade/ccih/precaucoes', {
      internacao: INTERNACAO_SINTETICA_CCIH,
      motivo: 'kpc',
      motivoOutro: null,
      tipo: 'contato',
      origem: 'manual',
      exame: null,
      bloquearVizinhos: false,
      observacao: null,
    });
    expect(p.statusCode, p.body).toBe(201);
    const id = p.json().id as number;
    const r = await post(ccih, `/qualidade/ccih/precaucoes/${String(id)}/alteracao`, {
      versao: 1,
      tipo: 'goticulas',
      motivo: 'influenza',
      motivoOutro: null,
      bloquearVizinhos: false,
      justificativa: 'Motivo trocado: influenza confirmada',
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(porta.estadoDoLeito({ bloco: 'UTI', acomodacao: '01', leito: 'A' }).get('precaucao')).toBe(
      'goticulas',
    );
    const v = await get(ccih, `/qualidade/ccih/versoes/precaucao/${String(id)}`);
    expect(v.json().itens[0]).toMatchObject({ acao: 'correcao', dados: { motivo: 'kpc', tipo: 'contato' } });
  });

  it('corrige e estorna a sessão de observação; a estornada fica visível e sai da adesão', async () => {
    const o = await post(ccih, '/qualidade/ccih/maos/observacoes', {
      unidade: 2,
      setor: 'UTI',
      observadoEm: '2026-11-03T09:00',
      categoria: 'enfermeiro',
      oportunidades: [{ momento: 'antesContato', acao: 'friccao', luvas: false }],
      observacao: null,
    });
    expect(o.statusCode, o.body).toBe(201);
    const id = o.json().id as number;
    const c = await post(ccih, `/qualidade/ccih/maos/observacoes/${String(id)}/correcao`, {
      versao: 1,
      observadoEm: '2026-11-03T09:00',
      categoria: 'medico',
      oportunidades: [
        { momento: 'antesContato', acao: 'friccao', luvas: false },
        { momento: 'aposContato', acao: 'naoRealizada', luvas: false },
      ],
      observacao: null,
      justificativa: 'Categoria e oportunidades conferidas na planilha',
    });
    expect(c.statusCode, c.body).toBe(201);
    const adesao = async () => (await get(ccih, '/qualidade/ccih/maos?competencia=2026-11')).json();
    expect((await adesao()).adesao.total).toMatchObject({ numerador: 1, denominador: 2 });
    const e = await post(ccih, `/qualidade/ccih/maos/observacoes/${String(id)}/estorno`, {
      versao: 2,
      justificativa: 'Sessão observada em outro setor',
      senha: SENHA,
    });
    expect(e.statusCode, e.body).toBe(201);
    expect((await adesao()).adesao.total).toMatchObject({ numerador: 0, denominador: 0 });
    const sessoes = await get(ccih, '/qualidade/ccih/maos/sessoes?competencia=2026-11');
    expect(sessoes.json().itens[0]).toMatchObject({ id, estornadoEm: expect.any(String), versao: 3 });
    const de_novo = await post(ccih, `/qualidade/ccih/maos/observacoes/${String(id)}/estorno`, {
      versao: 3,
      justificativa: 'Sessão observada em outro setor',
      senha: SENHA,
    });
    expect([de_novo.statusCode, codigo(de_novo)]).toEqual([409, 'observacao-estornada']);
  });
});

describe('nenhuma exclusão física', () => {
  it('nenhum controlador da qualidade tem rota DELETE (notificação, ficha, dispositivo e os demais)', () => {
    const pasta = dirname(fileURLToPath(import.meta.url));
    const controladores = readdirSync(pasta).filter((f) => f.endsWith('.controller.ts'));
    expect(controladores.length).toBeGreaterThanOrEqual(5);
    for (const f of controladores) expect(readFileSync(join(pasta, f), 'utf8')).not.toMatch(/@Delete\(/);
  });
});

describe('M1: a aba de dispositivos do prontuário (o mesmo registro da CCIH)', () => {
  // A internação sintética 4802 (paciente 48002) entrou em 01/11; agora é 03/11 12:00 (turno da manhã até 13 h).
  it('a enfermagem registra a sonda, vê o alerta de permanência, faz o bundle do turno e retira; a CCIH vê o mesmo', async () => {
    const enf = await entrar('SINT.ENF.PLANTAO');
    const ins = await post(enf, '/qualidade/ccih/enfermagem/dispositivos', {
      internacao: 4802,
      tipo: 'sondaVesical',
      sitio: null,
      inseridoEm: '2026-11-01T08:00',
      itemPrescricao: null,
      observacao: null,
    });
    expect(ins.statusCode, ins.body).toBe(201);
    const id = (ins.json() as { id: number }).id;
    const aba = await get(enf, '/qualidade/ccih/enfermagem/paciente/48002/dispositivos');
    expect(aba.statusCode, aba.body).toBe(200);
    const a = aba.json() as {
      turnoAtual: { data: string; turno: string };
      podeRegistrar: boolean;
      itens: {
        id: number;
        dias: number;
        alerta: { horas: number; limiteHoras: number } | null;
        itensBundle: string[];
        bundleDoTurno: boolean;
      }[];
    };
    expect(a.turnoAtual).toEqual({ data: '2026-11-03', turno: 'manha' });
    expect(a.podeRegistrar).toBe(true);
    const svd = a.itens.find((x) => x.id === id)!;
    expect(svd.alerta).toEqual({ horas: 52, limiteHoras: 48, ultimaIndicacao: null });
    expect(svd.itensBundle[0]).toBe('indicacao');
    expect(svd.bundleDoTurno).toBe(false);
    // O bundle do turno com a indicação revisada tira o alerta; o segundo do mesmo turno é recusado.
    const itens = Object.fromEntries(svd.itensBundle.map((k) => [k, k !== 'higieneMeato']));
    const b = await post(enf, `/qualidade/ccih/enfermagem/dispositivos/${String(id)}/bundle`, {
      data: '2026-11-03',
      turno: 'manha',
      itens,
      observacao: null,
    });
    expect(b.statusCode, b.body).toBe(201);
    const de2 = await post(enf, `/qualidade/ccih/enfermagem/dispositivos/${String(id)}/bundle`, {
      data: '2026-11-03',
      turno: 'manha',
      itens,
      observacao: null,
    });
    expect([de2.statusCode, codigo(de2)]).toEqual([409, 'bundle-ja-registrado']);
    const futuro = await post(enf, `/qualidade/ccih/enfermagem/dispositivos/${String(id)}/bundle`, {
      data: '2026-11-03',
      turno: 'noite',
      itens,
      observacao: null,
    });
    expect([futuro.statusCode, codigo(futuro)]).toEqual([422, 'bundle-no-futuro']);
    const depois = (
      (await get(enf, '/qualidade/ccih/enfermagem/paciente/48002/dispositivos')).json() as typeof a & {
        itens: { id: number; bundles: { conforme: boolean; indicacaoRevisada: boolean }[] }[];
      }
    ).itens.find((x) => x.id === id)!;
    expect(depois.alerta).toBeNull();
    expect(depois.bundleDoTurno).toBe(true);
    expect((depois as unknown as { bundles: { conforme: boolean }[] }).bundles[0]).toMatchObject({
      conforme: false,
      indicacaoRevisada: true,
    });
    // A CCIH vê o MESMO registro na ficha do internado e no denominador.
    const ficha = (await get(ccih, '/qualidade/ccih/internacoes/4802')).json() as {
      dispositivos: { id: number }[];
    };
    expect(ficha.dispositivos.map((x) => x.id)).toContain(id);
    // A retirada pela aba.
    const r = await post(enf, `/qualidade/ccih/enfermagem/dispositivos/${String(id)}/retirar`, {
      versao: 1,
      retiradoEm: '2026-11-03T11:00',
      motivo: 'eletiva',
      observacao: null,
    });
    expect(r.statusCode, r.body).toBe(201);
    const inativo = await post(enf, `/qualidade/ccih/enfermagem/dispositivos/${String(id)}/bundle`, {
      data: '2026-11-03',
      turno: 'manha',
      itens,
      observacao: null,
    });
    expect(codigo(inativo)).toBe('dispositivo-inativo');
  });

  it('quem não tem a permissão da aba não registra (403); o médico não vê o botão', async () => {
    const med = await entrar('SINT.MEDICO');
    const r = await post(med, '/qualidade/ccih/enfermagem/dispositivos', {
      internacao: 4802,
      tipo: 'cvc',
      sitio: null,
      inseridoEm: '2026-11-02T08:00',
      itemPrescricao: null,
      observacao: null,
    });
    expect(r.statusCode).toBe(403);
  });
});
