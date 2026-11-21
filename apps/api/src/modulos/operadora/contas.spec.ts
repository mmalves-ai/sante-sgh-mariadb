// M56 (etapa 6, F5) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco;
// dados SINTÉTICOS): as contas médicas nascem desligadas (o apoio diz o motivo; o resto dá 403 recurso-desligado);
// ligadas, o ciclo: a carteira e a autorização com a senha (F1 e F4) → o atendimento recebe o lote em XML TISS 04.03.00
// (as recusas do arquivo: XSD, hash, versão, destino, prestador, lote repetido) com o protocolo e a glosa automática → o
// auditor lê a ficha (trilha), glosa e desfaz a glosa, conclui (liberado) → o demonstrativo em XML (XSD e o importador do
// hospital) → o recurso de glosa e a decisão → o pagamento ao prestador pela cobrança (só valores) → a devolução de outro
// lote e o reenvio com o mesmo número → a lista, a busca e as contagens → quem não pode.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  carregarEsquemas,
  lerDemonstrativoXml,
  mensagemLoteGuias,
  validarNoXsd,
  type Cabecalho,
  type GuiaConsulta,
  type GuiaSpSadt,
} from '@sgh/dominio-faturamento';
import { cnpjSintetico, cpfSintetico, numeroCarteirinha } from '@sgh/dominio-operadora';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChaveLiberacao, PrerequisitoRecurso } from '../config/public-api.js';
import { criarAppOperadora } from './infra/app-operadora.spec-util.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { PortaAutorizacaoOperadoraMemoria } from './autorizacao-porta-memoria.js';
import { PortaContasOperadoraMemoria } from './contas-porta-memoria.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';
import { PortaRedeOperadoraMemoria, prestadoresSinteticos } from './rede-porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
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

const trilha = new RegistradorTrilhaMemoria();
const operadora = new PortaOperadoraMemoria(trilha);
const rede = new PortaRedeOperadoraMemoria();
const autorizacao = new PortaAutorizacaoOperadoraMemoria(operadora, rede);
const contas = new PortaContasOperadoraMemoria(operadora, rede, autorizacao);
// O relógio fixo da memória (segunda-feira, 26/10/2026, 10h).
let agora = '2026-10-26T10:00:00';
autorizacao.agora = () => agora;
contas.agora = () => agora;
let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;

