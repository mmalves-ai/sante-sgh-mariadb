// Itens agendáveis na marcação migrada sem situação na origem (recusas da carga, fase 2): a crítica e o lançamento dos
// itens recusam a marcação 'nao_informada' (encerrada, como a cancelada e a falta) com `marcacao-encerrada`, sem
// gravar item. Massa SINTÉTICA da recepção (rc0101a, a marcação do dia); a marcação volta à situação de antes.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  CODIGO_EST,
  garantirCliente,
  LOGIN,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from '../recepcao/massa-recepcao.spec-util.js';
import { tornarNaoInformada } from '../recepcao/marcacao-nao-informada.spec-util.js';
import { ItensAgendaveisPropria } from './itens-agendaveis.js';

const encerrada = { problema: expect.objectContaining({ codigo: 'marcacao-encerrada' }) };

describe.skipIf(SEM_BANCO)('itens agendáveis na marcação migrada sem situação na origem (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let itens: ItensAgendaveisPropria;
  let m: Massa;
  let restaurar: (() => Promise<void>) | null = null;
  const ctx = () => ({ hospital: CODIGO_EST, login: LOGIN });

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    itens = new ItensAgendaveisPropria(nucleo, CLIENTE);
  });
  afterAll(async () => {
    if (m) await restaurar?.();
    await nucleo?.encerrar();
  });

  it('a crítica e o lançamento recusam a marcação "nao_informada" com marcacao-encerrada; nada gravado', async () => {
    restaurar = await tornarNaoInformada(nucleo, m.marcacao);
    const antes = async () =>
      Number(
        (
          await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'itens-nao-informada' }, (l) =>
            l.consultar<{ n: unknown }>(
              'SELECT COUNT(*) AS n FROM marcacao_horario_item WHERE marcacao_horario_id = ?',
              [m.marcacao],
            ),
          )
        )[0]?.n,
      );
    const n0 = await antes();
    await expect(itens.criticar(ctx(), m.marcacao, [])).rejects.toMatchObject(encerrada);
    const chave = `ia-ni-${randomUUID()}`;
    await expect(
      itens.lancar(
        { ...ctx(), correlacao: chave.slice(0, 40), chaveIdempotencia: chave },
        { marcacao: m.marcacao, itens: [1] },
      ),
    ).rejects.toMatchObject(encerrada);
    expect(await antes()).toBe(n0);
  });
});
