// Número e código de acompanhamento (manual m17: "O sistema mostra um número de acompanhamento"; "O notificador recebe
// o retorno ... mesmo quando notificou anonimamente, pelo número de acompanhamento"):
//   - o protocolo `NSP-AAAA-NNNNNN` sai do ano da notificação e do sequencial do ano (a API o tira de
//     SGH_GEN_QUA_NOTIFICACAO_ANO, por estabelecimento); é público e não identifica ninguém;
//   - o código de 10 caracteres (alfabeto sem letras ambíguas, cerca de 49 bits) é sorteado com bytes do gerador
//     criptográfico (a API passa `crypto.getRandomValues`), mostrado uma vez e guardado só como resumo SHA-256 (a API
//     compara em tempo constante). Sem o código, o número sozinho não abre a devolutiva.
// Sem dependência de plataforma: o domínio roda também na tela (o diálogo mostra o número que a API devolveu).
import {
  ALFABETO_CODIGO_ACOMPANHAMENTO,
  FORMATO_PROTOCOLO,
  TAMANHO_CODIGO_ACOMPANHAMENTO,
} from '@sgh/contratos';

/** O protocolo do ano e do sequencial (1 a 999.999). */
export function formatarProtocolo(ano: number, sequencial: number): string {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 9999) throw new Error('Ano inválido.');
  if (!Number.isInteger(sequencial) || sequencial < 1 || sequencial > 999_999)
    throw new Error('Sequencial fora da faixa do protocolo.');
  return `NSP-${ano}-${String(sequencial).padStart(6, '0')}`;
}

/** O ano e o sequencial de um protocolo, ou null. */
export function lerProtocolo(
  protocolo: string,
): { readonly ano: number; readonly sequencial: number } | null {
  const p = protocolo.trim().toUpperCase();
  if (!FORMATO_PROTOCOLO.test(p)) return null;
  return { ano: Number(p.slice(4, 8)), sequencial: Number(p.slice(9)) };
}

/**
 * Sorteia o código com `aleatorio(n)` (n bytes do gerador criptográfico). Rejeição dos bytes acima do maior múltiplo
 * do alfabeto: todos os caracteres com a mesma chance.
 */
export function gerarCodigoAcompanhamento(aleatorio: (n: number) => Uint8Array): string {
  const k = ALFABETO_CODIGO_ACOMPANHAMENTO.length;
  const limite = 256 - (256 % k);
  let codigo = '';
  for (let tentativas = 0; codigo.length < TAMANHO_CODIGO_ACOMPANHAMENTO; tentativas++) {
    if (tentativas > 64) throw new Error('Gerador aleatório sem variação.');
    for (const b of aleatorio(TAMANHO_CODIGO_ACOMPANHAMENTO * 2)) {
      if (b >= limite) continue;
      codigo += ALFABETO_CODIGO_ACOMPANHAMENTO[b % k];
      if (codigo.length === TAMANHO_CODIGO_ACOMPANHAMENTO) break;
    }
  }
  return codigo;
}
