// Regras puras da cobertura pelo rol e da negativa formal na autorização de guias da operadora (C2-122):
//   - as regras de cobertura do rol cadastradas pela operadora por procedimento (regra_cobertura_rol): sexo e faixa de
//     idade permitidos, a quantidade máxima por solicitação, a diretriz de utilização a conferir (DUT, RN 465/2021,
//     anexo II), o procedimento fora do rol (aviso: o rol é a referência básica, Lei 14.454/2022) e a exigência de
//     junta ou perícia; viram críticas automáticas do pedido, gravadas por pedido;
//   - o catálogo das críticas automáticas (código e classe), o mesmo que a migração semeia em critica_autorizacao;
//   - a negativa de cobertura formal (RN 395/2016): o fundamento (carência, cobertura parcial temporária, fora do rol,
//     norma regulatória ou cláusula do contrato) a partir das críticas e do fundamento escrito pelo auditor, e o número
//     da negativa pelo número da guia.
import type { CriticaAutomatica, SituacaoAutorizacao } from '@sgh/contratos';
import { CRITICA_DOMINIO } from './autorizacao.js';

/** A regra de cobertura do rol de um procedimento, vigente na data (null nos limites: sem limite). */
export interface RegraCoberturaRol {
  readonly codigo: string;
  readonly noRol: boolean;
  readonly diretriz: string | null;
  readonly exigeJunta: boolean;
  readonly exigePericia: boolean;
  readonly sexoPermitido: 'feminino' | 'masculino' | null;
  readonly idadeMinima: number | null;
  readonly idadeMaxima: number | null;
  readonly quantidadeMaximaSolicitacao: number | null;
}

export interface ContextoRol {
  /** Sigla do sexo do beneficiário (F, M; outra ou vazia: não confere o sexo). */
  readonly sexo: string;
  /** Data de nascimento AAAA-MM-DD (vazia: não confere a idade). */
  readonly nascimento: string;
  readonly hoje: string;
  readonly itens: readonly { readonly codigo: string; readonly quantidade: number }[];
}

/** O catálogo das críticas automáticas: o código gravado por pedido e a classe do cadastro de críticas. */
export const CRITICAS_AUTOMATICAS_CATALOGO: Readonly<Record<string, { classe: string; descricao: string }>> =
  {
    'beneficiario-inelegivel': { classe: 'elegibilidade', descricao: 'Beneficiário inelegível na data' },
    'produto-nao-e-plano': { classe: 'cobertura', descricao: 'Produto não é plano de saúde' },
    'fora-da-segmentacao': { classe: 'cobertura', descricao: 'Fora da segmentação assistencial do plano' },
    'obstetricia-a-conferir': {
      classe: 'cobertura',
      descricao: 'Cobertura obstétrica a conferir no contrato',
    },
    'em-carencia': { classe: 'carencia', descricao: 'Beneficiário em carência' },
    'urgencia-em-carencia': { classe: 'carencia', descricao: 'Urgência com internação em carência' },
    'cpt-vigente': { classe: 'preexistencia', descricao: 'Cobertura parcial temporária vigente' },
    'prestador-fora-da-rede': { classe: 'rede', descricao: 'Prestador fora da rede credenciada' },
    'prestador-sem-regime': { classe: 'rede', descricao: 'Prestador sem o regime do atendimento' },
    'rol-sexo-nao-permitido': { classe: 'cobertura', descricao: 'Procedimento não indicado para o sexo' },
    'rol-idade-fora-da-faixa': { classe: 'cobertura', descricao: 'Idade fora da faixa da regra do rol' },
    'rol-quantidade-acima': { classe: 'limite', descricao: 'Quantidade acima do máximo por solicitação' },
    'rol-diretriz-a-conferir': { classe: 'cobertura', descricao: 'Diretriz de utilização a conferir' },
    'rol-fora-do-rol': { classe: 'cobertura', descricao: 'Procedimento fora do rol da ANS' },
    'rol-exige-junta': { classe: 'outra', descricao: 'Procedimento exige junta médica' },
    'rol-exige-pericia': { classe: 'outra', descricao: 'Procedimento exige perícia' },
  };

const MENSAGEM_ROL: Readonly<Record<string, string>> = {
  'rol-sexo-nao-permitido': 'O procedimento {c} não é coberto para o sexo do beneficiário.',
  'rol-idade-fora-da-faixa': 'A idade do beneficiário está fora da faixa da regra do procedimento {c}.',
  'rol-quantidade-acima': 'A quantidade pedida do procedimento {c} passa do máximo por solicitação.',
  'rol-diretriz-a-conferir': 'Confira a diretriz de utilização do procedimento {c}: {d}.',
  'rol-fora-do-rol': 'O procedimento {c} não está no rol da ANS: avalie a cobertura pela evidência.',
  'rol-exige-junta': 'O procedimento {c} exige junta médica.',
  'rol-exige-pericia': 'O procedimento {c} exige perícia.',
};

