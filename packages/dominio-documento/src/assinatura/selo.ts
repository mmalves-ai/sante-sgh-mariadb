// Selo e rodapé da assinatura ICP-Brasil no PDF/A emitido (M49, etapa 2; regra 8; SBIS-38, SBIS-42; ICP-05) e as
// regras do documento a assinar: que tipos do novo recebem a assinatura (os que têm modelo de PDF/A), para onde o
// documento vai (sai ou não do hospital: a política decide por isso, regra 6), o conselho do autor pelo OID do
// certificado (D-CONSELHO-49) e o endereço do verificador público do QR. O selo e o rodapé entram no CONTEÚDO da
// página antes da prévia: o que o profissional vê é o que é assinado (regra 4). Nada de dado do paciente no selo além
// do que o documento já tem; o QR leva só o código opaco (regra 9).
import type { DestinoDocumento, PoliticaAssinaturaIcp, TipoDocumentoPolitica } from '@sgh/contratos';
import type { CampoDocumento } from '../pdf/modelo.js';
import { camposDoDocumentoPep, type ConteudoPep, RODAPE_ASSINATURA_A_MAO } from '../pdf/modelos-pep.js';

/**
 * Tipos do documento do novo (SGH_PEP_DOCUMENTO.TIPO) que recebem a assinatura ICP-Brasil nesta etapa: os que têm
 * modelo de PDF/A (receitas e atestado primeiro, DP-23; depois os demais). Anexo, exame externo, pedido de exame e
 * alergia não têm documento impresso do novo: seguem com a assinatura avançada do M23.
 */
export const TIPOS_ASSINAVEIS_ICP = [
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'receita',
  'declaracao',
  'requerimento',
  'sumario-alta',
  'rel-transferencia',
  'declaracao-obito',
  'tcle',
  'registro-clinico',
] as const satisfies readonly TipoDocumentoPolitica[];
export type TipoAssinavelIcp = (typeof TIPOS_ASSINAVEIS_ICP)[number];

export const assinavelIcp = (tipo: string): tipo is TipoAssinavelIcp =>
  (TIPOS_ASSINAVEIS_ICP as readonly string[]).includes(tipo);

/** Ordem da fila: receita de controlado e atestado primeiro (DP-23), depois a ordem da lista. */
export const prioridadeIcp = (tipo: string): number => {
  const i = (TIPOS_ASSINAVEIS_ICP as readonly string[]).indexOf(tipo);
  return i < 0 ? TIPOS_ASSINAVEIS_ICP.length : i;
};

const SAI_DO_HOSPITAL: ReadonlySet<string> = new Set([
  'receita',
  'receita-controlada',
  'receita-antimicrobiano',
  'atestado',
  'declaracao',
  'requerimento',
  'sumario-alta',
  'rel-transferencia',
  'declaracao-obito',
]);

/**
 * D-DESTINO-49: o destino pelo tipo. Receita, atestado, declaração, requerimento, sumário de alta, relatório de
 * transferência e declaração de óbito vão ao paciente ou a outro serviço (externo); TCLE e registro clínico ficam no
 * prontuário (interno).
 */
export const destinoDoTipo = (tipo: string): DestinoDocumento =>
  SAI_DO_HOSPITAL.has(tipo) ? 'externo' : 'interno';

/**
 * D-CONSELHO-49: a sigla do conselho do autor pelo OID de registro em conselho do certificado (TBOID.ID_TBCONSPROF →
 * TBCONSPROF.COD_CONSELHO_PROF): o primeiro OID do certificado (otherName do SubjectAltName) que o cadastro liga a um
 * conselho. Sem nenhum, null (vale a regra "qualquer conselho").
 */
export function conselhoPeloCertificado(
  outrosNomes: Readonly<Record<string, string>>,
  oidsDeConselho: readonly { readonly oid: string; readonly conselho: string }[],
): string | null {
  const presentes = new Set(Object.keys(outrosNomes));
  const achado = oidsDeConselho.find((o) => presentes.has(o.oid.trim()));
  return achado ? achado.conselho.trim().toUpperCase() : null;
}

/** O endereço do verificador público (portal) para o código do QR. */
export function urlVerificador(base: string, codigo: string): string {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(codigo)) throw new Error('Código de verificação inválido.');
  return `${base.replace(/\/+$/, '')}/verificar/${codigo}`;
}

/** Rodapé legal da impressão do documento assinado (regra 8; SBIS-42): a base legal e onde validar fora do sistema. */
export const RODAPE_LEGAL_ICP =
  'Documento assinado digitalmente com certificado ICP-Brasil (MP 2.200-2/2001; Lei 14.063/2020, art. 13). ' +
  'A assinatura pode ser conferida no validador do ITI (validar.iti.gov.br) com este arquivo PDF, ou pelo QR deste documento.';

export interface DadosSelo {
  /** Nome do profissional como o documento já mostra. */
  readonly profissional: string;
  /** Conselho e número quando o cadastro informa (ex.: "CRM-RJ 000000"); null sem registro. */
  readonly registro: string | null;
  readonly politica: PoliticaAssinaturaIcp;
  /** Instante da assinatura (o /M do PDF), já formatado no fuso do estabelecimento. */
  readonly assinadoEm: string;
  readonly codigo: string;
  readonly urlVerificador: string;
}

/** O selo visível "assinado" (SBIS-38), em linhas de campo do modelo do PDF/A. */
export function camposDoSelo(s: DadosSelo): CampoDocumento[] {
  const quem = s.registro ? `${s.profissional} (${s.registro})` : s.profissional;
  const politica = s.politica === 'AD-RT' ? 'com carimbo do tempo (AD-RT)' : 'referência básica (AD-RB)';
  return [
    {
      rotulo: 'Assinatura digital',
      valor: `Assinado digitalmente por ${quem} em ${s.assinadoEm}, com certificado ICP-Brasil, ${politica}.`,
    },
    { rotulo: 'Verificação', valor: `Código ${s.codigo} - ${s.urlVerificador}` },
    { rotulo: 'Base legal', valor: RODAPE_LEGAL_ICP },
  ];
}

/**
 * Os campos do documento assinado com ICP: os do modelo do M23 SEM o rodapé "assinar à mão" (a assinatura qualificada
 * o substitui) e com o selo no fim.
 */
export function camposDoDocumentoIcp(c: ConteudoPep, selo: DadosSelo): CampoDocumento[] {
  return [
    ...camposDoDocumentoPep(c).filter((x) => x.valor !== RODAPE_ASSINATURA_A_MAO),
    ...camposDoSelo(selo),
  ];
}
