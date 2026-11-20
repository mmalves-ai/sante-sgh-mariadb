// As 13 classes de componente do DFM do PEP (cap-11 §11.1; ref 04 §3.1, medidas na cópia em 2026-10-19:
// 2.368 componentes) e o tipo de item da representação (inspirada no FHIR Questionnaire). Classe fora da
// lista nunca é adivinhada: vira item "nao-mapeado" e conta no relatório como classe desconhecida.

export type TipoItem =
  | 'group'
  | 'text'
  | 'date'
  | 'time'
  | 'choice'
  | 'open-choice'
  | 'multi-choice'
  | 'string'
  | 'quantity'
  | 'grid'
  | 'coding'
  | 'multi-coding'
  | 'reference';

export interface ClasseDfm {
  readonly classe: string;
  readonly tipo: TipoItem;
  /** Widget sugerido ao renderizador do M22 (ui:widget). */
  readonly widget: string;
  /** Subcomponente com a lista de rótulos das escolhas (Items.Strings). */
  readonly listaRotulos?: string;
  /** TIPOPERG esperados para a classe (ref 04 §3.1); outro valor vai ao relatório como aviso. */
  readonly tiposPergunta: readonly string[];
}

export const CLASSES_DFM: readonly ClasseDfm[] = [
  { classe: 'TGroupBoxPep', tipo: 'group', widget: 'section', tiposPergunta: ['1'] },
  { classe: 'TfRespTexto', tipo: 'text', widget: 'richtext', tiposPergunta: ['5'] },
  { classe: 'TfRespData', tipo: 'date', widget: 'date', tiposPergunta: ['2'] },
  { classe: 'TfRespHora', tipo: 'time', widget: 'time', tiposPergunta: ['3'] },
  {
    classe: 'TfRespComboBox',
    tipo: 'choice',
    widget: 'select',
    listaRotulos: 'cbxResp',
    tiposPergunta: ['4', '13'],
  },
  {
    classe: 'TfRespComboTexto',
    tipo: 'open-choice',
    widget: 'select-with-text',
    listaRotulos: 'cbxResp',
    tiposPergunta: ['8'],
  },
  {
    classe: 'TfRespCheckListBox',
    tipo: 'multi-choice',
    widget: 'checkbox-group',
    listaRotulos: 'clbResp',
    tiposPergunta: ['12'],
  },
  { classe: 'TfRespEdit', tipo: 'string', widget: 'text', tiposPergunta: ['6', '7', '11'] },
  { classe: 'TfRespEditUnidade', tipo: 'quantity', widget: 'quantity', tiposPergunta: ['6', '7', '11'] },
  { classe: 'TfRespColunas', tipo: 'grid', widget: 'table-repeater', tiposPergunta: ['9'] },
  { classe: 'TfRespCid', tipo: 'coding', widget: 'terminology-lookup', tiposPergunta: ['10'] },
  { classe: 'TfRespMultiploCid', tipo: 'multi-coding', widget: 'terminology-multi', tiposPergunta: ['18'] },
  { classe: 'TfRespAlergia', tipo: 'reference', widget: 'allergy-panel', tiposPergunta: ['19'] },
];

const POR_NOME = new Map(CLASSES_DFM.map((c) => [c.classe, c]));

export function classeDfm(nome: string): ClasseDfm | undefined {
  return POR_NOME.get(nome);
}
