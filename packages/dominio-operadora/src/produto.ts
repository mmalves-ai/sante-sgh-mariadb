// Regra 2 do M56 (ficha, seção 8; cap-07 §7.4, Regras): cartão de desconto não é plano de saúde. Sem registro do
// produto na ANS não há plano: o escopo se reduz a cadastro, cobrança e regras de desconto no faturamento particular;
// rede credenciada como operadora, autorização, contas médicas e envios à ANS ficam fora. E a operadora é empresa
// distinta (regra 3): o registro da operadora na ANS é dela, não do hospital.
import type { NaturezaProduto, RecursoOperadora } from '@sgh/contratos';

/** Registro da operadora na ANS: 6 dígitos (com ou sem pontuação). */
export function registroOperadoraAnsValido(v: string): boolean {
  return /^\d{6}$/.test(v.replace(/[.\-/\s]/g, ''));
}

/** Registro do produto na ANS: 9 dígitos (forma usual 000.000/00-0). */
export function registroProdutoAnsValido(v: string): boolean {
  return /^\d{9}$/.test(v.replace(/[.\-/\s]/g, ''));
}

/** Só os dígitos do registro, para gravar e comparar. */
export function normalizarRegistroAns(v: string): string {
  return v.replace(/\D/g, '');
}

export interface ProdutoDeclarado {
  readonly natureza: NaturezaProduto;
  /** Registro do produto na ANS (obrigatório para plano; proibido para cartão de desconto). */
  readonly registroAns: string | null;
}

export type ProblemaProduto =
  'plano-sem-registro-ans' | 'registro-ans-invalido' | 'cartao-desconto-com-registro-ans';

/** Conferência do produto antes de gravar em SGH_OPE_PRODUTO (a mensagem da tela vem do código). */
export function problemasDoProduto(p: ProdutoDeclarado): ProblemaProduto[] {
  const r = p.registroAns?.trim() ?? '';
  if (p.natureza === 'cartaoDesconto') return r ? ['cartao-desconto-com-registro-ans'] : [];
  if (!r) return ['plano-sem-registro-ans'];
  return registroProdutoAnsValido(r) ? [] : ['registro-ans-invalido'];
}

/** Fatias que valem para a natureza do produto (o cartão de desconto não usa as de plano). */
const FATIAS_CARTAO: readonly RecursoOperadora[] = ['beneficiarios', 'cobranca', 'mensagens', 'atendimento'];

export function fatiaValeParaNatureza(recurso: RecursoOperadora, natureza: NaturezaProduto): boolean {
  return natureza === 'plano' || FATIAS_CARTAO.includes(recurso);
}
