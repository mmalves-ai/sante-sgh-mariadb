import { describe, expect, it } from 'vitest';
import {
  conferirDevolucao,
  conferirDisponibilidade,
  conferirEnvio,
  conferirMaterialTerceiro,
  conferirRecebimento,
  desfechoDaConferencia,
  type MaterialTerceiroEntrada,
} from './material-terceiro.js';

const base: MaterialTerceiroEntrada = {
  descricao: 'CAIXA DE COLUNA',
  tipoProprietario: 'fornecedor',
  fornecedor: 7,
  profissional: null,
  quantidadePecas: 40,
  validadeDias: 30,
  expurgo: true,
  lavagem: true,
  desinfeccao: false,
  preparo: true,
  esterilizacao: true,
  guardaArsenal: false,
  arsenal: null,
};
const campos = (p: { campo: string }[]) => p.map((x) => x.campo);

describe('material de terceiro: cadastro', () => {
  it('aceita o consignado do fornecedor com o roteiro completo', () => {
    expect(conferirMaterialTerceiro(base)).toEqual([]);
  });
  it('exige o dono coerente com o tipo', () => {
    expect(campos(conferirMaterialTerceiro({ ...base, fornecedor: null }))).toContain('fornecedor');
    expect(campos(conferirMaterialTerceiro({ ...base, tipoProprietario: 'profissional' }))).toEqual([
      'profissional',
      'fornecedor',
    ]);
    expect(conferirMaterialTerceiro({ ...base, tipoProprietario: 'paciente', fornecedor: null })).toEqual([]);
  });
  it('exige limpeza antes da esterilização, preparo e validade', () => {
    expect(
      campos(conferirMaterialTerceiro({ ...base, lavagem: false, preparo: false, validadeDias: null })),
    ).toEqual(['preparo', 'lavagem', 'validadeDias']);
    expect(
      campos(conferirMaterialTerceiro({ ...base, lavagem: false, esterilizacao: false, desinfeccao: false })),
    ).toEqual(['roteiro']);
    expect(campos(conferirMaterialTerceiro({ ...base, guardaArsenal: true }))).toEqual(['arsenal']);
  });
});

describe('material de terceiro: recebimento e conferência', () => {
  const item = {
    material: 1,
    quantidade: 2,
    ativo: true,
    tipoProprietario: 'fornecedor' as const,
    fornecedor: 7,
  };
  it('aceita o recebimento com entregador e itens do mesmo fornecedor', () => {
    expect(conferirRecebimento({ fornecedor: 7, entregador: 'REPRESENTANTE', itens: [item] })).toEqual([]);
  });
  it('recusa sem entregador, item repetido, inativo, sem quantidade ou de outro fornecedor', () => {
    const p = conferirRecebimento({
      fornecedor: 8,
      entregador: ' ',
      itens: [item, { ...item, ativo: false, quantidade: 0 }],
    });
    expect(p.map((x) => x.mensagem)).toEqual([
      'Identifique quem entregou o material na CME.',
      'O material é de outro fornecedor.',
      'O mesmo material aparece duas vezes no recebimento.',
      'O material está inativo.',
      'A quantidade recebida é maior que zero.',
      'O material é de outro fornecedor.',
    ]);
    expect(campos(conferirRecebimento({ fornecedor: null, entregador: 'X', itens: [] }))).toEqual(['itens']);
  });
  it('confere peça a peça: tudo conferido fica conferido; divergência fica divergente', () => {
    expect(
      desfechoDaConferencia(
        'recebido',
        [1, 2],
        [
          { sequencia: 1, conferido: true, divergencia: null },
          { sequencia: 2, conferido: true, divergencia: null },
        ],
      ),
    ).toEqual({ situacao: 'conferido', problemas: [] });
    const d = desfechoDaConferencia(
      'recebido',
      [1, 2],
      [
        { sequencia: 1, conferido: true, divergencia: null },
        { sequencia: 2, conferido: false, divergencia: 'Falta 1 parafuso' },
      ],
    );
    expect(d).toEqual({ situacao: 'divergente', problemas: [] });
  });
  it('recusa conferência incompleta, item alheio, falta sem motivo ou situação errada', () => {
    const d = desfechoDaConferencia(
      'devolvido',
      [1, 2],
      [
        { sequencia: 1, conferido: false, divergencia: null },
        { sequencia: 3, conferido: true, divergencia: null },
      ],
    );
    expect(campos(d.problemas)).toEqual(['situacao', 'itens.2', 'itens.1', 'itens.3']);
  });
});

describe('material de terceiro: reprocessamento e devolução', () => {
  it('envia só o conferido e gera pacote para o que exige esterilização', () => {
    const itens = [
      { sequencia: 1, esterilizacao: true, ativo: true },
      { sequencia: 2, esterilizacao: false, ativo: true },
    ];
    expect(conferirEnvio('conferido', itens)).toEqual({ pacotes: [1], problemas: [] });
    expect(campos(conferirEnvio('divergente', itens).problemas)).toEqual(['situacao']);
  });
  it('disponível só com todos os pacotes estéreis', () => {
    expect(conferirDisponibilidade('em_reprocessamento', ['esteril', 'distribuido'])).toEqual([]);
    expect(
      conferirDisponibilidade('em_reprocessamento', ['esteril', 'aguardando_esterilizacao'])[0]?.mensagem,
    ).toBe('Há pacote ainda não esterilizado.');
    expect(conferirDisponibilidade('em_reprocessamento', ['rejeitado'])[0]?.campo).toBe('pacotes');
    expect(campos(conferirDisponibilidade('conferido', []))).toEqual(['situacao']);
  });
  it('devolução conferida soma utilizado e devolvido e exige paciente para o uso', () => {
    const it1 = { sequencia: 1, recebida: 3, utilizada: 1, devolvida: 2, conferido: true };
    const ok = {
      situacao: 'disponivel',
      recebedor: 'REPRESENTANTE',
      temPaciente: true,
      sequencias: [1],
      itens: [it1],
    };
    expect(conferirDevolucao(ok)).toEqual([]);
    expect(conferirDevolucao({ ...ok, temPaciente: false })[0]?.mensagem).toMatch(/paciente/);
    expect(
      campos(
        conferirDevolucao({
          ...ok,
          situacao: 'em_reprocessamento',
          recebedor: null,
          itens: [{ ...it1, devolvida: 1, conferido: false }],
        }),
      ),
    ).toEqual(['situacao', 'recebedor', 'itens.1', 'itens.1']);
    expect(campos(conferirDevolucao({ ...ok, itens: [] }))).toEqual(['itens.1']);
  });
});
