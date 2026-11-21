// Triagem dos relatórios de SQL livre (M34; ficha, regra 2; cap-07 §7.5.1): todo relatório do editor de relatórios
// de origem (252 no pc) recebe um destino — tela ou fila de um marco, relatório do catálogo, indicador, painel ou
// descartado —, o papel dono, o artefato e a onda. A PROPOSTA sai destas regras versionadas, em ordem (a primeira que
// casa decide), pelo nome e pelo módulo do relatório (o texto da consulta nunca é lido); a área confirma ou muda na
// tela de triagem. Os de folha, eSocial e REINF vão para o M53 (DP-10: folha e eSocial construídos). Regras puras.
import type { DestinoTriagem } from '@sgh/contratos';

export interface RelatorioOrigem {
  readonly id: number;
  readonly nome: string;
  /** Módulo do editor de origem (código do módulo na origem: -1 abertura, 4 faturamento de convênios, 22 folha…). */
  readonly modulo: number;
  /** Tipo do relatório no editor (2 relatório, 3 etiqueta). */
  readonly tipo: number;
}

export interface PropostaTriagem {
  readonly destino: DestinoTriagem;
  readonly marco: string | null;
  readonly artefato: string;
  readonly papelDono: string;
  readonly onda: number | null;
  readonly regra: string;
  readonly motivo: string;
}

interface Regra {
  readonly regra: string;
  readonly casa: (r: RelatorioOrigem, nome: string) => boolean;
  readonly proposta: Omit<PropostaTriagem, 'regra'>;
}

