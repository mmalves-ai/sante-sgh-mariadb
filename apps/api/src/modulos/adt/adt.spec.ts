// M21 (internação, leitos, higienização e SAME) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM
// MEMÓRIA (nada conecta a banco): permissões pelas opções do legado, mapa operacional com os mesmos leitos do painel do
// M16, admissão com a recusa "leito ocupado", ficha auditada, transferência pelo carimbo, troca e guia, alta em dois
// tempos (a médica só pelo médico com conselho), a higienização do pedido à liberação (checklist, foto, inspeção),
// bloqueio no novo e o conflito com a ocupação pelo outro sistema, o SAME pela leitura da etiqueta e a exclusão pelo
// supervisor com a senha de novo. Dados sintéticos.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import { moduloConfiguracaoDeTeste, registroDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo as moduloAdt } from './modulo.js';
import { FonteInternacaoMemoria } from '../internacao/fonte-memoria.js';
import { PortaAdtMemoria } from './porta-memoria.js';

const env: Record<string, string> = {
  ...envTeste,
  AMBIENTE: 'dev',
  API_MODULOS: 'configuracao_teste,cadastro,adt',
};
const trilha = new RegistradorTrilhaMemoria();
const cadastro = new PortaCadastroMemoria();
const pasta = resolve(import.meta.dirname, '../../../../../.tmp/adt-spec');
const porFora = resolve(pasta, 'por-fora.json');
// O mapa sintético depende do dia (o movimento é gerado pela data): o relógio fixo deixa o teste determinístico (em
// 2026-10-25, só 1 dos 6 leitos de ENF1 ficava livre e a transferência pede 2). M47.3: correção de portão.
const painel = new FonteInternacaoMemoria({
  arquivoPorFora: porFora,
  agora: () => Date.UTC(2026, 9, 23, 12, 0),
});
const adt = new PortaAdtMemoria(
  { estado: () => 'verde' },
  { painel, lerPacientes: (c, ids) => cadastro.lerPacientes(c, ids) },
);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  mkdirSync(pasta, { recursive: true });
  rmSync(porFora, { force: true });
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: registroDeTeste(
      { cadastro },
      {
        configuracao_teste: (ctx) => moduloConfiguracaoDeTeste(ctx),
        adt: (ctx) => moduloAdt(ctx, { adt }),
      },
    ),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  rmSync(pasta, { recursive: true, force: true });
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
  'idempotency-key': `teste-m21-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

interface LeitoMapa {
  chave: string;
  leito: { bloco: string; acomodacao: string; leito: string };
  situacao: string;
  admissivel: boolean;
  limpeza: { solicitacao: number; etapa: string } | null;
}
async function livres(s: Sessao, acomodacao = 'ENF1'): Promise<LeitoMapa[]> {
  const m = (await get(s, '/leitos/mapa')).json() as { leitos: LeitoMapa[] };
  if (!m.leitos) throw new Error(JSON.stringify(m));
  return m.leitos.filter((l) => l.admissivel && l.leito.acomodacao === acomodacao);
}
function admissao(paciente: number, leito: LeitoMapa['leito']) {
  return {
    paciente,
    leito,
    convenio: 901,
    acomodacaoPlano: 'ENFERMARIA',
    carater: 'urgencia',
    clinica: 'M',
    especialidade: 11,
    medicoAssistente: 7101,
    medicoSolicitante: 7101,
    cidPrincipal: 50001,
    procedimento: 303010037,
    centroCusto: 300100,
    unidade: 4,
    origem: 'ambulatorio',
  };
}

describe('permissões, liberação e o mapa operacional', () => {
  it('sem as opções da internação, 403; com elas, o mapa com os totais do painel e o vocabulário de produto', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/leitos/mapa')).statusCode).toBe(403);
    expect((await get(outra, '/internacoes')).statusCode).toBe(403);
    const s = await entrar('SINT.INTERNACAO');
    const m = await get(s, '/leitos/mapa?abertura=1');
    expect(m.statusCode).toBe(200);
    const mapa = m.json();
    // Os mesmos leitos do painel do M16 (regra 4: ocupação pelos períodos), 15 leitos sintéticos, 1 inativo.
    expect(mapa.leitos).toHaveLength(15);
    expect(mapa.leitos.filter((l: LeitoMapa) => l.situacao === 'inativo')).toHaveLength(1);
    expect(mapa.painel.totais.leitos).toBe(15);
    expect(trilha.eventos.some((l) => l.evento === 'internacao.leitos.consultado')).toBe(true);
    const g = (await get(s, '/internacoes/gravacao')).json();
    expect(g.ligada).toBe(true);
    expect(g.operacoes['internacao.internar'].pode).toBe(true);
    expect(g.operacoes['internacao.cancelarAlta'].pode).toBe(false);
    // A recepção não é médico: a alta médica fica fechada com o motivo.
    expect(g.altaMedica.pode).toBe(false);
    const a = (await get(s, '/internacoes/apoio')).json();
    expect(a.motivosAlta.find((x: { codigo: number }) => x.codigo === 41).grupo).toBe('obito');
    expect(JSON.stringify([mapa, a, g])).not.toMatch(/SPDATA|legado|sistema atual/i);
  });
});

describe('admissão, ficha, transferência, troca e guia', () => {
  it('admite, recusa o leito ocupado, lê a ficha (auditado), transfere pelo carimbo, troca o convênio e registra a guia', async () => {
    const s = await entrar('SINT.INTERNACAO');
    // O movimento sintético muda com o dia e a hora: há instantes sem dois leitos livres em ENF1 (como no M31, qualquer
    // leito admissível serve, ENF1 primeiro).
    const [l1, l2] = [...(await livres(s)), ...(await livres(s, 'APT1')), ...(await livres(s, 'UTI1'))];
    expect(l1 && l2).toBeTruthy();
    const r = await post(s, '/internacoes', admissao(1001, l1!.leito));
    expect(r.statusCode).toBe(201);
    const reg = r.json().resultado.reg as number;
    // Quem chega depois ao mesmo leito: "leito ocupado".
    const dup = await post(s, '/internacoes', admissao(1002, l1!.leito));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().codigo).toBe('leito-ocupado');
    const d = await get(s, `/internacoes/${reg}`);
    expect(d.statusCode).toBe(200);
    expect(d.json().trechos).toHaveLength(1);
    expect(d.json().reinternacao30).toBe(false);
    expect(
      trilha.eventos.some((x) => x.evento === 'internacao.internacao.lida' && x.idAlvo === String(reg)),
    ).toBe(true);
    // Carimbo divergente: o registro foi alterado no outro sistema.
    const velho = await post(s, '/leitos/transferencias', {
      internacao: reg,
      destino: l2!.leito,
      versao: '2020-01-01 00:00:00.0000',
    });
    expect(velho.statusCode).toBe(409);
    const t = await post(s, '/leitos/transferencias', {
      internacao: reg,
      destino: l2!.leito,
      versao: d.json().versao,
    });
    expect(t.statusCode).toBe(200);
    const d2 = (await get(s, `/internacoes/${reg}`)).json();
    expect(d2.trechos).toHaveLength(2);
    expect(d2.leito).toEqual(l2!.leito);
    const tr = await post(s, `/internacoes/${reg}/trocas`, {
      tipo: 'convenio',
      convenio: 902,
      versao: d2.versao,
    });
    expect(tr.statusCode).toBe(200);
    expect((await post(s, `/internacoes/${reg}/trocas`, { tipo: 'nada' })).statusCode).toBe(400);
    expect(
      (await post(s, `/internacoes/${reg}/guias`, { conta: reg, guia: 'G1', validadeDias: 3 })).json().codigo,
    ).toBe('conta-principal');
    const gu = await post(s, `/internacoes/${reg}/guias`, {
      conta: reg * 100 + 1,
      guia: 'G900001',
      senha: 'S1',
      validadeDias: 3,
    });
    expect(gu.statusCode).toBe(201);
    const d3 = (await get(s, `/internacoes/${reg}`)).json();
    expect(d3.trocas[0]).toMatchObject({ tipo: 'convenio', de: '901', para: '902' });
    expect(d3.guias.find((x: { guia: string }) => x.guia === 'G900001').vencimento).toBe('vigente');
    const lista = (await get(s, '/internacoes?termo=')).json();
    expect(lista.itens.some((x: { reg: number }) => x.reg === reg)).toBe(true);
  });
});

describe('alta em dois tempos e a higienização até a liberação', () => {
  it('a recepção não dá alta médica; o médico dá; a saída leva o leito à higienização; o ciclo libera o leito', async () => {
    const s = await entrar('SINT.INTERNACAO');
    const [l] = await livres(s);
    const reg = (await post(s, '/internacoes', admissao(1003, l!.leito))).json().resultado.reg as number;
    expect((await post(s, `/internacoes/${reg}/alta`, { versao: 'x'.repeat(12) })).json().codigo).toBe(
      'sem-alta-medica',
    );
    const naoMedico = await post(s, `/internacoes/${reg}/alta-medica`, { motivo: 12, destino: 'domicilio' });
    expect(naoMedico.statusCode).toBe(403);
    const medico = await entrar('SINT.MEDICO.INT');
    expect((await get(medico, '/internacoes/gravacao')).json().altaMedica.pode).toBe(true);
    expect(
      (await post(medico, `/internacoes/${reg}/alta-medica`, { motivo: 41, destino: 'domicilio' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(medico, `/internacoes/${reg}/alta-medica`, { motivo: 12, destino: 'domicilio' }))
        .statusCode,
    ).toBe(201);
    const lista = (await get(s, '/internacoes')).json();
    expect(lista.itens.find((x: { reg: number }) => x.reg === reg).altaMedica.motivo).toBe(12);
    const v = (await get(s, `/internacoes/${reg}`)).json().versao as string;
    // A recepção não troca o motivo do médico por outro de outro grupo (óbito sobre a alta para o domicílio).
    const incoerente = await post(s, `/internacoes/${reg}/alta`, { versao: v, motivo: 41 });
    expect(incoerente.statusCode).toBe(409);
    expect(incoerente.json().codigo).toBe('motivo-incoerente');
    const alta = await post(s, `/internacoes/${reg}/alta`, { versao: v });
    expect(alta.statusCode).toBe(200);
    const dAlta = (await get(s, `/internacoes/${reg}`)).json();
    expect(dAlta.saida.grupo).toBe('alta-domiciliar');
    // A internação com alta sai da lista dos internados e aparece pela situação (o cancelamento e as consultas).
    const temReg = (r: { json(): { itens: { reg: number }[] } }) => r.json().itens.some((x) => x.reg === reg);
    expect(temReg(await get(s, '/internacoes'))).toBe(false);
    expect(temReg(await get(s, '/internacoes?situacao=alta'))).toBe(true);
    expect(temReg(await get(s, `/internacoes?situacao=todas&termo=${reg}`))).toBe(true);
    expect((await get(s, '/internacoes?situacao=alta&altaDe=2020-01-01&altaAte=2026-12-31')).statusCode).toBe(
      400,
    );
    expect(dAlta.saida.diariasFaturaveis).toBeGreaterThanOrEqual(1);
    // O leito vai à higienização: no mapa, não admite (regra 8) e mostra a limpeza.
    const leito = ((await get(s, '/leitos/mapa')).json().leitos as LeitoMapa[]).find(
      (x) => x.chave === l!.chave,
    )!;
    expect(leito.situacao).toBe('higienizacao');
    expect(leito.admissivel).toBe(false);
    expect((await post(s, '/internacoes', admissao(1004, l!.leito))).statusCode).toBe(409);
    const sol = leito.limpeza!.solicitacao;
    const hig = await entrar('SINT.HIGIENIZACAO');
    const fila = (await get(hig, '/higienizacao/fila')).json();
    expect(fila.itens.some((x: { solicitacao: number }) => x.solicitacao === sol)).toBe(true);
    // Quem só executa age em seu nome (o profissional ligado ao login): nem assume por outro, nem lê a fila de outro.
    const porOutro = await post(hig, `/higienizacao/solicitacoes/${sol}/etapas`, {
      etapa: 'atribuido',
      profissional: 2,
    });
    expect(porOutro.statusCode).toBe(403);
    expect(porOutro.json().codigo).toBe('profissional-da-sessao');
    expect((await get(hig, '/higienizacao/fila?profissional=2')).statusCode).toBe(403);
    expect((await get(hig, '/higienizacao/fila')).json().profissionalDaSessao).toBe(1);
    // Sem o profissional no pedido, assume para si.
    expect(
      (await post(hig, `/higienizacao/solicitacoes/${sol}/etapas`, { etapa: 'atribuido' })).statusCode,
    ).toBe(200);
    expect(
      (await post(hig, `/higienizacao/solicitacoes/${sol}/etapas`, { etapa: 'emExecucao' })).statusCode,
    ).toBe(200);
    // O início levou a situação 2 ao outro sistema (a única seguinte que ele já gravou).
    const painel = (await get(hig, '/higienizacao/fila')).json();
    const item = painel.itens.find((x: { solicitacao: number }) => x.solicitacao === sol);
    // A execução é uma gravação só no banco (sem o avanço da situação por código antigo numa transação à parte).
    expect(item.prazo).not.toBeNull();
    expect(item.profissional.codigo).toBe(1);
    expect(item.historico.map((x: { etapa: string }) => x.etapa)).toEqual([
      'solicitado',
      'atribuido',
      'emExecucao',
    ]);
    const incompleto = await post(hig, `/higienizacao/solicitacoes/${sol}/etapas`, {
      etapa: 'concluido',
      checklist: ['piso'],
    });
    expect(incompleto.statusCode).toBe(409);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 40 }, (_, i) => i)]).toString(
      'base64',
    );
    const foto = await post(hig, '/higienizacao/fotos', {
      solicitacao: sol,
      tipo: 'image/jpeg',
      conteudo: jpeg,
    });
    expect(foto.statusCode).toBe(201);
    expect(
      (await post(hig, '/higienizacao/fotos', { solicitacao: sol, tipo: 'image/png', conteudo: jpeg }))
        .statusCode,
    ).toBe(400);
    const concluir = await post(hig, `/higienizacao/solicitacoes/${sol}/etapas`, {
      etapa: 'concluido',
      checklist: ['superficies', 'piso', 'banheiro', 'enxoval', 'residuos'],
      foto: foto.json().chave,
    });
    expect(concluir.statusCode).toBe(200);
    // O profissional não inspeciona; o supervisor sim.
    expect(
      (await post(hig, `/higienizacao/solicitacoes/${sol}/etapas`, { etapa: 'inspecionado' })).statusCode,
    ).toBe(403);
    const sup = await entrar('SINT.SUPERVISOR.HIG');
    expect(
      (await get(sup, `/higienizacao/fotos?chave=${encodeURIComponent(foto.json().chave)}`)).json().tipo,
    ).toBe('image/jpeg');
    expect(
      (await post(sup, `/higienizacao/solicitacoes/${sol}/etapas`, { etapa: 'inspecionado' })).statusCode,
    ).toBe(200);
    expect(
      (await post(sup, `/higienizacao/solicitacoes/${sol}/etapas`, { etapa: 'liberado' })).statusCode,
    ).toBe(200);
    const depois = ((await get(s, '/leitos/mapa')).json().leitos as LeitoMapa[]).find(
      (x) => x.chave === l!.chave,
    )!;
    expect(depois.situacao).toBe('livre');
    expect(depois.admissivel).toBe(true);
    expect(trilha.eventos.some((x) => x.evento === 'hotelaria.leito.liberado')).toBe(true);
    // W0-07 (M3): a limpeza liberada entra nos indicadores de giro (numerador e denominador, por recorte).
    const dia = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    expect((await get(sup, '/higienizacao/indicadores?de=2026-02-01&ate=2026-01-01')).statusCode).toBe(400);
    expect((await get(sup, '/higienizacao/indicadores?de=2025-01-01&ate=2026-12-31')).statusCode).toBe(400);
    const ind = await get(sup, `/higienizacao/indicadores?de=${dia(-1)}&ate=${dia(1)}`);
    expect(ind.statusCode).toBe(200);
    const corpo = ind.json() as {
      liberadas: number;
      linhas: { codigo: string; recorte: string; numerador: number; denominador: number }[];
    };
    expect(corpo.liberadas).toBeGreaterThanOrEqual(1);
    const total = corpo.linhas.find((x) => x.codigo === 'tempoGiroLeito' && x.recorte === 'total')!;
    expect(total.denominador).toBe(corpo.liberadas);
    for (const r of ['tipo', 'area', 'profissional'])
      expect(corpo.linhas.some((x) => x.codigo === 'higienizacaoNoPrazo' && x.recorte === r)).toBe(true);
  });
});

describe('bloqueio no novo e o conflito com o outro sistema (regra 8)', () => {
  it('bloqueia o leito livre; a ocupação por fora aparece no mapa como incoerência, sem gravação na leitura', async () => {
    const s = await entrar('SINT.INTERNACAO');
    const [l] = await livres(s, 'APT1');
    expect((await post(s, '/leitos/estados', { leito: l!.leito, estado: 'bloqueio' })).statusCode).toBe(400);
    expect(
      (await post(s, '/leitos/estados', { leito: l!.leito, estado: 'bloqueio', motivo: 'manutencao' }))
        .statusCode,
    ).toBe(201);
    const bloq = ((await get(s, '/leitos/mapa')).json().leitos as LeitoMapa[]).find(
      (x) => x.chave === l!.chave,
    )!;
    expect(bloq.situacao).toBe('bloqueado');
    expect((await post(s, '/internacoes', admissao(1005, l!.leito))).statusCode).toBe(409);
    // O escritor do outro sistema (simulado) ocupa o leito bloqueado no novo.
    writeFileSync(
      porFora,
      JSON.stringify({
        reg: 990_001,
        bloco: l!.leito.bloco,
        acomodacao: l!.leito.acomodacao,
        leito: l!.leito.leito,
        iniciais: 'S.S.',
        sexo: 'F',
        nascimento: '1970-01-01',
        convenio: 'CONVENIO SINTETICO',
      }),
    );
    const m = (await get(s, '/leitos/mapa')).json();
    const conf = (m.leitos as (LeitoMapa & { conflito: { internacao: number } | null })[]).find(
      (x) => x.chave === l!.chave,
    )!;
    expect(conf.situacao).toBe('conflito');
    expect(conf.conflito?.internacao).toBe(990_001);
    expect(m.resumo.conflitos).toBeGreaterThanOrEqual(1);
    // A incoerência é só leitura: a leitura do mapa nunca grava (no banco a ocupação do leito bloqueado é recusada).
    const conflitos = () => trilha.eventos.filter((x) => x.evento === 'leitos.leito.conflito').length;
    expect(conflitos()).toBe(0);
    const m2 = (await get(s, '/leitos/mapa')).json();
    expect(m2.leitos.find((x: LeitoMapa) => x.chave === l!.chave).conflito.registrado).toBe(false);
    expect(conflitos()).toBe(0);
    rmSync(porFora, { force: true });
    expect(
      (await post(s, '/leitos/estados/encerrar', { leito: l!.leito, estado: 'bloqueio' })).statusCode,
    ).toBe(200);
    // A etiqueta do leito: o QR code com a solicitação de limpeza daquele leito (nenhum dado de paciente).
    const et = await post(s, '/leitos/etiqueta', { leito: l!.leito });
    expect(et.statusCode, et.body).toBe(201);
    expect(et.json().conteudo).toContain('^BQN,2,6^FDQA,');
    expect(et.json().conteudo).toContain(
      `/higienizacao/solicitacoes?leito=${encodeURIComponent(l!.chave)}&origem=qrcode`,
    );
    expect(trilha.eventos.some((x) => x.recurso === 'leitos.etiqueta')).toBe(true);
    expect(
      (await post(s, '/leitos/atributos', { leito: l!.leito, sexo: 'F', idadeMinima: 50, idadeMaxima: 10 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(s, '/leitos/atributos', { leito: l!.leito, sexo: 'F', criticidade: 1 })).statusCode,
    ).toBe(200);
  });
});

describe('pré-internação e saneamento', () => {
  it('agenda sem data (data nula, nunca sentinela), corrige a data pela leitura e recusa a correção sobre leitura velha', async () => {
    const s = await entrar('SINT.INTERNACAO');
    const corpo = {
      paciente: 1002,
      convenio: 901,
      plano: 'PLANO SINTETICO',
      especialidade: 11,
      medicoSolicitante: 7101,
      procedimento: 303010037,
      clinica: 2,
    };
    // Sem clínica (nenhum padrão silencioso) e com data fora do plausível: recusadas na entrada.
    const semClinica: Partial<typeof corpo> = { ...corpo };
    delete semClinica.clinica;
    expect((await post(s, '/internacoes/pre', semClinica)).statusCode).toBe(400);
    expect((await post(s, '/internacoes/pre', { ...corpo, dataPrevista: '2099-12-31' })).statusCode).toBe(
      400,
    );
    expect((await post(s, '/internacoes/pre', { ...corpo, procedimento: 0 })).statusCode).toBe(400);
    const pr = await post(s, '/internacoes/pre', corpo);
    expect(pr.statusCode, pr.body).toBe(201);
    expect((await post(s, '/internacoes/pre', corpo)).json().codigo).toBe('pre-internacao-existente');
    const p = (await get(s, '/internacoes/pre')).json();
    const item = p.itens.find((x: { paciente: number }) => x.paciente === 1002);
    expect(item.problema).toBe('sem-data');
    expect(item.dataPrevista).toBeNull();
    expect(p.contagens.semData).toBeGreaterThanOrEqual(1);
    const hoje = new Date().toISOString().slice(0, 10);
    expect(
      (await post(s, '/internacoes/pre/1002/corrigir', { dataPrevista: hoje, versao: item.versao + 1 }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post(s, '/internacoes/pre/1002/corrigir', { dataPrevista: hoje, versao: item.versao }))
        .statusCode,
    ).toBe(200);
    // A versão lida ficou velha: a mesma correção (mesma data) agora conflita.
    expect(
      (await post(s, '/internacoes/pre/1002/corrigir', { dataPrevista: hoje, versao: item.versao }))
        .statusCode,
    ).toBe(409);
    const lido = (await get(s, '/internacoes/pre/1002')).json().pre;
    expect(lido.dataPrevista).toBe(hoje);
    expect(lido.clinica).toBe('C');
    expect(lido.procedimento).toBe(303010037);
  });
});

describe('SAME: localização, movimento e exclusão lógica', () => {
  it('lê a etiqueta, registra a saída, recusa o recebimento no setor errado, recebe e desfaz só o último', async () => {
    const s = await entrar('SINT.INTERNACAO');
    const [l] = await livres(s);
    const reg = (await post(s, '/internacoes', admissao(1004, l!.leito))).json().resultado as {
      conta: number;
    };
    const arq = await entrar('SINT.ARQUIVO');
    expect((await get(arq, '/same/contas/abc')).statusCode).toBe(400);
    const loc = (await get(arq, `/same/contas/${reg.conta}`)).json();
    expect(loc.local.setor.codigo).toBe(1);
    expect(loc.linhaDoTempo).toHaveLength(1);
    const mov = { conta: reg.conta, responsavel: 'RESPONSAVEL SINTETICO' };
    expect(
      (await post(arq, '/same/movimentos', { ...mov, operacao: 2, setorOrigem: 1, setorDestino: 5 }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(arq, '/same/movimentos', {
          ...mov,
          operacao: 2,
          setorOrigem: 1,
          setorDestino: 5,
          motivo: 1,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await post(arq, '/same/movimentos', { ...mov, operacao: 6, setorOrigem: 5, setorDestino: 9 })).json()
        .codigo,
    ).toBe('nao-enviado');
    // O recebimento recusado vira ocorrência (só no novo), com o motivo.
    expect((await post(arq, '/same/registros', { conta: reg.conta, tipo: 'ocorrencia' })).statusCode).toBe(
      400,
    );
    const oc = await post(arq, '/same/registros', {
      conta: reg.conta,
      tipo: 'ocorrencia',
      motivo: 'Chegou à auditoria sem o envio registrado',
    });
    expect(oc.statusCode, oc.body).toBe(201);
    const comOcorrencia = (await get(arq, `/same/contas/${reg.conta}`)).json();
    expect(comOcorrencia.ocorrencias).toHaveLength(1);
    expect(comOcorrencia.ocorrencias[0].motivo).toMatch(/sem o envio/);
    expect(
      (
        await post(arq, '/same/movimentos', {
          ...mov,
          operacao: 4,
          setorOrigem: 5,
          setorDestino: 8,
          motivo: 1,
        })
      ).statusCode,
    ).toBe(400);
    const receb = await post(arq, '/same/movimentos', {
      ...mov,
      operacao: 6,
      setorOrigem: 1,
      setorDestino: 5,
    });
    expect(receb.statusCode).toBe(201);
    // O aceite da remessa por quem recebe (uma vez); a cobrança só do volume fora do arquivo além do prazo.
    const idReceb = receb.json().resultado.movimento as number;
    expect(
      (await post(arq, '/same/registros', { conta: reg.conta, tipo: 'aceite', movimento: idReceb }))
        .statusCode,
    ).toBe(201);
    expect(
      (await post(arq, '/same/registros', { conta: reg.conta, tipo: 'aceite', movimento: idReceb })).json()
        .codigo,
    ).toBe('ja-aceito');
    expect(
      (await post(arq, '/same/registros', { conta: reg.conta, tipo: 'cobranca', movimento: idReceb })).json()
        .codigo,
    ).toBe('devolucao-no-prazo');
    expect(
      (await post(arq, '/same/registros', { conta: reg.conta, tipo: 'aceite', movimento: 999_999 })).json()
        .codigo,
    ).toBe('movimento-inexistente');
    const atrasadas = await get(arq, '/same/devolucoes-atrasadas');
    expect(atrasadas.statusCode).toBe(200);
    expect(atrasadas.json().itens).toEqual([]);
    const l2 = (await get(arq, `/same/contas/${reg.conta}`)).json();
    expect(l2.linhaDoTempo.find((x: { id: number }) => x.id === idReceb).aceito).toBe(true);
    const primeiro = l2.linhaDoTempo.at(-1).id as number;
    expect(
      (
        await post(arq, `/same/movimentos/${primeiro}/excluir`, {
          motivo: 'Lançado por engano na conferência',
        })
      ).json().codigo,
    ).toBe('nao-e-o-ultimo');
    expect(
      (
        await post(arq, `/same/movimentos/${receb.json().resultado.movimento}/excluir`, {
          motivo: 'Lançado por engano na conferência',
        })
      ).statusCode,
    ).toBe(200);
    const l3 = (await get(arq, `/same/contas/${reg.conta}`)).json();
    expect(l3.linhaDoTempo.filter((x: { excluido: boolean }) => x.excluido)).toHaveLength(1);
    expect(l3.local.operacao).toBe('Saída');
  });
});

describe('supervisor: exclusão da internação com a senha de novo', () => {
  it('a recepção não exclui; o supervisor exclui com a dupla confirmação e a senha', async () => {
    const s = await entrar('SINT.INTERNACAO');
    // M31: os testes anteriores do arquivo ocupam os leitos de ENF1 do mapa sintético; qualquer leito admissível serve.
    const [l] = [...(await livres(s)), ...(await livres(s, 'APT1')), ...(await livres(s, 'UTI1'))];
    const reg = (await post(s, '/internacoes', admissao(1005, l!.leito))).json().resultado.reg as number;
    const corpo = {
      justificativa: 'Internação aberta por engano na recepção',
      confirmaApagarConta: true,
      confirmaApagarPeriodos: true,
    };
    expect((await post(s, `/internacoes/${reg}/excluir`, corpo)).statusCode).toBe(403);
    const sup = await entrar('SINT.SUPERVISOR.INT');
    expect(
      (await post(sup, `/internacoes/${reg}/excluir`, { ...corpo, confirmaApagarConta: false, senha: SENHA }))
        .statusCode,
    ).toBe(400);
    expect((await post(sup, `/internacoes/${reg}/excluir`, corpo)).statusCode).toBe(401);
    expect((await post(sup, `/internacoes/${reg}/excluir`, { ...corpo, senha: SENHA })).statusCode).toBe(200);
    expect((await get(sup, `/internacoes/${reg}`)).statusCode).toBe(404);
  });
});

describe('compatibilidade do leito com o paciente (sexo e faixa de idade, D-COMP-21)', () => {
  it('o leito feminino recusa o paciente masculino na admissão e na transferência; o mapa diz o motivo', async () => {
    const s = await entrar('SINT.INTERNACAO');
    const todos = ((await get(s, '/leitos/mapa')).json() as { leitos: LeitoMapa[] }).leitos.filter(
      (x) => x.admissivel,
    );
    const [fem, ped] = todos;
    expect(fem && ped).toBeTruthy();
    expect(
      (await post(s, '/leitos/atributos', { leito: fem!.leito, sexo: 'F', motivo: 'Leito feminino' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await post(s, '/leitos/atributos', {
          leito: ped!.leito,
          sexo: 'A',
          idadeMinima: 0,
          idadeMaxima: 12,
          motivo: 'Pediatria',
        })
      ).statusCode,
    ).toBe(200);
    // O mapa pedido para o paciente (1001, masculino, adulto) marca os dois leitos com o motivo.
    const m = (await get(s, '/leitos/mapa?paciente=1001')).json() as {
      leitos: (LeitoMapa & { incompatibilidade: string | null })[];
    };
    expect(m.leitos.find((x) => x.chave === fem!.chave)?.incompatibilidade).toMatch(/feminino/);
    expect(m.leitos.find((x) => x.chave === ped!.chave)?.incompatibilidade).toMatch(/até 12 anos/);
    expect(JSON.stringify(m)).not.toMatch(/1980-03-15/);
    const recusa = await post(s, '/internacoes', admissao(1001, fem!.leito));
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().codigo).toBe('leito-incompativel');
    expect((await post(s, '/internacoes', admissao(1001, ped!.leito))).json().codigo).toBe(
      'leito-incompativel',
    );
    // A paciente feminina adulta (1007) entra no leito feminino; o pediátrico recusa a transferência dela.
    const r = await post(s, '/internacoes', admissao(1007, fem!.leito));
    expect(r.statusCode, r.body).toBe(201);
    const reg = r.json().resultado.reg as number;
    const d = (await get(s, `/internacoes/${reg}`)).json();
    const t = await post(s, '/leitos/transferencias', {
      internacao: reg,
      destino: ped!.leito,
      versao: d.versao,
    });
    expect(t.statusCode).toBe(409);
    expect(t.json().codigo).toBe('leito-incompativel');
    const mt = (await get(s, `/leitos/mapa?internacao=${reg}`)).json() as {
      leitos: (LeitoMapa & { incompatibilidade: string | null })[];
    };
    expect(mt.leitos.find((x) => x.chave === ped!.chave)?.incompatibilidade).toMatch(/até 12 anos/);
    // Sem paciente, o mapa não leva o campo.
    const sem = (await get(s, '/leitos/mapa')).json() as { leitos: Record<string, unknown>[] };
    expect(sem.leitos.every((x) => !('incompatibilidade' in x))).toBe(true);
    // Volta os atributos (os outros testes usam os leitos livres).
    await post(s, '/leitos/atributos', { leito: ped!.leito, sexo: 'A', motivo: 'Fim do teste' });
  });
});