/** Idade em anos completos na data. */
export function idadeNaData(nascimento: string, hoje: string): number {
  const [an, mn, dn] = nascimento.slice(0, 10).split('-').map(Number);
  const [ah, mh, dh] = hoje.slice(0, 10).split('-').map(Number);
  return ah! - an! - (mh! < mn! || (mh === mn && dh! < dn!) ? 1 : 0);
}

const sexoDaSigla = (s: string): 'feminino' | 'masculino' | null =>
  /^f/i.test(s) ? 'feminino' : /^m/i.test(s) ? 'masculino' : null;

/**
 * As críticas da regra do rol por procedimento do pedido: o sexo, a idade e a quantidade bloqueiam (a regra cadastrada
 * diz que não cobre); a diretriz, o fora do rol, a junta e a perícia avisam o auditor. Item sem regra: nada.
 */
export function criticasDaRegraRol(
  regras: readonly RegraCoberturaRol[],
  x: ContextoRol,
): CriticaAutomatica[] {
  const r: CriticaAutomatica[] = [];
  const porCodigo = new Map(regras.map((g) => [g.codigo, g]));
  const sexo = sexoDaSigla(x.sexo);
  const idade = /^\d{4}-\d{2}-\d{2}/.test(x.nascimento) ? idadeNaData(x.nascimento, x.hoje) : null;
  const add = (codigo: string, bloqueia: boolean, dominio: number, item: string, diretriz = '') =>
    r.push({
      codigo,
      bloqueia,
      critica: dominio,
      texto: (MENSAGEM_ROL[codigo] ?? codigo).replace('{c}', item).replace('{d}', diretriz),
    });
  for (const i of x.itens) {
    const g = porCodigo.get(i.codigo);
    if (!g) continue;
    if (g.sexoPermitido && sexo && g.sexoPermitido !== sexo)
      add('rol-sexo-nao-permitido', true, CRITICA_DOMINIO.cobertura, i.codigo);
    if (
      idade !== null &&
      ((g.idadeMinima !== null && idade < g.idadeMinima) || (g.idadeMaxima !== null && idade > g.idadeMaxima))
    )
      add('rol-idade-fora-da-faixa', true, CRITICA_DOMINIO.cobertura, i.codigo);
    if (g.quantidadeMaximaSolicitacao !== null && i.quantidade > g.quantidadeMaximaSolicitacao)
      add('rol-quantidade-acima', true, CRITICA_DOMINIO.quantidade, i.codigo);
    if (!g.noRol) add('rol-fora-do-rol', false, CRITICA_DOMINIO.cobertura, i.codigo);
    if (g.diretriz) add('rol-diretriz-a-conferir', false, CRITICA_DOMINIO.cobertura, i.codigo, g.diretriz);
    if (g.exigeJunta) add('rol-exige-junta', false, CRITICA_DOMINIO.cobertura, i.codigo);
    if (g.exigePericia) add('rol-exige-pericia', false, CRITICA_DOMINIO.cobertura, i.codigo);
  }
  return r;
}

// ── Negativa de cobertura (RN 395/2016) ─────────────────────────────────────────────────────────

export type FundamentoNegativa =
  | 'clausula_contratual'
  | 'norma_regulatoria'
  | 'carencia'
  | 'cobertura_parcial_temporaria'
  | 'fora_rol'
  | 'fora_abrangencia'
  | 'documentacao'
  | 'outro';

export interface NegativaParaRegistro {
  readonly numero: string;
  readonly fundamento: FundamentoNegativa;
  readonly clausula: string | null;
  readonly descricao: string;
}

const NORMA = /\b(lei|rn|resolu[cç][aã]o|decreto|art\.?|artigo|in)\b/i;

/**
 * A negativa formal a registrar na decisão negada ou parcial (null nas demais): o fundamento pela crítica que pesou
 * (carência, cobertura parcial temporária, fora do rol), senão pelo texto do auditor (dispositivo legal ou cláusula do
 * contrato); a cláusula guarda o texto do fundamento; a descrição é o comunicado ao beneficiário.
 */
export function negativaParaRegistro(x: {
  readonly situacao: SituacaoAutorizacao;
  readonly numeroGuia: string;
  readonly criticas: readonly string[];
  readonly fundamento: string | null;
  readonly comunicado: string | null;
}): NegativaParaRegistro | null {
  if (x.situacao !== 'negada' && x.situacao !== 'parcial') return null;
  const tem = (c: string) => x.criticas.includes(c);
  const texto = (x.fundamento ?? '').trim();
  const fundamento: FundamentoNegativa =
    tem('em-carencia') || tem('urgencia-em-carencia')
      ? 'carencia'
      : tem('cpt-vigente')
        ? 'cobertura_parcial_temporaria'
        : tem('rol-fora-do-rol')
          ? 'fora_rol'
          : NORMA.test(texto)
            ? 'norma_regulatoria'
            : texto
              ? 'clausula_contratual'
              : 'outro';
  return {
    numero: `NEG-${x.numeroGuia}`.slice(0, 30),
    fundamento,
    clausula: texto ? texto.slice(0, 100) : null,
    descricao: x.comunicado ?? (texto || 'Negativa de cobertura.'),
  };
}
