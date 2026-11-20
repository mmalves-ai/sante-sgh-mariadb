// Regra 9 (retentativa crescente com limite por parceiro, fila de mortos, ordem por objeto) e regra 10 (alerta da
// fila de mortos sem tratamento por mais de 4 h).
import { describe, expect, it } from 'vitest';
import {
  alertasDeMortos,
  aplicarTratamento,
  depoisDaFalha,
  type EnvioNaFila,
  esperaMinutos,
  minutosNaFilaDeMortos,
  prontasParaEnviar,
} from './retentativa.js';

const T0 = new Date('2026-10-22T10:00:00Z');
const mais = (min: number) => new Date(T0.getTime() + min * 60_000);

describe('retentativa crescente (regra 9)', () => {
  it('1 min, 5 min, 30 min, 2 h e daí a cada 2 h', () => {
    expect([1, 2, 3, 4, 5, 9].map(esperaMinutos)).toEqual([1, 5, 30, 120, 120, 120]);
    expect(() => esperaMinutos(0)).toThrow();
  });

  it('até o limite do parceiro; esgotou, fila de mortos', () => {
    const r1 = depoisDaFalha(0, 4, T0);
    expect(r1).toEqual({ situacao: 'pendente', tentativas: 1, proximaEm: mais(1) });
    const r2 = depoisDaFalha(1, 4, T0);
    expect(r2.situacao === 'pendente' && r2.proximaEm).toEqual(mais(5));
    const r3 = depoisDaFalha(2, 4, T0);
    expect(r3.situacao === 'pendente' && r3.proximaEm).toEqual(mais(30));
    expect(depoisDaFalha(3, 4, T0)).toEqual({ situacao: 'morto', tentativas: 4, mortoEm: T0 });
    // Limite 1: a primeira falha já vai à fila de mortos.
    expect(depoisDaFalha(0, 1, T0).situacao).toBe('morto');
    expect(() => depoisDaFalha(0, 0, T0)).toThrow();
  });
});

describe('ordem por objeto (regra 9)', () => {
  const e = (id: string, ordem: number, o: Partial<EnvioNaFila> = {}): EnvioNaFila => ({
    id,
    parceiro: 'apoio-lab',
    chaveOrdem: 'paciente:1',
    situacao: 'pendente',
    ordem,
    proximaTentativaEm: null,
    ...o,
  });

  it('do mesmo objeto, só a primeira; objetos diferentes não esperam um pelo outro', () => {
    const fila = [e('a', 1), e('b', 2), e('c', 3, { chaveOrdem: 'paciente:2' })];
    expect(prontasParaEnviar(fila, T0).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('a que espera a hora da tentativa segura o objeto; as entregues e descartadas não', () => {
    const fila = [
      e('a', 1, { situacao: 'enviado' }),
      e('b', 2, { proximaTentativaEm: mais(5) }),
      e('c', 3),
      e('d', 4, { chaveOrdem: 'conta:9', situacao: 'descartado' }),
      e('f', 5, { chaveOrdem: 'conta:9' }),
    ];
    expect(prontasParaEnviar(fila, T0).map((x) => x.id)).toEqual(['f']);
    expect(prontasParaEnviar(fila, mais(6)).map((x) => x.id)).toEqual(['b', 'f']);
  });

  it('a morta segura as seguintes do mesmo objeto até ser tratada', () => {
    const fila = [e('a', 1, { situacao: 'morto' }), e('b', 2)];
    expect(prontasParaEnviar(fila, T0)).toEqual([]);
  });

  it('parceiro lento (outro parceiro) não atrasa: a fila é por parceiro e objeto', () => {
    const fila = [
      e('lento', 1, { parceiro: 'lento', proximaTentativaEm: mais(120) }),
      e('rapido', 2, { parceiro: 'rapido' }),
    ];
    expect(prontasParaEnviar(fila, T0).map((x) => x.id)).toEqual(['rapido']);
  });
});

describe('fila de mortos (regras 9 e 10)', () => {
  it('alerta só para o morto sem tratamento acima do limite (4 h)', () => {
    const agora = mais(300);
    const r = alertasDeMortos(
      [
        { id: '1', parceiro: 'p', mortoEm: T0, tratado: false },
        { id: '2', parceiro: 'p', mortoEm: mais(100), tratado: false },
        { id: '3', parceiro: 'p', mortoEm: T0, tratado: true },
      ],
      240,
      agora,
    );
    expect(r).toEqual([{ id: '1', parceiro: 'p', minutos: 300 }]);
    expect(minutosNaFilaDeMortos(mais(10), T0)).toBe(0);
  });

  it('reprocessar, corrigir ou descartar com motivo; só o morto', () => {
    expect(aplicarTratamento('morto', 'reprocessar', 'parceiro voltou')).toEqual({
      situacao: 'pendente',
      refazerConteudo: false,
    });
    expect(aplicarTratamento('morto', 'corrigir', 'de-para corrigido')).toEqual({
      situacao: 'pendente',
      refazerConteudo: true,
    });
    expect(aplicarTratamento('morto', 'descartar', 'exame cancelado')).toEqual({
      situacao: 'descartado',
      refazerConteudo: false,
    });
    expect(() => aplicarTratamento('pendente', 'reprocessar', 'qualquer')).toThrow(/fila de mortos/);
    expect(() => aplicarTratamento('morto', 'descartar', ' ')).toThrow(/motivo/);
  });
});
