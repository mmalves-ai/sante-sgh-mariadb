// Vínculo automático (M57, regra 2; cap-07 §7.7.3; ref 01 §2.2): só com CPF ou CNS iguais e o resto coerente; CPF
// igual com nascimento divergente vai para a fila; CPF placeholder nunca pareia; fonética nunca vincula sozinha (regra
// 3); decisão humana prevalece. Massa sintética.
import { describe, expect, it } from 'vitest';
import { coerenteParaAutomatico, decidirPar } from './automatico.js';
import { comparavel } from './cadastro.js';
import { CNS_A, cadastro, noOutro } from './massa.spec-util.js';

const decidir = (a = {}, b = {}, anterior: Parameters<typeof decidirPar>[2] = null) =>
  decidirPar(comparavel(cadastro(a)), comparavel(noOutro(b)), anterior);

describe('vínculo automático', () => {
  it('par reaberto por uma pessoa (vínculo desfeito, devolvido à fila): fica na fila, nunca automático', () => {
    const d = decidir({}, {}, 'reaberto');
    expect(d.destino).toBe('fila');
    expect(d.motivo).toContain('reaberto');
    expect(decidir({}, {}, 'aberto').destino).toBe('vincular_automatico');
  });

  it('CPF igual com nome, nascimento e sexo coerentes: automático', () => {
    expect(decidir().destino).toBe('vincular_automatico');
  });

  it('CPF igual com nascimento divergente: fila (nunca automático)', () => {
    const d = decidir({}, { nascimento: '1981-05-17' });
    expect(d.destino).toBe('fila');
    expect(d.divergencias).toContain('nascimento_diferente');
    expect(d.motivo).toContain('divergência');
  });

  it('CPF igual com sexo divergente ou sem nascimento: fila', () => {
    expect(decidir({}, { sexo: 'M' }).destino).toBe('fila');
    expect(decidir({ nascimento: null }, {}).destino).toBe('fila');
  });

  it('CPF igual com nome totalmente diferente: fila', () => {
    expect(decidir({ nome: 'BEATRIZ CAMPOS' }, { nome: 'JOANA PEREIRA' }).destino).toBe('fila');
  });

  it('CNS igual sem CPF e dados coerentes: automático', () => {
    expect(decidir({ cpf: null, cns: CNS_A }, { cpf: null, cns: CNS_A }).destino).toBe('vincular_automatico');
  });

  it('CPF placeholder dos dois lados nunca pareia: sem documento, só pela pontuação (fila)', () => {
    const d = decidir({ cpf: '00000000000' }, { cpf: '00000000000' });
    expect(d.criterios).not.toContain('cpf');
    expect(d.destino).toBe('fila');
  });

  it('fonética, mãe e nascimento iguais sem documento: fila, nunca automático', () => {
    const d = decidir({ cpf: null, nome: 'ANA TESTE FICTICIA' }, { cpf: null, nome: 'ANNA THESTE FIKTICIA' });
    expect(d.destino).toBe('fila');
    expect(d.motivo).toBe('pontuação sem documento igual');
  });

  it('pontuação baixa: descartado', () => {
    const d = decidir(
      { cpf: null, nome: 'BEATRIZ CAMPOS', mae: null },
      { cpf: null, nome: 'JOANA PEREIRA', mae: null, nascimento: '1955-01-02' },
    );
    expect(d.destino).toBe('descartar');
  });

  it('mesmo estabelecimento: fila de duplicidades do cadastro (regra 5)', () => {
    expect(decidirPar(comparavel(cadastro()), comparavel(cadastro({ id: 102 }))).destino).toBe(
      'fila_duplicidade_local',
    );
  });

  it('inativo ou absorvido: inelegível', () => {
    expect(decidir({ ativo: false }).destino).toBe('inelegivel');
    expect(decidir({}, { idUnificado: 1 }).destino).toBe('inelegivel');
  });

  it('decisão anterior prevalece: "outra pessoa" e "vinculado" não são refeitos; aberto sobe a automático', () => {
    expect(decidir({}, {}, 'outra_pessoa').destino).toBe('ja_decidido');
    expect(decidir({}, {}, 'vinculado').destino).toBe('ja_decidido');
    expect(decidir({}, {}, 'aberto').destino).toBe('vincular_automatico');
  });

  it('coerência: precisa de documento, nome e nascimento, sem divergência', () => {
    expect(coerenteParaAutomatico(['cpf', 'nome', 'nascimento'], [])).toBe(true);
    expect(coerenteParaAutomatico(['cpf', 'nome'], [])).toBe(false);
    expect(coerenteParaAutomatico(['nome', 'nascimento', 'mae'], [])).toBe(false);
    expect(coerenteParaAutomatico(['cpf', 'nome', 'nascimento'], ['sexo_diferente'])).toBe(false);
  });
});