beforeAll(async () => {
  ligado = await criarAppOperadora(env, {
    trilha,
    operadora,
    rede: rede,
    autorizacao: autorizacao,
    contas: contas,
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [
        chave('operadora'),
        chave('operadora.beneficiarios'),
        chave('operadora.autorizacao'),
        chave('operadora.contas'),
      ],
      prerequisitosIniciais: () => [
        pre('operadora', 'credenciamento'),
        pre('operadora.autorizacao', 'aprovacao'),
        pre('operadora.contas', 'aprovacao'),
      ],
    }),
  });
  desligado = await criarAppOperadora(env, {});
  for (const a of [ligado, desligado]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
}, 60_000);
afterAll(async () => {
  await ligado.close();
  await desligado.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
let n = 0;
async function entrar(app: NestFastifyApplication, login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m56-6-${++n}-${Date.now()}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const O = '/api/operadora';
const C = `${O}/contas`;
const REGISTRO = '900006';
const PRESTADOR = prestadoresSinteticos()[0]!;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const cab = (p: Partial<Cabecalho> = {}): Cabecalho => ({
  sequencialTransacao: '1',
  data: '2026-10-26',
  hora: '09:00:00',
  codigoPrestadorNaOperadora: PRESTADOR.documento,
  registroANS: REGISTRO,
  ...p,
});
const profissional = { conselho: '06', numeroConselho: '900001', uf: '42', cbos: '225125' };
const sadt = (numero: string, carteira: string, p: Partial<GuiaSpSadt> = {}): GuiaSpSadt => ({
  tipo: 'sp-sadt',
  numeroGuiaPrestador: numero,
  beneficiario: { numeroCarteira: carteira, atendimentoRN: 'N' },
  nomeContratadoSolicitante: 'LABORATORIO SINTETICO ALFA',
  profissionalSolicitante: profissional,
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
  despesas: [
    {
      sequencial: 1,
      codigoDespesa: '03',
      data: '2026-10-24',
      codigoTabela: '19',
      codigo: '70000001',
      descricao: 'MATERIAL SINTETICO',
      quantidade: 2,
      unidadeMedida: '036',
      valorUnitario: 5,
    },
  ],
  ...p,
});
const consulta = (numero: string, carteira: string): GuiaConsulta => ({
  tipo: 'consulta',
  numeroGuiaPrestador: numero,
  beneficiario: { numeroCarteira: carteira, atendimentoRN: 'N' },
  cnes: PRESTADOR.cnes ?? '9999999',
  profissional,
  dataAtendimento: '2026-10-22',
  tipoConsulta: '1',
  procedimento: { codigoTabela: '22', codigo: '10101012' },
  valor: 150,
});

describe('contas médicas da operadora (etapa 6, F5), pela HTTP', { timeout: 120_000 }, () => {
  it('desligada: o apoio diz o motivo; a lista, a ficha e as gravações dão 403 recurso-desligado', async () => {
    const c = pedir(desligado, await entrar(desligado, 'SINT.OPE.ATENDE'));
    const a = await c.get(`${C}/apoio`);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ ligada: false, podeReceber: false, operadoras: [], motivos: [] });
    expect(a.json().motivo).toMatch(/desligada|pré-requisito|Ligada, mas/);
    for (const u of [C, `${C}/1`, `${C}/1/demonstrativo`])
      expect((await c.get(u)).json().codigo, u).toBe('recurso-desligado');
    expect(
      (await c.post(`${C}/xml`, { arquivo: 'PD94bWwgdmVyc2lvbj0iMS4wIj8+', nome: null })).json().codigo,
    ).toBe('recurso-desligado');
    const adm = pedir(desligado, await entrar(desligado, 'SINT.ADMIN'));
    expect((await adm.get(`${C}/apoio`)).statusCode).toBe(403);
  });

  it('o ciclo: receber → glosar → concluir → demonstrativo → recurso → pagar → devolver e reenviar', async () => {
    const gestor = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    const auditor = pedir(ligado, await entrar(ligado, 'SINT.OPE.AUDITOR'));
    const cobranca = pedir(ligado, await entrar(ligado, 'SINT.OPE.COBRANCA'));

    // A carteira sintética (F1), o auditor designado e a autorização com a senha (F4).
    const ope = (
      await gestor.post(`${O}/empresas`, {
        registroAns: REGISTRO,
        cnpj: cnpjSintetico('900000060001'),
        razaoSocial: 'Operadora Sintética F5',
        modalidade: 'medicinaGrupo',
      })
    ).json().id as number;
    const prod = await gestor.post(`${O}/produtos`, {
      operadora: ope,
      codigo: 'F5',
      nome: 'Plano sintético F5',
      natureza: 'plano',
      registroAns: '900000061',
      tipoContratacao: 1,
      segmentacao: 'ambulatorialHospitalar',
      abrangencia: 'estadual',
      acomodacao: 2,
      coparticipacao: { tipo: 1, valor: null },
      carencias: { urgencia: 1, partos: 300, demais: 30, cpt: 0 },
      precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
    });
    expect(prod.statusCode, prod.body).toBe(201);
    const ctr = await gestor.post(`${O}/contratos`, {
      produto: prod.json().id,
      numero: 'F5-0001',
      tipo: 1,
      contratanteNome: 'Contratante Sintético F5',
      contratanteDocumento: cpfSintetico('900000061'),
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2026-01-01',
    });
    expect(ctr.statusCode, ctr.body).toBe(201);
    const ben = await gestor.post(`${O}/beneficiarios`, {
      contrato: ctr.json().id,
      vinculo: 1,
      nome: 'Beneficiário Sintético Contas',
      cpf: cpfSintetico('900000062'),
      nascimento: '1975-03-10',
      sexo: 'M',
      nomeMae: 'Mãe Sintética',
      inclusao: '2026-02-01',
    });
    expect(ben.statusCode, ben.body).toBe(201);
    const carteira = ben.json().carteirinha as string;
    const des = await gestor.post(`${O}/auditores`, {
      operadora: ope,
      login: 'SINT.OPE.AUDITOR',
      nome: 'Auditor Sintético',
      categoria: 'medico',
      numero: '900020',
      uf: 'SC',
      inicio: '2026-10-26',
    });
    expect(des.statusCode, des.body).toBe(200);
    const pedido = await atende.post(`${O}/autorizacoes`, {
      carteirinha: carteira,
      prestador: PRESTADOR.id,
      executante: null,
      tipoGuia: 4,
      carater: 'E',
      altaComplexidade: false,
      origem: 1,
      guiaPrincipal: null,
      cid: null,
      indicacaoClinica: 'Indicação clínica sintética das contas',
      profissional: { nome: 'Profissional Sintético', conselho: 'CRM', numero: '900001', uf: 'SC' },
      internacao: null,
      itens: [{ tabela: 22, codigo: '40301630', descricao: null, quantidade: 2 }],
    });
    expect(pedido.statusCode, pedido.body).toBe(200);
    const fa = (await auditor.get(`${O}/autorizacoes/${pedido.json().id}`)).json();
    const decisao = await auditor.post(`${O}/autorizacoes/${pedido.json().id}/decisao`, {
      versao: fa.versao,
      decisao: 'autorizar',
      itens: fa.itens.map((i: { id: number; quantidadeSolicitada: number }) => ({
        item: i.id,
        quantidadeAutorizada: i.quantidadeSolicitada,
      })),
      diariasAutorizadas: null,
      critica: null,
      fundamento: null,
      parecer: 'Autorizado conforme a indicação',
    });
    expect(decisao.statusCode, decisao.body).toBe(200);
    const senha = decisao.json().senha as string;

    // O apoio ligado: a operadora, os prestadores, os motivos (tabela 38) e o auditor designado.
    const apoio = (await auditor.get(`${C}/apoio`)).json();
    expect(apoio).toMatchObject({ ligada: true, podeAnalisar: true, podeReceber: true, podePagar: false });
    expect(apoio.auditor).toMatchObject({ operadora: ope, categoria: 'medico' });
    expect(apoio.motivos.map((m: { codigo: number }) => m.codigo)).toEqual(
      expect.arrayContaining([1001, 1402, 1408]),
    );
    expect(apoio.parametros).toEqual({ diasPagamento: 30, maximoKilobytes: 700 });

    // O lote: a guia autorizada (1 a mais na quantidade) e a de carteirinha desconhecida.
    const lote = mensagemLoteGuias(cab(), 'L-100', [
      sadt('G-1', carteira, { autorizacao: { data: '2026-10-26', senha } }),
      sadt('G-2', numeroCarteirinha(REGISTRO, 999_999)),
    ]);
    const recusas: [string, Uint8Array | string][] = [
      ['arquivo-invalido', Buffer.from('<html>nada</html>', 'latin1')],
      [
        'versao-recusada',
        Buffer.from(
          lote.xml.replace('<ans:Padrao>4.03.00</ans:Padrao>', '<ans:Padrao>4.01.00</ans:Padrao>'),
          'latin1',
        ),
      ],
      ['xsd-invalido', Buffer.from(lote.xml.replace(/<ans:CNES>[^<]*<\/ans:CNES>/, ''), 'latin1')],
      [
        'hash-nao-confere',
        Buffer.from(
          lote.xml.replace(
            '<ans:quantidadeExecutada>3</ans:quantidadeExecutada>',
            '<ans:quantidadeExecutada>4</ans:quantidadeExecutada>',
          ),
          'latin1',
        ),
      ],
      [
        'operadora-destino-desconhecida',
        mensagemLoteGuias(cab({ registroANS: '900099' }), 'L-100', [sadt('G-1', carteira)]).bytes,
      ],
      [
        'prestador-desconhecido',
        mensagemLoteGuias(cab({ codigoPrestadorNaOperadora: '11222333000181' }), 'L-100', [
          sadt('G-1', carteira),
        ]).bytes,
      ],
    ];
    for (const [codigo, bytes] of recusas) {
      const r = await atende.post(`${C}/xml`, { arquivo: b64(bytes as Uint8Array), nome: 'lote.xml' });
      expect(r.json().codigo, codigo).toBe(codigo);
      if (codigo === 'xsd-invalido') expect(r.json().avisos.length).toBeGreaterThan(0);
    }
    // Só o atendimento e o auditor recebem.
    expect((await cobranca.post(`${C}/xml`, { arquivo: b64(lote.bytes), nome: null })).statusCode).toBe(403);
    const rec = await atende.post(`${C}/xml`, { arquivo: b64(lote.bytes), nome: 'lote-100.xml' });
    expect(rec.statusCode, rec.body).toBe(200);
    const r1 = rec.json();
    expect(r1).toMatchObject({ situacao: 'recebida', versao: 1 });
    expect(r1.protocolo).toMatch(/^202610\d{6}$/);
    expect(r1.mensagem).toContain('Pagamento até 25/11/2026');
    expect(r1.avisos.join(' ')).toContain('Glosa automática de R$ 59,40 em 3 item(ns)');
    expect((await atende.post(`${C}/xml`, { arquivo: b64(lote.bytes), nome: null })).json().codigo).toBe(
      'lote-ja-recebido',
    );

    // A ficha (auditada): as críticas da guia sem beneficiário e a quantidade acima da autorizada.
    const lidas = trilha.eventos.filter((e) => e.evento === 'operadora.conta.lida').length;
    const f1 = (await auditor.get(`${C}/${r1.id}`)).json();
    expect(trilha.eventos.filter((e) => e.evento === 'operadora.conta.lida').length).toBe(lidas + 1);
    expect(f1).toMatchObject({
      situacao: 'recebida',
      apresentado: 94.1,
      glosado: 59.4,
      liberado: 34.7,
      saldo: 0,
      registroAns: REGISTRO,
      acoes: ['glosar', 'concluir', 'devolver'],
    });
    const [g1, g2] = f1.guiasDetalhe;
    expect(g1).toMatchObject({
      senha,
      beneficiario: { nome: 'Beneficiário Sintético Contas' },
      criticas: [],
      glosado: 12.35,
    });
    expect(g1.autorizacao.protocolo).toBe(pedido.json().protocolo);
    expect(g1.itens[0]).toMatchObject({
      glosado: 12.35,
      motivo: 1408,
      origem: 'automatica',
      critica: 'quantidade-acima-da-autorizada',
    });
    expect(g2.criticas.map((x: { codigo: string }) => x.codigo)).toEqual([
      'beneficiario-inexistente',
      'senha-ausente',
    ]);
    expect(g2.itens.map((i: { glosado: number; motivo: number }) => [i.glosado, i.motivo])).toEqual([
      [37.05, 1001],
      [10, 1001],
    ]);
    // O atendimento não glosa; o gestor não lê as contas (conteúdo clínico).
    expect((await atende.post(`${C}/${r1.id}/glosas`, { versao: 1, itens: [] })).statusCode).toBe(403);
    expect((await gestor.get(C)).statusCode).toBe(403);

    // A revisão do auditor: as recusas da glosa, a glosa do material e a glosa automática desfeita.
    const mat = g1.itens[1].id as number;
    const qtd = g1.itens[0].id as number;
    const glosar = (versao: number, itens: unknown[]) =>
      auditor.post(`${C}/${r1.id}/glosas`, { versao, itens });
    expect(
      (await glosar(1, [{ item: mat, valorGlosado: 5, motivo: null, justificativa: 'Sem uso' }])).json()
        .codigo,
    ).toBe('motivo-obrigatorio');
    expect(
      (await glosar(1, [{ item: mat, valorGlosado: 10.01, motivo: 2009, justificativa: 'Sem uso' }])).json()
        .codigo,
    ).toBe('glosa-acima-do-apresentado');
    expect(
      (await glosar(1, [{ item: mat, valorGlosado: 5, motivo: 9998, justificativa: 'Sem uso' }])).json()
        .codigo,
    ).toBe('motivo-inexistente');
    expect(
      (await glosar(1, [{ item: 999_999, valorGlosado: 5, motivo: 2009, justificativa: 'Sem uso' }])).json()
        .codigo,
    ).toBe('item-inexistente');
    const gl = await glosar(1, [
      { item: mat, valorGlosado: 5, motivo: 2009, justificativa: 'Uma unidade sem registro de uso' },
    ]);
    expect(gl.json()).toMatchObject({ versao: 2, mensagem: 'Glosa de R$ 5,00 em 1 item(ns).' });
    expect(
      (await glosar(1, [{ item: mat, valorGlosado: 0, motivo: null, justificativa: null }])).json().codigo,
    ).toBe('conta-desatualizada');
    const desf = await glosar(2, [{ item: qtd, valorGlosado: 0, motivo: null, justificativa: null }]);
    expect(desf.json()).toMatchObject({ versao: 3, mensagem: 'Glosa desfeita em 1 item(ns).' });

    // A conclusão libera o lote; a glosa não vale mais; o demonstrativo sai em XML TISS válido.
    expect((await auditor.get(`${C}/${r1.id}/demonstrativo`)).json().codigo).toBe(
      'demonstrativo-antes-da-analise',
    );
    const conc = await auditor.post(`${C}/${r1.id}/analise`, { versao: 3, observacao: 'Análise sintética' });
    expect(conc.statusCode, conc.body).toBe(200);
    expect(conc.json()).toMatchObject({ situacao: 'analisada', versao: 4 });
    expect(conc.json().mensagem).toContain('liberado R$ 42,05');
    expect(
      (await glosar(4, [{ item: mat, valorGlosado: 0, motivo: null, justificativa: null }])).json().codigo,
    ).toBe('situacao-nao-permite');
    const dem = await atende.get(`${C}/${r1.id}/demonstrativo`);
    expect(dem.statusCode, dem.body).toBe(200);
    const xml = Buffer.from(dem.json().xmlBase64, 'base64');
    expect((await validarNoXsd(new Uint8Array(xml), await carregarEsquemas())).erros).toEqual([]);
    const lido = lerDemonstrativoXml(xml.toString('latin1'));
    expect(lido.numero).toBe(r1.protocolo);
    expect(lido.itens.map((i) => [i.numeroGuia, i.valorInformado, i.valorPago, i.motivo])).toEqual([
      ['G-1', 37.05, 37.05, 0],
      ['G-1', 10, 5, 2009],
      ['G-2', 37.05, 0, 1001],
      ['G-2', 10, 0, 1001],
    ]);

    // O pagamento: a cobrança vê só os valores; o auditor não paga.
    expect((await auditor.get(`${O}/pagamentos-prestadores`)).statusCode).toBe(403);
    const pg = (await cobranca.get(`${O}/pagamentos-prestadores`)).json();
    expect(pg.itens).toEqual([
      expect.objectContaining({ id: r1.id, liberado: 42.05, saldo: 42.05, pago: 0 }),
    ]);
    expect(Object.keys(pg.itens[0])).not.toContain('guiasDetalhe');
    expect(pg.totais).toMatchObject({ aPagar: 1, valorAPagar: 42.05 });
    const pagar = (versao: number, valor: number, data = '2026-10-26') =>
      cobranca.post(`${C}/${r1.id}/pagamento`, { versao, valor, data, documento: 'TED SINT 1' });
    expect((await pagar(4, 42.06)).json().codigo).toBe('pagamento-acima-do-saldo');
    expect((await pagar(4, 10, '2026-10-27')).json().codigo).toBe('pagamento-no-futuro');
    expect((await atende.get(`${C}/${r1.id}/demonstrativo-pagamento`)).json().codigo).toBe(
      'demonstrativo-pagamento-antes-da-quitacao',
    );
    const p1 = await pagar(4, 20);
    expect(p1.json()).toMatchObject({ situacao: 'analisada', versao: 5 });
    expect(p1.json().mensagem).toContain('faltam R$ 22,05');
    expect((await pagar(5, 22.05)).json()).toMatchObject({ situacao: 'paga', versao: 6 });
    expect((await pagar(6, 1)).json().codigo).toBe('nada-a-pagar');

    // O recurso de glosa do prestador (o atendimento registra) e a decisão do auditor (acatado em parte).
    expect(
      (
        await atende.post(`${C}/${r1.id}/recurso`, {
          versao: 6,
          guia: g1.id,
          valor: 6,
          justificativa: 'Uso registrado na folha de sala',
        })
      ).json().codigo,
    ).toBe('recurso-acima-da-glosa');
    const rc = await atende.post(`${C}/${r1.id}/recurso`, {
      versao: 6,
      guia: g2.id,
      valor: 47.05,
      justificativa: 'A carteirinha foi digitada errada no lote',
    });
    expect(rc.json()).toMatchObject({ situacao: 'paga', versao: 7 });
    expect(
      (
        await atende.post(`${C}/${r1.id}/recurso`, {
          versao: 7,
          guia: g2.id,
          valor: 1,
          justificativa: 'De novo, por engano',
        })
      ).json().codigo,
    ).toBe('recurso-ja-registrado');
    expect(
      (
        await atende.post(`${C}/${r1.id}/recurso/decisao`, {
          versao: 7,
          guia: g2.id,
          valorAcatado: 0,
          parecer: 'Mantida a glosa',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await auditor.post(`${C}/${r1.id}/recurso/decisao`, {
          versao: 7,
          guia: g2.id,
          valorAcatado: 48,
          parecer: 'Acatado acima do pedido',
        })
      ).json().codigo,
    ).toBe('acatado-acima-do-recurso');
    const dr = await auditor.post(`${C}/${r1.id}/recurso/decisao`, {
      versao: 7,
      guia: g2.id,
      valorAcatado: 37.05,
      parecer: 'Acatado o procedimento; o material sem registro segue glosado',
    });
    expect(dr.json()).toMatchObject({ situacao: 'analisada', versao: 8 });
    expect(dr.json().mensagem).toContain('Recurso acatado em parte');
    const f2 = (await auditor.get(`${C}/${r1.id}`)).json();
    expect(f2).toMatchObject({
      acatado: 37.05,
      liberado: 79.1,
      pago: 42.05,
      saldo: 37.05,
      acoes: ['recurso'],
    });
    expect(f2.guiasDetalhe[1].recurso).toMatchObject({
      situacao: 'parcial',
      valor: 47.05,
      valorAcatado: 37.05,
    });
    expect((await pagar(8, 37.05)).json()).toMatchObject({ situacao: 'paga' });
    // W0-10 (M8): o demonstrativo de pagamento do lote quitado: XSD válido, data da quitação, a guia do recurso como
    // pagamento de recurso (2), o líquido igual ao pago e cada pagamento na observação.
    const demPag = await atende.get(`${C}/${r1.id}/demonstrativo-pagamento`);
    expect(demPag.statusCode, demPag.body).toBe(200);
    const xmlPag = Buffer.from(demPag.json().xmlBase64, 'base64');
    expect((await validarNoXsd(new Uint8Array(xmlPag), await carregarEsquemas())).erros).toEqual([]);
    const tp = xmlPag.toString('latin1');
    expect(tp).toContain('<ans:dataPagamento>2026-10-26</ans:dataPagamento>');
    expect(tp.match(/<ans:tipoPagamento>\d/g)).toEqual(['<ans:tipoPagamento>1', '<ans:tipoPagamento>2']);
    expect(tp).toContain('<ans:valorLiberadoDemonstrativo>79.10</ans:valorLiberadoDemonstrativo>');
    expect(tp).toContain('<ans:liquidoPorData>79.10</ans:liquidoPorData>');
    expect(tp).toMatch(
      /<ans:observacao>Pagamentos: 26\/10\/2026 R\$ 20,00; 26\/10\/2026 R\$ 22,05; 26\/10\/2026 R\$ 37,05\.<\/ans:observacao>/,
    );
    const eventos = (await auditor.get(`${C}/${r1.id}`))
      .json()
      .eventos.map((e: { evento: string }) => e.evento);
    expect(eventos).toEqual([
      'recebimento',
      'glosa',
      'glosa-desfeita',
      'analise',
      'pagamento',
      'pagamento',
      'recurso',
      'recurso-decidido',
      'pagamento',
    ]);

    // Outro lote (consulta): devolvido sem pagamento; o mesmo número volta corrigido; sem demonstrativo.
    const loteB = mensagemLoteGuias(cab({ sequencialTransacao: '2' }), 'L-200', [consulta('C-1', carteira)]);
    const rb = (await atende.post(`${C}/xml`, { arquivo: b64(loteB.bytes), nome: null })).json();
    expect(rb.avisos).toEqual([]);
    expect((await auditor.post(`${C}/${rb.id}/devolver`, { versao: 1, motivo: 'curto' })).statusCode).toBe(
      400,
    );
    const dv = await auditor.post(`${C}/${rb.id}/devolver`, {
      versao: 1,
      motivo: 'Lote com o tipo de consulta errado',
    });
    expect(dv.json()).toMatchObject({ situacao: 'devolvida' });
    expect((await auditor.get(`${C}/${rb.id}/demonstrativo`)).json().codigo).toBe(
      'demonstrativo-da-devolvida',
    );
    expect((await atende.post(`${C}/xml`, { arquivo: b64(loteB.bytes), nome: null })).json().codigo).toBe(
      'lote-ja-recebido',
    );
    const loteB2 = mensagemLoteGuias(cab({ sequencialTransacao: '3' }), 'L-200', [consulta('C-1', carteira)]);
    const rb2 = await atende.post(`${C}/xml`, { arquivo: b64(loteB2.bytes), nome: null });
    expect(rb2.statusCode, rb2.body).toBe(200);
    expect(rb2.json().avisos).toEqual([]);

    // A lista, a busca e as contagens.
    const lista = (await auditor.get(C)).json();
    expect(
      lista.itens.map((i: { numeroLote: string; situacao: string }) => [i.numeroLote, i.situacao]),
    ).toEqual([
      ['L-200', 'recebida'],
      ['L-200', 'devolvida'],
      ['L-100', 'paga'],
    ]);
    expect(lista.totais).toMatchObject({
      emAnalise: 1,
      aPagar: 0,
      recursosPendentes: 0,
      valorEmAnalise: 150,
    });
    expect((await auditor.get(`${C}?busca=${r1.protocolo}`)).json().itens).toHaveLength(1);
    expect((await auditor.get(`${C}?situacao=devolvida`)).json().itens).toHaveLength(1);
    expect(
      (await auditor.get(`${C}?competencia=2026-10&prestador=${PRESTADOR.id}`)).json().itens,
    ).toHaveLength(3);
    expect((await auditor.get(`${C}?situacao=xpto`)).statusCode).toBe(400);

    // A trilha de cada gravação da F5.
    for (const ev of [
      'operadora.conta.recebida',
      'operadora.conta.glosada',
      'operadora.conta.analisada',
      'operadora.conta.devolvida',
      'operadora.conta.recurso-registrado',
      'operadora.conta.recurso-decidido',
      'operadora.conta.paga',
      'operadora.conta.demonstrativo',
      'operadora.conta.demonstrativo-pagamento',
    ])
      expect(
        trilha.eventos.some((e) => e.evento === ev),
        ev,
      ).toBe(true);
    agora = '2026-12-01T10:00:00';
    expect(
      (await auditor.get(`${C}?vencidas=sim`)).json().itens.map((i: { numeroLote: string }) => i.numeroLote),
    ).toEqual(['L-200']);

    // D-RECURSO-PROPRIO-566: o auditor que registra o recurso não o decide (segunda pessoa obrigatória).
    const rp = await auditor.post(`${C}/${r1.id}/recurso`, {
      versao: 9,
      guia: g1.id,
      valor: 1,
      justificativa: 'Recurso registrado pelo próprio auditor',
    });
    expect(rp.statusCode, rp.body).toBe(200);
    const dp = await auditor.post(`${C}/${r1.id}/recurso/decisao`, {
      versao: 10,
      guia: g1.id,
      valorAcatado: 1,
      parecer: 'Acatado por quem registrou',
    });
    expect(dp.statusCode).toBe(409);
    expect(dp.json()).toMatchObject({ codigo: 'recurso-do-proprio-auditor' });
    expect(dp.json().detail).toContain('outro auditor designado');
  });
});
