import { describe, expect, it } from 'vitest';
import {
  alocarPacotesNaSolicitacao,
  conferirCancelamentoDaSolicitacao,
  conferirConferenciaDoMovimento,
  conferirGravacaoDaPermissao,
  conferirPermissaoDoSetor,
  conferirRecebimentoDaSolicitacao,
  desfechoDoRecolhimento,
  type PermissaoSetorCme,
  situacaoDaSolicitacaoNoFluxo,
} from './fluxo-material.js';

const semNada: Omit<PermissaoSetorCme, 'setor'> = {
  expurgo: false,
  lavagem: false,
  desinfeccao: false,
  preparo: false,
  esterilizacao: false,
  entradaArsenal: false,
  saidaArsenal: false,
  devolucaoArsenal: false,
  transferenciaArsenal: false,
  terceirizacao: false,
};

describe('permissão da CME por setor', () => {
  it('sem cadastro vale só o perfil', () => {
    expect(conferirPermissaoDoSetor([], 7, 'entrega')).toEqual([]);
  });
  it('com cadastro, só o setor e o tipo marcados', () => {
    const p = [{ ...semNada, setor: 7, saidaArsenal: true }];
    expect(conferirPermissaoDoSetor(p, 7, 'entrega')).toEqual([]);
    expect(conferirPermissaoDoSetor(p, 7, 'recolhimento')[0]?.campo).toBe('tipo');
    expect(conferirPermissaoDoSetor(p, 8, 'entrega')[0]?.campo).toBe('setor');
  });
});

describe('solicitação', () => {
  it('recebe só a aberta', () => {
    expect(conferirRecebimentoDaSolicitacao('aberta')).toEqual([]);
    expect(conferirRecebimentoDaSolicitacao('recebida_cme')).toHaveLength(1);
  });
  it('cancela antes do atendimento e com motivo', () => {
    expect(
      conferirCancelamentoDaSolicitacao('aberta', [{ situacao: 'pendente' }], 'Cirurgia suspensa'),
    ).toEqual([]);
    expect(
      conferirCancelamentoDaSolicitacao('recebida_cme', [{ situacao: 'pronto' }], 'Cirurgia suspensa'),
    ).toHaveLength(1);
    expect(conferirCancelamentoDaSolicitacao('entregue', [], 'x')).toHaveLength(2);
  });
  it('situação pelos itens, mantendo a recebida', () => {
    expect(situacaoDaSolicitacaoNoFluxo('recebida_cme', [{ situacao: 'pendente' }])).toBe('recebida_cme');
    expect(situacaoDaSolicitacaoNoFluxo('aberta', [{ situacao: 'pendente' }])).toBe('aberta');
    expect(situacaoDaSolicitacaoNoFluxo('aberta', [{ situacao: 'entregue' }, { situacao: 'pendente' }])).toBe(
      'parcial',
    );
    expect(situacaoDaSolicitacaoNoFluxo('aberta', [{ situacao: 'pendente', atendida: 1 }])).toBe('parcial');
    expect(
      situacaoDaSolicitacaoNoFluxo('parcial', [{ situacao: 'entregue' }, { situacao: 'cancelado' }]),
    ).toBe('entregue');
    expect(situacaoDaSolicitacaoNoFluxo('aberta', [{ situacao: 'cancelado' }])).toBe('cancelada');
  });
});

describe('entrega ao setor', () => {
  const itens = [
    { id: 1, caixa: 10, situacao: 'pronto', quantidade: 1, atendida: 0, pacote: 100 },
    { id: 2, caixa: 20, situacao: 'pendente', quantidade: 2, atendida: 0, pacote: null },
  ];
  it('usa o item preparado e depois a caixa', () => {
    const r = alocarPacotesNaSolicitacao(itens, [
      { id: 100, caixa: 10 },
      { id: 200, caixa: 20 },
      { id: 201, caixa: 20 },
    ]);
    expect(r.problemas).toEqual([]);
    expect(r.alocacoes).toEqual([
      { pacote: 100, item: 1, atendida: 1, entregue: true },
      { pacote: 200, item: 2, atendida: 1, entregue: false },
      { pacote: 201, item: 2, atendida: 2, entregue: true },
    ]);
  });
  it('recusa pacote além do pedido, de outra caixa ou repetido', () => {
    const r = alocarPacotesNaSolicitacao(itens, [
      { id: 200, caixa: 20 },
      { id: 200, caixa: 20 },
      { id: 201, caixa: 20 },
      { id: 202, caixa: 20 },
      { id: 300, caixa: 30 },
    ]);
    expect(r.problemas).toHaveLength(3);
  });
});

describe('recolhimento', () => {
  const pacotes = [
    { id: 1, situacao: 'distribuido', validade: '2026-12-31', setorEntregue: 5 },
    { id: 2, situacao: 'usado', validade: '2026-12-31', setorEntregue: 5 },
    { id: 3, situacao: 'distribuido', validade: '2026-01-01', setorEntregue: 5 },
    { id: 4, situacao: 'esteril', validade: '2026-12-31', setorEntregue: null },
    { id: 5, situacao: 'distribuido', validade: '2026-12-31', setorEntregue: 9 },
  ];
  it('íntegro e válido volta ao arsenal; o resto vai ao expurgo', () => {
    const r = desfechoDoRecolhimento(
      5,
      pacotes,
      [
        { pacote: 1, integro: true },
        { pacote: 2, integro: true },
        { pacote: 3, integro: true },
      ],
      '2026-11-26',
    );
    expect(r.problemas).toEqual([]);
    expect(r.desfechos).toEqual([
      { pacote: 1, destino: 'arsenal', situacao: 'esteril' },
      { pacote: 2, destino: 'expurgo', situacao: 'usado' },
      { pacote: 3, destino: 'expurgo', situacao: 'descartado' },
    ]);
    expect(
      desfechoDoRecolhimento(5, pacotes, [{ pacote: 1, integro: false }], '2026-11-26').desfechos[0]
        ?.situacao,
    ).toBe('descartado');
  });
  it('recusa o que está na CME, de outro setor, inexistente ou vazio', () => {
    const r = desfechoDoRecolhimento(
      5,
      pacotes,
      [
        { pacote: 4, integro: true },
        { pacote: 5, integro: true },
        { pacote: 99, integro: true },
      ],
      '2026-11-26',
    );
    expect(r.problemas).toHaveLength(3);
    expect(desfechoDoRecolhimento(5, pacotes, [], '2026-11-26').problemas).toHaveLength(1);
  });
  it('confere só o movimento aberto', () => {
    expect(conferirConferenciaDoMovimento('aberto')).toEqual([]);
    expect(conferirConferenciaDoMovimento('conferido')).toHaveLength(1);
  });
});

describe('conferirGravacaoDaPermissao', () => {
  it('recusa o colaborador gravando as próprias permissões e aceita outro responsável', () => {
    expect(conferirGravacaoDaPermissao(7, 7).map((p) => p.campo)).toEqual(['usuario']);
    expect(conferirGravacaoDaPermissao(8, 7)).toEqual([]);
  });
});
