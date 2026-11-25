import { describe, expect, it } from 'vitest';
import {
  escolherRegraCoparticipacao,
  especificidade,
  problemasDaRegraCoparticipacao,
  problemasDoEncerramento,
  type RegraCandidata,
  type RegraCoparticipacaoCadastro,
} from './regra-coparticipacao.js';

const r = (id: number, x: Partial<RegraCandidata> = {}): RegraCandidata => ({
  id,
  doContrato: false,
  inicio: '2026-01-01',
  procedimento: null,
  grupo: null,
  tipoGuia: null,
  regime: null,
  ...x,
});

describe('escolha da regra de coparticipação do evento (C2-116)', () => {
  const geral = r(1);
  const guia = r(2, { tipoGuia: 10 });
  const grupo = r(3, { grupo: 20 });
  const proc = r(4, { procedimento: 30 });
  const todas = [geral, guia, grupo, proc];

  it('sem critério informado vale a regra geral', () => {
    expect(escolherRegraCoparticipacao(todas, {})?.id).toBe(1);
  });
  it('o procedimento vale mais que o grupo, que vale mais que o tipo de guia', () => {
    expect(escolherRegraCoparticipacao(todas, { tipoGuia: 10 })?.id).toBe(2);
    expect(escolherRegraCoparticipacao(todas, { tipoGuia: 10, grupo: 20 })?.id).toBe(3);
    expect(escolherRegraCoparticipacao(todas, { tipoGuia: 10, grupo: 20, procedimento: 30 })?.id).toBe(4);
    expect(especificidade(proc)).toBeGreaterThan(especificidade(r(9, { grupo: 1, tipoGuia: 1, regime: 1 })));
  });
  it('regra de outro tipo de guia não casa', () => {
    expect(escolherRegraCoparticipacao([guia], { tipoGuia: 11 })).toBeNull();
    expect(escolherRegraCoparticipacao([guia], {})).toBeNull();
  });
  it('no mesmo grau, a do contrato prevalece e depois a mais recente', () => {
    const plano = r(5, { tipoGuia: 10, inicio: '2026-06-01' });
    const contrato = r(6, { tipoGuia: 10, doContrato: true, inicio: '2025-01-01' });
    expect(escolherRegraCoparticipacao([plano, contrato], { tipoGuia: 10 })?.id).toBe(6);
    const nova = r(7, { tipoGuia: 10, inicio: '2026-07-01' });
    expect(escolherRegraCoparticipacao([plano, nova], { tipoGuia: 10 })?.id).toBe(7);
  });
  it('a regra específica do plano vale mais que a geral do contrato', () => {
    const contratoGeral = r(8, { doContrato: true });
    expect(escolherRegraCoparticipacao([contratoGeral, guia], { tipoGuia: 10 })?.id).toBe(2);
  });
});

describe('cadastro da regra de coparticipação (C2-116)', () => {
  const base: RegraCoparticipacaoCadastro = {
    codigo: 'CP-URG',
    descricao: 'Urgência isenta',
    plano: 1,
    contrato: null,
    tipo: 'percentual',
    valor: 30,
    tetoEvento: 50,
    tetoMensal: 200,
    tetoAnual: 1000,
    inicio: '2026-01-01',
    fim: null,
    procedimento: null,
    grupo: null,
    tipoGuia: 3,
    regime: null,
  };
  const codigos = (x: Partial<RegraCoparticipacaoCadastro>) =>
    problemasDaRegraCoparticipacao({ ...base, ...x }).map((p) => p.codigo);

  it('regra válida não tem problema', () => {
    expect(codigos({})).toEqual([]);
    expect(
      codigos({ tipo: 'nenhuma', valor: null, tetoEvento: null, tetoMensal: null, tetoAnual: null }),
    ).toEqual([]);
  });
  it('recusa escopo duplo ou ausente', () => {
    expect(codigos({ contrato: 2 })).toContain('escopo-invalido');
    expect(codigos({ plano: null })).toContain('escopo-invalido');
  });
  it('recusa percentual fora da faixa e valor fixo zero', () => {
    expect(codigos({ valor: 120 })).toContain('percentual-invalido');
    expect(codigos({ tipo: 'valor_fixo', valor: 0 })).toContain('valor-invalido');
    expect(codigos({ tipo: 'valor_fixo', valor: 80 })).toContain('valor-acima-do-teto');
  });
  it('recusa tetos invertidos, zerados e teto em isenção', () => {
    expect(codigos({ tetoEvento: 300 })).toContain('coparticipacao-teto-invalido');
    expect(codigos({ tetoMensal: 0 })).toContain('coparticipacao-teto-invalido');
    expect(codigos({ tipo: 'nenhuma', valor: null })).toContain('teto-sem-tipo');
  });
  it('recusa procedimento junto com grupo e vigência invertida', () => {
    expect(codigos({ procedimento: 1, grupo: 2 })).toContain('procedimento-e-grupo');
    expect(codigos({ fim: '2025-12-31' })).toContain('fim-antes-do-inicio');
    expect(codigos({ codigo: 'x' })).toContain('codigo-invalido');
  });
  it('encerramento: nunca antes do início nem depois do fim que já existe', () => {
    expect(problemasDoEncerramento({ inicio: '2026-01-01', fim: null }, '2026-05-31')).toEqual([]);
    expect(problemasDoEncerramento({ inicio: '2026-01-01', fim: null }, '2025-05-31')[0]?.codigo).toBe(
      'fim-antes-do-inicio',
    );
    expect(
      problemasDoEncerramento({ inicio: '2026-01-01', fim: '2026-03-31' }, '2026-05-31')[0]?.codigo,
    ).toBe('regra-ja-encerrada');
  });
});
