// Textos da tela de preferências do faturista e dos parâmetros vigentes do faturamento (F3.7, 06-FAT linha 38). As
// recusas vêm do texto que o servidor (e o domínio, na hora) devolve.
export const mensagensParametrosFaturamento = {
  titulo: 'Preferências do faturista',
  explicacao:
    'As suas preferências valem só para a sua conta. Os parâmetros do estabelecimento são mantidos em Administração > Parâmetros por módulo.',
  preferencias: 'As minhas preferências',
  telaInicial: 'Tela inicial do faturamento',
  telas: {
    contas: 'Contas do paciente',
    worklist: 'Fila de trabalho do faturamento',
    guias: 'Guias de convênio',
    auditoria: 'Auditoria de itens',
    glosas: 'Glosas',
  },
  itensPorPagina: 'Itens por página nas listas ({min} a {max})',
  agruparPorPaciente: 'Agrupar as listas por paciente',
  gravar: 'Gravar as preferências',
  gravado: 'Preferências gravadas.',
  semMudanca: 'Nada mudou desde a última gravação.',
  vigentes: 'Parâmetros vigentes no estabelecimento',
  rotinaDiaria: 'Rotina diária do faturamento',
  ligada: 'ligada a partir das {hora}h',
  desligada: 'desligada',
  prazoRecurso: 'Prazo do recurso de glosa',
  dias: '{n} dia(s) após o recebimento do demonstrativo',
  fechamento: 'Fechamento da competência',
  diaLimite: 'até o dia {n} do mês seguinte',
};
