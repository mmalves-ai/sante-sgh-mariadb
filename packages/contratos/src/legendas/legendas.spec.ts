// Regras 7, 8 e 9 do M14: situação de agenda pela legenda oficial, códigos de checagem sensíveis a maiúsculas
// (corpus `checagem-maiuscula`: os 14 preservados) e o código em uso sem linha no domínio ("a confirmar").
import { describe, expect, it } from 'vitest';
import {
  A_CONFIRMAR,
  CODIGOS_CHECAGEM,
  legendaDoCodigo,
  legendaSituacaoAgenda,
  mesmoCodigo,
  SITUACAO_AGENDA_OFICIAL,
} from './legendas.js';

describe('regra 7: situação de agenda, uma legenda', () => {
  it('C é Confirmado e X é Cancelado pela legenda oficial; os demais vêm do domínio', () => {
    expect(legendaSituacaoAgenda('C', 'Compareceu')).toBe('Confirmado');
    expect(legendaSituacaoAgenda('X', null)).toBe('Cancelado');
    expect(legendaSituacaoAgenda('A', 'Agendado')).toBe('Agendado');
    expect(legendaSituacaoAgenda('Z')).toBe(`Z ${A_CONFIRMAR}`);
    expect(Object.keys(SITUACAO_AGENDA_OFICIAL)).toEqual(['C', 'X']);
  });
});

describe('regra 8: checagem-maiuscula (14 códigos preservados)', () => {
  it('os 14 códigos são distintos sem converter a caixa', () => {
    expect(CODIGOS_CHECAGEM).toHaveLength(14);
    expect(new Set(CODIGOS_CHECAGEM).size).toBe(14);
    // Com UPPER, P e p, E e e, N e n colidiriam: a regra proíbe.
    expect(new Set(CODIGOS_CHECAGEM.map((c) => c.toUpperCase())).size).toBeLessThan(14);
  });
  it('comparação exata (só o preenchimento do CHAR à direita sai)', () => {
    expect(mesmoCodigo('P', 'p')).toBe(false);
    expect(mesmoCodigo('e ', 'e')).toBe(true);
    expect(mesmoCodigo('E', 'e')).toBe(false);
    for (const c of CODIGOS_CHECAGEM) expect(mesmoCodigo(c, c)).toBe(true);
  });
});

describe('regra 9: código usado e sem legenda aparece "a confirmar"', () => {
  it('o ato 90 é "Métodos gráficos (a confirmar)"; o do domínio vale quando existe', () => {
    expect(legendaDoCodigo('ato', '90')).toBe('Métodos gráficos (a confirmar)');
    expect(legendaDoCodigo('ato', '1', 'Laboratório')).toBe('Laboratório');
    expect(legendaDoCodigo('ato', '77')).toBe(`77 ${A_CONFIRMAR}`);
  });
});

describe('legenda aplicada aos itens do domínio (correção do M14)', () => {
  const item = (codigo: string, descricao: string) => ({
    codigo,
    ativo: true,
    valores: { descricao },
    versao: 'v',
  });
  it('situação de agenda: C e X pela legenda oficial; os demais pela descrição do domínio', async () => {
    const { aplicarLegenda, rotuloDaLegenda } = await import('./legendas.js');
    const r = aplicarLegenda(
      { tipo: 'situacao-agenda' },
      [item('C', 'Compareceu'), item('A', 'Agendado')],
      'descricao',
    );
    expect(r.map((i) => i.legenda)).toEqual(['Confirmado', 'Agendado']);
    expect(rotuloDaLegenda({ tipo: 'situacao-agenda' })).toBe('Legenda oficial');
    expect(rotuloDaLegenda(undefined)).toBeUndefined();
  });
  it('motivo de alta: o grupo do indicador em cada item', async () => {
    const { aplicarLegenda } = await import('./legendas.js');
    const r = aplicarLegenda(
      { tipo: 'motivo-alta' },
      [item('41', 'x'), item('31', 'y'), item('1', 'z')],
      'descricao',
    );
    expect(r.map((i) => i.legenda)).toEqual(['Óbito', 'Transferência externa', 'Alta domiciliar']);
  });
  it('código em uso sem linha: item só de leitura "(a confirmar)", sem repetir o que já existe', async () => {
    const { aplicarLegenda } = await import('./legendas.js');
    const r = aplicarLegenda(
      { tipo: 'codigos-sem-linha', dominio: 'ato' },
      [item('1', 'Laboratório')],
      'descricao',
    );
    expect(r).toHaveLength(2);
    expect(r[1]).toMatchObject({
      codigo: '90',
      aConfirmar: true,
      valores: { descricao: `Métodos gráficos ${A_CONFIRMAR}` },
    });
    const com90 = aplicarLegenda(
      { tipo: 'codigos-sem-linha', dominio: 'ato' },
      [item('90', 'Gráficos')],
      'descricao',
    );
    expect(com90).toHaveLength(1);
    expect(aplicarLegenda(undefined, [item('1', 'a')], 'descricao')).toHaveLength(1);
  });
});
