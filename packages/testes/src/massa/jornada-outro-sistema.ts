// O outro sistema gravando por fora na jornada do M27 (cap-14 §14.2.2, escritor legado simulado), sempre na transação
// desfeita da integração. Nenhuma receita do novo faz estes comandos.
//   - A conta do setor (SICADATE) do paciente INTERNADO: no novo, `sadt.abrirRequisicao` recusa o internado
//     (`internacao-fora`: é da internação) e a internação do M21 não a abre; na coexistência ela nasce no outro sistema
//     (o pedido do diagnóstico do internado). A jornada a simula como ele grava — a linha de conta do internado mais
//     recente da cópia, copiada para a internação da jornada — e o novo segue o exame dali (J10: começado lá, terminado
//     aqui). Lacuna registrada nas evidências do M27 (D-SADT-INT-27).
//   - A alteração por fora da linha que o novo leu (a colisão da regra 9).
import { type Escritor, lerMetadadosTabela } from '@sgh/legado';

const num = (v: unknown) => Number(v ?? 0);

/** Colunas que o gatilho preenche ou que identificam a linha copiada (nunca copiadas). */
const DO_GATILHO = new Set(['ID', 'CONTROLE']);

export async function outroSistemaAbreContaSadtDoInternado(
  e: Escritor,
  i: { readonly cab: number; readonly reg: number; readonly pront: number },
): Promise<number> {
  const [modelo] = await e.consultar(
    `SELECT FIRST 1 s.ID FROM SICADATE s WHERE s.ATEND = 'I' AND s.DATA >= DATEADD(-180 DAY TO CURRENT_DATE)
      ORDER BY s.ID DESC`,
    [],
    { teto: 1, tempoMaximoMs: 60_000 },
  );
  if (!modelo) throw new Error('Nenhuma conta do setor de internado recente na cópia.');
  const meta = await lerMetadadosTabela(e, 'SICADATE');
  const trocas: Record<string, string> = {
    REG: '?',
    CONTA: '?',
    PRONT: '?',
    ID_ATCABECATEND: '?',
    ATEND: "'I'",
    DATA: 'CURRENT_DATE',
  };
  const colunas = meta.colunas.filter((c) => !c.calculada && !DO_GATILHO.has(c.nome)).map((c) => c.nome);
  const valores = colunas.map((c) => trocas[c] ?? `s.${c}`);
  const params: unknown[] = [];
  for (const c of colunas)
    if (trocas[c] === '?')
      params.push(c === 'REG' || c === 'CONTA' ? i.reg : c === 'PRONT' ? i.pront : i.cab);
  const r = await e.executarRetornando(
    `INSERT INTO SICADATE (${colunas.join(', ')}) SELECT ${valores.join(', ')} FROM SICADATE s WHERE s.ID = ?
      RETURNING ID`,
    [...params, num(modelo['ID'])],
  );
  return num(r['ID']);
}

/**
 * O outro sistema registra a previsão de alta na internação que o novo leu (a tela da internação de lá): o gatilho
 * TRG_RICADINT_SGHI_BU troca o carimbo DATA_HORA_ULTIMA_ATUALIZACAO, e a gravação do novo com a versão lida recusa.
 */
export async function outroSistemaAlteraAInternacao(e: Escritor, reg: number): Promise<void> {
  const n = await e.executar('UPDATE RICADINT SET ALTAPREV = CURRENT_DATE + 3 WHERE REG = ?', [reg]);
  if (n !== 1) throw new Error('A internação da jornada não foi alterada por fora.');
}
