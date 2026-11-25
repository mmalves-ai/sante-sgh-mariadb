import { describe, expect, it } from 'vitest';
import {
  caixaReprocessavel,
  codigoEtiqueta,
  conferirCaixa,
  conferirCarga,
  conferirEntrega,
  conferirUso,
  desfechoDaLiberacao,
  desfechoDoCiclo,
  diasDeValidade,
  faltasDaEtiqueta,
  situacaoDaSolicitacao,
  validadeDoPacote,
} from './cme.js';

const caixa = {
  codigo: 'CX1',
  descricao: 'Caixa sintética',
  validadeDias: 30,
  controlaReprocessamentos: false,
  limiteReprocessamentos: null,
  itens: [{ insumo: 1, produto: null, quantidade: 2, pecaMestre: true }],
};

describe('caixa de instrumental', () => {
  it('aceita a caixa completa', () => expect(conferirCaixa(caixa)).toEqual([]));
  it('recusa caixa sem peças, peça sem produto, quantidade zero e duas peças mestre', () => {
    expect(conferirCaixa({ ...caixa, itens: [] }).map((p) => p.campo)).toEqual(['itens']);
    const r = conferirCaixa({
      ...caixa,
      itens: [
        { insumo: null, produto: null, quantidade: 0, pecaMestre: true },
        { insumo: 1, produto: 2, quantidade: 1, pecaMestre: true },
      ],
    }).map((p) => p.campo);
    expect(r).toEqual(['itens.0', 'itens.0.quantidade', 'itens.1', 'itens']);
  });
  it('exige limite quando controla reprocessamentos e validade de 1 a 3650 dias', () => {
    expect(
      conferirCaixa({ ...caixa, controlaReprocessamentos: true, validadeDias: 0 }).map((p) => p.campo),
    ).toEqual(['validadeDias', 'limiteReprocessamentos']);
  });
  it('a caixa no limite de reprocessamentos ou inativa não vai a novo pacote', () => {
    expect(caixaReprocessavel({ ativo: true, controla: true, limite: 3, feitos: 3 })).toHaveLength(1);
    expect(caixaReprocessavel({ ativo: false, controla: false, limite: null, feitos: 0 })).toHaveLength(1);
    expect(caixaReprocessavel({ ativo: true, controla: true, limite: 3, feitos: 2 })).toEqual([]);
  });
});

describe('validade e etiqueta', () => {
  it('validade pela caixa, senão pela embalagem', () => {
    expect(diasDeValidade(30, 180)).toBe(30);
    expect(diasDeValidade(null, 180)).toBe(180);
    expect(diasDeValidade(null, null)).toBeNull();
    expect(validadeDoPacote('2026-11-25T10:00', 30)).toBe('2026-12-25');
  });
  it('código da etiqueta e faltas do art. 83', () => {
    expect(codigoEtiqueta(7, 42)).toBe('PE00700000042');
    expect(
      faltasDaEtiqueta({
        codigo: 'x',
        produto: 'Caixa',
        lote: null,
        esterilizadoEm: null,
        validade: '2026-12-01',
        metodo: 'Vapor',
        preparadoPor: null,
      }),
    ).toEqual(['lote', 'data da esterilização', 'responsável pelo preparo']);
  });
});

