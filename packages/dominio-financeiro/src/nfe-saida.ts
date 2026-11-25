// F7, 07-FIN linha 114: a NF-e de saída de mercadoria (modelo 55, leiaute nacional 4.00) que o hospital emite quando a
// mercadoria sai sem ser consumida: a devolução de compra ao fornecedor, a devolução do consignado, a remessa para
// conserto, a simples remessa e a venda a terceiro. Aqui mora a regra pura: as naturezas de operação de partida com o
// CFOP dentro e fora do estado, a conferência do pedido (destinatário com dígito conferido, NCM, quantidades, a nota
// referenciada que a devolução exige), o cálculo dos itens e dos tributos destacados (ICMS, IPI), a chave de acesso
// (44 dígitos, dígito verificador módulo 11), o XML sem assinatura (a assinatura XMLDSig com o certificado A1 é da API),
// o simulador da Sefaz (fora de produção), o cancelamento (prazo e justificativa) e a carta de correção (texto,
// sequência e a condição de uso), e o DANFE simplificado. Nada é apagado: cancelar e corrigir viram eventos.
import { centavos, recusaFin, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';

/** As finalidades da natureza de operação que esta nota cobre (natureza_operacao.finalidade). */
export const FINALIDADES_NFE_SAIDA = ['devolucao', 'conserto', 'simples_remessa', 'venda'] as const;
export type FinalidadeNfeSaida = (typeof FINALIDADES_NFE_SAIDA)[number];

/** De onde a nota nasce: a devolução ao fornecedor já gravada, ou o pedido montado na tela. */
export const ORIGENS_NFE_SAIDA = ['devolucao_fornecedor', 'consignado', 'conserto', 'avulsa'] as const;
export type OrigemNfeSaida = (typeof ORIGENS_NFE_SAIDA)[number];

export interface NaturezaNfePadrao {
  readonly codigo: string;
  readonly descricao: string;
  readonly finalidade: FinalidadeNfeSaida;
  readonly cfopDentro: string;
  readonly cfopFora: string;
  /** CFOP de entrada do retorno (conserto). */
  readonly cfopEntrada: string | null;
  readonly atualizaEstoque: boolean;
  /** Devolução sai com finNFe 4 e exige a nota de origem referenciada. */
  readonly finalidadeEmissao: 'normal' | 'devolucao';
  readonly tipoReferencia: 'devolucao' | 'remessa_conserto' | null;
}

/**
 * As naturezas de partida (o hospital compra para uso e consumo, não para revenda): o cadastro do cliente pode mudar a
 * descrição e o CFOP; o código liga a natureza à regra.
 */
export const NATUREZAS_NFE_PADRAO: readonly NaturezaNfePadrao[] = [
  {
    codigo: 'devolucao_compra',
    descricao: 'Devolução de compra de material de uso ou consumo',
    finalidade: 'devolucao',
    cfopDentro: '5556',
    cfopFora: '6556',
    cfopEntrada: null,
    atualizaEstoque: true,
    finalidadeEmissao: 'devolucao',
    tipoReferencia: 'devolucao',
  },
  {
    codigo: 'devolucao_consignado',
    descricao: 'Devolução de mercadoria recebida em consignação',
    finalidade: 'devolucao',
    cfopDentro: '5918',
    cfopFora: '6918',
    cfopEntrada: null,
    atualizaEstoque: true,
    finalidadeEmissao: 'devolucao',
    tipoReferencia: 'devolucao',
  },
  {
    codigo: 'remessa_conserto',
    descricao: 'Remessa de bem para conserto ou reparo',
    finalidade: 'conserto',
    cfopDentro: '5915',
    cfopFora: '6915',
    cfopEntrada: '1916',
    atualizaEstoque: false,
    finalidadeEmissao: 'normal',
    tipoReferencia: null,
  },
  {
    codigo: 'simples_remessa',
    descricao: 'Outra saída de mercadoria: simples remessa',
    finalidade: 'simples_remessa',
    cfopDentro: '5949',
    cfopFora: '6949',
    cfopEntrada: null,
    atualizaEstoque: true,
    finalidadeEmissao: 'normal',
    tipoReferencia: null,
  },
  {
    codigo: 'venda_terceiro',
    descricao: 'Venda de mercadoria adquirida de terceiro',
    finalidade: 'venda',
    cfopDentro: '5102',
    cfopFora: '6102',
    cfopEntrada: null,
    atualizaEstoque: true,
    finalidadeEmissao: 'normal',
    tipoReferencia: null,
  },
];

/** A natureza de partida que cada origem usa. */
export const NATUREZA_DA_ORIGEM: Readonly<Record<Exclude<OrigemNfeSaida, 'avulsa'>, string>> = {
  devolucao_fornecedor: 'devolucao_compra',
  consignado: 'devolucao_consignado',
  conserto: 'remessa_conserto',
};

/** Código IBGE da unidade da federação (cUF da chave de acesso). */
export const CODIGO_UF: Readonly<Record<string, string>> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24',
  PB: '25', PE: '26', AL: '27', SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42',
  RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
}; // prettier-ignore

