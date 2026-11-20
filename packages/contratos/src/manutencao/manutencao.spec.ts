// Contratos da manutenção e engenharia clínica, fatia F1 (M55): permissões no catálogo, parâmetros do SLA, a chave
// desligada e as entradas (equipamento, abertura pelo QR, conclusão, plano, cobertura, filtros e período). Dados
// sintéticos.
import { describe, expect, it } from 'vitest';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { OPCOES_MANUTENCAO, PERMISSOES_MANUTENCAO_M55_F1 } from '../permissoes/manutencao.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import { definicaoParametro, PARAMETROS_NOVOS } from '../parametros/definicoes.js';
import { chaveParametroSla, PARAMETROS_MANUTENCAO } from '../parametros/manutencao.js';
import {
  esquemaAbrirOs,
  esquemaAlterarEquipamento,
  esquemaAndamentoOs,
  esquemaAssumirOs,
  esquemaCadastrarEquipamento,
  esquemaCancelarOs,
  esquemaAlterarContratoManutencao,
  esquemaCoberturaContrato,
  esquemaEncerrarContratoManutencao,
  esquemaExcluirContratoManutencao,
  esquemaCodigoEquipamento,
  esquemaConcluirOs,
  esquemaEncerrarOs,
  esquemaFiltroEquipamentos,
  esquemaFiltroOs,
  esquemaPeriodicidade,
  esquemaPeriodoIndicadores,
  esquemaPlanejarManutencao,
  esquemaRegistrarExecucao,
} from './entradas.js';
import {
  ATIVIDADES_COM_LAUDO,
  CHAVE_LIBERACAO_MANUTENCAO,
  CODIGOS_PRIORIDADE_OS,
  NATUREZAS_ABERTURA,
  OPERACAO_BLOQUEIO_DO_RECURSO,
  SITUACOES_OS_ABERTAS,
  SITUACOES_OS_ESPERA,
  SLA_PADRAO,
  TETO_LISTA_OS,
} from './vocabulario.js';

const equipamento = {
  codigo: 'eq-0001',
  nome: 'Monitor multiparamétrico sintético',
  tipo: 'medico',
  criticidade: 'critica',
  classeRisco: 'II',
  centroCusto: 10,
};

describe('permissões da F1 no catálogo', () => {
  it('as seis da ficha (seção 7) estão no catálogo, no formato, com mapeamento e sem escopo', () => {
    const codigos = PERMISSOES_MANUTENCAO_M55_F1.map((p) => p.codigo).sort();
    expect(codigos).toEqual(
      [
        'manutencao.equipamento.editar',
        'manutencao.equipamento.ler',
        'manutencao.os.abrir',
        'manutencao.os.atender',
        'manutencao.os.encerrar',
        'manutencao.preventiva.planejar',
      ].sort(),
    );
    const doCatalogo = new Set(CATALOGO_DECLARADO.map((p) => p.codigo));
    for (const p of PERMISSOES_MANUTENCAO_M55_F1) {
      expect(doCatalogo.has(p.codigo)).toBe(true);
      expect(p.codigo).toMatch(FORMATO_CODIGO_PERMISSAO);
      expect(p.opcoesLegado.length > 0 || p.concessaoPorPerfil !== null).toBe(true);
      expect(p.escopos).toEqual([]);
      expect(p.categoria).toBe('administrativa');
    }
  });

  it('abrir OS é de todo perfil de pessoa; atender e editar vêm da "Manutenção de Bens" do patrimônio', () => {
    const por = new Map(PERMISSOES_MANUTENCAO_M55_F1.map((p) => [p.codigo, p]));
    expect(por.get('manutencao.os.abrir')?.concessaoPorPerfil).toBe('todos-os-perfis-de-pessoa');
    expect(por.get('manutencao.os.atender')?.opcoesLegado).toContain(OPCOES_MANUTENCAO.manutencaoBens);
    expect(por.get('manutencao.equipamento.editar')?.opcoesLegado).toEqual([
      OPCOES_MANUTENCAO.manutencaoBens,
    ]);
    expect(por.get('manutencao.os.encerrar')?.criticidade).toBe('sensivel');
  });
});

