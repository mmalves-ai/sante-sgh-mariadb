// Correspondências entre o cadastro do Sante SGH (a ficha do eSocial e a modalidade da rescisão) e os códigos dos
// leiautes das obrigações anteriores ao eSocial (M53-F7). Os códigos são os dos catálogos oficiais que o banco já
// tem (categorias e movimentações da SEFIP, do CAGED e da RAIS, lidos onde
// estão): a geração confere cada código usado contra o catálogo e recusa o que não estiver nele
// (`codigo-fora-do-catalogo`). Código sem correspondência gera a pendência `categoria-sem-correspondencia`.
//
// D-CORRESP-538 (POL-5): sem a informação de "primeiro emprego" no cadastro, a admissão vai como reemprego (CAGED 20,
// RAIS 2), salvo o contrato a prazo (CAGED 25) e a transferência (CAGED 70, RAIS 3); a rescisão indireta vai como
// dispensa sem justa causa na SEFIP (I1) e no CAGED (31), que não têm código próprio, e como 20 na RAIS.
import type { FichaEsocialVinculo, ModalidadeRescisao } from '@sgh/contratos';

/** Categoria do eSocial (tabela 1) → categoria da SEFIP. */
export const CATEGORIA_SEFIP: Readonly<Record<string, string>> = {
  '101': '01',
  '103': '07',
  '105': '04',
  '106': '01',
  '111': '01',
  '721': '05',
  '722': '11',
  '701': '13',
};

/** Modalidade da rescisão → código de movimentação da SEFIP. */
export const MOVIMENTACAO_SEFIP: Readonly<Record<ModalidadeRescisao, string>> = {
  'sem-justa-causa': 'I1',
  'justa-causa': 'H',
  'pedido-demissao': 'J',
  acordo: 'I5',
  'termino-contrato': 'I3',
  'antecipada-empregador': 'I1',
  'antecipada-empregado': 'J',
  'culpa-reciproca': 'I2',
  'rescisao-indireta': 'I1',
  falecimento: 'S2',
};

/** Modalidade da rescisão → tipo de movimento de desligamento do CAGED. */
export const DESLIGAMENTO_CAGED: Readonly<Record<ModalidadeRescisao, string>> = {
  'sem-justa-causa': '31',
  'justa-causa': '32',
  'pedido-demissao': '40',
  acordo: '90',
  'termino-contrato': '43',
  'antecipada-empregador': '31',
  'antecipada-empregado': '40',
  'culpa-reciproca': '31',
  'rescisao-indireta': '31',
  falecimento: '60',
};

/** Modalidade da rescisão → causa do desligamento da RAIS. */
export const DESLIGAMENTO_RAIS: Readonly<Record<ModalidadeRescisao, string>> = {
  'sem-justa-causa': '11',
  'justa-causa': '10',
  'pedido-demissao': '21',
  acordo: '90',
  'termino-contrato': '12',
  'antecipada-empregador': '11',
  'antecipada-empregado': '21',
  'culpa-reciproca': '11',
  'rescisao-indireta': '20',
  falecimento: '60',
};

/** Tipo de admissão do eSocial (tpAdmissao) que é transferência (do grupo, sucessão, incorporação). */
const TRANSFERENCIA = [2, 3, 4, 6];

/** Tipo de movimento de admissão do CAGED. */
export function admissaoCaged(f: Pick<FichaEsocialVinculo, 'tipoAdmissao' | 'tipoContrato'>): string {
  if (TRANSFERENCIA.includes(f.tipoAdmissao)) return '70';
  if (f.tipoContrato !== 1) return '25';
  return '20';
}

/** Tipo de admissão da RAIS. */
export const admissaoRais = (f: Pick<FichaEsocialVinculo, 'tipoAdmissao'>): string =>
  TRANSFERENCIA.includes(f.tipoAdmissao) ? '3' : '2';

/** Vínculo empregatício da RAIS pela categoria e pelo tipo de contrato. */
export function vinculoRais(f: Pick<FichaEsocialVinculo, 'categoria' | 'tipoContrato'>): string | null {
  switch (f.categoria) {
    case '101':
    case '111':
      return f.tipoContrato === 1 ? '10' : '60';
    case '103':
      return '55';
    case '105':
      return '90';
    case '106':
      return '50';
    default:
      return null;
  }
}

/** Grau de instrução do eSocial (01 a 12) → CAGED e RAIS (1 a 11): a pós-graduação vai como superior completo. */
export function instrucaoRaisCaged(g: string): string {
  const n = Number(g);
  if (n <= 9) return String(n);
  return n === 10 ? '9' : String(n - 1);
}

/** Raça e cor do eSocial (1 branca, 2 preta, 3 parda, 4 amarela, 5 indígena, 6 não informado) → CAGED e RAIS. */
export const RACA_COR_RAIS_CAGED: Readonly<Record<number, string>> = {
  1: '2',
  2: '4',
  3: '8',
  4: '6',
  5: '1',
  6: '9',
};

export const sexoRaisCaged = (s: 'M' | 'F'): string => (s === 'M' ? '1' : '2');

/** O CBO no leiaute: 6 dígitos (o do cargo, senão o da função). */
export const cboDaFicha = (f: Pick<FichaEsocialVinculo, 'cboCargo' | 'cboFuncao'>): string | null =>
  f.cboCargo ?? f.cboFuncao ?? null;