/** Nome comparável: sem acento, maiúsculo, espaços simples (o "ñ" do editor vira N). */
export function nomeDaTriagem(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

const tem =
  (...padroes: RegExp[]) =>
  (_r: RelatorioOrigem, n: string) =>
    padroes.some((p) => p.test(n));

/** Papel dono de cada área (o chave-usuário que confere; nunca um nome). */
export const PAPEIS_TRIAGEM = {
  folha: 'departamento pessoal',
  faturamento: 'gerente de faturamento',
  financeiro: 'gerente financeiro',
  contabilidade: 'contabilidade',
  repasse: 'coordenação de repasse médico',
  estoque: 'coordenação de suprimentos',
  pep: 'coordenação médica do prontuário',
  leitos: 'coordenação de leitos',
  recepcao: 'coordenação da recepção',
  sadt: 'coordenação do diagnóstico',
  bloco: 'coordenação do centro cirúrgico',
  diretoria: 'diretoria',
  cadastros: 'curador dos cadastros (TI)',
  curador: 'curador do catálogo (TI)',
} as const;

const P = PAPEIS_TRIAGEM;

/** Regras em ordem: a primeira que casa decide. A última (por módulo) garante destino e dono a todos. */
export const REGRAS_TRIAGEM: readonly Regra[] = [
  {
    regra: 'descartar-teste-ou-modelo',
    casa: tem(/^RELATORIO MODELO/, /\bTESTE\b/, /^FC_GEAP/),
    proposta: {
      destino: 'descartado',
      marco: null,
      artefato: 'nenhum (relatório de teste ou modelo do editor)',
      papelDono: P.curador,
      onda: null,
      motivo: 'Relatório de teste ou modelo de layout, sem uso de área.',
    },
  },
  {
    regra: 'folha-esocial-reinf',
    casa: (r, n) =>
      r.modulo === 22 ||
      /^FP \|/.test(n) ||
      /^(?:FP \| )?[SR]-\d{4}\b/.test(n) ||
      /\b(?:ESOCIAL|REINF|FGTS|INSS|IRRF|CARGA INICIAL)\b/.test(n),
    proposta: {
      destino: 'tela',
      marco: 'M53',
      artefato: 'Folha de pagamento e eSocial: conferência dos eventos enviados',
      papelDono: P.folha,
      onda: null,
      motivo: 'Conferência de eSocial e REINF (DP-10: folha e eSocial construídos no M53).',
    },
  },
  {
    regra: 'glosas',
    casa: tem(/GLOSA/),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'glosasPorConvenio',
      papelDono: P.faturamento,
      onda: 4,
      motivo: 'Glosa sobre os itens baixados, por convênio, nas duas réguas.',
    },
  },
  {
    regra: 'repasse',
    casa: tem(/REPASSE/, /FATURAMENTO DIRETO AOS MEDICOS/),
    proposta: {
      destino: 'tela',
      marco: 'M33',
      artefato: 'Repasse médico: apuração e conferência',
      papelDono: P.repasse,
      onda: 4,
      motivo: 'Apuração do repasse médico e de terceiros (tela do M33).',
    },
  },
  {
    regra: 'contas-nao-emitidas',
    casa: tem(
      /CONTAS? (?:N|NAO|Ñ) EMITID/,
      /N[AÃ]O EMITIDAS/,
      /NAO FECHADAS/,
      /SITUACAO CONTAS/,
      /CONTROLE DE CONTAS/,
      /NAO FATURADAS/,
      /CONTAS EMIT\. E N RECEB/,
      /CONTAS EMIT\. COM DESC/,
    ),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'contasNaoFechadas',
      papelDono: P.faturamento,
      onda: 4,
      motivo: 'Contas não emitidas ou não fechadas por tipo e convênio.',
    },
  },
  {
    regra: 'itens-nao-conferidos',
    casa: tem(/ITENS NAO CONFERIDOS/, /LOCAIS DE CONSUMOS DIVERG/, /ORCAMENTO PACIENTES/),
    proposta: {
      destino: 'fila',
      marco: 'M30',
      artefato: 'Conta do paciente: auditoria de contas (pendências)',
      papelDono: P.faturamento,
      onda: 4,
      motivo: 'Pendência de conta (conferência de itens, local de consumo, orçamento): fila do M30.',
    },
  },
  {
    regra: 'faturamento-convenio',
    casa: tem(
      /FATURAMENTO MENSAL/,
      /MAPA DE APURACAO/,
      /RESUMO DIARIO/,
      /CONTAS FATURADAS/,
      /FATURAMENTO DE CONVENIOS POR TIPO/,
      /VALORES DE COBRANCA/,
      /VALORES GERAL/,
    ),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'faturamentoPorConvenio',
      papelDono: P.faturamento,
      onda: 0,
      motivo: 'Cobrado e pago por convênio no período, nas duas réguas.',
    },
  },
  {
    regra: 'tiss-protocolo',
    casa: tem(/INTEGRACAO DOS CONVENIOS/, /PROTOCOLO DE ENTREGA/),
    proposta: {
      destino: 'tela',
      marco: 'M31',
      artefato: 'TISS: lotes, protocolos e demonstrativos',
      papelDono: P.faturamento,
      onda: 4,
      motivo: 'Envio e protocolo das contas ao convênio (tela do M31).',
    },
  },
  {
    regra: 'financeiro',
    casa: (r, n) =>
      /^CF \|/.test(n) ||
      /CONTAS (?:A|À) (?:PAGAR|RECEBER)|CONTAS PAGAS|BORDERO|SALDO BANCARIO|FLUXO DE CAIXA|LANCAMENTOS BANCARIOS|FATURAS PAGOS|RECIBO|CREDITOS NAO IDENTIFICADOS|CONTAS BANCARIAS|INTEGRACAO FAT X FIN/.test(
        n,
      ) ||
      r.modulo === 14,
    proposta: {
      destino: 'tela',
      marco: 'M32',
      artefato: 'Financeiro: contas a pagar e a receber, caixa e bancos',
      papelDono: P.financeiro,
      onda: 4,
      motivo: 'Relatório financeiro (tela do M32).',
    },
  },
  {
    regra: 'contabilidade',
    casa: (r, n) => r.modulo === 15 || /ADIANTAMENTOS NAO COMPENSADOS/.test(n),
    proposta: {
      destino: 'tela',
      marco: 'M54',
      artefato: 'Controladoria: contabilidade',
      papelDono: P.contabilidade,
      onda: null,
      motivo: 'Contabilidade (Fase 6, M54).',
    },
  },
  {
    regra: 'mapa-cirurgico',
    casa: tem(/MAPA CIRURGICO/),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'mapaCirurgicoDia',
      papelDono: P.bloco,
      onda: 2,
      motivo: 'Mapa cirúrgico do dia por sala.',
    },
  },
  {
    regra: 'cirurgias-periodo',
    casa: tem(/CIRURGIAS POR PERIODO/),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'cirurgiasPorPeriodo',
      papelDono: P.diretoria,
      onda: 0,
      motivo: 'Cirurgias por dia e tipo (gerencial da diretoria).',
    },
  },
  {
    regra: 'censo-internados',
    casa: tem(/CENSO DIARIO DE PACIENTES INTERNADOS/),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'internadosNaData',
      papelDono: P.leitos,
      onda: 2,
      motivo: 'Pacientes internados no fim do dia, por unidade.',
    },
  },
  {
    regra: 'censo-hospitalar',
    casa: tem(/CENSO HOSPITALAR/),
    proposta: {
      destino: 'indicador',
      marco: 'M16',
      artefato: '/relatorios/indicadores (censo e ocupação)',
      papelDono: P.leitos,
      onda: 0,
      motivo: 'O censo hospitalar é o indicador e o censo diário do M16.',
    },
  },
  {
    regra: 'leitos',
    casa: tem(/LEITOS DE (?:INTERNACAO|PRONTO SOCORRO)/, /TEMPO DE INTERNACAO PA/),
    proposta: {
      destino: 'painel',
      marco: 'M16',
      artefato: '/internacao/leitos (painel de leitos ao vivo)',
      papelDono: P.leitos,
      onda: 0,
      motivo: 'Ocupação dos leitos ao vivo (painel do M16).',
    },
  },
  {
    regra: 'rastreabilidade-prontuario',
    casa: tem(/RASTREABILIDADE DE PRONTUARIOS/),
    proposta: {
      destino: 'tela',
      marco: 'M21',
      artefato: 'SAME: rastreio do prontuário físico',
      papelDono: P.leitos,
      onda: 2,
      motivo: 'Rastreio do prontuário físico (SAME, M21).',
    },
  },
  {
    regra: 'pulseira-etiqueta',
    casa: (r, n) => r.tipo === 3 || /PULSEIRA|ETIQUETAS? DE (?:IDENTIFICACAO|PRATELEIRA)/.test(n),
    proposta: {
      destino: 'tela',
      marco: 'M20',
      artefato: 'Impressão de pulseira e etiqueta (agente local de impressão)',
      papelDono: P.recepcao,
      onda: 1,
      motivo: 'Pulseira e etiqueta saem da tela do atendimento (ZPL pelo agente local).',
    },
  },
  {
    regra: 'agendas',
    casa: tem(/AGENDAS CRIADAS/),
    proposta: {
      destino: 'tela',
      marco: 'M17',
      artefato: '/agenda/consultas/agendas (agendas e escalas)',
      papelDono: P.recepcao,
      onda: 1,
      motivo: 'Agendas criadas: tela de agendas do M17 e do M18.',
    },
  },
  {
    regra: 'exames-sadt',
    casa: tem(/SERVICOS DE IMAGEM/, /CONFERENCIA SADT IMAGENS/),
    proposta: {
      destino: 'catalogo',
      marco: 'M34',
      artefato: 'examesPorSetor',
      papelDono: P.sadt,
      onda: 2,
      motivo: 'Exames do diagnóstico por setor no período.',
    },
  },
  {
    regra: 'cadastro-exames',
    casa: tem(/CADASTRO DE EXAMES/, /CONFERENCIA DE REFERENCIA/),
    proposta: {
      destino: 'tela',
      marco: 'M14',
      artefato: '/cadastros/exames (catálogo de exames e referências)',
      papelDono: P.sadt,
      onda: 1,
      motivo: 'Conferência do cadastro de exames e das referências (tela do catálogo de exames).',
    },
  },
  {
    regra: 'kits-pep',
    casa: tem(/KITS DE (?:MEDICAMENTO|SOLUCAO)/, /CONFERENCIA DE ITENS PARA PEP/),
    proposta: {
      destino: 'tela',
      marco: 'M24',
      artefato: '/cadastros/prescricao/kits (kits de medicamentos e de soluções)',
      papelDono: P.pep,
      onda: 2,
      motivo: 'Conferência dos kits e itens da prescrição (cadastros do M24).',
    },
  },
  {
    regra: 'template-pep',
    casa: tem(/TEMPLATE/),
    proposta: {
      destino: 'tela',
      marco: 'M22',
      artefato: '/pep/admin/modelos (modelos de formulário)',
      papelDono: P.pep,
      onda: 2,
      motivo: 'Validação dos modelos de formulário (M22).',
    },
  },
  {
    regra: 'solicitacao-exames-pep',
    casa: tem(/SOLICITACAO DE EXAMES/),
    proposta: {
      destino: 'tela',
      marco: 'M23',
      artefato: 'Prontuário: pedidos de exame',
      papelDono: P.pep,
      onda: 2,
      motivo: 'Pedido de exame impresso pelo prontuário (M23).',
    },
  },
  {
    regra: 'estoque',
    casa: (r, n) => r.modulo === 1 || /^GE \|/.test(n),
    proposta: {
      destino: 'tela',
      marco: 'M28',
      artefato: 'Estoque: inventário, contagem, consumo e fornecedores',
      papelDono: P.estoque,
      onda: 3,
      motivo: 'Relatório de estoque e compras (telas do M28).',
    },
  },
  {
    regra: 'tabelas-precos',
    casa: tem(
      /DIARIAS E TAXAS/,
      /COMPARATIVO ENTRE TABELAS/,
      /REFERENCIA (?:BRASINDICE|TABELA)/,
      /FICHA DO CONVENIO/,
    ),
    proposta: {
      destino: 'tela',
      marco: 'M12',
      artefato: '/cadastros/convenios (convênios, contratos e tabelas)',
      papelDono: P.faturamento,
      onda: 1,
      motivo: 'Conferência de tabelas de preço e do convênio (telas do M12).',
    },
  },
  {
    regra: 'medicos',
    casa: tem(/RELA[CÇ][AÃ]O DE MEDICOS/, /MEDICOS INCLUIDOS/),
    proposta: {
      destino: 'tela',
      marco: 'M11',
      artefato: '/cadastros/profissionais (profissionais)',
      papelDono: P.cadastros,
      onda: 1,
      motivo: 'Lista de profissionais (cadastro do M11).',
    },
  },
  {
    regra: 'usuarios-painel',
    casa: tem(/USUARIO POR PAINEL/),
    proposta: {
      destino: 'tela',
      marco: 'M10',
      artefato: '/administracao/acesso/usuarios (usuários e acessos)',
      papelDono: P.cadastros,
      onda: 1,
      motivo: 'Acesso de usuários por painel (telas de acesso do M10).',
    },
  },
];

