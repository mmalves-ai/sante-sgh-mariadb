// W0-10 (M8) pela HTTP, com a sessão real sobre a fonte sintética, o módulo registrado e as portas EM MEMÓRIA (dados SINTÉTICOS): o prestador
// envia o lote XML TISS pelo portal (o inválido no XSD é recusado com os erros; o válido recebe o protocolo; o mesmo
// arquivo não entra de novo; o lote de outro prestador é recusado antes de qualquer escrita), vê os lotes dele (e só os
// dele) e baixa o demonstrativo de análise depois da conclusão do auditor e o de pagamento do lote quitado (XML válido
// no XSD); sem a chave das contas, 403.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { codigoTotp } from '@sgh/dominio-acesso';
import {
  type Cabecalho,
  carregarEsquemas,
  type GuiaSpSadt,
  lerDemonstrativoXml,
  mensagemLoteGuias,
  validarNoXsd,
} from '@sgh/dominio-faturamento';
import { cnpjSintetico, numeroCarteirinha } from '@sgh/dominio-operadora';
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { type ChaveLiberacao, fonteConfiguracaoMemoria, type PrerequisitoRecurso } from '../config/public-api.js';
import { PortaAtendimentoOperadoraMemoria } from './atendimento-porta-memoria.js';
import { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
import { PortaContasOperadoraMemoria } from './contas-porta-memoria.js';
import { moduloOperadora } from './modulo.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';
import { PortaRedeOperadoraMemoria, prestadoresSinteticos } from './rede-porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'operadora' };
const chave = (c: string): ChaveLiberacao => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});
const pre = (recurso: string, tipo: PrerequisitoRecurso['tipo']): PrerequisitoRecurso => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});

const agora = '2026-10-26T10:00:00';
const novaApp = async (contasLigadas: boolean) => {
  const trilha = new RegistradorTrilhaMemoria();
  const operadora = new PortaOperadoraMemoria(trilha);
  const rede = new PortaRedeOperadoraMemoria();
  const autorizacao = new PortaAutorizacaoOperadoraMemoria(operadora, rede);
  const atendimento = new PortaAtendimentoOperadoraMemoria(operadora, rede, autorizacao);
  const contas = new PortaContasOperadoraMemoria(operadora, rede, autorizacao);
  autorizacao.agora = () => agora;
  atendimento.agora = () => agora;
  contas.agora = () => agora;
  const configuracao = fonteConfiguracaoMemoria(trilha, {
    chavesIniciais: () => [
      chave('operadora'),
      chave('operadora.beneficiarios'),
      chave('operadora.autorizacao'),
      chave('operadora.atendimento'),
      chave('operadora.portalPrestador'),
      ...(contasLigadas ? [chave('operadora.contas')] : []),
    ],
    prerequisitosIniciais: () => [
      pre('operadora', 'credenciamento'),
      pre('operadora.autorizacao', 'aprovacao'),
      pre('operadora.contas', 'aprovacao'),
    ],
  });
  const app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      operadora: async () => ({
        modulo: (ctx) => moduloOperadora(ctx, { operadora, rede, autorizacao, atendimento, contas, configuracao }),
      }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
};
let ligado: NestFastifyApplication;
let semContas: NestFastifyApplication;
beforeAll(async () => {
  ligado = await novaApp(true);
  semContas = await novaApp(false);
}, 60_000);
afterAll(async () => {
  await ligado.close();
  await semContas.close();
});

let n = 0;
async function entrar(app: NestFastifyApplication, login: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  const csrf =
    set
      .find((c) => c.startsWith('sgh_csrf='))
      ?.split(';')[0]
      ?.slice(9) ?? '';
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie } }),
    post: (url: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { cookie, 'x-csrf': csrf, 'idempotency-key': `w0-10-m8-${++n}-${Date.now()}` },
      }),
  };
}

