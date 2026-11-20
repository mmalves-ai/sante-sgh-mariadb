// Liberação do recurso para o estabelecimento inteiro (POL-3; M57, a Rede lendo e gravando em outro banco e o worker):
// só a chave de escopo `hospital` vale, com os pré-requisitos cumpridos na hora.
import { recursoDesligado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { recursoLigadoNoEstabelecimento } from './recurso.js';

const declarados = recursoDesligado('rede.mpi')?.prerequisitos ?? [];
const cumprido = [{ tipo: 'aprovacao' as const, situacao: 'cumprido' as const, validade: null }];
const agora = new Date('2026-10-24T12:00:00Z');

describe('recurso ligado no estabelecimento', () => {
  it('chave do estabelecimento ligada e pré-requisitos cumpridos: ligado', () => {
    expect(declarados.length).toBeGreaterThan(0);
    expect(
      recursoLigadoNoEstabelecimento(
        [{ escopo: 'hospital', valor: '*', ligada: true }],
        declarados,
        cumprido,
        agora,
      ),
    ).toBe(true);
  });

  it('pré-requisito pendente, chave desligada, só por pessoa ou setor, ou sem chave: desligado', () => {
    const ligada = [{ escopo: 'hospital' as const, valor: '*', ligada: true }];
    expect(recursoLigadoNoEstabelecimento(ligada, declarados, [], agora)).toBe(false);
    expect(
      recursoLigadoNoEstabelecimento(
        ligada,
        declarados,
        [{ tipo: 'aprovacao', situacao: 'pendente', validade: null }],
        agora,
      ),
    ).toBe(false);
    expect(
      recursoLigadoNoEstabelecimento(
        [{ escopo: 'hospital', valor: '*', ligada: false }],
        declarados,
        cumprido,
        agora,
      ),
    ).toBe(false);
    expect(
      recursoLigadoNoEstabelecimento(
        [
          { escopo: 'pessoa', valor: 'SINT.GESTOR', ligada: true },
          { escopo: 'setor', valor: '12', ligada: true },
        ],
        declarados,
        cumprido,
        agora,
      ),
    ).toBe(false);
    expect(recursoLigadoNoEstabelecimento([], declarados, cumprido, agora)).toBe(false);
  });
});
