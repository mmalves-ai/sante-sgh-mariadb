// Chegada do agendado cuja marcação veio migrada sem situação na origem (recusas da carga, fase 2): a recepção recusa
// registrarChegada com `marcacao-nao-informada` (a marcação está encerrada, só consulta) e nada grava: a senha segue
// sem atendimento, a marcação sem chegada e sem histórico. Massa SINTÉTICA da recepção (rc0101a), limpa antes e
// depois; a marcação volta à situação de antes. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  CODIGO_EST,
  garantirCliente,
  limparMovimento,
  LOGIN,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from './massa-recepcao.spec-util.js';
import { tornarNaoInformada } from './marcacao-nao-informada.spec-util.js';
import { PortaRecepcaoPropria } from './porta-propria.js';
import type { ContextoGravacao } from './tipos.js';

const c = { rede: 'rede-teste', hospital: CODIGO_EST };
const g = (): ContextoGravacao => {
  const chave = `rcni-${randomUUID()}`;
  return { login: LOGIN, correlacao: chave.slice(0, 40), chaveIdempotencia: chave };
};

describe.skipIf(SEM_BANCO)('chegada de marcação migrada sem situação na origem (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRecepcaoPropria;
  let m: Massa;
  let restaurar: (() => Promise<void>) | null = null;
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-rcni' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
    await limparMovimento(nucleo, m);
  });
  afterAll(async () => {
    if (m) {
      await limparMovimento(nucleo, m);
      await restaurar?.();
    }
    await nucleo?.encerrar();
  });

  it('registrarChegada recusa a marcação "nao_informada" com marcacao-nao-informada; nada gravado', async () => {
    restaurar = await tornarNaoInformada(nucleo, m.marcacao);
    const senha = Number(
      (
        await porta.executar(
          c,
          'recepcao.emitirSenha',
          { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
          g(),
        )
      ).resultado['senha'],
    );
    await expect(
      porta.executar(c, 'recepcao.registrarChegada', { senha, tipo: 'consulta', marcacao: m.marcacao }, g()),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'marcacao-nao-informada' }) });
    const [mh] = await ler<{ chegada_em: unknown; sig: unknown }>(
      `SELECT mh.chegada_em, s.significado AS sig FROM marcacao_horario mh
         JOIN situacao_marcacao s ON s.id = mh.situacao_marcacao_id WHERE mh.id = ?`,
      [m.marcacao],
    );
    expect(mh).toMatchObject({ chegada_em: null, sig: 'nao_informada' });
    const [h] = await ler<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM marcacao_horario_historico WHERE marcacao_horario_id = ?',
      [m.marcacao],
    );
    expect(Number(h?.n)).toBe(0);
    const [a] = await ler<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM atendimento_senha WHERE senha_emitida_id = ?',
      [senha],
    );
    expect(Number(a?.n)).toBe(0);
  });
});
