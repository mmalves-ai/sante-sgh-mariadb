// Regras do cadastro do estoque (F3.6, 05-SUP linhas 1, 3 e 6): item, local, escopo do usuário e lista de separação.
import { describe, expect, it } from 'vitest';
import {
  conferirConcessaoVigente,
  conferirEscopoLocal,
  conferirInativacaoItem,
  conferirInativacaoLocal,
  conferirItemEstoque,
  conferirLocalEstoque,
  fimDaRetirada,
  gtinValido,
  type ItemEstoqueEntrada,
  type LocalEstoqueEntrada,
  montarSeparacao,
  situacaoRegistroNaData,
} from './index.js';

const item = (x: Partial<ItemEstoqueEntrada> = {}): ItemEstoqueEntrada => ({
  codigo: 'MAT1',
  nome: 'Seringa 10 ml',
  tipo: 'material',
  grupo: 1,
  unidadeEstoque: 1,
  fatorCompraEstoque: 100,
  fatorEstoqueConsumo: 1,
  fatorConsumoPrescricao: 1,
  controlaLote: false,
  controlaValidade: false,
  controlado: false,
  antimicrobiano: false,
  altaVigilancia: false,
  fracionavel: false,
  prescritivel: false,
  principiosAtivos: [],
  vias: [],
  codigosBarras: [],
  apresentacoes: [],
  estabilidades: [],
  ...x,
});
const codigos = (f: { codigo: string }[]) => f.map((x) => x.codigo);

describe('cadastro do item', () => {
  it('GTIN com dígito verificador', () => {
    expect(gtinValido('7891234567895')).toBe(true);
    expect(gtinValido('7891234567890')).toBe(false);
    expect(gtinValido('96385074')).toBe(true);
    expect(gtinValido('12AB')).toBe(false);
  });

  it('material simples passa; medicamento exige princípio ativo e via quando prescritível', () => {
    expect(conferirItemEstoque(item())).toEqual([]);
    expect(codigos(conferirItemEstoque(item({ tipo: 'medicamento', prescritivel: true })))).toEqual([
      'item-sem-principio',
      'item-sem-via',
    ]);
    expect(
      conferirItemEstoque(
        item({
          tipo: 'medicamento',
          prescritivel: true,
          principiosAtivos: [{ principio: 3, concentracao: 500, unidade: 2, principal: true }],
          vias: [{ via: 1, padrao: true }],
        }),
      ),
    ).toEqual([]);
  });

  it('recusa fator zero, lote sem validade, controlado fora de medicamento, GTIN, NCM e limites', () => {
    const f = conferirItemEstoque(
      item({
        fatorCompraEstoque: 0,
        controlaLote: true,
        controlado: true,
        gtin: '7891234567890',
        ncm: '1234',
        cest: '12',
        estoqueMinimo: 10,
        estoqueMaximo: 5,
      }),
    );
    expect(codigos(f)).toEqual([
      'item-fator',
      'item-lote-sem-validade',
      'item-controlado-tipo',
      'item-gtin',
      'item-ncm',
      'item-cest',
      'item-estoque-limites',
    ]);
    expect(f[0]!.campos).toEqual(['fatorCompraEstoque']);
  });

  it('códigos de barras, apresentação, registro sanitário, OPME e estabilidade', () => {
    const f = conferirItemEstoque(
      item({
        tipo: 'opme',
        codigosBarras: [
          { codigo: '7891234567895', padrao: 'gtin', quantidade: 1, unidade: 1, principal: true },
          { codigo: '7891234567895', padrao: 'gtin', quantidade: 1, unidade: 1, principal: true },
          { codigo: 'X1', padrao: 'gtin', quantidade: 0, unidade: 1 },
        ],
        apresentacoes: [{ nomeComercial: 'Marca', quantidadeEmbalagem: 1, registro: { numero: '12A' } }],
        estabilidades: [
          { condicao: 'aberto', horas: 0 },
          { condicao: 'aberto', horas: 24 },
        ],
      }),
    );
    expect(codigos(f)).toEqual(
      expect.arrayContaining([
        'item-barras-repetido',
        'item-barras-gtin',
        'item-barras-quantidade',
        'item-barras-principal',
        'item-registro',
        'item-estabilidade-repetida',
        'item-estabilidade-horas',
      ]),
    );
    expect(codigos(conferirItemEstoque(item({ tipo: 'opme' })))).toEqual(['item-opme-sem-registro']);
  });

  it('registro vencido aparece vencido; inativação exige motivo e saldo zerado', () => {
    expect(situacaoRegistroNaData('valido', '2026-01-01', '2026-11-24')).toBe('vencido');
    expect(situacaoRegistroNaData('valido', '2027-01-01', '2026-11-24')).toBe('valido');
    expect(situacaoRegistroNaData('suspenso', null, '2026-11-24')).toBe('suspenso');
    expect(conferirInativacaoItem({ motivo: '', saldoTotal: 0 })?.codigo).toBe('inativar-sem-motivo');
    expect(conferirInativacaoItem({ motivo: 'Fora de linha', saldoTotal: 3 })?.codigo).toBe(
      'inativar-com-saldo',
    );
    expect(conferirInativacaoItem({ motivo: 'Fora de linha', saldoTotal: 0 })).toBeNull();
  });
});

const local = (x: Partial<LocalEstoqueEntrada> = {}): LocalEstoqueEntrada => ({
  codigo: 'FS1',
  nome: 'Farmácia satélite UTI',
  tipo: 'farmacia_satelite',
  atendeSetor: true,
  atendePaciente: true,
  atendeTransferencia: false,
  atendimentoParcial: true,
  verificaSaldo: true,
  usaCodigoBarras: true,
  apenasUrgente: false,
  setores: [],
  classificacoes: [],
  ...x,
});

