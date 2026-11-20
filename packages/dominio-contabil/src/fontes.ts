// Derivadores das fontes de fato que não são a conta do paciente (M54-F1; ficha, seção 4). As colunas lidas são só as
// do efeito contábil (data, valor, centro de custo, tipo de lançamento, conta bancária, IDs); nunca nome, documento de
// pessoa ou credor por nome (MFCTAREC.NOME e MFCONPAG.FAVORECIDO ficam fora da leitura).
//
// Colunas "a confirmar" pelo construtor no teste dourado contra o lote do M32 (a mesma competência; preparo-e1.md §5):
//   - MFCONPAG: lançamento pela EMISSAO e VALOR; baixa por DT_PGTO e PAGO.
//   - MFCTAREC: lançamento pela APRES e VALOR; baixa por PGTO e VLR_PAG.
//   - MFLANCTO: DATA e VALOR; transferência entre contas próprias (TIPO_TRF T e F) é um fato como os demais (a regra
//     decide as contas; o M32 já a exclui do fluxo de caixa).
//   - GELANSAI: competência por ANO e MES; valor QTDE × VLRMED (preço médio dos gatilhos, regra 9). A linha não tem
//     data nem centro de custo: a leitura junta o cabeçalho da saída (centro de custo de destino) e traz DATA_SAIDA.
//   - GECADNFS: DATA e TOTAL.
//   - RPRPA: EMISSAO e o valor dos títulos do recibo (MFCONPAG.ID_RPRPA), somado na leitura (VALOR_TITULOS);
//     STATUS = 'C' lido como cancelado (sem fato).
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

