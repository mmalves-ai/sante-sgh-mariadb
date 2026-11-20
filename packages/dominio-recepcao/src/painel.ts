// Painel de chamada e senha impressa (M19; ficha, regras 6 e 7; cap-06a §6.3): o texto da senha é a letra do gerador
// e o número com três dígitos ("MC 012"), como o papel do totem; o painel em área comum nunca mostra o nome completo
// (no máximo as iniciais, por parâmetro); a voz sintetizada lê a letra separada e o guichê ou o local. As chamadas do
// outro sistema (o guichê que passou de 0 a um número, ou uma chamada de novo no local) entram pela mesma lista.

export { textoSenha } from '@sgh/contratos';

const PARTICULAS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'D']);

/**
 * Iniciais do nome (no máximo 4, sem as partículas): "Maria da Silva Souza" → "M. S. S.". Nome vazio: null. Nunca
 * devolve uma palavra inteira, nem quando o nome tem uma só.
 */
export function iniciais(nome: string | null | undefined): string | null {
  const partes = (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((p) => p && !PARTICULAS.has(p));
  if (partes.length === 0) return null;
  return partes
    .slice(0, 4)
    .map((p) => `${p[0]}.`)
    .join(' ');
}

/**
 * O texto mostra alguma palavra do nome (de 2 letras ou mais, sem as partículas)? O painel em área comum não pode
 * (regra 6): o teste do painel confere o texto renderizado com o nome do paciente sintético.
 */
export function mostraNome(texto: string, nome: string): boolean {
  const norm = (t: string) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  const palavras = new Set(
    norm(texto)
      .split(/[^A-Z]+/)
      .filter(Boolean),
  );
  return norm(nome)
    .split(/[^A-Z]+/)
    .filter((p) => p.length >= 2 && !PARTICULAS.has(p))
    .some((p) => palavras.has(p));
}

/** Fala da chamada: "Senha M C 012, guichê 3" ou "Senha M C 012, Consultório 01". */
export function falaChamada(c: {
  readonly texto: string;
  readonly destino: string;
  readonly guiche: number;
}): string {
  const [letra, numero] = c.texto.includes(' ') ? (c.texto.split(' ') as [string, string]) : ['', c.texto];
  const soletrada = letra.split('').join(' ');
  const n = String(Number(numero));
  const onde = c.guiche > 0 ? `guichê ${c.guiche}` : c.destino;
  return `Senha ${soletrada ? `${soletrada} ` : ''}${n}, ${onde}`.trim();
}

export interface ChamadaVista {
  readonly chave: string;
  readonly em: string;
}

/** Junta as chamadas novas às atuais (sem repetir a chave), da mais recente para a mais antiga, no teto. */
export function juntarChamadas<T extends ChamadaVista>(
  atuais: readonly T[],
  novas: readonly T[],
  teto: number,
): T[] {
  const mapa = new Map<string, T>();
  for (const c of [...atuais, ...novas]) mapa.set(c.chave, c);
  return [...mapa.values()]
    .sort((a, b) => b.em.localeCompare(a.em) || b.chave.localeCompare(a.chave))
    .slice(0, Math.max(0, teto));
}

export interface EstadoChamadaSenha {
  readonly id: number;
  readonly guiche: number;
  readonly situacao: string;
  /** Linhas C no fluxo da senha (chamar de novo e chamar ao local). */
  readonly chamadasNoFluxo: number;
}

/**
 * Chamadas vistas entre dois retratos das senhas do dia (vigia de mudanças): o guichê que passou de 0 (ou de outro
 * número) a um número, e cada linha C nova no fluxo. Devolve a senha e a contagem (para a chave da chamada).
 */
export function chamadasEntreRetratos(
  antes: ReadonlyMap<number, EstadoChamadaSenha>,
  depois: readonly EstadoChamadaSenha[],
): { readonly id: number; readonly contagem: number }[] {
  const r: { id: number; contagem: number }[] = [];
  for (const s of depois) {
    const a = antes.get(s.id);
    if (!a) continue; // senha nova no retrato: o primeiro retrato não anuncia nada
    const guicheNovo = s.guiche > 0 && s.guiche !== a.guiche;
    const fluxoNovo = s.chamadasNoFluxo > a.chamadasNoFluxo;
    if (guicheNovo || fluxoNovo) r.push({ id: s.id, contagem: s.chamadasNoFluxo + (s.guiche > 0 ? 1 : 0) });
  }
  return r;
}
