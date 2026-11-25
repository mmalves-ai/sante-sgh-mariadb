// Busca do item do protocolo entre setores pelo número de negócio (F3.7, 06-FAT linha 22): quem monta o lote digita o
// número que tem na mão (o da conta, o do atendimento ou o do prontuário) e escolhe o item, sem conhecer o id.
//   conta              → a conta com esse número no estabelecimento;
//   atendimento        → o atendimento com esse número;
//   volume_prontuario  → os volumes do paciente com esse número de prontuário guardados no estabelecimento;
//   documento          → os documentos emitidos no atendimento com esse número.
// Só o estabelecimento da sessão (o mesmo filtro que a emissão confere de novo) e nada excluído.
import { TIPOS_ITEM_PROTOCOLO, type TipoItemProtocolo } from '@sgh/dominio-faturamento';
import { type Leitor, recusa } from '@sgh/nucleo';

export interface AlvoProtocolo {
  readonly id: number;
  readonly tipo: TipoItemProtocolo;
  readonly rotulo: string;
}

const TETO = 50;
const FORMATO_NUMERO = /^[A-Za-z0-9./-]{1,20}$/;

export function entradaBuscaAlvo(
  tipo: unknown,
  numero: unknown,
): { tipo: TipoItemProtocolo; numero: string } {
  const t = typeof tipo === 'string' ? tipo : '';
  if (!(TIPOS_ITEM_PROTOCOLO as readonly string[]).includes(t))
    throw recusa('entrada-invalida', 'Escolha o tipo do item.', { campos: ['tipo'] });
  const num = typeof numero === 'string' ? numero.trim() : '';
  if (!FORMATO_NUMERO.test(num))
    throw recusa('entrada-invalida', 'Informe o número (até 20 letras ou algarismos).', {
      campos: ['numero'],
    });
  return { tipo: t as TipoItemProtocolo, numero: num };
}

export async function alvosProtocoloPropria(
  l: Leitor,
  est: number,
  tipo: TipoItemProtocolo,
  numero: string,
): Promise<{ itens: AlvoProtocolo[] }> {
  const linhas = async (sql: string, p: unknown[]) =>
    l.consultar<Record<string, unknown>>(sql, p, { teto: TETO });
  let r: Record<string, unknown>[];
  if (tipo === 'conta')
    r = await linhas(
      `SELECT id, CONCAT('Conta ', numero, ' · ', DATE_FORMAT(inicio_em, '%d/%m/%Y')) AS rotulo FROM conta_hospitalar
        WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL ORDER BY id LIMIT ${TETO}`,
      [est, numero],
    );
  else if (tipo === 'atendimento')
    r = await linhas(
      `SELECT id, CONCAT('Atendimento ', numero, ' · ', DATE_FORMAT(entrada_em, '%d/%m/%Y')) AS rotulo FROM atendimento
        WHERE estabelecimento_id = ? AND numero = ? AND excluido_em IS NULL ORDER BY id LIMIT ${TETO}`,
      [est, numero],
    );
  else if (tipo === 'volume_prontuario') {
    if (!/^\d{1,19}$/.test(numero)) return { itens: [] };
    r = await linhas(
      `SELECT v.id, CONCAT('Prontuário ', p.numero_prontuario, ' · volume ', v.numero_volume, ' · ', t.descricao) AS rotulo
         FROM volume_prontuario v JOIN paciente p ON p.id = v.paciente_id
         JOIN tipo_documento_arquivo t ON t.id = v.tipo_documento_arquivo_id
        WHERE v.estabelecimento_id = ? AND p.numero_prontuario = ? AND v.excluido_em IS NULL
        ORDER BY v.numero_volume DESC, v.id DESC LIMIT ${TETO}`,
      [est, numero],
    );
  } else
    r = await linhas(
      `SELECT d.id, CONCAT('Atendimento ', a.numero, ' · ', d.tipo, ' · ', DATE_FORMAT(d.emitido_em, '%d/%m/%Y %H:%i'))
              AS rotulo
         FROM documento_emitido d JOIN atendimento a ON a.id = d.atendimento_id
        WHERE d.estabelecimento_id = ? AND a.estabelecimento_id = ? AND a.numero = ? AND d.excluido_em IS NULL
        ORDER BY d.emitido_em DESC, d.id DESC LIMIT ${TETO}`,
      [est, est, numero],
    );
  return { itens: r.map((x) => ({ id: Number(x['id']), tipo, rotulo: String(x['rotulo'] ?? '') })) };
}