describe('local de estoque e escopo do usuário', () => {
  it('local válido; recusa o próprio como origem, reposição sem origem, setores e classificação', () => {
    expect(conferirLocalEstoque(local())).toEqual([]);
    const f = conferirLocalEstoque(
      local({
        localOrigem: 7,
        tipoReposicao: 'ponto_pedido',
        horasAntecedencia: 900,
        setores: [
          { setor: 1, tipo: 'ambos', padrao: true },
          { setor: 1, tipo: 'requisicao', padrao: true },
        ],
        classificacoes: [{ grupo: 1, subgrupo: 2 }, { grupo: 3 }, { grupo: 3 }],
      }),
      7,
    );
    expect(codigos(f)).toEqual([
      'local-proprio',
      'local-antecedencia',
      'local-setor-repetido',
      'local-setor-padrao',
      'local-classificacao',
      'local-classificacao-repetida',
    ]);
    expect(codigos(conferirLocalEstoque(local({ tipoReposicao: 'ponto_pedido' })))).toEqual([
      'local-reposicao-sem-origem',
    ]);
  });

  it('inativar o local: motivo, sem saldo e sem requisição aberta', () => {
    expect(
      conferirInativacaoLocal({ motivo: 'Desativado', saldoTotal: 1, requisicoesAbertas: 0 })?.codigo,
    ).toBe('inativar-local-com-saldo');
    expect(
      conferirInativacaoLocal({ motivo: 'Desativado', saldoTotal: 0, requisicoesAbertas: 2 })?.codigo,
    ).toBe('inativar-local-com-requisicao');
    expect(
      conferirInativacaoLocal({ motivo: 'Desativado', saldoTotal: 0, requisicoesAbertas: 0 }),
    ).toBeNull();
  });

  it('escopo por local e concessão vigente', () => {
    expect(conferirEscopoLocal({ permissoes: [] })?.codigo).toBe('escopo-vazio');
    expect(conferirEscopoLocal({ permissoes: ['atender'], variacaoValorPct: 120 })?.codigo).toBe(
      'escopo-variacao',
    );
    expect(conferirEscopoLocal({ permissoes: ['atender', 'requisitar'] })).toBeNull();
    expect(
      conferirConcessaoVigente({ inicio: '2026-11-24', fim: '2026-11-01', permissoes: ['x'] })?.codigo,
    ).toBe('concessao-vigencia');
    expect(conferirConcessaoVigente({ inicio: '2026-11-24', permissoes: [] })?.codigo).toBe(
      'concessao-vazia',
    );
    expect(conferirConcessaoVigente({ inicio: '2026-11-24', permissoes: ['requisitar'] })).toBeNull();
    expect(fimDaRetirada('2026-01-01', '2026-11-24')).toBe('2026-11-23');
    expect(fimDaRetirada('2026-11-24', '2026-11-24')).toBe('2026-11-24');
  });
});

describe('lista de separação', () => {
  it('só o que falta, na ordem do endereço, lotes pela validade e a falta', () => {
    const l = montarSeparacao(
      [
        { sequencia: 1, item: 10, nome: 'Seringa', unidade: 'UN', solicitada: 10, atendida: 4, cancelada: 0 },
        {
          sequencia: 2,
          item: 20,
          nome: 'Dipirona',
          unidade: 'AMP',
          solicitada: 8,
          atendida: 0,
          cancelada: 0,
        },
        { sequencia: 3, item: 30, nome: 'Gaze', unidade: 'PCT', solicitada: 5, atendida: 5, cancelada: 0 },
        { sequencia: 4, item: 40, nome: 'Luva', unidade: 'CX', solicitada: 2, atendida: 0, cancelada: 0 },
      ],
      new Map([
        [
          10,
          [
            { codigo: 'B-02', preferencial: false },
            { codigo: 'A-01', preferencial: true },
          ],
        ],
        [20, [{ codigo: 'A-00', preferencial: true }]],
      ]),
      new Map([
        [
          20,
          [
            { lote: 'L2', validade: '2027-06-01', quantidade: 10 },
            { lote: 'L1', validade: '2027-01-01', quantidade: 5 },
            { lote: 'LV', validade: '2026-01-01', quantidade: 50 },
          ],
        ],
      ]),
      new Map([
        [10, 3],
        [20, 65],
        [40, 5],
      ]),
      '2026-11-24',
    );
    expect(l.map((x) => [x.item, x.endereco, x.aSeparar, x.falta])).toEqual([
      [20, 'A-00', 8, 0],
      [10, 'A-01', 6, 3],
      [40, null, 2, 0],
    ]);
    expect(l[0]!.lotes).toEqual([
      { lote: 'L1', validade: '2027-01-01', quantidade: 5 },
      { lote: 'L2', validade: '2027-06-01', quantidade: 3 },
    ]);
    expect(l[1]!.outrosEnderecos).toEqual(['B-02']);
  });

  it('lote só vencido: falta tudo, mesmo com saldo', () => {
    const [x] = montarSeparacao(
      [{ sequencia: 1, item: 1, nome: 'A', unidade: 'UN', solicitada: 2, atendida: 0, cancelada: 0 }],
      new Map(),
      new Map([[1, [{ lote: 'V', validade: '2025-01-01', quantidade: 9 }]]]),
      new Map([[1, 9]]),
      '2026-11-24',
    );
    expect(x!.falta).toBe(2);
  });
});
