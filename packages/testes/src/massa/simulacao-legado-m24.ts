// Gravações "pelo outro sistema" do M24 (ficha, seção 10: disputa com a prescrição suspensa no legado enquanto o
// médico copia no novo; a exceção do TRG_PRPRESC_BIU), simuladas por SQL de teste na cópia, sempre na transação
// desfeita da integração e só sobre a prescrição sintética que o próprio teste gravou.
import type { Escritor, Leitor } from '@sgh/legado';

/** O item suspenso no outro sistema: todos os horários do item 'S' (como a suspensão do item do executável). */
export async function suspenderItemComoOLegado(e: Escritor, item: number): Promise<number> {
  return e.executar("UPDATE PRCHKGERAL SET SITUACAO_CHECAGEM = 'S' WHERE ID_PRLANGERAL = ?", [item]);
}

/** Suspensão da prescrição pela metade (sem quem suspende nem a justificativa): o TRG_PRPRESC_BIU recusa. */
export async function suspensaoIncompletaComoOLegado(e: Escritor, prescricao: number): Promise<number> {
  return e.executar('UPDATE PRPRESC SET DATA_HORA_SUSPENSAO = CURRENT_TIMESTAMP WHERE ID = ?', [prescricao]);
}

/** Leituras de conferência do teste de integração (só da prescrição sintética que o teste gravou). */
export async function justificativaDaSuspensao(e: Leitor, prescricao: number): Promise<unknown> {
  const [x] = await e.consultar('SELECT JUSTIFICATIVA_SUSPENSAO J FROM PRPRESC WHERE ID = ?', [prescricao], {
    teto: 1,
  });
  return x?.['J'];
}

export async function suspensaoDaPrescricao(e: Leitor, prescricao: number): Promise<unknown> {
  const [x] = await e.consultar('SELECT DATA_HORA_SUSPENSAO S FROM PRPRESC WHERE ID = ?', [prescricao], {
    teto: 1,
  });
  return x?.['S'];
}

export async function prescricoesDepoisDe(e: Leitor, atendimento: number, origem: number): Promise<number> {
  const [x] = await e.consultar(
    'SELECT COUNT(*) N FROM PRPRESC WHERE ID_ATCABECATEND_INTEGRACAO = ? AND ID > ?',
    [atendimento, origem],
    { teto: 1 },
  );
  return Number(x?.['N'] ?? 0);
}

/** A outra conexão que segura a prescrição (WITH LOCK), como o outro sistema com a tela em edição. */
export async function travarPrescricaoComoOLegado(e: Escritor, prescricao: number): Promise<void> {
  await e.consultar('SELECT ID FROM PRPRESC WHERE ID = ? WITH LOCK', [prescricao], { teto: 1 });
}

/**
 * Regra 16 (ficha do M24): a prescrição não lança na conta nem mexe no estoque. Marca, na transação, a maior chave
 * de FCLANEXT e de GELANSAI e o saldo do mês dos itens; `semContaNemEstoque` confere depois que nada mudou.
 */
export interface MarcasContaEstoque {
  readonly conta: number;
  readonly saida: number;
  readonly saldo: string;
}

async function saldoDoMes(e: Leitor, itens: readonly number[]): Promise<string> {
  if (itens.length === 0) return '';
  const ls = await e.consultar(
    `SELECT ITEM, QTDE FROM GESALDOS WHERE ANO = EXTRACT(YEAR FROM CURRENT_DATE)
        AND MES = EXTRACT(MONTH FROM CURRENT_DATE) AND ITEM IN (${itens.map(() => '?').join(', ')}) ORDER BY ITEM`,
    [...itens],
    { teto: 200 },
  );
  return ls.map((x) => `${String(x['ITEM'])}:${String(x['QTDE'])}`).join(';');
}

export async function marcasContaEstoque(e: Leitor, itens: readonly number[]): Promise<MarcasContaEstoque> {
  const [c] = await e.consultar('SELECT MAX(ID) M FROM FCLANEXT', [], { teto: 1, tempoMaximoMs: 120_000 });
  const [s] = await e.consultar('SELECT MAX(ID_GELANSAI) M FROM GELANSAI', [], {
    teto: 1,
    tempoMaximoMs: 120_000,
  });
  return { conta: Number(c?.['M'] ?? 0), saida: Number(s?.['M'] ?? 0), saldo: await saldoDoMes(e, itens) };
}

export async function semContaNemEstoque(
  e: Leitor,
  antes: MarcasContaEstoque,
  itens: readonly number[],
): Promise<{ conta: number; saida: number; saldoIgual: boolean }> {
  const [c] = await e.consultar('SELECT COUNT(*) N FROM FCLANEXT WHERE ID > ?', [antes.conta], { teto: 1 });
  const [s] = await e.consultar('SELECT COUNT(*) N FROM GELANSAI WHERE ID_GELANSAI > ?', [antes.saida], {
    teto: 1,
  });
  return {
    conta: Number(c?.['N'] ?? 0),
    saida: Number(s?.['N'] ?? 0),
    saldoIgual: (await saldoDoMes(e, itens)) === antes.saldo,
  };
}
