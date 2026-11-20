// Cadastro mínimo do visitante (M50, etapa 5; regra 9): o nome de busca (sem acento, em maiúsculas), a idade para a
// regra da unidade, a data de nascimento plausível e o prazo de retenção do encarregado de dados (contado da última
// visita). Regras puras.

/** Nome de busca: maiúsculas, sem acento, espaços simples (até 70). */
export function nomeDeBusca(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

const partes = (d: string) => d.split('-').map(Number) as [number, number, number];

/** Idade em anos completos na data (AAAA-MM-DD). */
export function idadeNaData(nascimento: string, hoje: string): number {
  const [an, mn, dn] = partes(nascimento);
  const [ah, mh, dh] = partes(hoje);
  let idade = ah - an;
  if (mh < mn || (mh === mn && dh < dn)) idade--;
  return idade;
}

/** Soma dias a uma data civil (AAAA-MM-DD). */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = partes(data);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** O prazo de retenção do cadastro: a data da última visita mais os dias do encarregado de dados. */
export const reterAte = (ultimaVisita: string, dias: number): string =>
  somarDias(ultimaVisita.slice(0, 10), dias);

export type ConferenciaNascimento = { readonly ok: true } | { readonly ok: false; readonly mensagem: string };

/** A data de nascimento é de hoje ou antes e de no máximo 120 anos. */
export function conferirNascimento(nascimento: string | null, hoje: string): ConferenciaNascimento {
  if (nascimento === null) return { ok: true };
  const [a, m, d] = partes(nascimento);
  const valida = new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10) === nascimento;
  if (!valida) return { ok: false, mensagem: 'Data de nascimento inválida.' };
  if (nascimento > hoje) return { ok: false, mensagem: 'A data de nascimento é depois de hoje.' };
  if (idadeNaData(nascimento, hoje) > 120)
    return { ok: false, mensagem: 'Confira a data de nascimento (mais de 120 anos).' };
  return { ok: true };
}

/** O cadastro venceu o prazo de retenção (e não está em visita)? */
export const vencido = (
  v: { readonly reterAte: string; readonly emVisita: boolean },
  hoje: string,
): boolean => !v.emVisita && v.reterAte < hoje;
