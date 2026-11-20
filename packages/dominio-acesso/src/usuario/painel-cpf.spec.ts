import { describe, expect, it } from 'vitest';
import { montarPainelCpf } from './painel-cpf.js';

const c = (login: string, o: { grupo?: string; ativo?: boolean } = {}) => ({
  login,
  nome: null,
  grupo: o.grupo ?? 'MEDICOS',
  ativo: o.ativo ?? true,
  bloqueado: false,
});

describe('painel de identidade única (W1-01, parte 3c)', () => {
  it('sem CPF: só contas pessoais ativas; as de dispositivo (PAINEIS) só contadas', () => {
    const p = montarPainelCpf(
      [c('ZE'), c('ANA'), c('TV1', { grupo: 'Painéis' }), c('VELHO', { ativo: false })],
      [],
    );
    expect(p.semCpf.map((x) => x.login)).toEqual(['ANA', 'ZE']);
    expect(p.dispensadasSemCpf).toBe(1);
    expect(p.gruposDispensados).toEqual(['PAINEIS']);
  });

  it('CPF repetido: agrupa por chave, só grupos com 2+ logins, e a chave sai como número de ordem', () => {
    const p = montarPainelCpf(
      [],
      [
        { ...c('B2'), chave: '900' },
        { ...c('A1'), chave: '900' },
        { ...c('SO'), chave: '77' },
        { ...c('C1', { ativo: false }), chave: '12' },
        { ...c('C2'), chave: '12' },
      ],
    );
    expect(p.duplicados).toEqual([
      { chave: '1', contas: [{ ...c('A1') }, { ...c('B2') }] },
      { chave: '2', contas: [{ ...c('C1', { ativo: false }) }, { ...c('C2') }] },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/900|"77"/);
  });
});