/** O destino padrão de cada módulo do editor (a última regra: todo relatório sai com destino e dono). */
const POR_MODULO: Readonly<Record<number, Omit<PropostaTriagem, 'regra' | 'motivo'>>> = {
  0: {
    destino: 'tela',
    marco: 'M18',
    artefato: 'Centro cirúrgico: mapa e registro',
    papelDono: P.bloco,
    onda: 2,
  },
  1: { destino: 'tela', marco: 'M28', artefato: 'Estoque e compras', papelDono: P.estoque, onda: 3 },
  4: { destino: 'tela', marco: 'M30', artefato: 'Conta do paciente', papelDono: P.faturamento, onda: 4 },
  7: { destino: 'tela', marco: 'M21', artefato: 'Internação e leitos', papelDono: P.leitos, onda: 2 },
  8: {
    destino: 'tela',
    marco: 'M20',
    artefato: 'Atendimento ambulatorial e PA',
    papelDono: P.recepcao,
    onda: 1,
  },
  9: { destino: 'tela', marco: 'M26', artefato: 'Diagnóstico (SADT)', papelDono: P.sadt, onda: 2 },
  10: { destino: 'tela', marco: 'M14', artefato: 'Cadastros e tabelas', papelDono: P.cadastros, onda: 1 },
  14: { destino: 'tela', marco: 'M32', artefato: 'Financeiro', papelDono: P.financeiro, onda: 4 },
  15: { destino: 'tela', marco: 'M54', artefato: 'Contabilidade', papelDono: P.contabilidade, onda: null },
  22: { destino: 'tela', marco: 'M53', artefato: 'Folha e eSocial', papelDono: P.folha, onda: null },
  23: { destino: 'tela', marco: 'M23', artefato: 'Prontuário eletrônico', papelDono: P.pep, onda: 2 },
  27: { destino: 'tela', marco: 'M33', artefato: 'Repasse médico', papelDono: P.repasse, onda: 4 },
};

