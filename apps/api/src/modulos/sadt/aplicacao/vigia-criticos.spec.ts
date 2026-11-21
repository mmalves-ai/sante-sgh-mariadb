// W0-10 (11d2b): o escalonamento do valor crítico pelo relógio do BANCO (emitidoEm e prazoEm em hora local, sem fuso).
// Antes, a vigia comparava com o relógio do processo: num servidor em -03:00 a hora local lida como UTC adiantava o
// prazo em 3 horas e o aviso subia ao supervisor no primeiro ciclo.
import { describe, expect, it } from 'vitest';
import type { PortaSadt } from '../porta.js';
import { VigiaCriticos } from './vigia-criticos.js';

const AGORA_BANCO = '2026-11-19T10:00:00';

function porta(emitidoEm: string, prazoMinutos = 30, nivel = 0) {
  const subidas: { aviso: number; nivel: number }[] = [];
  const prazoEm = new Date(Date.parse(`${emitidoEm}Z`) + prazoMinutos * 60_000).toISOString().slice(0, 19);
  const p = {
    destino: 'memoria',
    relogio: async () => ({ hoje: AGORA_BANCO.slice(0, 10), agora: AGORA_BANCO }),
    liberadosComCritico: async () => [],
    avisos: async () => [{ id: 7, emitidoEm, prazoEm, nivel, ciencia: null, paciente: { id: 1001 } }],
    gravarSgh: async (_c: unknown, _t: unknown, f: (g: unknown) => Promise<boolean>) =>
      f({
        escalonarAviso: async (r: { aviso: number; nivel: number }) => {
          subidas.push(r);
          return true;
        },
      }),
  };
  return { porta: p as unknown as PortaSadt, subidas };
}

// O processo 3 horas à frente do banco (servidor em UTC lendo a hora local de -03:00, ou o inverso).
const processoAdiantado = () => new Date(Date.parse(`${AGORA_BANCO}Z`) + 3 * 3_600_000);

describe('VigiaCriticos: escalonamento pelo relógio do banco', () => {
  it('dentro do prazo não sobe, mesmo com o relógio do processo em outro fuso', async () => {
    const { porta: p, subidas } = porta('2026-11-19T09:50:00');
    const v = new VigiaCriticos(p, 'rede', ['H'], null, null, processoAdiantado);
    expect(await v.ciclo('H')).toEqual({ avisos: 0, escalonados: 0 });
    expect(subidas).toEqual([]);
  });

  it('vencido o prazo sobe ao plantonista; vencido o dobro, ao supervisor', async () => {
    const um = porta('2026-11-19T09:29:00');
    expect(
      (await new VigiaCriticos(um.porta, 'rede', ['H'], null, null, processoAdiantado).ciclo('H'))
        .escalonados,
    ).toBe(1);
    expect(um.subidas).toEqual([{ aviso: 7, nivel: 1 }]);
    const dois = porta('2026-11-19T08:59:00', 30, 1);
    await new VigiaCriticos(dois.porta, 'rede', ['H'], null, null, processoAdiantado).ciclo('H');
    expect(dois.subidas).toEqual([{ aviso: 7, nivel: 2 }]);
  });

  it('prazo de 1 minuto: sobe no ciclo seguinte ao minuto', async () => {
    const { porta: p, subidas } = porta('2026-11-19T09:58:59', 1);
    await new VigiaCriticos(p, 'rede', ['H'], null, null).ciclo('H');
    expect(subidas).toEqual([{ aviso: 7, nivel: 1 }]);
  });
});

describe('VigiaCriticos: falha de um aviso não trava o ciclo', () => {
  it('o exame sem aviso fica contado, o escalonamento segue e o cursor não avança', async () => {
    const subidas: { aviso: number; nivel: number }[] = [];
    const desdes: Date[] = [];
    const recusa = Object.assign(new Error('pendente'), { problema: { codigo: 'modelo-pendente' } });
    const p = {
      destino: 'propria',
      relogio: async () => ({ hoje: AGORA_BANCO.slice(0, 10), agora: AGORA_BANCO }),
      liberadosComCritico: async (_c: unknown, o: { desde: Date }) => {
        desdes.push(o.desde);
        return [
          { exame: 11, chave: 'R1:1', liberacao: 21, liberadoEm: new Date(), paciente: 31, atendimento: 41 },
        ];
      },
      avisos: async () => [
        {
          id: 7,
          emitidoEm: '2026-11-19T09:00:00',
          prazoEm: '2026-11-19T09:30:00',
          nivel: 0,
          ciencia: null,
          paciente: { id: 1 },
        },
      ],
      gravarSgh: async (_c: unknown, _t: unknown, f: (g: unknown) => Promise<unknown>) =>
        f({
          avisarCriticos: async () => Promise.reject(recusa),
          escalonarAviso: async (r: { aviso: number; nivel: number }) => {
            subidas.push(r);
            return true;
          },
        }),
    } as unknown as PortaSadt;
    const avisos: string[] = [];
    const log = { warn: (m: string) => void avisos.push(m) };
    const v = new VigiaCriticos(
      p,
      'rede',
      ['H'],
      null,
      null,
      undefined,
      null,
      () => ({ cliente: 'c', estabelecimento: 1 }),
      log,
    );
    // Sem configuração a vigia só vale em memória: o teste força a funcionalidade ligada.
    v.ligada = async () => true;
    const r = await v.ciclo('H');
    expect(r).toMatchObject({ avisos: 0, escalonados: 1, semAviso: 1, codigos: ['modelo-pendente'] });
    expect(subidas).toEqual([{ aviso: 7, nivel: 2 }]);
    expect(avisos[0]).toMatch(/1 exame\(s\) sem aviso.*modelo-pendente/);
    expect(avisos[0]).not.toMatch(/31|41/);
    await v.ciclo('H');
    // O cursor não andou: a segunda leitura começa no mesmo ponto (início da véspera).
    expect(desdes[1]!.getTime()).toBe(desdes[0]!.getTime());
  });
});
