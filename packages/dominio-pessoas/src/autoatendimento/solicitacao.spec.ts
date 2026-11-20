// W0-06, parte 6 (M3): forma das solicitações do autoatendimento, quem decide e quem desiste.
import { describe, expect, it } from 'vitest';
import {
  conferirSolicitacao,
  diasDaSolicitacao,
  type PedidoSolicitacao,
  recusaDecisaoSolicitacao,
  recusaDesistenciaSolicitacao,
} from './solicitacao.js';

const HOJE = '2026-11-18';
const vazio: PedidoSolicitacao = {
  tipo: 'ferias',
  inicio: null,
  fim: null,
  diasGozo: null,
  diasAbono: null,
  campo: null,
  valorNovo: null,
  atestado: null,
};
const codigos = (p: Partial<PedidoSolicitacao>) =>
  conferirSolicitacao({ ...vazio, ...p }, HOJE).recusas.map((r) => r.codigo);

describe('dias da solicitação', () => {
  it('inclui os dois extremos, atravessa o mês e devolve vazio com o fim antes', () => {
    expect(diasDaSolicitacao('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(diasDaSolicitacao('2026-11-02', '2026-11-02')).toEqual(['2026-11-02']);
    expect(diasDaSolicitacao('2026-11-03', '2026-11-02')).toEqual([]);
  });
});

describe('férias', () => {
  it('pedido válido não tem recusa nem dias de ponto (a programação é na aprovação)', () => {
    const r = conferirSolicitacao({ ...vazio, inicio: '2026-12-07', diasGozo: 20, diasAbono: 10 }, HOJE);
    expect(r).toEqual({ recusas: [], avisos: [], dias: [] });
  });
  it('recusa início no passado, gozo fora de 5 a 30 e abono acima de 10 (CLT arts. 134 e 143)', () => {
    expect(codigos({ inicio: '2026-11-17', diasGozo: 4, diasAbono: 11 })).toEqual([
      'inicio-no-passado',
      'dias-gozo',
      'dias-abono',
    ]);
    expect(codigos({ diasGozo: 10, diasAbono: 0 })).toEqual(['inicio-obrigatorio']);
  });
});

describe('abono', () => {
  it('um dia de ponto por dia do intervalo', () => {
    const r = conferirSolicitacao({ ...vazio, tipo: 'abono', inicio: '2026-11-16', fim: '2026-11-17' }, HOJE);
    expect(r.recusas).toEqual([]);
    expect(r.dias).toEqual(['2026-11-16', '2026-11-17']);
  });
  it('recusa sem período, fim antes do início, mais de 31 dias e mais de 90 dias atrás', () => {
    expect(codigos({ tipo: 'abono', inicio: '2026-11-16' })).toEqual(['periodo-obrigatorio']);
    expect(codigos({ tipo: 'abono', inicio: '2026-11-16', fim: '2026-11-15' })).toEqual([
      'fim-antes-do-inicio',
    ]);
    expect(codigos({ tipo: 'abono', inicio: '2026-11-01', fim: '2026-12-02' })).toEqual(['periodo-longo']);
    expect(codigos({ tipo: 'abono', inicio: '2026-08-19', fim: '2026-08-19' })).toEqual(['periodo-antigo']);
    expect(codigos({ tipo: 'abono', inicio: '2026-08-20', fim: '2026-08-20' })).toEqual([]);
  });
  it('com recusa, nenhum dia vai ao ponto', () => {
    expect(
      conferirSolicitacao({ ...vazio, tipo: 'abono', inicio: '2026-11-01', fim: '2026-12-02' }, HOJE).dias,
    ).toEqual([]);
  });
});

describe('atestado', () => {
  const at = { tipo: 'atestado' as const, inicio: '2026-11-16', fim: '2026-11-18' };
  it('dentro dos dias do atestado: sem recusa, um dia de ponto por dia', () => {
    const r = conferirSolicitacao({ ...vazio, ...at, atestado: { emitidoEm: '2026-11-16', dias: 3 } }, HOJE);
    expect(r).toEqual({ recusas: [], avisos: [], dias: ['2026-11-16', '2026-11-17', '2026-11-18'] });
  });
  it('acima de 15 dias avisa o afastamento pelo INSS (Lei 8.213, art. 60)', () => {
    const r = conferirSolicitacao({ ...vazio, ...at, atestado: { emitidoEm: '2026-11-16', dias: 20 } }, HOJE);
    expect(r.recusas).toEqual([]);
    expect(r.avisos).toEqual(['atestado-acima-de-15-dias']);
  });
  it('recusa sem os dados, emissão futura, início antes da emissão e período maior que os dias', () => {
    expect(codigos(at)).toEqual(['atestado-obrigatorio']);
    expect(codigos({ ...at, atestado: { emitidoEm: '2026-11-19', dias: 3 } })).toEqual([
      'atestado-emissao-futura',
      'atestado-antes-da-emissao',
    ]);
    expect(codigos({ ...at, atestado: { emitidoEm: '2026-11-16', dias: 2 } })).toEqual([
      'periodo-maior-que-atestado',
    ]);
    expect(codigos({ ...at, atestado: { emitidoEm: '2026-11-16', dias: 0 } })).toEqual([
      'atestado-dias',
      'periodo-maior-que-atestado',
    ]);
    // O atestado emitido no dia seguinte ao primeiro dia de falta vale (consulta no dia seguinte).
    expect(codigos({ ...at, atestado: { emitidoEm: '2026-11-17', dias: 3 } })).toEqual([]);
  });
});

describe('ajuste de ponto e alteração cadastral', () => {
  it('ajuste: só de dia vivido, até 90 dias atrás', () => {
    expect(codigos({ tipo: 'ajuste_ponto', inicio: HOJE })).toEqual([]);
    expect(codigos({ tipo: 'ajuste_ponto', inicio: '2026-11-19' })).toEqual(['ajuste-no-futuro']);
    expect(codigos({ tipo: 'ajuste_ponto', inicio: '2026-01-02' })).toEqual(['periodo-antigo']);
    expect(codigos({ tipo: 'ajuste_ponto' })).toEqual(['dia-obrigatorio']);
  });
  it('alteração: só o campo que o cadastro guarda e com valor', () => {
    expect(codigos({ tipo: 'alteracao_cadastral', campo: 'nome', valorNovo: 'MARIA DA SILVA' })).toEqual([]);
    expect(codigos({ tipo: 'alteracao_cadastral', campo: 'salario', valorNovo: '1' })).toEqual([
      'campo-invalido',
    ]);
    expect(codigos({ tipo: 'alteracao_cadastral', campo: 'nome', valorNovo: '  ' })).toEqual([
      'valor-obrigatorio',
    ]);
  });
});

describe('quem decide e quem desiste', () => {
  const pendente = { situacao: 'pendente' as const, pedidoPor: 'ana' };
  it('o gestor decide a pendente; quem pediu não decide (sem distinguir maiúsculas)', () => {
    expect(recusaDecisaoSolicitacao(pendente, 'GESTOR')).toBeNull();
    expect(recusaDecisaoSolicitacao(pendente, ' ANA ')?.codigo).toBe('solicitacao-decisao-pelo-solicitante');
    expect(recusaDecisaoSolicitacao({ ...pendente, situacao: 'desistida' }, 'GESTOR')?.codigo).toBe(
      'solicitacao-ja-decidida',
    );
  });
  it('só quem pediu desiste, e só da pendente', () => {
    expect(recusaDesistenciaSolicitacao(pendente, 'ANA')).toBeNull();
    expect(recusaDesistenciaSolicitacao(pendente, 'GESTOR')?.codigo).toBe(
      'solicitacao-desistencia-so-do-solicitante',
    );
    expect(recusaDesistenciaSolicitacao({ ...pendente, situacao: 'aprovada' }, 'ana')?.codigo).toBe(
      'solicitacao-ja-decidida',
    );
  });
});
