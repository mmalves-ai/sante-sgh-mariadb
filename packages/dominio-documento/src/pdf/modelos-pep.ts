// Modelos dos documentos do prontuário emitidos pelo novo (ficha do M23, regras 6, 7 e 8; cap-09 §9.8): os campos de
// cada documento (receita simples, de controle especial e de antimicrobiano; atestado, declaração e requerimento; TCLE;
// sumário de alta; relatório de transferência; declaração de óbito; exportação do prontuário) no modelo HTML do M09
// (PDF/A-2b pelo Gotenberg, hash, QR de validação, "2ª via"). Receita de controlado e atestado que saem do hospital
// levam o rodapé de assinatura à mão até a assinatura qualificada (Lei 14.063/2020, art. 13; regra 7).
import type { CampoDocumento } from './modelo.js';

export const MODELOS_PEP = [
  'receita',
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'declaracao',
  'requerimento',
  'tcle',
  'sumario-alta',
  'rel-transferencia',
  'declaracao-obito',
  'prontuario',
  // M24: a prescrição impressa (itens, horários previstos e a situação de cada um).
  'prescricao',
] as const;
export type ModeloPep = (typeof MODELOS_PEP)[number];

export const TITULOS_PEP: Readonly<Record<ModeloPep, string>> = {
  receita: 'Receituário',
  'receita-controlada': 'Receituário de controle especial',
  'receita-antimicrobiano': 'Receituário de antimicrobiano',
  atestado: 'Atestado médico',
  declaracao: 'Declaração',
  requerimento: 'Requerimento',
  tcle: 'Termo de consentimento livre e esclarecido',
  'sumario-alta': 'Sumário de alta',
  'rel-transferencia': 'Relatório de transferência',
  'declaracao-obito': 'Declaração de óbito',
  prontuario: 'Prontuário do paciente',
  prescricao: 'Prescrição',
};

/** Rodapé de assinatura à mão (regra 7): receita de controlado e de antimicrobiano, atestado e óbito. */
export const RODAPE_ASSINATURA_A_MAO =
  'Assinar à mão: documento impresso para assinatura do profissional (assinatura qualificada na Fase 5; Lei 14.063/2020, art. 13).';

const EXIGE_ASSINATURA_A_MAO: ReadonlySet<ModeloPep> = new Set([
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'declaracao-obito',
]);

export interface IdentificacaoDocumento {
  readonly paciente: string;
  readonly prontuario: string;
  readonly nascimento: string | null;
  readonly atendimento: string | null;
  readonly profissional: string;
  readonly conselho: string | null;
  readonly dataHora: string;
}

export interface ConteudoPep {
  readonly modelo: ModeloPep;
  readonly identificacao: IdentificacaoDocumento;
  /** As linhas do corpo do documento (o texto que o profissional escreveu ou montou). */
  readonly corpo: readonly string[];
  /** Campos a mais do modelo (vias, validade, dias, CID autorizado, destino…), na ordem. */
  readonly extras?: readonly CampoDocumento[];
}

/** Os campos do documento (identificação, corpo, extras e o rodapé de assinatura à mão quando o modelo exige). */
export function camposDoDocumentoPep(c: ConteudoPep): CampoDocumento[] {
  const i = c.identificacao;
  const campos: CampoDocumento[] = [
    { rotulo: 'Paciente', valor: i.paciente },
    { rotulo: 'Prontuário', valor: i.prontuario },
    ...(i.nascimento ? [{ rotulo: 'Nascimento', valor: i.nascimento }] : []),
    ...(i.atendimento ? [{ rotulo: 'Atendimento', valor: i.atendimento }] : []),
    { rotulo: 'Profissional', valor: i.conselho ? `${i.profissional} (${i.conselho})` : i.profissional },
    { rotulo: 'Data e hora', valor: i.dataHora },
    ...(c.extras ?? []),
    { rotulo: TITULOS_PEP[c.modelo], valor: c.corpo.join('\n') || '-' },
  ];
  if (EXIGE_ASSINATURA_A_MAO.has(c.modelo))
    campos.push({ rotulo: 'Assinatura', valor: RODAPE_ASSINATURA_A_MAO });
  return campos;
}

/** Modelo do documento do novo pelo tipo gravado (SGH_PEP_DOCUMENTO.TIPO). */
export function modeloDoTipo(tipo: string): ModeloPep {
  return (MODELOS_PEP as readonly string[]).includes(tipo) ? (tipo as ModeloPep) : 'prontuario';
}
