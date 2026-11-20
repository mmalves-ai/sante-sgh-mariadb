// Regras de tela da nutrição e do serviço social (M45, etapa 5): só apresentação (o servidor calcula o total da
// triagem, os percentuais, o mapa e o risco); a tela mostra a prévia do NRS-2002 para a pessoa conferir antes de gravar,
// mas o que vale é o total devolvido pelo servidor.
import type { SituacaoTriagemNutricional } from '@sgh/contratos';

export const leitoTexto = (l: { bloco: string; acomodacao: string; leito: string }) =>
  `${l.bloco} ${l.acomodacao} ${l.leito}`.trim();

/** "AAAA-MM-DDTHH:MM" → "DD/MM HH:MM". */
export function instanteCurto(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : '';
}

/** "AAAA-MM-DD" → "DD/MM/AAAA". */
export function dataLonga(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** A ordem de destaque da situação na fila (a vencida em vermelho; a atenção em amarelo). */
export function corDaSituacao(s: SituacaoTriagemNutricional): 'vermelho' | 'amarelo' | 'neutro' | 'verde' {
  if (s === 'vencida') return 'vermelho';
  if (s === 'atencao' || s === 'reavaliar') return 'amarelo';
  if (s === 'triado') return 'verde';
  return 'neutro';
}

export interface RespostasInicialNrs {
  readonly imcAbaixoDe20e5: boolean;
  readonly perdaDePeso3Meses: boolean;
  readonly ingestaoReduzidaSemana: boolean;
  readonly gravementeDoente: boolean;
}

/** Alguma resposta da triagem inicial do NRS-2002 é "sim": a tela abre a triagem final. */
export const precisaTriagemFinal = (r: RespostasInicialNrs) =>
  r.imcAbaixoDe20e5 || r.perdaDePeso3Meses || r.ingestaoReduzidaSemana || r.gravementeDoente;

/**
 * Prévia do NRS-2002 na tela (o servidor recalcula com a idade do cadastro): sem triagem final, 0; com ela, estado +
 * gravidade + 1 se 70 anos ou mais; null enquanto falta resposta.
 */
export function previaNrs(
  r: RespostasInicialNrs,
  estado: number | null,
  gravidade: number | null,
  idade: number | null,
): number | null {
  if (!precisaTriagemFinal(r)) return 0;
  if (estado === null || gravidade === null || idade === null) return null;
  return estado + gravidade + (idade >= 70 ? 1 : 0);
}

/** Percentual com uma casa e vírgula ("85,7%"). */
export const percentual = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : `${String(v).replace('.', ',')}%`;

/** Baixar um texto como arquivo (o ZPL das etiquetas quando a estação não tem a fila de impressão). */
export function urlDoTexto(conteudo: string, tipo = 'application/vnd.zebra-zpl'): string {
  return URL.createObjectURL(new Blob([conteudo], { type: tipo }));
}

/** Sem acento e em minúsculas, para a busca da lista. */
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * A busca das filas e do mapa (nome, prontuário ou leito): cada palavra do termo tem de aparecer em algum dos campos;
 * o termo vazio aceita tudo.
 */
export function combinaBusca(termo: string, campos: readonly (string | null | undefined)[]): boolean {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return true;
  const alvo = campos.map((c) => normalizar(c ?? '')).join(' ');
  return palavras.every((p) => alvo.includes(p));
}
