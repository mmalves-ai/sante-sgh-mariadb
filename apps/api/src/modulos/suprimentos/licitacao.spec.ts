// Licitação e pregão pela HTTP (M55, etapa 4; ficha, seções 4, 7 e 8; regras 9, 10 e 12): a sessão real sobre a fonte
// sintética e a porta do processo EM MEMÓRIA (nada conecta a banco; fornecedores e pedidos SINTÉTICOS 7001 a 7003). As
// datas são relativas ao dia de hoje (a porta em memória usa o relógio da máquina).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppBloco, montarAppBloco, type Sessao } from '../cirurgia/bloco-seguro.spec-util.js';

const L = '/api/suprimentos/licitacoes';
let a: AppBloco;
let agente: Sessao;
let autoridade: Sessao;
let semAcesso: Sessao;

const dia = (deslocamento: number) => {
  const d = new Date();
  d.setDate(d.getDate() + deslocamento);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

beforeAll(async () => {
  a = await montarAppBloco();
  [agente, autoridade, semAcesso] = await Promise.all([
    a.entrar('SINT.LICITACAO'),
    a.entrar('SINT.AUTORIDADE'),
    a.entrar('SINT.CIRCULANTE'),
  ]);
});
afterAll(async () => {
  await a?.fechar();
});

let seq = 0;
const abrir = (x: Record<string, unknown> = {}, s: Sessao = agente, chave?: string) =>
  a.post(
    s,
    L,
    {
      numero: `PE-${++seq}/2026`,
      regime: 'lei-14133',
      modalidade: 'pregao-eletronico',
      natureza: 'bens',
      objeto: 'Aquisição de luvas de procedimento (sintético)',
      justificativa: 'Reposição do estoque do semestre para todos os setores (sintético)',
      agente: 'SINT.LICITACAO',
      itens: [
        { descricao: 'Luva de procedimento M', unidade: 'CX', quantidade: 100 },
        { descricao: 'Luva de procedimento G', unidade: 'CX', quantidade: 50 },
      ],
      ...x,
    },
    chave,
  );
const detalhe = async (id: number, s: Sessao = agente) => (await a.get(s, `${L}/${id}`)).json();
const etapa = async (id: number, x: Record<string, unknown>, s: Sessao = agente) =>
  a.post(s, `${L}/${id}/etapas`, { versao: (await detalhe(id)).versao, ...x });
const evento = async (id: number, x: Record<string, unknown>, rota = 'eventos', s: Sessao = agente) =>
  a.post(s, `${L}/${id}/${rota}`, { versao: (await detalhe(id)).versao, ...x });

/** Leva o processo até a sessão aberta (pesquisa com 3 preços por item, parecer, aviso no prazo). */
async function ateSessao(x: Record<string, unknown> = {}): Promise<{ id: number; itens: number[] }> {
  const id = (await abrir(x)).json().id as number;
  expect((await etapa(id, { para: 'pesquisa' })).statusCode).toBe(201);
  const itens = ((await detalhe(id)).itensDetalhe as { id: number }[]).map((i) => i.id);
  for (const [k, item] of itens.entries())
    for (const valor of [10 + k, 11 + k, 13 + k]) {
      const r = await a.post(agente, `${L}/${id}/precos`, {
        versao: (await detalhe(id)).versao,
        item,
        fonte: 'painel',
        referencia: 'Painel de preços (sintético)',
        valor,
        data: dia(-30),
      });
      expect(r.statusCode).toBe(201);
    }
  expect((await etapa(id, { para: 'edital' })).statusCode).toBe(201);
  const par = await evento(id, {
    tipo: 'parecer',
    data: dia(-25),
    resultado: 'favoravel',
    descricao: 'Edital conforme a lei (sintético)',
  });
  expect(par.statusCode).toBe(201);
  const pub = await etapa(id, {
    para: 'publicado',
    dataPublicacao: dia(-25),
    dataAbertura: dia(-2),
    veiculo: 'pncp',
    referencia: 'Controle sintético 0001',
  });
  expect(pub.statusCode).toBe(201);
  expect((await etapa(id, { para: 'sessao' })).statusCode).toBe(201);
  return { id, itens };
}

const proposta = async (
  id: number,
  item: number,
  fornecedor: number,
  valor: number,
  x: Record<string, unknown> = {},
) =>
  a.post(agente, `${L}/${id}/propostas`, {
    versao: (await detalhe(id)).versao,
    item,
    fornecedor,
    valor,
    ...x,
  });

describe('licitação e pregão (regra 9)', () => {
  it('a leitura e o termo pela permissão; o reenvio relido; número único; o agente existe', async () => {
    expect((await a.get(semAcesso, L)).statusCode).toBe(403);
    const l = (await a.get(agente, L)).json();
    expect(l.gravacao.ligada).toBe(true);
    expect(l.gravacao.operacoes.conduzir.pode).toBe(true);
    expect(l.gravacao.operacoes.homologar.pode).toBe(false);
    expect((await abrir({}, autoridade)).statusCode).toBe(403);
    const k = a.novaChave();
    const r = await abrir({ numero: 'PE-UNICO/2026' }, agente, k);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ repetido: false, etapa: 'planejamento' });
    expect((await abrir({ numero: 'PE-UNICO/2026' }, agente, k)).json()).toMatchObject({
      repetido: true,
      id: r.json().id,
    });
    expect((await abrir({ numero: 'PE-UNICO/2026' })).json().codigo).toBe('numero-repetido');
    expect((await abrir({ agente: 'SINT.NINGUEM' })).json().codigo).toBe('agente-inexistente');
    expect((await abrir({ modalidade: 'dispensa' })).statusCode).toBe(400);
    const d = await detalhe(r.json().id);
    expect(d).toMatchObject({
      etapa: 'planejamento',
      itens: 2,
      acoes: [{ acao: 'pesquisa', pode: true }, { acao: 'revogar' }],
    });
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.licitacao.criada')).toBe(true);
    expect((await a.get(agente, `${L}/999999`)).statusCode).toBe(404);
    const mudar = (b: Record<string, unknown>) =>
      a.app.inject({
        method: 'PUT',
        url: `${L}/${r.json().id}`,
        headers: { cookie: agente.cookie, 'x-csrf': agente.csrf },
        payload: b,
      });
    const termo = {
      versao: d.versao,
      regime: 'lei-14133',
      modalidade: 'pregao-eletronico',
      criterio: 'menor-preco',
      natureza: 'bens',
      objeto: 'Aquisição de luvas e máscaras (sintético)',
      justificativa: 'Reposição do estoque do semestre para todos os setores (sintético)',
      agente: 'SINT.LICITACAO',
      itens: [{ descricao: 'Máscara cirúrgica', unidade: 'CX', quantidade: 20 }],
    };
    expect((await mudar(termo)).statusCode).toBe(200);
    expect((await mudar(termo)).statusCode).toBe(409);
    expect(await detalhe(r.json().id)).toMatchObject({
      itens: 1,
      objeto: 'Aquisição de luvas e máscaras (sintético)',
    });
  });

  it('a pesquisa: preço só na pesquisa; o estimado pela mediana com a conta; o aviso no prazo e com o parecer', async () => {
    const id = (await abrir()).json().id as number;
    const item = (await detalhe(id)).itensDetalhe[0].id as number;
    const preco = {
      item,
      fonte: 'fornecedor',
      referencia: 'Cotação (sintético)',
      valor: 10,
      data: dia(-3),
      fornecedor: 7001,
    };
    expect(
      (await a.post(agente, `${L}/${id}/precos`, { versao: (await detalhe(id)).versao, ...preco })).json()
        .codigo,
    ).toBe('licitacao-etapa-invalida');
    await etapa(id, { para: 'pesquisa' });
    expect(
      (await a.post(agente, `${L}/${id}/precos`, { versao: (await detalhe(id)).versao, ...preco }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await a.post(agente, `${L}/${id}/precos`, {
          versao: (await detalhe(id)).versao,
          ...preco,
          fornecedor: 99,
        })
      ).json().codigo,
    ).toBe('fornecedor-inexistente');
    const d = await detalhe(id);
    expect(d.acoes[0]).toMatchObject({
      acao: 'edital',
      pode: false,
      motivo: expect.stringMatching(/sem preço/),
    });
    expect(d.avisos.map((x: { codigo: string }) => x.codigo)).toContain('pesquisa-insuficiente');
    expect((await etapa(id, { para: 'edital' })).json().codigo).toBe('licitacao-sem-preco');
    const { id: s } = await ateSessao();
    const ds = await detalhe(s);
    expect(ds.etapa).toBe('sessao');
    expect(ds.valorEstimado).toBe(1_100 + 600);
    expect(ds.estimativa.itens[0].conta).toBe(
      'item 1: mediana de [10,00; 11,00; 13,00] = 11,00 × 100,00 = 1.100,00',
    );
    expect(ds.eventos.map((x: { tipo: string }) => x.tipo)).toEqual([
      'etapa',
      'etapa',
      'parecer',
      'publicacao',
      'etapa',
      'etapa',
    ]);
    const semParecer = (await abrir()).json().id as number;
    await etapa(semParecer, { para: 'pesquisa' });
    const it2 = (await detalhe(semParecer)).itensDetalhe.map((i: { id: number }) => i.id) as number[];
    for (const item2 of it2)
      await a.post(agente, `${L}/${semParecer}/precos`, {
        versao: (await detalhe(semParecer)).versao,
        item: item2,
        fonte: 'painel',
        referencia: 'Painel (sintético)',
        valor: 5,
        data: dia(-1),
      });
    expect(
      (
        await etapa(semParecer, {
          para: 'edital',
          justificativaPesquisa: 'Item de fornecedor exclusivo (sintético)',
        })
      ).statusCode,
    ).toBe(201);
    const pub = {
      para: 'publicado',
      dataPublicacao: dia(-1),
      dataAbertura: dia(30),
      veiculo: 'sitio',
      referencia: 'Edição 1',
    };
    expect((await etapa(semParecer, pub)).json().codigo).toBe('licitacao-sem-parecer');
    await evento(semParecer, {
      tipo: 'parecer',
      data: dia(-1),
      resultado: 'favoravel',
      descricao: 'Conforme (sintético)',
    });
    expect((await etapa(semParecer, { ...pub, dataAbertura: dia(2) })).json().codigo).toBe(
      'licitacao-prazo-aviso',
    );
    expect((await etapa(semParecer, pub)).statusCode).toBe(201);
    expect((await etapa(semParecer, { para: 'sessao' })).json().codigo).toBe('licitacao-antes-abertura');
    const painel = (await a.get(agente, L)).json().painel;
    expect(painel.porEtapa.publicado).toBeGreaterThanOrEqual(1);
  });

  it('a sessão: propostas, lance, desclassificação; o julgamento com o empate e o desempate', async () => {
    const { id, itens } = await ateSessao();
    const [i1, i2] = itens as [number, number];
    expect((await proposta(id, i1, 7001, 10.5)).statusCode).toBe(201);
    expect((await proposta(id, i1, 7002, 10.9, { lance: 10.2 })).statusCode).toBe(201);
    expect((await proposta(id, i1, 7001, 9)).json().codigo).toBe('licitacao-proposta-repetida');
    expect((await proposta(id, i2, 7001, 12)).statusCode).toBe(201);
    expect((await proposta(id, i2, 7002, 12)).statusCode).toBe(201);
    const p3 = (await proposta(id, i2, 7003, 11)).json().registro as number;
    const desclassificar = async (motivo: string | null) =>
      a.app.inject({
        method: 'PUT',
        url: `${L}/${id}/propostas/${p3}`,
        headers: { cookie: agente.cookie, 'x-csrf': agente.csrf },
        payload: { versao: (await detalhe(id)).versao, situacao: 'desclassificada', motivo },
      });
    expect((await desclassificar(null)).statusCode).toBe(400);
    expect((await desclassificar('Marca fora da especificação (sintético)')).statusCode).toBe(200);
    const d = await detalhe(id);
    expect(d.julgamento.empates).toBe(1);
    expect(d.julgamento.itens[0]).toMatchObject({
      resultado: 'adjudicavel',
      vencedor: 7002,
      valorUnitario: 10.2,
    });
    expect(d.acoes.find((x: { acao: string }) => x.acao === 'julgado')).toMatchObject({ pode: true });
    expect((await etapa(id, { para: 'julgado' })).json().codigo).toBe('licitacao-empate');
    const julgar = await etapa(id, {
      para: 'julgado',
      desempates: [{ item: i2, fornecedor: 7001 }],
      justificativaDesempate: 'Sorteio em sessão pública, art. 60 (sintético)',
    });
    expect(julgar.statusCode).toBe(201);
    const j = await detalhe(id);
    expect(j.etapa).toBe('julgado');
    expect(j.itensDetalhe.map((i: { vencedor: number }) => i.vencedor)).toEqual([7002, 7001]);
    expect(j.prazoRecursoAte).not.toBeNull();
    expect(j.avisos.map((x: { codigo: string }) => x.codigo)).toContain('prazo-recurso');
    // A homologação espera o prazo de recurso (3 dias úteis), e o agente não homologa.
    expect((await a.post(autoridade, `${L}/${id}/homologacao`, { versao: j.versao })).json().codigo).toBe(
      'licitacao-prazo-recurso',
    );
    expect((await a.post(agente, `${L}/${id}/homologacao`, { versao: j.versao })).statusCode).toBe(403);
    // A ata da sessão já no julgado (o pregão até a ata).
    const ata = await evento(id, { tipo: 'ata', data: dia(0), referencia: 'ATA-1/2026', validade: dia(364) });
    expect(ata.statusCode).toBe(201);
    expect(ata.json().mensagem).toBe('Ata registrada.');
  });

  it('o recurso no prazo e de licitante; a decisão pela autoridade; provido refaz o julgamento', async () => {
    const { id, itens } = await ateSessao();
    await proposta(id, itens[0]!, 7001, 10);
    await proposta(id, itens[1]!, 7001, 12);
    await etapa(id, { para: 'julgado' });
    const rec = { tipo: 'recurso', data: dia(0), descricao: 'Razões do recurso (sintético)' };
    expect((await evento(id, { ...rec, fornecedor: 7003 })).json().codigo).toBe('licitacao-recorrente');
    expect((await evento(id, { ...rec, fornecedor: 7001 })).json()).toMatchObject({ etapa: 'recurso' });
    const dec = {
      tipo: 'decisao-recurso',
      data: dia(0),
      resultado: 'provido',
      descricao: 'Recurso provido (sintético)',
    };
    expect((await evento(id, dec)).statusCode).toBe(400);
    expect((await evento(id, dec, 'decisoes')).statusCode).toBe(403);
    expect((await evento(id, rec, 'decisoes', autoridade)).statusCode).toBe(400);
    const r = await evento(id, dec, 'decisoes', autoridade);
    expect(r.statusCode).toBe(201);
    expect(r.json().etapa).toBe('sessao');
    const d = await detalhe(id);
    expect(d.itensDetalhe.every((i: { vencedor: number | null }) => i.vencedor === null)).toBe(true);
    expect(d.processo.dataJulgamento).toBeNull();
  });

  it('a contratação direta: sem edital nem recurso; homologada por outra pessoa; o pedido do vencedor; revogar e anular', async () => {
    const id = (
      await abrir({
        numero: 'DL-1/2026',
        modalidade: 'dispensa',
        fundamento: 'art. 75, II',
        itens: [{ descricao: 'Serviço de calibração (sintético)', unidade: 'UN', quantidade: 1 }],
      })
    ).json().id as number;
    await etapa(id, { para: 'pesquisa' });
    const item = (await detalhe(id)).itensDetalhe[0].id as number;
    await a.post(agente, `${L}/${id}/precos`, {
      versao: (await detalhe(id)).versao,
      item,
      fonte: 'fornecedor',
      referencia: 'Cotação (sintético)',
      valor: 70_000,
      data: dia(-1),
      fornecedor: 7001,
    });
    const sess = {
      para: 'sessao',
      justificativaPesquisa: 'Único prestador credenciado na região (sintético)',
    };
    expect((await etapa(id, sess)).json().codigo).toBe('licitacao-dispensa-acima-limite');
    expect((await etapa(id, { para: 'edital' })).json().codigo).toBe('licitacao-etapa-invalida');
    const id2 = (
      await abrir({
        numero: 'DL-2/2026',
        modalidade: 'dispensa',
        fundamento: 'art. 75, II',
        itens: [{ descricao: 'Serviço de calibração (sintético)', unidade: 'UN', quantidade: 1 }],
      })
    ).json().id as number;
    await etapa(id2, { para: 'pesquisa' });
    const item2 = (await detalhe(id2)).itensDetalhe[0].id as number;
    await a.post(agente, `${L}/${id2}/precos`, {
      versao: (await detalhe(id2)).versao,
      item: item2,
      fonte: 'fornecedor',
      referencia: 'Cotação (sintético)',
      valor: 5_000,
      data: dia(-1),
      fornecedor: 7001,
    });
    expect((await etapa(id2, sess)).statusCode).toBe(201);
    await proposta(id2, item2, 7001, 4_800);
    expect((await etapa(id2, { para: 'julgado' })).statusCode).toBe(201);
    expect(
      (
        await evento(id2, {
          tipo: 'recurso',
          data: dia(0),
          fornecedor: 7001,
          descricao: 'Razões (sintético)',
        })
      ).json().codigo,
    ).toBe('licitacao-etapa-invalida');
    const v = (await detalhe(id2)).versao;
    const h = await a.post(autoridade, `${L}/${id2}/homologacao`, {
      versao: v,
      observacao: 'Homologado (sintético)',
    });
    expect(h.statusCode).toBe(201);
    expect(h.json().etapa).toBe('homologado');
    expect((await detalhe(id2, autoridade)).processo.homologadoPor).toBe('SINT.AUTORIDADE');
    // O pedido do vencedor (o sintético 55.001 é do fornecedor 7001); o do 7002, não.
    expect((await evento(id2, { tipo: 'pedido', pedido: 55_003 })).json().codigo).toBe(
      'licitacao-pedido-fornecedor',
    );
    expect((await evento(id2, { tipo: 'pedido', pedido: 55_001 })).statusCode).toBe(201);
    expect((await evento(id2, { tipo: 'pedido', pedido: 55_001 })).json().codigo).toBe(
      'licitacao-pedido-repetido',
    );
    expect((await evento(id2, { tipo: 'pedido', pedido: 1 })).json().codigo).toBe(
      'licitacao-pedido-inexistente',
    );
    const enc = (x: number, para: string) =>
      a.post(autoridade, `${L}/${x}/encerramentos`, {
        versao: 0,
        para,
        justificativa: 'Interesse público superveniente (sintético)',
      });
    expect((await enc(id2, 'revogado')).statusCode).toBe(409);
    const revogar = await a.post(autoridade, `${L}/${id}/encerramentos`, {
      versao: (await detalhe(id)).versao,
      para: 'revogado',
      justificativa: 'Interesse público superveniente (sintético)',
    });
    expect(revogar.json()).toMatchObject({ etapa: 'revogado', mensagem: 'Processo revogado.' });
    const anular = await a.post(autoridade, `${L}/${id2}/encerramentos`, {
      versao: (await detalhe(id2)).versao,
      para: 'anulado',
      justificativa: 'Vício insanável no processo (sintético)',
    });
    expect(anular.json().etapa).toBe('anulado');
    expect(a.trilha.eventos.filter((x) => x.evento === 'suprimentos.licitacao.etapa').length).toBeGreaterThan(
      5,
    );
  });

  it('o orçamento sigiloso fica fora para quem não conduz até o julgamento; os pedidos marcados e as buscas', async () => {
    const { id } = await ateSessao({ sigiloso: true });
    expect((await detalhe(id)).valorEstimado).toBe(1_700);
    const fora = await detalhe(id, autoridade);
    expect(fora.valorEstimado).toBeNull();
    expect(fora.precos).toEqual([]);
    // Nem pelo histórico (a saída da pesquisa grava a conta) nem pela prévia do julgamento (acima do estimado).
    expect(JSON.stringify(fora.eventos)).not.toMatch(/mediana|1\.700|total:/);
    expect(fora.julgamento).toBeNull();
    expect(JSON.stringify((await detalhe(id)).eventos)).toMatch(/mediana/);
    const lista = (await a.get(autoridade, `${L}?etapa=sessao`)).json();
    expect(lista.itens.find((x: { id: number }) => x.id === id).valorEstimado).toBeNull();
    expect((await a.get(agente, `${L}/pedidos-marcados`)).json().itens[0]).toMatchObject({ pedido: 55_001 });
    expect((await a.get(agente, `${L}/fornecedores?termo=gama`)).json().itens).toEqual([
      { codigo: 7003, nome: 'SUPRIMENTOS SINTÉTICOS GAMA LTDA' },
    ]);
    expect((await a.get(agente, `${L}/fornecedores?termo=g`)).json().itens).toEqual([]);
    expect((await a.get(agente, `${L}/usuarios?termo=autoridade`)).json().itens[0].login).toBe(
      'SINT.AUTORIDADE',
    );
    expect((await a.get(agente, `${L}?etapa=nada`)).statusCode).toBe(400);
  });

  it('documentos em PDF/A (regra 10): a ata só depois do julgamento, o tipo da lista, quem lê e o processo existente', async () => {
    const id = (await abrir()).json().id as number;
    const ata = await a.post(agente, `${L}/${id}/documentos`, { tipo: 'ata' });
    expect(ata.statusCode).toBe(409);
    expect(ata.json().codigo).toBe('licitacao-documento-indisponivel');
    expect((await a.post(agente, `${L}/${id}/documentos`, { tipo: 'edital' })).statusCode).toBe(400);
    expect((await a.post(semAcesso, `${L}/${id}/documentos`, { tipo: 'termo' })).statusCode).toBe(403);
    expect((await a.post(agente, `${L}/999999/documentos`, { tipo: 'termo' })).statusCode).toBe(404);
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.licitacao.documento')).toBe(false);
  });

  it('o descarte de um preço da pesquisa: com a justificativa, só na pesquisa, uma vez; fora da conta e auditado', async () => {
    const id = (
      await abrir({ itens: [{ descricao: 'Luva de procedimento M', unidade: 'CX', quantidade: 100 }] })
    ).json().id as number;
    await etapa(id, { para: 'pesquisa' });
    const item = (await detalhe(id)).itensDetalhe[0].id as number;
    const registrar = async (valor: number) =>
      (
        await a.post(agente, `${L}/${id}/precos`, {
          versao: (await detalhe(id)).versao,
          item,
          fonte: 'painel',
          referencia: 'Painel de preços (sintético)',
          valor,
          data: dia(-3),
        })
      ).json().registro as number;
    for (const v of [10, 11, 13]) await registrar(v);
    const errado = await registrar(10_000);
    expect((await detalhe(id)).estimativa.itens[0].valorUnitario).toBe(12);
    let n = 0;
    const descartar = async (x: Record<string, unknown>, s: Sessao = agente, preco = errado) => {
      const chave = `teste-m554-descarte-${++n}-${Date.now()}`;
      return a.app.inject({
        method: 'PUT',
        url: `${L}/${id}/precos/${preco}/descarte`,
        headers: { cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': chave },
        payload: { chave, versao: (await detalhe(id)).versao, ...x },
      });
    };
    expect((await descartar({ justificativa: 'curta' })).statusCode).toBe(400);
    expect(
      (await descartar({ justificativa: 'Digitado errado: 10.000 no lugar de 10 (sintético).' }, autoridade))
        .statusCode,
    ).toBe(403);
    const ok = await descartar({ justificativa: 'Digitado errado: 10.000 no lugar de 10 (sintético).' });
    expect(ok.statusCode).toBe(200);
    const d = await detalhe(id);
    expect(d.estimativa.itens[0]).toMatchObject({ valorUnitario: 11, quantidadePrecos: 3 });
    expect(d.precos.find((x: { id: number }) => x.id === errado).descarte).toMatchObject({
      justificativa: 'Digitado errado: 10.000 no lugar de 10 (sintético).',
      usuario: 'SINT.LICITACAO',
    });
    expect(
      (await descartar({ justificativa: 'Outra justificativa longa o bastante (sintético).' })).json().codigo,
    ).toBe('licitacao-preco-descartado');
    expect(
      (await descartar({ justificativa: 'Preço de outro processo (sintético).' }, agente, 999_999)).json()
        .codigo,
    ).toBe('licitacao-preco-inexistente');
    expect(a.trilha.eventos.some((x) => x.evento === 'suprimentos.licitacao.precoDescartado')).toBe(true);
    expect((await etapa(id, { para: 'edital' })).statusCode).toBe(201);
    // Fora da pesquisa, nem preço novo nem descarte.
    expect(await registrar(9)).toBeUndefined();
    expect(
      (
        await descartar(
          { justificativa: 'Fora da pesquisa não se descarta (sintético).' },
          agente,
          errado - 1,
        )
      ).json().codigo,
    ).toBe('licitacao-etapa-invalida');
  });
});
