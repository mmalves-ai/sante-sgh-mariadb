// Endereços, telefones e e-mails da pessoa (F3.1, 02-CAD linha 3): vários por tipo, um principal por espécie de
// contato, vigência no endereço e aceite de comunicação (LGPD) no e-mail e no telefone. Regra pura. Nada se apaga:
// o endereço encerra a vigência; o telefone e o e-mail saem de uso com a marca de exclusão lógica (a linha fica).

export const FINALIDADES_EMAIL = [
  'pessoal',
  'profissional',
  'cobranca',
  'notificacao',
  'nota_fiscal',
  'outro',
] as const;
export type FinalidadeEmail = (typeof FINALIDADES_EMAIL)[number];

export interface EnderecoNovo {
  readonly cep: string;
  readonly numero: string | null;
  readonly semNumero: boolean;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFim: string | null;
  /**
   * Endereço manual: o CEP não está no cadastro de CEPs, então a tela informa o que a base postal daria. A espécie
   * do logradouro (rua, avenida…) é obrigatória porque os leiautes públicos (cartão SUS, eSocial) pedem o código do
   * tipo de logradouro; o município, porque o endereço nacional exige o código do IBGE.
   */
  readonly manual?: {
    readonly especie: number | null;
    readonly municipio: number | null;
    readonly logradouro: string | null;
  } | null;
}

export interface TelefoneNovo {
  readonly ddi: string;
  readonly ddd: string | null;
  readonly numero: string;
  readonly aceitaMensagem: boolean;
  /** O tipo de telefone escolhido aceita mensagem (catálogo). */
  readonly tipoPermiteMensagem: boolean;
  /** Telefone de recado (de terceiro): exige com quem falar. */
  readonly tipoRecado: boolean;
  readonly nomeContato: string | null;
}

export interface EmailNovo {
  readonly email: string;
  readonly finalidade: string;
  readonly aceitaComunicacao: boolean;
  /** A tela confirmou que o titular (ou o responsável) declarou o aceite agora. */
  readonly aceiteDeclarado: boolean;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function errosEndereco(e: EnderecoNovo): string[] {
  const erros: string[] = [];
  if (!/^\d{8}$/.test(e.cep)) erros.push('cep');
  if (e.semNumero ? e.numero !== null : !e.numero?.trim()) erros.push('numero');
  if (e.vigenciaInicio !== null && !DATA.test(e.vigenciaInicio)) erros.push('vigenciaInicio');
  if (e.vigenciaFim !== null && !DATA.test(e.vigenciaFim)) erros.push('vigenciaFim');
  if (e.vigenciaInicio && e.vigenciaFim && e.vigenciaFim < e.vigenciaInicio) erros.push('vigenciaFim');
  if (e.manual) {
    if (!e.manual.especie) erros.push('especie');
    if (!e.manual.municipio) erros.push('municipio');
    if (!e.manual.logradouro?.trim()) erros.push('logradouro');
  }
  return erros;
}

export function errosTelefone(t: TelefoneNovo): string[] {
  const erros: string[] = [];
  if (!/^\d{1,4}$/.test(t.ddi)) erros.push('ddi');
  if (t.ddi === '55' ? !/^[1-9]\d$/.test(t.ddd ?? '') : t.ddd !== null && !/^[1-9]\d$/.test(t.ddd))
    erros.push('ddd');
  if (!/^\d{8,15}$/.test(t.numero)) erros.push('numero');
  if (t.aceitaMensagem && !t.tipoPermiteMensagem) erros.push('aceitaMensagem');
  if (t.tipoRecado && !t.nomeContato?.trim()) erros.push('nomeContato');
  return erros;
}

export function errosEmail(m: EmailNovo): string[] {
  const erros: string[] = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email) || m.email.length > 254) erros.push('email');
  if (!(FINALIDADES_EMAIL as readonly string[]).includes(m.finalidade)) erros.push('finalidade');
  // LGPD: o aceite de comunicação não obrigatória só com a declaração do titular registrada no ato.
  if (m.aceitaComunicacao && !m.aceiteDeclarado) erros.push('aceitaComunicacao');
  return erros;
}

/** Vigente na data (início nulo: desde sempre; fim nulo: em aberto). */
export function vigenteEm(
  x: { readonly vigenciaInicio: string | null; readonly vigenciaFim: string | null },
  hoje: string,
): boolean {
  return (
    (x.vigenciaInicio === null || x.vigenciaInicio <= hoje) &&
    (x.vigenciaFim === null || x.vigenciaFim >= hoje)
  );
}

/** Dia civil anterior (AAAA-MM-DD). */
export function diaAnterior(d: string): string {
  const [a, m, dd] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, dd - 1)).toISOString().slice(0, 10);
}

/**
 * Fim da vigência ao encerrar hoje: ontem (deixa de valer hoje). O registro que começou hoje ou começa no futuro não
 * tem ontem na vigência: o fim fica no dia anterior ao início (o intervalo vazio, nunca vigente). Nada se apaga.
 */
export function fimDoEncerramento(inicio: string | null, hoje: string): string {
  return inicio !== null && inicio >= hoje ? diaAnterior(inicio) : diaAnterior(hoje);
}

/**
 * O principal depois de incluir ou escolher um: o novo marcado vira o único principal; sem marcação, o primeiro
 * contato da pessoa vira principal (a pessoa nunca fica sem principal quando tem contato ativo).
 */
export function principalDepois(
  ativos: readonly { readonly id: number; readonly principal: boolean }[],
  novo: { readonly id: number; readonly principal: boolean },
): { principal: number; desmarcar: number[] } {
  const temOutro = ativos.some((a) => a.id !== novo.id && a.principal);
  const principal =
    novo.principal || !temOutro ? novo.id : ativos.find((a) => a.principal && a.id !== novo.id)!.id;
  return { principal, desmarcar: ativos.filter((a) => a.principal && a.id !== principal).map((a) => a.id) };
}

/** Ao tirar de uso o principal, o próximo ativo (o mais antigo) assume. */
export function sucessorDoPrincipal(
  ativos: readonly { readonly id: number; readonly principal: boolean }[],
  saindo: number,
): number | null {
  const sai = ativos.find((a) => a.id === saindo);
  if (!sai?.principal) return null;
  const resto = ativos.filter((a) => a.id !== saindo).sort((a, b) => a.id - b.id);
  return resto[0]?.id ?? null;
}
