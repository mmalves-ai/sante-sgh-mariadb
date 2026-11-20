// Regra 9 (ficha do M26): só liberados de setores publicados; médico externo só os pedidos em que é o solicitante;
// limite de tentativas e de taxa.
import { describe, expect, it } from 'vitest';
import {
  bloqueada,
  codigoProtocolo,
  dentroDaTaxa,
  depoisDaTentativa,
  ipParaGravar,
  type LaudoCandidato,
  visivelNoPortal,
} from './acesso.js';

const laudo: LaudoCandidato = {
  liberado: true,
  setorPublicado: true,
  situacao: 1,
  paciente: 7,
  solicitante: { conselho: 'CRM', uf: 'RS', numero: '012345' },
};

describe('portal de resultados (regra 9)', () => {
  it('o paciente vê só os seus laudos liberados de setores publicados', () => {
    const s = { perfil: 'paciente', paciente: 7 } as const;
    expect(visivelNoPortal(laudo, s)).toBe(true);
    expect(visivelNoPortal({ ...laudo, paciente: 8 }, s)).toBe(false);
    expect(visivelNoPortal({ ...laudo, liberado: false }, s)).toBe(false);
    expect(visivelNoPortal({ ...laudo, setorPublicado: false }, s)).toBe(false);
    expect(visivelNoPortal({ ...laudo, situacao: 2 }, s)).toBe(false);
  });

  it('o médico externo vê só os pedidos em que é o solicitante (DP-43)', () => {
    const m = { perfil: 'medicoExterno', conselho: 'crm', uf: 'rs', numero: '12345' } as const;
    expect(visivelNoPortal(laudo, m)).toBe(true);
    expect(
      visivelNoPortal({ ...laudo, solicitante: { conselho: 'CRM', uf: 'SC', numero: '12345' } }, m),
    ).toBe(false);
    expect(
      visivelNoPortal({ ...laudo, solicitante: { conselho: 'CRM', uf: 'RS', numero: '54321' } }, m),
    ).toBe(false);
    expect(visivelNoPortal({ ...laudo, solicitante: null }, m)).toBe(false);
  });

  it('limite de tentativas com bloqueio temporário', () => {
    const agora = '2026-10-22T10:00:00.000Z';
    let t = { erradas: 0, bloqueadaAte: null as string | null };
    for (let i = 0; i < 4; i++) t = depoisDaTentativa(t, false, agora, 5, 15);
    expect(t).toEqual({ erradas: 4, bloqueadaAte: null });
    t = depoisDaTentativa(t, false, agora, 5, 15);
    expect(t.bloqueadaAte).toBe('2026-10-22T10:15:00.000Z');
    expect(bloqueada(t, agora)).toBe(true);
    expect(bloqueada(t, '2026-10-22T10:16:00.000Z')).toBe(false);
    // Depois do bloqueio, a contagem recomeça; o acerto zera.
    expect(depoisDaTentativa(t, false, '2026-10-22T10:16:00.000Z', 5, 15)).toEqual({
      erradas: 1,
      bloqueadaAte: null,
    });
    expect(depoisDaTentativa(t, true, agora, 5, 15)).toEqual({ erradas: 0, bloqueadaAte: null });
    expect(depoisDaTentativa(t, false, agora, 5, 15).erradas).toBe(6);
  });

  it('limite de taxa por minuto', () => {
    const agora = 1_000_000;
    expect(dentroDaTaxa([agora - 70_000, agora - 1000], agora, 2)).toBe(true);
    expect(dentroDaTaxa([agora - 2000, agora - 1000], agora, 2)).toBe(false);
  });

  it('código do protocolo e o IP gravado', () => {
    const c = codigoProtocolo(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(c).toBe('23456789AB');
    expect(() => codigoProtocolo(new Uint8Array(3))).toThrow();
    expect(ipParaGravar('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(ipParaGravar('  ')).toBe('desconhecido');
  });
});