const O = '/api/operadora';
const C = `${O}/contas`;
const PP = '/api/portal-prestador';
const REGISTRO = '900010';
const [PRESTADOR, OUTRO] = prestadoresSinteticos() as [
  ReturnType<typeof prestadoresSinteticos>[number],
  ReturnType<typeof prestadoresSinteticos>[number],
];
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const cab = (p: Partial<Cabecalho> = {}): Cabecalho => ({
  sequencialTransacao: '1',
  data: '2026-10-26',
  hora: '09:00:00',
  codigoPrestadorNaOperadora: PRESTADOR.documento,
  registroANS: REGISTRO,
  ...p,
});
const sadt = (numero: string, carteira: string): GuiaSpSadt => ({
  tipo: 'sp-sadt',
  numeroGuiaPrestador: numero,
  beneficiario: { numeroCarteira: carteira, atendimentoRN: 'N' },
  nomeContratadoSolicitante: 'LABORATORIO SINTETICO ALFA',
  profissionalSolicitante: { conselho: '06', numeroConselho: '900001', uf: '42', cbos: '225125' },
  cnes: PRESTADOR.cnes ?? '9999999',
  caraterAtendimento: '1',
  tipoAtendimento: '23',
  itens: [
    {
      sequencial: 1,
      data: '2026-10-24',
      procedimento: { codigoTabela: '22', codigo: '40301630', descricao: 'DOSAGEM SINTETICA' },
      quantidade: 3,
      valorUnitario: 12.35,
    },
  ],
  despesas: [],
});

async function portal(
  app: NestFastifyApplication,
  ope: number,
  prestador: number,
  login: string,
  ip: string,
) {
  const gestor = await entrar(app, 'SINT.OPERADORA');
  const cria = await gestor.post(`${O}/portal/acessos`, {
    operadora: ope,
    prestador,
    login,
    nome: 'Responsável das Contas Sintético',
    tipoAtendimento: 1,
    funcoes: [3],
  });
  expect(cria.statusCode, cria.body).toBe(200);
  const at = await app.inject({
    method: 'POST',
    url: `${PP}/aa/ativacao`,
    remoteAddress: ip,
    payload: { login, codigo: cria.json().codigoAtivacao, senha: 'senha-sintetica-81' },
  });
  expect(at.statusCode, at.body).toBe(200);
  const segredo = new URL(at.json().otpauth as string).searchParams.get('secret') as string;
  const ok = await app.inject({
    method: 'POST',
    url: `${PP}/aa/entrada`,
    remoteAddress: ip,
    payload: { login, senha: 'senha-sintetica-81', codigo: codigoTotp(segredo, Date.now()) },
  });
  expect(ok.statusCode, ok.body).toBe(200);
  const set = ok.headers['set-cookie'] as string[];
  const cookie = set.map((c) => c.split(';')[0]).join('; ');
  const csrf =
    set
      .find((c) => c.startsWith('sgh_portal_prestador_csrf='))
      ?.split(';')[0]
      ?.split('=')[1] ?? '';
  return {
    get: (u: string) => app.inject({ method: 'GET', url: u, headers: { cookie } }),
    post: (u: string, payload: object, comCsrf = true) =>
      app.inject({
        method: 'POST',
        url: u,
        payload,
        headers: { cookie, ...(comCsrf ? { 'x-csrf-portal-prestador': csrf } : {}) },
      }),
  };
}

