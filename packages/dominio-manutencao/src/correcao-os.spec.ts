// W0-08: correção da OS antes de assumida (descrição, prioridade, setor e equipamento), com recusa depois de assumida.
// Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { planejarCorrecao, type OsParaCorrecao, type PedidoCorrecao } from './os.js';

const os: OsParaCorrecao = {
  situacao: 'aberta',
  natureza: 'corretiva',
  solicitante: 'ANA',
  tecnico: null,
  assumidaEm: null,
  equipamento: 10,
  centroCusto: 5,
  local: null,
  descricao: 'Monitor não liga',
  prioridadeSugerida: 'media',
  temParada: false,
};
const base: PedidoCorrecao = {
  os,
  novo: {
    equipamento: 10,
    centroCusto: 5,
    local: null,
    descricao: 'Monitor não liga',
    prioridadeSugerida: 'alta',
  },
  quem: { login: 'ana', podeAtender: false, podeEncerrar: false },
  centrosDoUsuario: [5, 6],
  centrosAtivos: [5, 6, 7],
  equipamentoNovo: null,
};

describe('planejarCorrecao', () => {
  it('quem abriu corrige a prioridade e o evento leva o valor anterior', () => {
    const p = planejarCorrecao(base);
    expect(p).toEqual({
      ok: true,
      mudancas: [{ campo: 'prioridadeSugerida', antes: 'media', depois: 'alta' }],
    });
  });

  it('recusa depois de assumida (situação, técnico ou instante de assumir)', () => {
    for (const o of [
      { ...os, situacao: 'emAtendimento' as const },
      { ...os, tecnico: 'JOSE' },
      { ...os, assumidaEm: '2026-11-18T10:00:00' },
    ]) {
      const p = planejarCorrecao({ ...base, os: o });
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.recusa).toBe('os-assumida');
    }
  });

  it('outro usuário sem permissão de atender não corrige; a manutenção corrige', () => {
    const p = planejarCorrecao({ ...base, quem: { login: 'beto', podeAtender: false, podeEncerrar: false } });
    expect(p.ok).toBe(false);
    const q = planejarCorrecao({ ...base, quem: { login: 'beto', podeAtender: true, podeEncerrar: false } });
    expect(q.ok).toBe(true);
  });

  it('sem mudança é recusa', () => {
    const p = planejarCorrecao({ ...base, novo: { ...base.novo, prioridadeSugerida: 'media' } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.recusa).toBe('sem-mudanca');
  });

  it('setor: precisa estar ativo e ser do usuário (a manutenção corrige para qualquer setor ativo)', () => {
    const inativo = planejarCorrecao({ ...base, novo: { ...base.novo, centroCusto: 99 } });
    expect(!inativo.ok && inativo.recusa).toBe('setor-inativo');
    const alheio = planejarCorrecao({ ...base, novo: { ...base.novo, centroCusto: 7 } });
    expect(!alheio.ok && alheio.recusa).toBe('setor-nao-permitido');
    const man = planejarCorrecao({
      ...base,
      quem: { login: 'beto', podeAtender: true, podeEncerrar: false },
      novo: { ...base.novo, centroCusto: 7 },
    });
    expect(man.ok).toBe(true);
  });

  it('equipamento: corretiva exige; desativado recusa; parada registrada exige equipamento', () => {
    const sem = planejarCorrecao({ ...base, novo: { ...base.novo, equipamento: null, local: 'Sala 2' } });
    expect(!sem.ok && sem.recusa).toBe('sem-equipamento');
    const desat = planejarCorrecao({
      ...base,
      novo: { ...base.novo, equipamento: 11 },
      equipamentoNovo: {
        id: 11,
        situacao: 'desativado',
        criticidade: 'baixa',
        centroCusto: 5,
        recurso: null,
      },
    });
    expect(!desat.ok && desat.recusa).toBe('equipamento-desativado');
    const predial = { ...os, natureza: 'predial' as const, temParada: true };
    const par = planejarCorrecao({
      ...base,
      os: predial,
      novo: { ...base.novo, equipamento: null, local: 'Sala 2' },
    });
    expect(!par.ok && par.recusa).toBe('parada-sem-equipamento');
    const semLocal = planejarCorrecao({
      ...base,
      os: { ...predial, temParada: false },
      novo: { ...base.novo, equipamento: null, local: ' ' },
    });
    expect(!semLocal.ok && semLocal.recusa).toBe('sem-local');
  });

  it('troca de equipamento ativo passa e lista as duas mudanças', () => {
    const p = planejarCorrecao({
      ...base,
      novo: { ...base.novo, equipamento: 12, descricao: 'Monitor do leito 3 não liga' },
      equipamentoNovo: { id: 12, situacao: 'ativo', criticidade: 'alta', centroCusto: 5, recurso: null },
    });
    expect(p.ok && p.mudancas.map((m) => m.campo)).toEqual([
      'equipamento',
      'descricao',
      'prioridadeSugerida',
    ]);
  });
});