describe('ciclo de esterilização', () => {
  const pac = [
    { id: 1, situacao: 'aguardando_esterilizacao', metodo: 9 },
    { id: 2, situacao: 'esteril', metodo: 9 },
    { id: 3, situacao: 'aguardando_esterilizacao', metodo: 8 },
  ];
  it('a carga aceita só pacotes aguardando, sem repetir, do mesmo método', () => {
    expect(conferirCarga(9, pac, [1])).toEqual([]);
    expect(conferirCarga(9, pac, [])).toHaveLength(1);
    expect(conferirCarga(9, pac, [1, 1])).toHaveLength(1);
    expect(conferirCarga(9, pac, [2, 3, 4]).map((p) => p.mensagem)).toEqual([
      'O pacote 2 não está aguardando esterilização.',
      'O pacote 3 pede outro método de esterilização.',
      'O pacote 4 não existe neste estabelecimento.',
    ]);
    expect(
      conferirCarga(9, [{ id: 5, situacao: 'aguardando_esterilizacao', metodo: 9, emCarga: true }], [5]),
    ).toEqual([{ campo: 'pacotes', mensagem: 'O pacote 5 já está numa carga aberta.' }]);
  });
  it('indicadores conformes liberam; não conforme reprova; falta físico ou químico recusa', () => {
    expect(
      desfechoDoCiclo({ fisico: 'conforme', quimico: 'conforme', biologico: 'pendente' }, false).situacao,
    ).toBe('liberado');
    expect(
      desfechoDoCiclo({ fisico: 'conforme', quimico: 'nao_conforme', biologico: 'pendente' }, false),
    ).toEqual({
      situacao: 'reprovado',
      motivo: 'Indicador não conforme: quimico.',
    });
    const r = desfechoDoCiclo({ fisico: 'pendente', quimico: 'pendente', biologico: 'conforme' }, false);
    expect(r.situacao === 'recusa' && r.problemas.map((p) => p.campo)).toEqual(['fisico', 'quimico']);
  });
  it('carga com implante aguarda o biológico e só então libera', () => {
    expect(
      desfechoDoCiclo({ fisico: 'conforme', quimico: 'conforme', biologico: 'pendente' }, true).situacao,
    ).toBe('concluido');
    expect(
      desfechoDoCiclo({ fisico: 'conforme', quimico: 'conforme', biologico: 'conforme' }, true).situacao,
    ).toBe('liberado');
    expect(desfechoDaLiberacao('concluido', 'conforme').situacao).toBe('liberado');
    expect(desfechoDaLiberacao('concluido', 'nao_conforme').situacao).toBe('reprovado');
    expect(desfechoDaLiberacao('concluido', 'pendente').situacao).toBe('recusa');
    expect(desfechoDaLiberacao('liberado', 'conforme').situacao).toBe('recusa');
  });
});

describe('entrega e uso na cirurgia', () => {
  const ok = {
    situacao: 'esteril',
    validade: '2026-12-01',
    cicloSituacao: 'liberado',
    agendamentoEntregue: null,
  };
  it('entrega só pacote estéril, liberado e na validade', () => {
    expect(conferirEntrega(ok, '2026-11-25')).toEqual([]);
    expect(conferirEntrega({ ...ok, situacao: 'aguardando_esterilizacao' }, '2026-11-25')).toHaveLength(1);
    expect(conferirEntrega({ ...ok, cicloSituacao: 'concluido' }, '2026-11-25')).toHaveLength(1);
    expect(conferirEntrega(ok, '2026-12-02')[0]?.mensagem).toMatch(/validade/);
  });
  it('uso só na cirurgia para a qual o pacote foi entregue', () => {
    const d = { ...ok, situacao: 'distribuido', agendamentoEntregue: 5 };
    expect(conferirUso(d, 5, '2026-11-25')).toEqual([]);
    expect(conferirUso(d, 6, '2026-11-25')).toHaveLength(1);
  });
  it('situação da solicitação pelos itens', () => {
    expect(situacaoDaSolicitacao([{ situacao: 'entregue' }, { situacao: 'cancelado' }])).toBe('entregue');
    expect(situacaoDaSolicitacao([{ situacao: 'entregue' }, { situacao: 'pendente' }])).toBe('parcial');
    expect(situacaoDaSolicitacao([{ situacao: 'pronto' }])).toBe('em_processamento');
    expect(situacaoDaSolicitacao([{ situacao: 'pendente' }])).toBe('aberta');
    expect(situacaoDaSolicitacao([{ situacao: 'cancelado' }])).toBe('cancelada');
  });
});
