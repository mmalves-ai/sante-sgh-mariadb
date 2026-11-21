// Textos e marcas sintéticos para a massa dos testes de integração sobre o MariaDB (sem banco, sem I/O).
// Substitui as partes puras dos antigos roteiros de reprodução da captura (lote F2.2 05-07), que gravavam no sistema
// de origem numa transação desfeita: esse teste de assinatura não vale neste projeto (AGENTS.md) e foi removido.
// Melhoria: um único ponto para os textos de acentuação e as marcas de massa, em vez de cópias espalhadas por roteiro.
// Melhoria: o corpus traz caracteres de 2, 3 e 4 bytes em UTF-8 (fora do plano básico: U+1D11E e um emoji), de modo
// que só uma coluna utf8mb4 o guarda intacto; textos-sinteticos.int.spec.ts grava e relê byte a byte no MariaDB.

let seq = 0;

/** Palavra sintética única (só letras minúsculas), para nomes de cadastro que não podem repetir. */
export function palavraSintetica(): string {
  const n = Date.now() * 37 + seq++;
  return `sgh${n
    .toString(26)
    .split('')
    .map((d) => String.fromCharCode(97 + parseInt(d, 26)))
    .join('')
    .slice(-10)}`;
}

/** Frase curta com acentos, ordinais, aspas tipográficas, moeda e dois caracteres de 4 bytes (U+1D11E e U+1F48A). */
export const CORPUS_ACENTUADO = 'Ação, pé, avó, Ü; “aspas” – € 1,50; 1º, 2ª; ½ dose; clave \u{1D11E}; cápsula \u{1F48A}.';

/** Texto longo (cerca de 84 mil caracteres, 113 mil bytes em UTF-8) com acentuação, para campos de texto livre extensos. */
export function textoLongoAcentuado(): string {
  return `Respostas com acentuação: ção, ã, é, ü, ¿, “aspas”, € — ${'linha de texto longo áéíóú ÇÑ ºª \u{1F48A}\n'.repeat(2400)}`;
}

/** Marca das linhas sintéticas do centro cirúrgico, para a limpeza no afterAll. */
export const MARCA_CENTRO_CIRURGICO = 'SINTETICO SGH CENTRO CIRURGICO';
