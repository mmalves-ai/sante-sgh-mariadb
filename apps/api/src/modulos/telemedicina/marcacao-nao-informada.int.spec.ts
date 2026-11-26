// Teleconsulta a partir de marcação migrada sem situação na origem (recusas da carga, fase 2): a marcação
// 'nao_informada' não vale (como a cancelada e a falta), e agendar a teleconsulta por ela é recusado com a situação,
// sem teleconsulta gravada. Massa SINTÉTICA da recepção (rc0101a, a marcação do dia), limpa antes e depois; a marcação
// volta à situação de antes. SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  garantirCliente,
  LOGIN,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from '../recepcao/massa-recepcao.spec-util.js';
import { tornarNaoInformada } from '../recepcao/marcacao-nao-informada.spec-util.js';
import type { ContextoTelemedicina } from './porta.js';
import { MENSAGEM_MARCACAO_NAO_INFORMADA, PortaTelemedicinaPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO)('teleconsulta de marcação migrada sem situação na origem (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTelemedicinaPropria;
  let m: Massa;
  let restaurar: (() => Promise<void>) | null = null;
  const c = (): ContextoTelemedicina => ({
    cliente: CLIENTE,
    estabelecimento: m.est,
    usuario: m.usuario,
    correlacao: 'teste-tele-nao-informada',
  });

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaTelemedicinaPropria(nucleo);
  });
  afterAll(async () => {
    if (m) await restaurar?.();
    await nucleo?.encerrar();
  });

  it('agendar pela marcação "nao_informada" é recusado com a situação; nenhuma teleconsulta gravada', async () => {
    restaurar = await tornarNaoInformada(nucleo, m.marcacao);
    await expect(
      porta.gravar(c(), null, (g) =>
        g.agendar({
          marcacao: m.marcacao,
          agenda: null,
          nomeAgenda: '',
          profissional: null,
          data: '2030-01-01',
          hora: '00:00',
          paciente: m.paciente,
          por: LOGIN,
        }),
      ),
    ).rejects.toMatchObject({ codigo: 'situacao', message: MENSAGEM_MARCACAO_NAO_INFORMADA });
    const [t] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-tele-nao-informada' }, (l) =>
      l.consultar<{ n: unknown }>('SELECT COUNT(*) AS n FROM teleconsulta WHERE marcacao_horario_id = ?', [
        m.marcacao,
      ]),
    );
    expect(Number(t?.n)).toBe(0);
  });
});
