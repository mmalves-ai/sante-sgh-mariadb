// A máquina de estados e a ordem da fila moram em @sgh/contratos (as receitas do adaptador as usam; testes completos
// em packages/contratos/src/recepcao/estados.spec.ts e fila.spec.ts). Aqui: o domínio as entrega à API e à tela.
import { describe, expect, it } from 'vitest';
import { chamavel, decidirEvento, eventosPossiveis, ordenarFila, prioritaria, textoSenha } from './index.js';

describe('domínio da recepção: estados e fila (reexportados)', () => {
  it('a senha aguardando é chamável e o guichê a conduz', () => {
    const s = { situacao: 'aguardando', guiche: 0, atendida: false, tipoGerador: '5' };
    expect(chamavel(s)).toBe(true);
    expect(eventosPossiveis({ ...s, situacao: 'chamada', guiche: 3 }, 3)).toContain('liberar');
    expect(decidirEvento(s, 'finalizar', 3)).toMatchObject({ ok: false, codigo: 'letra-nunca-vista' });
  });

  it('a fila põe a prioritária na frente e o texto da senha tem a letra e 3 dígitos', () => {
    const f = ordenarFila([
      { id: 1, numero: 1, prioridade: '2', emitidaEm: '2026-10-21T08:00:00' },
      { id: 2, numero: 2, prioridade: '1', emitidaEm: '2026-10-21T08:01:00' },
    ]);
    expect(f.map((x) => x.id)).toEqual([2, 1]);
    expect(prioritaria('1')).toBe(true);
    expect(textoSenha('cl', 9)).toBe('CL 009');
  });
});
