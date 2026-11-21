// Regra 17 do M32 (cap-06b §6.8, Fiscal e Nota): a NFS-e por fatura, na apresentação ou no recebimento conforme o
// contrato, com o ISS (alíquota de 2% a 5%, retido ou não) e a transição da reforma tributária: IBS e CBS destacados
// (alíquotas de teste de 2026: CBS 0,9% e IBS 0,1%; a classificação tributária e o de-para do imposto). Emissão
// real só depois da DP-38; fora de produção, o simulador da prefeitura responde e nada sai.
import { centavos, recusaFin, type RecusaFinanceiro } from '@sgh/contratos/regras-financeiro';

export const ALIQUOTA_CBS_2026 = 0.009;
export const ALIQUOTA_IBS_2026 = 0.001;

export interface PedidoNfse {
  readonly valorServicos: number;
  /** Alíquota do ISS em % (2 a 5; 0 só com imunidade). */
  readonly aliquotaIss: number;
  readonly issRetido: boolean;
  readonly retencoes: { ir: number; pis: number; cofins: number; csll: number; inss: number };
  readonly momento: 'apresentacao' | 'recebimento';
  readonly classificacao: string;
}

export interface NfseCalculada {
  readonly baseCalculo: number;
  readonly valorIss: number;
  readonly issRetido: boolean;
  readonly valorCbs: number;
  readonly valorIbs: number;
  readonly retencoesFederais: number;
  /** O líquido do tomador: serviços − ISS retido − retenções federais (IBS e CBS destacados, não descontados em 2026). */
  readonly valorLiquido: number;
}

export function conferirNfse(p: PedidoNfse): RecusaFinanceiro | null {
  if (!(p.valorServicos > 0))
    return recusaFin('valor-obrigatorio', 'Informe o valor dos serviços.', ['valorServicos']);
  if (p.aliquotaIss !== 0 && (p.aliquotaIss < 2 || p.aliquotaIss > 5))
    return recusaFin('aliquota-iss', 'A alíquota do ISS vai de 2% a 5%.', ['aliquotaIss']);
  if (!p.classificacao.trim())
    return recusaFin('classificacao-obrigatoria', 'Informe a classificação tributária do serviço.', [
      'classificacao',
    ]);
  const ret = Object.values(p.retencoes).reduce((s, v) => s + v, 0);
  if (ret >= p.valorServicos)
    return recusaFin('retencoes-acima', 'As retenções passam do valor dos serviços.', ['retencoes']);
  return null;
}

export function calcularNfse(p: PedidoNfse): NfseCalculada {
  const base = centavos(p.valorServicos);
  const iss = centavos((base * p.aliquotaIss) / 100);
  const fed = centavos(
    p.retencoes.ir + p.retencoes.pis + p.retencoes.cofins + p.retencoes.csll + p.retencoes.inss,
  );
  return {
    baseCalculo: base,
    valorIss: iss,
    issRetido: p.issRetido,
    valorCbs: centavos(base * ALIQUOTA_CBS_2026),
    valorIbs: centavos(base * ALIQUOTA_IBS_2026),
    retencoesFederais: fed,
    valorLiquido: centavos(base - (p.issRetido ? iss : 0) - fed),
  };
}

/** Destino da emissão: a prefeitura só em produção e com a DP-38 respondida; senão, o simulador. */
export function destinoNfse(ambiente: string, dp38Respondida: boolean): 'simulador' | 'prefeitura' {
  return ambiente === 'producao' && dp38Respondida ? 'prefeitura' : 'simulador';
}

/** O XML da NFS-e (leiaute nacional simplificado; o do provedor municipal entra com a DP-38). */
export function xmlNfse(
  d: NfseCalculada & { numeroRps: string; tomador: string; itemServico: string },
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<NFSe versao="1.00">',
    `<infNFSe><rps>${esc(d.numeroRps)}</rps><tomador>${esc(d.tomador)}</tomador><itemServico>${esc(d.itemServico)}</itemServico>`,
    `<valores><vServ>${d.baseCalculo.toFixed(2)}</vServ><vISS>${d.valorIss.toFixed(2)}</vISS><issRetido>${d.issRetido ? 1 : 2}</issRetido>`,
    `<vCBS>${d.valorCbs.toFixed(2)}</vCBS><vIBS>${d.valorIbs.toFixed(2)}</vIBS><vRetFed>${d.retencoesFederais.toFixed(2)}</vRetFed><vLiq>${d.valorLiquido.toFixed(2)}</vLiq></valores>`,
    '</infNFSe></NFSe>',
  ].join('');
}

/** A resposta do simulador da prefeitura (fora de produção): autoriza com número sintético. */
export function simularPrefeitura(xml: string, sequencial: number): { situacao: 'simulada'; numero: string } {
  if (!xml.includes('<NFSe')) throw new Error('XML de NFS-e inválido para o simulador.');
  return { situacao: 'simulada', numero: `SIM${String(sequencial).padStart(9, '0')}` };
}