/** CFOP da operação: dentro do estado quando emitente e destinatário estão na mesma UF; fora, quando não. */
export function cfopDaOperacao(
  n: { readonly cfopDentro: string; readonly cfopFora: string },
  ufEmitente: string,
  ufDestinatario: string,
): string {
  return ufEmitente.toUpperCase() === ufDestinatario.toUpperCase() ? n.cfopDentro : n.cfopFora;
}

const soDigitos = (v: string) => v.replace(/\D/g, '');

export function cnpjValido(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) {
      soma += Number(c) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

export function cpfValido(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Dígito verificador da chave de acesso: módulo 11 com pesos 2 a 9 da direita para a esquerda. */
export function digitoChaveNfe(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export function chaveNfeValida(chave: string): boolean {
  return /^\d{44}$/.test(chave) && digitoChaveNfe(chave.slice(0, 43)) === Number(chave[43]);
}

export interface PartesChaveNfe {
  readonly uf: string;
  readonly emissao: Date;
  readonly cnpjEmitente: string;
  readonly serie: number;
  readonly numero: number;
  /** Código numérico de 8 dígitos que compõe a chave (cNF); a API o sorteia. */
  readonly codigoNumerico: number;
}

export function chaveAcessoNfe(p: PartesChaveNfe): string {
  const cuf = CODIGO_UF[p.uf.toUpperCase()];
  if (!cuf) throw new Error(`UF desconhecida: ${p.uf}`);
  const aamm = `${String(p.emissao.getUTCFullYear()).slice(2)}${String(p.emissao.getUTCMonth() + 1).padStart(2, '0')}`;
  const base =
    cuf +
    aamm +
    soDigitos(p.cnpjEmitente).padStart(14, '0') +
    '55' +
    String(p.serie).padStart(3, '0') +
    String(p.numero).padStart(9, '0') +
    '1' +
    String(p.codigoNumerico % 100_000_000).padStart(8, '0');
  return base + String(digitoChaveNfe(base));
}

export interface ItemNfePedido {
  readonly codigo: string;
  readonly descricao: string;
  readonly ncm: string;
  readonly unidade: string;
  readonly quantidade: number;
  readonly valorUnitario: number;
  readonly desconto: number;
  readonly lote: string | null;
  readonly fabricacao: string | null;
  readonly validade: string | null;
  readonly registroAnvisa: string | null;
  /** CST do ICMS (dois dígitos): 00 tributada, 40/41/50 sem destaque, 90 outras. */
  readonly cstIcms: string;
  readonly aliquotaIcms: number;
  readonly aliquotaIpi: number;
}

export interface ParteNfe {
  readonly documento: string;
  readonly nome: string;
  readonly uf: string;
  readonly municipioIbge: string | null;
  readonly municipio: string | null;
  readonly inscricaoEstadual: string | null;
  readonly contribuinteIcms: boolean;
}

export interface PedidoNfeSaida {
  readonly natureza: NaturezaNfePadrao;
  readonly emitente: ParteNfe;
  readonly destinatario: ParteNfe;
  /** Chaves das NF-e de origem (a de entrada devolvida, a remessa recebida). */
  readonly referencias: readonly string[];
  readonly itens: readonly ItemNfePedido[];
  readonly valorFrete: number;
  readonly informacaoComplementar: string | null;
}

const CST_ICMS = ['00', '20', '40', '41', '50', '51', '60', '90'];
const UNIDADE = /^[A-Za-z0-9]{1,6}$/;

export function conferirNfeSaida(p: PedidoNfeSaida): RecusaFinanceiro | null {
  const dest = soDigitos(p.destinatario.documento);
  if (!(dest.length === 14 ? cnpjValido(dest) : dest.length === 11 ? cpfValido(dest) : false))
    return recusaFin('destinatario-documento', 'O CNPJ ou o CPF do destinatário não confere.', [
      'destinatario.documento',
    ]);
  if (!p.destinatario.nome.trim())
    return recusaFin('destinatario-nome', 'Informe o nome do destinatário.', ['destinatario.nome']);
  if (!CODIGO_UF[p.destinatario.uf.toUpperCase()])
    return recusaFin('destinatario-uf', 'O destinatário está sem UF no cadastro.', ['destinatario.uf']);
  if (!cnpjValido(p.emitente.documento) || !CODIGO_UF[p.emitente.uf.toUpperCase()])
    return recusaFin(
      'emitente-cadastro',
      'O estabelecimento emitente precisa de CNPJ válido e município com UF no cadastro.',
      ['emitente'],
    );
  if (p.itens.length === 0)
    return recusaFin('itens-vazio', 'A nota precisa de pelo menos um item.', ['itens']);
  if (p.itens.length > 990) return recusaFin('itens-limite', 'A NF-e aceita até 990 itens.', ['itens']);
  for (const [i, it] of p.itens.entries()) {
    const c = (campo: string) => [`itens.${i}.${campo}`];
    if (!it.descricao.trim() || !it.codigo.trim())
      return recusaFin('item-descricao', `Item ${i + 1}: informe o código e a descrição.`, c('descricao'));
    if (!/^\d{8}$/.test(it.ncm))
      return recusaFin('item-ncm', `Item ${i + 1}: o NCM tem 8 dígitos.`, c('ncm'));
    if (!UNIDADE.test(it.unidade))
      return recusaFin('item-unidade', `Item ${i + 1}: a unidade tem até 6 letras ou números.`, c('unidade'));
    if (!(it.quantidade > 0))
      return recusaFin(
        'item-quantidade',
        `Item ${i + 1}: a quantidade precisa ser maior que zero.`,
        c('quantidade'),
      );
    if (!(it.valorUnitario >= 0))
      return recusaFin(
        'item-valor',
        `Item ${i + 1}: o valor unitário não pode ser negativo.`,
        c('valorUnitario'),
      );
    if (it.desconto < 0 || it.desconto > centavos(it.quantidade * it.valorUnitario))
      return recusaFin('item-desconto', `Item ${i + 1}: o desconto passa do valor do item.`, c('desconto'));
    if (it.validade && it.fabricacao && it.validade < it.fabricacao)
      return recusaFin('item-validade', `Item ${i + 1}: a validade vem antes da fabricação.`, c('validade'));
    if ((it.validade || it.fabricacao) && !it.lote)
      return recusaFin('item-lote', `Item ${i + 1}: fabricação e validade pedem o lote.`, c('lote'));
    if (!CST_ICMS.includes(it.cstIcms))
      return recusaFin('item-cst', `Item ${i + 1}: CST do ICMS desconhecido.`, c('cstIcms'));
    if (it.aliquotaIcms < 0 || it.aliquotaIcms > 100 || it.aliquotaIpi < 0 || it.aliquotaIpi > 100)
      return recusaFin('item-aliquota', `Item ${i + 1}: alíquota entre 0 e 100.`, c('aliquotaIcms'));
    if (['40', '41', '50'].includes(it.cstIcms) && it.aliquotaIcms > 0)
      return recusaFin(
        'item-cst-aliquota',
        `Item ${i + 1}: o CST ${it.cstIcms} não destaca ICMS; zere a alíquota ou troque o CST.`,
        c('aliquotaIcms'),
      );
  }
  if (p.natureza.finalidadeEmissao === 'devolucao' && p.referencias.length === 0)
    return recusaFin(
      'devolucao-sem-referencia',
      'A nota de devolução precisa da chave da nota de origem (a nota de entrada devolvida).',
      ['referencias'],
    );
  for (const [i, r] of p.referencias.entries())
    if (!chaveNfeValida(r))
      return recusaFin(
        'referencia-chave',
        `A chave referenciada ${i + 1} não confere (44 dígitos e o dígito).`,
        [`referencias.${i}`],
      );
  if (p.valorFrete < 0) return recusaFin('frete', 'O frete não pode ser negativo.', ['valorFrete']);
  if ((p.informacaoComplementar ?? '').length > 2000)
    return recusaFin('informacao', 'A informação complementar vai até 2.000 caracteres.', [
      'informacaoComplementar',
    ]);
  return null;
}

export interface ItemNfeCalculado extends ItemNfePedido {
  readonly sequencia: number;
  readonly cfop: string;
  readonly valorBruto: number;
  readonly baseIcms: number;
  readonly valorIcms: number;
  readonly baseIpi: number;
  readonly valorIpi: number;
  /** Bruto − desconto + IPI. */
  readonly valorTotal: number;
}

export interface NfeCalculada {
  readonly cfop: string;
  readonly itens: readonly ItemNfeCalculado[];
  readonly valorProdutos: number;
  readonly valorDesconto: number;
  readonly valorFrete: number;
  readonly valorIcms: number;
  readonly valorIpi: number;
  /** Produtos − desconto + frete + IPI. */
  readonly valorTotal: number;
}

/** Calcula itens e totais. O ICMS só é destacado nos CST 00, 20, 51 e 90 com alíquota; o IPI, com alíquota. */
export function calcularNfeSaida(p: PedidoNfeSaida): NfeCalculada {
  const cfop = cfopDaOperacao(p.natureza, p.emitente.uf, p.destinatario.uf);
  const itens = p.itens.map((it, i): ItemNfeCalculado => {
    const valorBruto = centavos(it.quantidade * it.valorUnitario);
    const liquido = centavos(valorBruto - it.desconto);
    const destaca = ['00', '20', '51', '90'].includes(it.cstIcms) && it.aliquotaIcms > 0;
    const baseIcms = destaca ? liquido : 0;
    const valorIcms = destaca ? centavos((baseIcms * it.aliquotaIcms) / 100) : 0;
    const baseIpi = it.aliquotaIpi > 0 ? liquido : 0;
    const valorIpi = it.aliquotaIpi > 0 ? centavos((baseIpi * it.aliquotaIpi) / 100) : 0;
    return {
      ...it,
      sequencia: i + 1,
      cfop,
      valorBruto,
      baseIcms,
      valorIcms,
      baseIpi,
      valorIpi,
      valorTotal: centavos(liquido + valorIpi),
    };
  });
  const soma = (f: (x: ItemNfeCalculado) => number) => centavos(itens.reduce((s, x) => s + f(x), 0));
  const valorProdutos = soma((x) => x.valorBruto);
  const valorDesconto = soma((x) => x.desconto);
  const valorIcms = soma((x) => x.valorIcms);
  const valorIpi = soma((x) => x.valorIpi);
  const valorFrete = centavos(p.valorFrete);
  return {
    cfop,
    itens,
    valorProdutos,
    valorDesconto,
    valorFrete,
    valorIcms,
    valorIpi,
    valorTotal: centavos(valorProdutos - valorDesconto + valorFrete + valorIpi),
  };
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const v2 = (n: number) => n.toFixed(2);
const v4 = (n: number) => n.toFixed(4);
const tag = (nome: string, valor: string | null | undefined) =>
  valor === null || valor === undefined || valor === '' ? '' : `<${nome}>${esc(valor)}</${nome}>`;

/** Data e hora no formato do leiaute (AAAA-MM-DDThh:mm:ss-03:00, horário de Brasília). */
export function dataHoraNfe(d: Date): string {
  const b = new Date(d.getTime() - 3 * 3_600_000);
  return `${b.toISOString().slice(0, 19)}-03:00`;
}

export interface DadosXmlNfe {
  readonly pedido: PedidoNfeSaida;
  readonly calculo: NfeCalculada;
  readonly chave: string;
  readonly serie: number;
  readonly numero: number;
  readonly emissao: Date;
  readonly homologacao: boolean;
}

function icmsXml(it: ItemNfeCalculado): string {
  const orig = '<orig>0</orig>';
  if (it.cstIcms === '00')
    return `<ICMS00>${orig}<CST>00</CST><modBC>3</modBC><vBC>${v2(it.baseIcms)}</vBC><pICMS>${v4(it.aliquotaIcms)}</pICMS><vICMS>${v2(it.valorIcms)}</vICMS></ICMS00>`;
  if (['40', '41', '50'].includes(it.cstIcms)) return `<ICMS40>${orig}<CST>${it.cstIcms}</CST></ICMS40>`;
  return `<ICMS90>${orig}<CST>90</CST>${
    it.valorIcms > 0
      ? `<modBC>3</modBC><vBC>${v2(it.baseIcms)}</vBC><pICMS>${v4(it.aliquotaIcms)}</pICMS><vICMS>${v2(it.valorIcms)}</vICMS>`
      : ''
  }</ICMS90>`;
}

/** O XML da NF-e (leiaute 4.00) sem a assinatura; `infNFe` leva o Id que a assinatura referencia. */
export function xmlNfeSaida(d: DadosXmlNfe): string {
  const { pedido: p, calculo: c } = d;
  const em = p.emitente;
  const de = p.destinatario;
  const docDest = soDigitos(de.documento);
  const ide =
    `<ide><cUF>${CODIGO_UF[em.uf.toUpperCase()]}</cUF><cNF>${d.chave.slice(35, 43)}</cNF>` +
    `${tag('natOp', p.natureza.descricao.slice(0, 60))}<mod>55</mod><serie>${d.serie}</serie><nNF>${d.numero}</nNF>` +
    `<dhEmi>${dataHoraNfe(d.emissao)}</dhEmi><tpNF>1</tpNF><idDest>${em.uf.toUpperCase() === de.uf.toUpperCase() ? 1 : 2}</idDest>` +
    `${tag('cMunFG', em.municipioIbge)}<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${d.chave[43]}</cDV>` +
    `<tpAmb>${d.homologacao ? 2 : 1}</tpAmb><finNFe>${p.natureza.finalidadeEmissao === 'devolucao' ? 4 : 1}</finNFe>` +
    `<indFinal>${de.contribuinteIcms ? 0 : 1}</indFinal><indPres>9</indPres><procEmi>0</procEmi><verProc>sante-sgh</verProc>` +
    p.referencias.map((r) => `<NFref><refNFe>${r}</refNFe></NFref>`).join('') +
    '</ide>';
  const emit =
    `<emit><CNPJ>${soDigitos(em.documento)}</CNPJ>${tag('xNome', em.nome.slice(0, 60))}` +
    `<enderEmit>${tag('cMun', em.municipioIbge)}${tag('xMun', em.municipio)}<UF>${em.uf.toUpperCase()}</UF></enderEmit>` +
    `${tag('IE', em.inscricaoEstadual ?? 'ISENTO')}<CRT>3</CRT></emit>`;
  const dest =
    `<dest>${docDest.length === 14 ? `<CNPJ>${docDest}</CNPJ>` : `<CPF>${docDest}</CPF>`}` +
    `${tag('xNome', d.homologacao ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : de.nome.slice(0, 60))}` +
    `<enderDest>${tag('cMun', de.municipioIbge)}${tag('xMun', de.municipio)}<UF>${de.uf.toUpperCase()}</UF></enderDest>` +
    `<indIEDest>${de.contribuinteIcms ? 1 : 9}</indIEDest>${de.contribuinteIcms ? tag('IE', de.inscricaoEstadual) : ''}</dest>`;
  const det = c.itens
    .map(
      (it) =>
        `<det nItem="${it.sequencia}"><prod>${tag('cProd', it.codigo)}<cEAN>SEM GTIN</cEAN>${tag('xProd', it.descricao.slice(0, 120))}` +
        `<NCM>${it.ncm}</NCM><CFOP>${it.cfop}</CFOP>${tag('uCom', it.unidade)}<qCom>${v4(it.quantidade)}</qCom>` +
        `<vUnCom>${v4(it.valorUnitario)}</vUnCom><vProd>${v2(it.valorBruto)}</vProd><cEANTrib>SEM GTIN</cEANTrib>` +
        `${tag('uTrib', it.unidade)}<qTrib>${v4(it.quantidade)}</qTrib><vUnTrib>${v4(it.valorUnitario)}</vUnTrib>` +
        `${it.desconto > 0 ? `<vDesc>${v2(it.desconto)}</vDesc>` : ''}<indTot>1</indTot>` +
        (it.lote
          ? `<rastro>${tag('nLote', it.lote)}<qLote>${v4(it.quantidade)}</qLote>${tag('dFab', it.fabricacao)}${tag('dVal', it.validade)}</rastro>`
          : '') +
        (it.registroAnvisa ? `<med>${tag('cProdANVISA', it.registroAnvisa)}<vPMC>0.00</vPMC></med>` : '') +
        `</prod><imposto><ICMS>${icmsXml(it)}</ICMS><IPI><cEnq>999</cEnq>${
          it.valorIpi > 0
            ? `<IPITrib><CST>50</CST><vBC>${v2(it.baseIpi)}</vBC><pIPI>${v4(it.aliquotaIpi)}</pIPI><vIPI>${v2(it.valorIpi)}</vIPI></IPITrib>`
            : '<IPINT><CST>53</CST></IPINT>'
        }</IPI><PIS><PISNT><CST>08</CST></PISNT></PIS><COFINS><COFINSNT><CST>08</CST></COFINSNT></COFINS></imposto></det>`,
    )
    .join('');
  const total =
    `<total><ICMSTot><vBC>${v2(c.itens.reduce((s, x) => s + x.baseIcms, 0))}</vBC><vICMS>${v2(c.valorIcms)}</vICMS>` +
    `<vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST>` +
    `<vFCPSTRet>0.00</vFCPSTRet><vProd>${v2(c.valorProdutos)}</vProd><vFrete>${v2(c.valorFrete)}</vFrete><vSeg>0.00</vSeg>` +
    `<vDesc>${v2(c.valorDesconto)}</vDesc><vII>0.00</vII><vIPI>${v2(c.valorIpi)}</vIPI><vIPIDevol>0.00</vIPIDevol>` +
    `<vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${v2(c.valorTotal)}</vNF></ICMSTot></total>`;
  const transp = `<transp><modFrete>${c.valorFrete > 0 ? 0 : 9}</modFrete></transp>`;
  const pag = `<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>`;
  const adic = p.informacaoComplementar
    ? `<infAdic>${tag('infCpl', p.informacaoComplementar)}</infAdic>`
    : '';
  return `<NFe xmlns="${NS_NFE}"><infNFe versao="4.00" Id="NFe${d.chave}">${ide}${emit}${dest}${det}${total}${transp}${pag}${adic}</infNFe></NFe>`;
}

/** Prazo nacional do cancelamento (horas depois da autorização). */
export const PRAZO_CANCELAMENTO_NFE_HORAS = 24;

export function conferirCancelamentoNfe(x: {
  readonly situacao: string;
  readonly autorizadaEm: Date | null;
  readonly agora: Date;
  readonly justificativa: string;
  readonly prazoHoras?: number;
}): RecusaFinanceiro | null {
  if (x.situacao !== 'autorizada' || !x.autorizadaEm)
    return recusaFin('cancelar-situacao', 'Só a nota autorizada pode ser cancelada.', ['nota']);
  const j = x.justificativa.trim();
  if (j.length < 15 || j.length > 255)
    return recusaFin(
      'cancelar-justificativa',
      'A justificativa do cancelamento tem de 15 a 255 caracteres.',
      ['justificativa'],
    );
  const prazo = x.prazoHoras ?? PRAZO_CANCELAMENTO_NFE_HORAS;
  if (x.agora.getTime() - x.autorizadaEm.getTime() > prazo * 3_600_000)
    return recusaFin(
      'cancelar-prazo',
      `Passou o prazo de ${prazo} horas para cancelar; emita uma nota de entrada para anular a operação.`,
      ['nota'],
    );
  return null;
}

/** Texto obrigatório da condição de uso da carta de correção (leiaute nacional). */
export const CONDICAO_USO_CCE =
  'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';

export const LIMITE_CARTAS_CORRECAO = 20;

/** Confere a carta de correção e devolve a sequência dela (a última substitui as anteriores). */
export function conferirCartaCorrecao(x: {
  readonly situacao: string;
  readonly texto: string;
  readonly cartasAnteriores: number;
}):
  | { readonly ok: true; readonly sequencia: number }
  | { readonly ok: false; readonly recusa: RecusaFinanceiro } {
  const falha = (codigo: string, m: string, campo: string) => ({
    ok: false as const,
    recusa: recusaFin(codigo, m, [campo]),
  });
  if (x.situacao !== 'autorizada')
    return falha(
      'cce-situacao',
      'A carta de correção só vale para a nota autorizada (e não cancelada).',
      'nota',
    );
  const t = x.texto.trim();
  if (t.length < 15 || t.length > 1000)
    return falha('cce-texto', 'O texto da correção tem de 15 a 1.000 caracteres.', 'texto');
  if (x.cartasAnteriores >= LIMITE_CARTAS_CORRECAO)
    return falha('cce-limite', `A nota já tem ${LIMITE_CARTAS_CORRECAO} cartas de correção.`, 'texto');
  return { ok: true, sequencia: x.cartasAnteriores + 1 };
}

export interface RetornoSefaz {
  readonly codigo: string;
  readonly mensagem: string;
  readonly protocolo: string | null;
}

/** Protocolo do simulador: 15 dígitos estáveis pela chave e pelo tipo do pedido. */
function protocoloSimulado(chave: string, tipo: number): string {
  let h = tipo;
  for (const c of chave) h = (h * 31 + Number(c)) % 1_000_000_000;
  return `9${chave.slice(0, 2)}${chave.slice(2, 4)}${String(h).padStart(10, '0')}`.slice(0, 15);
}

/**
 * O simulador da Sefaz (fora de produção): autoriza (100) a nota assinada cuja assinatura confere e cujo XML traz a
 * chave; rejeita (297) a assinatura que não confere. Cancelamento e carta de correção: evento registrado (135).
 */
export function simularSefaz(
  pedido:
    | {
        readonly tipo: 'autorizacao';
        readonly xml: string;
        readonly chave: string;
        readonly assinaturaOk: boolean;
      }
    | {
        readonly tipo: 'cancelamento' | 'carta_correcao';
        readonly chave: string;
        readonly sequencia: number;
      },
): RetornoSefaz {
  if (pedido.tipo === 'autorizacao') {
    if (!pedido.assinaturaOk)
      return { codigo: '297', mensagem: 'Rejeição: assinatura difere do calculado', protocolo: null };
    if (!pedido.xml.includes(`Id="NFe${pedido.chave}"`) || !chaveNfeValida(pedido.chave))
      return { codigo: '502', mensagem: 'Rejeição: erro na chave de acesso', protocolo: null };
    return {
      codigo: '100',
      mensagem: 'Autorizado o uso da NF-e (simulador)',
      protocolo: protocoloSimulado(pedido.chave, 1),
    };
  }
  return {
    codigo: '135',
    mensagem: `Evento registrado e vinculado a NF-e (simulador, ${pedido.tipo})`,
    protocolo: protocoloSimulado(pedido.chave, pedido.tipo === 'cancelamento' ? 2 : 100 + pedido.sequencia),
  };
}

export interface DadosDanfe {
  readonly chave: string | null;
  readonly protocolo: string | null;
  readonly numero: number;
  readonly serie: string;
  readonly emissao: string;
  readonly natureza: string;
  readonly situacao: string;
  readonly emitente: string;
  readonly destinatario: string;
  readonly destinatarioDocumento: string;
  readonly homologacao: boolean;
  readonly itens: readonly {
    readonly codigo: string;
    readonly descricao: string;
    readonly ncm: string;
    readonly cfop: string;
    readonly unidade: string;
    readonly quantidade: number;
    readonly valorUnitario: number;
    readonly valorTotal: number;
  }[];
  readonly valorProdutos: number;
  readonly valorIcms: number;
  readonly valorIpi: number;
  readonly valorTotal: number;
  readonly informacaoComplementar: string | null;
}

/** O DANFE simplificado em HTML (tudo escapado), para imprimir. */
export function danfeHtml(d: DadosDanfe): string {
  const ch = d.chave ? d.chave.replace(/(\d{4})/g, '$1 ').trim() : 'sem chave';
  const aviso = d.homologacao
    ? '<p><strong>SEM VALOR FISCAL: emitida fora de produção.</strong></p>'
    : d.situacao === 'cancelada'
      ? '<p><strong>NF-e CANCELADA</strong></p>'
      : '';
  const linhas = d.itens
    .map(
      (i) =>
        `<tr><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td>${esc(i.ncm)}</td><td>${esc(i.cfop)}</td>` +
        `<td>${esc(i.unidade)}</td><td>${v4(i.quantidade)}</td><td>${v4(i.valorUnitario)}</td><td>${v2(i.valorTotal)}</td></tr>`,
    )
    .join('');
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>DANFE ${d.numero}</title></head><body>` +
    `<h1>DANFE: Documento Auxiliar da Nota Fiscal Eletrônica</h1>${aviso}` +
    `<p>NF-e nº ${d.numero} · série ${esc(d.serie)} · emissão ${esc(d.emissao)}</p>` +
    `<p>Chave de acesso: ${esc(ch)}</p><p>Protocolo de autorização: ${esc(d.protocolo ?? '—')}</p>` +
    `<p>Natureza da operação: ${esc(d.natureza)}</p><p>Emitente: ${esc(d.emitente)}</p>` +
    `<p>Destinatário: ${esc(d.destinatario)} (${esc(d.destinatarioDocumento)})</p>` +
    `<table><thead><tr><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>Un.</th><th>Qtd.</th><th>Valor un.</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table>` +
    `<p>Produtos ${v2(d.valorProdutos)} · ICMS ${v2(d.valorIcms)} · IPI ${v2(d.valorIpi)} · Total da nota ${v2(d.valorTotal)}</p>` +
    (d.informacaoComplementar ? `<p>Informações complementares: ${esc(d.informacaoComplementar)}</p>` : '') +
    '</body></html>'
  );
}
