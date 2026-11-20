// O provedor da sala da teleconsulta (M50, etapa 4; ficha, seção 11): fora de produção, só o simulado (nada sai da
// máquina); em produção e no modo `desligado`, nenhum (a autorização do dono é pré-requisito da chave `telemedicina`).
import { describe, expect, it } from 'vitest';
import { ProvedorIndisponivel, ProvedorSimulado, provedorDoAmbiente, salaParaQuemVe } from './provedor.js';

describe('provedor da teleconsulta', () => {
  it('simulado fora de produção; desligado ou produção: indisponível', async () => {
    expect(provedorDoAmbiente({}, 'dev')).toBeInstanceOf(ProvedorSimulado);
    expect(provedorDoAmbiente({ TELECONSULTA_PROVEDOR_MODO: 'simulador' }, 'homologacao')).toBeInstanceOf(
      ProvedorSimulado,
    );
    expect(provedorDoAmbiente({ TELECONSULTA_PROVEDOR_MODO: 'desligado' }, 'dev')).toBeInstanceOf(
      ProvedorIndisponivel,
    );
    const prod = provedorDoAmbiente({}, 'producao');
    expect(prod.disponivel).toBe(false);
    await expect(prod.criarSala('x')).rejects.toThrow(/não configurado/);
    expect(prod.endereco('S', 'medico')).toBe('');
  });

  it('a sala simulada: identificador aleatório e o endereço por papel; sem sala, nada', async () => {
    const p = new ProvedorSimulado();
    const a = await p.criarSala('tele-aa-1');
    const b = await p.criarSala('tele-aa-1');
    expect(a.sala).toMatch(/^SIM-SALA-[0-9A-F]{16}$/);
    expect(a.sala).not.toBe(b.sala);
    expect(
      salaParaQuemVe(
        p,
        { provedor: 'simulado', sala: a.sala, salaAbertaEm: '2026-11-10T10:00:00' },
        'paciente',
      ),
    ).toEqual({
      provedor: 'simulado',
      endereco: `simulado:${a.sala}:paciente`,
      abertaEm: '2026-11-10T10:00:00',
    });
    expect(salaParaQuemVe(p, { provedor: null, sala: null, salaAbertaEm: null }, 'medico')).toBeNull();
  });
});
