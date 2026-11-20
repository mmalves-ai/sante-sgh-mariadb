// Textos do mercado do W0-03 (escalas novas, profilaxia de TEV, TRR e PCR, feridas e LPP, contenção), na chave
// `enfermagem.mercado`. Nenhum texto cita o sistema anterior nem nome de tabela (ADR 0023).
export const mensagensMercado = {
  tev: {
    perfil: 'Perfil do paciente (escala de TEV)',
    perfis: { clinico: 'Paciente clínico', cirurgico: 'Paciente cirúrgico' },
    perfilAjuda:
      'O estabelecimento define a escala de cada perfil (padrão: Padua no clínico, Caprini no cirúrgico).',
    titulo: 'Profilaxia de TEV pendente',
    texto:
      'Escores de risco de tromboembolismo venoso que sugerem profilaxia. Quem prescreve decide: prescrita, ou não prescrita com o motivo. A ordem em si é feita na prescrição.',
    vazio: 'Nenhuma profilaxia de TEV pendente na unidade.',
    paciente: 'Profilaxia de TEV',
    escore: '{escala} {total} · {faixa} · {quando} · por {por}',
    pendente: 'Pendente ao prescritor',
    decidida: '{decisao} por {por} em {quando}',
    decidir: 'Decidir a profilaxia',
    dialogo: 'Profilaxia de TEV sugerida',
    decisao: 'Decisão',
    decisoes: { prescrita: 'Profilaxia prescrita', 'nao-prescrita': 'Não prescrita (informe o motivo)' },
    motivo: 'Motivo (contraindicação ou outra razão)',
    motivoAjuda: 'De 10 a 300 caracteres; obrigatório quando não prescrita.',
    confirmar: 'Registrar a decisão',
    soPrescritor: 'Só quem prescreve decide a profilaxia.',
    corrigir: 'Corrigir a decisão',
    dialogoCorrigir: 'Corrigir a decisão de profilaxia',
    textoCorrigir:
      'A decisão original continua visível. Anular (lançada por engano) reabre a pendência para uma nova decisão.',
    decisoesCorrecao: {
      prescrita: 'Profilaxia prescrita',
      'nao-prescrita': 'Não prescrita (informe o motivo)',
      anulada: 'Anular a decisão (reabre a pendência)',
    },
    justificativa: 'Justificativa da correção',
    justificativaAjuda: 'De 10 a 300 caracteres.',
    confirmarCorrecao: 'Registrar a correção',
    historico: 'Decisões anteriores',
    historicoItem: '{decisao} por {por} em {quando}',
    anulada: 'Decisão anulada',
    // Revisão W0-03: a tela própria de quem prescreve (só a permissão de prescrever).
    telaTitulo: 'Profilaxia de TEV pendente ao prescritor',
    telaTexto:
      'Os escores de risco de TEV da unidade que sugerem profilaxia e ainda não têm decisão. Escolha a unidade e registre a decisão; a ordem em si é feita na prescrição.',
    escolhaUnidade: 'Escolha a unidade para ver as pendências.',
  },
  atalhos: {
    trr: 'Acionar o Time de Resposta Rápida',
    trrAlerta: 'Este alerta pede o Time de Resposta Rápida: acionar',
    contencao: 'Contenção mecânica',
    protocolos: 'Protocolos gerenciados (sepse, AVC, TEV)',
    feridas: 'Feridas e lesão por pressão',
    profilaxia: 'Profilaxia de TEV pendente (prescritor)',
  },
};
