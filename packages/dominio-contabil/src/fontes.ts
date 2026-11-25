// Derivadores das fontes de fato que não são a conta do paciente (M54-F1; ficha, seção 4). As colunas lidas são só as
// do efeito contábil (data, valor, centro de custo, tipo de lançamento, conta bancária, IDs); nunca nome, documento de
// pessoa ou credor por nome (o nome do devedor e o favorecido do título ficam fora da leitura).
//
// Colunas "a confirmar" pelo construtor no teste dourado contra o lote do M32 (a mesma competência; preparo-e1.md §5):
//   - título a pagar: lançamento pela emissão e pelo valor; baixa pela data e pelo valor do pagamento.
//   - título a receber: lançamento pela apresentação e pelo valor; baixa pela data e pelo valor do recebimento.
//   - movimento bancário: data e valor; transferência entre contas próprias é um fato como os demais (a regra decide
//     as contas; o M32 já a exclui do fluxo de caixa).
//   - saída de estoque: competência por ano e mês; valor quantidade × preço médio (regra 9). A linha não tem data nem
//     centro de custo: a leitura junta o cabeçalho da saída (centro de custo de destino) e traz a data da saída.
//   - nota fiscal de entrada: data e total.
//   - recibo de autônomo: emissão e o valor dos títulos a pagar do recibo, somado na leitura; a situação 'C' é lida
//     como cancelado (sem fato).
import type { LinhaFonte } from '@sgh/contratos';
import { paraCentavos } from './dinheiro.js';
import { dataValida, inteiroOuNulo, textoOuVazio, type Derivador, type FatoBase } from './derivacao.js';
import { derivarConta, derivarItemConta } from './receita.js';

const valor = (l: LinhaFonte, col: string) => paraCentavos(l.valores[col] as number | string | null);

export const derivarTituloPagar: Derivador = (l) => {
  const v = l.valores;
  const r: FatoBase[] = [];
  const campos = {
    tipoLancamento: inteiroOuNulo(v['ID_MFTIPOLANC']),
    tipoTitulo: textoOuVazio(v['TIPO']) || null,
    origemTitulo: textoOuVazio(v['ONDE']) || null,
    recibo: inteiroOuNulo(v['ID_RPRPA']),
  };
  const emissao = dataValida(v['EMISSAO']);
  if (emissao)
    r.push({
      tipo: 'tituloPagar',
      data: emissao,
      valorCentavos: valor(l, 'VALOR'),
      centroCusto: null,
      documento: `título a pagar ${l.id}`,
      campos,
    });
  const pg = dataValida(v['DT_PGTO']);
  if (pg)
    r.push({
      tipo: 'baixaTituloPagar',
      data: pg,
      valorCentavos: valor(l, 'PAGO'),
      centroCusto: null,
      documento: `título a pagar ${l.id}`,
      campos: { ...campos, contaBancaria: inteiroOuNulo(v['ID_TBCTABAN']) },
    });
  return r;
};

export const derivarTituloReceber: Derivador = (l) => {
  const v = l.valores;
  const r: FatoBase[] = [];
  const campos = {
    tipoLancamento: inteiroOuNulo(v['ID_MFTIPOLANC']),
    convenio: inteiroOuNulo(v['CONV']),
    origemTitulo: textoOuVazio(v['ORIGEM']) || null,
  };
  const cdc = inteiroOuNulo(v['CDC_DEB']);
  const apres = dataValida(v['APRES']);
  if (apres)
    r.push({
      tipo: 'tituloReceber',
      data: apres,
      valorCentavos: valor(l, 'VALOR'),
      centroCusto: cdc,
      documento: `título a receber ${l.id}`,
      campos,
    });
  const pg = dataValida(v['PGTO']);
  if (pg)
    r.push({
      tipo: 'baixaTituloReceber',
      data: pg,
      valorCentavos: valor(l, 'VLR_PAG'),
      centroCusto: cdc,
      documento: `título a receber ${l.id}`,
      campos: { ...campos, contaBancaria: inteiroOuNulo(v['ID_TBCTABAN']) },
    });
  return r;
};