/** A proposta para um relatório: a primeira regra que casa ou, sem nenhuma, o destino padrão do módulo. */
export function proporTriagem(r: RelatorioOrigem): PropostaTriagem {
  const n = nomeDaTriagem(r.nome);
  for (const x of REGRAS_TRIAGEM) if (x.casa(r, n)) return { ...x.proposta, regra: x.regra };
  const m = POR_MODULO[r.modulo];
  if (m) return { ...m, regra: `modulo-${r.modulo}`, motivo: 'Destino padrão do módulo do relatório.' };
  return {
    destino: 'tela',
    marco: 'M35',
    artefato: 'A decidir com a área na prontidão por setor',
    papelDono: P.curador,
    onda: null,
    regra: 'sem-regra',
    motivo: 'Nenhuma regra nem módulo conhecido: o curador decide com a área.',
  };
}

export interface ResumoDaTriagem {
  readonly total: number;
  readonly semDestino: number;
  readonly semDono: number;
  readonly porDestino: Readonly<Record<string, number>>;
  readonly porMarco: Readonly<Record<string, number>>;
  readonly porRegra: Readonly<Record<string, number>>;
}

/** Resumo do critério de aceite (`pnpm relatorios:triagem`: N relatórios com destino, 0 sem dono). */
export function resumirTriagem(
  propostas: readonly Pick<PropostaTriagem, 'destino' | 'marco' | 'papelDono' | 'regra'>[],
): ResumoDaTriagem {
  const conta = (f: (p: (typeof propostas)[number]) => string) =>
    propostas.reduce<Record<string, number>>((a, p) => ({ ...a, [f(p)]: (a[f(p)] ?? 0) + 1 }), {});
  return {
    total: propostas.length,
    semDestino: propostas.filter((p) => !p.destino).length,
    semDono: propostas.filter((p) => !p.papelDono.trim()).length,
    porDestino: conta((p) => p.destino),
    porMarco: conta((p) => p.marco ?? 'nenhum'),
    porRegra: conta((p) => p.regra),
  };
}