/** Último dia do mês de uma competência AAAA-MM (a data contábil do custo de pessoal da folha). */
function ultimoDiaDoMes(competencia: string): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(competencia);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${m[1]}-${m[2]}-${String(dia).padStart(2, '0')}`;
}

/**
 * Custo de pessoal da folha calculada (SGH_PES_FOLHA_FATO do M53; D-FOLHAFATO-541): um fato por linha (lançamento da
 * folha, rotina, centro de custo e natureza), na data do último dia da competência. `CONTABILIZA = 'N'` (rubrica fora
 * da contabilização) não gera fato. Sem colaborador: o resumo por centro já basta.
 */
export const derivarFolha: Derivador = (l) => {
  const v = l.valores;
  const competencia = textoOuVazio(v['PERIODO']);
  const data = ultimoDiaDoMes(competencia);
  const centavos = inteiroOuNulo(v['VALOR_CENTAVOS']) ?? 0;
  if (!data || textoOuVazio(v['CONTABILIZA']).toUpperCase() !== 'S' || centavos <= 0) return [];
  return [
    {
      tipo: 'folha',
      data,
      valorCentavos: centavos,
      centroCusto: inteiroOuNulo(v['ID_TBCENCUS']),
      documento: `folha ${competencia} lançamento ${String(inteiroOuNulo(v['ID_LANCAMENTO']) ?? '')}`.trim(),
      campos: {
        rotina: inteiroOuNulo(v['ROTINA']),
        natureza: textoOuVazio(v['NATUREZA']) || null,
        empresaFolha: inteiroOuNulo(v['COD_EMP']),
      },
    },
  ];
};

/**
 * Depreciação do mês (SGH_PAT_DEPRECIACAO do M54.6; ficha, regra 12): uma cota por bem e competência, gravada pelo
 * cálculo do patrimônio (imutável), vira um fato de origem 7 (Patrimônio) no último dia da competência, pelo centro de
 * custo onde o bem estava; o grupo do bem vai nos campos (a regra escolhe a conta de despesa e a de depreciação
 * acumulada pelo grupo). W0-08 (script 1103): a cota de um cálculo ESTORNADO deixa de ser fato; a conciliação lança o
 * estorno no período aberto, com o motivo, a data e a origem do estorno no documento (ITG 2000, item 32).
 */
export const derivarDepreciacao: Derivador = Object.assign(
  (l: LinhaFonte): FatoBase[] => {
    const v = l.valores;
    if (textoOuVazio(v['ESTORNADO_EM'])) return [];
    const competencia = textoOuVazio(v['COMPETENCIA']);
    const data = ultimoDiaDoMes(competencia);
    const centavos = inteiroOuNulo(v['VALOR_CENT']) ?? 0;
    if (!data || centavos <= 0) return [];
    return [
      {
        tipo: 'depreciacao',
        data,
        valorCentavos: centavos,
        centroCusto: inteiroOuNulo(v['ID_TBCENCUS']),
        documento: `depreciação ${competencia} bem ${textoOuVazio(v['PLAQUETA'])}`.trim(),
        campos: {
          grupoBem: textoOuVazio(v['GRUPO']) || null,
          bem: inteiroOuNulo(v['ID_BEM']),
          empresaBem: inteiroOuNulo(v['EMPRESA']),
        },
      },
    ];
  },
  {
    documentoDoEstorno: (l: LinhaFonte): string | null => {
      const v = l.valores;
      const em = dataValida(v['ESTORNADO_EM']);
      if (!em) return null;
      // O documento do fato tem 80 caracteres: o motivo inteiro fica no estorno do patrimônio (SGH_PAT_CALCULO_ESTORNO).
      const motivo = textoOuVazio(v['MOTIVO_ESTORNO']);
      const comp = textoOuVazio(v['COMPETENCIA']);
      return `${comp} bem ${textoOuVazio(v['PLAQUETA'])} estornada em ${em} no patrimônio: ${motivo}`.slice(
        0,
        80,
      );
    },
  },
);

/**
 * Perda por impairment do bem (SGH_PAT_AJUSTE do W0-08, M1; CPC 01): o ajuste do tipo `impairment` vira um fato de
 * origem 7 (Patrimônio) na data do ajuste, pelo valor da perda e pelo centro de custo onde o bem estava; a revisão de
 * estimativa e a reavaliação são eventos sem lançamento (nenhum fato). O ajuste ESTORNADO deixa de ser fato e a
 * conciliação lança o estorno com o motivo, a data e a origem no documento (ITG 2000, item 32), como na depreciação.
 */
export const derivarImpairment: Derivador = Object.assign(
  (l: LinhaFonte): FatoBase[] => {
    const v = l.valores;
    if (textoOuVazio(v['TIPO']) !== 'impairment' || textoOuVazio(v['ESTORNADO_EM'])) return [];
    const data = dataValida(v['DATA_AJUSTE']);
    const centavos = inteiroOuNulo(v['PERDA_CENT']) ?? 0;
    if (!data || centavos <= 0) return [];
    return [
      {
        tipo: 'impairment',
        data,
        valorCentavos: centavos,
        centroCusto: inteiroOuNulo(v['ID_TBCENCUS']),
        documento: `impairment ajuste ${l.id} bem ${textoOuVazio(v['PLAQUETA'])}`.trim(),
        campos: {
          grupoBem: textoOuVazio(v['GRUPO']) || null,
          bem: inteiroOuNulo(v['ID_BEM']),
          empresaBem: inteiroOuNulo(v['EMPRESA']),
        },
      },
    ];
  },
  {
    documentoDoEstorno: (l: LinhaFonte): string | null => {
      const v = l.valores;
      const em = dataValida(v['ESTORNADO_EM']);
      if (!em) return null;
      // O documento do fato tem 80 caracteres: o motivo inteiro fica no estorno do patrimônio (SGH_PAT_AJUSTE_ESTORNO).
      const motivo = textoOuVazio(v['MOTIVO_ESTORNO']);
      return `impairment ${l.id} bem ${textoOuVazio(v['PLAQUETA'])} estornado em ${em} no patrimônio: ${motivo}`.slice(
        0,
        80,
      );
    },
  },
);

/** Derivador por tabela de fonte (FONTES_FATO). */
export const DERIVADORES: Readonly<Record<string, Derivador>> = {
  FCCTAEXT: derivarConta,
  FCLANEXT: derivarItemConta,
  MFCONPAG: derivarTituloPagar,
  MFCTAREC: derivarTituloReceber,
  MFLANCTO: derivarMovimentoBancario,
  GELANSAI: derivarSaidaEstoque,
  GECADNFS: derivarNotaEntrada,
  RPRPA: derivarRecibo,
  SGH_PES_FOLHA_FATO: derivarFolha,
  SGH_PAT_DEPRECIACAO: derivarDepreciacao,
  SGH_PAT_AJUSTE: derivarImpairment,
};
