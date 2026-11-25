// Contratos com fornecedores pela HTTP (M55, etapa 3; ficha, seções 5, 7 e 8; regras 5 a 8): a sessão real sobre a
// fonte sintética e a porta dos contratos EM MEMÓRIA (nada conecta a banco; pedidos e títulos SINTÉTICOS dos
// fornecedores 7001 e 7002). As datas são relativas ao dia de hoje (a porta em memória usa o relógio da máquina).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaContratoMemoria } from './contrato-porta-memoria.js';
import { PortaSuprimentosMemoria } from './porta-memoria.js';
import { type AppSuprimentos, montarAppSuprimentos, type Sessao } from './suprimentos-http.spec-util.js';

const C = '/api/suprimentos/contratos';
let a: AppSuprimentos;
let comprador: Sessao;
let gerente: Sessao;
let semAcesso: Sessao;

const dia = (deslocamento: number) => {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

beforeAll(async () => {
  a = await montarAppSuprimentos();
  [comprador, gerente, semAcesso] = await Promise.all([
    a.entrar('SINT.CONTRATOS'),
    a.entrar('SINT.GERCOMPRAS'),
    a.entrar('SINT.CIRCULANTE'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

let seqNumero = 0;
const contrato = (x: Record<string, unknown> = {}, s: Sessao = comprador, chave?: string) =>
  a.post(
    s,
    C,
    {
      numero: `CT-${++seqNumero}/2026`,
      fornecedor: 7001,
      tipo: 'fornecimento',
      objeto: 'Fornecimento de material médico-hospitalar (sintético)',
      inicio: dia(-200),
      fim: dia(165),
      valor: 20_000,
      indiceReajuste: 'ipca',
      dataBase: dia(-200),
      gestor: 'SINT.GERCOMPRAS',
      fiscal: 'SINT.CONTRATOS',
      ...x,
    },
    chave,
  );
const detalhe = async (id: number, s: Sessao = comprador) => (await a.get(s, `${C}/${id}`)).json();

describe('contratos com fornecedores (regras 5 a 8)', () => {
  it('a leitura e o cadastro pela permissão; o reenvio relido; número único; gestor e fiscal diferentes', async () => {
    expect((await a.get(semAcesso, C)).statusCode).toBe(403);
    const l = (await a.get(comprador, C)).json();
    expect(l.gravacao.ligada).toBe(true);
    expect(l.gravacao.operacoes.editar.pode).toBe(true);
    expect(l.gravacao.operacoes.aditar.pode).toBe(false);
    expect((await contrato({}, semAcesso)).statusCode).toBe(403);
    const k = a.novaChave();
    const r = await contrato({ numero: 'CT-UNICO/2026' }, comprador, k);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ repetido: false, mensagem: 'Contrato cadastrado.' });
    expect((await contrato({ numero: 'CT-UNICO/2026' }, comprador, k)).json()).toMatchObject({
      repetido: true,
      id: r.json().id,
    });
    expect((await contrato({ numero: 'CT-UNICO/2026' })).json().codigo).toBe('numero-repetido');
    expect((await contrato({ fiscal: 'sint.gercompras' })).statusCode).toBe(400);
    expect((await contrato({ fornecedor: 99 })).json().codigo).toBe('fornecedor-inexistente');
    const d = await detalhe(r.json().id);
    expect(d).toMatchObject({
      faixa: 'vigente',
      saldo: 20_000,
      fornecedorNome: 'DISTRIBUIDORA SINTÉTICA ALFA LTDA',
    });
    expect(d.saldoDetalhe.conta).toContain('= 20.000,00');
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.contrato.criado')).toBe(true);
  });

  it('o aditivo e a renovação pelo gerente (aditar); o fim vigente e o saldo com as parcelas', async () => {
    const id = (await contrato()).json().id as number;
    const v = (await detalhe(id)).versao as number;
    const ad = {
      tipo: 'aditivo',
      versao: v,
      valor: 6_000,
      numeroTermo: '1',
      descricao: 'Primeiro termo aditivo de valor',
    };
    expect((await a.post(comprador, `${C}/${id}/aditamentos`, ad)).statusCode).toBe(403);
    const r = await a.post(gerente, `${C}/${id}/aditamentos`, ad);
    expect(r.statusCode).toBe(201);
    // A versão subiu: o mesmo pedido com a versão antiga é conflito.
    expect((await a.post(gerente, `${C}/${id}/aditamentos`, ad)).statusCode).toBe(409);
    const d = await detalhe(id);
    expect(d.saldoDetalhe).toMatchObject({ aditivos: 6_000, valorTotal: 26_000, saldo: 26_000 });
    expect(d.avisos.map((x: { codigo: string }) => x.codigo)).toContain('acrescimo-acima-do-limite');
    const ren = await a.post(gerente, `${C}/${id}/aditamentos`, {
      tipo: 'renovacao',
      versao: d.versao,
      novoFim: dia(530),
      numeroTermo: '2',
      descricao: 'Renovação por mais um ano',
    });
    expect(ren.statusCode).toBe(201);
    expect((await detalhe(id)).fim).toBe(dia(530));
    // O evento da rota errada: a avaliação não vai por aditamentos.
    expect(
      (
        await a.post(gerente, `${C}/${id}/aditamentos`, {
          tipo: 'ocorrencia',
          versao: 1,
          data: dia(0),
          descricao: 'Entrega com atraso de dois dias',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('o reajuste pelo índice depois de um ano da data-base, com a conta', async () => {
    const id = (await contrato()).json().id as number;
    const d = await detalhe(id);
    expect(d.proximoReajuste).not.toBeNull();
    const r = await a.post(gerente, `${C}/${id}/aditamentos`, {
      tipo: 'reajuste',
      versao: d.versao,
      percentual: 5,
      data: d.proximoReajuste,
    });
    // O reajuste no aniversário da data-base (vale a partir dela): 5% sobre o vigente.
    expect(r.statusCode).toBe(201);
    expect((await detalhe(id)).saldoDetalhe.reajustes).toBe(1_000);
    const d2 = await detalhe(id);
    const cedo = await a.post(gerente, `${C}/${id}/aditamentos`, {
      tipo: 'reajuste',
      versao: d2.versao,
      percentual: 3,
      data: d.proximoReajuste,
    });
    expect(cedo.json().codigo).toBe('reajuste-antes-do-prazo');
  });

  it('o vínculo do pedido e do título do fornecedor; o saldo abatido; o título do pedido não abate de novo', async () => {
    const id = (await contrato()).json().id as number;
    const cand = (await a.get(comprador, `${C}/${id}/candidatos`)).json().itens as {
      tipo: string;
      ids: number[];
    }[];
    expect(cand.filter((c) => c.tipo === 'pedido').map((c) => c.ids[0])).toEqual([55_001, 55_002, 55_004]);
    const p = await a.post(comprador, `${C}/${id}/vinculos`, { tipo: 'pedido', ids: [55_001] });
    expect(p.statusCode).toBe(201);
    expect(p.json()).toMatchObject({ saldo: 8_000, mensagem: 'Pedido ligado ao contrato.' });
    // O mesmo pedido em outro contrato: recusado.
    const outro = (await contrato()).json().id as number;
    expect(
      (await a.post(comprador, `${C}/${outro}/vinculos`, { tipo: 'pedido', ids: [55_001] })).json().codigo,
    ).toBe('ja-vinculado');
    // O pedido de outro fornecedor: recusado.
    expect(
      (await a.post(comprador, `${C}/${id}/vinculos`, { tipo: 'pedido', ids: [55_003] })).json().codigo,
    ).toBe('fornecedor-diferente');
    const d = await detalhe(id);
    const vp = d.vinculos.find((x: { tipo: string }) => x.tipo === 'pedido').id as number;
    const t = await a.post(comprador, `${C}/${id}/vinculos`, {
      tipo: 'titulo',
      ids: [55_101, 55_102],
      pedidoDeOrigem: vp,
    });
    expect(t.statusCode).toBe(201);
    expect((await detalhe(id)).saldoDetalhe).toMatchObject({
      pedidos: 12_000,
      titulosDePedidos: 6_000,
      saldo: 8_000,
    });
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.contrato.vinculo')).toBe(true);
  });

  it('o título acima do saldo recusado; o contrato vencido só com a exceção aprovada por outra pessoa', async () => {
    const id = (
      await contrato({ inicio: dia(-400), fim: dia(-10), dataBase: dia(-400), valor: 5_000 })
    ).json().id as number;
    expect((await detalhe(id)).faixa).toBe('vencido');
    expect(
      (await a.post(comprador, `${C}/${id}/vinculos`, { tipo: 'pedido', ids: [55_002] })).json().codigo,
    ).toBe('contrato-vencido');
    const v = (await detalhe(id)).versao as number;
    const ex = await a.post(gerente, `${C}/${id}/aditamentos`, {
      tipo: 'excecao',
      versao: v,
      descricao: 'Renovação em assinatura no jurídico; compra urgente do material',
    });
    expect(ex.statusCode).toBe(201);
    const excecao = ex.json().id as number;
    const ok = await a.post(comprador, `${C}/${id}/vinculos`, { tipo: 'pedido', ids: [55_002], excecao });
    expect(ok.statusCode).toBe(201);
    // A exceção vale uma vez.
    expect(
      (await a.post(comprador, `${C}/${id}/vinculos`, { tipo: 'pedido', ids: [55_004], excecao })).json()
        .codigo,
    ).toBe('excecao-usada');
    const vig = (await contrato({ valor: 1_000 })).json().id as number;
    expect(
      (await a.post(comprador, `${C}/${vig}/vinculos`, { tipo: 'titulo', ids: [55_104] })).json().codigo,
    ).toBe('saldo-insuficiente');
  });

  it('a avaliação do fornecedor (avaliar), o encerramento e o painel', async () => {
    const id = (await contrato({ critico: true })).json().id as number;
    const d = await detalhe(id);
    // Crítico iniciado há 200 dias sem avaliação: vencida (6 meses).
    expect(d.avisos.map((x: { codigo: string }) => x.codigo)).toContain('avaliacao-vencida');
    const av = await a.post(comprador, `${C}/${id}/avaliacoes`, {
      tipo: 'avaliacao',
      versao: d.versao,
      data: dia(0),
      notas: { qualidade: 5, prazo: 4, atendimento: 4, documentacao: 3 },
    });
    expect(av.statusCode).toBe(201);
    const d2 = await detalhe(id);
    expect(d2.ultimaAvaliacao).toMatchObject({ resultado: 'qualificado', media: 4 });
    expect(d2.avisos.map((x: { codigo: string }) => x.codigo)).not.toContain('avaliacao-vencida');
    const enc = await a.post(comprador, `${C}/${id}/eventos`, {
      tipo: 'encerramento',
      versao: d2.versao,
      data: dia(0),
    });
    expect(enc.statusCode).toBe(201);
    const d3 = await detalhe(id);
    expect(d3).toMatchObject({ situacao: 'encerrado', faixa: 'encerrado' });
    expect(
      (await a.post(comprador, `${C}/${id}/vinculos`, { tipo: 'titulo', ids: [55_103] })).json().codigo,
    ).toBe('contrato-encerrado');
    const l = (await a.get(comprador, `${C}?situacao=todos`)).json();
    expect(l.itens.length).toBeGreaterThan(3);
    expect(l.painel.ativos).toBeGreaterThan(0);
    expect((await a.get(comprador, `${C}/fornecedores?termo=ALFA`)).json().itens).toEqual([
      { codigo: 7001, nome: 'DISTRIBUIDORA SINTÉTICA ALFA LTDA' },
    ]);
    expect((await a.get(comprador, `${C}/usuarios?termo=GERCOMPRAS`)).json().itens).toEqual([
      { login: 'SINT.GERCOMPRAS', nome: 'GERENTE DE COMPRAS SINTÉTICO' },
    ]);
    expect((await a.get(comprador, `${C}/usuarios?termo=S`)).json().itens).toEqual([]);
    expect((await a.get(comprador, `${C}/centros`)).json().itens).toEqual([
      { codigo: 9001, nome: 'SETOR SINTÉTICO' },
    ]);
    expect((await a.get(comprador, `${C}/999999`)).statusCode).toBe(404);
  });

  it('a alteração do cadastro pela versão', async () => {
    const id = (await contrato()).json().id as number;
    const d = await detalhe(id);
    const corpo = {
      versao: d.versao,
      objeto: 'Fornecimento de material médico-hospitalar e de limpeza (sintético)',
      critico: true,
      indiceReajuste: 'igpm',
      dataBase: d.dataBase,
      garantia: 'caucao',
      garantiaValor: 1_000,
      garantiaValidade: dia(300),
      gestor: 'SINT.GERCOMPRAS',
      fiscal: 'SINT.CONTRATOS',
      centroCusto: null,
      observacao: null,
    };
    const put = (b: Record<string, unknown>) =>
      a.app.inject({
        method: 'PUT',
        url: `${C}/${id}`,
        headers: { cookie: comprador.cookie, 'x-csrf': comprador.csrf },
        payload: b,
      });
    expect((await put(corpo)).statusCode).toBe(200);
    expect((await put(corpo)).statusCode).toBe(409);
    expect(await detalhe(id)).toMatchObject({ critico: true, indiceReajuste: 'igpm', garantia: 'caucao' });
  });
});

// 05-SUP linha 27 (C1-032): na sessão sintética de dev/ci (sem o núcleo), o pedido de compra criado com contrato grava
// o vínculo nos contratos em memória pelas mesmas regras da porta própria (conferirVinculoContrato), ou é recusado; nunca
// aceita o contrato e o descarta. A vencedora da cotação do pedido ligado é só a proposta do fornecedor do contrato
// (conferirVencedoraDoContrato). O efeito no MariaDB está em contrato-pedido-compra.int.spec.ts.
const P = '/api/suprimentos/pedidos';
let seqPedido = 0;
const novoContrato = async (x: Record<string, unknown> = {}): Promise<number> => {
  const r = await a.post(comprador, C, {
    numero: `CT-MEM-${++seqPedido}/2026`,
    fornecedor: 7001,
    tipo: 'fornecimento',
    objeto: 'Fornecimento sintético de material de consumo',
    inicio: dia(-30),
    fim: dia(300),
    valor: 10_000,
    indiceReajuste: 'ipca',
    dataBase: dia(-30),
    gestor: 'SINT.GERCOMPRAS',
    fiscal: 'SINT.CONTRATOS',
    ...x,
  });
  expect(r.statusCode).toBe(201);
  return r.json().id as number;
};
// O pedido de compra tem corpo estrito (sem o campo `chave`): a chave vai só no cabeçalho, como na tela.
const postSemChave = (url: string, payload: Record<string, unknown>) =>
  a.app.inject({
    method: 'POST',
    url,
    headers: { cookie: comprador.cookie, 'x-csrf': comprador.csrf, 'idempotency-key': a.novaChave() },
    payload,
  });
const pedido = (fornecedores: number[], contrato?: number) =>
  postSemChave(P, {
    centroCusto: 101,
    fornecedores,
    itens: [{ item: 5005, quantidade: 4 }],
    ...(contrato ? { contrato: { contrato } } : {}),
  });
const vinculosPedido = async (id: number) =>
  ((await a.get(comprador, `${C}/${id}`)).json().vinculos as { tipo: string; chaveNatural: string }[]).filter(
    (v) => v.tipo === 'pedido',
  );

describe('pedido de compra ligado ao contrato na memória (C1-032)', () => {
  it('o pedido criado com contrato aparece entre os vínculos do contrato, com o histórico', async () => {
    const id = await novoContrato();
    const r = await pedido([7001], id);
    expect(r.statusCode).toBe(200);
    expect(r.json().ids).toMatchObject({ contrato: id });
    const { ano, doc } = r.json().ids;
    const v = await vinculosPedido(id);
    expect(v).toHaveLength(1);
    expect(v[0]!.chaveNatural).toBe(`${ano}/${doc}`);
    // O pedido já ligado não volta como candidato do mesmo contrato.
    const cand = (await a.get(comprador, `${C}/${id}/candidatos`)).json();
    const lista = cand.itens as { chaveNatural: string }[];
    expect(lista.some((x) => x.chaveNatural === `${ano}/${doc}`)).toBe(false);
  });

  it('recusa o pedido de outro fornecedor (nada é criado nem ligado)', async () => {
    const id = await novoContrato();
    const antes = (await a.get(comprador, P)).json();
    const r = await pedido([7002], id);
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('fornecedor-diferente');
    expect(await vinculosPedido(id)).toHaveLength(0);
    expect((await a.get(comprador, P)).json()).toEqual(antes);
  });

  it('recusa o contrato inexistente', async () => {
    const r = await pedido([7001], 999_999);
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.json().codigo).toBe('contrato-inexistente');
  });

  it('a vencedora do pedido ligado é só a proposta do fornecedor do contrato', async () => {
    const id = await novoContrato();
    const r = await pedido([7001], id);
    const { ano, doc } = r.json().ids;
    const p = (await a.get(comprador, `${P}/${ano}/${doc}`)).json();
    const proposta = p.propostas[0];
    expect(proposta.fornecedor).toBe(7001);
    const v = await postSemChave(`${P}/${ano}/${doc}/vencedor`, {
      item: proposta.item,
      seq: proposta.seq,
      vencedoras: [proposta.id],
    });
    expect(v.statusCode).toBe(200);
  });
});

describe('a porta de suprimentos em memória com e sem os contratos ligados', () => {
  it('sem os contratos, recusa o contrato (nunca o descarta); ligada, aplica as regras do vínculo', async () => {
    const sup = new PortaSuprimentosMemoria(null);
    const contexto = { cliente: 'teste', estabelecimento: 1, usuario: 'SINT.CONTRATOS', correlacao: 't' };
    await expect(
      sup.executar(
        contexto as never,
        'suprimentos.criarPedido',
        {
          centroCusto: 101,
          fornecedores: [7001],
          itens: [{ item: 5005, quantidade: 1 }],
          contrato: { contrato: 1 },
        },
        { chaveIdempotencia: 'k-1', usuario: 'SINT.CONTRATOS' } as never,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'contrato-indisponivel' } });
    // Ligada, a mesma porta grava o vínculo no contrato em memória.
    const contratos = new PortaContratoMemoria();
    sup.ligarContratos(contratos);
    await expect(
      sup.executar(
        contexto as never,
        'suprimentos.criarPedido',
        {
          centroCusto: 101,
          fornecedores: [7001],
          itens: [{ item: 5005, quantidade: 1 }],
          contrato: { contrato: 1 },
        },
        { chaveIdempotencia: 'k-2', usuario: 'SINT.CONTRATOS' } as never,
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'contrato-inexistente' } });
  });
});
