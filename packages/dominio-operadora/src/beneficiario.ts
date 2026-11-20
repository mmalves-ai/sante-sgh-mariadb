// Beneficiário da operadora (M56.2, fatia F1; ficha, seções 6 e 8, regra 8): titular (vínculo 1, sem titular acima)
// e dependentes do mesmo contrato, com o CPF do titular e de todo maior de 18 anos (o cadastro de beneficiários da ANS
// pede), o nome da mãe, a adesão dentro da vigência do contrato e um titular só no contrato de pessoa física. A baixa
// pede o motivo do domínio e uma data a partir da adesão; a baixa do titular leva os dependentes ativos junto
// (D-BAIXA-56). A ligação com o paciente do hospital é só o ID (regra 8): nada do prontuário vem para cá.
import { VINCULO_TITULAR, type SituacaoBeneficiario, type SituacaoContrato } from '@sgh/contratos';
import { cnsValido, cpfValido } from './documentos.js';
import { idadeEm } from './plano.js';

export type ProblemaBeneficiario =
  | 'cpf-invalido'
  | 'cpf-obrigatorio'
  | 'cpf-repetido-no-contrato'
  | 'cns-invalido'
  | 'nascimento-futuro'
  | 'inclusao-antes-do-contrato'
  | 'inclusao-depois-do-fim'
  | 'contrato-inativo'
  | 'titular-com-titular'
  | 'dependente-sem-titular'
  | 'titular-de-outro-contrato'
  | 'titular-inativo'
  | 'titular-e-dependente'
  | 'contrato-pf-ja-tem-titular';

export interface BeneficiarioDeclarado {
  readonly id: number | null;
  readonly vinculo: number;
  readonly titular: number | null;
  readonly cpf: string | null;
  readonly cns: string | null;
  readonly nascimento: string;
  readonly inclusao: string;
}

export interface TitularVisto {
  readonly id: number;
  readonly contrato: number;
  readonly vinculo: number;
  readonly situacao: SituacaoBeneficiario;
}

export interface ContextoBeneficiario {
  readonly hoje: string;
  readonly contrato: {
    readonly id: number;
    readonly tipo: number;
    readonly situacao: SituacaoContrato;
    readonly inicio: string;
    readonly fim: string | null;
  };
  /** O titular informado, lido do banco (null quando não informado ou não existe). */
  readonly titular: TitularVisto | null;
  /** Outros titulares ativos do contrato (sem o próprio, na alteração). */
  readonly outrosTitularesAtivos: number;
  /** Outros beneficiários ativos do contrato com o mesmo CPF. */
  readonly cpfNoContrato: number;
}

/** Idade a partir da qual o CPF é exigido do dependente. */
export const IDADE_CPF_OBRIGATORIO = 18;

export function problemasDoBeneficiario(
  b: BeneficiarioDeclarado,
  x: ContextoBeneficiario,
): ProblemaBeneficiario[] {
  const p: ProblemaBeneficiario[] = [];
  const ehTitular = b.vinculo === VINCULO_TITULAR;
  if (b.cpf) {
    if (!cpfValido(b.cpf)) p.push('cpf-invalido');
    else if (x.cpfNoContrato > 0) p.push('cpf-repetido-no-contrato');
  } else if (ehTitular || (b.nascimento <= x.hoje && idadeEm(b.nascimento, x.hoje) >= IDADE_CPF_OBRIGATORIO))
    p.push('cpf-obrigatorio');
  if (b.cns && !cnsValido(b.cns)) p.push('cns-invalido');
  if (b.nascimento > x.hoje) p.push('nascimento-futuro');
  if (b.inclusao < x.contrato.inicio) p.push('inclusao-antes-do-contrato');
  if (x.contrato.fim && b.inclusao > x.contrato.fim) p.push('inclusao-depois-do-fim');
  if (b.id === null && x.contrato.situacao !== 'ativo') p.push('contrato-inativo');
  if (ehTitular) {
    if (b.titular !== null) p.push('titular-com-titular');
    if (x.contrato.tipo === 1 && x.outrosTitularesAtivos > 0) p.push('contrato-pf-ja-tem-titular');
  } else if (b.titular === null || x.titular === null) p.push('dependente-sem-titular');
  else {
    if (x.titular.contrato !== x.contrato.id) p.push('titular-de-outro-contrato');
    if (x.titular.vinculo !== VINCULO_TITULAR) p.push('titular-e-dependente');
    if (x.titular.situacao !== 'ativo') p.push('titular-inativo');
  }
  return p;
}

export type ProblemaBaixa = 'ja-excluido' | 'motivo-invalido' | 'data-antes-da-inclusao' | 'data-futura';

export function problemasDaBaixa(
  b: { readonly situacao: SituacaoBeneficiario; readonly inclusao: string },
  pedido: { readonly motivo: number; readonly data: string },
  x: { readonly motivosValidos: readonly number[]; readonly hoje: string },
): ProblemaBaixa[] {
  const p: ProblemaBaixa[] = [];
  if (b.situacao === 'excluido') p.push('ja-excluido');
  if (!x.motivosValidos.includes(pedido.motivo)) p.push('motivo-invalido');
  if (pedido.data < b.inclusao) p.push('data-antes-da-inclusao');
  if (pedido.data > x.hoje) p.push('data-futura');
  return p;
}

export type ProblemaReativacao = 'nao-excluido' | 'titular-inativo' | 'contrato-inativo';

/** Reativação: só do excluído, com o contrato ativo e, no dependente, o titular ativo. */
export function problemasDaReativacao(
  b: { readonly situacao: SituacaoBeneficiario; readonly vinculo: number },
  x: { readonly contratoAtivo: boolean; readonly titularAtivo: boolean },
): ProblemaReativacao[] {
  const p: ProblemaReativacao[] = [];
  if (b.situacao !== 'excluido') p.push('nao-excluido');
  if (!x.contratoAtivo) p.push('contrato-inativo');
  if (b.vinculo !== VINCULO_TITULAR && !x.titularAtivo) p.push('titular-inativo');
  return p;
}
