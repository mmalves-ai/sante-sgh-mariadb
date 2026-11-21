// M54 (etapa 3, F3) pela HTTP, com a sessão real sobre a fonte sintética e a porta EM MEMÓRIA (nada conecta a banco):
// desligada (403); ligada, o balancete com as parcelas, o diário, a DRE e o balanço de um exercício sintético; a
// apuração do resultado (prévia, apurar, a segunda recusada; a DRE não conta o encerramento e o balanço passa o
// resultado ao patrimônio líquido); o SPED desligado até a chave própria; ligado, a prévia com os impedimentos, a ECD
// gerada (hash, cifrada, baixada igual), a substituição, o recibo e as recusas; a ECF do lucro real recusada e a da
// isenta gerada; e quem não tem a permissão. Dados SINTÉTICOS (CPF de teste).
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { type ContextoModulo, REGISTRO_MODULOS } from '../registro.js';
import { moduloContabil } from './modulo.js';
import type { PortaContabil } from './porta.js';
import { PortaContabilMemoria } from './porta-memoria.js';

/** O módulo da contabilidade registrado com a porta do teste (o registro real é o do integrador da onda). */
const registroContabil = (p: PortaContabil) => ({
  ...REGISTRO_MODULOS,
  contabil: async () => ({ modulo: (ctx: ContextoModulo) => moduloContabil(ctx, { porta: p }) }),
});

