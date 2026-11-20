// Parâmetros da manutenção e engenharia clínica, fatia F1 (M55; ficha, regras 1 e 2). Os SLA por prioridade são o padrão
// de mercado da engenharia clínica (POL-1): a chefia da manutenção troca o valor por estabelecimento sem mudar código.
import {
  CODIGOS_PRIORIDADE_OS,
  PRIORIDADES_OS,
  SLA_PADRAO,
  type PrioridadeOs,
} from '../manutencao/vocabulario.js';
import type { DefinicaoParametro } from './definicoes.js';

const maiuscula = (p: PrioridadeOs): string => p.charAt(0).toUpperCase() + p.slice(1);

/** Chave do parâmetro do SLA (`manutencao.slaEmergenciaAtendimentoHoras`, `manutencao.slaAltaSolucaoHoras`...). */
export function chaveParametroSla(prioridade: PrioridadeOs, etapa: 'atendimento' | 'solucao'): string {
  return `manutencao.sla${maiuscula(prioridade)}${etapa === 'atendimento' ? 'Atendimento' : 'Solucao'}Horas`;
}

const sla = (prioridade: PrioridadeOs, etapa: 'atendimento' | 'solucao'): DefinicaoParametro => ({
  chave: chaveParametroSla(prioridade, etapa),
  modulo: 'manutencao',
  descricao: `Prazo de ${etapa === 'atendimento' ? 'atendimento' : 'solução'} da OS de prioridade "${PRIORIDADES_OS[prioridade]}", em horas, contado do registro`,
  tipo: 'inteiro',
  padrao: String(
    etapa === 'atendimento' ? SLA_PADRAO[prioridade].atendimentoHoras : SLA_PADRAO[prioridade].solucaoHoras,
  ),
  niveis: ['estabelecimento', 'rede'],
  critico: false,
  minimo: 1,
  maximo: 720,
  dono: 'manutenção e engenharia clínica',
  origem: 'ficha do M55, regra 1 (OS com prioridade e SLA); padrão de mercado da engenharia clínica (POL-1)',
});

export const PARAMETROS_MANUTENCAO: readonly DefinicaoParametro[] = [
  ...CODIGOS_PRIORIDADE_OS.flatMap((p) => [sla(p, 'atendimento'), sla(p, 'solucao')]),
  {
    chave: 'manutencao.planoAntecedenciaDias',
    modulo: 'manutencao',
    descricao:
      'Antecedência, em dias, com que o item do plano de manutenção aparece como "a vencer" no painel',
    tipo: 'inteiro',
    padrao: '15',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 0,
    maximo: 180,
    dono: 'manutenção e engenharia clínica',
    origem: 'ficha do M55, regra 2 (preventiva vencida aparece no painel; RDC63-07)',
  },
  {
    chave: 'manutencao.aceiteAutomaticoHoras',
    modulo: 'manutencao',
    descricao:
      'Horas depois da conclusão em que a OS sem resposta do solicitante pode ser encerrada pela manutenção',
    tipo: 'inteiro',
    padrao: '72',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 720,
    dono: 'manutenção e engenharia clínica',
    origem:
      'ficha do M55, tela "Abrir e acompanhar OS" (abrir, atender, encerrar); padrão de mercado (POL-1)',
  },
  {
    chave: 'manutencao.alertasAnvisaImportacao',
    modulo: 'manutencao',
    descricao:
      'Importação automática dos alertas de tecnovigilância da Anvisa para o parque. Desligada: os alertas e recalls entram à mão (não há credencial de integração)',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'manutenção e engenharia clínica, com a gerência de risco',
    origem: 'W0-08, mercado M2 (RDC 67/2009 e RDC 551/2021: tecnovigilância e ação de campo do fabricante)',
  },
  {
    chave: 'manutencao.vidaUtilPadraoMeses',
    modulo: 'manutencao',
    descricao:
      'Vida útil, em meses, usada no índice de obsolescência do equipamento sem bem patrimonial ligado (com bem, vale a vida útil do bem)',
    tipo: 'inteiro',
    padrao: '120',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    minimo: 12,
    maximo: 600,
    dono: 'manutenção e engenharia clínica',
    origem:
      'W0-08, mercado M3 (RDC 509/2021: plano de gerenciamento das tecnologias em saúde, obsolescência)',
  },
  {
    chave: 'manutencao.pmocResponsavelTecnico',
    modulo: 'manutencao',
    descricao:
      'Responsável técnico do PMOC que assina o relatório, no formato "Nome; registro profissional (CREA ou CFT); ART". Vazio: o relatório do PMOC é recusado com aviso',
    tipo: 'texto',
    padrao: '',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'manutenção e engenharia clínica (cadastro do dono: o responsável técnico contratado)',
    origem:
      'W0-08, mercado M4 (Lei 13.589/2018 e Portaria GM/MS 3.523/1998: PMOC com responsável técnico habilitado)',
  },
];
