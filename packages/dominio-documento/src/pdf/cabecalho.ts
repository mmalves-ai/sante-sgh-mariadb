// Cabeçalho e rodapé da impressão por tipo de documento (03-PEP L131): o hospital cadastra a regra por tipo de
// documento clínico e estabelecimento (ou para todos), e a emissão escolhe a mais específica. A regra traz a fonte
// dos dados (estabelecimento, mantenedora ou texto próprio), o rodapé e se o documento mostra os dados do paciente e
// a assinatura. Regra pura: sem banco nem I/O.

export const FONTES_CABECALHO = ['estabelecimento', 'mantenedora', 'personalizado'] as const;
export type FonteCabecalho = (typeof FONTES_CABECALHO)[number];

export const LINHAS_MAXIMAS_CABECALHO = 6;
export const LINHAS_MAXIMAS_RODAPE = 4;
export const CARACTERES_MAXIMOS_LINHA = 120;

export interface RegraCabecalho {
  readonly id: number;
  /** Nulo: vale para todos os estabelecimentos do cliente. */
  readonly estabelecimento: number | null;
  /** Nulo: padrão dos documentos sem regra própria. */
  readonly tipoDocumento: number | null;
  readonly fonte: FonteCabecalho;
  readonly cabecalho: string | null;
  readonly rodape: string | null;
  readonly exibeDadosPaciente: boolean;
  readonly exibeAssinatura: boolean;
  readonly ativo: boolean;
}

export interface FalhaCabecalho {
  readonly campo: string;
  readonly mensagem: string;
}

const linhas = (t: string | null) =>
  (t ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

function conferirTexto(campo: string, texto: string | null, maximo: number): FalhaCabecalho[] {
  const ls = linhas(texto);
  const f: FalhaCabecalho[] = [];
  if (ls.length > maximo) f.push({ campo, mensagem: `Use no máximo ${maximo} linhas.` });
  if (ls.some((l) => l.length > CARACTERES_MAXIMOS_LINHA))
    f.push({ campo, mensagem: `Cada linha cabe em ${CARACTERES_MAXIMOS_LINHA} caracteres.` });
  // O PDF é autocontido (PDF/A): nada de marcação nem endereço externo no texto.
  if (/[<>]/.test(texto ?? '') || /https?:\/\//i.test(texto ?? ''))
    f.push({ campo, mensagem: 'O texto não aceita marcação (< >) nem endereço da internet.' });
  return f;
}

/** Confere a regra antes de gravar; lista vazia: pode gravar. */
export function validarRegraCabecalho(r: {
  readonly fonte: FonteCabecalho;
  readonly cabecalho: string | null;
  readonly rodape: string | null;
}): FalhaCabecalho[] {
  const f: FalhaCabecalho[] = [];
  if (r.fonte === 'personalizado' && linhas(r.cabecalho).length === 0)
    f.push({ campo: 'cabecalho', mensagem: 'O cabeçalho próprio precisa de ao menos uma linha.' });
  if (r.fonte !== 'personalizado' && linhas(r.cabecalho).length > 0)
    f.push({
      campo: 'cabecalho',
      mensagem:
        'As linhas próprias só valem com a fonte "texto próprio"; escolha a fonte ou apague as linhas.',
    });
  return [
    ...f,
    ...conferirTexto('cabecalho', r.cabecalho, LINHAS_MAXIMAS_CABECALHO),
    ...conferirTexto('rodape', r.rodape, LINHAS_MAXIMAS_RODAPE),
  ];
}

/**
 * A regra que vale para o documento: entre as ativas, a do estabelecimento e do tipo; depois a de todos os
 * estabelecimentos para o tipo; depois o padrão do estabelecimento; por fim o padrão de todos. Nenhuma: null (a
 * emissão usa os dados do estabelecimento, com paciente e assinatura).
 */
export function resolverCabecalho(
  regras: readonly RegraCabecalho[],
  estabelecimento: number,
  tipoDocumento: number | null,
): RegraCabecalho | null {
  const ativas = regras.filter((r) => r.ativo);
  const achar = (est: number | null, tipo: number | null) =>
    ativas.find((r) => r.estabelecimento === est && r.tipoDocumento === tipo) ?? null;
  return (
    (tipoDocumento !== null ? achar(estabelecimento, tipoDocumento) : null) ??
    (tipoDocumento !== null ? achar(null, tipoDocumento) : null) ??
    achar(estabelecimento, null) ??
    achar(null, null)
  );
}

export interface DadosInstituicao {
  readonly nome: string;
  readonly cnpj: string | null;
  readonly cnes: string | null;
  readonly endereco: string | null;
  readonly telefone: string | null;
}

/** As linhas do cabeçalho e do rodapé que o documento imprime pela regra resolvida. */
export function montarCabecalho(
  regra: RegraCabecalho | null,
  estabelecimento: DadosInstituicao,
  mantenedora: DadosInstituicao | null,
): {
  readonly linhas: readonly string[];
  readonly rodape: readonly string[];
  readonly exibeDadosPaciente: boolean;
  readonly exibeAssinatura: boolean;
} {
  const dosDados = (d: DadosInstituicao) =>
    [
      d.nome,
      [d.cnpj ? `CNPJ ${formatarCnpj(d.cnpj)}` : null, d.cnes ? `CNES ${d.cnes}` : null]
        .filter(Boolean)
        .join(' · '),
      [d.endereco, d.telefone ? `Tel. ${d.telefone}` : null].filter(Boolean).join(' · '),
    ].filter((l) => l.length > 0);
  const fonte = regra?.fonte ?? 'estabelecimento';
  const ls =
    fonte === 'personalizado'
      ? linhas(regra?.cabecalho ?? null)
      : dosDados(fonte === 'mantenedora' && mantenedora ? mantenedora : estabelecimento);
  return {
    linhas: ls,
    rodape: linhas(regra?.rodape ?? null),
    exibeDadosPaciente: regra?.exibeDadosPaciente ?? true,
    exibeAssinatura: regra?.exibeAssinatura ?? true,
  };
}

function formatarCnpj(c: string): string {
  return /^\d{14}$/.test(c) ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c;
}