describe('parâmetros e chave de liberação', () => {
  it('um SLA de atendimento e um de solução por prioridade, com o padrão do vocabulário', () => {
    for (const p of CODIGOS_PRIORIDADE_OS) {
      const a = definicaoParametro(chaveParametroSla(p, 'atendimento'));
      const s = definicaoParametro(chaveParametroSla(p, 'solucao'));
      expect(a?.padrao).toBe(String(SLA_PADRAO[p].atendimentoHoras));
      expect(s?.padrao).toBe(String(SLA_PADRAO[p].solucaoHoras));
      expect(SLA_PADRAO[p].atendimentoHoras).toBeLessThan(SLA_PADRAO[p].solucaoHoras);
    }
    expect(chaveParametroSla('emergencia', 'atendimento')).toBe('manutencao.slaEmergenciaAtendimentoHoras');
    expect(PARAMETROS_MANUTENCAO).toHaveLength(13);
    for (const p of PARAMETROS_MANUTENCAO) {
      expect(PARAMETROS_NOVOS).toContain(p);
      expect(p.chave).toMatch(/^manutencao\.[a-z][a-zA-Z]+$/);
      if (p.tipo !== 'inteiro') continue;
      expect(Number(p.padrao)).toBeGreaterThanOrEqual(p.minimo ?? 0);
      expect(Number(p.padrao)).toBeLessThanOrEqual(p.maximo ?? Infinity);
    }
    // W0-08 (M2): a importação dos alertas da Anvisa nasce desligada (não há credencial; só entrada manual).
    expect(definicaoParametro('manutencao.vidaUtilPadraoMeses')).toMatchObject({
      tipo: 'inteiro',
      padrao: '120',
    });
    expect(definicaoParametro('manutencao.alertasAnvisaImportacao')).toMatchObject({
      tipo: 'booleano',
      padrao: 'nao',
    });
  });

  it('a funcionalidade "manutencao" nasce desligada, com o pré-requisito da validação', () => {
    const r = RECURSOS_DESLIGADOS.find((x) => x.chave === CHAVE_LIBERACAO_MANUTENCAO);
    expect(r?.marco).toBe('M55');
    expect(r?.prerequisitos.map((x) => x.tipo)).toEqual(['aprovacao']);
    expect(r?.descricao).not.toMatch(/spdata|legado/i);
  });

  it('vocabulário: só a agenda de consultas tem operação de bloqueio; esperas são abertas; laudo na calibração', () => {
    expect(OPERACAO_BLOQUEIO_DO_RECURSO).toEqual({
      agendaConsulta: 'agenda.bloquearHorarios',
      agendaExame: null,
      salaCirurgica: null,
    });
    for (const s of SITUACOES_OS_ESPERA) expect(SITUACOES_OS_ABERTAS).toContain(s);
    expect(ATIVIDADES_COM_LAUDO).toEqual(['calibracao', 'segurancaEletrica']);
    expect(NATUREZAS_ABERTURA).toEqual(['corretiva', 'predial']);
    expect(TETO_LISTA_OS).toBe(200);
  });
});

describe('equipamento', () => {
  it('cadastra com os padrões e normaliza o código do QR', () => {
    const v = esquemaCadastrarEquipamento.parse(equipamento);
    expect(v.codigo).toBe('EQ-0001');
    expect(v.situacao).toBe('ativo');
    expect(v.recurso).toBeNull();
    expect(v.bemPatrimonial).toBeNull();
    expect(esquemaCodigoEquipamento.safeParse('EQ 01').success).toBe(false);
    expect(esquemaCodigoEquipamento.safeParse('-EQ').success).toBe(false);
  });

  it('classe de risco só no médico; garantia não antes da instalação; Anvisa com 11 dígitos', () => {
    expect(esquemaCadastrarEquipamento.safeParse({ ...equipamento, tipo: 'predial' }).success).toBe(false);
    expect(
      esquemaCadastrarEquipamento.safeParse({
        ...equipamento,
        instalacao: '2026-05-01',
        garantiaAte: '2026-04-30',
      }).success,
    ).toBe(false);
    expect(esquemaCadastrarEquipamento.safeParse({ ...equipamento, registroAnvisa: '123' }).success).toBe(
      false,
    );
    expect(
      esquemaCadastrarEquipamento.safeParse({
        ...equipamento,
        registroAnvisa: '80000000001',
        recurso: { tipo: 'agendaExame', id: 3 },
      }).success,
    ).toBe(true);
    expect(esquemaCadastrarEquipamento.safeParse({ ...equipamento, extra: 1 }).success).toBe(false);
  });

  it('alterar pede a versão e, para desativar, o motivo', () => {
    const base = { ...equipamento, id: 7, versao: 2 };
    expect(esquemaAlterarEquipamento.safeParse(base).success).toBe(true);
    expect(esquemaAlterarEquipamento.safeParse({ ...base, situacao: 'desativado' }).success).toBe(false);
    expect(
      esquemaAlterarEquipamento.safeParse({
        ...base,
        situacao: 'desativado',
        motivo: 'Substituído por outro.',
      }).success,
    ).toBe(true);
    expect(esquemaAlterarEquipamento.safeParse({ ...base, tipo: 'apoio' }).success).toBe(false);
  });
});

