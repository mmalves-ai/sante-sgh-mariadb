// Porta do cadastro do estoque em memória (F3.6, 05-SUP linha 1): a sessão sintética grava o item inteiro com as
// mesmas regras e recusas da porta própria. Massa sintética; o que fica no banco é provado em
// cadastro-estoque-porta-propria.int.spec.ts.
import type { ItemEstoqueEntrada } from '@sgh/contratos/regras-suprimentos';
import { describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaCadastroEstoqueMemoria } from './cadastro-estoque-porta-memoria.js';

const c: ContextoPortaM18 = {
  cliente: 'sint',
  estabelecimento: 1,
  usuario: null,
  correlacao: 'teste-f36-01',
};
const HOJE = '2026-03-15';
const GTIN = '7891000100103';

const medicamento = (mais: Partial<ItemEstoqueEntrada> = {}): ItemEstoqueEntrada => ({
  codigo: 'MED-SINT-1',
  nome: 'DIPIRONA SINTETICA 1 G AMPOLA',
  nomeResumido: null,
  tipo: 'medicamento',
  grupo: 1,
  subgrupo: 11,
  unidadeEstoque: 3,
  unidadeCompra: 2,
  fatorCompraEstoque: 50,
  unidadeConsumo: null,
  fatorEstoqueConsumo: 1,
  unidadePrescricao: null,
  fatorConsumoPrescricao: 1,
  fabricante: 601,
  gtin: null,
  ncm: '30049099',
  cest: null,
  classeRisco: null,
  controlaLote: true,
  controlaValidade: true,
  controlado: false,
  antimicrobiano: false,
  altaVigilancia: false,
  fracionavel: false,
  prescritivel: true,
  estoqueMinimo: 10,
  estoqueMaximo: 100,
  principiosAtivos: [{ principio: 501, concentracao: 1000, unidade: 5, principal: true }],
  vias: [{ via: 2, padrao: true }],
  codigosBarras: [{ codigo: GTIN, padrao: 'gtin', quantidade: 1, unidade: 3, principal: true }],
  apresentacoes: [
    {
      nomeComercial: 'DIPIRONA ALFA',
      apresentacao: 'CAIXA COM 50 AMPOLAS',
      fabricante: 601,
      quantidadeEmbalagem: 50,
      registro: { numero: '123456789', validade: '2020-01-01' },
    },
  ],
  estabilidades: [{ condicao: 'diluido', horas: 24, condicaoArmazenamento: 2, diluente: 1 }],
  ...mais,
});
/** A ficha lida sem os campos só de leitura: o que a tela devolve ao salvar. */
function entradaDe(ficha: object): ItemEstoqueEntrada {
  const e: Record<string, unknown> = { ...ficha };
  for (const k of [
    'id',
    'versao',
    'situacao',
    'saldoTotal',
    'registrosNaData',
    'nomesPrincipios',
    'nomesFabricantes',
  ])
    delete e[k];
  return e as unknown as ItemEstoqueEntrada;
}
const recusada = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { problema?: { codigo?: string } }) => ({ codigo: e.problema?.codigo }),
  );

