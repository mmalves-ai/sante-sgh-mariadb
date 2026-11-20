// M56.2 (fatia F1) pela HTTP, com a sessão real sobre a fonte sintética e a porta da operadora EM MEMÓRIA (nada conecta
// a banco; documentos SINTÉTICOS): com a chave desligada, a tela diz o que falta e as rotas dão 403; com o módulo e a
// fatia ligados (e o registro na ANS cumprido), o ciclo operadora → produto (RN 63, regra 2) → contrato PF e PJ →
// titular e dependente (carteirinha e 1ª via) → ficha (auditada) → elegibilidade → segunda via → baixa do titular com o
// dependente → reativação; as recusas de negócio em português, a concorrência pela versão, o escopo da operadora (regra
// 3: o contrato herda a operadora do produto; um registro de outra não é aceito), a ligação com o paciente só pelo ID
// (regra 8), quem só lê (403 ao gravar) e quem não tem perfil da operadora.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { carteirinhaValida, cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveGravada => ({
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
const registroAns: PrerequisitoGravado = {
  recurso: 'operadora',
  tipo: 'credenciamento',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'registro sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
};

let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();

beforeAll(async () => {
  ligado = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    operadora: new PortaOperadoraMemoria(trilha),
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [chave('operadora'), chave('operadora.beneficiarios')],
      prerequisitosIniciais: () => [registroAns],
    }),
  });
  desligado = await criarApp(lerConfiguracao(env), null, env, {});
  for (const a of [ligado, desligado]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
});
afterAll(async () => {
  await ligado.close();
  await desligado.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
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
const O = '/api/operadora';
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = { cookie: s.cookie, 'x-csrf': s.csrf };
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h }),
    put: (url: string, payload: unknown) =>
      app.inject({ method: 'PUT', url, payload: payload as object, headers: h }),
  };
};

const PRECOS = [100, 120, 130, 140, 150, 170, 200, 240, 300, 400];
const produto = (operadora: number, extra: Record<string, unknown> = {}) => ({
  operadora,
  codigo: 'AMB-HOSP',
  nome: 'Plano sintético enfermaria',
  natureza: 'plano',
  registroAns: '900.000/00-1',
  tipoContratacao: 1,
  segmentacao: 'ambulatorialHospitalar',
  abrangencia: 'estadual',
  acomodacao: 2,
  coparticipacao: { tipo: 1, valor: null },
  carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
  precos: PRECOS,
  ...extra,
});
const CPF_TITULAR = cpfSintetico('900000011');
const CPF_CONTRATANTE = cpfSintetico('900000012');

