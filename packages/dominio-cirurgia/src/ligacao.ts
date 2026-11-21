// Ligação agendamento ↔ cirurgia realizada (ficha do M18, regra 9; cap-05a §5.5). A base de origem não tem chave direta:
// a cirurgia realizada casa com o agendamento pelo atendimento, pela sala e pela data.
// Medido na cópia pc (573 cirurgias desde 10/2025): 263 casam por atendimento, dia e sala; 234 por atendimento e
// dia (sala diferente); 21 só pelo atendimento; 55 não casam. O sistema grava a ligação no próprio ato cirúrgico
// (agendamento_cirurgico_id) quando registra pelo agendamento; as do outro sistema vão para revisão com a sugestão.

export interface AgendamentoParaLigar {
  readonly id: number;
  readonly reg: number;
  readonly sala: number;
  /** "AAAA-MM-DD". */
  readonly dia: string;
}

export interface RealizadaParaLigar {
  readonly id: number;
  readonly reg: number;
  readonly sala: number;
  readonly dia: string;
}

export type Casamento =
  | { readonly tipo: 'exato'; readonly agendamento: number }
  | { readonly tipo: 'reg-e-dia'; readonly candidatos: readonly number[] }
  | { readonly tipo: 'so-reg'; readonly candidatos: readonly number[] }
  | { readonly tipo: 'ambiguo'; readonly candidatos: readonly number[] }
  | { readonly tipo: 'nenhum' };

/** Sugestão de casamento de uma realizada com os agendamentos lidos (exato só se único). */
export function casar(r: RealizadaParaLigar, agendamentos: readonly AgendamentoParaLigar[]): Casamento {
  if (r.reg <= 0) return { tipo: 'nenhum' };
  const doReg = agendamentos.filter((a) => a.reg === r.reg);
  if (doReg.length === 0) return { tipo: 'nenhum' };
  const doDia = doReg.filter((a) => a.dia === r.dia);
  const exatos = doDia.filter((a) => a.sala === r.sala);
  if (exatos.length === 1) return { tipo: 'exato', agendamento: exatos[0]!.id };
  if (exatos.length > 1) return { tipo: 'ambiguo', candidatos: exatos.map((a) => a.id) };
  if (doDia.length > 0) return { tipo: 'reg-e-dia', candidatos: doDia.map((a) => a.id) };
  return { tipo: 'so-reg', candidatos: doReg.map((a) => a.id) };
}

export interface ResumoLigacoes {
  readonly exato: number;
  readonly regEDia: number;
  readonly soReg: number;
  readonly ambiguo: number;
  readonly nenhum: number;
}

export function resumirCasamentos(cs: readonly Casamento[]): ResumoLigacoes {
  const r = { exato: 0, regEDia: 0, soReg: 0, ambiguo: 0, nenhum: 0 };
  for (const c of cs) {
    if (c.tipo === 'exato') r.exato++;
    else if (c.tipo === 'reg-e-dia') r.regEDia++;
    else if (c.tipo === 'so-reg') r.soReg++;
    else if (c.tipo === 'ambiguo') r.ambiguo++;
    else r.nenhum++;
  }
  return r;
}

/** Vai para a revisão humana (tudo que não é exato). */
export function precisaRevisao(c: Casamento): boolean {
  return c.tipo !== 'exato';
}
