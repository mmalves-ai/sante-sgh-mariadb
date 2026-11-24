// Impressora por estação de trabalho e reimpressão controlada (01-ADM L79). Desenho próprio: a estação diz, por
// finalidade (etiqueta de amostra, pulseira, receita, laudo, A4), qual impressora usa, com preferência opcional por
// usuário; sem vínculo na estação, vale o padrão do estabelecimento (da unidade, depois o geral). Assim ninguém
// escolhe impressora a cada impressão. A reimpressão (2ª via em diante) sempre leva o motivo do catálogo, o
// complemento quando o motivo exige, o número da via e onde saiu; o registro nunca é apagado.
// Regra pura: sem banco nem I/O; a porta própria lê os fatos e grava o que estas funções devolvem.

export type RecusaImpressao =
  | 'estacao-inexistente'
  | 'impressora-inexistente'
  | 'finalidade-inexistente'
  | 'impressora-de-outro-estabelecimento'
  | 'impressora-inativa'
  | 'finalidade-inativa'
  | 'motivo-inexistente'
  | 'motivo-inativo'
  | 'complemento-obrigatorio'
  | 'documento-nunca-impresso'
  | 'documento-inexistente'
  | 'documento-emitido-inexistente'
  | 'usuario-sem-vinculo';

export const MENSAGEM_IMPRESSAO: Readonly<Record<RecusaImpressao, string>> = {
  'estacao-inexistente': 'Estação de trabalho não encontrada neste estabelecimento.',
  'impressora-inexistente': 'Impressora não encontrada.',
  'finalidade-inexistente': 'Finalidade de impressão não encontrada.',
  'impressora-de-outro-estabelecimento': 'A impressora é de outro estabelecimento.',
  'impressora-inativa': 'A impressora está inativa.',
  'finalidade-inativa': 'A finalidade de impressão está inativa.',
  'motivo-inexistente': 'Motivo de reimpressão não encontrado.',
  'motivo-inativo': 'O motivo de reimpressão está inativo.',
  'complemento-obrigatorio': 'Este motivo pede o complemento (mínimo de 5 caracteres).',
  'documento-nunca-impresso':
    'Este documento ainda não foi impresso: a primeira impressão não é reimpressão.',
  'documento-inexistente': 'O documento a reimprimir não existe neste estabelecimento.',
  'documento-emitido-inexistente': 'O documento emitido informado não existe neste estabelecimento.',
  'usuario-sem-vinculo': 'O usuário da preferência não tem vínculo vigente com o estabelecimento da estação.',
};

export const COMPLEMENTO_MINIMO_REIMPRESSAO = 5;

/** Vínculo da estação com a impressora por finalidade: confere os fatos lidos. */
export function conferirVinculoEstacao(f: {
  readonly estacaoEstabelecimento: number | null;
  readonly impressora: { readonly estabelecimento: number; readonly ativa: boolean } | null;
  readonly finalidadeAtiva: boolean | null;
  /** Preferência por usuário: o usuário tem vínculo vigente com o estabelecimento (null: sem preferência). */
  readonly usuarioVinculado?: boolean | null;
}): RecusaImpressao | null {
  if (f.estacaoEstabelecimento === null) return 'estacao-inexistente';
  if (f.usuarioVinculado === false) return 'usuario-sem-vinculo';
  if (!f.impressora) return 'impressora-inexistente';
  if (f.finalidadeAtiva === null) return 'finalidade-inexistente';
  if (f.impressora.estabelecimento !== f.estacaoEstabelecimento) return 'impressora-de-outro-estabelecimento';
  if (!f.impressora.ativa) return 'impressora-inativa';
  if (!f.finalidadeAtiva) return 'finalidade-inativa';
  return null;
}

export interface CandidatoImpressora {
  readonly impressora: number;
  readonly origem: 'estacao' | 'estabelecimento';
  /** Na estação: o usuário da preferência (nulo vale para todos). */
  readonly usuario?: number | null;
  /** No estabelecimento: a unidade (nulo vale para o estabelecimento inteiro). */
  readonly unidade?: number | null;
  readonly padrao?: boolean;
  readonly ativa: boolean;
}

/**
 * A impressora que sai para esta estação, usuário e unidade: preferência do usuário na estação, depois o padrão da
 * estação, depois o padrão da unidade no estabelecimento, depois o geral. Impressora inativa não conta.
 * Decisão (01-ADM L79): o vínculo anterior da estação (não mais o padrão, nunca apagado) serve de reserva no mesmo
 * nível quando a impressora padrão fica inativa: a estação continua na impressora que já usava antes de cair para o
 * padrão da unidade ou do estabelecimento.
 */
export function escolherImpressora(
  candidatos: readonly CandidatoImpressora[],
  quem: { readonly usuario: number | null; readonly unidade: number | null },
): {
  readonly impressora: number;
  readonly nivel: 'usuario' | 'estacao' | 'unidade' | 'estabelecimento';
} | null {
  const ativos = candidatos.filter((c) => c.ativa);
  const primeiro = (f: (c: CandidatoImpressora) => boolean) =>
    ativos.filter(f).sort((a, b) => Number(b.padrao ?? true) - Number(a.padrao ?? true))[0];
  const u =
    quem.usuario !== null ? primeiro((c) => c.origem === 'estacao' && c.usuario === quem.usuario) : undefined;
  if (u) return { impressora: u.impressora, nivel: 'usuario' };
  const e = primeiro((c) => c.origem === 'estacao' && (c.usuario ?? null) === null);
  if (e) return { impressora: e.impressora, nivel: 'estacao' };
  const un =
    quem.unidade !== null
      ? primeiro((c) => c.origem === 'estabelecimento' && c.unidade === quem.unidade)
      : undefined;
  if (un) return { impressora: un.impressora, nivel: 'unidade' };
  const g = primeiro((c) => c.origem === 'estabelecimento' && (c.unidade ?? null) === null);
  return g ? { impressora: g.impressora, nivel: 'estabelecimento' } : null;
}

/**
 * Quantas vias o documento já teve: a maior entre a última via registrada de reimpressão e o que o próprio documento
 * diz (vias impressas, data da impressão ou a emissão). Zero quer dizer nunca impresso: a reimpressão é recusada.
 */
export function viasAnterioresDaReimpressao(f: {
  readonly ultimaViaRegistrada: number | null;
  readonly viasDoDocumento: number;
}): number {
  return Math.max(f.ultimaViaRegistrada ?? 0, f.viasDoDocumento, 0);
}

/** Reimpressão: confere o motivo e diz o número da via (a 1ª impressão é a via 1; a reimpressão começa na 2). */
export function planoReimpressao(f: {
  readonly viasAnteriores: number;
  readonly motivo: { readonly ativo: boolean; readonly exigeComplemento: boolean } | null;
  readonly complemento?: string | null;
}): { readonly recusa: RecusaImpressao } | { readonly via: number; readonly complemento: string | null } {
  if (f.viasAnteriores < 1) return { recusa: 'documento-nunca-impresso' };
  if (!f.motivo) return { recusa: 'motivo-inexistente' };
  if (!f.motivo.ativo) return { recusa: 'motivo-inativo' };
  const comp = (f.complemento ?? '').trim();
  if (f.motivo.exigeComplemento && comp.length < COMPLEMENTO_MINIMO_REIMPRESSAO)
    return { recusa: 'complemento-obrigatorio' };
  return { via: f.viasAnteriores + 1, complemento: comp ? comp.slice(0, 500) : null };
}