const env: Record<string, string> = { ...envTeste, API_MODULOS: 'config,contabil', AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const porta = new PortaContabilMemoria();
porta.hojeFixo = '2026-11-10';
let app: NestFastifyApplication;
let n = 0;

// O plano sintético (que já tem o patrimônio líquido) ganha uma despesa; a receita ganha o referencial.
const base = porta.contas[0]!;
porta.contas.push(
  { ...base, codigo: '4', nome: 'Despesas', tipo: 'sintetica', grupo: 'despesa', natureza: 'devedora' },
  {
    ...base,
    codigo: '4.1.1.01.0001',
    nome: 'Serviços de terceiros',
    tipo: 'analitica',
    grupo: 'despesa',
    natureza: 'devedora',
    exigeCentroCusto: true,
    referencialTipo: 1,
    referencialConta: '3.11.01.01',
    contaExportacao: null,
  },
);
for (const c of porta.contas)
  if (c.codigo === '3.1.1.01.0001') Object.assign(c, { referencialTipo: 1, referencialConta: '3.01.01.01' });

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, registro: registroContabil(porta) });
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
  'idempotency-key': `teste-m54-3-${++n}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as object });

const C = '/api/contabil';
const D = `${C}/demonstracoes`;

async function ligar(admin: Sessao, chave: string) {
  const pre = await app.inject({
    method: 'PUT',
    url: '/api/administracao/liberacao/prerequisitos',
    headers: h(admin),
    payload: {
      recurso: chave,
      tipo: 'aprovacao',
      situacao: 'cumprido',
      validade: '2099-12-31',
      evidencia: 'competência sintética conferida',
      senha: SENHA,
    },
  });
  expect(pre.statusCode, pre.body).toBe(200);
  const r = await post(admin, '/api/administracao/liberacao', {
    chave,
    tipo: 'recurso',
    escopo: 'hospital',
    valores: ['*'],
    ligar: true,
    justificativa: 'ligação sintética de teste da contabilidade',
    senha: SENHA,
  });
  expect(r.statusCode, r.body).toBe(200);
}

const manual = (
  uuid: string,
  data: string,
  d: string,
  cdcD: number | null,
  c: string,
  cdcC: number | null,
  v: number,
) => ({
  empresa: 1,
  data,
  historico: 'Lançamento sintético',
  idempotencia: uuid,
  partidas: [
    { lado: 'D', conta: d, valorCentavos: v, centroCusto: cdcD },
    { lado: 'C', conta: c, valorCentavos: v, centroCusto: cdcC },
  ],
});

const SIGNATARIOS = [
  { nome: 'Contador Sintético', cpf: '12345678909', qualificacao: '900', crc: 'SP000000' },
  { nome: 'Diretor Sintético', cpf: '98765432100', qualificacao: '203' },
];

describe('contabilidade, etapa 3 (demonstrações, apuração e SPED)', () => {
  it('desligada: o apoio diz o motivo; o resto dá 403; sem a permissão, 403', async () => {
    const c = await entrar('SINT.CONTADOR');
    const a = await get(c, `${D}/apoio?empresa=1`);
    expect(a.statusCode, a.body).toBe(200);
    expect(a.json()).toMatchObject({ ligada: false, podeApurar: true, podeVerSped: true });
    const b = await get(c, `${D}/balancete?empresa=1&de=2025-01&ate=2025-12`);
    expect(b.statusCode).toBe(403);
    expect(b.json().codigo).toBe('recurso-desligado');
    const q = await entrar('SINT.CONTABIL.CONSULTA');
    expect((await get(q, `${D}/balancete?empresa=1&de=2025-01&ate=2025-12`)).statusCode).toBe(403);
  });

  it('o exercício: balancete, diário, DRE, balanço, a apuração e o resultado no patrimônio líquido', async () => {
    await ligar(await entrar('SINT.ADMIN'), 'contabil');
    const c = await entrar('SINT.CONTADOR');
    // Os centros de custo do filtro do balancete vêm no apoio (seleção com busca na tela; o inativo marcado).
    const apoio = (await get(c, `${D}/apoio?empresa=1`)).json();
    expect(apoio.centros).toEqual([
      { codigo: 3, nome: 'Administração', ativo: true },
      { codigo: 12, nome: 'Centro cirúrgico', ativo: true },
      { codigo: 40, nome: 'Unidade desativada', ativo: false },
    ]);
    for (const x of [
      manual(
        '6f1c2d3e-4a5b-4c6d-8e7f-0011223344a1',
        '2025-03-10',
        '1.1.2.01.0001',
        null,
        '3.1.1.01.0001',
        12,
        100_000,
      ),
      manual(
        '6f1c2d3e-4a5b-4c6d-8e7f-0011223344a2',
        '2025-07-15',
        '4.1.1.01.0001',
        12,
        '1.1.2.01.0001',
        null,
        30_000,
      ),
    ]) {
      const r = await post(c, `${C}/lancamentos/manual`, x);
      expect(r.statusCode, r.body).toBe(200);
    }
    const bal = await get(c, `${D}/balancete?empresa=1&de=2025-01&ate=2025-12`);
    expect(bal.statusCode, bal.body).toBe(200);
    const b = bal.json();
    expect(b.totais).toMatchObject({ debitosCentavos: 130_000, creditosCentavos: 130_000 });
    expect(b.equilibrado).toBe(true);
    expect(b.linhas.find((l: { codigo: string }) => l.codigo === '1').saldoFinalCentavos).toBe(70_000);
    expect(b.competenciasAbertas).toHaveLength(12);
    expect(b.conferencia[0]).toContain('1.300,00 = créditos 1.300,00');
    const n1 = (await get(c, `${D}/balancete?empresa=1&de=2025-01&ate=2025-12&nivel=1`)).json();
    expect(n1.linhas.every((l: { nivel: number }) => l.nivel === 1)).toBe(true);
    const cdc = (await get(c, `${D}/balancete?empresa=1&de=2025-01&ate=2025-12&centroCusto=12`)).json();
    expect(cdc.equilibrado).toBeNull();
    expect((await get(c, `${D}/balancete?empresa=1&de=2025-01&ate=2026-02`)).statusCode).toBe(400);

    const di = (await get(c, `${D}/diario?empresa=1&de=2025-01-01&ate=2025-12-31`)).json();
    expect(di.lancamentos).toHaveLength(2);
    expect(di.lancamentos[0].partidas[1]).toMatchObject({
      conta: '3.1.1.01.0001',
      contaNome: 'Receita de convênios',
    });
    expect(di.totais).toEqual({ lancamentos: 2, debitosCentavos: 130_000, creditosCentavos: 130_000 });
    expect(di.conferencia).toContain('(Manual, 2)');

    const dre = (await get(c, `${D}/dre?empresa=1&de=2025-01&ate=2025-12`)).json();
    expect(dre.resultadoCentavos).toBe(70_000);
    expect(dre.rotuloResultado).toBe('Superávit do período');
    expect((await get(c, `${D}/dre?empresa=1&de=2024-12&ate=2025-01`)).statusCode).toBe(400);

    const bp = (await get(c, `${D}/balanco?empresa=1&competencia=2025-12`)).json();
    expect(bp).toMatchObject({
      data: '2025-12-31',
      totalAtivoCentavos: 70_000,
      resultadoExercicioCentavos: 70_000,
      totalPassivoPlCentavos: 70_000,
      equilibrado: true,
    });

    const pr = (await get(c, `${D}/apuracao?empresa=1&exercicio=2025`)).json();
    expect(pr).toMatchObject({
      resultadoCentavos: 70_000,
      podeApurar: true,
      apuracaoAtiva: null,
      partidas: 3,
    });
    expect(pr.contasDestino).toEqual([{ codigo: '2.4.1.01.0001', nome: 'Superávits acumulados' }]);
    const curso = (await get(c, `${D}/apuracao?empresa=1&exercicio=2026`)).json();
    expect(curso.impedimentos.map((i: { codigo: string }) => i.codigo)).toContain('exercicio-em-curso');

    const ruim = await post(c, `${D}/apuracao/apurar`, {
      empresa: 1,
      exercicio: 2025,
      contaDestino: '1.1.2.01.0001',
      senha: SENHA,
    });
    expect(ruim.statusCode).toBe(409);
    expect(ruim.json().codigo).toBe('destino-invalido');
    const ap = await post(c, `${D}/apuracao/apurar`, {
      empresa: 1,
      exercicio: 2025,
      contaDestino: '2.4.1.01.0001',
      senha: SENHA,
    });
    expect(ap.statusCode, ap.body).toBe(200);
    expect(ap.json()).toMatchObject({ ok: true, resultadoCentavos: 70_000 });
    expect(ap.json().mensagem).toContain('superávit de 700,00');
    const de2 = await post(c, `${D}/apuracao/apurar`, {
      empresa: 1,
      exercicio: 2025,
      contaDestino: '2.4.1.01.0001',
      senha: SENHA,
    });
    expect(de2.statusCode).toBe(409);
    expect(de2.json().codigo).toBe('ja-apurado');
    expect(trilha.eventos.some((e) => e.evento === 'contabil.resultado.apurado')).toBe(true);

    // A DRE não conta a apuração; o balanço leva o resultado ao patrimônio líquido.
    expect((await get(c, `${D}/dre?empresa=1&de=2025-01&ate=2025-12`)).json().resultadoCentavos).toBe(70_000);
    const bp2 = (await get(c, `${D}/balanco?empresa=1&competencia=2025-12`)).json();
    expect(bp2).toMatchObject({ resultadoExercicioCentavos: 0, equilibrado: true });
    expect(bp2.patrimonioLiquido.totalCentavos).toBe(70_000);
    const di2 = (await get(c, `${D}/diario?empresa=1&de=2025-12-01&ate=2025-12-31`)).json();
    expect(di2.lancamentos[0]).toMatchObject({ tipo: 'apuracao', tipoRotulo: 'Apuração do resultado' });
  });

  it('exportação: XLSX do balancete, do diário, da DRE e do balanço, auditada; PDF sem o conversor dá 503', async () => {
    const c = await entrar('SINT.CONTADOR');
    for (const q of [
      'tipo=balancete&de=2025-01&ate=2025-12',
      'tipo=diario&de=2025-01-01&ate=2025-12-31',
      'tipo=dre&de=2025-01&ate=2025-12',
      'tipo=balanco&competencia=2025-12',
    ]) {
      const r = await get(c, `${D}/exportar?empresa=1&formato=xlsx&${q}`);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers['content-type']).toContain('spreadsheetml');
      expect(String(r.headers['content-disposition'])).toMatch(/attachment; filename="[a-z]+-1-.+\.xlsx"/);
      expect(r.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
    }
    expect(
      trilha.eventos.filter((e) => e.evento === 'contabil.demonstracao.exportada').length,
    ).toBeGreaterThanOrEqual(4);
    const pdf = await get(c, `${D}/exportar?empresa=1&formato=pdf&tipo=dre&de=2025-01&ate=2025-12`);
    expect([200, 503]).toContain(pdf.statusCode);
    expect(
      (await get(c, `${D}/exportar?empresa=1&formato=doc&tipo=dre&de=2025-01&ate=2025-12`)).statusCode,
    ).toBe(400);
    expect(
      (await get(c, `${D}/exportar?empresa=1&formato=xlsx&tipo=dre&de=2025-01&ate=2026-02`)).statusCode,
    ).toBe(400);
    const q = await entrar('SINT.CONTABIL.CONSULTA');
    expect(
      (await get(q, `${D}/exportar?empresa=1&formato=xlsx&tipo=balanco&competencia=2025-12`)).statusCode,
    ).toBe(403);
  });

  it('SPED: desligado até a chave própria; a prévia, a ECD gerada, baixada, substituída e o recibo', async () => {
    const c = await entrar('SINT.CONTADOR');
    const ap0 = (await get(c, `${C}/sped/apoio`)).json();
    expect(ap0).toMatchObject({ ligada: false });
    expect(ap0.motivo).toContain('SPED contábil está desligado');
    expect((await get(c, `${C}/sped/previa?empresa=1&tipo=ecd&exercicio=2025`)).statusCode).toBe(403);
    await ligar(await entrar('SINT.ADMIN'), 'contabil.sped');
    const ap = (await get(c, `${C}/sped/apoio`)).json();
    expect(ap).toMatchObject({ ligada: true, cifraDisponivel: true, podeGerar: true });

    const p1 = (await get(c, `${C}/sped/previa?empresa=1&tipo=ecd&exercicio=2025`)).json();
    expect(p1.podeGerar).toBe(false);
    expect(p1.impedimentos.map((i: { codigo: string }) => i.codigo)).toEqual(['meses-abertos']);
    // Os doze meses de 2025 encerrados (como a tela dos períodos faria, um a um).
    for (let m = 1; m <= 12; m++)
      porta.f2.periodosMem.push({
        empresa: 1,
        competencia: `2025-${String(m).padStart(2, '0')}`,
        situacao: 'encerrado',
        lancamentos: 0,
        debitos: 0,
        creditos: 0,
        observacao: null,
        encerradoPor: 'SINT.CONTADOR',
        encerradoEm: '2026-01-05T10:00:00',
        reabertoPor: null,
        reabertoEm: null,
        versao: 1,
      });
    const p2 = (await get(c, `${C}/sped/previa?empresa=1&tipo=ecd&exercicio=2025`)).json();
    expect(p2.impedimentos).toEqual([]);
    expect(p2.registros).toContainEqual({ registro: 'I200', quantidade: 3 });

    const g = { empresa: 1, tipo: 'ecd', exercicio: 2025, signatarios: SIGNATARIOS };
    const r1 = await post(c, `${C}/sped/gerar`, g);
    expect(r1.statusCode, r1.body).toBe(200);
    const g1 = r1.json();
    expect(g1).toMatchObject({ ok: true, numero: 1 });
    // O banco guarda cifrado: o CPF não aparece no conteúdo gravado.
    expect(porta.f3.arquivos[0]!.conteudoCifrado).not.toContain('12345678909');
    const baixado = await get(c, `${C}/sped/arquivo?empresa=1&id=${g1.id}`);
    expect(baixado.statusCode, baixado.body).toBe(200);
    const arq = baixado.json();
    expect(arq.conteudo.startsWith('|0000|LECD|01012025|31122025|Hospital Sintético|00000000000191|')).toBe(
      true,
    );
    expect(createHash('sha256').update(arq.conteudo, 'utf8').digest('hex')).toBe(g1.hash);
    expect(arq.conteudo).toContain('|J930|Contador Sintético|12345678909|Contador|900|');

    const r2 = (await post(c, `${C}/sped/gerar`, { ...g, numeroOrdem: 2 })).json();
    expect(r2.numero).toBe(2);
    expect(r2.mensagem).toContain('substituída');
    const lista = (await get(c, `${C}/sped?empresa=1`)).json();
    expect(lista.itens.map((x: { numero: number; situacao: string }) => [x.numero, x.situacao])).toEqual([
      [2, 'gerado'],
      [1, 'substituido'],
    ]);
    expect(JSON.stringify(lista)).not.toContain('12345678909');

    const rec = await post(c, `${C}/sped/situacao`, {
      acao: 'recibo',
      empresa: 1,
      id: r2.id,
      recibo: 'RECIBO-SINT-0001',
      transmitidoEm: '2026-05-20',
    });
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.json().arquivo).toMatchObject({ situacao: 'transmitido', recibo: 'RECIBO-SINT-0001' });
    const de2 = await post(c, `${C}/sped/situacao`, {
      acao: 'cancelar',
      empresa: 1,
      id: r2.id,
      motivo: 'Gerado com o plano errado',
    });
    expect(de2.statusCode).toBe(409);
    expect(de2.json().codigo).toBe('sped-situacao');
    expect((await get(c, `${C}/sped/arquivo?empresa=1&id=999`)).statusCode).toBe(404);
  });

  it('ECF: lucro real recusado com o motivo; a da isenta gerada; sem signatário contador, 400', async () => {
    const c = await entrar('SINT.CONTADOR');
    const g = { empresa: 1, tipo: 'ecf', exercicio: 2025, signatarios: SIGNATARIOS, tipoEntidadeEcf: '05' };
    const real = await post(c, `${C}/sped/gerar`, { ...g, formaTributacao: '1' });
    expect(real.statusCode).toBe(409);
    expect(real.json().codigo).toBe('forma-nao-gerada');
    const isenta = await post(c, `${C}/sped/gerar`, { ...g, formaTributacao: '9' });
    expect(isenta.statusCode, isenta.body).toBe(200);
    expect(isenta.json().numero).toBe(1);
    expect(
      (await post(c, `${C}/sped/gerar`, { ...g, formaTributacao: '9', signatarios: [SIGNATARIOS[1]] }))
        .statusCode,
    ).toBe(400);
  });
});
