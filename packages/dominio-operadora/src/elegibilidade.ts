// Elegibilidade pela carteirinha (M56.2, fatia F1; ficha, seção 4, "Beneficiário e elegibilidade": 1 linha por
// carteirinha, p95 < 300 ms): o beneficiário ativo, de contrato ativo e na vigência, de produto não cancelado, na data
// do atendimento a partir da adesão. As carências não tornam inelegível: a resposta diz até quando cada uma corre (a
// cobertura de cada procedimento é da autorização, fatia F4). O cartão de desconto não tem carência.
import type {
  CarenciaSituacao,
  CarenciasProduto,
  MotivoInelegibilidade,
  SituacaoBeneficiario,
  SituacaoContrato,
  SituacaoProduto,
} from '@sgh/contratos';
import { carteirinhaValida, somarDias, somarMeses } from './carteirinha.js';
import { contratoVigente } from './contrato.js';

export interface DadosElegibilidade {
  readonly beneficiario: { readonly situacao: SituacaoBeneficiario; readonly inclusao: string };
  readonly contrato: {
    readonly situacao: SituacaoContrato;
    readonly inicio: string;
    readonly fim: string | null;
  };
  readonly produto: {
    readonly situacao: SituacaoProduto;
    readonly natureza: 'plano' | 'cartaoDesconto';
    readonly carencias: CarenciasProduto;
  };
}

export interface ResultadoElegibilidade {
  readonly elegivel: boolean;
  readonly motivos: MotivoInelegibilidade[];
  readonly carencias: CarenciaSituacao[];
}

/** As carências do produto contadas da adesão, com a situação na data. */
export function carenciasNaData(
  carencias: CarenciasProduto,
  inclusao: string,
  data: string,
): CarenciaSituacao[] {
  const em = (tipo: CarenciaSituacao['tipo']) =>
    tipo === 'cpt' ? somarMeses(inclusao, carencias.cpt) : somarDias(inclusao, carencias[tipo]);
  return (['urgencia', 'partos', 'demais', 'cpt'] as const)
    .filter((t) => carencias[t] > 0)
    .map((tipo) => {
      const cumpridaEm = em(tipo);
      return { tipo, cumpridaEm, cumprida: cumpridaEm <= data };
    });
}

export function avaliarElegibilidade(
  carteirinha: string,
  dados: DadosElegibilidade | null,
  data: string,
): ResultadoElegibilidade {
  if (!carteirinhaValida(carteirinha))
    return { elegivel: false, motivos: ['carteirinha-invalida'], carencias: [] };
  if (!dados) return { elegivel: false, motivos: ['nao-encontrado'], carencias: [] };
  const m: MotivoInelegibilidade[] = [];
  const { beneficiario: b, contrato: c, produto: p } = dados;
  if (b.situacao === 'suspenso') m.push('beneficiario-suspenso');
  if (b.situacao === 'excluido') m.push('beneficiario-excluido');
  if (c.situacao !== 'ativo') m.push('contrato-inativo');
  else if (!contratoVigente(c, data)) m.push('contrato-fora-da-vigencia');
  if (p.situacao === 'cancelado') m.push('produto-cancelado');
  if (data < b.inclusao) m.push('antes-da-inclusao');
  const carencias = p.natureza === 'plano' ? carenciasNaData(p.carencias, b.inclusao, data) : [];
  return { elegivel: m.length === 0, motivos: m, carencias };
}
