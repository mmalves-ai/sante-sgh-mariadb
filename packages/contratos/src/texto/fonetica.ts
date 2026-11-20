// Fonética do dicionário ortográfico pessoal (M27; TBDICIONARIO_TBUSERS.FONETICA, o mesmo dicionário nos dois
// sistemas): a chave que o outro sistema grava ao lado de cada palavra e usa para sugerir a grafia. Medida na cópia
// `pc` em 22/10/2026 (só contagens: as 77 palavras de 8 usuários, 77 de 77 reproduzidas): minúsculas; "ç" antes de
// "ã"/"õ" vira "s" (o "ç" das demais sílabas segue como "c"); sem acento; "qu" → "k"; "c" antes de a/o/u → "k" e antes
// de e/i → "s"; "ss" → "s"; "s" entre vogais → "z"; "y" → "i"; "g" antes de e/i → "j"; o "s" final sai; letras
// repetidas viram uma; saem as vogais e o "h". As preposições "de", "da", "do", "das" e "dos" têm a fonética vazia.
// O resultado cabe na coluna (VARCHAR(50)); a palavra é gravada em minúsculas, como as 77 do outro sistema.

/** Preposições com fonética vazia (7 de 7 fonéticas vazias da cópia). */
const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos']);

/** Tamanho de TBDICIONARIO_TBUSERS.PALAVRA e .FONETICA (VARCHAR(50)). */
export const TAMANHO_PALAVRA_DICIONARIO = 50;

/** A palavra como o outro sistema grava: sem espaço nas pontas e em minúsculas. */
export function palavraDoDicionario(palavra: string): string {
  return palavra.normalize('NFC').trim().toLowerCase();
}

/** A fonética da palavra (TBDICIONARIO_TBUSERS.FONETICA). */
export function foneticaDoDicionario(palavra: string): string {
  const p = palavraDoDicionario(palavra);
  if (PREPOSICOES.has(p)) return '';
  let s = p
    .replace(/ç(?=[ãõ])/g, 's')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  s = s
    .replace(/qu/g, 'k')
    .replace(/c(?=[aou])/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/ss/g, 's')
    .replace(/(?<=[aeiou])s(?=[aeiou])/g, 'z')
    .replace(/y/g, 'i')
    .replace(/g(?=[ei])/g, 'j')
    .replace(/s$/, '');
  s = s.replace(/(.)\1+/g, '$1');
  return s.replace(/[aeiouh]/g, '').slice(0, TAMANHO_PALAVRA_DICIONARIO);
}
