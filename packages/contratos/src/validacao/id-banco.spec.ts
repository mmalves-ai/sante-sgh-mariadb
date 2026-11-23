import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { esquemaAbrirAtendimento } from '../atendimento/entradas.js';
import { esquemaConferirItem, esquemaFecharConta, esquemaLancarItem } from '../faturamento/entradas.js';
import { esquemaPedidoMarcarEspera } from '../agenda/pedidos.js';
import { esquemaInternar } from '../internacao/adt.js';
import { esquemaItemSaida, esquemaRegistrarSaida } from '../suprimentos/entradas.js';
import {
  EXPRESSAO_ID_BANCO,
  ID_BANCO_MAXIMO,
  idBanco,
  idBancoOuZero,
  idBancoTexto,
  lerIdBanco,
} from './id-banco.js';

/** Item próprio do hospital no espelho do catálogo: a partir de 10^12 (tools/db/espelho.py, BASE_LOCAL). */
const ITEM_PROPRIO = 10 ** 12 + 1;
const ACIMA = Number.MAX_SAFE_INTEGER + 1;

/** Os caminhos com problema quando o objeto é validado (o resto do objeto pode estar incompleto). */
function caminhosComProblema(esquema: ZodType, valor: unknown): string[] {
  const r = esquema.safeParse(valor);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('id de linha do banco (BIGINT UNSIGNED)', () => {
  it('aceita o id de item próprio do espelho (10^12 + 1) e o teto 2^53 - 1', () => {
    expect(ID_BANCO_MAXIMO).toBe(Number.MAX_SAFE_INTEGER);
    expect(idBanco.parse(ITEM_PROPRIO)).toBe(ITEM_PROPRIO);
    expect(idBanco.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(idBancoTexto.parse(String(ITEM_PROPRIO))).toBe(ITEM_PROPRIO);
    expect(idBancoOuZero.parse(0)).toBe(0);
  });

  it('recusa MAX_SAFE_INTEGER + 1, zero, negativo e fracionário', () => {
    for (const v of [ACIMA, 0, -1, -ITEM_PROPRIO, 1.5]) expect(idBanco.safeParse(v).success).toBe(false);
    expect(idBancoTexto.safeParse(String(ACIMA)).success).toBe(false);
    expect(idBancoOuZero.safeParse(-1).success).toBe(false);
    expect(idBancoOuZero.safeParse(ACIMA).success).toBe(false);
  });

  it('parâmetro de rota: até 16 dígitos e no máximo 2^53 - 1', () => {
    expect(EXPRESSAO_ID_BANCO.test('1000000000001')).toBe(true);
    expect(lerIdBanco('1000000000001')).toBe(ITEM_PROPRIO);
    expect(lerIdBanco('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    for (const t of [
      '9007199254740992',
      '9007199254740993',
      '0',
      '-1',
      '12345678901234567',
      '1e3',
      ' 1',
      '',
      '1.5',
    ])
      expect(lerIdBanco(t)).toBeNull();
    expect(lerIdBanco(5)).toBeNull();
  });

  it('admissão: o CID principal aceita item próprio e recusa acima de 2^53 - 1', () => {
    expect(caminhosComProblema(esquemaInternar, { cidPrincipal: ITEM_PROPRIO })).not.toContain(
      'cidPrincipal',
    );
    expect(caminhosComProblema(esquemaInternar, { cidPrincipal: ACIMA })).toContain('cidPrincipal');
    expect(caminhosComProblema(esquemaInternar, { cidPrincipal: 0 })).toContain('cidPrincipal');
    expect(caminhosComProblema(esquemaAbrirAtendimento, { cidPrincipal: ITEM_PROPRIO })).not.toContain(
      'cidPrincipal',
    );
    expect(caminhosComProblema(esquemaAbrirAtendimento, { cidPrincipal: ACIMA })).toContain('cidPrincipal');
  });

  it('conta: a conta (conta_hospitalar.id) aceita 10^12 + 1 e recusa acima de 2^53 - 1, zero e negativo', () => {
    const base = {
      conta: ITEM_PROPRIO,
      tipo: 4,
      codigo: 101,
      quantidade: 1,
      data: '2026-11-23',
      hora: '10:00',
      local: 0,
      ato: 0,
    };
    expect(esquemaLancarItem.safeParse(base).success).toBe(true);
    expect(esquemaFecharConta.safeParse({ conta: ITEM_PROPRIO, versao: '2026-11-23 10:00:00' }).success).toBe(
      true,
    );
    for (const conta of [ACIMA, 0, -1])
      expect(caminhosComProblema(esquemaLancarItem, { ...base, conta })).toContain('conta');
    expect(
      caminhosComProblema(esquemaConferirItem, {
        conta: ITEM_PROPRIO,
        itens: [{ id: ITEM_PROPRIO, versao: '2026-11-23 10:00:00' }],
      }),
    ).toEqual([]);
    expect(
      caminhosComProblema(esquemaConferirItem, {
        conta: 1,
        itens: [{ id: ACIMA, versao: '2026-11-23 10:00:00' }],
      }),
    ).toContain('itens.0.id');
  });

  it('convênio (fonte_pagadora.id) acima de 32767 entra na espera da agenda; acima de 2^53 - 1, não', () => {
    const base = { agenda: 1, data: '2026-11-23', hora: '10:00', canal: 'telefone' };
    expect(caminhosComProblema(esquemaPedidoMarcarEspera, { ...base, convenio: ITEM_PROPRIO })).not.toContain(
      'convenio',
    );
    expect(caminhosComProblema(esquemaPedidoMarcarEspera, { ...base, convenio: ACIMA })).toContain(
      'convenio',
    );
  });

  it('estoque: a saída do item próprio passa; acima do teto, não', () => {
    expect(esquemaItemSaida.safeParse({ item: ITEM_PROPRIO, quantidade: 1 }).success).toBe(true);
    expect(caminhosComProblema(esquemaItemSaida, { item: ACIMA, quantidade: 1 })).toContain('item');
    expect(
      caminhosComProblema(esquemaRegistrarSaida, { itens: [{ item: ITEM_PROPRIO, quantidade: 1 }] }),
    ).not.toContain('itens.0.item');
    expect(caminhosComProblema(esquemaRegistrarSaida, { itens: [{ item: ACIMA, quantidade: 1 }] })).toContain(
      'itens.0.item',
    );
  });
});
