// Textos do lote de trabalho da bancada no mapa de trabalho (F3.5, 05-SADT linha 8). As recusas vêm da regra do
// domínio pela API; aqui ficam os rótulos.
export const mensagensLoteTrabalho = {
  titulo: 'Lotes de trabalho',
  abrir: 'Abrir lote de trabalho',
  abrirDica:
    'Leva os exames em análise que estão fora de lote, os urgentes primeiro, até o limite da bancada.',
  nenhum: 'Nenhum lote aberto hoje nesta bancada.',
  indisponivel: 'Os lotes de trabalho não estão disponíveis nesta fonte de dados.',
  resumo: 'Lote {numero} · {situacao} · {n} exame(s)',
  analista: 'Analista: {nome}',
  semAnalista: 'Sem analista',
  impressoEm: 'Impresso em {quando}',
  fechadoEm: 'Fechado em {quando}',
  posicao: 'Posição',
  exame: 'Exame',
  paciente: 'Paciente',
  amostra: 'Amostra',
  situacaoItem: 'Situação',
  fechar: 'Fechar o lote',
  imprimir: 'Imprimir',
  abertoOk: 'Lote {numero} aberto com {n} exame(s).',
  fechadoOk: 'Lote {numero} fechado: {processados} processado(s), {pendentes} de volta à fila.',
  situacao: {
    aberto: 'aberto',
    em_processamento: 'em processamento',
    fechado: 'fechado',
    cancelado: 'cancelado',
  },
  item: {
    pendente: 'A processar',
    processado: 'Processado',
    retido: 'Retido',
    repetir: 'Repetir',
    cancelado: 'Cancelado',
  },
};