describe('ordem de serviço', () => {
  const abrir = { natureza: 'corretiva', centroCusto: 10, descricao: 'Não liga depois da queda de energia.' };

  it('corretiva pede o equipamento (pela lista ou pelo QR, não pelos dois)', () => {
    expect(esquemaAbrirOs.safeParse(abrir).success).toBe(false);
    const v = esquemaAbrirOs.parse({ ...abrir, codigoEquipamento: 'eq-0001', equipamentoParado: true });
    expect(v.codigoEquipamento).toBe('EQ-0001');
    expect(v.prioridadeSugerida).toBe('media');
    expect(esquemaAbrirOs.safeParse({ ...abrir, equipamento: 1, codigoEquipamento: 'EQ-1' }).success).toBe(
      false,
    );
  });

  it('predial pede o local ou o equipamento; parado só com equipamento; preventiva não se abre por aqui', () => {
    expect(esquemaAbrirOs.safeParse({ ...abrir, natureza: 'predial' }).success).toBe(false);
    expect(
      esquemaAbrirOs.safeParse({ ...abrir, natureza: 'predial', local: 'Corredor do 2º andar' }).success,
    ).toBe(true);
    expect(
      esquemaAbrirOs.safeParse({ ...abrir, natureza: 'predial', local: 'Sala 3', equipamentoParado: true })
        .success,
    ).toBe(false);
    expect(esquemaAbrirOs.safeParse({ ...abrir, natureza: 'preventiva', equipamento: 1 }).success).toBe(
      false,
    );
    expect(esquemaAbrirOs.safeParse({ ...abrir, equipamento: 1, descricao: 'curto' }).success).toBe(false);
  });

  it('assumir pela empresa contratada pede a cobertura; andamento só nas situações de trabalho', () => {
    expect(esquemaAssumirOs.safeParse({ os: 1, versao: 0, prioridade: 'alta' }).success).toBe(true);
    expect(
      esquemaAssumirOs.safeParse({ os: 1, versao: 0, prioridade: 'alta', executor: 'contrato' }).success,
    ).toBe(false);
    expect(
      esquemaAndamentoOs.safeParse({ os: 1, versao: 1, situacao: 'aguardandoPeca', nota: 'Pedido da placa' })
        .success,
    ).toBe(true);
    expect(esquemaAndamentoOs.safeParse({ os: 1, versao: 1, situacao: 'encerrada', nota: 'x' }).success).toBe(
      false,
    );
  });

  it('concluir confere a ordem dos instantes e soma nada sozinho (custos com padrão 0)', () => {
    const c = {
      os: 1,
      versao: 3,
      causa: 'desgaste',
      solucao: 'Troca da fonte de alimentação.',
      inicioReparo: '2026-10-20T08:00',
      fimReparo: '2026-10-20T10:30',
    };
    const v = esquemaConcluirOs.parse(c);
    expect([v.custoPecas, v.custoMaoDeObra, v.custoTerceiros]).toEqual([0, 0, 0]);
    expect(esquemaConcluirOs.safeParse({ ...c, fimReparo: '2026-10-20T07:59' }).success).toBe(false);
    expect(esquemaConcluirOs.safeParse({ ...c, voltaAoUso: '2026-10-19T23:00' }).success).toBe(false);
    expect(esquemaConcluirOs.safeParse({ ...c, inicioReparo: '2026-10-20 08:00' }).success).toBe(false);
  });

  it('recusar o aceite pede a explicação; cancelar pede o motivo', () => {
    expect(esquemaEncerrarOs.safeParse({ os: 1, versao: 4, aceite: true }).success).toBe(true);
    expect(esquemaEncerrarOs.safeParse({ os: 1, versao: 4, aceite: false }).success).toBe(false);
    expect(
      esquemaEncerrarOs.safeParse({ os: 1, versao: 4, aceite: false, nota: 'Continua desligando sozinho.' })
        .success,
    ).toBe(true);
    expect(esquemaCancelarOs.safeParse({ os: 1, versao: 0, motivo: 'curto' }).success).toBe(false);
  });
});

