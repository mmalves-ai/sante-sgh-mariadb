// Textos das recusas da fatia F1 da operadora própria (M56.2): cada código das regras puras de @sgh/dominio-operadora
// tem a sua frase em português (o tsc recusa código sem texto). Sem nome de tabela nem de sistema antigo (ADR 0023).
import type {
  ProblemaBaixa,
  ProblemaBeneficiario,
  ProblemaCarteirinha,
  ProblemaContrato,
  ProblemaOperadoraEmpresa,
  ProblemaPlano,
  ProblemaReativacao,
} from '@sgh/dominio-operadora';
import { ErroProblema } from '../../../problema.filter.js';

export const MENSAGENS_OPERADORA_EMPRESA: Record<ProblemaOperadoraEmpresa, string> = {
  'registro-operadora-invalido': 'O registro da operadora na ANS tem 6 dígitos.',
  'cnpj-invalido': 'O CNPJ da operadora não confere (dígito verificador).',
};

export const MENSAGENS_PLANO: Record<ProblemaPlano, string> = {
  'plano-sem-registro-ans': 'Plano de saúde precisa do número de registro do produto na ANS.',
  'registro-ans-invalido': 'O registro do produto na ANS tem 9 dígitos.',
  'cartao-desconto-com-registro-ans': 'Cartão de desconto não é plano de saúde: não tem registro na ANS.',
  'segmentacao-obrigatoria': 'Informe a segmentação assistencial do plano.',
  'abrangencia-obrigatoria': 'Informe a abrangência geográfica do plano.',
  'acomodacao-obrigatoria': 'Plano com internação precisa da acomodação (apartamento ou enfermaria).',
  'acomodacao-sem-internacao': 'Plano sem internação não tem acomodação de apartamento ou enfermaria.',
  'cartao-desconto-com-cobertura':
    'Cartão de desconto não tem segmentação, acomodação nem carência: ele não é plano de saúde.',
  'coparticipacao-sem-valor': 'Informe o percentual ou o valor da coparticipação.',
  'coparticipacao-percentual-invalido': 'O percentual de coparticipação vai de 0 a 100.',
  'carencia-acima-do-limite':
    'Carência acima do limite da lei: urgência até 1 dia, partos até 300 dias, demais casos até 180 dias e cobertura parcial temporária até 24 meses.',
  'precos-obrigatorios': 'Informe o preço de cada uma das 10 faixas etárias.',
  'preco-zero': 'O preço da primeira faixa etária precisa ser maior que zero.',
  'precos-decrescentes': 'O preço de uma faixa etária não pode ser menor que o da faixa anterior.',
  'precos-ultima-acima-de-seis-vezes':
    'O preço da última faixa etária não pode passar de 6 vezes o da primeira (regra da ANS).',
  'precos-variacao-final-maior':
    'A variação entre a 7ª e a 10ª faixas não pode ser maior que a variação entre a 1ª e a 7ª (regra da ANS).',
  'produto-em-uso':
    'O produto tem contratos em uso: a natureza, o tipo de contratação e o registro na ANS não mudam. Para outro plano, cadastre um produto novo.',
};

export const MENSAGENS_CONTRATO: Record<ProblemaContrato, string> = {
  'documento-pf-invalido': 'Contrato de pessoa física precisa do CPF válido do contratante.',
  'documento-pj-invalido': 'Contrato de pessoa jurídica precisa do CNPJ válido do contratante.',
  'contratacao-incompativel':
    'O tipo do contrato não combina com o produto: pessoa física só em produto individual ou familiar; pessoa jurídica só em produto coletivo.',
  'produto-inativo': 'O produto está com a comercialização suspensa ou cancelado: não aceita contrato novo.',
  'vigencia-sem-fim': 'Contrato de prazo determinado precisa da data de fim.',
  'fim-antes-do-inicio': 'O fim da vigência não pode ser antes do início.',
  'dia-vencimento-nao-permitido': 'Este dia de vencimento não está entre os permitidos.',
  'situacao-sem-motivo': 'Informe o motivo da suspensão ou do encerramento do contrato.',
  'encerrado-com-beneficiarios-ativos':
    'O contrato tem beneficiários ativos: faça a baixa deles antes de encerrar o contrato.',
  'produto-com-beneficiarios':
    'O contrato tem beneficiários: o produto não muda. Mudança de plano é a exclusão do beneficiário e a nova adesão no outro contrato.',
  'tipo-com-beneficiarios':
    'O contrato tem beneficiários: o tipo (pessoa física ou jurídica) não muda. Faça a baixa deles e um contrato novo.',
};

export const MENSAGENS_BENEFICIARIO: Record<ProblemaBeneficiario, string> = {
  'cpf-invalido': 'O CPF não confere (dígito verificador).',
  'cpf-obrigatorio': 'O CPF é obrigatório para o titular e para todo beneficiário com 18 anos ou mais.',
  'cpf-repetido-no-contrato': 'Já existe beneficiário ativo com este CPF no contrato.',
  'cns-invalido': 'O número do Cartão Nacional de Saúde não confere.',
  'nascimento-futuro': 'A data de nascimento não pode ser no futuro.',
  'inclusao-antes-do-contrato': 'A adesão não pode ser antes do início do contrato.',
  'inclusao-depois-do-fim': 'A adesão não pode ser depois do fim do contrato.',
  'contrato-inativo': 'O contrato está suspenso ou encerrado: não aceita beneficiário novo.',
  'titular-com-titular': 'O titular não tem outro titular acima dele.',
  'dependente-sem-titular': 'O dependente precisa do titular do mesmo contrato.',
  'titular-de-outro-contrato': 'O titular informado é de outro contrato.',
  'titular-inativo': 'O titular informado não está ativo.',
  'titular-e-dependente': 'O beneficiário informado como titular é dependente de outro.',
  'contrato-pf-ja-tem-titular': 'Contrato de pessoa física tem um titular só.',
};

export const MENSAGENS_BAIXA: Record<ProblemaBaixa, string> = {
  'ja-excluido': 'O beneficiário já foi excluído.',
  'motivo-invalido': 'Escolha um motivo de exclusão da lista.',
  'data-antes-da-inclusao': 'A data da exclusão não pode ser antes da adesão.',
  'data-futura': 'A data da exclusão não pode ser no futuro.',
};

export const MENSAGENS_REATIVACAO: Record<ProblemaReativacao, string> = {
  'nao-excluido': 'Só o beneficiário excluído pode ser reativado.',
  'titular-inativo': 'Reative o titular antes do dependente.',
  'contrato-inativo': 'O contrato está suspenso ou encerrado: reative o contrato antes.',
};

export const MENSAGENS_CARTEIRINHA: Record<ProblemaCarteirinha, string> = {
  'beneficiario-inativo': 'Só o beneficiário ativo recebe via nova da carteirinha.',
  'segunda-via-sem-motivo': 'Escolha o motivo da segunda via.',
  'motivo-invalido': 'Escolha um motivo de segunda via da lista.',
  'primeira-via-ja-emitida': 'A primeira via não tem motivo.',
};

/** Recusa de negócio (422) com os códigos e as frases; nada é gravado. */
export function recusarSeHouver<C extends string>(
  problemas: readonly C[],
  mensagens: Record<C, string>,
  titulo: string,
): void {
  if (problemas.length === 0) return;
  throw new ErroProblema('recusa-de-negocio', 422, titulo, problemas.map((p) => mensagens[p]).join(' '), {
    codigo: problemas[0] as string,
    bloqueios: [...problemas],
  });
}
