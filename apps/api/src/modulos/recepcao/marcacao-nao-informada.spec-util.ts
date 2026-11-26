// Marcação migrada sem situação na origem (recusas da carga, fase 2) sobre a massa SINTÉTICA da recepção (rc0101a):
// a marcação vira origem 'migracao' com a situação de significado 'nao_informada' (a semente 05_AGE/99zk,
// 'nao_informada_origem', que a migração leva ao cliente que já existe) e volta ao que era no fim do teste.
import type { NucleoProprio } from '@sgh/nucleo';
import { CLIENTE } from './massa-recepcao.spec-util.js';

/** A situação 'nao_informada_origem' da semente: o teste falha se a migração 05_AGE/99zk não estiver aplicada. */
export async function situacaoNaoInformada(nucleo: NucleoProprio): Promise<number> {
  const r = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'marcacao-nao-informada' }, (l) =>
    l.uma<{ id: unknown }>(
      "SELECT id FROM situacao_marcacao WHERE codigo = 'nao_informada_origem' AND significado = 'nao_informada'",
      [],
    ),
  );
  if (!r)
    throw new Error(
      'situação nao_informada_origem ausente: aplique a migração 05_AGE/99zk no cliente de teste.',
    );
  return Number(r.id);
}

/** Torna a marcação migrada sem situação; devolve a função que restaura a situação e a origem anteriores. */
export async function tornarNaoInformada(
  nucleo: NucleoProprio,
  marcacao: number,
): Promise<() => Promise<void>> {
  const ctx = { cliente: CLIENTE, correlacao: 'marcacao-nao-informada' };
  const situacao = await situacaoNaoInformada(nucleo);
  const antes = await nucleo.escrever(ctx, async (e) => {
    const a = await e.uma<{ s: unknown; o: unknown }>(
      'SELECT situacao_marcacao_id AS s, origem AS o FROM marcacao_horario WHERE id = ?',
      [marcacao],
    );
    await e.executar(
      "UPDATE marcacao_horario SET situacao_marcacao_id = ?, origem = 'migracao' WHERE id = ?",
      [situacao, marcacao],
    );
    return a;
  });
  return () =>
    nucleo
      .escrever(ctx, (e) =>
        e.executar('UPDATE marcacao_horario SET situacao_marcacao_id = ?, origem = ? WHERE id = ?', [
          antes?.s,
          antes?.o,
          marcacao,
        ]),
      )
      .then(() => undefined);
}