export const derivarMovimentoBancario: Derivador = (l) => {
  const v = l.valores;
  const data = dataValida(v['DATA']);
  if (!data) return [];
  return [
    {
      tipo: 'movimentoBancario',
      data,
      valorCentavos: valor(l, 'VALOR'),
      centroCusto: inteiroOuNulo(v['CDC_DEB']) ?? inteiroOuNulo(v['CDC_CRE']),
      documento: `movimento ${l.id}`,
      campos: {
        tipoTransferencia: textoOuVazio(v['TIPO_TRF']) || null,
        contaCredito: inteiroOuNulo(v['ID_TBCTABAN_CRE']),
        contaDebito: inteiroOuNulo(v['ID_TBCTABAN_DEV']),
        grupo: inteiroOuNulo(v['GRUPO']),
        subgrupo: inteiroOuNulo(v['SUBGRUPO']),
        item: inteiroOuNulo(v['ITEM']),
      },
    },
  ];
};

export const derivarSaidaEstoque: Derivador = (l) => {
  const v = l.valores;
  const ano = inteiroOuNulo(v['ANO']);
  const mes = inteiroOuNulo(v['MES']);
  const data =
    dataValida(v['DATA_SAIDA']) ??
    (ano && mes && mes >= 1 && mes <= 12 ? `${ano}-${String(mes).padStart(2, '0')}-01` : null);
  if (!data) return [];
  // Quantidade NUMERIC(15,3) × preço médio NUMERIC(15,2): em milésimos × centavos, arredondado no fim.
  const qtdMil = Math.round(Number(v['QTDE'] ?? 0) * 1000);
  const medio = valor(l, 'VLRMED');
  const centavos = Math.sign(qtdMil * medio) * Math.round(Math.abs(qtdMil * medio) / 1000);
  return [
    {
      tipo: 'saidaEstoque',
      data,
      valorCentavos: centavos,
      centroCusto: inteiroOuNulo(v['CDC_DESTINO']),
      documento: `saída ${textoOuVazio(v['DOC'])} linha ${l.id}`,
      campos: { item: inteiroOuNulo(v['ITEM']), situacao: textoOuVazio(v['STATUS']) || null },
    },
  ];
};

export const derivarNotaEntrada: Derivador = (l) => {
  const v = l.valores;
  const data = dataValida(v['DATA']);
  if (!data) return [];
  return [
    {
      tipo: 'notaEntrada',
      data,
      valorCentavos: valor(l, 'TOTAL'),
      centroCusto: null,
      documento: `nota de entrada ${l.id}`,
      campos: {
        naturezaOperacao: inteiroOuNulo(v['NAT_OP']),
        tipoCompra: textoOuVazio(v['TIPO_COMPRA']) || null,
      },
    },
  ];
};

export const derivarRecibo: Derivador = (l) => {
  const v = l.valores;
  const data = dataValida(v['EMISSAO']);
  if (!data || textoOuVazio(v['STATUS']).toUpperCase() === 'C') return [];
  return [
    {
      tipo: 'recibo',
      data,
      valorCentavos: valor(l, 'VALOR_TITULOS'),
      centroCusto: null,
      documento: `recibo ${l.id}`,
      campos: { tipoRecibo: textoOuVazio(v['TIPO']) || null },
    },
  ];
};

/**
 * Derivador por tabela de fonte lida pelo ciclo (FONTES_FATO sem `publicada`). A folha, a depreciação, o impairment e
 * o repasse publicam o fato na transação do documento (ADR 0003) e não têm derivador. Os derivadores daqui ainda leem o
 * leiaute da origem: a decisão (conector ou reescrita sobre as entidades próprias) está pedida no lote 14-contabil da
 * F2.4, e até lá o worker recusa a leitura das fontes.
 */
export const DERIVADORES: Readonly<Record<string, Derivador>> = {
  conta_hospitalar: derivarConta,
  conta_hospitalar_item: derivarItemConta,
  titulo_pagar: derivarTituloPagar,
  titulo_receber: derivarTituloReceber,
  movimento_bancario: derivarMovimentoBancario,
  movimento_estoque: derivarSaidaEstoque,
  nota_entrada: derivarNotaEntrada,
  recibo_autonomo: derivarRecibo,
};
