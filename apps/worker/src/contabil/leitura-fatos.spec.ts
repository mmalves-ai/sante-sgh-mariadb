// M54.1, correção da revisão: a janela fora do pico e o "hoje" do ciclo vão no fuso civil do Brasil (UTC−3), não na
// hora do processo (TZ=UTC no manual de implantação §3.3). Instante de prova: 31/10/2026 às 23:30 de Brasília, que é
// 01/11/2026 02:30Z.
import { describe, expect, it } from 'vitest';
import { competenciaDaData } from '@sgh/dominio-contabil';
import { contabilizacaoLigada, hojeDoCiclo, LeituraFatosContabeisService } from './leitura-fatos.service.js';

const NOITE_DO_ULTIMO_DIA = new Date('2026-11-01T02:30:00Z');
const PRODUCAO = { AMBIENTE: 'producao' } as NodeJS.ProcessEnv;

describe('leitura dos fatos contábeis no fuso civil', () => {
  const s = new LeituraFatosContabeisService();

  it('23:30 de Brasília está dentro da janela padrão 22:00-06:00', () => {
    expect(s.naJanela(NOITE_DO_ULTIMO_DIA, PRODUCAO)).toBe(true);
  });

  it('19:30 de Brasília (22:30Z) fica fora da janela padrão', () => {
    expect(s.naJanela(new Date('2026-10-29T22:30:00Z'), PRODUCAO)).toBe(false);
  });

  it('05:59 de Brasília (08:59Z) ainda está dentro; 06:30 (09:30Z) já está fora', () => {
    expect(s.naJanela(new Date('2026-10-30T08:59:00Z'), PRODUCAO)).toBe(true);
    expect(s.naJanela(new Date('2026-10-30T09:30:00Z'), PRODUCAO)).toBe(false);
  });

  it('o estorno visto às 23:30 do último dia sai com a data e a competência do próprio mês', () => {
    const hoje = hojeDoCiclo(NOITE_DO_ULTIMO_DIA);
    expect(hoje).toBe('2026-10-31');
    expect(competenciaDaData(hoje)).toBe('2026-10');
  });
});

describe('contabilização depois da leitura (M54.2)', () => {
  it('ligada por padrão; CONTABIL_CONTABILIZAR=desligado só lê', () => {
    expect(contabilizacaoLigada({})).toBe(true);
    expect(contabilizacaoLigada({ CONTABIL_CONTABILIZAR: 'ligado' })).toBe(true);
    expect(contabilizacaoLigada({ CONTABIL_CONTABILIZAR: ' desligado ' })).toBe(false);
  });
});
