// CPF duplicado no mesmo estabelecimento (M57, regra 5; ref 01 §2.2: 14 CPFs válidos em mais de um prontuário no pc):
// não é do MPI da Rede; o grupo vai para a fila de duplicidades do cadastro e só o de menor ID segue para a Rede.
import { describe, expect, it } from 'vitest';
import { decidirPar } from './automatico.js';
import { comparavel } from './cadastro.js';
import { separarDuplicadosLocais } from './duplicado-local.js';
import { CPF_A, CPF_B, cadastro, noOutro } from './massa.spec-util.js';

describe('duplicado local', () => {
  it('separa o grupo do mesmo CPF no mesmo estabelecimento e manda o menor ID para a Rede', () => {
    const lista = [
      comparavel(cadastro({ id: 30, idUnificado: 30 })),
      comparavel(cadastro({ id: 10, idUnificado: 10 })),
      comparavel(cadastro({ id: 20, idUnificado: 20, cpf: CPF_B })),
      comparavel(cadastro({ id: 40, idUnificado: 40, cpf: null })),
      comparavel(cadastro({ id: 50, idUnificado: 50, ativo: false })),
      comparavel(noOutro({ cpf: CPF_A })),
    ];
    const r = separarDuplicadosLocais(lista);
    expect(r.gruposLocais).toEqual([{ estabelecimento: 'pc', ids: [10, 30] }]);
    expect(r.paraARede.map((c) => `${c.estabelecimento}:${c.id}`)).toEqual([
      'hs:909',
      'pc:10',
      'pc:20',
      'pc:40',
    ]);
  });

  it('o mesmo CPF em estabelecimentos diferentes não é duplicado local', () => {
    const r = separarDuplicadosLocais([comparavel(cadastro()), comparavel(noOutro())]);
    expect(r.gruposLocais).toEqual([]);
    expect(r.paraARede).toHaveLength(2);
  });

  it('o par do mesmo estabelecimento nunca vira candidato da Rede', () => {
    const d = decidirPar(comparavel(cadastro({ id: 10 })), comparavel(cadastro({ id: 30 })));
    expect(d.destino).toBe('fila_duplicidade_local');
  });

  it('grupos ordenados por estabelecimento e ID', () => {
    const r = separarDuplicadosLocais([
      comparavel(noOutro({ id: 5, idUnificado: 5, cpf: CPF_B })),
      comparavel(noOutro({ id: 3, idUnificado: 3, cpf: CPF_B })),
      comparavel(cadastro({ id: 9, idUnificado: 9 })),
      comparavel(cadastro({ id: 8, idUnificado: 8 })),
    ]);
    expect(r.gruposLocais).toEqual([
      { estabelecimento: 'hs', ids: [3, 5] },
      { estabelecimento: 'pc', ids: [8, 9] },
    ]);
  });
});
