// Busca de palavra nos registros do paciente (ficha do M15, seção 4): o texto é decodificado no servidor e a
// busca ignora acento e maiúsculas. Devolve a quantidade de ocorrências e um trecho em volta da primeira (o
// trecho vai só a quem tem a permissão; nunca à trilha, que guarda só a quantidade).

export const TAMANHO_TRECHO = 160;

/** Sem acento e minúscula, mantendo o comprimento (para recortar o trecho do texto original). */
export function dobrar(s: string): string {
  let r = '';
  for (const ch of s) {
    const d = ch.normalize('NFD').replace(/\p{M}/gu, '');
    r += (d.length === 1 ? d : ch).toLowerCase().slice(0, ch.length).padEnd(ch.length, ' ');
  }
  return r;
}

export interface Ocorrencias {
  readonly ocorrencias: number;
  readonly trecho: string;
}

export function procurarPalavra(texto: string, termo: string): Ocorrencias {
  const alvo = dobrar(termo.trim());
  if (alvo.length < 3) return { ocorrencias: 0, trecho: '' };
  const base = dobrar(texto);
  let n = 0;
  let primeira = -1;
  let i = base.indexOf(alvo);
  while (i >= 0) {
    if (primeira < 0) primeira = i;
    n++;
    i = base.indexOf(alvo, i + alvo.length);
  }
  if (n === 0) return { ocorrencias: 0, trecho: '' };
  const meio = Math.max(0, primeira - Math.floor((TAMANHO_TRECHO - alvo.length) / 2));
  const fim = Math.min(texto.length, meio + TAMANHO_TRECHO);
  const trecho = `${meio > 0 ? '…' : ''}${texto.slice(meio, fim).replace(/\s+/g, ' ').trim()}${fim < texto.length ? '…' : ''}`;
  return { ocorrencias: n, trecho };
}
