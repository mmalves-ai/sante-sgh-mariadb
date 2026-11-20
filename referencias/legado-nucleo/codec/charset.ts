// O charset do texto de cada estabelecimento (M58; ficha, seção 6; regras 6 e 7): o parâmetro `legado.charset`
// (SGH_CFG_PARAMETRO) lido pelo núcleo na partida e conferido contra o charset declarado do banco (RDB$DATABASE). O
// codec de texto consulta este registro pelo estabelecimento do leitor; sem registro, CP1252 (o banco da coexistência).
// O desencontro é recusado na partida: gravar CP1252 num banco UTF-8, ou o contrário, corromperia o texto dos dois
// sistemas. A regra pura também mora em @sgh/dominio-config (plataforma.ts, para o cartão); aqui é a do adaptador.
import type { CharsetLegado } from '@sgh/contratos';
import type { Leitor } from '../transacao.js';

export class ErroCharset extends Error {
  override readonly name = 'ErroCharset';
}

/** O charset do parâmetro que casa com o declarado do banco: NONE (e WIN1252) pede CP1252; UTF8 pede UTF8. */
export function charsetDoBanco(charsetBanco: string): CharsetLegado | null {
  const c = charsetBanco.trim().toUpperCase();
  if (c === 'NONE' || c === 'WIN1252') return 'CP1252';
  if (c === 'UTF8' || c === 'UTF-8') return 'UTF8';
  return null;
}

/** Recusa a partida com o banco e o parâmetro desencontrados (mensagem sem dado: só os dois nomes). */
export function conferirCharsetPartida(charsetBanco: string, parametro: CharsetLegado): CharsetLegado {
  const esperado = charsetDoBanco(charsetBanco);
  if (esperado === null)
    throw new ErroCharset(`Charset do banco não suportado (${charsetBanco.trim() || 'vazio'}).`);
  if (esperado !== parametro)
    throw new ErroCharset(
      `O banco está em ${charsetBanco.trim().toUpperCase()} e o parâmetro legado.charset diz ${parametro}: a partida recusa o estabelecimento até a TI acertar o parâmetro.`,
    );
  return parametro;
}

const registro = new Map<string, CharsetLegado>();

/** Registra o charset conferido na partida (núcleo). */
export function registrarCharsetTexto(estabelecimento: string, charset: CharsetLegado): void {
  registro.set(estabelecimento, charset);
}

/** O charset do texto do estabelecimento; sem registro (antes da partida, testes): CP1252. */
export function charsetTextoDe(estabelecimento: string | null | undefined): CharsetLegado {
  return (estabelecimento && registro.get(estabelecimento)) || 'CP1252';
}

/** Só para os testes: limpa o registro. */
export function limparCharsetsTexto(): void {
  registro.clear();
}

export interface CharsetLido {
  /** RDB$DATABASE.RDB$CHARACTER_SET_NAME (NONE no banco da coexistência). */
  readonly charsetBanco: string;
  /** O valor vigente de `legado.charset` no estabelecimento; o padrão do registro (CP1252) se não houver. */
  readonly parametro: CharsetLegado;
}

/**
 * Lê o charset declarado e o parâmetro (READ ONLY). SGH_CFG_PARAMETRO ausente (banco sem os scripts SGH_) vale o
 * padrão; valor fora da lista vale null para o chamador recusar.
 */
export async function lerCharsetTexto(l: Leitor): Promise<CharsetLido> {
  const [b] = await l.consultar('SELECT TRIM(RDB$CHARACTER_SET_NAME) CS FROM RDB$DATABASE', [], {
    teto: 1,
    tempoMaximoMs: 10_000,
  });
  let parametro: CharsetLegado = 'CP1252';
  try {
    const [p] = await l.consultar(
      `SELECT FIRST 1 TRIM(VALOR) V FROM SGH_CFG_PARAMETRO
        WHERE HOSPITAL = ? AND CHAVE = 'legado.charset' AND NIVEL = 'estabelecimento'
          AND VIGENTE_DESDE <= LOCALTIMESTAMP AND (VIGENTE_ATE IS NULL OR VIGENTE_ATE > LOCALTIMESTAMP)
        ORDER BY ID DESC`,
      [l.hospital],
      { teto: 1, tempoMaximoMs: 10_000 },
    );
    const v =
      p?.['V'] === null || p?.['V'] === undefined
        ? null
        : String(p['V'])
            .trim()
            .replace(/^"(.*)"$/, '$1');
    if (v === 'UTF8' || v === 'CP1252') parametro = v;
    else if (v) throw new ErroCharset(`Valor fora da lista em legado.charset (${v.slice(0, 10)}).`);
  } catch (e) {
    if (e instanceof ErroCharset) throw e;
    // tabela SGH_ ausente: o padrão do registro (CP1252)
  }
  const cs = b?.['CS'];
  return { charsetBanco: cs === null || cs === undefined ? 'NONE' : String(cs).trim() || 'NONE', parametro };
}
