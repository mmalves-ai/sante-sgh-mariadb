import { ESCOPOS_SEM_RESTRICAO } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  criarAbility,
  escoposDaPermissao,
  filtroDeEscopo,
  partesDaPermissao,
  pode,
  regrasDeAcesso,
} from './ability.js';

describe('CASL: as mesmas regras no servidor e na tela (regra 5)', () => {
  it('permissão vira ação sobre modulo.recurso; sem registro, responde pela permissão', () => {
    expect(partesDaPermissao('pep.evolucao.ler')).toEqual({ acao: 'ler', sujeito: 'pep.evolucao' });
    const a = criarAbility(regrasDeAcesso(['pep.evolucao.ler', 'acesso.inicio.ler'], ESCOPOS_SEM_RESTRICAO));
    expect(pode(a, 'pep.evolucao.ler')).toBe(true);
    expect(pode(a, 'pep.evolucao.criar')).toBe(false);
    expect(pode(a, 'acesso.inicio.ler', { unidade: 9 })).toBe(true); // módulo sem escopo
  });

  it('escopo do legado: registro fora da unidade é recusado (troca de ID não fura); lista vazia não restringe', () => {
    const escopos = { ...ESCOPOS_SEM_RESTRICAO, unidades: ['1', '2'], convenios: ['30'] };
    const a = criarAbility(regrasDeAcesso(['recepcao.atendimento.ler', 'faturamento.conta.ler'], escopos));
    expect(pode(a, 'recepcao.atendimento.ler', { unidade: 1 })).toBe(true);
    expect(pode(a, 'recepcao.atendimento.ler', { unidade: '3' })).toBe(false);
    expect(pode(a, 'recepcao.atendimento.ler', { unidade: null })).toBe(false);
    expect(pode(a, 'faturamento.conta.ler', { convenio: 30 })).toBe(true);
    expect(pode(a, 'faturamento.conta.ler', { convenio: 31 })).toBe(false);
    const livre = criarAbility(regrasDeAcesso(['recepcao.atendimento.ler'], null));
    expect(pode(livre, 'recepcao.atendimento.ler', { unidade: 3 })).toBe(true);
  });

  it('filtro da consulta: valores aceitos por escopo, null sem restrição; vínculo fora do CASL', () => {
    expect(escoposDaPermissao('pep.evolucao.ler')).toEqual(['unidade', 'vinculo']);
    expect(escoposDaPermissao('acesso.inicio.ler')).toEqual([]);
    expect(filtroDeEscopo('recepcao.atendimento.ler', { ...ESCOPOS_SEM_RESTRICAO, unidades: ['5'] })).toEqual(
      {
        unidade: ['5'],
        local: null,
      },
    );
    expect(filtroDeEscopo('pep.evolucao.ler', undefined)).toEqual({ unidade: null });
  });
});
