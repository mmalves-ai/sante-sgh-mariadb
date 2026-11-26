import { describe, expect, it } from 'vitest';
import {
  passoItem,
  passoPlano,
  validarNaoCriacao,
  validarNovoItem,
  validarNovoPlano,
} from './plano-cuidado.js';

const codigos = (f: readonly { codigo: string }[]) => f.map((x) => x.codigo);
const base = { inicio: '2026-11-26', fimPrevisto: null, risco: null, metas: null, responsavel: 7 };

describe('plano de cuidado: criação', () => {
  it('aceita o plano com responsável e início; recusa sem profissional, fim antes do início e risco desconhecido', () => {
    expect(validarNovoPlano(base)).toEqual([]);
    expect(codigos(validarNovoPlano({ ...base, responsavel: null }))).toEqual(['sem-profissional']);
    expect(codigos(validarNovoPlano({ ...base, fimPrevisto: '2026-11-01' }))).toEqual([
      'fim-antes-do-inicio',
    ]);
    expect(codigos(validarNovoPlano({ ...base, risco: 'grave' }))).toEqual(['risco-invalido']);
    expect(codigos(validarNovoPlano({ ...base, inicio: 'ontem' }))).toEqual(['inicio-invalido']);
  });
  it('não criar o plano exige a justificativa', () => {
    expect(validarNaoCriacao('Paciente em cuidado paliativo exclusivo', 7)).toEqual([]);
    expect(codigos(validarNaoCriacao('curta', 7))).toEqual(['justificativa-curta']);
    expect(codigos(validarNaoCriacao('Justificativa suficiente', null))).toEqual(['sem-profissional']);
  });
});

describe('plano de cuidado: passos', () => {
  const p = { situacao: 'rascunho', risco: 'moderado', objetivos: 1, itensEmAberto: 2 } as const;
  it('ativa só o rascunho com risco e objetivo', () => {
    expect(passoPlano({ ...p, acao: 'ativar' })).toMatchObject({ falhas: [], situacaoNova: 'ativo' });
    expect(codigos(passoPlano({ ...p, acao: 'ativar', risco: null, objetivos: 0 }).falhas)).toEqual([
      'plano-sem-risco',
      'plano-sem-objetivo',
    ]);
    expect(codigos(passoPlano({ ...p, acao: 'ativar', situacao: 'ativo' }).falhas)).toEqual([
      'plano-nao-rascunho',
    ]);
  });
  it('reestratifica o risco e avisa quando sobe para alto ou muito alto', () => {
    expect(passoPlano({ ...p, acao: 'estratificar', riscoNovo: 'alto' })).toMatchObject({
      falhas: [],
      riscoNovo: 'alto',
      avisar: true,
      situacaoNova: 'rascunho',
    });
    expect(passoPlano({ ...p, acao: 'estratificar', risco: 'muito_alto', riscoNovo: 'alto' }).avisar).toBe(
      false,
    );
    expect(passoPlano({ ...p, acao: 'estratificar', risco: null, riscoNovo: 'baixo' }).avisar).toBe(false);
    expect(codigos(passoPlano({ ...p, acao: 'estratificar', riscoNovo: 'moderado' }).falhas)).toEqual([
      'risco-igual',
    ]);
    expect(
      codigos(passoPlano({ ...p, acao: 'estratificar', situacao: 'fechado', riscoNovo: 'alto' }).falhas),
    ).toEqual(['plano-encerrado']);
  });
  it('fecha só o ativo sem itens em aberto; cancela com motivo', () => {
    expect(codigos(passoPlano({ ...p, acao: 'fechar', situacao: 'ativo' }).falhas)).toEqual([
      'itens-em-aberto',
    ]);
    expect(passoPlano({ ...p, acao: 'fechar', situacao: 'ativo', itensEmAberto: 0 }).situacaoNova).toBe(
      'fechado',
    );
    expect(codigos(passoPlano({ ...p, acao: 'fechar', itensEmAberto: 0 }).falhas)).toEqual([
      'plano-nao-ativo',
    ]);
    expect(codigos(passoPlano({ ...p, acao: 'cancelar', motivo: ' ' }).falhas)).toEqual([
      'motivo-obrigatorio',
    ]);
    expect(passoPlano({ ...p, acao: 'cancelar', motivo: 'Alta para outro serviço' }).situacaoNova).toBe(
      'cancelado',
    );
  });
});

describe('plano de cuidado: itens', () => {
  const i = {
    tipo: 'objetivo',
    descricao: 'HbA1c abaixo de 7%',
    situacaoPlano: 'rascunho',
    tipoSuperior: 'problema',
    prazo: '2027-02-26',
    inicioPlano: '2026-11-26',
  } as const;
  it('aceita a hierarquia problema > objetivo > intervenção e recusa o resto', () => {
    expect(validarNovoItem(i)).toEqual([]);
    expect(validarNovoItem({ ...i, tipo: 'intervencao', tipoSuperior: 'objetivo' })).toEqual([]);
    expect(validarNovoItem({ ...i, tipo: 'problema', tipoSuperior: null })).toEqual([]);
    expect(codigos(validarNovoItem({ ...i, tipo: 'problema', tipoSuperior: 'objetivo' }))).toEqual([
      'hierarquia-invalida',
    ]);
    expect(codigos(validarNovoItem({ ...i, tipoSuperior: 'intervencao' }))).toEqual(['hierarquia-invalida']);
    expect(codigos(validarNovoItem({ ...i, tipoSuperior: undefined }))).toEqual(['superior-inexistente']);
    expect(codigos(validarNovoItem({ ...i, prazo: '2026-01-01' }))).toEqual(['prazo-antes-do-inicio']);
    expect(codigos(validarNovoItem({ ...i, situacaoPlano: 'fechado', descricao: 'x' }))).toEqual([
      'plano-encerrado',
      'descricao-curta',
    ]);
  });
  it('o item anda só no plano ativo; desvio pede justificativa', () => {
    const a = { situacao: 'pendente', situacaoPlano: 'ativo' } as const;
    expect(passoItem({ ...a, passo: 'iniciar' }).situacaoNova).toBe('em_andamento');
    expect(passoItem({ ...a, passo: 'concluir' }).situacaoNova).toBe('concluida');
    expect(codigos(passoItem({ ...a, passo: 'cancelar' }).falhas)).toEqual(['justificativa-obrigatoria']);
    expect(passoItem({ ...a, passo: 'nao_realizar', justificativa: 'Paciente recusou' }).situacaoNova).toBe(
      'nao_realizada',
    );
    expect(codigos(passoItem({ ...a, passo: 'iniciar', situacaoPlano: 'rascunho' }).falhas)).toEqual([
      'plano-nao-ativo',
    ]);
    expect(codigos(passoItem({ ...a, passo: 'concluir', situacao: 'concluida' }).falhas)).toEqual([
      'item-encerrado',
    ]);
  });
});