describe('porta do cadastro do estoque em memória', () => {
  it('grava o item inteiro e devolve a ficha com os nomes e o registro vencido na data', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => HOJE);
    const { id, versao } = await porta.incluirItem(c, medicamento());
    expect(versao).toBe(1);
    const ficha = (await porta.fichaItem(c, id))!;
    expect(ficha).toMatchObject({
      id,
      versao: 1,
      situacao: 'ativo',
      saldoTotal: 0,
      codigo: 'MED-SINT-1',
      registrosNaData: ['vencido'],
      nomesPrincipios: { 501: 'DIPIRONA SINTETICA' },
      nomesFabricantes: { 601: 'LABORATORIO SINTETICO ALFA' },
    });
    expect(ficha.estabilidades).toEqual([
      { condicao: 'diluido', horas: 24, condicaoArmazenamento: 2, diluente: 1 },
    ]);
    const apoio = await porta.apoio(c);
    expect(apoio.hoje).toBe(HOJE);
    expect(apoio.guardas.length).toBeGreaterThan(0);
    expect(apoio.diluentes.length).toBeGreaterThan(0);
    expect((await porta.buscar(c, 'principios', 'dipi')).map((o) => o.id)).toEqual([501]);
  });

  it('recusa sem gravar: regra do domínio, código repetido, referência, subgrupo e código de barras alheio', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => HOJE);
    const erros = [
      await recusada(porta.incluirItem(c, medicamento({ principiosAtivos: [], vias: [] }))),
      await recusada(porta.incluirItem(c, medicamento({ codigo: '5001' }))),
      await recusada(porta.incluirItem(c, medicamento({ unidadeEstoque: 999 }))),
      await recusada(porta.incluirItem(c, medicamento({ subgrupo: 21 }))),
    ];
    expect(erros.map((e) => e?.codigo)).toEqual([
      'item-sem-principio',
      'item-codigo-existente',
      'referencia-inexistente',
      'subgrupo-fora-do-grupo',
    ]);
    // Nada ficou gravado: o mesmo código entra na primeira gravação válida.
    const { id } = await porta.incluirItem(c, medicamento());
    const outro = await recusada(porta.incluirItem(c, medicamento({ codigo: 'MED-SINT-2' })));
    expect(outro?.codigo).toBe('codigo-barras-de-outro-item');
    expect(await porta.fichaItem(c, id + 1)).toBeNull();
  });

  it('altera pela versão lida; o item com saldo não troca a unidade nem é inativado', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => HOJE);
    const { id } = await porta.incluirItem(c, medicamento());
    const r = await porta.alterarItem(c, id, 1, medicamento({ nome: 'DIPIRONA SINTETICA 1 G' }));
    expect(r.versao).toBe(2);
    const vencida = await recusada(porta.alterarItem(c, id, 1, medicamento({ nome: 'OUTRO NOME' })));
    expect(vencida?.codigo).toBe('conflito-versao');
    expect((await porta.fichaItem(c, id))!.nome).toBe('DIPIRONA SINTETICA 1 G');

    const comSaldo = (await porta.fichaItem(c, 5003))!;
    const { versao, saldoTotal } = comSaldo;
    const entrada = entradaDe(comSaldo);
    expect(saldoTotal).toBeGreaterThan(0);
    const trava = await recusada(porta.alterarItem(c, 5003, versao, { ...entrada, unidadeEstoque: 1 }));
    expect(trava?.codigo).toBe('item-com-uso-trava');
    expect((await porta.alterarItem(c, 5003, versao, { ...entrada, estoqueMinimo: 20 })).versao).toBe(2);
    expect((await recusada(porta.situacaoItem(c, 5003, 2, false, 'fora de linha')))?.codigo).toBe(
      'inativar-com-saldo',
    );
    expect((await recusada(porta.situacaoItem(c, 5090, 1, false, 'fora de linha')))?.codigo).toBe(
      'inativar-item-com-requisicao',
    );
  });

  it('inativa e reativa com motivo, pela versão; o item nunca é apagado', async () => {
    const porta = new PortaCadastroEstoqueMemoria(() => HOJE);
    const { id } = await porta.incluirItem(c, medicamento());
    expect((await recusada(porta.situacaoItem(c, id, 1, false, ' ')))?.codigo).toBe('inativar-sem-motivo');
    expect((await porta.situacaoItem(c, id, 1, false, 'fora de linha')).versao).toBe(2);
    expect((await porta.fichaItem(c, id))!.situacao).toBe('inativo');
    expect((await recusada(porta.situacaoItem(c, id, 2, true, '')))?.codigo).toBe('reativar-sem-motivo');
    await porta.situacaoItem(c, id, 2, true, 'voltou ao padrão');
    expect((await porta.fichaItem(c, id))!).toMatchObject({ situacao: 'ativo', versao: 3 });
  });
});
