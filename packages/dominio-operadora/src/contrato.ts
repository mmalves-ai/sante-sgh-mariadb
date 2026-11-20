// Contrato da operadora (M56.2, fatia F1; ficha, seção 6): pessoa física (individual ou familiar) com CPF ou pessoa
// jurídica (coletivo empresarial ou por adesão) com CNPJ, no tipo de contratação do produto, com a forma e o mês do
// reajuste, a vigência (prazo determinado tem fim) e o dia de vencimento entre os permitidos. Encerrar ou suspender pede
// o motivo, e o contrato com beneficiário ativo não se encerra (a baixa deles vem antes). Contrato com beneficiário não
// excluído não troca de produto nem de tipo (D-BAIXA-56: mudança de plano é exclusão e nova adesão, com o movimento que
// vai ao SIB; e D-PF-TITULAR-56: um coletivo com vários titulares não vira contrato de pessoa física).
import type { SituacaoContrato, SituacaoProduto } from '@sgh/contratos';
import { cnpjValido, cpfValido } from './documentos.js';

export type ProblemaContrato =
  | 'documento-pf-invalido'
  | 'documento-pj-invalido'
  | 'contratacao-incompativel'
  | 'produto-inativo'
  | 'vigencia-sem-fim'
  | 'fim-antes-do-inicio'
  | 'dia-vencimento-nao-permitido'
  | 'situacao-sem-motivo'
  | 'encerrado-com-beneficiarios-ativos'
  | 'produto-com-beneficiarios'
  | 'tipo-com-beneficiarios';

export interface ContratoDeclarado {
  /** 1 pessoa física, 2 pessoa jurídica. */
  readonly tipo: number;
  readonly contratanteDocumento: string;
  readonly tipoVigencia: number;
  readonly inicio: string;
  readonly fim: string | null;
  readonly diaVencimento: number | null;
  readonly situacao: SituacaoContrato;
  readonly motivoSituacao: string | null;
}

export interface ContextoContrato {
  /** Tipo de contratação do produto (1 individual ou familiar, 2 coletivo empresarial, 3 coletivo por adesão). */
  readonly tipoContratacaoProduto: number;
  readonly situacaoProduto: SituacaoProduto;
  /** Inclusão (true) ou alteração (false): produto suspenso ou cancelado só recusa contrato novo. */
  readonly novo: boolean;
  /** Dias de vencimento permitidos no domínio (vazio: qualquer dia de 1 a 28). */
  readonly diasPermitidos: readonly number[];
  readonly beneficiariosAtivos: number;
  /** O produto escolhido no formulário. */
  readonly produto: number;
  /** Na alteração: o produto e o tipo gravados (null na inclusão). */
  readonly anterior: { readonly produto: number; readonly tipo: number } | null;
  /** Beneficiários não excluídos do contrato (ativos e suspensos): com algum, produto e tipo não mudam. */
  readonly beneficiariosVinculados: number;
}

/** Dia de vencimento sem domínio marcado: de 1 a 28 (todo mês tem). */
const DIA_MAXIMO_PADRAO = 28;

export function problemasDoContrato(c: ContratoDeclarado, x: ContextoContrato): ProblemaContrato[] {
  const p: ProblemaContrato[] = [];
  if (c.tipo === 1 && !cpfValido(c.contratanteDocumento)) p.push('documento-pf-invalido');
  if (c.tipo === 2 && !cnpjValido(c.contratanteDocumento)) p.push('documento-pj-invalido');
  const compativel = c.tipo === 1 ? x.tipoContratacaoProduto === 1 : x.tipoContratacaoProduto !== 1;
  if (!compativel) p.push('contratacao-incompativel');
  if (x.novo && x.situacaoProduto !== 'ativo') p.push('produto-inativo');
  if (c.tipoVigencia === 1 && !c.fim) p.push('vigencia-sem-fim');
  if (c.fim && c.fim < c.inicio) p.push('fim-antes-do-inicio');
  if (c.diaVencimento !== null) {
    const ok =
      x.diasPermitidos.length > 0
        ? x.diasPermitidos.includes(c.diaVencimento)
        : c.diaVencimento >= 1 && c.diaVencimento <= DIA_MAXIMO_PADRAO;
    if (!ok) p.push('dia-vencimento-nao-permitido');
  }
  if (c.situacao !== 'ativo' && !c.motivoSituacao?.trim()) p.push('situacao-sem-motivo');
  if (c.situacao === 'encerrado' && x.beneficiariosAtivos > 0) p.push('encerrado-com-beneficiarios-ativos');
  if (x.anterior && x.beneficiariosVinculados > 0) {
    if (x.anterior.produto !== x.produto) p.push('produto-com-beneficiarios');
    if (x.anterior.tipo !== c.tipo) p.push('tipo-com-beneficiarios');
  }
  return p;
}

/** O contrato vale na data (ativo e dentro da vigência)? */
export function contratoVigente(
  c: { readonly situacao: SituacaoContrato; readonly inicio: string; readonly fim: string | null },
  data: string,
): boolean {
  return c.situacao === 'ativo' && c.inicio <= data && (c.fim === null || c.fim >= data);
}
