// Ciclo da vigia do valor crítico sobre a porta própria do SADT, no MariaDB real (cliente f22_o2; massa SINTÉTICA).
// Contrato de efeito: um resultado crítico liberado sem aviso (o que chega pela interface ou pela autoliberação) ganha o
// aviso em aviso_valor_critico; o aviso vencido sobe de nível. Enquanto a porta própria não cria o aviso
// (GRAVACOES_PENDENTES.avisarCriticos, pedido ao 02-09), o teste prova que a falha fica contada com o código, que o
// escalonamento segue e que o exame volta no ciclo seguinte. Quando o 02-09 ligar a operação, o mesmo teste passa a
// exigir a linha do aviso.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAVACOES_PENDENTES, PortaSadtPropria } from '../porta-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import { VigiaCriticos } from './vigia-criticos.js';

describe.skipIf(SEM_BANCO)('vigia do valor crítico (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSadt | null = null;
  let resultadoSemAviso = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-v10' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'V10');
    resultadoSemAviso = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-v10-prep' }, async (e) => {
      // O aviso semeado venceu o dobro do prazo (sobe ao supervisor); um segundo resultado crítico chega sem aviso.
      // Folga de 8 horas: hoje o relógio da porta própria (relogio: hora local do fuso do estabelecimento) e o instante
      // gravado (TIMESTAMP lido em UTC) não estão na mesma referência, o que atrasa o escalonamento em até 3 horas
      // (pedido ao 02-09 em saida/02-10.json). Com a folga, o teste prova o ciclo sem depender dessa correção.
      await e.executar(
        `UPDATE aviso_valor_critico SET gerado_em = DATE_SUB(NOW(), INTERVAL 8 HOUR),
            prazo_em = DATE_SUB(NOW(), INTERVAL 450 MINUTE) WHERE id = ?`,
        [m!.aviso],
      );
      return e.inserir(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, forma_entrada, situacao,
           numero_versao, resultado_em, liberado_em, liberado_por_profissional_id, critico, criado_em, versao)
         VALUES (?, ?, ?, 'interface', 'liberado', 1, NOW(), NOW(), ?, TRUE, NOW(), 1)`,
        [m!.itemLab2, m!.base.paciente, m!.setorLab, m!.base.profissional],
      );
    });
  }, 60_000);
  afterAll(async () => {
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('o crítico sem aviso ganha o aviso (ou fica contado com o código) e o vencido sobe de nível', async () => {
    expect(resultadoSemAviso).toBeGreaterThan(0);
    const c = contexto(m!);
    const hospital = c.hospital ?? '';
    const porta = new PortaSadtPropria(nucleo);
    const log: string[] = [];
    const v = new VigiaCriticos(
      porta,
      'rede-teste',
      [hospital],
      null,
      null,
      undefined,
      null,
      () => ({ cliente: CLIENTE, estabelecimento: m!.base.est }),
      { warn: (x: string) => void log.push(x) },
    );
    v.ligada = async () => true;
    const r = await v.ciclo(hospital);
    expect(r.escalonados).toBe(1);
    expect(
      await um('SELECT nivel_escalonamento FROM aviso_valor_critico WHERE id = ?', [m!.aviso]),
    ).toMatchObject({ nivel_escalonamento: 2 });
    const novo = await um('SELECT COUNT(*) AS n FROM aviso_valor_critico WHERE resultado_exame_id = ?', [
      resultadoSemAviso,
    ]);
    if (GRAVACOES_PENDENTES['avisarCriticos']) {
      expect(r).toMatchObject({ avisos: 0, semAviso: 1, codigos: ['modelo-pendente'] });
      expect(Number(novo?.['n'])).toBe(0);
      expect(log.join('\n')).toMatch(/1 exame\(s\) sem aviso/);
      // O exame volta no ciclo seguinte (o cursor não andou) e o aviso já escalonado não sobe de novo.
      expect(await v.ciclo(hospital)).toMatchObject({ avisos: 0, escalonados: 0, semAviso: 1 });
    } else {
      expect(r).toMatchObject({ avisos: 1 });
      expect(Number(novo?.['n'])).toBe(1);
      expect(await v.ciclo(hospital)).toEqual({ avisos: 0, escalonados: 0 });
    }
  });
});
