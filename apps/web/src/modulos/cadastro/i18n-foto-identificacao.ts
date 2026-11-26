// Textos da foto do paciente para a identificação positiva (F3.1, 02-CAD linha 5), na chave `fotoIdentificacao`.
export const mensagensFotoIdentificacao = {
  titulo: 'Foto e identificação do paciente',
  voltar: 'Voltar à ficha',
  baseLegal:
    'Base legal: LGPD art. 11, II, f (tutela da saúde) e g (segurança do paciente na identificação). A foto faz parte do prontuário e fica guardada por 20 anos.',
  semFoto: 'O paciente não tem foto cadastrada.',
  fotoAtiva: 'Foto atual',
  previa: 'Foto do paciente',
  capturadaEm: 'Captada em {data}; guardada até {guarda}.',
  captura: {
    titulo: 'Captar a foto do paciente',
    ajuda:
      'Use a câmera da recepção ou um arquivo de imagem. A nova foto substitui a atual, que fica no histórico.',
    gravar: 'Gravar a foto',
    gravada: 'Foto gravada.',
  },
  revogar: {
    titulo: 'Revogar a foto atual',
    motivo: 'Motivo da revogação',
    confirmar: 'Revogar a foto',
    revogada: 'Foto revogada.',
  },
  conferir: {
    titulo: 'Conferir a identidade',
    ajuda:
      'Compare a pessoa com a foto. Sem foto ou sem condição de comparar, registre a dispensa e confira o documento.',
    resultado: 'Resultado',
    contexto: 'Onde foi conferida',
    motivo: 'Motivo da dispensa',
    gravar: 'Registrar a conferência',
    gravada: 'Conferência registrada.',
  },
  resultados: {
    confirmada: 'Identidade confirmada pela foto',
    nao_confirmada: 'Não confere com a foto',
    dispensada: 'Dispensada (conferida pelo documento)',
  },
  contextos: {
    recepcao: 'Recepção',
    guia: 'Guia do convênio',
    leito: 'Leito',
    dispensacao: 'Dispensação',
    procedimento: 'Procedimento',
    outro: 'Outro',
  },
  situacoes: { ativa: 'Atual', substituida: 'Substituída', revogada: 'Revogada' },
  historico: 'Fotos anteriores',
  conferencias: 'Últimas conferências',
  colunas: {
    quando: 'Quando',
    onde: 'Onde',
    resultado: 'Resultado',
    quem: 'Quem conferiu',
    situacao: 'Situação',
  },
  semConferencias: 'Nenhuma conferência registrada.',
  link: 'Foto e identificação',
};
