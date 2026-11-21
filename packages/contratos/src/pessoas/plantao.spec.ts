// Contratos da fatia F3 (M52.3): esquemas da troca, do plantão agora, do acionamento e do dimensionamento; as seis
// permissões (aprovar a troca e calcular o dimensionamento só pelo perfil); a chave e os eventos auditáveis.
import { describe, expect, it } from 'vitest';
import { EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { recursoDesligado } from '../liberacao/recursos.js';
import { PERMISSOES_PESSOAS_M52_F3 } from '../permissoes/pessoas.js';
import {
  esquemaAcionarSobreaviso,
  esquemaCalcularDimensionamento,
  esquemaDecidirTroca,
  esquemaFiltroPlantaoAgora,
  esquemaFiltroTrocas,
  esquemaPedirTroca,
  esquemaResponderTroca,
} from './plantao-entradas.js';
import {
  CATEGORIAS_SCP,
  PERCENTUAL_ENFERMEIROS_SCP,
  TURNO_CLASSIFICACAO_DA_ESCALA,
} from './plantao-vocabulario.js';
import { opcoesDoMapa } from '../permissoes/mapa-origem-teste.js';

const motivo = 'Compromisso familiar no dia';

describe('contratos da fatia F3 (M52.3)', () => {
  it('pedido de troca: a troca pede o plantão do colega; a cessão não', () => {
    const base = { plantao: 1, versao: 0, colega: 2, motivo };
    expect(esquemaPedirTroca.safeParse({ ...base, tipo: 'cessao' }).success).toBe(true);
    expect(esquemaPedirTroca.safeParse({ ...base, tipo: 'troca' }).success).toBe(false);
    expect(
      esquemaPedirTroca.safeParse({ ...base, tipo: 'troca', plantaoColega: 3, versaoColega: 1 }).success,
    ).toBe(true);
    expect(esquemaPedirTroca.safeParse({ ...base, tipo: 'troca', plantaoColega: 3 }).success).toBe(false);
    expect(esquemaPedirTroca.safeParse({ ...base, tipo: 'cessao', motivo: 'curto' }).success).toBe(false);
  });

  it('resposta e decisão: a reprovação pede o motivo; a confirmação da coordenação tem tamanho mínimo', () => {
    expect(esquemaResponderTroca.safeParse({ troca: 1, versao: 0, aceite: true }).success).toBe(true);
    expect(
      esquemaResponderTroca.safeParse({ troca: 1, versao: 0, aceite: true, confirmacao: 'ok' }).success,
    ).toBe(false);
    expect(esquemaDecidirTroca.safeParse({ troca: 1, versao: 0, aprovar: true }).success).toBe(true);
    expect(esquemaDecidirTroca.safeParse({ troca: 1, versao: 0, aprovar: false }).success).toBe(false);
    expect(esquemaFiltroTrocas.parse({ minhas: 'sim' }).minhas).toBe(true);
    expect(esquemaFiltroTrocas.parse({}).minhas).toBe(false);
  });

  it('plantão agora e acionamento', () => {
    expect(esquemaFiltroPlantaoAgora.safeParse({ instante: '2026-11-02T02:30' }).success).toBe(true);
    expect(esquemaFiltroPlantaoAgora.safeParse({ instante: '2026-11-02 02:30' }).success).toBe(false);
    expect(esquemaFiltroPlantaoAgora.safeParse({ especialidade: '225125' }).success).toBe(true);
    expect(esquemaFiltroPlantaoAgora.safeParse({ especialidade: 'CRM' }).success).toBe(false);
    expect(esquemaAcionarSobreaviso.parse({ plantao: 1, motivo }).atendimento).toBeNull();
  });

  it('dimensionamento: IST de pelo menos 15%, jornada de 20 h a 44 h, a fonte com o que ela precisa', () => {
    const base = {
      unidade: 1,
      data: '2026-11-02',
      turno: 'manha',
      jornadaSemanalHoras: 36,
      ist: 0.15,
      fonte: 'informada',
      pacientes: { minimos: 1, intermediarios: 2, altaDependencia: 0, semiIntensivos: 0, intensivos: 0 },
    };
    expect(esquemaCalcularDimensionamento.safeParse(base).success).toBe(true);
    expect(esquemaCalcularDimensionamento.safeParse({ ...base, ist: 0.1 }).success).toBe(false);
    expect(esquemaCalcularDimensionamento.safeParse({ ...base, jornadaSemanalHoras: 50 }).success).toBe(
      false,
    );
    expect(esquemaCalcularDimensionamento.safeParse({ ...base, pacientes: null }).success).toBe(false);
    expect(
      esquemaCalcularDimensionamento.safeParse({ ...base, fonte: 'classificacao', pacientes: null }).success,
    ).toBe(false);
    expect(
      esquemaCalcularDimensionamento.safeParse({
        ...base,
        fonte: 'classificacao',
        pacientes: null,
        unidadeInternacao: 'UI1',
      }).success,
    ).toBe(true);
  });

  it('vocabulário COFEN 543/2017: horas por categoria, percentual de enfermeiros, turno da classificação', () => {
    expect(Object.values(CATEGORIAS_SCP).map((c) => c.horas)).toEqual([4, 6, 10, 10, 18]);
    expect(Object.values(PERCENTUAL_ENFERMEIROS_SCP)).toEqual([0.33, 0.33, 0.36, 0.42, 0.52]);
    expect(TURNO_CLASSIFICACAO_DA_ESCALA).toEqual({ manha: 'diurno', tarde: 'diurno', noite: 'noturno' });
  });

  it('permissões: as seis da ficha; aprovar e calcular só pelo perfil; pedir e ler por todo perfil de pessoa', () => {
    const por = new Map(PERMISSOES_PESSOAS_M52_F3.map((p) => [p.codigo, p]));
    expect([...por.keys()]).toEqual([
      'pessoas.troca.pedir',
      'pessoas.troca.aprovar',
      'pessoas.plantao.ler',
      'pessoas.sobreaviso.acionar',
      'pessoas.dimensionamento.ler',
      'pessoas.dimensionamento.calcular',
    ]);
    for (const c of ['pessoas.troca.aprovar', 'pessoas.dimensionamento.calcular']) {
      expect(opcoesDoMapa(c)).toEqual([]);
      expect(por.get(c)).toMatchObject({
        concessaoPorPerfil: 'por-perfil',
        perfis: ['gestor-escala'],
      });
    }
    for (const c of ['pessoas.troca.pedir', 'pessoas.plantao.ler'])
      expect(por.get(c)?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
    expect(opcoesDoMapa(por.get('pessoas.sobreaviso.acionar')?.codigo)).toEqual([3399, 5073]);
  });

  it('chave do dimensionamento com o pré-requisito e os eventos auditáveis', () => {
    expect(recursoDesligado('pessoas.dimensionamento')?.prerequisitos).toHaveLength(1);
    for (const k of [
      'pessoasTrocaPedida',
      'pessoasTrocaRespondida',
      'pessoasTrocaDecidida',
      'pessoasSobreavisoAcionado',
      'pessoasDimensionamentoCalculado',
    ] as const)
      expect(EVENTOS_AUDITAVEIS[k].codigo).toMatch(/^pessoas\./);
  });
});