describe('operadora própria, fatia F1, pela HTTP', { timeout: 120_000 }, () => {
  it('chave desligada: a tela diz o que falta; as rotas dão 403 sem ler nada', async () => {
    const c = pedir(desligado, await entrar(desligado, 'SINT.OPERADORA'));
    const t = await c.get(`${O}/beneficiarios/tela`);
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({
      liberacao: { ligada: false },
      operadoras: [],
      acoes: { editar: false },
    });
    expect(t.json().liberacao.motivo).toMatch(/desligada|Ligada, mas/);
    for (const u of ['empresas', 'produtos', 'contratos', 'beneficiarios', 'elegibilidade?carteirinha=1'])
      expect((await c.get(`${O}/${u}`)).statusCode, u).toBe(403);
    expect((await c.post(`${O}/empresas`, {})).statusCode).toBe(400);
  });

  it('o ciclo: operadora → produto → contrato → titular e dependente → ficha → elegibilidade → via → baixa → reativação', async () => {
    const c = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const t0 = (await c.get(`${O}/beneficiarios/tela`)).json();
    expect(t0).toMatchObject({ liberacao: { ligada: true }, acoes: { editar: true, editarEmpresa: true } });
    expect(t0.dominios.motivosSegundaVia.length).toBeGreaterThan(0);

    // Operadora: o CNPJ e o registro conferidos; repetido, recusa.
    const ope = {
      registroAns: '900001',
      cnpj: cnpjSintetico('900000010001'),
      razaoSocial: 'Operadora Sintética',
      modalidade: 'medicinaGrupo',
    };
    expect((await c.post(`${O}/empresas`, { ...ope, cnpj: '11111111111111' })).json()).toMatchObject({
      codigo: 'cnpj-invalido',
    });
    const o = await c.post(`${O}/empresas`, ope);
    expect(o.statusCode).toBe(201);
    const opeId = o.json().id as number;
    expect((await c.post(`${O}/empresas`, ope)).json()).toMatchObject({ codigo: 'registro-ans-em-uso' });

    // Produto: RN 63 e regra 2.
    const ruim = await c.post(`${O}/produtos`, produto(opeId, { precos: [...PRECOS.slice(0, 9), 700] }));
    expect(ruim.statusCode).toBe(422);
    expect(ruim.json().detail).toContain('6 vezes');
    const cartao = await c.post(
      `${O}/produtos`,
      produto(opeId, {
        codigo: 'CARTAO',
        natureza: 'cartaoDesconto',
        registroAns: '900000002',
        segmentacao: null,
        acomodacao: null,
        carencias: { urgencia: 0, partos: 0, demais: 0, cpt: 0 },
        precos: null,
      }),
    );
    expect(cartao.json()).toMatchObject({ codigo: 'cartao-desconto-com-registro-ans' });
    const p = await c.post(`${O}/produtos`, produto(opeId));
    expect(p.statusCode).toBe(201);
    const prodId = p.json().id as number;
    const coletivo = await c.post(
      `${O}/produtos`,
      produto(opeId, { codigo: 'COLETIVO', tipoContratacao: 2 }),
    );
    const coletivoId = coletivo.json().id as number;
    const prods = (await c.get(`${O}/produtos?operadora=${opeId}`)).json();
    expect(prods.map((x: { codigo: string }) => x.codigo).sort()).toEqual(['AMB-HOSP', 'COLETIVO']);
    expect(prods.find((x: { id: number }) => x.id === prodId).registroAns).toBe('900000001');

    // Contrato PF (CPF) e PJ (CNPJ), no tipo de contratação do produto.
    const contrato = {
      produto: prodId,
      numero: '2026-0001',
      tipo: 1,
      contratanteNome: 'Contratante Sintético da Silva',
      contratanteDocumento: CPF_CONTRATANTE,
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2026-01-01',
    };
    expect((await c.post(`${O}/contratos`, { ...contrato, produto: coletivoId })).json()).toMatchObject({
      codigo: 'contratacao-incompativel',
    });
    const k = await c.post(`${O}/contratos`, contrato);
    expect(k.statusCode).toBe(201);
    const ctrId = k.json().id as number;
    const pj = await c.post(`${O}/contratos`, {
      ...contrato,
      produto: coletivoId,
      numero: '2026-0002',
      tipo: 2,
      contratanteNome: 'Empresa Sintética Ltda',
      contratanteDocumento: cnpjSintetico('900000020001'),
    });
    expect(pj.statusCode).toBe(201);
    const lista = (await c.get(`${O}/contratos?operadora=${opeId}&busca=contratante`)).json();
    expect(lista.itens).toHaveLength(1);
    // Na lista, o CPF do contratante sai mascarado; na leitura do contrato (auditada), inteiro.
    expect(lista.itens[0].contratanteDocumento).toMatch(/^\*\*\*\./);
    expect((await c.get(`${O}/contratos/${ctrId}`)).json().contratanteDocumento).toBe(CPF_CONTRATANTE);
    expect((await c.get(`${O}/contratos?busca=2026-000`)).json().itens).toHaveLength(2);

    // Titular: a carteirinha de 16 dígitos com o registro da operadora e a 1ª via.
    const titular = {
      contrato: ctrId,
      vinculo: 1,
      nome: 'Beneficiária Sintética Titular',
      cpf: CPF_TITULAR,
      nascimento: '1980-05-10',
      sexo: 'F',
      nomeMae: 'Mãe Sintética',
      inclusao: '2026-02-01',
      pacienteHospital: 4321,
    };
    expect((await c.post(`${O}/beneficiarios`, { ...titular, cpf: null })).json()).toMatchObject({
      codigo: 'cpf-obrigatorio',
    });
    expect(
      (await c.post(`${O}/beneficiarios`, { ...titular, pacienteHospital: 999_999_999 })).json(),
    ).toMatchObject({
      codigo: 'paciente-inexistente',
    });
    const b = await c.post(`${O}/beneficiarios`, titular);
    expect(b.statusCode).toBe(201);
    const titId = b.json().id as number;
    const carteirinha = b.json().carteirinha as string;
    expect(carteirinha.startsWith('900001')).toBe(true);
    expect(carteirinhaValida(carteirinha)).toBe(true);
    // Contrato de pessoa física: um titular só.
    expect(
      (
        await c.post(`${O}/beneficiarios`, {
          ...titular,
          cpf: cpfSintetico('900000013'),
          pacienteHospital: null,
        })
      ).json(),
    ).toMatchObject({
      codigo: 'contrato-pf-ja-tem-titular',
    });
    const dep = await c.post(`${O}/beneficiarios`, {
      contrato: ctrId,
      titular: titId,
      vinculo: 5,
      nome: 'Dependente Sintético',
      nascimento: '2015-03-01',
      sexo: 'M',
      nomeMae: 'Beneficiária Sintética Titular',
      inclusao: '2026-02-01',
    });
    expect(dep.statusCode).toBe(201);
    const depId = dep.json().id as number;

    // Lista: CPF mascarado; busca pelo nome, pela carteirinha e pelo CPF.
    const l = (await c.get(`${O}/beneficiarios?busca=${encodeURIComponent('beneficiária')}`)).json();
    expect(l.itens).toHaveLength(1);
    expect(l.itens[0].cpf).toMatch(/^\*\*\*\./);
    expect((await c.get(`${O}/beneficiarios?busca=${carteirinha}`)).json().itens[0].id).toBe(titId);
    expect((await c.get(`${O}/beneficiarios?busca=${CPF_TITULAR}`)).json().itens[0].id).toBe(titId);
    // Ficha (auditada): CPF inteiro, dependente e a 1ª via.
    const lidasAntes = trilha.eventos.filter((e) => e.evento === 'operadora.beneficiario.lido').length;
    const f = (await c.get(`${O}/beneficiarios/${titId}`)).json();
    expect(f).toMatchObject({
      cpf: CPF_TITULAR,
      via: 1,
      pacienteHospital: 4321,
      registroAnsOperadora: '900001',
    });
    expect(f.dependentes.map((d: { id: number }) => d.id)).toEqual([depId]);
    expect(f.carteirinhas).toHaveLength(1);
    expect(trilha.eventos.filter((e) => e.evento === 'operadora.beneficiario.lido').length).toBe(
      lidasAntes + 1,
    );
    expect(trilha.eventos.some((e) => e.evento === 'operadora.beneficiario.gravado')).toBe(true);

    // Elegibilidade pela carteirinha, com as carências contadas da adesão.
    const el = (await c.get(`${O}/elegibilidade?carteirinha=${carteirinha}&data=2026-10-24`)).json();
    expect(el).toMatchObject({ elegivel: true, motivos: [], plano: { registroAns: '900000001' } });
    expect(el.carencias.find((x: { tipo: string }) => x.tipo === 'urgencia').cumprida).toBe(true);
    expect((await c.get(`${O}/elegibilidade?carteirinha=1234`)).json().motivos).toEqual([
      'carteirinha-invalida',
    ]);

    // Segunda via: com o motivo; sem ele, recusa; a versão vencida, desatualizado.
    expect(
      (await c.post(`${O}/beneficiarios/${titId}/carteirinha`, { versao: f.versao })).json(),
    ).toMatchObject({
      codigo: 'segunda-via-sem-motivo',
    });
    const v = await c.post(`${O}/beneficiarios/${titId}/carteirinha`, { motivo: 1, versao: f.versao });
    expect(v.statusCode).toBe(201);
    expect(v.json().mensagem).toContain('Via 2');
    expect(
      (await c.post(`${O}/beneficiarios/${titId}/carteirinha`, { motivo: 1, versao: f.versao })).json(),
    ).toMatchObject({
      codigo: 'desatualizado',
    });

    // Baixa do titular leva o dependente; a elegibilidade passa a recusar; reativação do titular.
    const f2 = (await c.get(`${O}/beneficiarios/${titId}`)).json();
    const bx = await c.post(`${O}/beneficiarios/${titId}/baixa`, {
      motivo: 1,
      data: '2026-10-20',
      versao: f2.versao,
    });
    expect(bx.statusCode).toBe(201);
    expect(bx.json().mensagem).toContain('1 dependente');
    expect((await c.get(`${O}/beneficiarios/${depId}`)).json().situacao).toBe('excluido');
    expect(
      (await c.get(`${O}/elegibilidade?carteirinha=${carteirinha}&data=2026-10-24`)).json().motivos,
    ).toEqual(['beneficiario-excluido']);
    const f3 = (await c.get(`${O}/beneficiarios/${titId}`)).json();
    expect((await c.post(`${O}/beneficiarios/${titId}/reativacao`, { versao: f3.versao })).statusCode).toBe(
      201,
    );
    // Contrato com beneficiário ativo não se encerra.
    const ctr = (await c.get(`${O}/contratos/${ctrId}`)).json();
    const enc = await c.put(`${O}/contratos/${ctrId}`, {
      ...contrato,
      situacao: 'encerrado',
      motivoSituacao: 'Fim sintético',
      versao: ctr.versao,
    });
    expect(enc.json()).toMatchObject({ codigo: 'encerrado-com-beneficiarios-ativos' });

    // D-BAIXA-56 e D-PF-TITULAR-56: contrato com beneficiário não troca de produto nem de tipo (mudança de plano é
    // baixa e nova adesão); o resto do contrato segue alterável.
    const outroIndividual = await c.post(`${O}/produtos`, produto(opeId, { codigo: 'INDIV-2' }));
    expect(outroIndividual.statusCode).toBe(201);
    const trocaProduto = await c.put(`${O}/contratos/${ctrId}`, {
      ...contrato,
      produto: outroIndividual.json().id,
      versao: ctr.versao,
    });
    expect(trocaProduto.statusCode).toBe(422);
    expect(trocaProduto.json()).toMatchObject({ codigo: 'produto-com-beneficiarios' });
    const trocaTipo = await c.put(`${O}/contratos/${ctrId}`, {
      ...contrato,
      produto: coletivoId,
      tipo: 2,
      contratanteDocumento: cnpjSintetico('900000020001'),
      versao: ctr.versao,
    });
    expect(trocaTipo.json().bloqueios).toEqual(['produto-com-beneficiarios', 'tipo-com-beneficiarios']);
    const soNome = await c.put(`${O}/contratos/${ctrId}`, {
      ...contrato,
      contratanteNome: 'Contratante Sintético Alterado',
      versao: ctr.versao,
    });
    expect(soNome.statusCode).toBe(200);

    // Produto com contrato em uso: natureza, tipo de contratação e registro na ANS ficam; nome e preços mudam.
    const pAtual = (await c.get(`${O}/produtos?operadora=${opeId}`))
      .json()
      .find((x: { id: number }) => x.id === prodId);
    for (const extra of [
      { tipoContratacao: 2 },
      { registroAns: '900000003' },
      {
        natureza: 'cartaoDesconto',
        registroAns: null,
        segmentacao: null,
        abrangencia: null,
        acomodacao: null,
        carencias: { urgencia: 0, partos: 0, demais: 0, cpt: 0 },
      },
    ])
      expect(
        (await c.put(`${O}/produtos/${prodId}`, produto(opeId, { ...extra, versao: pAtual.versao }))).json(),
        JSON.stringify(extra),
      ).toMatchObject({ codigo: 'produto-em-uso' });
    const renomeado = await c.put(
      `${O}/produtos/${prodId}`,
      produto(opeId, { nome: 'Plano sintético renomeado', versao: pAtual.versao }),
    );
    expect(renomeado.statusCode).toBe(200);
    // O produto sem contrato muda à vontade (antes do primeiro uso).
    const livre = (await c.get(`${O}/produtos?operadora=${opeId}`))
      .json()
      .find((x: { codigo: string }) => x.codigo === 'INDIV-2');
    expect(
      (
        await c.put(
          `${O}/produtos/${livre.id}`,
          produto(opeId, { codigo: 'INDIV-2', tipoContratacao: 2, versao: livre.versao }),
        )
      ).statusCode,
    ).toBe(200);

    // A lista de contratos traz o nome do contratante: leitura auditada.
    const contratosLidos = () => trilha.eventos.filter((e) => e.evento === 'operadora.contrato.lido').length;
    const antesLista = contratosLidos();
    expect((await c.get(`${O}/contratos?operadora=${opeId}`)).statusCode).toBe(200);
    expect(contratosLidos()).toBe(antesLista + 1);

    // ADR 0008: texto fora do CP1252 é recusado no campo (nada vira "?" no banco); data inexistente ou sentinela, idem.
    const fora = await c.post(`${O}/beneficiarios`, {
      ...titular,
      cpf: cpfSintetico('900000014'),
      pacienteHospital: null,
      nome: 'Łukasz Sintético 😀',
      nomeMae: 'Mãe ≥ Sintética',
    });
    expect(fora.statusCode).toBe(400);
    expect(fora.json().campos.sort()).toEqual(['nome', 'nomeMae']);
    for (const [campo, valor] of [
      ['nascimento', '2026-02-31'],
      ['nascimento', '1899-12-30'],
      ['nascimento', '0001-01-01'],
      ['inclusao', '2026-02-30'],
    ] as const) {
      const r = await c.post(`${O}/beneficiarios`, { ...titular, [campo]: valor });
      expect(r.statusCode, `${campo}=${valor}`).toBe(400);
      expect(r.json().campos).toEqual([campo]);
    }
    expect(
      (await c.post(`${O}/contratos`, { ...contrato, numero: '2026-0009', inicio: '2026-04-31' })).json()
        .campos,
    ).toEqual(['inicio']);
  });

  it('regra 3: o escopo da operadora — o contrato herda a operadora do produto; registro de outra operadora recusado', async () => {
    const c = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const outra = await c.post(`${O}/empresas`, {
      registroAns: '900002',
      cnpj: cnpjSintetico('900000030001'),
      razaoSocial: 'Outra Operadora Sintética',
      modalidade: 'autogestao',
    });
    const outraId = outra.json().id as number;
    const [prodA] = (await c.get(`${O}/produtos`))
      .json()
      .filter((x: { operadora: number }) => x.operadora !== outraId);
    // O produto não muda de operadora: a alteração com a outra operadora é 404.
    expect(
      (await c.put(`${O}/produtos/${prodA.id}`, { ...produto(outraId), versao: prodA.versao })).statusCode,
    ).toBe(404);
    // As listas filtram pela operadora: a outra não vê os contratos nem os beneficiários da primeira.
    expect((await c.get(`${O}/contratos?operadora=${outraId}`)).json().itens).toEqual([]);
    expect((await c.get(`${O}/beneficiarios?operadora=${outraId}`)).json().itens).toEqual([]);
    expect((await c.get(`${O}/contratos?operadora=999999`)).statusCode).toBe(404);
  });

  it('quem só lê não grava (403); sem perfil da operadora, nada (403); entrada inválida, 400', async () => {
    const at = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    const t = (await at.get(`${O}/beneficiarios/tela`)).json();
    expect(t.acoes).toMatchObject({ editar: false, editarEmpresa: false });
    expect((await at.get(`${O}/beneficiarios`)).statusCode).toBe(200);
    expect((await at.post(`${O}/beneficiarios`, {})).statusCode).toBe(403);
    expect((await at.post(`${O}/empresas`, {})).statusCode).toBe(403);
    for (const login of ['SINT.ADMIN', 'SINT.RECEPCAO'])
      expect(
        (await pedir(ligado, await entrar(ligado, login)).get(`${O}/beneficiarios/tela`)).statusCode,
        login,
      ).toBe(403);
    const g = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    expect((await g.get(`${O}/beneficiarios/abc`)).statusCode).toBe(400);
    expect((await g.get(`${O}/beneficiarios?busca=x`)).statusCode).toBe(400);
    expect((await g.get(`${O}/beneficiarios/987654`)).statusCode).toBe(404);
    expect((await g.post(`${O}/beneficiarios`, { contrato: 1 })).statusCode).toBe(400);
  });
});