async function operadoraSintetica(app: NestFastifyApplication): Promise<number> {
  const gestor = await entrar(app, 'SINT.OPERADORA');
  const r = await gestor.post(`${O}/empresas`, {
    registroAns: REGISTRO,
    cnpj: cnpjSintetico('900000100001'),
    razaoSocial: 'Operadora Sintética M8',
    modalidade: 'medicinaGrupo',
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as number;
}

describe('W0-10 (M8): contas médicas pelo portal do prestador, pela HTTP', { timeout: 120_000 }, () => {
  it('envio do lote (XSD, protocolo, lote repetido, lote de outro prestador), os lotes dele e o demonstrativo', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(agora));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const ope = await operadoraSintetica(ligado);
    const pp = await portal(ligado, ope, PRESTADOR.id, 'contas@clinica.invalid', '10.0.8.1');
    const lote = mensagemLoteGuias(cab(), 'P-200', [sadt('PG-1', numeroCarteirinha(REGISTRO, 999_998))]);

    // O inválido no XSD é recusado com os erros; nada é gravado.
    const xsd = await pp.post(`${PP}/contas`, {
      arquivo: b64(Buffer.from(lote.xml.replace(/<ans:CNES>[^<]*<\/ans:CNES>/, ''), 'latin1')),
      nome: 'lote.xml',
    });
    expect(xsd.statusCode, xsd.body).toBe(409);
    expect(xsd.json().codigo).toBe('xsd-invalido');
    expect(xsd.json().avisos.length).toBeGreaterThan(0);
    // O lote de outro prestador da rede (o XML é válido): recusado antes de qualquer escrita.
    const outro = mensagemLoteGuias(cab({ codigoPrestadorNaOperadora: OUTRO.documento }), 'P-201', [
      sadt('PG-9', numeroCarteirinha(REGISTRO, 999_997)),
    ]);
    const neg = await pp.post(`${PP}/contas`, { arquivo: b64(outro.bytes), nome: null });
    expect(neg.json().codigo, neg.body).toBe('lote-de-outro-prestador');
    expect((await pp.get(`${PP}/contas`)).json().itens).toEqual([]);
    // Sem o CSRF do portal, nada entra.
    expect((await pp.post(`${PP}/contas`, { arquivo: b64(lote.bytes), nome: null }, false)).statusCode).toBe(
      403,
    );

    // O válido recebe o protocolo; o mesmo arquivo não entra de novo.
    const ok = await pp.post(`${PP}/contas`, { arquivo: b64(lote.bytes), nome: 'lote-p200.xml' });
    expect(ok.statusCode, ok.body).toBe(200);
    const r = ok.json();
    expect(r).toMatchObject({ ok: true, situacao: 'recebida', versao: 1 });
    expect(r.protocolo).toMatch(/^202610\d{6}$/);
    expect(r.mensagem).toContain('Pagamento previsto até 25/11/2026');
    expect(r.avisos.join(' ')).toContain('Glosa automática');
    expect((await pp.post(`${PP}/contas`, { arquivo: b64(lote.bytes), nome: null })).json().codigo).toBe(
      'lote-ja-recebido',
    );

    // A lista do prestador; o lote chega à operadora com o mesmo protocolo e o texto do portal.
    const lista = (await pp.get(`${PP}/contas`)).json();
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]).toMatchObject({
      id: r.id,
      protocolo: r.protocolo,
      numeroLote: 'P-200',
      situacao: 'recebida',
      prestador: PRESTADOR.id,
      demonstrativo: false,
      demonstrativoPagamento: false,
    });
    const auditor = await entrar(ligado, 'SINT.OPE.AUDITOR');
    const des = await (
      await entrar(ligado, 'SINT.OPERADORA')
    ).post(`${O}/auditores`, {
      operadora: ope,
      login: 'SINT.OPE.AUDITOR',
      nome: 'Auditor Sintético',
      categoria: 'medico',
      numero: '900021',
      uf: 'SC',
      inicio: '2026-10-26',
    });
    expect(des.statusCode, des.body).toBe(200);
    const ficha = (await auditor.get(`${C}/${r.id}`)).json();
    expect(ficha).toMatchObject({ protocolo: r.protocolo, situacao: 'recebida' });

    // O demonstrativo só depois da análise; o de lote alheio é 404.
    expect((await pp.get(`${PP}/contas/${r.id}/demonstrativo`)).json().codigo).toBe(
      'demonstrativo-antes-da-analise',
    );
    expect((await pp.get(`${PP}/contas/${r.id}/demonstrativo-pagamento`)).json().codigo).toBe(
      'demonstrativo-pagamento-antes-da-quitacao',
    );
    const conc = await auditor.post(`${C}/${r.id}/analise`, {
      versao: 1,
      observacao: 'Análise sintética M8',
    });
    expect(conc.statusCode, conc.body).toBe(200);
    // Toda glosada (carteirinha desconhecida), a conta fica liquidada ("paga") na conclusão.
    expect((await pp.get(`${PP}/contas`)).json().itens[0]).toMatchObject({
      situacao: 'paga',
      demonstrativo: true,
      demonstrativoPagamento: true,
    });
    const dem = await pp.get(`${PP}/contas/${r.id}/demonstrativo`);
    expect(dem.statusCode, dem.body).toBe(200);
    const xml = Buffer.from(dem.json().xmlBase64, 'base64');
    expect((await validarNoXsd(new Uint8Array(xml), await carregarEsquemas())).erros).toEqual([]);
    expect(lerDemonstrativoXml(xml.toString('latin1')).numero).toBe(r.protocolo);
    // O demonstrativo de pagamento do lote quitado: XSD válido, sem valor liberado (tudo glosado), sem pagamento listado.
    const pag = await pp.get(`${PP}/contas/${r.id}/demonstrativo-pagamento`);
    expect(pag.statusCode, pag.body).toBe(200);
    expect(pag.json().nome).toBe(`demonstrativo-pagamento-${r.protocolo}.xml`);
    const xmlPag = Buffer.from(pag.json().xmlBase64, 'base64');
    expect((await validarNoXsd(new Uint8Array(xmlPag), await carregarEsquemas())).erros).toEqual([]);
    const textoPag = xmlPag.toString('latin1');
    expect(textoPag).toContain('<ans:tipoTransacao>DEMONSTRATIVO_PAGAMENTO</ans:tipoTransacao>');
    expect(textoPag).toContain(`<ans:numeroProtocolo>${r.protocolo}</ans:numeroProtocolo>`);
    expect(textoPag).toContain('<ans:valorLiberadoDemonstrativo>0.00</ans:valorLiberadoDemonstrativo>');
    expect(textoPag).not.toContain('<ans:observacao>');

    const alheio = await portal(ligado, ope, OUTRO.id, 'contas-outro@clinica.invalid', '10.0.8.2');
    expect((await alheio.get(`${PP}/contas`)).json().itens).toEqual([]);
    expect((await alheio.get(`${PP}/contas/${r.id}/demonstrativo`)).statusCode).toBe(404);
    expect((await alheio.get(`${PP}/contas/${r.id}/demonstrativo-pagamento`)).statusCode).toBe(404);

    // M8, recurso de glosa por item: as glosas do lote (só o dono vê), o recurso item a item e a decisão da operadora.
    expect((await alheio.get(`${PP}/contas/${r.id}/glosas`)).statusCode).toBe(404);
    const gl = await pp.get(`${PP}/contas/${r.id}/glosas`);
    expect(gl.statusCode, gl.body).toBe(200);
    const glosas = gl.json();
    expect(glosas).toMatchObject({ id: r.id, protocolo: r.protocolo, situacao: 'paga', podeRecorrer: true });
    expect(glosas.guias).toHaveLength(1);
    const guia = glosas.guias[0];
    expect(guia).toMatchObject({ numeroGuiaPrestador: 'PG-1', recurso: null, recorrivel: true });
    expect(guia.itens.length).toBeGreaterThan(0);
    const item = guia.itens[0];
    expect(item.glosado).toBeGreaterThan(0);
    expect(item.motivo).not.toBeNull();
    const corpoRecurso = (valor: number, itens = [item.id]) => ({
      versao: glosas.versao,
      guia: guia.id,
      itens: itens.map((i) => ({
        item: i,
        valor,
        justificativa: 'Beneficiário elegível na data do atendimento.',
      })),
      justificativa: 'Carteirinha válida: segue a cópia do cartão do beneficiário.',
    });
    // As recusas, antes de qualquer escrita: valor acima da glosa do item, item repetido, item de outra guia, sem CSRF.
    const acima = await pp.post(`${PP}/contas/${r.id}/recursos`, corpoRecurso(item.glosado + 1));
    expect(acima.statusCode).toBe(409);
    expect(acima.json().codigo).toBe('recurso-acima-da-glosa-do-item');
    expect(
      (await pp.post(`${PP}/contas/${r.id}/recursos`, corpoRecurso(1, [item.id, item.id]))).json().codigo,
    ).toBe('item-repetido');
    expect((await pp.post(`${PP}/contas/${r.id}/recursos`, corpoRecurso(1, [999_999]))).json().codigo).toBe(
      'item-nao-encontrado',
    );
    expect((await pp.post(`${PP}/contas/${r.id}/recursos`, corpoRecurso(1), false)).statusCode).toBe(403);
    expect((await alheio.post(`${PP}/contas/${r.id}/recursos`, corpoRecurso(1))).statusCode).toBe(404);
    const vale = Math.round(item.glosado * 50) / 100;
    const rec = await pp.post(`${PP}/contas/${r.id}/recursos`, corpoRecurso(vale));
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.json()).toMatchObject({ ok: true, protocolo: r.protocolo, situacao: 'paga' });
    expect(rec.json().mensagem).toContain('A operadora decide item a item');
    // Um recurso por guia: o segundo é recusado.
    expect(
      (
        await pp.post(`${PP}/contas/${r.id}/recursos`, { ...corpoRecurso(vale), versao: rec.json().versao })
      ).json().codigo,
    ).toBe('recurso-ja-registrado');
    const depois = (await pp.get(`${PP}/contas/${r.id}/glosas`)).json();
    expect(depois.guias[0]).toMatchObject({
      recorrivel: false,
      recurso: { situacao: 'pendente', valor: vale },
    });
    expect(depois.guias[0].itens[0].recurso).toMatchObject({ valor: vale, decisao: null });

    // Na operadora: a ficha mostra o recurso por item; a decisão pela guia é recusada; decide-se item a item.
    const f2 = (await auditor.get(`${C}/${r.id}`)).json();
    expect(f2.guiasDetalhe[0].recursosItens).toHaveLength(1);
    expect(f2.guiasDetalhe[0].recursosItens[0]).toMatchObject({ item: item.id, valor: vale, decisao: null });
    const pelaGuia = await auditor.post(`${C}/${r.id}/recurso/decisao`, {
      versao: f2.versao,
      guia: guia.id,
      valorAcatado: 0,
      parecer: 'Parecer pela guia inteira.',
    });
    expect(pelaGuia.json().codigo, pelaGuia.body).toBe('recurso-por-item');
    const decidir = (decisoes: unknown[]) =>
      auditor.post(`${C}/${r.id}/guias/${guia.id}/recurso-itens/decisao`, {
        versao: f2.versao,
        decisoes,
        parecer: 'Carteirinha conferida no cadastro do beneficiário.',
      });
    expect((await decidir([])).statusCode).toBe(400);
    expect(
      (await decidir([{ item: item.id, valorAcatado: vale + 1, parecer: 'Acatado acima do pedido.' }])).json()
        .codigo,
    ).toBe('acatado-acima-do-recurso-do-item');
    const meio = Math.round(vale * 50) / 100;
    const dec = await decidir([{ item: item.id, valorAcatado: meio, parecer: 'Acatado em parte do item.' }]);
    expect(dec.statusCode, dec.body).toBe(200);
    expect(dec.json().mensagem).toContain('Recurso acatado em parte na guia PG-1, item a item');
    expect(dec.json().situacao).toBe('analisada');
    const f3 = (await auditor.get(`${C}/${r.id}`)).json();
    expect(f3.guiasDetalhe[0]).toMatchObject({ acatado: meio, recurso: { situacao: 'parcial' } });
    expect(f3.guiasDetalhe[0].recursosItens[0].decisao).toMatchObject({
      decisao: 'parcial',
      valorAcatado: meio,
      parecer: 'Acatado em parte do item.',
      por: 'SINT.OPE.AUDITOR',
    });
    // O prestador vê a decisão de cada item.
    const fim = (await pp.get(`${PP}/contas/${r.id}/glosas`)).json();
    expect(fim.guias[0].itens[0].recurso.decisao).toMatchObject({ decisao: 'parcial', valorAcatado: meio });
    // Decidido não se decide de novo.
    expect(
      (
        await auditor.post(`${C}/${r.id}/guias/${guia.id}/recurso-itens/decisao`, {
          versao: f3.versao,
          decisoes: [{ item: item.id, valorAcatado: 0, parecer: 'Segunda decisão do item.' }],
          parecer: 'Segunda decisão da guia.',
        })
      ).json().codigo,
    ).toBe('sem-recurso-pendente');
  });

  it('sem a chave das contas, o envio, a lista, o demonstrativo, as glosas e o recurso dão 403 recurso-desligado', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(agora));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const ope = await operadoraSintetica(semContas);
    const pp = await portal(semContas, ope, PRESTADOR.id, 'semcontas@clinica.invalid', '10.0.8.3');
    for (const x of [
      await pp.get(`${PP}/contas`),
      await pp.get(`${PP}/contas/1/demonstrativo`),
      await pp.get(`${PP}/contas/1/demonstrativo-pagamento`),
      await pp.get(`${PP}/contas/1/glosas`),
      await pp.post(`${PP}/contas/1/recursos`, {
        versao: 1,
        guia: 1,
        itens: [{ item: 1, valor: 1, justificativa: 'Justificativa sintética do item.' }],
        justificativa: 'Justificativa sintética da guia.',
      }),
      await pp.post(`${PP}/contas`, { arquivo: 'PD94bWwgdmVyc2lvbj0iMS4wIj8+', nome: null }),
    ]) {
      expect(x.statusCode, x.body).toBe(403);
      expect(x.json().codigo).toBe('recurso-desligado');
    }
  });
});