describe('plano, execução e cobertura', () => {
  it('periodicidade em dias até 730; executor contratado pede a cobertura', () => {
    expect(esquemaPeriodicidade.safeParse({ quantidade: 731, unidade: 'dias' }).success).toBe(false);
    expect(esquemaPeriodicidade.safeParse({ quantidade: 12, unidade: 'meses' }).success).toBe(true);
    const plano = {
      equipamento: 1,
      atividade: 'calibracao',
      periodicidade: { quantidade: 12, unidade: 'meses' },
      dataBase: '2026-01-15',
    };
    expect(esquemaPlanejarManutencao.parse(plano).executor).toBe('interno');
    expect(esquemaPlanejarManutencao.safeParse({ ...plano, executor: 'contrato' }).success).toBe(false);
  });

  it('resultado diferente de aprovado pede a observação', () => {
    const e = { plano: 1, versao: 0, data: '2026-10-20', resultado: 'reprovado' };
    expect(esquemaRegistrarExecucao.safeParse(e).success).toBe(false);
    expect(
      esquemaRegistrarExecucao.safeParse({ ...e, observacao: 'Fuga de corrente acima do limite.' }).success,
    ).toBe(true);
    expect(esquemaRegistrarExecucao.safeParse({ ...e, resultado: 'aprovado' }).success).toBe(true);
  });

  it('cobertura: vigência em ordem e equipamentos sem repetição', () => {
    const c = {
      fornecedor: 9,
      numero: 'CT-12/2026',
      cobertura: 'integral',
      inicio: '2026-01-01',
      fim: '2026-12-31',
      equipamentos: [1, 2],
    };
    expect(esquemaCoberturaContrato.safeParse(c).success).toBe(true);
    expect(esquemaCoberturaContrato.safeParse({ ...c, fim: '2025-12-31' }).success).toBe(false);
    expect(esquemaCoberturaContrato.safeParse({ ...c, equipamentos: [1, 1] }).success).toBe(false);
    expect(esquemaCoberturaContrato.safeParse({ ...c, equipamentos: [] }).success).toBe(false);
  });

  it('W0-08: alterar o contrato pede a versão e o motivo; fornecedor e número não se alteram; encerrar e excluir com motivo', () => {
    const a = {
      id: 7,
      versao: 1,
      inicio: '2026-01-01',
      fim: '2027-06-30',
      equipamentos: [1, 2],
      slaHoras: 4,
      valorMensal: 1200.5,
      motivo: 'Aditivo de prazo assinado',
    };
    expect(esquemaAlterarContratoManutencao.safeParse(a).success).toBe(true);
    expect(esquemaAlterarContratoManutencao.safeParse({ ...a, motivo: 'curto' }).success).toBe(false);
    expect(esquemaAlterarContratoManutencao.safeParse({ ...a, fim: '2025-01-01' }).success).toBe(false);
    expect(esquemaAlterarContratoManutencao.safeParse({ ...a, equipamentos: [2, 2] }).success).toBe(false);
    expect(esquemaAlterarContratoManutencao.safeParse({ ...a, numero: 'X' }).success).toBe(false);
    expect(esquemaAlterarContratoManutencao.safeParse({ ...a, fornecedor: 3 }).success).toBe(false);
    const e = { id: 7, versao: 2, data: '2026-11-18', motivo: 'Fornecedor deixou de atender' };
    expect(esquemaEncerrarContratoManutencao.safeParse(e).success).toBe(true);
    expect(esquemaEncerrarContratoManutencao.safeParse({ ...e, motivo: undefined }).success).toBe(false);
    expect(
      esquemaExcluirContratoManutencao.safeParse({ id: 7, versao: 1, motivo: 'Registrado por engano' })
        .success,
    ).toBe(true);
    expect(esquemaExcluirContratoManutencao.safeParse({ id: 7, versao: 1 }).success).toBe(false);
  });
});

describe('filtros e período', () => {
  it('lista de OS e de equipamentos com teto de 200', () => {
    expect(esquemaFiltroOs.parse({}).limite).toBe(50);
    expect(esquemaFiltroOs.safeParse({ limite: 201 }).success).toBe(false);
    expect(esquemaFiltroOs.safeParse({ situacoes: ['aberta', 'emAtendimento'] }).success).toBe(true);
    expect(esquemaFiltroEquipamentos.safeParse({ limite: 200, criticidade: 'critica' }).success).toBe(true);
  });

  it('indicadores até 366 dias, fim depois do início', () => {
    expect(esquemaPeriodoIndicadores.safeParse({ inicio: '2026-01-01', fim: '2026-12-31' }).success).toBe(
      true,
    );
    expect(esquemaPeriodoIndicadores.safeParse({ inicio: '2026-01-01', fim: '2027-01-03' }).success).toBe(
      false,
    );
    expect(esquemaPeriodoIndicadores.safeParse({ inicio: '2026-02-01', fim: '2026-01-31' }).success).toBe(
      false,
    );
  });
});
