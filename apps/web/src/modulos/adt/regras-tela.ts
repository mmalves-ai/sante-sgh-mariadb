// Regras puras das telas do M21 (testadas em regras-tela.spec.ts): o texto do leito, a hora HHMM, o agrupamento do
// mapa por bloco e acomodação, a cor de cada situação, o prazo da limpeza e a leitura da etiqueta do SAME.
import {
  type CartaoPaciente,
  type ChaveLeito,
  chaveTextoLeito,
  type LeitoMapa,
  type MapaOperacional,
  type SituacaoMapaLeito,
} from '@sgh/contratos';

export const leitoTexto = (l: ChaveLeito) => `${l.bloco} · ${l.acomodacao} · ${l.leito}`;

/** "1430" → "14:30"; vazio → "". */
export function hhmm(h: string | null | undefined): string {
  const s = (h ?? '').trim();
  return /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : s;
}

/** "14:30" → "1430" (a hora como o servidor recebe). */
export const paraHhmm = (h: string) => h.replace(':', '').slice(0, 4);

export interface GrupoMapa {
  readonly bloco: string;
  readonly nome: string;
  readonly acomodacoes: {
    readonly acomodacao: string;
    readonly nome: string;
    readonly leitos: { readonly mapa: LeitoMapa; readonly cartao: CartaoPaciente | null }[];
  }[];
}

/** Os leitos do mapa operacional agrupados como o painel (bloco › acomodação), com o filtro de bloco e situação. */
export function agruparMapa(
  m: MapaOperacional,
  filtro: { bloco?: string; situacao?: string } = {},
): GrupoMapa[] {
  const porChave = new Map(m.leitos.map((l) => [l.chave, l]));
  const grupos: GrupoMapa[] = [];
  for (const b of m.painel.blocos) {
    if (filtro.bloco && b.bloco !== filtro.bloco) continue;
    const acomodacoes = b.acomodacoes
      .map((a) => ({
        acomodacao: a.acomodacao,
        nome: a.nome,
        leitos: a.leitos
          .map((l) => ({
            mapa: porChave.get(chaveTextoLeito({ bloco: b.bloco, acomodacao: a.acomodacao, leito: l.leito })),
            cartao: l.cartao,
          }))
          .filter(
            (l): l is { mapa: LeitoMapa; cartao: CartaoPaciente | null } =>
              !!l.mapa && (!filtro.situacao || l.mapa.situacao === filtro.situacao),
          ),
      }))
      .filter((a) => a.leitos.length > 0);
    if (acomodacoes.length > 0) grupos.push({ bloco: b.bloco, nome: b.nome, acomodacoes });
  }
  return grupos;
}

/** A classe visual da situação (cor + texto; a cor nunca é a única informação). */
export const classeSituacao = (s: SituacaoMapaLeito) => `leito-${s}`;

/** Minutos até o prazo (negativo: atrasada); null sem prazo. */
export function minutosAtePrazo(prazo: string | null, agoraMs: number): number | null {
  if (!prazo) return null;
  const t = Date.parse(prazo.length <= 19 ? `${prazo}Z` : prazo);
  return Number.isFinite(t) ? Math.round((t - agoraMs) / 60_000) : null;
}

/** O texto lido do leitor de código de barras (só dígitos; o leitor manda Enter no fim). */
export function codigoDaEtiqueta(lido: string): string | null {
  const d = lido.replace(/\D/g, '');
  return d.length >= 1 && d.length <= 12 ? d : null;
}

/** A etapa seguinte que o aplicativo do profissional oferece (o servidor confere a transição). */
export function proximasEtapas(etapa: string): string[] {
  switch (etapa) {
    case 'solicitado':
      return ['atribuido'];
    case 'atribuido':
      return ['emExecucao'];
    case 'emExecucao':
      return ['pausado', 'concluido'];
    case 'pausado':
      return ['emExecucao'];
    case 'reprovado':
      return ['emExecucao'];
    default:
      return [];
  }
}
