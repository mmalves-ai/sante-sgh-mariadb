import { describe, expect, it } from 'vitest';
import { chaveGrupo, destinoDoGrupo, MAPA_GRUPOS } from './mapa-grupos.js';

// Os 42 grupos do legado (cap-08 §8.7, contados na cópia do pc): nomes de grupo, nenhuma pessoa.
const OS_42 = [
  'ALMOXARIFADO',
  'ALMOXARIFADO_SUPERVISÃO',
  'ATENDIMENTO',
  'ATENDIMENTO_INTERNAÇÃO',
  'ATENDIMENTO_PRONTO ATENDIMENTO',
  'ATENDIMENTO_SUPERVISÃO',
  'COMPRAS',
  'COMPRAS_SUPERVISÃO',
  'DIRETORIA',
  'DIRETOR_FINANCEIRO',
  'ENFERMAGEM_ENFERMEIRO',
  'ENFERMAGEM_ENFERMEIRO_CC',
  'ENFERMAGEM_SUPERVISÃO',
  'ENFERMAGEM_TECNICO',
  'EXAMES_LAUDOS',
  'EXAMES_TECNICO',
  'FARMACIA',
  'FARMACIA_SUPERVISÃO',
  'FATURAMENTO',
  'FATURAMENTO_ASSISTENCIAL',
  'FATURAMENTO_AUDITORIA',
  'FATURAMENTO_AUDITORIA_MATMED',
  'FATURAMENTO_SUPERVISÃO',
  'FINANCEIRO',
  'FINANCEIRO_CONSULTA',
  'FINANCEIRO_CONTAS_A_RECEBER',
  'FINANCEIRO_SUPERVISÃO',
  'FISIOTERAPIA',
  'HOTELARIA',
  'HOTERIA_SUPERVISÃO',
  'LABORATORIO',
  'LABORATORIO_SUPERVISÃO',
  'MASTER',
  'MASTER_CONSULTA_FINANCEIRO',
  'MASTER_SEM_FINANCEIRO',
  'MEDICOS',
  'MEDICOS_SUPERVISÃO',
  'NUTRICÃO',
  'PAINEIS',
  'SEM GRUPO',
  'TI',
  'TI_SUPERVISÃO',
];

describe('mapa dos 42 grupos (regra 12)', () => {
  it('os 42 grupos têm destino', () => {
    expect(OS_42).toHaveLength(42);
    expect(Object.keys(MAPA_GRUPOS)).toHaveLength(42);
    for (const g of OS_42) expect(MAPA_GRUPOS[chaveGrupo(g)], g).toBeDefined();
  });

  it('sem usuários ativos: continuam no legado; PAINEIS não é pessoa; MASTER* e SEM GRUPO caso a caso', () => {
    for (const g of [
      'DIRETORIA',
      'TI',
      'TI_SUPERVISÃO',
      'COMPRAS_SUPERVISÃO',
      'EXAMES_LAUDOS',
      'HOTERIA_SUPERVISÃO',
    ])
      expect(destinoDoGrupo(g).tipo, g).toBe('continua-no-legado');
    expect(destinoDoGrupo('PAINEIS').tipo).toBe('painel');
    for (const g of ['MASTER', 'MASTER_SEM_FINANCEIRO', 'MASTER_CONSULTA_FINANCEIRO', 'SEM GRUPO'])
      expect(destinoDoGrupo(g).tipo, g).toBe('caso-a-caso');
    expect(destinoDoGrupo('MEDICOS')).toMatchObject({ tipo: 'perfil', perfil: 'medico', assistencial: true });
    expect(destinoDoGrupo('ATENDIMENTO')).toMatchObject({ tipo: 'perfil', assistencial: false });
  });

  it('grupo novo ou sem grupo nunca recebe perfil por adivinhação; a chave ignora acento e espaço', () => {
    expect(destinoDoGrupo(null).tipo).toBe('caso-a-caso');
    expect(destinoDoGrupo('GRUPO_CRIADO_DEPOIS').tipo).toBe('caso-a-caso');
    expect(chaveGrupo(' nutricão  ')).toBe('NUTRICAO');
  });
});
