import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  ADR_RETROCOMPATIBILIDADE,
  caminhoRegistroRetrocompatibilidade,
  CONDICOES_EXTINCAO,
  esquemaRegistroRetrocompatibilidade,
  FONTE_CONDICAO_EXTINCAO,
  MEDIDAS_EVOLUCAO,
  PASSOS_EVOLUCAO,
  PLANO_EVOLUCAO,
} from './retrocompatibilidade.js';

const RAIZ = resolve(import.meta.dirname, '../../../..');
const base = { formato: 1, estabelecimento: 'pc' } as const;
const extinta = {
  situacao: 'extinta',
  data: '2027-03-01',
  referencia: 'ESTADO.md Autorizações, linha da extinção',
  adr: '0033',
  papel: 'dono-do-projeto',
} as const;
const aprovado = {
  data: '2027-03-10',
  relatorio: 'docs/marcos/EVO-01/regressao.md',
  resultado: 'aprovado',
} as const;
const ref = { data: '2027-03-11', referencia: 'ESTADO.md Autorizações' } as const;

describe('retrocompatibilidade (M59-F6): plano e registro', () => {
  it('o plano tem os cinco passos na ordem, a imutabilidade por linha primeiro (regra 6) e uma medida por passo', () => {
    expect(PLANO_EVOLUCAO.map((p) => p.passo)).toEqual([...PASSOS_EVOLUCAO]);
    expect(PLANO_EVOLUCAO.map((p) => p.ordem)).toEqual([1, 2, 3, 4, 5]);
    expect(PLANO_EVOLUCAO[0]?.passo).toBe('imutabilidade-por-linha');
    expect(new Set(PLANO_EVOLUCAO.map((p) => p.medida))).toEqual(new Set(MEDIDAS_EVOLUCAO));
    for (const c of CONDICOES_EXTINCAO) expect(FONTE_CONDICAO_EXTINCAO[c].length).toBeGreaterThan(10);
  });

  it('registro vazio: decisão pendente e os cinco passos sem nada', () => {
    const r = esquemaRegistroRetrocompatibilidade.parse(base);
    expect(r.decisao.situacao).toBe('pendente');
    for (const p of PASSOS_EVOLUCAO)
      expect(r.passos[p]).toEqual({
        ficha: null,
        combinadoHalAi: null,
        regressao: null,
        autorizacao: null,
        execucao: null,
      });
  });

  it('antes da extinção só a ficha do passo pode ser registrada', () => {
    expect(
      esquemaRegistroRetrocompatibilidade.safeParse({
        ...base,
        passos: { 'imutabilidade-por-linha': { ficha: 'docs/adr/0033-x.md' } },
      }).success,
    ).toBe(true);
    const r = esquemaRegistroRetrocompatibilidade.safeParse({
      ...base,
      decisao: { situacao: 'mantida', data: '2026-11-01', referencia: 'ata do comitê' },
      passos: { 'imutabilidade-por-linha': { autorizacao: ref } },
    });
    expect(r.success).toBe(false);
  });

  it('execução exige autorização, regressão aprovada e o passo anterior executado', () => {
    const semRegressao = esquemaRegistroRetrocompatibilidade.safeParse({
      ...base,
      decisao: extinta,
      passos: { 'imutabilidade-por-linha': { autorizacao: ref, execucao: ref } },
    });
    expect(semRegressao.success).toBe(false);
    const foraDeOrdem = esquemaRegistroRetrocompatibilidade.safeParse({
      ...base,
      decisao: extinta,
      passos: { 'regras-dos-gatilhos': { autorizacao: ref, regressao: aprovado, execucao: ref } },
    });
    expect(foraDeOrdem.success).toBe(false);
    const ok = esquemaRegistroRetrocompatibilidade.safeParse({
      ...base,
      decisao: extinta,
      passos: { 'imutabilidade-por-linha': { autorizacao: ref, regressao: aprovado, execucao: ref } },
    });
    expect(ok.success).toBe(true);
  });

  it('recusa dado pessoal na referência, extinção sem o ADR e passo desconhecido', () => {
    expect(
      esquemaRegistroRetrocompatibilidade.safeParse({
        ...base,
        decisao: { situacao: 'mantida', data: '2026-11-01', referencia: 'falar com fulano@x.com' },
      }).success,
    ).toBe(false);
    expect(
      esquemaRegistroRetrocompatibilidade.safeParse({ ...base, decisao: { ...extinta, adr: '0001' } })
        .success,
    ).toBe(false);
    expect(
      esquemaRegistroRetrocompatibilidade.safeParse({ ...base, passos: { 'trocar-motor': {} } }).success,
    ).toBe(false);
  });

  it('o registro versionado do pc vale pelo esquema', () => {
    const p = resolve(RAIZ, caminhoRegistroRetrocompatibilidade('pc'));
    expect(existsSync(p)).toBe(true);
    const r = esquemaRegistroRetrocompatibilidade.parse(parse(readFileSync(p, 'utf8')));
    expect(r.estabelecimento).toBe('pc');
  });

  it('o ADR lista os cinco passos e o primeiro tem ficha própria (regra 11, teste da ficha)', () => {
    const adr = readFileSync(resolve(RAIZ, ADR_RETROCOMPATIBILIDADE.caminho), 'utf8');
    expect(adr).toMatch(/^# ADR 0033/);
    for (const p of PASSOS_EVOLUCAO) expect(adr, p).toContain(`\`${p}\``);
    const i = adr.indexOf('## Ficha do primeiro passo');
    expect(i).toBeGreaterThan(0);
    const ficha = adr.slice(i);
    for (const s of [
      '##### 1. Objetivo',
      '##### 2. Fase e dependências',
      '##### 5. Operações de gravação compatível',
      '##### 6. Tabelas `SGH_`',
      '##### 8. Regras de negócio e códigos',
      '##### 10. Outros testes',
      '##### 11. Critérios de aceite verificáveis',
      '##### 12. Liberação e recolhimento',
    ])
      expect(ficha, s).toContain(s);
  });
});
