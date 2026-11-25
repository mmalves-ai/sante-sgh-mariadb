// Catálogo de eventos auditáveis do Sante SGH (ficha do M06; cap-08 §8.12). Cada evento vai à SGH_TRILHA
// (trilha própria, só de inclusão, cadeia de hash) e, quando o Delphi registraria o mesmo evento, também a
// a trilha do sistema de origem como o Delphi grava (trilha dupla): tipo de ação auditada, criticidade
// e opção de menu de origem vistos no perfil passivo (06 a 07/2026). Tipos novos da SBIS v5.2
// (quebra de vidro, consentimento, falha de assinatura) ficam só na trilha própria. Nunca o tipo 14
// "Conexão BD" (é do Delphi). Nenhum dado clínico nem nome: só identificadores (SBIS-18).

/** Tipos de ação auditada da trilha de origem (ficha do M06, seção 5). */
// ADR 0022: 17 (gerenciamento de usuários), 18 (de grupos) e 25 (de permissões), como o Delphi grava na
// administração de acessos (trilha de origem da cópia pc: 2.919, 4 e 811 eventos).
export const TIPOS_EVENTO_LEGADO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 24, 25] as const;
export type TipoEventoLegado = (typeof TIPOS_EVENTO_LEGADO)[number];

/** Criticidades usadas pelo legado na trilha (informativo, erro, alerta). */
export const CRITICIDADES_LEGADO = [7, 4, 2] as const;
export type CriticidadeLegado = (typeof CRITICIDADES_LEGADO)[number];

export interface EventoLegado {
  readonly tipo: TipoEventoLegado;
  readonly criticidade: CriticidadeLegado;
  /** Opção de menu de origem que o sistema de origem registra para o evento (a mais frequente na janela do perfil). */
  readonly opcao: number;
}

export interface EventoAuditavel {
  readonly codigo: string;
  readonly descricao: string;
  /** null: só na SGH_TRILHA (tipo novo da SBIS ou evento que o Delphi não registra). */
  readonly legado: EventoLegado | null;
}

/**
 * Opções do perfil passivo (trilha de origem, 2026-06-01 a 2026-07-05): login e fim de sessão pelo módulo de
 * abertura (5416 Login, 5417 Logout); bloqueio e desbloqueio pela opção do PEP (5143, 5144), a mais usada
 * (o módulo de abertura não tem as duas).
 */
export const EVENTOS_AUDITAVEIS = {
  loginOk: {
    codigo: 'sessao.login.ok',
    descricao: 'Autenticação de usuário, com sucesso',
    legado: { tipo: 6, criticidade: 7, opcao: 5416 },
  },
  loginFalho: {
    codigo: 'sessao.login.falho',
    descricao: 'Tentativa de autenticação, sem sucesso',
    legado: { tipo: 7, criticidade: 4, opcao: 5416 },
  },
  fimSessao: {
    codigo: 'sessao.encerrada',
    descricao: 'Finalização da sessão de usuário',
    legado: { tipo: 10, criticidade: 7, opcao: 5417 },
  },
  bloqueio: {
    codigo: 'sessao.bloqueada',
    descricao: 'Bloqueio de sessão de usuário',
    legado: { tipo: 8, criticidade: 7, opcao: 5143 },
  },
  desbloqueio: {
    codigo: 'sessao.desbloqueada',
    descricao: 'Desbloqueio de sessão de usuário',
    legado: { tipo: 9, criticidade: 7, opcao: 5144 },
  },
  // M15: a abertura do prontuário do paciente (a primeira leitura dele na sessão, com o motivo) é a "Consulta do
  // RES" que o Delphi grava na trilha dele UMA vez, ao selecionar o paciente (tipo 1, opção 5146; perfil passivo
  // do M06): trilha dupla. As páginas e os filtros da lista, as aberturas de registro e de aba e a busca de
  // palavra ficam só na trilha própria (o Delphi não as registra).
  consultaRes: {
    codigo: 'pep.prontuario.lido',
    descricao: 'Consulta do RES: abertura do prontuário do paciente (com o motivo de acesso)',
    legado: { tipo: 1, criticidade: 7, opcao: 5146 },
  },
  registrosListados: {
    codigo: 'pep.prontuario.listado',
    descricao:
      'Página ou filtro da lista de registros do paciente (parte, página e quantidade; nunca o conteúdo)',
    legado: null,
  },
  excecoesConsultadas: {
    codigo: 'pep.excecoes.consultadas',
    descricao: 'Relatório agregado das exceções do prontuário (só contagens; nenhum paciente)',
    legado: null,
  },
  registroLido: {
    codigo: 'pep.registro.lido',
    descricao: 'Abertura de registro do prontuário ou de uma aba dele (parte e motivo; nunca o conteúdo)',
    legado: null,
  },
  prontuarioBuscado: {
    codigo: 'pep.prontuario.buscado',
    descricao: 'Busca de palavra nos registros do paciente (quantidade; nunca o termo)',
    legado: null,
  },
  motivoInformado: {
    codigo: 'pep.motivo.informado',
    descricao: 'Motivo de acesso ao prontuário informado na primeira abertura do paciente na sessão',
    legado: null,
  },
  acessosConsultados: {
    codigo: 'auditoria.acessos.consultados',
    descricao: 'Consulta do registro de acesso ao prontuário (filtros e quantidade; nunca o dado clínico)',
    legado: null,
  },
  acessosExportados: {
    codigo: 'auditoria.acessos.exportados',
    descricao: 'Exportação do registro de acesso ao prontuário',
    legado: null,
  },
  // M22: registros clínicos nos modelos do formulário de origem. A finalização é registrada pelo Delphi na trilha
  // dele como inclusão (tipo 2) e ação (tipo 24) na opção 5182 "Confirmar", com o registro no detalhe
  // da trilha (id da evolução); a suspensão como alteração (tipo 3, opção 3918). Rascunho, abertura do formulário e
  // leitura do histórico ficam só na trilha própria (o Delphi não os registra).
  evolucaoCoassinada: {
    codigo: 'pep.evolucao.coassinada',
    descricao: 'Registro clínico do residente coassinado pelo preceptor (preceptoria)',
    legado: null,
  },
  evolucaoCoassinaturaRecusada: {
    codigo: 'pep.evolucao.coassinaturaRecusada',
    descricao: 'Coassinatura do registro do residente recusada pelo preceptor, com o motivo',
    legado: null,
  },
  evolucaoRegistrada: {
    codigo: 'pep.evolucao.registrada',
    descricao:
      'Registro clínico finalizado no modelo do formulário (paciente, modelo e registro; nunca o conteúdo)',
    legado: { tipo: 2, criticidade: 7, opcao: 5182 },
  },
  evolucaoSuspensa: {
    codigo: 'pep.evolucao.suspensa',
    descricao: 'Registro clínico suspenso com justificativa (o original continua visível, marcado suspenso)',
    legado: { tipo: 3, criticidade: 7, opcao: 3918 },
  },
  rascunhoSalvo: {
    codigo: 'pep.rascunho.salvo',
    descricao: 'Rascunho do registro clínico salvo (paciente, modelo e rascunho; nunca o conteúdo)',
    legado: null,
  },
  rascunhoDescartado: {
    codigo: 'pep.rascunho.descartado',
    descricao: 'Rascunho do registro clínico descartado (marcado excluído, como o legado)',
    legado: null,
  },
  formularioAberto: {
    codigo: 'pep.formulario.aberto',
    descricao: 'Formulário aberto para registro (pré-preenchimento e rascunhos do paciente lidos)',
    legado: null,
  },
  historicoPerguntaLido: {
    codigo: 'pep.historico.lido',
    descricao:
      'Histórico de uma pergunta do paciente lido ("copiar do último"; quantidade, nunca o conteúdo)',
    legado: null,
  },
  evolucaoVisualizada: {
    codigo: 'pep.evolucao.visualizada',
    descricao: 'Registro clínico aberto em visualização ou impressão (registro; nunca o conteúdo)',
    legado: null,
  },
  administracaoPepConsultada: {
    codigo: 'pep.admin.consultado',
    descricao: 'Consulta dos modelos de formulário, versões e modelos de impressão (sem dado de paciente)',
    legado: null,
  },
  leituraAlertada: {
    codigo: 'auditoria.leitura.alertada',
    descricao: 'Alerta ao Auditor: muitos prontuários em pouco tempo ou acesso fora do horário habitual',
    legado: null,
  },
  emergenciaAberta: {
    codigo: 'acesso.emergencia.aberta',
    descricao: 'Acesso de emergência (quebra de vidro) aberto',
    legado: null,
  },
  emergenciaRevisada: {
    codigo: 'acesso.emergencia.revisada',
    descricao: 'Acesso de emergência revisado',
    legado: null,
  },
  grupoConsultado: {
    codigo: 'acesso.grupo.consultado',
    descricao: 'Consulta dos grupos de usuários e perfis propostos',
    legado: null,
  },
  // M59-F2 (ficha do M59, regras 1 a 3): credencial forte, segundo fator, política e retirada da senha antiga.
  credencialRegravada: {
    codigo: 'acesso.credencial.regravada',
    descricao: 'Senha regravada no esquema forte (primeiro login)',
    legado: null,
  },
  segundoFatorIniciado: {
    codigo: 'acesso.segundofator.iniciado',
    descricao: 'Cadastro do segundo fator iniciado',
    legado: null,
  },
  segundoFatorConfirmado: {
    codigo: 'acesso.segundofator.confirmado',
    descricao: 'Segundo fator confirmado (ativo)',
    legado: null,
  },
  segundoFatorRemovido: {
    codigo: 'acesso.segundofator.removido',
    descricao: 'Segundo fator removido pelo próprio usuário',
    legado: null,
  },
  segundoFatorRevogado: {
    codigo: 'acesso.segundofator.revogado',
    descricao: 'Segundo fator de outro usuário revogado pelo gestor de acessos',
    legado: null,
  },
  politicaSegundoFatorIncluida: {
    codigo: 'acesso.politicaSegundoFator.incluida',
    descricao: 'Segundo fator tornado obrigatório para um perfil, um grupo ou todos',
    legado: null,
  },
  politicaSegundoFatorEncerrada: {
    codigo: 'acesso.politicaSegundoFator.encerrada',
    descricao: 'Obrigatoriedade do segundo fator encerrada (volta a opcional)',
    legado: null,
  },
  politicaSegundoFatorAlterada: {
    codigo: 'acesso.politicaSegundoFator.alterada',
    descricao:
      'Prazo ou alvo da obrigatoriedade do segundo fator alterado com motivo (a linha anterior fica encerrada)',
    legado: null,
  },
  identidadeConsultada: {
    codigo: 'acesso.identidade.consultada',
    descricao: 'Consulta da situação das senhas e do segundo fator dos usuários',
    legado: null,
  },
  senhaLegadoRetirada: {
    codigo: 'acesso.senhaLegado.retirada',
    descricao: 'Senha antiga retirada do usuário que já entra com a credencial forte',
    legado: null,
  },
  saneamentoConsultado: {
    codigo: 'acesso.saneamento.consultado',
    descricao: 'Consulta do saneamento dos grupos de acesso amplo (plano, usuários e simulação)',
    legado: null,
  },
  saneamentoItemIncluido: {
    codigo: 'acesso.saneamento.incluido',
    descricao: 'Decisão do saneamento incluída para um usuário de grupo de acesso amplo',
    legado: null,
  },
  saneamentoItemAprovado: {
    codigo: 'acesso.saneamento.aprovado',
    descricao: 'Decisão do saneamento aprovada pelo dono da área (perda de opção usada)',
    legado: null,
  },
  saneamentoItemDescartado: {
    codigo: 'acesso.saneamento.descartado',
    descricao: 'Decisão do saneamento descartada',
    legado: null,
  },
  saneamentoItemAplicado: {
    codigo: 'acesso.saneamento.aplicado',
    descricao: 'Decisão do saneamento aplicada (grupo trocado, usuário bloqueado ou opções retiradas)',
    legado: null,
  },
  sbisConsultado: {
    codigo: 'auditoria.sbis.consultado',
    descricao: 'Consulta da certificação (requisitos, pacote de evidências e ciclos de avaliação)',
    legado: null,
  },
  sbisCicloAberto: {
    codigo: 'auditoria.sbis.ciclo.aberto',
    descricao: 'Ciclo de avaliação aberto (autoavaliação, pré-auditoria ou auditoria)',
    legado: null,
  },
  sbisItemAvaliado: {
    codigo: 'auditoria.sbis.item.avaliado',
    descricao: 'Requisito avaliado num ciclo (conforme, não conforme, concessão ou não aplicável)',
    legado: null,
  },
  sbisCorrecaoRegistrada: {
    codigo: 'auditoria.sbis.correcao',
    descricao: 'Correção de não conformidade registrada ou verificada',
    legado: null,
  },
  sbisCicloConcluido: {
    codigo: 'auditoria.sbis.ciclo.concluido',
    descricao: 'Ciclo de avaliação concluído com o parecer, ou cancelado',
    legado: null,
  },
  concessoesConsultadas: {
    codigo: 'auditoria.concessao.consultada',
    descricao: 'Consulta do termo das concessões da coexistência',
    legado: null,
  },
  concessaoAlterada: {
    codigo: 'auditoria.concessao.alterada',
    descricao: 'Concessão da coexistência encerrada, reaberta ou com a data prevista alterada',
    legado: null,
  },
  backupVerificadoConsultado: {
    codigo: 'auditoria.backup.consultado',
    descricao: 'Consulta do backup verificado (relatórios de restauração)',
    legado: null,
  },
  restauracaoRegistrada: {
    codigo: 'auditoria.backup.restauracao',
    descricao: 'Relatório de restauração do backup registrado',
    legado: null,
  },
  trilhaSbisExportada: {
    codigo: 'auditoria.trilha.exportada-sbis',
    descricao: 'Trilha exportada para a auditoria, com a identificação do software e a prova da cadeia',
    legado: null,
  },
  mapaConsultado: {
    codigo: 'acesso.permissao.consultada',
    descricao: 'Consulta do mapa opção de menu → permissão',
    legado: null,
  },
  permissaoNegada: {
    codigo: 'acesso.permissao.negada',
    descricao: 'Tentativa de ação sem permissão (recusada pela guarda)',
    legado: null,
  },
  schemaVerificado: {
    codigo: 'config.schema.verificado',
    descricao: 'Verificação da estrutura do banco pedida pela tela técnica',
    legado: null,
  },
  documentoEmitido: {
    codigo: 'documento.emissao.criada',
    descricao: 'Emissão de documento',
    legado: null,
  },
  documentoReemitido: {
    codigo: 'documento.emissao.reemitida',
    descricao: 'Segunda via de documento',
    legado: null,
  },
  documentoImpresso: {
    codigo: 'documento.impressao.criada',
    descricao: 'Impressão de etiqueta ou documento',
    legado: null,
  },
  documentoAssinado: {
    codigo: 'documento.impressao.assinada',
    descricao: 'Assinatura de impressão',
    legado: null,
  },
  // M14: consultas somente leitura e domínios em massa (só na trilha própria: o Delphi não registra a consulta
  // dessas tabelas, salvo as três com trilha medida, que a receita grava).
  consultaRegistroAberto: {
    codigo: 'consulta.registro.aberto',
    descricao:
      'Abertura de registro com dado de pessoa na consulta somente leitura (tabela e chave; nunca o conteúdo)',
    legado: null,
  },
  consultaExportada: {
    codigo: 'consulta.tabela.exportada',
    descricao:
      'Exportação de consulta somente leitura (filtros, quantidade e justificativa; nunca o conteúdo)',
    legado: null,
  },
  dominioInativadoNoNovo: {
    codigo: 'cadastro.dominio.inativadoNoNovo',
    descricao: 'Inativação de item de domínio só no sistema novo (a tabela não tem coluna de situação)',
    legado: null,
  },
  dominioReativadoNoNovo: {
    codigo: 'cadastro.dominio.reativadoNoNovo',
    descricao:
      'Reativação de item de domínio inativado só no sistema novo (desfaz a inativação; nada no banco do hospital)',
    legado: null,
  },
  matrizVaziaComDados: {
    codigo: 'config.matriz.vaziaComDados',
    descricao: 'Tabela que estava vazia passou a ter dados (vigia diária da matriz de cobertura)',
    legado: null,
  },
  // M08: CRUD genérico, parâmetros e funcionalidades por estabelecimento (só na trilha própria).
  dominioExportado: {
    codigo: 'cadastro.dominio.exportado',
    descricao: 'Exportação de lista de domínio (CRUD genérico)',
    legado: null,
  },
  // Revisão do W0-02 (D-CRUD-SEM-GATILHO): a leitura do relatório da vigia de reconciliação (exclusões feitas por fora).
  vigiaReconciliacaoConsultada: {
    codigo: 'cadastro.vigiaReconciliacao.consultada',
    descricao:
      'Relatório das exclusões de cadastro feitas fora do sistema consultado (vigia de reconciliação)',
    legado: null,
  },
  dominioGravado: {
    codigo: 'cadastro.dominio.gravado',
    descricao: 'Inclusão, alteração ou inativação de item de domínio (sessão sintética, em memória)',
    legado: null,
  },
  parametroDefinido: {
    codigo: 'config.parametro.definido',
    descricao: 'Definição de parâmetro do sistema novo (versão nova, com justificativa)',
    legado: null,
  },
  parametroRetirado: {
    codigo: 'config.parametro.retirado',
    descricao:
      'Sobreposição de parâmetro retirada com justificativa (a versão é fechada e o nível volta a herdar)',
    legado: null,
  },
  liberacaoAlterada: {
    codigo: 'config.liberacao.alterada',
    descricao: 'Chave de liberação ligada ou desligada (lote por estabelecimento, setor, grupo ou pessoa)',
    legado: null,
  },
  liberacaoRevertida: {
    codigo: 'config.liberacao.revertida',
    descricao: 'Lote de liberação revertido',
    legado: null,
  },
  prerequisitoRegistrado: {
    codigo: 'config.prerequisito.registrado',
    descricao: 'Pré-requisito externo de recurso desligado registrado',
    legado: null,
  },
  // M11: pacientes e profissionais. A abertura da ficha e a busca são eventos de acesso (cap-06a §6.1; cap-08
  // §8.12); o perfil passivo de 06 a 07/2026 não mostrou evento do Delphi para a consulta do cadastro (só a
  // inclusão, opção 3255, que a receita grava na trilha do legado): ficam só na trilha própria.
  pacienteBuscado: {
    codigo: 'cadastro.paciente.buscado',
    descricao: 'Busca de paciente (tipo de busca e quantidade de resultados; nunca o termo)',
    legado: null,
  },
  pacienteLido: {
    codigo: 'cadastro.paciente.lido',
    descricao: 'Abertura da ficha do paciente (registro de acesso)',
    legado: null,
  },
  historicoLido: {
    codigo: 'cadastro.historico.lido',
    descricao: 'Consulta da linha do tempo do cadastro do paciente ou do profissional',
    legado: null,
  },
  pacienteGravadoMemoria: {
    codigo: 'cadastro.paciente.gravado',
    descricao: 'Cadastro ou alteração de paciente (sessão sintética, em memória)',
    legado: null,
  },
  duplicidadeDecidida: {
    codigo: 'cadastro.duplicidade.decidida',
    descricao: 'Par da fila de duplicidades decidido ("é outra pessoa"), com a justificativa na fila',
    legado: null,
  },
  duplicidadeListada: {
    codigo: 'cadastro.duplicidade.listada',
    descricao:
      'Consulta da fila de duplicidades (situação e quantidade de pares; nunca o dado dos pacientes)',
    legado: null,
  },
  duplicidadeFilaAtualizada: {
    codigo: 'cadastro.duplicidade.fila',
    descricao: 'Fila de duplicidades atualizada (pares novos pela regra do escore)',
    legado: null,
  },
  consentimentoRegistrado: {
    codigo: 'cadastro.consentimento.registrado',
    descricao: 'Consentimento do paciente registrado ou revogado (finalidade, versão e signatário)',
    legado: null,
  },
  profissionalLido: {
    codigo: 'cadastro.profissional.lido',
    descricao: 'Abertura da ficha do profissional',
    legado: null,
  },
  pessoaBuscada: {
    codigo: 'cadastro.pessoa.buscada',
    descricao: 'Consulta de pessoas por CPF ou CNPJ (quantidade; nunca o documento)',
    legado: null,
  },
  // M12: convênios, contratos e preços (só na trilha própria: o Delphi não registra estes eventos na
  // trilha de origem; a autoria das mudanças de preço e de convênio vai também à SGH_PRECO_AUTORIA).
  convenioSituacaoAlterada: {
    codigo: 'convenio.situacao.alterada',
    descricao: 'Convênio suspenso ou reativado (situação do convênio), com justificativa',
    legado: null,
  },
  convenioContratoAlterado: {
    codigo: 'convenio.contrato.alterado',
    descricao: 'Cadastro, elegibilidade ou financeiro do contrato do convênio alterado, com justificativa',
    legado: null,
  },
  convenioPlanoGravado: {
    codigo: 'convenio.plano.gravado',
    descricao: 'Plano e vigência do contrato do convênio registrados no sistema novo (SGH_)',
    legado: null,
  },
  convenioPlanoAlterado: {
    codigo: 'convenio.plano.alterado',
    descricao: 'Plano do contrato do convênio corrigido, encerrado (fim da vigência) ou desativado (SGH_)',
    legado: null,
  },
  precoReajustado: {
    codigo: 'preco.reajuste.aplicado',
    descricao: 'Reajuste de preço gravado como nova vigência (lote de até 200 itens por transação)',
    legado: null,
  },
  precoReajusteDesfeito: {
    codigo: 'preco.reajuste.desfeito',
    descricao: 'Reajuste desfeito (as vigências criadas pelo lote removidas; a anterior volta a valer)',
    legado: null,
  },
  precoImportacaoGravada: {
    codigo: 'preco.importacao.gravada',
    descricao:
      'Importação versionada de tabela de preço preparada, validada, comparada, aprovada ou rejeitada',
    legado: null,
  },
  // M13: catálogos oficiais e importadores (só na trilha própria: o Delphi não registra estes eventos). A carga
  // publicada grava o evento por lote (executor); preparar, aprovar, rejeitar e cancelar, pela transação SGH_.
  catalogoCargaPreparada: {
    codigo: 'catalogo.carga.preparada',
    descricao: 'Arquivo oficial de catálogo enviado: preparado, validado e comparado na área de preparação',
    legado: null,
  },
  catalogoCargaAprovada: {
    codigo: 'catalogo.carga.aprovada',
    descricao: 'Carga de catálogo aprovada para publicação (com justificativa e a senha de novo)',
    legado: null,
  },
  catalogoCargaRejeitada: {
    codigo: 'catalogo.carga.rejeitada',
    descricao: 'Carga de catálogo rejeitada ou cancelada (com motivo)',
    legado: null,
  },
  catalogoLotePublicado: {
    codigo: 'catalogo.lote.publicado',
    descricao: 'Lote de uma carga de catálogo publicado no banco do estabelecimento (transação curta)',
    legado: null,
  },
  // ADR 0021: suporte técnico e login como (só na trilha própria). Dentro do "como", toda linha da SGH_TRILHA
  // leva o ator real na ORIGEM ("SUPORTE:<tipo>:<conta>:S<sessão>"); o USUARIO é o alvo, como na trilha de origem.
  suporteSessaoAberta: {
    codigo: 'suporte.sessao.aberta',
    descricao: 'Sessão "como" aberta pela plataforma ou pelo suporte técnico (o alvo não fez login)',
    legado: null,
  },
  suporteSessaoEncerrada: {
    codigo: 'suporte.sessao.encerrada',
    descricao: 'Sessão "como" encerrada (voltou, expirou, revogada ou função retirada)',
    legado: null,
  },
  suporteEscritaCorrigida: {
    codigo: 'suporte.escrita.corrigida',
    descricao: 'Correção (Desfazer) de escrita feita numa sessão "como"',
    legado: null,
  },
  suporteContaCriada: {
    codigo: 'suporte.conta.criada',
    descricao: 'Conta de suporte técnico cadastrada pela plataforma',
    legado: null,
  },
  suporteFuncaoAlterada: {
    codigo: 'suporte.funcao.alterada',
    descricao: 'Função de suporte técnico ativada ou desativada',
    legado: null,
  },
  // ADR 0022: acesso total da plataforma e tela "Perfis e permissões". As receitas do legado gravam, além
  // da SGH_TRILHA, o evento que o Delphi grava (tipos 17, 18 e 25) pela trilha dupla do executor.
  acessoTotalAberto: {
    codigo: 'suporte.acessoTotal.aberto',
    descricao: 'Acesso total da plataforma aberto (todas as permissões, em nome de um usuário do hospital)',
    legado: null,
  },
  perfilConcedido: {
    codigo: 'acesso.perfil.concedido',
    descricao: 'Perfil do Sante SGH concedido a um usuário (SGH_ACESSO_PERFIL_USUARIO)',
    legado: null,
  },
  perfilRevogado: {
    codigo: 'acesso.perfil.revogado',
    descricao: 'Perfil do Sante SGH revogado de um usuário',
    legado: null,
  },
  perfilAlterado: {
    codigo: 'acesso.perfil.alterado',
    descricao:
      'Vigência ou motivo de perfil concedido alterado com justificativa (o anterior fica na alteração)',
    legado: null,
  },
  mapaDecidido: {
    codigo: 'acesso.mapa.decidido',
    descricao: 'Mapa grupo → perfil ou perfil → permissão proposto, aprovado ou recusado',
    legado: null,
  },
  // W1-01 (parte 5): política de senha do Sante por versão (SGH_ACESSO_POLITICA_SENHA; a anterior fica consultável).
  politicaSenhaPublicada: {
    codigo: 'acesso.politica-senha.publicada',
    descricao: 'Política de senha publicada (versão nova com vigência; a anterior fica consultável)',
    legado: null,
  },
  politicaSenhaCancelada: {
    codigo: 'acesso.politica-senha.cancelada',
    descricao: 'Versão agendada da política de senha cancelada antes de entrar em vigor',
    legado: null,
  },
  // W1-01 (parte 8): limite de sessões simultâneas por perfil (SGH_ACESSO_LIMITE_SESSAO; cada mudança é linha nova).
  limiteSessaoDefinido: {
    codigo: 'acesso.limite-sessao.definido',
    descricao:
      'Limite de sessões simultâneas de um perfil incluído, alterado ou retirado (com o valor anterior)',
    legado: null,
  },
  // W1-01 (parte 9): contas dormentes (bloqueio pelo executor acesso.bloquearUsuario; exceção em SGH_ 1204).
  contaDormenteBloqueada: {
    codigo: 'acesso.conta-dormente.bloqueada',
    descricao: 'Conta bloqueada pela rotina das contas dormentes (dias sem acesso e o limite; só o login)',
    legado: null,
  },
  contasDormentesRodada: {
    codigo: 'acesso.contas-dormentes.rodada',
    descricao: 'Rodada da rotina das contas dormentes (quantas dormentes, bloqueadas, poupadas e falhas)',
    legado: null,
  },
  contaDormenteExcecao: {
    codigo: 'acesso.conta-dormente.excecao',
    descricao:
      'Exceção justificada de conta dormente incluída, com prazo trocado ou retirada (com o valor anterior)',
    legado: null,
  },
  // W1-01 (parte 11d): conferência do conselho no vínculo usuário–profissional (SGH_ 1211).
  conselhoConferido: {
    codigo: 'acesso.conselho.conferido',
    descricao:
      'Conferência da situação do registro no conselho (situação, dia da consulta, fonte, quem conferiu; com o valor anterior)',
    legado: null,
  },
  // W1-01 (parte 9c): recertificação de acessos (SGH_ 1206; retirar = bloqueio pelo executor ou revogação de perfil).
  recertificacaoAberta: {
    codigo: 'acesso.recertificacao.aberta',
    descricao: 'Campanha de recertificação de acessos aberta (escopo, prazo, contas e motivo)',
    legado: null,
  },
  recertificacaoDecidida: {
    codigo: 'acesso.recertificacao.decidida',
    descricao: 'Conta recertificada: manter, ou retirar com bloqueio ou revogação de perfil (com o motivo)',
    legado: null,
  },
  recertificacaoFechada: {
    codigo: 'acesso.recertificacao.fechada',
    descricao: 'Campanha de recertificação encerrada ou cancelada (pendentes e motivo)',
    legado: null,
  },
  // W1-01 (parte 10b): pedido de acesso em dois níveis.
  pedidoAcessoCriado: {
    codigo: 'acesso.pedido.criado',
    descricao: 'Pedido de acesso (perfil, setor, período e motivo) feito pela própria pessoa',
    legado: null,
  },
  pedidoAcessoDecidido: {
    codigo: 'acesso.pedido.decidido',
    descricao: 'Pedido de acesso aprovado ou recusado num nível (setor ou gestor de acessos), com o motivo',
    legado: null,
  },
  pedidoAcessoConcedido: {
    codigo: 'acesso.pedido.concedido',
    descricao: 'Perfil concedido pelo pedido aprovado nos dois níveis (início e fim; expira sozinho)',
    legado: null,
  },
  pedidoAcessoCancelado: {
    codigo: 'acesso.pedido.cancelado',
    descricao: 'Pedido de acesso cancelado pelo solicitante antes da concessão (com o motivo)',
    legado: null,
  },
  // W1-01 (parte 11a): provisionamento pelo RH (SGH_ 1208; suspender = bloqueio pelo executor).
  rhTarefaResolvida: {
    codigo: 'acesso.rh.tarefa-resolvida',
    descricao:
      'Tarefa do RH (criar, revisar ou suspender acesso) resolvida como feita ou dispensada, com o motivo',
    legado: null,
  },
  rhPerfilCargoDefinido: {
    codigo: 'acesso.rh.perfil-cargo-definido',
    descricao: 'Perfil sugerido para um cargo incluído, trocado ou retirado (com o valor anterior)',
    legado: null,
  },
  // W1-01 (parte 11b): troca rápida de usuário por PIN (SGH_ 1209; só o hash Argon2id; nunca o PIN nem o hash na trilha).
  pinDefinido: {
    codigo: 'acesso.pin.definido',
    descricao: 'PIN da troca rápida definido ou trocado pela própria pessoa (com a situação anterior)',
    legado: null,
  },
  pinRetirado: {
    codigo: 'acesso.pin.retirado',
    descricao: 'PIN da troca rápida retirado pela própria pessoa ou pelo gestor de acessos (com o motivo)',
    legado: null,
  },
  pinBloqueado: {
    codigo: 'acesso.pin.bloqueado',
    descricao: 'PIN da troca rápida bloqueado por erros seguidos (só um PIN novo, depois da senha, libera)',
    legado: null,
  },
  // W1-01 (parte 12a): "Aplicar acessos de…" (cada passo vai também à trilha da própria gravação).
  modeloAplicado: {
    codigo: 'acesso.modelo.aplicado',
    descricao:
      'Acessos de um usuário-modelo aplicados a outro usuário (grupo, papéis e perfis; o motivo e cada passo)',
    legado: null,
  },
  trocaRapida: {
    codigo: 'sessao.troca-rapida',
    descricao: 'Troca rápida de usuário por PIN na estação (a sessão anterior fica bloqueada)',
    legado: null,
  },
  // Decisão do dono (2026-11-20, b): troca da senha do administrador da plataforma (credencial do banco plataforma).
  senhaPlataformaTrocada: {
    codigo: 'plataforma.senha.trocada',
    descricao: 'Senha do administrador da plataforma trocada (as outras sessões dele são encerradas)',
    legado: null,
  },
  // W1-01 (parte 7): "Esqueci a senha" (o pedido; a senha provisória entra pelo executor acesso.redefinirSenha).
  senhaRecuperacaoPedida: {
    codigo: 'acesso.senha.recuperacao-pedida',
    descricao: 'Pedido de recuperação de senha pelo e-mail institucional (só o login; nunca o token)',
    legado: null,
  },
  // W1-01 (parte 4c): versão nova da descrição do grupo (SGH_ACESSO_GRUPO_DESCR; a anterior fica consultável).
  grupoDescrito: {
    codigo: 'acesso.grupo.descrito',
    descricao: 'Descrição do grupo de usuários alterada (versão nova; a anterior fica consultável)',
    legado: null,
  },
  permissoesLegadoAlteradas: {
    codigo: 'acesso.permissaoLegado.alterada',
    descricao: 'Grupos, papéis e opções de usuário alterados pela receita do executor',
    legado: null,
  },
  cacheInvalidado: {
    codigo: 'acesso.cache.invalidado',
    descricao: 'Cache das permissões efetivas invalidado (a mudança vale na hora)',
    legado: null,
  },
  suporteAtribuicoesAlteradas: {
    codigo: 'suporte.atribuicoes.alteradas',
    descricao: 'Estabelecimentos atribuídos a um suporte técnico alterados',
    legado: null,
  },
  // M10: acesso, organização e auditoria (telas). As consultas são eventos de acesso só na trilha própria; as
  // gravações no banco vão também à trilha do legado pelas receitas do executor (tipo 17, gerenciamento de
  // usuários, como o Delphi grava).
  usuarioConsultado: {
    codigo: 'acesso.usuario.consultado',
    descricao: 'Consulta da lista ou da ficha de usuários (escopos, papéis, flags; nunca senha)',
    legado: null,
  },
  simuladorConsultado: {
    codigo: 'acesso.simulador.consultado',
    descricao: 'Simulação do que um usuário pode fazer e por quê',
    legado: null,
  },
  arvorePermissoesConsultada: {
    codigo: 'acesso.arvore.consultada',
    descricao: 'Consulta da árvore de opções de um grupo ou papel e da política de senha',
    legado: null,
  },
  termoConsultado: {
    codigo: 'acesso.termo.consultado',
    descricao: 'Consulta do termo de uso vigente e dos aceites',
    legado: null,
  },
  termoAceitoMemoria: {
    codigo: 'acesso.termo.aceito',
    descricao: 'Aceite do termo de uso vigente (sessão sintética, em memória)',
    legado: null,
  },
  usuarioGravadoMemoria: {
    codigo: 'acesso.usuario.gravado',
    descricao: 'Usuário criado, alterado, bloqueado ou com escopo alterado (sessão sintética, em memória)',
    legado: null,
  },
  escopoSetorAlterado: {
    codigo: 'acesso.escopoSetor.alterado',
    descricao: 'Escopo de setor (bloco) do usuário concedido ou retirado (SGH_ACESSO_ESCOPO_SETOR)',
    legado: null,
  },
  quebrasVidroConsultadas: {
    codigo: 'acesso.emergencia.consultada',
    descricao: 'Consulta dos acessos por quebra de vidro para revisão',
    legado: null,
  },
  trilhaConsultada: {
    codigo: 'auditoria.trilha.consultada',
    descricao: 'Abertura da trilha de auditoria (período, filtros e quantidade; nunca o conteúdo)',
    legado: null,
  },
  trilhaExportada: {
    codigo: 'auditoria.trilha.exportada',
    descricao: 'Exportação da trilha de auditoria (CSV, XML ou HTML)',
    legado: null,
  },
  acessoProntuarioConsultado: {
    codigo: 'auditoria.acessoProntuario.consultado',
    descricao: 'Consulta do registro de acesso ao prontuário (quem viu)',
    legado: null,
  },
  exclusoesConsultadas: {
    codigo: 'auditoria.exclusao.consultada',
    descricao: 'Consulta das exclusões, justificativas e históricos de auditoria',
    legado: null,
  },
  pedidoTitularRegistrado: {
    codigo: 'auditoria.pedidoTitular.registrado',
    descricao: 'Pedido do titular registrado (protocolo, tipo e prazo)',
    legado: null,
  },
  pedidoTitularTratado: {
    codigo: 'auditoria.pedidoTitular.tratado',
    descricao: 'Pedido do titular com identidade confirmada, atendido ou negado (com fundamento)',
    legado: null,
  },
  privacidadeConsultada: {
    codigo: 'auditoria.lgpd.consultada',
    descricao: 'Consulta dos pedidos do titular e dos domínios de privacidade',
    legado: null,
  },
  estruturaConsultada: {
    codigo: 'organizacao.estrutura.consultada',
    descricao: 'Consulta da estrutura (empresa, hospital, unidades, leitos e conferência)',
    legado: null,
  },
  leitoGravadoMemoria: {
    codigo: 'organizacao.leito.gravado',
    descricao: 'Acomodação ou leito incluído, alterado ou inativado (sessão sintética, em memória)',
    legado: null,
  },
  // M24: prescrição eletrônica (CPOE). O Delphi registra a prescrição como inclusão (tipo 2) na opção 5223
  // "Prescrever" com o id da prescrição no detalhe da trilha (5.436 eventos em 2026-06/07); a suspensão da prescrição como
  // alteração (tipo 3) na 5219 "Suspender prescrição confirmada" (236); a manutenção (incluir, suspender e corrigir
  // item) como alteração na 5658 "Manutenção" (615). Alertas, reconciliação, prescrição futura e ficha de
  // antimicrobiano ficam só na trilha própria (o legado não os tem).
  prescricaoAssinada: {
    codigo: 'pep.prescricao.assinada',
    descricao:
      'Prescrição assinada no período (atendimento, prescrição e quantidade de itens; nunca o conteúdo)',
    legado: { tipo: 2, criticidade: 7, opcao: 5223 },
  },
  prescricaoSuspensa: {
    codigo: 'pep.prescricao.suspensa',
    descricao: 'Prescrição suspensa com justificativa (itens e horários futuros suspensos; nada apagado)',
    legado: { tipo: 3, criticidade: 7, opcao: 5219 },
  },
  prescricaoItemIncluido: {
    codigo: 'pep.item.incluido',
    descricao: 'Item incluído na prescrição já assinada (adendo, com documento próprio)',
    legado: { tipo: 3, criticidade: 7, opcao: 5658 },
  },
  prescricaoItemSuspenso: {
    codigo: 'pep.item.suspenso',
    descricao: 'Item da prescrição suspenso (simples ou por correção, com o item novo ligado)',
    legado: { tipo: 3, criticidade: 7, opcao: 5658 },
  },
  prescricaoLida: {
    codigo: 'pep.prescricao.lida',
    descricao: 'Prescrição do paciente aberta (leitura de prontuário; prescrição, nunca o conteúdo)',
    legado: null,
  },
  prescricaoVerificada: {
    codigo: 'pep.prescricao.verificada',
    descricao: 'Verificação de apoio à decisão do rascunho da prescrição (quantidade de alertas por tipo)',
    legado: null,
  },
  prescricaoCoassinada: {
    codigo: 'pep.prescricao.coassinada',
    descricao: 'Coassinatura do preceptor na prescrição do residente (só no novo)',
    legado: null,
  },
  prescricaoFuturaGravada: {
    codigo: 'pep.prescricaoFutura.gravada',
    descricao: 'Item programado para prescrição futura, cancelado ou efetivado (só no novo)',
    legado: null,
  },
  reconciliacaoRegistrada: {
    codigo: 'pep.reconciliacao.registrada',
    descricao: 'Reconciliação medicamentosa registrada na admissão ou na alta (quantidade; nunca o conteúdo)',
    legado: null,
  },
  antimicrobianoRegistrado: {
    codigo: 'pep.antimicrobiano.registrado',
    descricao: 'Ficha de antimicrobiano registrada (indicação e dia de tratamento; só no novo)',
    legado: null,
  },
  regraAlertaAlterada: {
    codigo: 'pep.regraAlerta.alterada',
    descricao: 'Regra de alerta da prescrição criada ou alterada (versão nova; a anterior fica guardada)',
    legado: null,
  },
  gradeClasseAlterada: {
    codigo: 'pep.gradeClasse.alterada',
    descricao: 'Grade de horários por classe de medicamento alterada (só no novo)',
    legado: null,
  },
  favoritoPrescritorAlterado: {
    codigo: 'pep.favoritoPrescritor.alterado',
    descricao: 'Favorito do prescritor marcado, reativado ou desmarcado (só no novo; desmarcar não apaga)',
    legado: null,
  },
  configuracaoConsultada: {
    codigo: 'config.consulta.lida',
    descricao: 'Consulta de alertas, servidor de e-mail, dados fiscais ou backup (credencial nunca sai)',
    legado: null,
  },
  // M16: painel de leitos, censo, painéis, indicadores e BI (só na trilha própria: o Delphi não registra a consulta
  // do mapa nem dos relatórios). A abertura do cartão leva o número da internação, nunca o nome.
  leitosConsultados: {
    codigo: 'internacao.leitos.consultado',
    descricao: 'Consulta do painel de leitos ao vivo ou da divergência de cadastro de leitos',
    legado: null,
  },
  pacienteDoLeitoAberto: {
    codigo: 'internacao.leitos.pacienteAberto',
    descricao: 'Abertura do cartão do leito com o nome do paciente (número da internação)',
    legado: null,
  },
  censoConsultado: {
    codigo: 'internacao.censo.consultado',
    descricao: 'Consulta do censo hospitalar diário ou da série',
    legado: null,
  },
  censoExportado: {
    codigo: 'internacao.censo.exportado',
    descricao: 'Exportação do censo hospitalar diário ou da série (só contagens)',
    legado: null,
  },
  censoMarcadasConsultadas: {
    codigo: 'internacao.censo.marcadas',
    descricao:
      'Consulta ou exportação do relatório das internações marcadas no cálculo (número da internação e a marca, sem dado do paciente)',
    legado: null,
  },
  censoFechado: {
    codigo: 'internacao.censo.fechado',
    descricao: 'Fechamento do censo do dia (retrato por unidade, uma vez por dia)',
    legado: null,
  },
  paineisConsultados: {
    codigo: 'relatorio.paineis.consultado',
    descricao: 'Consulta de um painel gerencial (assistencial, operacional ou financeiro)',
    legado: null,
  },
  indicadoresConsultados: {
    codigo: 'relatorio.indicadores.consultado',
    descricao: 'Consulta dos indicadores hospitalares (índice, série ou detalhe)',
    legado: null,
  },
  indicadoresExportados: {
    codigo: 'relatorio.indicadores.exportado',
    descricao: 'Exportação da série de um indicador (numerador e denominador)',
    legado: null,
  },
  biAberto: {
    codigo: 'relatorio.bi.aberto',
    descricao: 'Abertura da análise livre no BI',
    legado: null,
  },
  // M17: agenda de consultas. O Delphi não registra a agenda na trilha dele (0 eventos nas opções 3310 a 3406
  // em trilha de origem da cópia pc): os eventos ficam só na trilha própria, com identificadores (nunca nome nem contato).
  agendaGradeGerada: {
    codigo: 'agenda.grade.gerada',
    descricao: 'Horários da agenda gerados por período (agenda, período e quantidade)',
    legado: null,
  },
  agendaGradeRevertida: {
    codigo: 'agenda.grade.revertida',
    descricao: 'Geração de horários revertida (os horários que ganharam paciente ficam)',
    legado: null,
  },
  agendaConsultaMarcada: {
    codigo: 'agenda.consulta.marcada',
    descricao: 'Consulta marcada em horário vago (agenda, horário, paciente e canal)',
    legado: null,
  },
  agendaEncaixeCriado: {
    codigo: 'agenda.encaixe.criado',
    descricao: 'Encaixe fora da grade com o motivo (agenda, horário e paciente)',
    legado: null,
  },
  agendaEncaixeDesfeito: {
    codigo: 'agenda.encaixe.desfeito',
    descricao: 'Encaixe desfeito antes do check-in (protocolo do cancelamento)',
    legado: null,
  },
  agendaConsultaCancelada: {
    codigo: 'agenda.consulta.cancelada',
    descricao: 'Consulta cancelada com o motivo padronizado e quem pediu (protocolo)',
    legado: null,
  },
  agendaConsultaRemarcada: {
    codigo: 'agenda.consulta.remarcada',
    descricao: 'Consulta remarcada (marcação antiga e nova; transferência ou liberação do horário)',
    legado: null,
  },
  agendaConsultaConfirmada: {
    codigo: 'agenda.consulta.confirmada',
    descricao: 'Consulta confirmada com o paciente',
    legado: null,
  },
  agendaConfirmacaoRegistrada: {
    codigo: 'agenda.confirmacao.registrada',
    descricao: 'Tentativa de confirmação registrada (sem contato, recusou ou pediu cancelamento)',
    legado: null,
  },
  agendaFaltaRegistrada: {
    codigo: 'agenda.falta.registrada',
    descricao: 'Falta registrada no fechamento do dia',
    legado: null,
  },
  agendaHorariosBloqueados: {
    codigo: 'agenda.horarios.bloqueados',
    descricao: 'Horários bloqueados ou desbloqueados com motivo e período',
    legado: null,
  },
  agendaCoberturaDefinida: {
    codigo: 'agenda.cobertura.definida',
    descricao: 'Convênio ou especialidade aceito pela agenda incluído ou removido',
    legado: null,
  },
  agendaCadastrada: {
    codigo: 'agenda.agenda.gravada',
    descricao: 'Agenda incluída ou alterada (duração, situação, teleatendimento)',
    legado: null,
  },
  agendaEscalaPlanejada: {
    codigo: 'agenda.escala.planejada',
    descricao: 'Escala semanal planejada com a data em que passa a valer',
    legado: null,
  },
  agendaEsperaAlterada: {
    codigo: 'agenda.espera.alterada',
    descricao: 'Pedido da lista de espera incluído, ofertado ou encerrado',
    legado: null,
  },
  agendaMarcacaoLida: {
    codigo: 'agenda.marcacao.lida',
    descricao: 'Marcação aberta com o contato completo (ou as marcações de um paciente)',
    legado: null,
  },
  agendaLigacaoRevisada: {
    codigo: 'agenda.ligacao.revisada',
    descricao: 'Ligação da agenda com profissional, especialidade e local revisada',
    legado: null,
  },
  // M23: documentos, exames, resultados e multiprofissional. O Delphi registra na trilha dele a receita (inclusão,
  // tipo 2, opção 5251, com o id da receita; antes, a ação 24 na 2632 "Nova"), o atestado (inclusão na 4239,
  // com o id do atestado; antes, a ação 24 na 3933 "Novo"), a suspensão (alteração, tipo 3: 4606 na receita, 4605 no
  // atestado), o pedido de exame (inclusão na 5231 "Confirmar", com o id do pedido de exame; antes, a ação 24 na 4596 "Nova") e o
  // anexo (inclusão na 4636 "Inserir arquivo", com o id do anexo): perfil de trilha do sistema de origem de 2026-06-01
  // a 2026-07-05. A alergia é gravada dentro do registro clínico (o Delphi não registra à parte); lista de problemas,
  // ciência de crítico, fila de parecer, TCLE, sumário, óbito e assinatura ficam só na trilha própria.
  painelLido: {
    codigo: 'pep.painel.lido',
    descricao: 'Painel "Meus pacientes" aberto (unidade e quantidade; nunca o nome)',
    legado: null,
  },
  painelConfigurado: {
    codigo: 'pep.painel.configurado',
    descricao: 'Colunas ou filtros do painel de pacientes alterados pelo próprio usuário',
    legado: null,
  },
  cabecalhoLido: {
    codigo: 'pep.cabecalho.lido',
    descricao: 'Cabeçalho fixo do paciente aberto (alergias, leito, convênio)',
    legado: null,
  },
  linhaTempoLida: {
    codigo: 'pep.linhaTempo.lida',
    descricao: 'Linha do tempo do prontuário lida (período, página e quantidade)',
    legado: null,
  },
  documentoLido: {
    codigo: 'pep.documento.lido',
    descricao: 'Documento do prontuário aberto (tipo e identificador; nunca o conteúdo)',
    legado: null,
  },
  prontuarioExportado: {
    codigo: 'pep.prontuario.exportado',
    descricao: 'Prontuário exportado ou impresso por completo, com a justificativa',
    legado: null,
  },
  alergiaRegistrada: {
    codigo: 'pep.alergia.registrada',
    descricao: 'Alergia ou "nega alergias" registrada no registro clínico do atendimento',
    legado: null,
  },
  alergiaInativada: {
    codigo: 'pep.alergia.inativada',
    descricao: 'Alergia retirada da lista ativa (fica no histórico), com o motivo',
    legado: null,
  },
  problemaGravado: {
    codigo: 'pep.problema.gravado',
    descricao: 'Problema ou diagnóstico incluído, resolvido ou descartado (nova versão; nunca apaga)',
    legado: null,
  },
  exameSolicitado: {
    codigo: 'pep.exame.solicitado',
    descricao: 'Pedido de exames feito (paciente, atendimento e quantidade de exames)',
    legado: { tipo: 2, criticidade: 7, opcao: 5231 },
  },
  resultadoLido: {
    codigo: 'pep.resultado.lido',
    descricao: 'Resultados de exames do paciente lidos (quantidade e período)',
    legado: null,
  },
  cienciaCritico: {
    codigo: 'pep.resultado.ciente',
    descricao: 'Ciência de valor crítico registrada, com a conduta',
    legado: null,
  },
  exameExternoLancado: {
    codigo: 'pep.exame.externoLancado',
    descricao: 'Resultado de exame feito fora do estabelecimento lançado no prontuário',
    legado: null,
  },
  receitaEmitida: {
    codigo: 'pep.receita.emitida',
    descricao: 'Receita emitida (tipo e identificador; nunca o conteúdo)',
    legado: { tipo: 2, criticidade: 7, opcao: 5251 },
  },
  atestadoEmitido: {
    codigo: 'pep.atestado.emitido',
    descricao: 'Atestado, declaração ou requerimento emitido (modelo e identificador)',
    legado: { tipo: 2, criticidade: 7, opcao: 4239 },
  },
  documentoSuspenso: {
    codigo: 'pep.documento.suspenso',
    descricao: 'Receita ou atestado suspenso com justificativa (o original continua visível)',
    legado: { tipo: 3, criticidade: 7, opcao: 4606 },
  },
  segundaVia: {
    codigo: 'pep.documento.segundaVia',
    descricao: 'Segunda via do documento emitida, marcada "2ª via", com o motivo',
    legado: null,
  },
  sumarioAltaFinalizado: {
    codigo: 'pep.sumarioAlta.finalizado',
    descricao: 'Sumário de alta finalizado (atendimento e versão)',
    legado: null,
  },
  sumarioAltaRascunho: {
    codigo: 'pep.sumarioAlta.salvo',
    descricao: 'Versão de rascunho do sumário de alta salva',
    legado: null,
  },
  relatorioTransferencia: {
    codigo: 'pep.transferencia.registrada',
    descricao: 'Relatório de transferência inter-hospitalar registrado',
    legado: null,
  },
  obitoRegistrado: {
    codigo: 'pep.obito.registrado',
    descricao: 'Declaração de óbito registrada (atendimento; nunca as causas)',
    legado: null,
  },
  tcleGravado: {
    codigo: 'pep.tcle.gravado',
    descricao: 'Termo de consentimento emitido, assinado ou revogado',
    legado: null,
  },
  anexoIncluido: {
    codigo: 'pep.anexo.incluido',
    descricao: 'Documento digitalizado anexado ao prontuário (tipo e tamanho)',
    legado: { tipo: 2, criticidade: 7, opcao: 4636 },
  },
  parecerPedido: {
    codigo: 'pep.parecer.pedido',
    descricao: 'Parecer (interconsulta) pedido à especialidade ou categoria',
    legado: null,
  },
  parecerAceito: {
    codigo: 'pep.parecer.aceito',
    descricao: 'Parecer aceito pelo profissional da especialidade (cria vínculo assistencial)',
    legado: null,
  },
  parecerRespondido: {
    codigo: 'pep.parecer.respondido',
    descricao: 'Parecer respondido no registro clínico de resposta',
    legado: null,
  },
  parecerTrazido: {
    codigo: 'pep.parecer.trazido',
    descricao: 'Parecer pedido no outro registro clínico trazido à fila pela leitura incremental (vigia)',
    legado: null,
  },
  vigiaParecerIniciada: {
    codigo: 'pep.parecer.vigiaIniciada',
    descricao: 'Leitura incremental do parecer iniciada no estabelecimento (marca de onde parou)',
    legado: null,
  },
  parecerCancelado: {
    codigo: 'pep.parecer.cancelado',
    descricao: 'Parecer cancelado por quem pediu, com o motivo',
    legado: null,
  },
  filaParecerLida: {
    codigo: 'pep.parecer.filaLida',
    descricao: 'Fila de pareceres lida (especialidade e quantidade)',
    legado: null,
  },
  documentoPepAssinado: {
    codigo: 'documento.documento.assinado',
    descricao: 'Documento assinado (assinatura eletrônica avançada), um a um ou em lote',
    legado: null,
  },
  pendenciasAssinaturaLidas: {
    codigo: 'documento.pendencias.lidas',
    descricao: 'Pendências de assinatura do próprio usuário lidas (quantidade)',
    legado: null,
  },
  documentoValidado: {
    codigo: 'documento.validacao.consultada',
    descricao: 'Validação pública do documento pelo QR (sem conteúdo clínico)',
    legado: null,
  },
  // M19: recepção, senhas, guichês, totens e painéis. O Delphi não registra a emissão nem a chamada do guichê na
  // trilha dele (0 eventos nas opções 3308, 5739, 3969 a 3973 em trilha de origem desde 2025 na cópia pc): os eventos
  // ficam na trilha própria, com identificadores (nunca o nome do paciente).
  recepcaoSenhaEmitida: {
    codigo: 'recepcao.senha.emitida',
    descricao: 'Senha emitida no balcão ou no totem (gerador, número e prioridade)',
    legado: null,
  },
  recepcaoSenhaChamada: {
    codigo: 'recepcao.senha.chamada',
    descricao: 'Senha chamada pelo guichê (recepção, local, guichê e senha)',
    legado: null,
  },
  recepcaoSenhaConduzida: {
    codigo: 'recepcao.senha.conduzida',
    descricao: 'Evento da senha registrado (chamar de novo, suspender, concluir, encaminhar, não localizado)',
    legado: null,
  },
  recepcaoChegadaRegistrada: {
    codigo: 'recepcao.chegada.registrada',
    descricao: 'Chegada do paciente agendado registrada (senha ligada à marcação)',
    legado: null,
  },
  recepcaoGuicheAberto: {
    codigo: 'recepcao.guiche.aberto',
    descricao: 'Guichê aberto pela pessoa (recepção, local e número)',
    legado: null,
  },
  recepcaoGuicheFechado: {
    codigo: 'recepcao.guiche.fechado',
    descricao: 'Guichê fechado pela própria pessoa ou liberado pelo supervisor (com justificativa)',
    legado: null,
  },
  recepcaoFilaConfigurada: {
    codigo: 'recepcao.fila.configurada',
    descricao: 'Ordem de chamada, intercalação, tempo-alvo e botão do totem de um gerador alterados',
    legado: null,
  },
  recepcaoEstruturaAlterada: {
    codigo: 'recepcao.estrutura.alterada',
    descricao: 'Ponto de recepção, guichê ou serviço de senha incluído, alterado, desativado ou reativado',
    legado: null,
  },
  recepcaoDispositivoAlterado: {
    codigo: 'recepcao.dispositivo.alterado',
    descricao: 'Totem ou painel de TV cadastrado, renovado ou revogado (o token nunca vai à trilha)',
    legado: null,
  },
  recepcaoTermoModeloAlterado: {
    codigo: 'recepcao.termo.modelo',
    descricao:
      'Modelo de termo de consentimento incluído, nova versão, inativado, reativado ou excluído (nunca usado)',
    legado: null,
  },
  recepcaoTermoAssinado: {
    codigo: 'recepcao.termo.assinado',
    descricao:
      'Termo de consentimento assinado no balcão ou aceito no portal (o hash fica no registro, não na trilha)',
    legado: null,
  },
  recepcaoTermoRevogado: {
    codigo: 'recepcao.termo.revogado',
    descricao: 'Termo de consentimento assinado revogado, com o motivo (a assinatura continua visível)',
    legado: null,
  },
  recepcaoDispositivoRecusado: {
    codigo: 'recepcao.dispositivo.recusado',
    descricao: 'Acesso de totem ou painel recusado (token vencido, revogado ou de outro estabelecimento)',
    legado: null,
  },
  recepcaoAgendadosLidos: {
    codigo: 'recepcao.agendados.lidos',
    descricao: 'Agendados do dia abertos no guichê para o check-in (nome mascarado na lista)',
    legado: null,
  },
  // M18: agenda de exames e centro cirúrgico. O Delphi não registra estas opções na trilha dele (0 eventos nas
  // opções do SADT › Agenda e do Bloco Cirúrgico em trilha de origem da cópia pc): só a trilha própria, com identificadores.
  agendaExameMarcado: {
    codigo: 'agenda.exame.marcado',
    descricao: 'Exame marcado em horário vago (agenda, horário, paciente, exame e canal)',
    legado: null,
  },
  agendaExameSemProntuario: {
    codigo: 'agenda.exame.semProntuario',
    descricao: 'Exame marcado para quem ainda não tem prontuário (pré-cadastro)',
    legado: null,
  },
  agendaExameCancelado: {
    codigo: 'agenda.exame.cancelado',
    descricao: 'Exame cancelado com o motivo padronizado e quem pediu',
    legado: null,
  },
  agendaExameRemarcado: {
    codigo: 'agenda.exame.remarcado',
    descricao: 'Exame remarcado (marcação antiga e nova; transferência ou liberação do horário)',
    legado: null,
  },
  agendaGradeExameGerada: {
    codigo: 'agenda.gradeExame.gerada',
    descricao: 'Horários da agenda de exames gerados por período (agenda, período e quantidade)',
    legado: null,
  },
  agendaCoberturaExameDefinida: {
    codigo: 'agenda.coberturaExame.definida',
    descricao: 'Convênio da agenda de exames ou exame coberto incluído ou removido',
    legado: null,
  },
  agendaExameLido: {
    codigo: 'agenda.exame.lido',
    descricao: 'Marcação de exame aberta com o contato completo',
    legado: null,
  },
  cirurgiaSolicitada: {
    codigo: 'cirurgia.agenda.solicitada',
    descricao: 'Cirurgia solicitada (pedido de sala que ainda não ocupa a sala)',
    legado: null,
  },
  cirurgiaAgendada: {
    codigo: 'cirurgia.agenda.confirmada',
    descricao: 'Cirurgia agendada na sala (sala, horário, paciente e procedimento)',
    legado: null,
  },
  cirurgiaCancelada: {
    codigo: 'cirurgia.agenda.cancelada',
    descricao: 'Cirurgia cancelada ou suspensa com o motivo codificado e quem pediu',
    legado: null,
  },
  cirurgiaRemarcada: {
    codigo: 'cirurgia.agenda.remarcada',
    descricao: 'Cirurgia movida de sala ou de horário, com a justificativa',
    legado: null,
  },
  cirurgiaAndamento: {
    codigo: 'cirurgia.agenda.andamento',
    descricao: 'Andamento do agendamento marcado (no bloco, em sala, retomado)',
    legado: null,
  },
  cirurgiaExcecao: {
    codigo: 'cirurgia.agenda.excecao',
    descricao: 'Urgência autorizada em sala ocupada (exceção de sobreposição, com o supervisor)',
    legado: null,
  },
  cirurgiaPendencia: {
    codigo: 'cirurgia.pendencia.registrada',
    descricao: 'Pendência pré-operatória registrada ou resolvida',
    legado: null,
  },
  cirurgiaRegistrada: {
    codigo: 'cirurgia.registro.gravado',
    descricao: 'Ato cirúrgico registrado (procedimentos, equipe por função e tempos)',
    legado: null,
  },
  cirurgiaLigacaoRevisada: {
    codigo: 'cirurgia.ligacao.revisada',
    descricao: 'Ligação entre a cirurgia realizada e o agendamento revisada',
    legado: null,
  },
  cirurgiaSalaUsuario: {
    codigo: 'cirurgia.sala.usuario',
    descricao: 'Usuário permitido na sala cirúrgica concedido ou retirado',
    legado: null,
  },
  cirurgiaLida: {
    codigo: 'cirurgia.agenda.lida',
    descricao: 'Agendamento cirúrgico aberto com o nome completo do paciente',
    legado: null,
  },
  // M46 (etapa 1; ficha, regra 13): APA, ficha anestésica e SRPA. Só na trilha própria: o sistema anterior não
  // registra esses atos (as tabelas da ficha antiga estão vazias). Sem dado clínico: só os identificadores.
  apaRegistrada: {
    codigo: 'cirurgia.apa.registrada',
    descricao: 'Avaliação pré-anestésica registrada ou retificada (conclusão e pendência de APA)',
    legado: null,
  },
  fichaAnestesicaLancada: {
    codigo: 'cirurgia.fichaAnestesica.lancada',
    descricao: 'Lançamentos ou marcos de tempo gravados na ficha anestésica',
    legado: null,
  },
  fichaAnestesicaPassagem: {
    codigo: 'cirurgia.fichaAnestesica.passagem',
    descricao: 'Responsabilidade da anestesia transferida entre anestesistas',
    legado: null,
  },
  fichaAnestesicaAssinada: {
    codigo: 'cirurgia.fichaAnestesica.assinada',
    descricao: 'Ficha anestésica assinada pelo anestesista da cirurgia (FICHA_ANESTESICA_ASSINADA)',
    legado: null,
  },
  fichaAnestesicaAdendo: {
    codigo: 'cirurgia.fichaAnestesica.adendo',
    descricao: 'Adendo incluído na ficha anestésica já assinada',
    legado: null,
  },
  srpaRegistrada: {
    codigo: 'cirurgia.srpa.registrada',
    descricao: 'Admissão ou avaliação da recuperação pós-anestésica registrada',
    legado: null,
  },
  srpaAlta: {
    codigo: 'cirurgia.srpa.alta',
    descricao: 'Alta da recuperação pós-anestésica com o índice, a versão da regra e o destino',
    legado: null,
  },
  // M46 (etapa 2; ficha, regra 13): checklist de cirurgia segura, trava da incisão e rastreio no bloco. Só na trilha
  // própria (o sistema anterior não tem o checklist nem o rastreio em uso: as tabelas antigas estão vazias). Sem dado
  // clínico: só os identificadores, o momento e o código do item.
  checklistItensConfirmados: {
    codigo: 'cirurgia.checklist.itensConfirmados',
    descricao:
      'Itens do checklist de cirurgia segura confirmados pelo circulante (momento e itens, sem dado clínico)',
    legado: null,
  },
  checklistMomentoConcluido: {
    codigo: 'cirurgia.checklist.momentoConcluido',
    descricao:
      'Momento do checklist de cirurgia segura concluído (CHECKLIST_MOMENTO_CONCLUIDO: entrada, pausa cirúrgica ou saída)',
    legado: null,
  },
  incisaoExcecao: {
    codigo: 'cirurgia.incisao.excecao',
    descricao:
      'Exceção da trava da incisão registrada em urgência pelo supervisor, com o motivo (INCISAO_EXCECAO)',
    legado: null,
  },
  incisaoRecusada: {
    codigo: 'cirurgia.incisao.recusada',
    descricao: 'Incisão recusada pela trava (pausa cirúrgica não concluída nem exceção registrada)',
    legado: null,
  },
  pacienteMovidoBloco: {
    codigo: 'cirurgia.rastreio.movido',
    descricao: 'Movimentação do paciente no bloco registrada (entrada, mudança de local, saída, retorno)',
    legado: null,
  },
  quadroBlocoLido: {
    codigo: 'cirurgia.rastreio.lido',
    descricao:
      'Quadro do bloco, rastreio ou checklist consultados com o nome do paciente (leitura de prontuário)',
    legado: null,
  },
  // M46 (etapa 3; ficha, regra 13): OPME. Só na trilha própria (as tabelas antigas de OPME estão vazias e o controle
  // desligado no parâmetro); sem dado pessoal: os identificadores, o item, o lote ou a série e as quantidades.
  opmeSolicitado: {
    codigo: 'suprimentos.opme.solicitado',
    descricao: 'OPME solicitado para a cirurgia agendada (item, TUSS e quantidade)',
    legado: null,
  },
  opmeEtapa: {
    codigo: 'suprimentos.opme.etapa',
    descricao:
      'Etapa do OPME registrada (cotação, autorização ou negativa da operadora, pedido, consignação, CME, NF)',
    legado: null,
  },
  opmeConsumido: {
    codigo: 'suprimentos.opme.consumido',
    descricao: 'OPME consumido em sala com o rastreio por lote ou série e a etiqueta (OPME_CONSUMIDO)',
    legado: null,
  },
  opmeSemAutorizacao: {
    codigo: 'suprimentos.opme.semAutorizacao',
    descricao:
      'OPME consumido sem a autorização da operadora, pelo supervisor, com a justificativa (OPME_SEM_AUTORIZACAO)',
    legado: null,
  },
  opmeDevolvido: {
    codigo: 'suprimentos.opme.devolvido',
    descricao: 'OPME não usado devolvido ao estoque (o consumo e a quantidade)',
    legado: null,
  },
  opmeRastreioReverso: {
    codigo: 'suprimentos.opme.rastreioReverso',
    descricao:
      'Rastreio reverso de OPME consultado (lote ou série → pacientes expostos; leitura de prontuário)',
    legado: null,
  },
  opmeConsumoLido: {
    codigo: 'suprimentos.opme.lido',
    descricao: 'Consumo de OPME da cirurgia consultado com o nome do paciente (leitura de prontuário)',
    legado: null,
  },
  // M46 (etapa 4; ficha, regra 13): consignados e manipulação. Só na trilha própria; sem dado pessoal: os
  // identificadores, o fornecedor, o item, o lote e as quantidades.
  consignadoRemessa: {
    codigo: 'suprimentos.consignado.remessa',
    descricao:
      'Remessa de material em consignação registrada (fornecedor, item, quantidade e nota de remessa)',
    legado: null,
  },
  consignadoReposicao: {
    codigo: 'suprimentos.consignado.reposicao',
    descricao: 'Reposição pelo fornecedor do material consignado consumido em sala (os consumos ligados)',
    legado: null,
  },
  consignadoFaturamento: {
    codigo: 'suprimentos.consignado.faturamento',
    descricao: 'Faturamento do material consignado consumido ligado à nota fiscal da entrada do estoque',
    legado: null,
  },
  consignadoDevolucao: {
    codigo: 'suprimentos.consignado.devolucao',
    descricao: 'Devolução ao fornecedor do material consignado não usado (quantidade e motivo)',
    legado: null,
  },
  manipulacaoAberta: {
    codigo: 'suprimentos.manipulacao.aberta',
    descricao: 'Ordem de manipulação aberta para o item validado (capela, insumo, lote e validade da sobra)',
    legado: null,
  },
  manipulacaoConferida: {
    codigo: 'suprimentos.manipulacao.conferida',
    descricao: 'Dupla conferência da ordem de manipulação, aprovada ou reprovada (MANIPULACAO_CONFERIDA)',
    legado: null,
  },
  manipulacaoLida: {
    codigo: 'suprimentos.manipulacao.lida',
    descricao:
      'Itens a manipular e ordens de manipulação consultados com o nome do paciente (leitura de prontuário)',
    legado: null,
  },
  anestesiaLida: {
    codigo: 'cirurgia.anestesia.lida',
    descricao:
      'Avaliação pré-anestésica, ficha anestésica ou recuperação consultadas com os dados clínicos do paciente (leitura de prontuário)',
    legado: null,
  },
  // M20: atendimento externo e pronto atendimento. A abertura é registrada pelo Delphi na trilha dele (tipo 2,
  // criticidade 4; opção 5745 na recepção externa, 6104 no SADT: 4.310 de 4.275 fichas de 2026-06 a 2026-07, a
  // trilha dupla); a alteração da carteirinha na 5746 (tipo 3). Os demais (procedimento extra, encerramento, etapas e
  // observação do PA, impressos) ficam só na trilha própria (o Delphi não os registra: 0 eventos nessas opções).
  atendimentoAberto: {
    codigo: 'atendimento.atendimento.aberto',
    descricao: 'Atendimento externo aberto (ficha gravada; o cabeçalho e a conta criados pelo legado)',
    legado: { tipo: 2, criticidade: 4, opcao: 5745 },
  },
  atendimentoSeguradoAlterado: {
    codigo: 'atendimento.segurado.alterado',
    descricao: 'Carteirinha, guia, senha ou plano do convênio do atendimento alterados',
    legado: { tipo: 3, criticidade: 4, opcao: 5746 },
  },
  atendimentoProcedimentoLancado: {
    codigo: 'atendimento.procedimento.lancado',
    descricao: 'Procedimento extra lançado no atendimento (a conta conferida aberta antes)',
    legado: null,
  },
  atendimentoProcedimentoRecusado: {
    codigo: 'atendimento.procedimento.recusado',
    descricao:
      'Lançamento de procedimento recusado por conta fechada, apresentada ou emitida (aviso em vez do silêncio)',
    legado: null,
  },
  atendimentoEncerrado: {
    codigo: 'atendimento.atendimento.encerrado',
    descricao: 'Atendimento externo encerrado com o desfecho codificado (autor e hora)',
    legado: null,
  },
  atendimentoCancelado: {
    codigo: 'atendimento.atendimento.cancelado',
    descricao: 'Atendimento externo excluído pelo supervisor (motivo e justificativa)',
    legado: null,
  },
  atendimentoChamadoConsultorio: {
    codigo: 'atendimento.consultorio.chamado',
    descricao: 'Paciente chamado ao consultório pela fila do local',
    legado: null,
  },
  atendimentoAtendidoConsultorio: {
    codigo: 'atendimento.consultorio.atendido',
    descricao: 'Atendimento iniciado no consultório (o paciente chamado entrou)',
    legado: null,
  },
  atendimentoHerancaAlterada: {
    codigo: 'atendimento.heranca.alterada',
    descricao: 'Configuração do que a ficha nova copia do atendimento anterior alterada',
    legado: null,
  },
  atendimentoImpressoEmitido: {
    codigo: 'atendimento.impresso.emitido',
    descricao: 'Ficha, etiqueta ou pulseira do atendimento emitida (tipo, formato e cópias)',
    legado: null,
  },
  atendimentoNaoIdentificado: {
    codigo: 'atendimento.paciente.naoIdentificado',
    descricao: 'Paciente marcado como não identificado (emergência) ou a marca encerrada na identificação',
    legado: null,
  },
  atendimentoNaoIdentificadosLidos: {
    codigo: 'atendimento.paciente.naoIdentificadosLidos',
    descricao:
      'Lista dos pacientes não identificados lida (prontuário e as características físicas para a identificação)',
    legado: null,
  },
  paEtapaRegistrada: {
    codigo: 'pa.etapa.registrada',
    descricao: 'Etapa do paciente no pronto atendimento registrada (marca de tempo)',
    legado: null,
  },
  paObservacaoAlterada: {
    codigo: 'pa.observacao.alterada',
    descricao: 'Paciente posto ou tirado do leito ou poltrona de observação do pronto atendimento',
    legado: null,
  },
  // W0-07 (M1): o escore de deterioração e de sepse do PA estornado (o registro continua, marcado; só identificadores).
  paEscoreEstornado: {
    codigo: 'pa.escore.estornado',
    descricao:
      'Escore de deterioração do pronto atendimento (NEWS2, qSOFA e SIRS) estornado com o motivo e relançado',
    legado: null,
  },
  atendimentoLido: {
    codigo: 'atendimento.atendimento.lido',
    descricao: 'Ficha do atendimento externo aberta (segurado, conta e procedimentos)',
    legado: null,
  },
  atendimentoFilaLida: {
    codigo: 'atendimento.fila.lida',
    descricao: 'Fila do consultório ou quadro do pronto atendimento aberto (lista com nomes de pacientes)',
    legado: null,
  },
  // M26: SADT, laudos e portal. Trilha do legado medida (trilha de origem da cópia pc, 2026-06-01 a 2026-07-05, só
  // contagens): recebimento do pedido do prontuário na opção 6230 (tipo 3), lançamento direto por setor na de Incluir
  // do setor (6116 laboratório externo, 6161 internado; tipo 2) e inclusão de resultado de laboratório na 6211 (tipo
  // 2); as opções variam com o setor (a receita escolhe pela entrada). Liberação, emissão, orçamento, visualização no
  // portal, rastreio, crítico e portal: só na trilha própria (0 evento nas opções do legado ou recurso só do novo).
  sadtRequisicaoAberta: {
    codigo: 'sadt.requisicao.aberta',
    descricao: 'Requisição de exames aberta no atendimento (conta do setor com convênio e solicitante)',
    // A abertura do atendimento pelo setor (6104) já vai à trilha do legado na abertura da ficha (M20).
    legado: null,
  },
  sadtSolicitacaoRecebida: {
    codigo: 'sadt.solicitacao.recebida',
    descricao: 'Pedido de exame do prontuário recebido pelo setor (deixa de estar pendente)',
    legado: { tipo: 3, criticidade: 4, opcao: 6230 },
  },
  sadtExameLancado: {
    codigo: 'sadt.exame.lancado',
    descricao: 'Exame lançado direto no setor (quantidade e setor; o legado faz a pendência)',
    legado: { tipo: 2, criticidade: 4, opcao: 6116 },
  },
  sadtResultadoRegistrado: {
    codigo: 'sadt.resultado.registrado',
    descricao: 'Resultado do exame digitado (elementos, observações, variáveis) ou laudo escrito',
    legado: { tipo: 2, criticidade: 4, opcao: 6211 },
  },
  sadtResultadoLiberado: {
    codigo: 'sadt.resultado.liberado',
    descricao: 'Resultado liberado pelo responsável habilitado (versão guardada; crítico avisado)',
    legado: null,
  },
  sadtResultadoRetificado: {
    codigo: 'sadt.resultado.retificado',
    descricao: 'Resultado liberado retificado com motivo (versão anterior guardada; quem viu é avisado)',
    legado: null,
  },
  sadtLaudoEmitido: {
    codigo: 'sadt.laudo.emitido',
    descricao: 'Laudo emitido com código de autenticação (ou a 2ª via, com o motivo)',
    legado: null,
  },
  sadtOrcamentoCriado: {
    codigo: 'sadt.orcamento.criado',
    descricao: 'Orçamento particular de exames feito (setor, quantidade de exames e validade)',
    legado: null,
  },
  sadtOrcamentoConvertido: {
    codigo: 'sadt.orcamento.convertido',
    descricao: 'Orçamento convertido em lançamento no atendimento com os mesmos exames e valores',
    legado: null,
  },
  sadtPortalVisualizado: {
    codigo: 'sadt.portal.visualizado',
    descricao: 'Laudo visto ou baixado no portal de resultados (data e IP, como o portal do outro sistema)',
    legado: null,
  },
  sadtAmostraColetada: {
    codigo: 'sadt.amostra.coletada',
    descricao: 'Amostra coletada com o código único e a pulseira conferida; etiqueta na fila da estação',
    legado: null,
  },
  sadtAmostraMovimentada: {
    codigo: 'sadt.amostra.movimentada',
    descricao: 'Passagem de estado da amostra (transporte, recebida, em análise, rejeitada, recoleta)',
    legado: null,
  },
  sadtValorCriticoAlterado: {
    codigo: 'sadt.valorCritico.alterado',
    descricao: 'Faixa crítica de elemento incluída ou alterada (aprovação da diretoria clínica)',
    legado: null,
  },
  sadtAvisoCriticoEmitido: {
    codigo: 'sadt.avisoCritico.emitido',
    descricao: 'Aviso de valor crítico emitido ao responsável (liberação aqui ou no outro sistema)',
    legado: null,
  },
  sadtAvisoCriticoComunicado: {
    codigo: 'sadt.avisoCritico.comunicado',
    descricao: 'Comunicação do valor crítico registrada (canal e destinatário; a ciência fica no prontuário)',
    legado: null,
  },
  sadtAvisoCriticoEscalonado: {
    codigo: 'sadt.avisoCritico.escalonado',
    descricao: 'Aviso de valor crítico sem ciência no prazo subiu ao plantonista ou ao supervisor',
    legado: null,
  },
  sadtExamesLidos: {
    codigo: 'sadt.exames.lidos',
    descricao: 'Lista de exames, coleta, mapa de trabalho ou digitação aberta (lista com nomes de pacientes)',
    legado: null,
  },
  sadtPortalAcesso: {
    codigo: 'sadt.portal.acesso',
    descricao: 'Entrada no portal de resultados (paciente ou médico externo), aceita ou recusada',
    legado: null,
  },
  sadtAutocadastroDecidido: {
    codigo: 'sadt.autocadastro.decidido',
    descricao: 'Autocadastro de médico solicitante aprovado (ligado ao cadastro) ou recusado',
    legado: null,
  },
  // D-PROF-39: o profissional do corpo clínico incluído e alterado (o outro sistema não registra trilha nas opções
  // de profissionais: 0 evento das opções 3984 e 6390-6394 na trilha da cópia).
  cadastroProfissionalCadastrado: {
    codigo: 'cadastro.profissional.cadastrado',
    descricao: 'Profissional do corpo clínico incluído com o registro no conselho',
    legado: null,
  },
  cadastroProfissionalAlterado: {
    codigo: 'cadastro.profissional.alterado',
    descricao: 'Profissional do corpo clínico alterado (dados, registro, especialidade, lotação ou convênio)',
    legado: null,
  },
  cadastroProfissionalExcluido: {
    codigo: 'cadastro.profissional.excluido',
    descricao: 'Profissional cadastrado por engano excluído (sem nenhum vínculo; retrato guardado)',
    legado: null,
  },
  sadtSolicitanteCadastrado: {
    codigo: 'cadastro.solicitante.cadastrado',
    descricao: 'Médico solicitante externo cadastrado (conselho, UF e número)',
    legado: null,
  },
  // M27: filas de trabalho, mensagens internas, comunicados, central de avisos e dicionário pessoal. Só na trilha
  // própria: o outro sistema não registra a leitura das filas (são recurso novo) nem as mensagens do novo; o dicionário
  // não vai à trilha de origem no outro sistema (perfil da trilha de 2026-06-01 a 2026-07-05: 0 evento das palavras). O
  // conteúdo da mensagem nunca vai à trilha (regra 7): só o evento, o remetente e a contagem de destinatários.
  inicioWorklistMedicoLida: {
    codigo: 'pep.worklist.lida',
    descricao: 'Fila do médico aberta (lista de pacientes com vínculo; contagem e pendências)',
    legado: null,
  },
  inicioWorklistRecepcaoLida: {
    codigo: 'recepcao.worklist.lida',
    descricao: 'Fila da recepção aberta (senhas, chegadas e guias aguardando autorização)',
    legado: null,
  },
  mensagemEnviada: {
    codigo: 'acesso.mensagem.enviada',
    descricao: 'Mensagem interna enviada (destinatários e ciência obrigatória; nunca o texto)',
    legado: null,
  },
  mensagemLida: {
    codigo: 'acesso.mensagem.lida',
    descricao: 'Mensagem interna ou comunicado lido pelo destinatário',
    legado: null,
  },
  mensagemCiencia: {
    codigo: 'acesso.mensagem.ciencia',
    descricao: 'Ciência registrada numa mensagem ou num comunicado com ciência obrigatória',
    legado: null,
  },
  comunicadoPublicado: {
    codigo: 'acesso.comunicado.publicado',
    descricao: 'Comunicado publicado com vigência (destinatários; nunca o texto)',
    legado: null,
  },
  comunicadoCorrigido: {
    codigo: 'acesso.comunicado.corrigido',
    descricao:
      'Texto de comunicado ainda não lido corrigido, com motivo (nunca o texto; o anterior fica no evento)',
    legado: null,
  },
  comunicadoVigenciaEncurtada: {
    codigo: 'acesso.comunicado.vigenciaEncurtada',
    descricao: 'Vigência de comunicado encurtada, com motivo',
    legado: null,
  },
  comunicadoEncerrado: {
    codigo: 'acesso.comunicado.encerrado',
    descricao: 'Comunicado encerrado com motivo (o comunicado e as ciências continuam visíveis)',
    legado: null,
  },
  mensagemAnteriorLida: {
    codigo: 'acesso.mensagemAnterior.lida',
    descricao: 'Consulta das próprias mensagens do sistema anterior (contagem)',
    legado: null,
  },
  avisoEmitido: {
    codigo: 'acesso.aviso.emitido',
    descricao:
      'Aviso emitido para a central de um usuário (módulo e evento de origem; nunca dado do paciente)',
    legado: null,
  },
  avisoResolvido: {
    codigo: 'acesso.aviso.resolvido',
    descricao: 'Aviso da central marcado como lido ou resolvido',
    legado: null,
  },
  dicionarioPalavraIncluida: {
    codigo: 'acesso.dicionario.palavraIncluida',
    descricao: 'Palavra incluída no próprio dicionário ortográfico (o mesmo nos dois sistemas)',
    legado: null,
  },
  dicionarioPalavraExcluida: {
    codigo: 'acesso.dicionario.palavraExcluida',
    descricao: 'Palavra excluída do próprio dicionário ortográfico',
    legado: null,
  },
  // M21: internação, leitos, higienização e SAME. O Delphi registra na trilha dele a admissão (6057), a transferência
  // (6067), a alta (6071), a pré-internação (6063), as alterações (6075) e o cancelamento da alta (6074), tipo 2 ou 3
  // (perfil de trilha de origem desde 2026-06: 188, 172, 190, 55, 5 e 1 eventos): a trilha dupla. Os demais (guia,
  // higienização, SAME, alta médica, bloqueio do leito) ficam só na trilha própria (o Delphi não os registra).
  internacaoAdmitida: {
    codigo: 'internacao.internacao.admitida',
    descricao:
      'Paciente admitido no leito (a internação gravada; atendimento, conta, guia e período pelo legado)',
    legado: { tipo: 2, criticidade: 7, opcao: 6057 },
  },
  internacaoLeitoTransferido: {
    codigo: 'internacao.leito.transferido',
    descricao: 'Paciente internado transferido de leito (trecho fechado e aberto, a ocupação movida)',
    legado: { tipo: 2, criticidade: 7, opcao: 6067 },
  },
  internacaoAltaRegistrada: {
    codigo: 'internacao.alta.registrada',
    descricao: 'Saída do paciente (alta administrativa): o leito liberado e a limpeza solicitada',
    legado: { tipo: 2, criticidade: 7, opcao: 6071 },
  },
  internacaoAltaCancelada: {
    codigo: 'internacao.alta.cancelada',
    descricao: 'Alta cancelada pelo supervisor (a internação reaberta no mesmo leito)',
    legado: { tipo: 3, criticidade: 4, opcao: 6074 },
  },
  internacaoAltaMedica: {
    codigo: 'internacao.altaMedica.registrada',
    descricao: 'Alta médica decidida (motivo, destino e o médico) ou cancelada com o motivo',
    legado: null,
  },
  internacaoPreAgendada: {
    codigo: 'internacao.pre.agendada',
    descricao: 'Pré-internação agendada (data prevista ou "sem data")',
    legado: { tipo: 2, criticidade: 7, opcao: 6063 },
  },
  internacaoPreCorrigida: {
    codigo: 'internacao.pre.corrigida',
    descricao: 'Data prevista da pré-internação corrigida no saneamento',
    legado: null,
  },
  internacaoConvenioTrocado: {
    codigo: 'internacao.convenio.trocado',
    descricao: 'Convênio da internação trocado (o faturamento avisado para dividir a conta)',
    legado: { tipo: 3, criticidade: 7, opcao: 6075 },
  },
  internacaoClinicaTrocada: {
    codigo: 'internacao.clinica.trocada',
    descricao: 'Clínica da internação trocada',
    legado: { tipo: 3, criticidade: 7, opcao: 6075 },
  },
  internacaoEspecialidadeTrocada: {
    codigo: 'internacao.especialidade.trocada',
    descricao: 'Especialidade da internação trocada',
    legado: { tipo: 3, criticidade: 7, opcao: 6075 },
  },
  internacaoMedicoTrocado: {
    codigo: 'internacao.medico.trocado',
    descricao: 'Médico assistente da internação trocado',
    legado: { tipo: 3, criticidade: 7, opcao: 6075 },
  },
  internacaoGuiaRegistrada: {
    codigo: 'internacao.guia.registrada',
    descricao: 'Guia de autorização do convênio registrada na conta da internação',
    legado: null,
  },
  internacaoExcluida: {
    codigo: 'internacao.internacao.excluida',
    descricao: 'Internação aberta por engano excluída pelo supervisor (conta, guias e períodos apagados)',
    legado: null,
  },
  internacaoLida: {
    codigo: 'internacao.internacao.lida',
    descricao: 'Internação aberta com o nome do paciente (detalhe, trajetória, alta, impressos)',
    legado: null,
  },
  internacaoImpressoEmitido: {
    codigo: 'internacao.impresso.emitido',
    descricao: 'Ficha, etiqueta ou pulseira da internação emitida (tipo, formato e cópias)',
    legado: null,
  },
  leitosLeitoBloqueado: {
    codigo: 'leitos.leito.bloqueado',
    descricao: 'Leito bloqueado, em precaução ou extra no mapa do novo (ou o estado encerrado)',
    legado: null,
  },
  leitosAtributoAlterado: {
    codigo: 'leitos.atributo.alterado',
    descricao: 'Atributos do leito no novo alterados (andar, sexo, idades, criticidade, ramal)',
    legado: null,
  },
  leitosConflito: {
    codigo: 'leitos.leito.conflito',
    descricao: 'Leito bloqueado ou em higienização no novo ocupado pelo outro sistema (alerta à coordenação)',
    legado: null,
  },
  hotelariaLimpezaSolicitada: {
    codigo: 'hotelaria.limpeza.solicitada',
    descricao: 'Limpeza do leito solicitada (manual ou pelo QR code)',
    legado: null,
  },
  hotelariaLimpezaAvancada: {
    codigo: 'hotelaria.limpeza.avancada',
    descricao: 'Situação da execução da limpeza avançada no legado (1 para 2)',
    legado: null,
  },
  hotelariaLimpezaEtapa: {
    codigo: 'hotelaria.limpeza.etapa',
    descricao: 'Etapa da higienização registrada (atribuição, início, pausa, conclusão, inspeção, liberação)',
    legado: null,
  },
  hotelariaLeitoLiberado: {
    codigo: 'hotelaria.leito.liberado',
    descricao: 'Leito liberado depois da inspeção da limpeza',
    legado: null,
  },
  sameMovimentoRegistrado: {
    codigo: 'same.movimento.registrado',
    descricao: 'Movimentação física do prontuário ou da conta registrada (setor de origem e destino)',
    legado: null,
  },
  sameMovimentoExcluido: {
    codigo: 'same.movimento.excluido',
    descricao: 'Movimento do prontuário desfeito por exclusão lógica, com o motivo',
    legado: null,
  },
  sameProtocolo: {
    codigo: 'same.protocolo.registrado',
    descricao: 'Protocolo de remessa, aceite, cobrança de devolução ou ocorrência do SAME registrados',
    legado: null,
  },
  // M25: enfermagem beira-leito. O Delphi registra na trilha dele a checagem do horário na opção 5302 "Checar", tipo 3
  // (alteração), com o horário como alvo (perfil de trilha do sistema de origem: 58 eventos em 2026): a trilha dupla.
  // Os demais (aprazamento no novo, sinais vitais, infusão, conflitos, plantão, dispositivos) ficam só na trilha própria.
  enfermagemDoseChecada: {
    codigo: 'enfermagem.administracao.checada',
    descricao:
      'Administração checada no horário (administrado ou não administrado com o motivo), com a leitura da pulseira e da dose',
    legado: { tipo: 3, criticidade: 7, opcao: 5302 },
  },
  enfermagemChecagemEstornada: {
    codigo: 'enfermagem.administracao.estornada',
    descricao: 'Checagem estornada com a justificativa (o registro original fica guardado)',
    legado: null,
  },
  enfermagemHorarioAprazado: {
    codigo: 'enfermagem.horario.aprazado',
    descricao: 'Aprazamento proposto e confirmado, reaprazado ou suprimido com o motivo',
    legado: null,
  },
  enfermagemHorarioLido: {
    codigo: 'enfermagem.horario.lido',
    descricao: 'Leitura da linha do tempo, dos horários ou do histórico do paciente à beira do leito',
    legado: null,
  },
  // M40 (regra 6): o relatório de contingência do posto (pacientes, leito, alergias, prescrição vigente, horários e
  // os recursos que só existem no novo) gerado pela tela ou pela geração de cada hora; leitura de prontuário auditada.
  enfermagemContingenciaGerada: {
    codigo: 'enfermagem.contingencia.gerada',
    descricao:
      'Relatório de contingência do posto gerado (unidade e contagens; o PDF só no armazém de documentos, com o hash)',
    legado: null,
  },
  enfermagemContingenciaLida: {
    codigo: 'enfermagem.contingencia.lida',
    descricao:
      'Último relatório de contingência do posto baixado pela estação (unidade e contagens; o PDF relido do armazém)',
    legado: null,
  },
  enfermagemConflitoRegistrado: {
    codigo: 'enfermagem.conflito.registrado',
    descricao:
      'Ato feito sem rede chegou depois de suspensão ou checagem: conflito aberto (nada sobrescrito)',
    legado: null,
  },
  enfermagemConflitoResolvido: {
    codigo: 'enfermagem.conflito.resolvido',
    descricao: 'Conflito de sincronização resolvido pelo enfermeiro',
    legado: null,
  },
  enfermagemSinalRegistrado: {
    codigo: 'enfermagem.sinalVital.registrado',
    descricao: 'Sinal vital ou controle registrado (valor, unidade, método e hora real)',
    legado: null,
  },
  enfermagemAnotacaoRegistrada: {
    codigo: 'enfermagem.anotacao.registrada',
    descricao: 'Anotação simples de enfermagem feita sem rede e registrada na sincronização',
    legado: null,
  },
  enfermagemSinalRetificado: {
    codigo: 'enfermagem.sinalVital.retificado',
    descricao: 'Sinal vital retificado com a justificativa (versão nova; a anterior fica guardada)',
    legado: null,
  },
  enfermagemInfusaoEvento: {
    codigo: 'enfermagem.infusao.registrada',
    descricao:
      'Evento da infusão contínua (início, pausa, troca de bolsa, velocidade, fim) com o volume infundido',
    legado: null,
  },
  enfermagemPlantaoPassado: {
    codigo: 'enfermagem.plantao.passado',
    descricao: 'Plantão passado com as notas SBAR e as pendências herdadas (aguarda o aceite)',
    legado: null,
  },
  enfermagemPlantaoAceito: {
    codigo: 'enfermagem.plantao.aceito',
    descricao: 'Plantão aceito (ou recusado) por quem recebe: a responsabilidade passa com o aceite',
    legado: null,
  },
  enfermagemDispositivoAlterado: {
    codigo: 'enfermagem.dispositivo.alterado',
    descricao: 'Tablet ou coletor autorizado ou retirado do modo beira do leito',
    legado: null,
  },
  // W0-03 (programa CRUD completo): cancelamento, exclusão e estornos da enfermagem e da agência transfusional. O valor
  // clínico anterior fica na versão (ou no registro inativo), nunca na trilha.
  enfermagemPlantaoCancelado: {
    codigo: 'enfermagem.plantao.cancelado',
    descricao: 'Passagem de plantão cancelada por quem passou, com o motivo, antes do aceite',
    legado: null,
  },
  enfermagemDispositivoExcluido: {
    codigo: 'enfermagem.dispositivo.excluido',
    descricao:
      'Aparelho da beira do leito cadastrado por engano excluído (sem leitura vinculada; retrato guardado)',
    legado: null,
  },
  enfermagemReceitaInativada: {
    codigo: 'enfermagem.prescricaoMedicamento.inativada',
    descricao:
      'Receita do enfermeiro suspensa ou cancelada com o motivo e a senha (a original fica legível e inativa; a reemissão aponta a anterior)',
    legado: null,
  },
  enfermagemVacinaCorrigida: {
    codigo: 'enfermagem.vacina.corrigida',
    descricao:
      'Vacina aplicada estornada ou retificada com o motivo (registro local preservado; evento RIA de cancelamento ou substituição na fila de saída)',
    legado: null,
  },
  enfermagemRegistroEstornado: {
    codigo: 'enfermagem.registro.estornado',
    descricao:
      'Escore, classificação de pacientes ou índice de UTI estornado ou invalidado com o motivo (o original fica inativo e visível)',
    legado: null,
  },
  enfermagemProfilaxiaTevDecidida: {
    codigo: 'enfermagem.profilaxiaTev.decidida',
    descricao:
      'Profilaxia de TEV sugerida pelo escore de Caprini ou Padua decidida pelo prescritor (prescrita, ou não prescrita com o motivo)',
    legado: null,
  },
  enfermagemContencaoPrescrita: {
    codigo: 'enfermagem.contencao.prescrita',
    descricao:
      'Ordem de contenção mecânica prescrita ou renovada (ordem nova apontando a anterior), com a checagem periódica aprazada',
    legado: null,
  },
  enfermagemContencaoChecada: {
    codigo: 'enfermagem.contencao.checada',
    descricao:
      'Checagem periódica do paciente contido registrada no horário aprazado (perfusão, pele, posição e necessidades)',
    legado: null,
  },
  enfermagemContencaoEncerrada: {
    codigo: 'enfermagem.contencao.encerrada',
    descricao:
      'Contenção mecânica retirada, ou ordem inativada por lançamento errado (com o motivo; a ordem continua visível)',
    legado: null,
  },
  enfermagemProtocoloInternadoLido: {
    codigo: 'enfermagem.protocoloInternado.lido',
    descricao:
      'Relógio dos protocolos gerenciados do internado (unidade de internação ou UTI) ou os indicadores por origem consultados',
    legado: null,
  },
  enfermagemProtocoloInternadoIncluido: {
    codigo: 'enfermagem.protocoloInternado.incluido',
    descricao:
      'Paciente internado incluído num protocolo gerenciado (tipo, versão, local e origem: alerta do NEWS2 ou suspeita)',
    legado: null,
  },
  enfermagemProtocoloInternadoRegistrado: {
    codigo: 'enfermagem.protocoloInternado.registrado',
    descricao:
      'Meta, item do checklist ou encerramento do protocolo gerenciado do internado registrado (perdida com o motivo)',
    legado: null,
  },
  enfermagemLesaoLida: {
    codigo: 'enfermagem.lesao.lida',
    descricao:
      'Feridas e lesões por pressão da unidade, de uma lesão ou a incidência de LPP do período consultadas',
    legado: null,
  },
  enfermagemLesaoRegistrada: {
    codigo: 'enfermagem.lesao.registrada',
    descricao:
      'Lesão (ferida ou LPP) registrada, ou versão nova da ficha (rascunho do autor ou correção da finalizada com a justificativa)',
    legado: null,
  },
  enfermagemLesaoCurativo: {
    codigo: 'enfermagem.lesao.curativo',
    descricao:
      'Curativo da lesão registrado, ou corrigido pelo autor com a justificativa (o anterior fica legível)',
    legado: null,
  },
  enfermagemLesaoFoto: {
    codigo: 'enfermagem.lesao.foto',
    descricao: 'Foto da lesão vinculada (referência ao anexo de imagem do prontuário)',
    legado: null,
  },
  enfermagemLesaoEncerrada: {
    codigo: 'enfermagem.lesao.encerrada',
    descricao: 'Acompanhamento da lesão encerrado (desfecho e hora)',
    legado: null,
  },
  enfermagemLesaoInativada: {
    codigo: 'enfermagem.lesao.inativada',
    descricao:
      'Lesão, curativo ou foto inativados por lançamento errado (com o motivo e a senha; continuam visíveis, tachados)',
    legado: null,
  },
  enfermagemProtocoloInternadoInativado: {
    codigo: 'enfermagem.protocoloInternado.inativado',
    descricao:
      'Inclusão no protocolo gerenciado do internado inativada por engano (com o motivo e a senha; continua visível)',
    legado: null,
  },
  enfermagemContencaoLida: {
    codigo: 'enfermagem.contencao.lida',
    descricao: 'Contenções mecânicas da unidade, do paciente ou o indicador do período consultados',
    legado: null,
  },
  enfermagemContencaoVencidaAvisada: {
    codigo: 'enfermagem.contencao.vencidaAvisada',
    descricao:
      'Aviso da ordem de contenção vencida (sem retirada nem renovação) gravado na central de avisos',
    legado: null,
  },
  enfermagemTrrAcionado: {
    codigo: 'enfermagem.trr.acionado',
    descricao:
      'Time de Resposta Rápida acionado a partir do alerta do escore (com a hora do alerta) ou à mão, com o motivo',
    legado: null,
  },
  enfermagemTrrEvento: {
    codigo: 'enfermagem.trr.evento',
    descricao: 'Chegada do Time de Resposta Rápida ou desfecho do atendimento registrado',
    legado: null,
  },
  enfermagemPcrRegistrada: {
    codigo: 'enfermagem.pcr.registrada',
    descricao:
      'Ficha da parada cardiorrespiratória (Utstein) gravada: versão de rascunho do autor ou a finalizada',
    legado: null,
  },
  enfermagemTrrLido: {
    codigo: 'enfermagem.trr.lido',
    descricao:
      'Alertas, acionamentos do Time de Resposta Rápida, fichas de parada ou os indicadores consultados',
    legado: null,
  },
  // M34: relatórios do catálogo e integrações novas (só na trilha própria: o editor de relatórios e as interfaces do
  // legado não registram na trilha dele).
  relatorioExecutado: {
    codigo: 'relatorio.executado',
    descricao:
      'Relatório do catálogo emitido na tela (código, resumo dos parâmetros, linhas; com ou sem máscara)',
    legado: null,
  },
  relatorioExportado: {
    codigo: 'relatorio.exportado',
    descricao:
      'Relatório do catálogo exportado (formato; com dado de pessoa, a justificativa fica registrada)',
    legado: null,
  },
  relatorioTriagemDecidida: {
    codigo: 'relatorio.triagem.decidida',
    descricao: 'Destino de um relatório de SQL livre confirmado ou mudado na triagem',
    legado: null,
  },
  relatorioPedidoRegistrado: {
    codigo: 'relatorio.pedido.registrado',
    descricao: 'Pedido de relatório novo registrado, analisado, publicado ou recusado',
    legado: null,
  },
  relatorioAgendamentoAlterado: {
    codigo: 'relatorio.agendamento.alterado',
    descricao: 'Envio agendado de relatório criado, mudado, desativado ou enviado agora',
    legado: null,
  },
  integracaoParceiroAlterado: {
    codigo: 'integracao.parceiro.alterado',
    descricao:
      'Parceiro de integração nova cadastrado, mudado, ativado ou desativado (ou a credencial emitida)',
    legado: null,
  },
  // C2-037 (08-INTG L134): o arquivo da entrega ao parceiro leva dados pessoais e sensíveis de muitos pacientes.
  integracaoPacoteEntregaExportado: {
    codigo: 'integracao.pacote-entrega.exportado',
    descricao:
      'Arquivo da entrega ao parceiro baixado pelo operador (entrega, arquivo e SHA-256; nunca o conteúdo)',
    legado: null,
  },
  integracaoMortoTratado: {
    codigo: 'integracao.morto.tratado',
    descricao: 'Mensagem da fila de mortos reprocessada, corrigida ou descartada (com o motivo)',
    legado: null,
  },
  integracaoMensagemRecebida: {
    codigo: 'integracao.mensagem.recebida',
    descricao:
      'Mensagem de parceiro recebida pela entrada idempotente (chave do parceiro e resumo; nunca o conteúdo)',
    legado: null,
  },
  integracaoRetornoConferido: {
    codigo: 'integracao.retorno.conferido',
    descricao:
      'Resultado do laboratório de apoio conferido pelo responsável técnico (aprovado e gravado, ou recusado)',
    legado: null,
  },
  integracaoConfiguracaoAlterada: {
    codigo: 'integracao.configuracao.alterada',
    descricao: 'Canal HL7 v2 de parceiro ligado ou desligado, ou o recurso de teste enviado ao simulador',
    legado: null,
  },
  integracaoConsultaLida: {
    codigo: 'integracao.retorno.lido',
    descricao: 'Fila de retorno do laboratório de apoio aberta (lista com nomes de pacientes)',
    legado: null,
  },
  // M28: estoque, almoxarifado e compras. A trilha do legado dos documentos de estoque fica para o cenário controlado
  // (M36): os documentos de estoque do novo nascem desligados (D-MOTOR-28); por ora só a trilha própria.
  // M30: conta do paciente, lançamentos e auditoria de contas. A trilha do legado do fechamento é a do outro sistema
  // (nenhuma opção de trilha medida na conta); a trilha própria registra quem, quando e o quê.
  faturamentoContaFechada: {
    codigo: 'faturamento.conta.fechada',
    descricao:
      'Conta do paciente fechada (vetos e pré-voo conferidos; o gatilho da conta reescreve o procedimento)',
    legado: null,
  },
  faturamentoContaReaberta: {
    codigo: 'faturamento.conta.reaberta',
    descricao: 'Conta do paciente reaberta pelo supervisor, com o motivo',
    legado: null,
  },
  faturamentoItemConferido: {
    codigo: 'faturamento.item.conferido',
    descricao: 'Itens da conta conferidos (item a item ou em bloco)',
    legado: null,
  },
  faturamentoItemLancado: {
    codigo: 'faturamento.item.lancado',
    descricao: 'Item lançado à mão na conta (memória de cálculo no novo)',
    legado: null,
  },
  faturamentoPendenciaRegistrada: {
    codigo: 'faturamento.pendencia.registrada',
    descricao: 'Pendência da conta registrada ou resolvida',
    legado: null,
  },
  faturamentoEtapaRegistrada: {
    codigo: 'faturamento.etapa.registrada',
    descricao: 'Etapa da conta (conferência ou auditoria) iniciada ou concluída',
    legado: null,
  },
  faturamentoLancamentoTardioDecidido: {
    codigo: 'faturamento.lancamentoTardio.decidido',
    descricao: 'Lançamento feito depois do fechamento decidido (reabrir, complementar ou descartar)',
    legado: null,
  },
  faturamentoRegraEditada: {
    codigo: 'faturamento.regra.editada',
    descricao: 'Regra de faturabilidade incluída ou alterada',
    legado: null,
  },
  faturamentoPacoteEditado: {
    codigo: 'faturamento.pacote.editado',
    descricao: 'Pacote vigente do contrato incluído ou alterado',
    legado: null,
  },
  faturamentoAuditoriaRegistrada: {
    codigo: 'faturamento.auditoria.registrada',
    descricao: 'Parecer e versão da conta auditada registrados',
    legado: null,
  },
  faturamentoOrcamentoRegistrado: {
    codigo: 'faturamento.orcamento.registrado',
    descricao: 'Orçamento de particular registrado',
    legado: null,
  },
  faturamentoCaixaMovimentado: {
    codigo: 'faturamento.caixa.movimentado',
    descricao: 'Caixa do particular aberto ou fechado',
    legado: null,
  },
  faturamentoPagamentoRecebido: {
    codigo: 'faturamento.pagamento.recebido',
    descricao: 'Pagamento de particular recebido (dinheiro, Pix ou cartão)',
    legado: null,
  },
  faturamentoReciboEmitido: {
    codigo: 'faturamento.recibo.emitido',
    descricao: 'Recibo de particular emitido',
    legado: null,
  },
  faturamentoContasLidas: {
    codigo: 'faturamento.contas.lidas',
    descricao: 'Lista ou conta do paciente lida (leitura auditada)',
    legado: null,
  },
  faturamentoPrecoExplicado: {
    codigo: 'faturamento.preco.explicado',
    descricao: 'Preço de item explicado (somente leitura)',
    legado: null,
  },
  // M31: TISS, competência, demonstrativos, glosa e recurso. O outro sistema não tem trilha medida nessas telas (nem coluna
  // de usuário ou data no lote e no protocolo); a trilha própria e as tabelas SGH_ registram quem, quando e o quê.
  faturamentoLoteGerado: {
    codigo: 'faturamento.lote.gerado',
    descricao: 'Lote TISS 04.03.00 montado (XML validado no XSD e guardado com hash; numeração do contador)',
    legado: null,
  },
  faturamentoLoteEnviado: {
    codigo: 'faturamento.lote.enviado',
    descricao: 'Lote TISS enviado (à operadora em produção; ao simulador fora dela)',
    legado: null,
  },
  faturamentoProtocoloRegistrado: {
    codigo: 'faturamento.protocolo.registrado',
    descricao: 'Protocolo do lote registrado ou limpo (com data, autor, recibo e situação)',
    legado: null,
  },
  faturamentoGlosaBaixada: {
    codigo: 'faturamento.glosa.baixada',
    descricao: 'Retorno do item baixado (valor e quantidade pagos, motivo da glosa)',
    legado: null,
  },
  faturamentoRecursoRegistrado: {
    codigo: 'faturamento.recurso.registrado',
    descricao: 'Recurso de glosa registrado no item',
    legado: null,
  },
  faturamentoRecursoDesfecho: {
    codigo: 'faturamento.recurso.desfecho',
    descricao: 'Desfecho do recurso registrado (acatado, parcial ou negado)',
    legado: null,
  },
  faturamentoCompetenciaFechada: {
    codigo: 'faturamento.competencia.fechada',
    descricao: 'Competência do convênio fechada',
    legado: null,
  },
  faturamentoDemonstrativoImportado: {
    codigo: 'faturamento.demonstrativo.importado',
    descricao: 'Demonstrativo da operadora importado ou digitado (casado item a item)',
    legado: null,
  },
  faturamentoGlosaDecidida: {
    codigo: 'faturamento.glosa.decidida',
    descricao: 'Glosa decidida: aceita (motivo) ou recorrida (justificativa e evidência)',
    legado: null,
  },
  faturamentoEvidenciaLida: {
    codigo: 'faturamento.evidencia.lida',
    descricao: 'Evidência do prontuário lida para o recurso de glosa (leitura auditada)',
    legado: null,
  },
  integracaoEndpointTissEditado: {
    codigo: 'integracao.endpointTiss.editado',
    descricao: 'Endpoint TISS da operadora incluído ou alterado (referência ao cofre)',
    legado: null,
  },
  faturamentoGlosasLidas: {
    codigo: 'faturamento.glosas.lidas',
    descricao: 'Retorno e glosa de contas lidos (leitura auditada)',
    legado: null,
  },
  // M51 (regra 10): competência SUS, crítica e arquivos. Sem dado pessoal no payload (só competência, instrumento,
  // contagens e hash). O outro sistema não registra trilha nessas telas.
  faturamentoCompetenciaSusAberta: {
    codigo: 'faturamento.competenciaSus.aberta',
    descricao: 'Competência SUS aberta para um instrumento (CIHA, BPA, APAC ou AIH)',
    legado: null,
  },
  faturamentoCompetenciaSusFechada: {
    codigo: 'faturamento.competenciaSus.fechada',
    descricao: 'Competência SUS fechada (sem crítica bloqueante aberta)',
    legado: null,
  },
  faturamentoCompetenciaSusReaberta: {
    codigo: 'faturamento.competenciaSus.reaberta',
    descricao: 'Competência SUS reaberta pelo supervisor (com justificativa)',
    legado: null,
  },
  faturamentoCriticaSusExecutada: {
    codigo: 'faturamento.criticaSus.executada',
    descricao: 'Crítica prévia da competência SUS executada (contagens por regra)',
    legado: null,
  },
  faturamentoCriticaSusJustificada: {
    codigo: 'faturamento.criticaSus.justificada',
    descricao: 'Crítica de aviso da competência SUS justificada',
    legado: null,
  },
  faturamentoCihaGerada: {
    codigo: 'faturamento.ciha.gerada',
    descricao: 'Arquivo CIHA da competência gerado no leiaute do Ministério (com hash)',
    legado: null,
  },
  faturamentoArquivoSusBaixado: {
    codigo: 'faturamento.arquivoSus.baixado',
    descricao: 'Arquivo SUS exportado baixado (o envio é feito nos aplicativos do Ministério)',
    legado: null,
  },
  faturamentoEquivalenciaSusRegistrada: {
    codigo: 'faturamento.equivalenciaSus.registrada',
    descricao: 'Equivalência SIGTAP de um procedimento do hospital registrada para a CIHA',
    legado: null,
  },
  faturamentoEquivalenciaSusDesativada: {
    codigo: 'faturamento.equivalenciaSus.desativada',
    descricao: 'Equivalência SIGTAP de um procedimento do hospital desativada (a crítica volta na CIHA)',
    legado: null,
  },
  faturamentoSusLido: {
    codigo: 'faturamento.sus.lido',
    descricao:
      'Competências, críticas ou arquivos do faturamento SUS lidos (leitura auditada; sem dado pessoal)',
    legado: null,
  },
  faturamentoBpaGerado: {
    codigo: 'faturamento.bpa.gerado',
    descricao: 'BPA-C e BPA-I da competência gerados (BPA-Mag)',
    legado: null,
  },
  faturamentoApacRegistrada: {
    codigo: 'faturamento.apac.registrada',
    descricao: 'APAC registrada (laudo, autorização, negativa, continuidade, encerramento ou cancelamento)',
    legado: null,
  },
  faturamentoApacGerada: {
    codigo: 'faturamento.apac.gerada',
    descricao: 'Arquivo APAC-Mag da competência gerado (com hash)',
    legado: null,
  },
  faturamentoAihRegistrada: {
    codigo: 'faturamento.aih.registrada',
    descricao: 'AIH registrada (laudo autorizado, procedimentos e diárias)',
    legado: null,
  },
  faturamentoRetornoSusImportado: {
    codigo: 'faturamento.retornoSus.importado',
    descricao: 'Espelho ou retorno do gestor SUS importado',
    legado: null,
  },
  // M51 (etapa 4): a faixa numérica de AIH, o SISAIH01 da competência e a decisão sobre o retorno do gestor (sem dado
  // pessoal: números, competência, contagens e hash).
  faturamentoFaixaAihRegistrada: {
    codigo: 'faturamento.faixaAih.registrada',
    descricao: 'Faixa numérica de AIH liberada pelo gestor registrada ou cancelada',
    legado: null,
  },
  faturamentoSisaihGerado: {
    codigo: 'faturamento.sisaih.gerado',
    descricao: 'Arquivo SISAIH01 da competência gerado (AIHs fechadas, com hash)',
    legado: null,
  },
  faturamentoRetornoSusTratado: {
    codigo: 'faturamento.retornoSus.tratado',
    descricao: 'Retorno do gestor SUS tratado (reapresentação ou glosa aceita, com justificativa)',
    legado: null,
  },
  suprimentosSaidaRegistrada: {
    codigo: 'suprimentos.saida.registrada',
    descricao:
      'Saída de estoque registrada e consolidada (setor, paciente ou terceiro; o valor é do gatilho)',
    legado: null,
  },
  suprimentosRequisicaoCriada: {
    codigo: 'suprimentos.requisicao.criada',
    descricao: 'Requisição de material do setor ao estoque',
    legado: null,
  },
  suprimentosRequisicaoAutorizada: {
    codigo: 'suprimentos.requisicao.autorizada',
    descricao: 'Requisição autorizada pelo responsável do setor',
    legado: null,
  },
  suprimentosDevolucaoRegistrada: {
    codigo: 'suprimentos.devolucao.registrada',
    descricao: 'Devolução ao estoque registrada (estorno do consumo e da conta pelo gatilho)',
    legado: null,
  },
  suprimentosTransferenciaEnviada: {
    codigo: 'suprimentos.transferencia.enviada',
    descricao: 'Transferência enviada entre locais (o saldo fica na origem até o recebimento)',
    legado: null,
  },
  suprimentosTransferenciaRecebida: {
    codigo: 'suprimentos.transferencia.recebida',
    descricao: 'Transferência recebida (documento consolidado; divergência registrada)',
    legado: null,
  },
  suprimentosNotaRegistrada: {
    codigo: 'suprimentos.nota.registrada',
    descricao: 'Entrada por nota fiscal registrada (lotes, validade e conferência)',
    legado: null,
  },
  suprimentosPedidoCriado: {
    codigo: 'suprimentos.pedido.criado',
    descricao: 'Pedido de compra criado (itens e fornecedores convidados)',
    legado: null,
  },
  suprimentosPropostaRegistrada: {
    codigo: 'suprimentos.proposta.registrada',
    descricao: 'Proposta de fornecedor registrada no mapa de cotação',
    legado: null,
  },
  suprimentosVencedorDefinido: {
    codigo: 'suprimentos.vencedor.definido',
    descricao: 'Vencedor da cotação escolhido (autor, alçada e justificativa)',
    legado: null,
  },
  suprimentosPedidoAprovado: {
    codigo: 'suprimentos.pedido.aprovado',
    descricao: 'Pedido de compra aprovado ou reprovado pela alçada',
    legado: null,
  },
  suprimentosMovimentoDireto: {
    codigo: 'suprimentos.movimento.registrado',
    descricao: 'Movimento direto ao paciente ou ao centro de custo',
    legado: null,
  },
  suprimentosBalancoRegistrado: {
    codigo: 'suprimentos.balanco.registrado',
    descricao: 'Ajuste de inventário gravado como balanço',
    legado: null,
  },
  suprimentosInventarioAberto: {
    codigo: 'suprimentos.inventario.aberto',
    descricao: 'Inventário aberto (geral ou cíclico)',
    legado: null,
  },
  suprimentosContagemRegistrada: {
    codigo: 'suprimentos.contagem.registrada',
    descricao: 'Contagem cega registrada no inventário',
    legado: null,
  },
  suprimentosInventarioDecidido: {
    codigo: 'suprimentos.inventario.decidido',
    descricao: 'Inventário aprovado ou cancelado pelo supervisor',
    legado: null,
  },
  suprimentosMesFechado: {
    codigo: 'suprimentos.mes.fechado',
    descricao: 'Mês do estoque fechado',
    legado: null,
  },
  suprimentosMesReaberto: {
    codigo: 'suprimentos.mes.reaberto',
    descricao: 'Mês do estoque reaberto com motivo',
    legado: null,
  },
  suprimentosKitReposto: {
    codigo: 'suprimentos.kit.reposto',
    descricao: 'Carrinho de parada reposto e conferido (lacre e checklist)',
    legado: null,
  },
  suprimentosDocumentoDesconsolidado: {
    codigo: 'suprimentos.documento.desconsolidado',
    descricao: 'Documento de estoque desconsolidado com motivo',
    legado: null,
  },
  suprimentosValidadeCorrigida: {
    codigo: 'suprimentos.validade.corrigida',
    descricao: 'Validade de lote corrigida no saneamento',
    legado: null,
  },
  suprimentosPontoPedidoDefinido: {
    codigo: 'suprimentos.pontoPedido.definido',
    descricao: 'Prazo e estoque de segurança do item no local definidos',
    legado: null,
  },
  suprimentosLoteRastreado: {
    codigo: 'suprimentos.lote.rastreado',
    descricao: 'Rastreio de lote lido (lista pacientes)',
    legado: null,
  },
  suprimentosDocumentosLidos: {
    codigo: 'suprimentos.documento.lido',
    descricao: 'Documento ou lista de documentos de estoque lida com pacientes',
    legado: null,
  },
  // M29: farmácia hospitalar, dispensação e farmácia clínica. A dispensação e a devolução de dose nascem desligadas
  // (D-MOTOR-28 herdado); as leituras que listam pacientes (fila, entregas, avaliação, controlados) são auditadas.
  suprimentosDoseDispensada: {
    codigo: 'suprimentos.dose.dispensada',
    descricao: 'Doses dispensadas da fila por horário (saída de estoque consolidada; etiqueta de dose)',
    legado: null,
  },
  suprimentosEntregaConfirmada: {
    codigo: 'suprimentos.entrega.confirmada',
    descricao: 'Aceite da entrega da dose pela enfermagem (leitura da etiqueta ou confirmação no tablet)',
    legado: null,
  },
  suprimentosDoseDevolvida: {
    codigo: 'suprimentos.dose.devolvida',
    descricao: 'Dose não administrada devolvida ao estoque (estorno da saída e da conta pelos gatilhos)',
    legado: null,
  },
  suprimentosDispensacaoCancelada: {
    codigo: 'suprimentos.dispensacao.cancelada',
    descricao: 'Dose dispensada e não entregue cancelada (item suspenso ou corrigido)',
    legado: null,
  },
  suprimentosPrescricaoAvaliada: {
    codigo: 'suprimentos.prescricao.avaliada',
    descricao: 'Avaliação farmacêutica do item da prescrição (decisão do farmacêutico)',
    legado: null,
  },
  suprimentosIntervencaoRegistrada: {
    codigo: 'suprimentos.intervencao.registrada',
    descricao: 'Intervenção farmacêutica registrada ao prescritor',
    legado: null,
  },
  suprimentosIntervencaoRespondida: {
    codigo: 'suprimentos.intervencao.respondida',
    descricao: 'Intervenção farmacêutica respondida pelo prescritor (aceita ou recusada)',
    legado: null,
  },
  suprimentosControladoConferido: {
    codigo: 'suprimentos.controlado.conferido',
    descricao: 'Dupla conferência de medicamento controlado (reautenticação)',
    legado: null,
  },
  suprimentosPerdaControlado: {
    codigo: 'suprimentos.controlado.perda',
    descricao: 'Perda ou descarte de controlado com testemunha',
    legado: null,
  },
  suprimentosLivroFechado: {
    codigo: 'suprimentos.livro.fechado',
    descricao: 'Período do livro de controlados fechado pelo farmacêutico responsável',
    legado: null,
  },
  suprimentosAmbulatorialDispensado: {
    codigo: 'suprimentos.ambulatorial.dispensado',
    descricao: 'Dispensação na farmácia ambulatorial (SNGPC; sem baixa no estoque do hospital)',
    legado: null,
  },
  suprimentosSngpcEscriturado: {
    codigo: 'suprimentos.sngpc.escriturado',
    descricao: 'Escrituração e lote de envio do SNGPC gerados',
    legado: null,
  },
  suprimentosFilaDispensacaoLida: {
    codigo: 'suprimentos.dispensacao.lida',
    descricao: 'Fila de dispensação ou dispensações lidas (lista pacientes)',
    legado: null,
  },
  suprimentosEntregasLidas: {
    codigo: 'suprimentos.entrega.lida',
    descricao: 'Entregas ao setor lidas (lista pacientes)',
    legado: null,
  },
  suprimentosAvaliacaoLida: {
    codigo: 'suprimentos.avaliacao.lida',
    descricao: 'Fila de avaliação farmacêutica lida (lista pacientes)',
    legado: null,
  },
  suprimentosControladosLidos: {
    codigo: 'suprimentos.controlado.lido',
    descricao: 'Movimentos de controlados lidos (prescritores e documentos)',
    legado: null,
  },
  // M44 (etapa 1; ficha, regra 15): classificação de risco no PA. Só na trilha própria: o sistema anterior não tem
  // evento de classificação (a gravação no formulário do prontuário vai à trilha dele pelo registro clínico do M22,
  // a trilha dupla). Nenhum dado clínico no payload: atendimento, versão do protocolo, cor e motivo.
  classificacaoConcluida: {
    codigo: 'recepcao.classificacao.concluida',
    descricao: 'Classificação de risco concluída (cor, versão do protocolo e prazo)',
    legado: null,
  },
  classificacaoCorSobreposta: {
    codigo: 'recepcao.classificacao.corSobreposta',
    descricao: 'Cor final diferente da proposta pelo protocolo (com a justificativa)',
    legado: null,
  },
  classificacaoReclassificada: {
    codigo: 'recepcao.classificacao.reclassificada',
    descricao: 'Reclassificação de risco (estouro do tempo-alvo ou mudança do quadro)',
    legado: null,
  },
  classificacaoEstourada: {
    codigo: 'recepcao.classificacao.estourada',
    descricao: 'Tempo-alvo estourado sem atendimento médico: aviso e reclassificação obrigatória',
    legado: null,
  },
  classificacaoProtocoloPublicado: {
    codigo: 'recepcao.protocolo.publicado',
    descricao: 'Versão do protocolo de classificação publicada (autor, aprovador e licença)',
    legado: null,
  },
  // M44 (etapa 2; ficha, regra 15): o NIR. Só na trilha própria (o sistema anterior não registra a fila de leitos: as
  // tabelas de solicitação e reserva dele estão vazias); a admissão e a transferência vindas do NIR vão à trilha dupla
  // pelas operações do M21. Sem dado pessoal no payload: solicitação, estado, prioridade, leito pela chave.
  nirSolicitacaoCriada: {
    codigo: 'internacao.solicitacaoLeito.criada',
    descricao: 'Solicitação de leito registrada (origem, prioridade e perfil exigido)',
    legado: null,
  },
  nirSolicitacaoTransicao: {
    codigo: 'internacao.solicitacaoLeito.transicao',
    descricao: 'Solicitação de leito mudou de estado ou de prioridade na fila do NIR (com o motivo)',
    legado: null,
  },
  nirReservaRegistrada: {
    codigo: 'internacao.reservaLeito.registrada',
    descricao: 'Leito reservado para a solicitação (validade e, se houver, a exceção ao perfil)',
    legado: null,
  },
  nirReservaConfirmada: {
    codigo: 'internacao.reservaLeito.confirmada',
    descricao: 'Reserva de leito confirmada pelo setor de destino',
    legado: null,
  },
  nirReservaCancelada: {
    codigo: 'internacao.reservaLeito.cancelada',
    descricao: 'Reserva de leito cancelada com o motivo (a solicitação volta à análise)',
    legado: null,
  },
  nirReservaExpirada: {
    codigo: 'internacao.reservaLeito.expirada',
    descricao: 'Reserva de leito expirada pelo prazo de validade (o leito volta a livre)',
    legado: null,
  },
  nirReservaConflito: {
    codigo: 'internacao.reservaLeito.conflito',
    descricao: 'Leito reservado no novo ocupado pelo outro sistema (alerta ao NIR)',
    legado: null,
  },
  nirDpaAlterada: {
    codigo: 'internacao.altaPrevista.alterada',
    descricao: 'Data provável de alta registrada ou mudada (com o motivo da mudança)',
    legado: null,
  },
  nirBarreiraRegistrada: {
    codigo: 'internacao.barreiraAlta.registrada',
    descricao: 'Barreira de alta registrada (tipo, responsável e prazo)',
    legado: null,
  },
  nirBarreiraResolvida: {
    codigo: 'internacao.barreiraAlta.resolvida',
    descricao: 'Barreira de alta resolvida ou cancelada',
    legado: null,
  },
  nirLimiteDefinido: {
    codigo: 'internacao.limitePermanencia.definido',
    descricao: 'Limite de permanência (amarelo e vermelho) definido por clínica, CID ou procedimento',
    legado: null,
  },
  nirDeparaAprovado: {
    codigo: 'internacao.situacaoRegulacao.aprovada',
    descricao: 'De-para da situação de regulação do sistema anterior para o estado do NIR aprovado',
    legado: null,
  },
  nirFilaLida: {
    codigo: 'internacao.solicitacaoLeito.lida',
    descricao: 'Fila do NIR ou quadro de permanência lido (lista com nomes de pacientes)',
    legado: null,
  },
  // M44 (etapa 3; ficha, regra 15): protocolos gerenciados e regulação estadual. Só na trilha própria (o sistema anterior
  // não tem protocolo gerenciado nem registra a regulação na fila de leitos). Sem dado pessoal no payload: atendimento,
  // tipo do protocolo, meta, situação, central e solicitação.
  protocoloGerenciadoPublicado: {
    codigo: 'recepcao.protocoloGerenciado.publicado',
    descricao:
      'Versão da definição do protocolo gerenciado publicada (critérios, metas e checklist; autor e aprovador)',
    legado: null,
  },
  protocoloPacienteIniciado: {
    codigo: 'recepcao.protocoloPaciente.iniciado',
    descricao: 'Paciente do PA incluído num protocolo gerenciado (tipo, versão e origem da inclusão)',
    legado: null,
  },
  protocoloPacienteMetaRegistrada: {
    codigo: 'recepcao.protocoloPaciente.metaRegistrada',
    descricao:
      'Meta ou item do checklist do protocolo gerenciado registrado (cumprida ou perdida com o motivo)',
    legado: null,
  },
  protocoloPacienteEncerrado: {
    codigo: 'recepcao.protocoloPaciente.encerrado',
    descricao: 'Protocolo gerenciado do paciente encerrado (desfecho)',
    legado: null,
  },
  protocoloPacienteLido: {
    codigo: 'recepcao.protocoloPaciente.lido',
    descricao: 'Relógio dos protocolos gerenciados lido (lista com nomes de pacientes)',
    legado: null,
  },
  regulacaoRegistrada: {
    codigo: 'internacao.regulacao.registrada',
    descricao:
      'Número ou situação da regulação estadual registrado na solicitação de leito (manual ou pelo conector)',
    legado: null,
  },
  // M56.2 (operadora própria, F1): empresa, produto, contrato e beneficiário em SGH_OPE_* (só na trilha própria: o
  // sistema anterior não tem a operadora); a lista e a ficha do beneficiário e a elegibilidade são leituras auditadas.
  operadoraEmpresaGravada: {
    codigo: 'operadora.empresa.gravada',
    descricao: 'Operadora própria incluída ou alterada (registro na ANS, CNPJ, modalidade)',
    legado: null,
  },
  operadoraProdutoGravado: {
    codigo: 'operadora.produto.gravado',
    descricao: 'Produto ou plano da operadora incluído ou alterado (registro na ANS, carências, preços)',
    legado: null,
  },
  operadoraContratoGravado: {
    codigo: 'operadora.contrato.gravado',
    descricao: 'Contrato da operadora (pessoa física ou jurídica) incluído ou alterado',
    legado: null,
  },
  operadoraBeneficiarioGravado: {
    codigo: 'operadora.beneficiario.gravado',
    descricao: 'Beneficiário da operadora incluído, alterado, excluído ou reativado',
    legado: null,
  },
  operadoraCarteirinhaEmitida: {
    codigo: 'operadora.carteirinha.emitida',
    descricao: 'Carteirinha do beneficiário emitida (primeira ou segunda via, com o motivo)',
    legado: null,
  },
  operadoraBeneficiarioLido: {
    codigo: 'operadora.beneficiario.lido',
    descricao: 'Lista, ficha ou elegibilidade de beneficiário da operadora lida (dado pessoal)',
    legado: null,
  },
  operadoraContratoLido: {
    codigo: 'operadora.contrato.lido',
    descricao: 'Contrato da operadora lido com o documento do contratante (dado pessoal)',
    legado: null,
  },
  // M52.1 (gestão de pessoas, F1): o vínculo, o histórico, os dependentes e a validade do conselho em SGH_PES_* (só na
  // trilha própria); o bloqueio do acesso no desligamento vai pela receita do M10 (trilha de origem e trilha própria dela). A
  // ficha (CPF mascarado, dependentes) e a prévia pelo CPF são leituras auditadas de dado pessoal.
  pessoasColaboradorAdmitido: {
    codigo: 'pessoas.colaborador.admitido',
    descricao: 'Colaborador admitido (vínculo de trabalho, lotação e a linha de admissão do histórico)',
    legado: null,
  },
  pessoasColaboradorAlterado: {
    codigo: 'pessoas.colaborador.alterado',
    descricao: 'Mudança funcional do colaborador (cargo, função, jornada ou lotação) registrada no histórico',
    legado: null,
  },
  pessoasColaboradorDesligado: {
    codigo: 'pessoas.colaborador.desligado',
    descricao: 'Colaborador desligado (data, tipo de rescisão e motivo; o acesso bloqueado no mesmo dia)',
    legado: null,
  },
  pessoasDependenteIncluido: {
    codigo: 'pessoas.dependente.incluido',
    descricao: 'Dependente do colaborador incluído',
    legado: null,
  },
  pessoasDependenteEncerrado: {
    codigo: 'pessoas.dependente.encerrado',
    descricao: 'Dependente do colaborador encerrado (data do fim e motivo; nunca apagado)',
    legado: null,
  },
  // W0-06, parte 3a: correção cadastral do colaborador e alteração do dependente com versão (motivo e valor anterior).
  pessoasColaboradorCorrigido: {
    codigo: 'pessoas.colaborador.corrigido',
    descricao:
      'Cadastro do colaborador corrigido com motivo (nome, matrícula, tipo de vínculo ou admissão; o valor anterior fica guardado)',
    legado: null,
  },
  pessoasColaboradorCargoLigado: {
    codigo: 'pessoas.colaborador.cargo_ligado',
    descricao:
      'Cargo do quadro de cargos e salários ligado ao colaborador (ou desligado) com motivo; o valor anterior fica guardado',
    legado: null,
  },
  pessoasDependenteAlterado: {
    codigo: 'pessoas.dependente.alterado',
    descricao:
      'Dependente alterado com motivo em versão nova a partir de uma data (a versão anterior fica guardada)',
    legado: null,
  },
  pessoasHabilitacaoRegistrada: {
    codigo: 'pessoas.habilitacao.registrada',
    descricao: 'Validade do registro no conselho conferida pelo RH',
    legado: null,
  },
  pessoasColaboradorLido: {
    codigo: 'pessoas.colaborador.lido',
    descricao: 'Ficha do colaborador ou prévia da admissão pelo CPF lida (dado pessoal)',
    legado: null,
  },
  // M52.2 (gestão de pessoas, F2): regimes, escala e plantões em SGH_PES_* (só na trilha própria). A mudança de escala
  // publicada leva o motivo na trilha e no evento da escala (regra 8).
  pessoasRegimeGravado: {
    codigo: 'pessoas.regime.gravado',
    descricao: 'Modelo de regime e jornada incluído ou alterado',
    legado: null,
  },
  pessoasRegimeAtribuido: {
    codigo: 'pessoas.regime.atribuido',
    descricao: 'Regime do colaborador atribuído a partir de uma data (a vigência anterior fica)',
    legado: null,
  },
  pessoasEscalaCriada: {
    codigo: 'pessoas.escala.criada',
    descricao: 'Escala do setor criada para a competência (ou a cobertura mínima alterada)',
    legado: null,
  },
  pessoasPlantaoGravado: {
    codigo: 'pessoas.plantao.gravado',
    descricao: 'Plantão incluído, alterado ou cancelado na escala (na escala publicada, com o motivo)',
    legado: null,
  },
  pessoasEscalaPublicada: {
    codigo: 'pessoas.escala.publicada',
    descricao: 'Escala do setor publicada (com a justificativa do furo de cobertura, se houver)',
    legado: null,
  },
  // W0-06 (programa CRUD completo): exclusão do rascunho (com retrato), cancelamento da publicada e anulação da
  // vigência do regime, todos com motivo; a desistência do ajuste de ponto pelo próprio solicitante.
  pessoasEscalaExcluida: {
    codigo: 'pessoas.escala.excluida',
    descricao:
      'Escala em rascunho criada por engano excluída sem vínculo (o retrato de cada linha fica guardado)',
    legado: null,
  },
  pessoasEscalaCancelada: {
    codigo: 'pessoas.escala.cancelada',
    descricao: 'Escala publicada cancelada com motivo (os plantões previstos ficam cancelados)',
    legado: null,
  },
  pessoasRegimeVigenciaAnulada: {
    codigo: 'pessoas.regime.vigencia_anulada',
    descricao: 'Vigência de regime do colaborador lançada por engano anulada com motivo (fica no histórico)',
    legado: null,
  },
  pessoasAjustePontoDesistido: {
    codigo: 'pessoas.ponto.ajuste_desistido',
    descricao: 'Ajuste de ponto pendente retirado pelo próprio solicitante, com motivo',
    legado: null,
  },
  // M52.5 (gestão de pessoas, F5: SESMT): o prontuário ocupacional, as vacinas, os acidentes, o mapa de riscos e as
  // entregas de EPI em SGH_PES_* (só na trilha própria). As leituras do prontuário ocupacional, da carteira de vacinas,
  // do acidente e das exposições são leituras auditadas de dado de saúde do colaborador (regra 16).
  pessoasAsoRegistrado: {
    codigo: 'pessoas.aso.registrado',
    descricao: 'ASO e exames do PCMSO registrados ou retificados no prontuário ocupacional',
    legado: null,
  },
  pessoasVacinaRegistrada: {
    codigo: 'pessoas.vacina.registrada',
    descricao: 'Dose de vacina ou anti-HBs do colaborador registrado ou retificado',
    legado: null,
  },
  pessoasAcidenteRegistrado: {
    codigo: 'pessoas.acidente.registrado',
    descricao: 'Acidente de trabalho registrado, com o prazo da CAT e os marcos da sorologia',
    legado: null,
  },
  pessoasAcidenteAtualizado: {
    codigo: 'pessoas.acidente.atualizado',
    descricao: 'Acidente de trabalho: profilaxia, sorologia, emissão da CAT ou encerramento',
    legado: null,
  },
  pessoasRiscoAlterado: {
    codigo: 'pessoas.risco.alterado',
    descricao: 'Mapa de riscos por função: fator de risco ou EPI exigido incluído ou encerrado',
    legado: null,
  },
  pessoasEpiRegistrado: {
    codigo: 'pessoas.epi.registrado',
    descricao: 'Entrega de EPI (ou a assinatura dela), leitura do dosímetro ou exposição a quimioterápico',
    legado: null,
  },
  // W0-06, parte 3b: retificação e anulação do acidente e da CAT (o S-2210 retificador ou o S-3000 na fila do eSocial)
  // e cancelamento da entrega de EPI, todos com motivo e o valor anterior guardado.
  pessoasAcidenteRetificado: {
    codigo: 'pessoas.acidente.retificado',
    descricao:
      'Acidente de trabalho e CAT retificados com motivo (o valor anterior fica guardado; o S-2210 aceito ganha o retificador na fila do eSocial)',
    legado: null,
  },
  pessoasAcidenteAnulado: {
    codigo: 'pessoas.acidente.anulado',
    descricao:
      'Acidente de trabalho lançado por engano anulado com motivo (nunca apagado; o S-2210 aceito ganha o S-3000 na fila do eSocial)',
    legado: null,
  },
  pessoasEpiCancelado: {
    codigo: 'pessoas.epi.cancelado',
    descricao: 'Entrega de EPI, leitura do dosímetro ou exposição cancelada com motivo (nunca apagada)',
    legado: null,
  },
  // W0-06, parte 4 (M1 de mercado): cargos, tabela salarial e quadro de vagas.
  pessoasCargoGravado: {
    codigo: 'pessoas.cargo.gravado',
    descricao:
      'Cargo incluído ou alterado com motivo (CBO, requisitos, conselho; o valor anterior fica guardado), inativado, reativado ou excluído sem vínculo',
    legado: null,
  },
  pessoasFaixaSalarialGravada: {
    codigo: 'pessoas.faixa_salarial.gravada',
    descricao:
      'Faixa da tabela salarial incluída, alterada por versão a partir de uma data, inativada, reativada ou excluída sem versão',
    legado: null,
  },
  pessoasVagaGravada: {
    codigo: 'pessoas.vaga.gravada',
    descricao:
      'Vaga do quadro aprovado por centro de custo incluída, alterada por versão a partir de uma data, inativada, reativada ou excluída sem versão',
    legado: null,
  },
  // W0-06, parte 5 (M2 de mercado): avaliação de desempenho, competências e PDI.
  pessoasCompetenciaGravada: {
    codigo: 'pessoas.competencia.gravada',
    descricao:
      'Competência incluída, alterada com motivo (o valor anterior fica guardado), inativada, reativada, excluída sem uso, ligada ou desligada do cargo',
    legado: null,
  },
  pessoasCicloAvaliacaoGravado: {
    codigo: 'pessoas.ciclo_avaliacao.gravado',
    descricao:
      'Ciclo de avaliação incluído, alterado com motivo, encerrado, cancelado, reaberto ou excluído sem avaliação',
    legado: null,
  },
  pessoasAvaliacaoGravada: {
    codigo: 'pessoas.avaliacao.gravada',
    descricao:
      'Avaliação de desempenho aberta, com notas lançadas, finalizada, corrigida por versão nova com justificativa ou excluída em rascunho',
    legado: null,
  },
  pessoasAvaliacaoCiencia: {
    codigo: 'pessoas.avaliacao.ciencia',
    descricao: 'Ciência da avaliação de desempenho pelo próprio colaborador ou registrada pelo RH',
    legado: null,
  },
  pessoasPdiGravado: {
    codigo: 'pessoas.pdi.gravado',
    descricao:
      'Ação do plano de desenvolvimento individual incluída, alterada com motivo, concluída ou cancelada',
    legado: null,
  },
  // W0-06, parte 6 (M3 de mercado): solicitações do autoatendimento e a fila do gestor.
  pessoasSolicitacaoGravada: {
    codigo: 'pessoas.solicitacao.gravada',
    descricao:
      'Solicitação do autoatendimento incluída pelo colaborador, aprovada ou recusada pelo gestor (com o efeito nas férias, no ponto ou no cadastro) ou desistida pelo solicitante',
    legado: null,
  },
  pessoasSolicitacoesLidas: {
    codigo: 'pessoas.solicitacoes.lidas',
    descricao: 'Solicitações do autoatendimento consultadas (as próprias ou a fila do gestor)',
    legado: null,
  },
  pessoasAtestadoLido: {
    codigo: 'pessoas.atestado.lido',
    descricao: 'Atestado do colaborador lido com a finalidade, e se o CID foi visto (dado de saúde)',
    legado: null,
  },
  pessoasOcupacionalLido: {
    codigo: 'pessoas.ocupacional.lido',
    descricao: 'Prontuário ocupacional, vacinas, acidente ou exposições do colaborador lidos (dado de saúde)',
    legado: null,
  },
  // M52.3 (fatia F3): troca de plantão, acionamento do sobreaviso e dimensionamento de enfermagem.
  pessoasTrocaPedida: {
    codigo: 'pessoas.troca.pedida',
    descricao: 'Troca ou cessão de plantão pedida a um colega (ou cancelada por quem pediu)',
    legado: null,
  },
  pessoasTrocaRespondida: {
    codigo: 'pessoas.troca.respondida',
    descricao:
      'Troca de plantão aceita ou recusada pelo colega (ou registrada pela coordenação em nome dele)',
    legado: null,
  },
  pessoasTrocaDecidida: {
    codigo: 'pessoas.troca.decidida',
    descricao: 'Troca de plantão aprovada (os plantões mudam de colaborador, com o motivo) ou reprovada',
    legado: null,
  },
  pessoasSobreavisoAcionado: {
    codigo: 'pessoas.sobreaviso.acionado',
    descricao: 'Sobreaviso acionado, chegada registrada ou acionamento cancelado',
    legado: null,
  },
  pessoasDimensionamentoCalculado: {
    codigo: 'pessoas.dimensionamento.calculado',
    descricao: 'Dimensionamento de enfermagem (COFEN 543/2017) registrado com as parcelas da conta',
    legado: null,
  },
  // M52.4 (gestão de pessoas, F4: ponto): AFD, ajustes, fechamento, ciência e banco de horas em SGH_PES_* (só na trilha
  // própria). O espelho e o AEJ (com o CPF) são leituras auditadas de dado pessoal do colaborador.
  pessoasAfdImportado: {
    codigo: 'pessoas.afd.importado',
    descricao: 'Arquivo do relógio de ponto (AFD) importado ou posto em quarentena',
    legado: null,
  },
  pessoasAjustePontoLancado: {
    codigo: 'pessoas.ponto.ajuste_lancado',
    descricao: 'Ajuste de ponto ou justificativa lançado para aprovação',
    legado: null,
  },
  pessoasAjustePontoDecidido: {
    codigo: 'pessoas.ponto.ajuste_decidido',
    descricao: 'Ajuste de ponto ou justificativa aprovado ou recusado',
    legado: null,
  },
  pessoasPontoFechado: {
    codigo: 'pessoas.ponto.fechado',
    descricao: 'Período de ponto fechado (com o lançamento no banco de horas) ou reaberto',
    legado: null,
  },
  pessoasPontoCiencia: {
    codigo: 'pessoas.ponto.ciencia',
    descricao: 'Ciência do colaborador no próprio espelho de ponto',
    legado: null,
  },
  pessoasBancoHorasAlterado: {
    codigo: 'pessoas.banco_horas.alterado',
    descricao: 'Acerto manual do banco de horas ou regra do banco do regime gravada',
    legado: null,
  },
  pessoasPontoLido: {
    codigo: 'pessoas.ponto.lido',
    descricao: 'Espelho de ponto do colaborador lido (dado pessoal)',
    legado: null,
  },
  pessoasPontoExportado: {
    codigo: 'pessoas.ponto.exportado',
    descricao: 'Arquivo eletrônico de jornada (AEJ) ou eventos de ponto para a folha gerados (com o CPF)',
    legado: null,
  },
  // M52.6 (fatia F6): treinamentos e POP, autosserviço e o plantão realizado para o repasse.
  pessoasCursoGravado: {
    codigo: 'pessoas.curso.gravado',
    descricao:
      'Curso do catálogo de treinamentos incluído ou alterado (carga, validade, público obrigatório)',
    legado: null,
  },
  pessoasTurmaGravada: {
    codigo: 'pessoas.turma.gravada',
    descricao: 'Turma de treinamento aberta, inscrições incluídas, encerrada ou cancelada',
    legado: null,
  },
  pessoasParticipacaoRegistrada: {
    codigo: 'pessoas.participacao.registrada',
    descricao: 'Presença, aproveitamento e conclusão do colaborador na turma registrados',
    legado: null,
  },
  pessoasPopPublicado: {
    codigo: 'pessoas.pop.publicado',
    descricao: 'Versão de POP publicada (a anterior substituída) ou revogada',
    legado: null,
  },
  pessoasPopCiencia: {
    codigo: 'pessoas.pop.ciencia',
    descricao: 'Ciência do colaborador na versão vigente de um POP',
    legado: null,
  },
  pessoasAutoatendimentoLido: {
    codigo: 'pessoas.autoatendimento.lido',
    descricao:
      'Espaço do próprio colaborador lido (vínculo, escala, banco de horas, treinamentos e próximos exames)',
    legado: null,
  },
  pessoasRealizadoRegistrado: {
    codigo: 'pessoas.realizado.registrado',
    descricao: 'Horário real do plantão registrado para a aprovação (o anterior não aprovado substituído)',
    legado: null,
  },
  // W0-06, parte 2: o estorno do realizado e as correções do treinamento, com motivo e o valor anterior.
  pessoasRealizadoEstornado: {
    codigo: 'pessoas.realizado.estornado',
    descricao:
      'Plantão realizado aprovado estornado com motivo (o já lançado leva o lançamento negativo no repasse)',
    legado: null,
  },
  pessoasTurmaAlterada: {
    codigo: 'pessoas.turma.alterada',
    descricao: 'Turma aberta alterada com motivo (o valor anterior fica guardado)',
    legado: null,
  },
  pessoasInscricaoRetirada: {
    codigo: 'pessoas.turma.inscricao_retirada',
    descricao: 'Inscrição feita por engano retirada da turma, sem presença lançada (o retrato fica guardado)',
    legado: null,
  },
  pessoasParticipacaoCorrigida: {
    codigo: 'pessoas.participacao.corrigida',
    descricao: 'Presença e aproveitamento corrigidos com motivo (o valor anterior fica guardado)',
    legado: null,
  },
  pessoasRealizadoDecidido: {
    codigo: 'pessoas.realizado.decidido',
    descricao: 'Plantão realizado aprovado ou recusado por outra pessoa da coordenação',
    legado: null,
  },
  pessoasTarifaPlantaoGravada: {
    codigo: 'pessoas.tarifa_plantao.gravada',
    descricao: 'Tarifa por hora de plantão incluída ou com a vigência encerrada',
    legado: null,
  },
  // M53.1 (F0): a interface com a folha externa; nenhum evento leva CPF (só lote, competência, contagens e somas).
  pessoasFolhaLoteGerado: {
    codigo: 'pessoas.folha_lote.gerado',
    descricao:
      'Lote da competência gerado para a folha externa (o anterior da mesma empresa e competência substituído)',
    legado: null,
  },
  pessoasFolhaLoteBaixado: {
    codigo: 'pessoas.folha_lote.baixado',
    descricao: 'Arquivo do lote para a folha externa baixado (leva o CPF dos colaboradores)',
    legado: null,
  },
  pessoasFolhaRetornoImportado: {
    codigo: 'pessoas.folha_retorno.importado',
    descricao:
      'Retorno da folha externa importado e conferido (contagem e soma), com o resumo por colaborador',
    legado: null,
  },
  pessoasAfastamentoGravado: {
    codigo: 'pessoas.afastamento.gravado',
    descricao: 'Afastamento do colaborador registrado, encerrado ou cancelado',
    legado: null,
  },
  // M53.3 (F2): o cálculo mensal da folha; nenhum evento leva valor de salário (só vínculo, empresa e competência).
  pessoasSalarioLido: {
    codigo: 'pessoas.salario.lido',
    descricao: 'Vigências do salário contratual do colaborador consultadas',
    legado: null,
  },
  pessoasSalarioGravado: {
    codigo: 'pessoas.salario.gravado',
    descricao: 'Nova vigência do salário contratual do colaborador registrada',
    legado: null,
  },
  pessoasParametroFolhaGravado: {
    codigo: 'pessoas.folha_parametro.gravado',
    descricao: 'Nova vigência dos parâmetros da folha da empresa registrada',
    legado: null,
  },
  pessoasFolhaCalculada: {
    codigo: 'pessoas.folha_calculo.gravado',
    descricao: 'Folha mensal da competência calculada (o processamento anterior substituído)',
    legado: null,
  },
  pessoasFolhaCalculoDescartado: {
    codigo: 'pessoas.folha_calculo.descartado',
    descricao: 'Processamento da folha mensal descartado, com motivo',
    legado: null,
  },
  pessoasFolhaCalculoLido: {
    codigo: 'pessoas.folha_calculo.lido',
    descricao: 'Linhas do cálculo de um colaborador consultadas (holerite da competência)',
    legado: null,
  },
  pessoasHoleriteLido: {
    codigo: 'pessoas.holerite.lido',
    descricao: 'Holerite da competência lido pelo próprio colaborador no autosserviço',
    legado: null,
  },
  // M53.4 (F3): férias e 13º; nenhum evento leva valor (só vínculo, empresa, competência ou ano).
  pessoasFeriasProgramada: {
    codigo: 'pessoas.ferias.programada',
    descricao: 'Fração de férias do colaborador programada (gozo, abono e adiantamento do 13º)',
    legado: null,
  },
  pessoasFeriasCalculada: {
    codigo: 'pessoas.ferias.calculada',
    descricao: 'Recibo de férias do colaborador calculado e gravado',
    legado: null,
  },
  pessoasFeriasCancelada: {
    codigo: 'pessoas.ferias.cancelada',
    descricao: 'Programação ou recibo de férias cancelado, com motivo',
    legado: null,
  },
  pessoasFeriasLida: {
    codigo: 'pessoas.ferias.lida',
    descricao: 'Recibo de férias de um colaborador consultado (valores e memória)',
    legado: null,
  },
  pessoasMinhasFeriasLidas: {
    codigo: 'pessoas.minhas_ferias.lidas',
    descricao: 'Saldo e programação de férias lidos pelo próprio colaborador no autosserviço',
    legado: null,
  },
  pessoasDecimoCalculado: {
    codigo: 'pessoas.decimo.calculado',
    descricao: 'Parcela do 13º salário da empresa calculada (o processamento anterior substituído)',
    legado: null,
  },
  pessoasRescisaoCalculada: {
    codigo: 'pessoas.rescisao.calculada',
    descricao: 'Rescisão do colaborador desligado calculada e gravada (a anterior substituída)',
    legado: null,
  },
  pessoasRescisaoCancelada: {
    codigo: 'pessoas.rescisao.cancelada',
    descricao: 'Rescisão do colaborador cancelada, com motivo',
    legado: null,
  },
  pessoasRescisaoLida: {
    codigo: 'pessoas.rescisao.lida',
    descricao: 'Termo de rescisão de um colaborador consultado (valores e memória)',
    legado: null,
  },
  // M53.6 (F5, eSocial de tabela e não periódicos).
  pessoasEsocialEmpregadorGravado: {
    codigo: 'pessoas.esocial.empregador_gravado',
    descricao: 'Nova vigência dos parâmetros do eSocial do empregador (transmissor, leiaute, tabelas)',
    legado: null,
  },
  pessoasEsocialFichaGravada: {
    codigo: 'pessoas.esocial.ficha_gravada',
    descricao: 'Ficha do eSocial do colaborador gravada (dados pessoais e contratuais, cifrados)',
    legado: null,
  },
  pessoasEsocialFichaLida: {
    codigo: 'pessoas.esocial.ficha_lida',
    descricao: 'Ficha do eSocial do colaborador consultada (dados pessoais decifrados)',
    legado: null,
  },
  pessoasEsocialEventoGerado: {
    codigo: 'pessoas.esocial.evento_gerado',
    descricao: 'Evento do eSocial gerado e conferido no XSD (tabela, trabalhador ou exclusão)',
    legado: null,
  },
  pessoasEsocialEventoDescartado: {
    codigo: 'pessoas.esocial.evento_descartado',
    descricao: 'Evento do eSocial descartado antes do envio, com motivo',
    legado: null,
  },
  pessoasEsocialEventoLido: {
    codigo: 'pessoas.esocial.evento_lido',
    descricao: 'XML de um evento do eSocial consultado (pode conter CPF e nome do trabalhador)',
    legado: null,
  },
  pessoasEsocialLoteGravado: {
    codigo: 'pessoas.esocial.lote_gravado',
    descricao: 'Lote do eSocial montado, enviado, cancelado ou com o retorno registrado',
    legado: null,
  },
  pessoasEsocialConciliacaoConferida: {
    codigo: 'pessoas.esocial.conciliacao_conferida',
    descricao: 'Conciliação do transmissor único do eSocial conferida na competência',
    legado: null,
  },
  // M53.7 (F6, periódicos e fechamento).
  pessoasFolhaFechada: {
    codigo: 'pessoas.folha.fechada',
    descricao: 'Período da folha fechado (processamentos fixados, data de pagamento e soma de verificação)',
    legado: null,
  },
  pessoasFolhaReaberta: {
    codigo: 'pessoas.folha.reaberta',
    descricao: 'Período da folha reaberto, com motivo',
    legado: null,
  },
  // M53.8 (F7, FGTS Digital e obrigações legais).
  pessoasObrigacaoParametrosGravados: {
    codigo: 'pessoas.obrigacao.parametros_gravados',
    descricao:
      'Parâmetros das obrigações legais da empresa gravados (nova vigência: regimes, leiautes e responsável)',
    legado: null,
  },
  pessoasObrigacaoGerada: {
    codigo: 'pessoas.obrigacao.gerada',
    descricao:
      'Obrigação legal gerada (FGTS Digital, SEFIP, CAGED ou RAIS), com o arquivo cifrado e a soma de verificação',
    legado: null,
  },
  pessoasObrigacaoArquivoLido: {
    codigo: 'pessoas.obrigacao.arquivo_lido',
    descricao: 'Arquivo de obrigação legal baixado (contém CPF, NIS e nome dos trabalhadores)',
    legado: null,
  },
  pessoasObrigacaoEntregue: {
    codigo: 'pessoas.obrigacao.entregue',
    descricao: 'Entrega da obrigação legal registrada (protocolo; no FGTS Digital, a guia conciliada)',
    legado: null,
  },
  pessoasObrigacaoCancelada: {
    codigo: 'pessoas.obrigacao.cancelada',
    descricao: 'Obrigação legal gerada cancelada, com motivo',
    legado: null,
  },
  // M53.9 (F8, títulos e fatos contábeis).
  pessoasFolhaIntegracaoAlterada: {
    codigo: 'pessoas.folha.integracao.alterada',
    descricao:
      'Nova vigência do de-para da folha para o contas a pagar (credor, classificação e vencimento por rotina)',
    legado: null,
  },
  financeiroTituloPagarGravado: {
    codigo: 'financeiro.titulo_pagar.gravado',
    descricao: 'Título a pagar incluído (parcelas, classificação, retenções) ou excluído em aberto',
    legado: null,
  },
  financeiroTituloBaixado: {
    codigo: 'financeiro.titulo.baixado',
    descricao: 'Título baixado (pago sem borderô ou por borderô; recebido por baixa manual)',
    legado: null,
  },
  financeiroTituloReceberGravado: {
    codigo: 'financeiro.titulo_receber.gravado',
    descricao:
      'Título a receber incluído da conta (convênio pela competência ou particular) e ligado à conta',
    legado: null,
  },
  financeiroMovimentoLancado: {
    codigo: 'financeiro.movimento.lancado',
    descricao:
      'Movimento bancário lançado (tarifa, fechamento de caixa, transferência, crédito ou débito avulso)',
    legado: null,
  },
  financeiroAlcadaEditada: {
    codigo: 'financeiro.alcada.editada',
    descricao: 'Faixa de alçada de aprovação incluída ou alterada',
    legado: null,
  },
  financeiroTituloAprovado: {
    codigo: 'financeiro.titulo_pagar.aprovado',
    descricao: 'Título a pagar aprovado na alçada (primeira ou segunda aprovação)',
    legado: null,
  },
  financeiroVencimentoProrrogado: {
    codigo: 'financeiro.titulo_pagar.vencimento_prorrogado',
    descricao: 'Vencimento da parcela a pagar prorrogado, com motivo (o vencimento original fica)',
    legado: null,
  },
  financeiroGlosaTituloRegistrada: {
    codigo: 'financeiro.glosa_titulo.registrada',
    descricao: 'Glosa no título a receber registrada (aceita, recurso deferido ou indeferido)',
    legado: null,
  },
  financeiroExtratoImportado: {
    codigo: 'financeiro.extrato.importado',
    descricao: 'Extrato bancário importado (arquivo guardado com hash)',
    legado: null,
  },
  financeiroConciliacaoConfirmada: {
    codigo: 'financeiro.conciliacao.confirmada',
    descricao: 'Linha do extrato conciliada com movimento, título ou crédito pendente',
    legado: null,
  },
  financeiroCreditoAtribuido: {
    codigo: 'financeiro.credito.atribuido',
    descricao: 'Crédito não identificado atribuído a um título a receber',
    legado: null,
  },
  financeiroAdiantamentoConcedido: {
    codigo: 'financeiro.adiantamento.concedido',
    descricao:
      'Pedido de adiantamento a fornecedor ou médico registrado (sem saída até a aprovação e o pagamento)',
    legado: null,
  },
  financeiroAdiantamentoAprovado: {
    codigo: 'financeiro.adiantamento.aprovado',
    descricao: 'Pedido de adiantamento aprovado na alçada (primeira ou segunda aprovação)',
    legado: null,
  },
  financeiroAdiantamentoPago: {
    codigo: 'financeiro.adiantamento.pago',
    descricao: 'Adiantamento aprovado pago ao credor, com a saída na conta bancária',
    legado: null,
  },
  financeiroAdiantamentoCompensado: {
    codigo: 'financeiro.adiantamento.compensado',
    descricao: 'Saldo do adiantamento compensado na baixa de título a pagar do mesmo credor',
    legado: null,
  },
  financeiroAdiantamentoDevolvido: {
    codigo: 'financeiro.adiantamento.devolvido',
    descricao: 'Saldo do adiantamento devolvido pelo credor, com a entrada na conta bancária',
    legado: null,
  },
  financeiroRemessaGerada: {
    codigo: 'financeiro.remessa.gerada',
    descricao: 'Remessa bancária gerada (simulador fora de produção)',
    legado: null,
  },
  financeiroNfseEmitida: {
    codigo: 'financeiro.nfse.emitida',
    descricao: 'NFS-e emitida (simulador fora de produção)',
    legado: null,
  },
  financeiroDeclaracaoGerada: {
    codigo: 'financeiro.declaracao.gerada',
    descricao: 'DMED ou EFD-REINF gerada (arquivo, não enviado)',
    legado: null,
  },
  financeiroLoteContabilExportado: {
    codigo: 'financeiro.lote_contabil.exportado',
    descricao: 'Lote contábil exportado ao sistema do contador (contagem e soma)',
    legado: null,
  },
  financeiroDadoMostrado: {
    codigo: 'financeiro.dado.mostrado',
    descricao: 'Documento ou dado bancário mostrado sem máscara (com a finalidade)',
    legado: null,
  },
  financeiroTitulosLidos: {
    codigo: 'financeiro.titulo.lido',
    descricao: 'Lista de títulos lida (credores e devedores mascarados)',
    legado: null,
  },
  financeiroMovimentoLido: {
    codigo: 'financeiro.movimento.lido',
    descricao: 'Movimento bancário e saldos lidos',
    legado: null,
  },
  financeiroRelatorioLido: {
    codigo: 'financeiro.relatorio.lido',
    descricao: 'Indicadores, fluxo de caixa, DRE ou escrituração lidos',
    legado: null,
  },
  // M37: painel de migração gradual, treinamento e governança (gravações só em SGH_, com a SGH_TRILHA na mesma
  // transação; a condução pelas operações do protocolo de permissões do grupo, que já registram a trilha do legado).
  coexistenciaSetorAlterado: {
    codigo: 'coexistencia.setor.alterado',
    descricao:
      'Situação, chave, composição ou aceite de um setor da migração gradual mudados (com a justificativa)',
    legado: null,
  },
  // M39: a lista para ligar um setor da onda 1 (regra 1; SGH_CFG_COEX_LIGAR, com a SGH_TRILHA na mesma transação).
  coexistenciaListaLigarAlterada: {
    codigo: 'coexistencia.ligar.alterado',
    descricao:
      'Itens da lista para ligar um setor da onda 1, ou do critério de liberação de um setor da onda 2, registrados (situação, evidência e data; com a justificativa)',
    legado: null,
  },
  // M59-F1: o painel "Contas do banco de dados e privilégios" (permissão sensível acesso.contaBanco.ler): toda
  // leitura do mapa de contas e privilégios entra na trilha própria, com o ator real numa sessão "como".
  contasBancoConsultadas: {
    codigo: 'acesso.contaBanco.consultada',
    descricao:
      'Inventário das contas do banco de dados ou desvios do privilégio mínimo consultados (nomes de conta e privilégios; nunca senha)',
    legado: null,
  },
  // M58 (F1, regra 2): a checklist do desligamento (SGH_CFG_COEX_DESLIG, com a SGH_TRILHA na mesma transação).
  coexistenciaDesligamentoItemRegistrado: {
    codigo: 'coexistencia.desligamento.item',
    descricao:
      'Item do inventário do desligamento registrado (substituto em uso ou aceite da área, contingência, papel e evidência; com reautenticação)',
    legado: null,
  },
  coexistenciaPessoasConsultadas: {
    codigo: 'coexistencia.pessoas.consultadas',
    descricao: 'Lista da migração por pessoa consultada (login e nome de usuário; nenhum dado de paciente)',
    legado: null,
  },
  coexistenciaTrilhaPublicada: {
    codigo: 'coexistencia.trilha.publicada',
    descricao:
      'Versão nova da trilha de treinamento de um papel e onda publicada (a anterior fica desatualizada)',
    legado: null,
  },
  coexistenciaTreinoRegistrado: {
    codigo: 'coexistencia.treino.registrado',
    descricao: 'Conclusão do treinamento registrada para uma turma (trilha, versão, resultado)',
    legado: null,
  },
  // W0-09 (CRUD completo; script 1122): o ciclo de vida dos registros da implantação (motivo e valor anterior na
  // SGH_CRUD_EVENTO, na mesma transação).
  coexistenciaItemVoltouPendente: {
    codigo: 'coexistencia.item.pendente',
    descricao:
      'Item do critério de liberação ou da checklist do desligamento voltou a pendente, com motivo (o registro anterior fica no histórico)',
    legado: null,
  },
  coexistenciaTreinoEstornado: {
    codigo: 'coexistencia.treino.estornado',
    descricao: 'Conclusão do treinamento estornada com motivo (a conclusão fica; deixa de contar)',
    legado: null,
  },
  coexistenciaTrilhaRetirada: {
    codigo: 'coexistencia.trilha.retirada',
    descricao:
      'Versão da trilha de treinamento retirada com motivo (excluída sem vínculos, com retrato; ou inativada quando tem turmas ou conclusões)',
    legado: null,
  },
  coexistenciaRegistroGravado: {
    codigo: 'coexistencia.registro.gravado',
    descricao:
      'Registro do fim da coexistência ou da retrocompatibilidade gravado pela tela, com senha e motivo (versão nova; ou volta ao registro versionado)',
    legado: null,
  },
  coexistenciaLoteAplicado: {
    codigo: 'coexistencia.lote.aplicado',
    descricao:
      'Lote de liberação aplicado de uma vez (lista de usuários, grupo ou setor; quem ficou de fora listado)',
    legado: null,
  },
  coexistenciaLoteRecolhido: {
    codigo: 'coexistencia.lote.recolhido',
    descricao: 'Lote de liberação recolhido como unidade (cada chave volta ao estado de antes)',
    legado: null,
  },
  coexistenciaConducaoAlterada: {
    codigo: 'coexistencia.conducao.alterada',
    descricao: 'Condução opcional de um setor: opções retiradas dos grupos ou devolvidas (com a autorização)',
    legado: null,
  },
  coexistenciaRetratoGravado: {
    codigo: 'coexistencia.retrato.gravado',
    descricao:
      'Retrato das últimas conexões do outro sistema e indicadores do dia gravados pelo worker (contagens)',
    legado: null,
  },
  chamadoAberto: {
    codigo: 'config.chamado.aberto',
    descricao:
      'Chamado aberto de dentro do sistema (sistema onde ocorreu, severidade; com dado pessoal, o encarregado é avisado)',
    legado: null,
  },
  chamadoTriado: {
    codigo: 'config.chamado.triado',
    descricao: 'Chamado triado: severidade, nível, situação, comandante (S1) ou contorno',
    legado: null,
  },
  // M33: repasse médico (regras, apuração, lançamentos, RPA e o extrato do médico).
  repasseRegraProposta: {
    codigo: 'repasse.regra.proposta',
    descricao: 'Regra de repasse proposta (rascunho de regra nova ou de nova versão, com a simulação)',
    legado: null,
  },
  repasseRegraDecidida: {
    codigo: 'repasse.regra.decidida',
    descricao: 'Regra de repasse aprovada ou recusada pelo supervisor',
    legado: null,
  },
  repasseRegraIncluida: {
    codigo: 'repasse.regra.incluida',
    descricao: 'Regra de repasse aprovada incluída com a vigência (passa a valer nos dois sistemas)',
    legado: null,
  },
  repasseApuracaoGravada: {
    codigo: 'repasse.apuracao.gravada',
    descricao: 'Apuração do período apurada, conferida, aprovada ou devolvida (memória de cálculo)',
    legado: null,
  },
  repasseItensIntegrados: {
    codigo: 'repasse.itens.integrados',
    descricao: 'Itens faturados do período integrados ao repasse (apuração gravada)',
    legado: null,
  },
  repasseEventoLancado: {
    codigo: 'repasse.evento.lancado',
    descricao: 'Lançamento de repasse incluído (da apuração, ajuste avulso ou estorno por glosa)',
    legado: null,
  },
  repasseRpaEmitido: {
    codigo: 'repasse.rpa.emitido',
    descricao: 'RPA emitido com as retenções e o título a pagar',
    legado: null,
  },
  // M54 (etapa 1): contabilidade — plano de contas, regra versionada e leitura dos fatos (só SGH_CTB_*).
  contabilContaIncluida: {
    codigo: 'contabil.conta.incluida',
    descricao: 'Conta incluída no plano de contas (código, grupo, tipo e vínculo referencial; sem valor)',
    legado: null,
  },
  contabilContaAlterada: {
    codigo: 'contabil.conta.alterada',
    descricao: 'Conta do plano alterada (imagem antes e depois; o código e o grupo não mudam)',
    legado: null,
  },
  contabilRegraPublicada: {
    codigo: 'contabil.regra.publicada',
    descricao:
      'Nova versão de regra de contabilização publicada (origem, tipo de fato, versão e justificativa)',
    legado: null,
  },
  contabilFatosLidos: {
    codigo: 'contabil.fatos.lidos',
    descricao: 'Lote de fatos lido do banco (fonte, faixa de chaves, novos e alterados; só contagens)',
    legado: null,
  },
  contabilPeriodoReprocessado: {
    codigo: 'contabil.periodo.reprocessado',
    descricao:
      'Período aberto reprocessado ou conferido (empresa, competência, lançamentos iguais e diferentes)',
    legado: null,
  },
  // M54 (etapa 2): lançamentos, estorno, conciliação e encerramento (só SGH_CTB_*).
  contabilLancamentoIncluido: {
    codigo: 'contabil.lancamento.incluido',
    descricao:
      'Lançamento contábil manual incluído (empresa, competência, débitos e créditos; sem dado de pessoa)',
    legado: null,
  },
  contabilLancamentoEstornado: {
    codigo: 'contabil.lancamento.estornado',
    descricao: 'Lançamento contábil estornado por outro lançamento (o original fica), com a justificativa',
    legado: null,
  },
  contabilFatosContabilizados: {
    codigo: 'contabil.fatos.contabilizados',
    descricao: 'Fatos dos módulos contabilizados (contagens por situação, lançamentos gravados e os totais)',
    legado: null,
  },
  contabilConciliacaoRegistrada: {
    codigo: 'contabil.conciliacao.registrada',
    descricao: 'Partidas de uma conta conciliadas (conta, quantidade e valor)',
    legado: null,
  },
  contabilConciliacaoDesfeita: {
    codigo: 'contabil.conciliacao.desfeita',
    descricao: 'Conciliação de conta desfeita, com a justificativa (as partidas voltam a pendentes)',
    legado: null,
  },
  contabilPeriodoEncerrado: {
    codigo: 'contabil.periodo.encerrado',
    descricao: 'Período contábil encerrado (empresa, competência, lançamentos e os totais)',
    legado: null,
  },
  contabilPeriodoReaberto: {
    codigo: 'contabil.periodo.reaberto',
    descricao: 'Período contábil reaberto, com a justificativa',
    legado: null,
  },
  // M54 (etapa 3): demonstrações, apuração do resultado do exercício e SPED contábil (só SGH_CTB_*).
  contabilDemonstracaoExportada: {
    codigo: 'contabil.demonstracao.exportada',
    descricao:
      'Balancete, diário, DRE ou balanço exportado em arquivo (empresa, período e o tipo; só totais)',
    legado: null,
  },
  contabilResultadoApurado: {
    codigo: 'contabil.resultado.apurado',
    descricao:
      'Resultado do exercício apurado (lançamento de encerramento das contas de resultado contra o patrimônio líquido)',
    legado: null,
  },
  contabilSpedGerado: {
    codigo: 'contabil.sped.gerado',
    descricao:
      'Arquivo da ECD ou da ECF gerado (empresa, exercício, número, linhas e o hash; sem o conteúdo)',
    legado: null,
  },
  contabilSpedBaixado: {
    codigo: 'contabil.sped.baixado',
    descricao: 'Arquivo da ECD ou da ECF baixado (contém a identificação dos signatários)',
    legado: null,
  },
  contabilSpedSituacao: {
    codigo: 'contabil.sped.situacao',
    descricao: 'Recibo da transmissão da ECD ou da ECF registrado, ou o arquivo cancelado com o motivo',
    legado: null,
  },
  repasseLido: {
    codigo: 'repasse.relatorio.lido',
    descricao: 'Demonstrativo, extrato do médico ou indicadores do repasse lidos',
    legado: null,
  },
  // M48, etapa 1 (regra 11): notificação de incidentes. Só na trilha própria (o outro sistema não tem módulo de
  // segurança do paciente). Nenhum dado clínico nem nome: só o ID da notificação e o protocolo. Na notificação
  // anônima o ator da trilha é o marcador `anonimo` (sem login, estação nem IP; regra 1 e seção 11 da ficha).
  qualidadeIncidenteNotificado: {
    codigo: 'qualidade.incidente.notificado',
    descricao: 'Incidente notificado pelo botão global, com ou sem identificação (INCIDENTE_NOTIFICADO)',
    legado: null,
  },
  qualidadeNotificacaoTriada: {
    codigo: 'qualidade.notificacao.triada',
    descricao:
      'Notificação triada pelo NSP: classificação da OMS, grau e tipo de dano confirmados ou corrigidos, ou descartada (NOTIFICACAO_TRIADA)',
    legado: null,
  },
  qualidadeNotificacaoDistribuida: {
    codigo: 'qualidade.notificacao.distribuida',
    descricao: 'Notificação distribuída ao gestor da área com o prazo da análise',
    legado: null,
  },
  qualidadeNotificacaoDevolvida: {
    codigo: 'qualidade.notificacao.devolvida',
    descricao: 'Devolutiva registrada para o notificador (lida pelo número de acompanhamento)',
    legado: null,
  },
  qualidadeNotivisaExportada: {
    codigo: 'qualidade.notivisa.exportada',
    descricao: 'Campos do Notivisa gerados para transcrição no portal',
    legado: null,
  },
  qualidadeNotivisaTranscrita: {
    codigo: 'qualidade.notivisa.transcrita',
    descricao: 'Transcrição no portal do Notivisa registrada com o número devolvido (o prazo para)',
    legado: null,
  },
  qualidadeNotificacaoLida: {
    codigo: 'qualidade.notificacao.lida',
    descricao: 'Lista ou detalhe das notificações aberto pelo NSP ou pelo gestor da área (conteúdo sensível)',
    legado: null,
  },
  // M48, etapa 2: análise, plano de ação, sugestão e vigilância de produto (só IDs na trilha; nunca o notificador).
  qualidadeAnaliseRegistrada: {
    codigo: 'qualidade.analise.registrada',
    descricao:
      'Análise de causa da notificação registrada, atualizada ou concluída (5 porquês, Ishikawa, Protocolo de Londres)',
    legado: null,
  },
  qualidadePlanoAcaoRegistrado: {
    codigo: 'qualidade.planoAcao.registrado',
    descricao:
      'Ação do plano 5W2H incluída, alterada, iniciada, concluída, cancelada ou com a eficácia verificada',
    legado: null,
  },
  qualidadeSugestaoDispensada: {
    codigo: 'qualidade.sugestao.dispensada',
    descricao:
      'Sugestão automática de notificação dispensada por quem registrou o fato (sem a origem na trilha)',
    legado: null,
  },
  qualidadeQueixaTecnicaRegistrada: {
    codigo: 'qualidade.queixaTecnica.registrada',
    descricao:
      'Queixa técnica, evento adverso de produto, reação adversa ou alerta sanitário registrado ou com andamento',
    legado: null,
  },
  qualidadeExpostosConsultados: {
    codigo: 'qualidade.expostos.consultados',
    descricao: 'Lista dos pacientes expostos a um lote consultada (tecnovigilância e farmacovigilância)',
    legado: null,
  },
  // M48, etapa 3 (regra 11): CCIH. Só na trilha própria (o outro sistema não tem controle de infecção; a validação de
  // antimicrobiano dele está desligada). Nenhum dado clínico nem nome no payload: só os IDs das linhas SGH_.
  qualidadeDispositivoRegistrado: {
    codigo: 'qualidade.dispositivo.registrado',
    descricao: 'Dispositivo invasivo registrado (CVC, sonda vesical, tubo e ventilação mecânica)',
    legado: null,
  },
  qualidadeDispositivoRetirado: {
    codigo: 'qualidade.dispositivo.retirado',
    descricao: 'Retirada do dispositivo invasivo registrada',
    legado: null,
  },
  qualidadeIrasRegistrada: {
    codigo: 'qualidade.iras.registrada',
    descricao: 'Ficha de IRAS registrada pela CCIH com os critérios da Anvisa',
    legado: null,
  },
  qualidadeIrasDescartada: {
    codigo: 'qualidade.iras.descartada',
    descricao: 'Ficha de IRAS descartada pela CCIH com a justificativa',
    legado: null,
  },
  qualidadeAntimicrobianoConfigurado: {
    codigo: 'qualidade.antimicrobiano.configurado',
    descricao: 'Política (restrito) e DDD do antimicrobiano configuradas pela CCIH',
    legado: null,
  },
  qualidadeAntimicrobianoLiberado: {
    codigo: 'qualidade.antimicrobiano.liberado',
    descricao:
      'Antimicrobiano restrito liberado, liberado com ajuste ou não liberado pela CCIH (ANTIMICROBIANO_LIBERADO)',
    legado: null,
  },
  qualidadeAntimicrobianoRevisado: {
    codigo: 'qualidade.antimicrobiano.revisado',
    descricao: 'Revisão do antimicrobiano no 3º ou no 7º dia registrada',
    legado: null,
  },
  qualidadePrecaucaoDefinida: {
    codigo: 'qualidade.precaucao.definida',
    descricao: 'Precaução definida para o internado e refletida no mapa de leitos (PRECAUCAO_DEFINIDA)',
    legado: null,
  },
  qualidadePrecaucaoEncerrada: {
    codigo: 'qualidade.precaucao.encerrada',
    descricao: 'Precaução encerrada (o leito sai do isolamento no mapa)',
    legado: null,
  },
  qualidadeHigieneMaosRegistrada: {
    codigo: 'qualidade.higieneMaos.registrada',
    descricao: 'Observação de higiene das mãos ou consumo de preparação alcoólica registrado',
    legado: null,
  },
  qualidadeSurtoRegistrado: {
    codigo: 'qualidade.surto.registrado',
    descricao: 'Surto aberto ou atualizado pela CCIH',
    legado: null,
  },
  // W0-04 (programa CRUD completo): correção e cancelamento da qualidade e da CCIH. A trilha leva só a tabela e o ID
  // da linha SGH_ (o valor anterior clínico fica na versão, SGH_QUA_VERSAO, nunca na trilha: SBIS NGS1.07.06).
  qualidadeRegistroCorrigido: {
    codigo: 'qualidade.registro.corrigido',
    descricao:
      'Registro da qualidade ou da CCIH corrigido por nova versão com justificativa (a anterior fica inativa e acessível)',
    legado: null,
  },
  qualidadeRegistroCancelado: {
    codigo: 'qualidade.registro.cancelado',
    descricao:
      'Registro da qualidade ou da CCIH cancelado ou estornado com motivo (fica visível como inativo)',
    legado: null,
  },
  qualidadeCompetenciaFechada: {
    codigo: 'qualidade.competencia.fechada',
    descricao: 'Competência dos indicadores da CCIH (IRAS e dispositivos-dia) fechada',
    legado: null,
  },
  qualidadeCompetenciaReaberta: {
    codigo: 'qualidade.competencia.reaberta',
    descricao: 'Competência fechada dos indicadores da CCIH reaberta com motivo',
    legado: null,
  },
  qualidadeBundleRegistrado: {
    codigo: 'qualidade.bundle.registrado',
    descricao:
      'Checklist do bundle de manutenção do dispositivo invasivo registrado no turno (aba de dispositivos do prontuário)',
    legado: null,
  },
  // W0-04 (M5): a comissão de revisão de prontuários. A trilha leva só a tabela e o ID da linha SGH_ (as respostas do
  // checklist e o número da internação ficam nas tabelas SGH_QUA_REV_*, nunca na trilha).
  qualidadeRevisaoChecklistPublicado: {
    codigo: 'qualidade.revisaoProntuario.checklistPublicado',
    descricao:
      'Checklist de completude da comissão de revisão de prontuários publicado (a revisão anterior fica substituída e acessível)',
    legado: null,
  },
  qualidadeRevisaoSorteada: {
    codigo: 'qualidade.revisaoProntuario.sorteada',
    descricao: 'Sorteio dos prontuários com alta da competência registrado com a semente (reproduzível)',
    legado: null,
  },
  qualidadeRevisaoRegistrada: {
    codigo: 'qualidade.revisaoProntuario.revisado',
    descricao:
      'Prontuário revisado pelo checklist da comissão; os itens não conformes viram pendência ao profissional',
    legado: null,
  },
  qualidadeRevisaoAval: {
    codigo: 'qualidade.revisaoProntuario.aval',
    descricao: 'Aval da comissão de revisão de prontuários registrado (lido pelo SAME)',
    legado: null,
  },
  qualidadeRevisaoPendenciaRespondida: {
    codigo: 'qualidade.revisaoProntuario.pendenciaRespondida',
    descricao: 'Pendência de prontuário respondida pelo profissional',
    legado: null,
  },
  qualidadeRevisaoPendenciaAvisada: {
    codigo: 'qualidade.pendenciaProntuario.avisada',
    descricao:
      'Aviso ao profissional de pendência de prontuário aberta ou reaberta pela comissão de revisão (central de avisos)',
    legado: null,
  },
  qualidadeAtaAssinada: {
    codigo: 'qualidade.ata.assinada',
    descricao: 'Ata de reunião de comissão assinada (aprovada): depois dela, só retificação',
    legado: null,
  },
  qualidadeCcihLida: {
    codigo: 'qualidade.ccih.lida',
    descricao: 'Vigilância, fichas de IRAS ou o detalhe do internado abertos pela CCIH (conteúdo clínico)',
    legado: null,
  },
  // M48, etapa 4 (regra 11): notificação compulsória. Só na trilha própria (o caso fica em SGH_QUA_AGRAVO_CASO; as
  // tabelas de ficha preenchida do outro sistema estão vazias e não são usadas). Nenhum nome, CID nem dado clínico no
  // payload: só os IDs das linhas SGH_ e os códigos do vocabulário (origem, periodicidade, canal, motivo).
  qualidadeAgravoCasoAberto: {
    codigo: 'qualidade.agravo.casoAberto',
    descricao:
      'Caso de agravo de notificação compulsória aberto pela vigilância (da fila de gatilhos ou manual)',
    legado: null,
  },
  qualidadeAgravoNotificado: {
    codigo: 'qualidade.agravo.notificado',
    descricao: 'Notificação do agravo à autoridade sanitária registrada (AGRAVO_NOTIFICADO)',
    legado: null,
  },
  qualidadeAgravoDescartado: {
    codigo: 'qualidade.agravo.descartado',
    descricao: 'Caso de agravo descartado pela vigilância com a justificativa',
    legado: null,
  },
  qualidadeAgravoGatilhoConfigurado: {
    codigo: 'qualidade.agravo.gatilhoConfigurado',
    descricao: 'Exame cujo resultado reagente sugere o agravo incluído ou alterado pela vigilância',
    legado: null,
  },
  qualidadeAgravoLido: {
    codigo: 'qualidade.agravo.lido',
    descricao: 'Fila de gatilhos, caso ou ficha de agravo abertos pela vigilância (conteúdo clínico)',
    legado: null,
  },
  // M48, etapa 5 (regra 11): gestão da qualidade e envios regulatórios. Só na trilha própria (SGH_QUA_* do 0485 e do
  // 0486). Nenhum dado pessoal no payload (nem o manifestante, nem o relato, nem o conteúdo do documento): só os IDs
  // das linhas SGH_ e os códigos do vocabulário.
  qualidadeDocumentoPublicado: {
    codigo: 'qualidade.documento.publicado',
    descricao: 'Documento da qualidade publicado ou revisado (DOCUMENTO_PUBLICADO)',
    legado: null,
  },
  qualidadeDocumentoRetirado: {
    codigo: 'qualidade.documento.retirado',
    descricao: 'Documento da qualidade retirado de uso, com o motivo',
    legado: null,
  },
  qualidadeDocumentoCiencia: {
    codigo: 'qualidade.documento.ciencia',
    descricao: 'Ciência do usuário registrada na revisão vigente do documento',
    legado: null,
  },
  qualidadeIndicadorAnalisado: {
    codigo: 'qualidade.indicador.analisado',
    descricao: 'Análise crítica do indicador registrada ou alterada na competência',
    legado: null,
  },
  qualidadeAuditoriaRegistrada: {
    codigo: 'qualidade.auditoria.registrada',
    descricao: 'Auditoria interna por checklist registrada',
    legado: null,
  },
  qualidadeComissaoRegistrada: {
    codigo: 'qualidade.comissao.registrada',
    descricao: 'Comissão incluída ou alterada (composição e periodicidade)',
    legado: null,
  },
  qualidadeReuniaoRegistrada: {
    codigo: 'qualidade.comissao.reuniaoRegistrada',
    descricao: 'Reunião de comissão registrada (pauta, ata e presença)',
    legado: null,
  },
  qualidadeRiscoRegistrado: {
    codigo: 'qualidade.risco.registrado',
    descricao: 'Risco incluído ou reavaliado na matriz GUT',
    legado: null,
  },
  qualidadeNaoConformidadeRegistrada: {
    codigo: 'qualidade.naoConformidade.registrada',
    descricao: 'Não conformidade aberta ou com o tratamento, a verificação ou o encerramento registrado',
    legado: null,
  },
  qualidadeManifestacaoRegistrada: {
    codigo: 'qualidade.ouvidoria.registrada',
    descricao: 'Manifestação da ouvidoria registrada (o relato e o manifestante não vão à trilha)',
    legado: null,
  },
  qualidadeManifestacaoEncaminhada: {
    codigo: 'qualidade.ouvidoria.encaminhada',
    descricao: 'Manifestação encaminhada à área responsável',
    legado: null,
  },
  qualidadeManifestacaoRespondida: {
    codigo: 'qualidade.ouvidoria.respondida',
    descricao: 'Manifestação respondida ao manifestante',
    legado: null,
  },
  qualidadeOuvidoriaLida: {
    codigo: 'qualidade.ouvidoria.lida',
    descricao: 'Manifestações da ouvidoria consultadas (dado pessoal do manifestante)',
    legado: null,
  },
  relatorioEnvioGerado: {
    codigo: 'relatorio.envioRegulatorio.gerado',
    descricao:
      'Arquivo de envio regulatório gerado na competência (só o tipo, a competência e o resumo SHA-256)',
    legado: null,
  },
  relatorioEnvioTransmitido: {
    codigo: 'relatorio.envioRegulatorio.transmitido',
    descricao: 'Transmissão manual do envio regulatório registrada com o protocolo',
    legado: null,
  },
  // M47, etapa 1 (regra 11): agência transfusional. Só na trilha própria: o outro sistema não registra transfusão (0
  // evento nas opções da Hemoterapia, que nenhum grupo tem no pc); a checagem do horário do item de hemoterapia, quando
  // houver, vai à trilha dupla pelo evento da checagem do M25 (opção 5302). Nenhum dado clínico nem nome: só os IDs.
  sadtTransfusaoRequisitada: {
    codigo: 'sadt.transfusao.requisitada',
    descricao: 'Requisição transfusional feita a partir do item de hemoterapia da prescrição',
    legado: null,
  },
  sadtAmostraTransfusionalColetada: {
    codigo: 'sadt.amostraTransfusional.coletada',
    descricao: 'Amostra pré-transfusional coletada e rotulada à beira do leito (pulseira lida ou motivo)',
    legado: null,
  },
  sadtTransfusaoIniciada: {
    codigo: 'sadt.transfusao.iniciada',
    descricao: 'Transfusão iniciada com a dupla checagem da bolsa contra a pulseira (TRANSFUSAO_INICIADA)',
    legado: null,
  },
  sadtTransfusaoAlterada: {
    codigo: 'sadt.transfusao.alterada',
    descricao:
      'Requisição transfusional alterada antes do atendimento (hemocomponente, volume ou urgência), com o motivo; a versão anterior fica legível',
    legado: null,
  },
  sadtTransfusaoAdendo: {
    codigo: 'sadt.transfusao.adendo',
    descricao:
      'Adendo no ato transfusional (sinais digitados errado), com o motivo; o ato e a medida original não mudam',
    legado: null,
  },
  sadtBolsaCorrigida: {
    codigo: 'sadt.bolsa.corrigida',
    descricao:
      'Bolsa recebida corrigida antes do uso (etiqueta, validade ou volume), com o motivo; a versão anterior fica legível',
    legado: null,
  },
  sadtTransfusaoCancelada: {
    codigo: 'sadt.transfusao.cancelada',
    descricao: 'Requisição transfusional cancelada antes da transfusão, com o motivo',
    legado: null,
  },
  sadtTransfusaoSinaisRegistrados: {
    codigo: 'sadt.transfusao.sinaisRegistrados',
    descricao: 'Sinais vitais da transfusão registrados (aos 10 a 15 minutos ou ao término)',
    legado: null,
  },
  sadtTransfusaoBloqueada: {
    codigo: 'sadt.transfusao.bloqueada',
    descricao:
      'Início da transfusão recusado (bolsa vencida ou incompatível, pulseira de outro paciente, sem dupla checagem; TRANSFUSAO_BLOQUEADA)',
    legado: null,
  },
  sadtTransfusaoConcluida: {
    codigo: 'sadt.transfusao.concluida',
    descricao: 'Transfusão concluída ou interrompida, com o volume transfundido e os sinais do término',
    legado: null,
  },
  sadtReacaoTransfusional: {
    codigo: 'sadt.reacao.registrada',
    descricao:
      'Reação transfusional registrada, com a sugestão de notificação ao núcleo de segurança (REACAO_TRANSFUSIONAL)',
    legado: null,
  },
  sadtReacaoNotificada: {
    codigo: 'sadt.reacao.notificada',
    descricao: 'Notificação da reação transfusional enviada ao portal da vigilância (a data do envio)',
    legado: null,
  },
  sadtBolsaDescartada: {
    codigo: 'sadt.bolsa.descartada',
    descricao: 'Bolsa descartada ou devolvida depois de reação ou perda (BOLSA_DESCARTADA)',
    legado: null,
  },
  sadtTransfusaoLida: {
    codigo: 'sadt.transfusao.lida',
    descricao:
      'Lista de requisições, ato transfusional ou hemovigilância aberta (lista com nomes de pacientes)',
    legado: null,
  },
  // M47, etapa 2 (regra 11; chave `agencia.completa`): imuno-hematologia, prova cruzada e estoque de bolsas. Só na
  // trilha própria (o outro sistema não registra a agência: 0 bolsa e 0 movimento). Só os IDs e o número da bolsa.
  sadtImunoRegistrado: {
    codigo: 'sadt.imuno.registrado',
    descricao:
      'Resultado imuno-hematológico registrado (tipagem ABO e Rh, pesquisa de anticorpos ou prova cruzada)',
    legado: null,
  },
  sadtImunoLiberado: {
    codigo: 'sadt.imuno.liberado',
    descricao: 'Resultado imuno-hematológico conferido e liberado por outro profissional',
    legado: null,
  },
  sadtImunoInvalidado: {
    codigo: 'sadt.imuno.invalidado',
    descricao: 'Resultado imuno-hematológico invalidado, com o motivo (nova amostra)',
    legado: null,
  },
  sadtBolsaRecebida: {
    codigo: 'sadt.bolsa.recebida',
    descricao: 'Bolsa recebida do hemocentro no estoque (em quarentena ou já liberada)',
    legado: null,
  },
  sadtBolsaMovimentada: {
    codigo: 'sadt.bolsa.movimentada',
    descricao: 'Bolsa do estoque liberada, bloqueada, reservada ou com a reserva cancelada',
    legado: null,
  },
  sadtAgenciaLida: {
    codigo: 'sadt.agencia.lida',
    descricao: 'Imuno-hematologia ou estoque de bolsas aberto (lista com nomes de pacientes)',
    legado: null,
  },
  // M50 etapa 1 (ficha, regra 13): portal do paciente. Só na trilha própria (identidade fora do cadastro de usuários; o outro
  // sistema não tem portal do paciente). Nenhum dado pessoal: a conta, o vínculo e o paciente vão por identificador.
  portalContaConvidada: {
    codigo: 'portal.conta.convidada',
    descricao: 'Convite do portal emitido para o paciente (origem: recepção, atendimento ou privacidade)',
    legado: null,
  },
  portalContaAtivada: {
    codigo: 'portal.conta.ativada',
    descricao: 'Conta do portal ativada (termo de uso e política aceitos, segundo fator confirmado)',
    legado: null,
  },
  portalLogin: {
    codigo: 'portal.conta.entrou',
    descricao: 'Entrada no portal do paciente, aceita ou recusada (PORTAL_LOGIN; sem o e-mail digitado)',
    legado: null,
  },
  portalContaBloqueada: {
    codigo: 'portal.conta.bloqueada',
    descricao: 'Conta do portal bloqueada (tentativas ou decisão) ou desbloqueada, com o motivo',
    legado: null,
  },
  portalContaEncerrada: {
    codigo: 'portal.conta.encerrada',
    descricao: 'Conta do portal encerrada (óbito, unificação, pedido do titular ou decisão do hospital)',
    legado: null,
  },
  portalSegundoFatorTrocado: {
    codigo: 'portal.segundoFator.trocado',
    descricao: 'Segundo fator ou senha da conta do portal trocados (pelo titular ou refeito pelo hospital)',
    legado: null,
  },
  // W0-10: a troca do e-mail de acesso (pedida no portal ou no balcão; vale só com o link confirmado no e-mail novo).
  portalEmailTrocaPedida: {
    codigo: 'portal.email.trocaPedida',
    descricao:
      'Troca do e-mail do portal pedida (portal ou balcão) com o link enviado ao e-mail novo, ou cancelada',
    legado: null,
  },
  portalEmailTrocado: {
    codigo: 'portal.email.trocado',
    descricao: 'E-mail de acesso do portal trocado pela confirmação do link no e-mail novo',
    legado: null,
  },
  portalDocumentoVisto: {
    codigo: 'portal.documento.visto',
    descricao:
      'Resultado ou documento visto ou baixado no portal do paciente (PORTAL_DOCUMENTO_VISTO; data e IP)',
    legado: null,
  },
  portalVinculoPedido: {
    codigo: 'portal.vinculo.pedido',
    descricao: 'Pedido de acesso como responsável legal enviado com a prova de vínculo',
    legado: null,
  },
  portalVinculoDecidido: {
    codigo: 'portal.vinculo.decidido',
    descricao:
      'Vínculo de responsável legal aprovado, recusado, revogado ou encerrado (maioridade, validade)',
    legado: null,
  },
  portalConsentimentoRegistrado: {
    codigo: 'portal.consentimento.registrado',
    descricao: 'Consentimento dado, negado ou revogado pelo portal (finalidade e versão do termo)',
    legado: null,
  },
  portalPedidoTitularRegistrado: {
    codigo: 'portal.pedidoTitular.registrado',
    descricao: 'Pedido do titular aberto pelo portal (tipo e protocolo; a descrição não vai à trilha)',
    legado: null,
  },
  // W0-10: o titular cancela com motivo o pedido não respondido (o protocolado não se edita; nada é apagado).
  portalPedidoTitularCancelado: {
    codigo: 'portal.pedidoTitular.cancelado',
    descricao:
      'Pedido do titular cancelado com motivo pelo portal (protocolo e motivo; a observação não vai à trilha)',
    legado: null,
  },
  // W0-10 (M2): a cópia do prontuário (portal e balcão) sobre o pedido de acesso do titular.
  portalCopiaProntuario: {
    codigo: 'portal.copiaProntuario.ato',
    descricao:
      'Cópia do prontuário: solicitação, legitimidade conferida, cada geração do PDF (com o hash), entrega e download (sem dado clínico)',
    legado: null,
  },
  // W0-10 (M3): a portabilidade do titular (LGPD art. 18 V) em FHIR R4/IPS, gerada no download do pedido atendido.
  portalPortabilidadeIps: {
    codigo: 'portal.portabilidade.ips',
    descricao:
      'Pacote de portabilidade do titular (Bundle FHIR R4/IPS) gerado e baixado pelo portal (protocolo e SHA-256; o pacote não é guardado)',
    legado: null,
  },
  // M50 etapa 2 (ficha, regra 13: AGENDAMENTO_PORTAL, PRECHECKIN_CONFERIDO). A marcação pelo portal vai pela trilha da
  // receita do M17 ou do M18 (o executor); aqui ficam as gravações só do novo.
  agendaOnlineConfigurada: {
    codigo: 'agenda.online.configurada',
    descricao:
      'Agenda liberada, alterada ou retirada do portal do paciente (convênios, serviços, prazos e valor)',
    legado: null,
  },
  portalAgendamento: {
    codigo: 'portal.agendamento.registrado',
    descricao:
      'Marcação, cancelamento ou remarcação feita pelo paciente no portal (AGENDAMENTO_PORTAL; a marcação pelo executor)',
    legado: null,
  },
  portalPreCheckinEnviado: {
    codigo: 'portal.precheckin.enviado',
    descricao: 'Pré-check-in enviado ou reenviado pelo portal (os campos e os documentos não vão à trilha)',
    legado: null,
  },
  portalPreCheckinConferido: {
    codigo: 'portal.precheckin.conferido',
    descricao:
      'Pré-check-in conferido (PRECHECKIN_CONFERIDO; os campos gravados no cadastro) ou recusado pela recepção',
    legado: null,
  },
  portalPagamentoIniciado: {
    codigo: 'portal.pagamento.iniciado',
    descricao: 'Cobrança Pix ou cartão aberta no gateway pelo portal (valor e transação; nada do cartão)',
    legado: null,
  },
  portalPagamentoConfirmado: {
    codigo: 'portal.pagamento.confirmado',
    descricao:
      'Pagamento do portal confirmado, recusado ou vencido (pelo retorno do gateway ou pela conferência)',
    legado: null,
  },
  // W0-10: a tesouraria sobre a cobrança do portal (fatos novos; nada se altera nem se apaga).
  portalPagamentoConciliado: {
    codigo: 'portal.pagamento.conciliado',
    descricao:
      'Cobrança do portal conciliada pela tesouraria (baixa) ou com divergência registrada (valor e referência)',
    legado: null,
  },
  portalPagamentoEstornado: {
    codigo: 'portal.pagamento.estornado',
    descricao: 'Cobrança do portal estornada pelo gateway com motivo (quem estorna não é quem conciliou)',
    legado: null,
  },
  portalPesquisaRespondida: {
    codigo: 'portal.pesquisa.respondida',
    descricao: 'Pesquisa de satisfação respondida no portal (a nota e o comentário não vão à trilha)',
    legado: null,
  },
  portalAcessosConsultados: {
    codigo: 'portal.acessos.consultados',
    descricao: 'Relatório de quem acessou o próprio prontuário consultado no portal (período)',
    legado: null,
  },
  // M49: assinatura ICP-Brasil (regra 12). Payload só com identificadores: documento, certificado (série), provedor,
  // nível e motivo; nunca CPF, nome, conteúdo do documento nem segredo. A consulta ao verificador público reaproveita
  // `documento.validacao.consultada` (M23).
  documentoAssinadoIcp: {
    codigo: 'documento.assinatura.assinado',
    descricao: 'Documento assinado com certificado ICP-Brasil (DOCUMENTO_ASSINADO), um a um ou no lote',
    legado: null,
  },
  assinaturaFalhou: {
    codigo: 'documento.assinatura.falhou',
    descricao:
      'Assinatura recusada ou pendente por falha de revogação, carimbo ou provedor (ASSINATURA_FALHOU)',
    legado: null,
  },
  assinaturaReprocessada: {
    codigo: 'documento.assinatura.reprocessada',
    descricao: 'Assinatura pendente reprocessada, sozinha ou à mão (ASSINATURA_REPROCESSADA)',
    legado: null,
  },
  politicaAssinaturaAlterada: {
    codigo: 'documento.politica.alterada',
    descricao: 'Política de assinatura por tipo de documento alterada (POLITICA_ALTERADA)',
    legado: null,
  },
  certificadoVinculado: {
    codigo: 'documento.certificado.vinculado',
    descricao: 'Certificado ICP-Brasil vinculado ou desvinculado da conta do usuário (CERTIFICADO_VINCULADO)',
    legado: null,
  },
  provedorAssinaturaAlterado: {
    codigo: 'documento.provedor.alterado',
    descricao: 'Provedor de certificado em nuvem cadastrado, alterado ou com o segredo trocado no cofre',
    legado: null,
  },
  provedorAssinaturaTestado: {
    codigo: 'documento.provedor.testado',
    descricao: 'Teste de conexão com o provedor de certificado em nuvem (nada é alterado)',
    legado: null,
  },
  pedidoAssinaturaGravado: {
    codigo: 'documento.assinatura.pedida',
    descricao:
      'Pedido de assinatura ou de vínculo gravado antes da autorização no provedor ou no agente local (sem o state nem o PKCE)',
    legado: null,
  },
  pedidoAssinaturaConsumido: {
    codigo: 'documento.assinatura.autorizacao-consumida',
    descricao:
      'Pedido de assinatura consumido na volta do provedor ou na resposta do agente local (vale uma vez)',
    legado: null,
  },
  // M49, etapa 2: a prévia exata do documento a assinar, o aviso da pendência (regra 5), o PDF assinado baixado e a
  // numeração SNCR (desligada pela chave `receita.sncr`).
  previaAssinaturaGerada: {
    codigo: 'documento.assinatura.previa',
    descricao: 'Prévia exata (PDF/A com o selo) do documento a assinar gerada, com o hash que será assinado',
    legado: null,
  },
  avisoAssinaturaLido: {
    codigo: 'documento.assinatura.aviso-lido',
    descricao:
      'Aviso de assinatura pendente ou em falha marcado como lido pelo autor ou pela direção técnica',
    legado: null,
  },
  documentoAssinadoExportado: {
    codigo: 'documento.assinatura.exportado',
    descricao: 'PDF assinado com ICP-Brasil baixado para validar fora do sistema (validação ao exportar)',
    legado: null,
  },
  sncrSolicitada: {
    codigo: 'documento.sncr.solicitada',
    descricao:
      'Numeração SNCR pedida para a receita de controle especial ou de antimicrobiano (situação e tentativa)',
    legado: null,
  },
  // M49, etapa 3: a consulta ao verificador público (sem login; a origem só mascarada) e a entrada com certificado.
  verificacaoPublicaConsultada: {
    codigo: 'documento.verificacao.consultada',
    descricao:
      'Consulta ao verificador público de documentos pelo código do QR (resultado mostrado; origem mascarada; nada do paciente)',
    legado: null,
  },
  loginCertificadoFalho: {
    codigo: 'sessao.login.certificado-falho',
    descricao:
      'Entrada com certificado ICP-Brasil recusada (desafio vencido, assinatura, cadeia, revogação, CPF ou certificado não vinculado)',
    legado: null,
  },
  // M57, etapa 1: o índice da Rede (MPI). Só identificadores (chave do par e pessoa da Rede); a trilha fica no banco
  // de cada estabelecimento em que a linha do índice foi gravada (cap-07 §7.7.1).
  redeVinculoCriado: {
    codigo: 'rede.vinculo.criado',
    descricao:
      'Dois cadastros da rede ligados à mesma pessoa da Rede (automático ou por decisão humana na fila)',
    legado: null,
  },
  redeVinculoDesfeito: {
    codigo: 'rede.vinculo.desfeito',
    descricao: 'Vínculo entre cadastros da rede desfeito (só a ligação do índice; os cadastros não mudam)',
    legado: null,
  },
  redeParOutraPessoa: {
    codigo: 'rede.par.outraPessoa',
    descricao: 'Par provável da fila da Rede marcado como pessoas diferentes (com a justificativa)',
    legado: null,
  },
  redeFilaAtualizada: {
    codigo: 'rede.fila.atualizada',
    descricao: 'Ciclo de pareamento da Rede (só contagens: lidos, automáticos, na fila, descartados)',
    legado: null,
  },
  redeIndiceReparado: {
    codigo: 'rede.indice.reparado',
    descricao: 'Linha do índice da Rede completada a partir do outro banco (relatório de divergência)',
    legado: null,
  },
  redeFilaLida: {
    codigo: 'rede.fila.lida',
    descricao: 'Fila de prováveis duplicados da Rede consultada (nomes, nascimento e documentos mascarados)',
    legado: null,
  },
  redeParLido: {
    codigo: 'rede.par.lido',
    descricao: 'Comparação lado a lado de um par provável da Rede aberta (os dois cadastros lidos ao vivo)',
    legado: null,
  },
  redeVinculosLidos: {
    codigo: 'rede.vinculos.lidos',
    descricao: 'Vínculos de um cadastro com a pessoa da Rede consultados',
    legado: null,
  },
  redeDivergenciaLida: {
    codigo: 'rede.divergencia.lida',
    descricao: 'Relatório de divergência entre os índices da Rede consultado (só chaves e situações)',
    legado: null,
  },
  // M57, etapa 2: o aviso no cabeçalho do paciente (só contagens e datas do outro estabelecimento) e o acesso cruzado
  // ao prontuário pela regra da DP-42 (regras 6 e 7): a abertura fica na trilha do banco da sessão e a leitura, no
  // banco do estabelecimento em que o registro está, como a Consulta do RES daquele banco (trilha dupla lá).
  redeAvisoLido: {
    codigo: 'rede.aviso.lido',
    descricao:
      'Aviso de atendimentos em outro estabelecimento da rede consultado no cabeçalho do paciente (só contagens)',
    legado: null,
  },
  prontuarioRedeAberto: {
    codigo: 'pep.prontuarioRede.aberto',
    descricao:
      'Pedido de abertura do registro do paciente em outro estabelecimento da rede (estabelecimento, motivo e justificativa)',
    legado: null,
  },
  prontuarioRedeLido: {
    codigo: 'pep.prontuarioRede.lido',
    descricao:
      'Leitura do prontuário pedida por um profissional de outro estabelecimento da rede (gravada no banco onde o registro está)',
    legado: { tipo: 1, criticidade: 7, opcao: 5146 },
  },
  // M57, etapa 2: a unificação de prontuários duplicados no mesmo estabelecimento (cadastro.unificarPaciente).
  pacienteUnificado: {
    codigo: 'cadastro.paciente.unificado',
    descricao:
      'Dois prontuários duplicados do mesmo estabelecimento unificados (o absorvido inativo e apontado para o que fica)',
    legado: null,
  },
  // F3.1 (02-CAD linha 7): desfazer a unificação, com motivo (os registros voltam ao cadastro absorvido).
  pacienteUnificacaoDesfeita: {
    codigo: 'cadastro.paciente.unificacao_desfeita',
    descricao:
      'Unificação de prontuários desfeita com motivo: os registros transferidos voltam ao cadastro absorvido, que é reativado',
    legado: null,
  },
  // M56 (etapa 4, F3): a rede credenciada da operadora própria (SGH_OPE_PRESTADOR e o movimento do RPS na mesma
  // transação). A leitura da ficha do prestador vai à trilha (o CPF do prestador pessoa física é dado pessoal).
  operadoraPrestadorCredenciado: {
    codigo: 'operadora.prestador.credenciado',
    descricao:
      'Prestador credenciado na rede da operadora própria, com o contrato e o movimento de inclusão do RPS',
    legado: null,
  },
  operadoraPrestadorAlterado: {
    codigo: 'operadora.prestador.alterado',
    descricao: 'Credenciamento, contrato ou remuneração do prestador da operadora alterado',
    legado: null,
  },
  operadoraPrestadorDescredenciado: {
    codigo: 'operadora.prestador.descredenciado',
    descricao:
      'Prestador descredenciado da rede da operadora, com substituto ou autorização da ANS e o aviso',
    legado: null,
  },
  operadoraPrestadorReincluido: {
    codigo: 'operadora.prestador.reincluido',
    descricao: 'Prestador descredenciado reincluído na rede da operadora, com o contrato novo',
    legado: null,
  },
  operadoraPrestadorLido: {
    codigo: 'operadora.prestador.lido',
    descricao: 'Ficha do prestador da operadora lida (documento por inteiro)',
    legado: null,
  },
  // M56 (etapa 3, F2): a cobrança e as mensalidades da operadora própria (SGH_OPE_COBRANCA, SGH_OPE_COBRANCA_ITEM e
  // SGH_OPE_REAJUSTE, com a trilha na mesma transação). A lista e a ficha da cobrança levam o nome do pagador (dado
  // pessoal na pessoa física): leituras auditadas.
  operadoraCobrancaGerada: {
    codigo: 'operadora.cobranca.gerada',
    descricao:
      'Cobrança da operadora gerada (mensalidades da competência, coparticipação avulsa ou cobrança avulsa)',
    legado: null,
  },
  operadoraCobrancaBaixada: {
    codigo: 'operadora.cobranca.baixada',
    descricao: 'Cobrança da operadora baixada como paga (com a multa e os juros, ou a dispensa com o motivo)',
    legado: null,
  },
  operadoraCobrancaCancelada: {
    codigo: 'operadora.cobranca.cancelada',
    descricao: 'Cobrança da operadora cancelada, com o motivo',
    legado: null,
  },
  operadoraCobrancaEstornada: {
    codigo: 'operadora.cobranca.estornada',
    descricao: 'Baixa da cobrança da operadora estornada (a cobrança volta a ficar em aberto), com o motivo',
    legado: null,
  },
  operadoraCobrancaAcordo: {
    codigo: 'operadora.cobranca.acordo',
    descricao: 'Acordo de parcelamento feito: as cobranças renegociadas e as parcelas geradas',
    legado: null,
  },
  operadoraCobrancaNotificada: {
    codigo: 'operadora.cobranca.notificada',
    descricao: 'Notificação de inadimplência do contrato registrada (data, meio e referência)',
    legado: null,
  },
  operadoraReajusteRegistrado: {
    codigo: 'operadora.reajuste.registrado',
    descricao: 'Reajuste anual do contrato da operadora registrado (percentual, teto e ofício da ANS)',
    legado: null,
  },
  operadoraReajusteCancelado: {
    codigo: 'operadora.reajuste.cancelado',
    descricao: 'Reajuste do contrato da operadora cancelado antes da cobrança, com o motivo',
    legado: null,
  },
  operadoraCobrancaLida: {
    codigo: 'operadora.cobranca.lida',
    descricao: 'Lista, ficha ou inadimplência da cobrança da operadora lida (nome do pagador)',
    legado: null,
  },
  // M56 (etapa 5, F4): autorização de guias e auditoria médica da operadora própria (SGH_OPE_AUTORIZACAO, os itens e o
  // evento na mesma transação; a designação dos auditores em SGH_OPE_AUDITOR). A ficha do pedido tem conteúdo clínico
  // (CID, indicação, parecer): a leitura vai à trilha.
  operadoraAutorizacaoRegistrada: {
    codigo: 'operadora.autorizacao.registrada',
    descricao: 'Pedido de autorização de guia registrado na operadora, com o protocolo e o prazo de resposta',
    legado: null,
  },
  operadoraAutorizacaoLida: {
    codigo: 'operadora.autorizacao.lida',
    descricao: 'Ficha do pedido de autorização da operadora lida (CID, indicação clínica e parecer)',
    legado: null,
  },
  operadoraAutorizacaoComplementoPedido: {
    codigo: 'operadora.autorizacao.complemento-pedido',
    descricao: 'Complemento pedido ao prestador pelo auditor da operadora',
    legado: null,
  },
  operadoraAutorizacaoComplementoRespondido: {
    codigo: 'operadora.autorizacao.complemento-respondido',
    descricao: 'Complemento do prestador registrado; o pedido volta à análise',
    legado: null,
  },
  operadoraAutorizacaoDecidida: {
    codigo: 'operadora.autorizacao.decidida',
    descricao:
      'Pedido de autorização decidido pelo auditor (autorizado no todo ou em parte, com a senha, ou negado)',
    legado: null,
  },
  operadoraAutorizacaoJuntaAberta: {
    codigo: 'operadora.autorizacao.junta-aberta',
    descricao: 'Junta aberta para a divergência técnica com o profissional solicitante',
    legado: null,
  },
  operadoraAutorizacaoJuntaConcluida: {
    codigo: 'operadora.autorizacao.junta-concluida',
    descricao: 'Junta concluída com o parecer do desempatador e a decisão do pedido',
    legado: null,
  },
  operadoraAutorizacaoCancelada: {
    codigo: 'operadora.autorizacao.cancelada',
    descricao: 'Pedido de autorização cancelado com o motivo',
    legado: null,
  },
  operadoraAuditorDesignado: {
    codigo: 'operadora.auditor.designado',
    descricao: 'Médico ou enfermeiro auditor designado na operadora, com o conselho',
    legado: null,
  },
  operadoraAuditorEncerrado: {
    codigo: 'operadora.auditor.encerrado',
    descricao: 'Designação do auditor da operadora encerrada com o motivo',
    legado: null,
  },
  operadoraAuditorAlterado: {
    codigo: 'operadora.auditor.alterado',
    descricao: 'Dados da designação do auditor da operadora alterados com o motivo',
    legado: null,
  },
  // M56 (etapa 6, F5): contas médicas recebidas pela operadora própria (SGH_OPE_CONTA, as guias, os itens e o evento na
  // mesma transação). A ficha do lote tem conteúdo clínico (procedimentos por beneficiário): a leitura vai à trilha.
  operadoraContaRecebida: {
    codigo: 'operadora.conta.recebida',
    descricao:
      'Lote de contas médicas do prestador recebido em XML TISS, com o protocolo e as glosas automáticas',
    legado: null,
  },
  operadoraContaLida: {
    codigo: 'operadora.conta.lida',
    descricao:
      'Ficha do lote de contas médicas da operadora lida (guias, procedimentos e glosas por beneficiário)',
    legado: null,
  },
  operadoraContaGlosada: {
    codigo: 'operadora.conta.glosada',
    descricao:
      'Glosa de item da conta médica aplicada ou desfeita pelo auditor, com o motivo e a justificativa',
    legado: null,
  },
  operadoraContaAnalisada: {
    codigo: 'operadora.conta.analisada',
    descricao:
      'Análise do lote de contas médicas concluída pelo auditor; o lote fica liberado para pagamento',
    legado: null,
  },
  operadoraContaDevolvida: {
    codigo: 'operadora.conta.devolvida',
    descricao: 'Lote de contas médicas devolvido ao prestador sem pagamento, com o motivo',
    legado: null,
  },
  operadoraContaRecursoRegistrado: {
    codigo: 'operadora.conta.recurso-registrado',
    descricao: 'Recurso de glosa do prestador registrado na guia, com o valor e a justificativa',
    legado: null,
  },
  operadoraContaRecursoDecidido: {
    codigo: 'operadora.conta.recurso-decidido',
    descricao: 'Recurso de glosa decidido pelo auditor (acatado no todo ou em parte, ou glosa mantida)',
    legado: null,
  },
  operadoraContaPaga: {
    codigo: 'operadora.conta.paga',
    descricao: 'Pagamento ao prestador registrado no lote de contas médicas, com o valor e o documento',
    legado: null,
  },
  operadoraContaDemonstrativo: {
    codigo: 'operadora.conta.demonstrativo',
    descricao: 'Demonstrativo de análise da conta (XML TISS) gerado para o prestador',
    legado: null,
  },
  // W0-10 (M8): o demonstrativo de pagamento do lote quitado.
  operadoraContaDemonstrativoPagamento: {
    codigo: 'operadora.conta.demonstrativo-pagamento',
    descricao: 'Demonstrativo de pagamento do lote quitado (XML TISS) gerado para o prestador',
    legado: null,
  },
  // M56 (etapa 7, F6): obrigações com a ANS (SGH_OPE_ENVIO_ANS, os itens e o evento na mesma transação). O SIB e o
  // ressarcimento têm dado pessoal do beneficiário: a leitura da ficha vai à trilha.
  operadoraAnsGerado: {
    codigo: 'operadora.ans.gerado',
    descricao: 'Arquivo de obrigação com a ANS gerado na competência, com o SHA-256 e os totais',
    legado: null,
  },
  operadoraAnsLido: {
    codigo: 'operadora.ans.lido',
    descricao: 'Ficha ou arquivo de envio à ANS lido (beneficiários, atendimentos e valores)',
    legado: null,
  },
  operadoraAnsTransmitido: {
    codigo: 'operadora.ans.transmitido',
    descricao: 'Arquivo enviado à ANS (com o recibo) ou ao simulador fora de produção',
    legado: null,
  },
  operadoraAnsRetorno: {
    codigo: 'operadora.ans.retorno',
    descricao: 'Retorno da ANS registrado no envio (itens aceitos e rejeitados, CCO dos beneficiários)',
    legado: null,
  },
  operadoraAnsPago: {
    codigo: 'operadora.ans.pago',
    descricao: 'GRU da taxa de saúde suplementar ou do ressarcimento ao SUS registrada, com o valor e a data',
    legado: null,
  },
  operadoraAnsComplementoSib: {
    codigo: 'operadora.ans.complemento-sib',
    descricao: 'Endereço, CCO e dados do cadastro de beneficiários na ANS alterados no beneficiário',
    legado: null,
  },
  operadoraAnsAvisoRegistrado: {
    codigo: 'operadora.ans.aviso-registrado',
    descricao: 'Aviso de ressarcimento ao SUS registrado com os atendimentos e a análise de cada um',
    legado: null,
  },
  operadoraAnsItemDecidido: {
    codigo: 'operadora.ans.item-decidido',
    descricao: 'Atendimento do aviso de ressarcimento ao SUS impugnado (com o motivo) ou aceito',
    legado: null,
  },
  operadoraProtocoloRegistrado: {
    codigo: 'operadora.protocolo.registrado',
    descricao:
      'Protocolo de atendimento ao beneficiário registrado, com a natureza, o canal e o prazo da resposta',
    legado: null,
  },
  operadoraProtocoloLido: {
    codigo: 'operadora.protocolo.lido',
    descricao: 'Ficha do protocolo de atendimento lida (o relato e a resposta)',
    legado: null,
  },
  operadoraProtocoloAnalisado: {
    codigo: 'operadora.protocolo.analise',
    descricao: 'Protocolo de atendimento posto em análise',
    legado: null,
  },
  operadoraProtocoloInteracao: {
    codigo: 'operadora.protocolo.interacao',
    descricao: 'Contato registrado no histórico do protocolo de atendimento',
    legado: null,
  },
  operadoraProtocoloProrrogado: {
    codigo: 'operadora.protocolo.prorrogado',
    descricao: 'Prazo do protocolo da ouvidoria prorrogado com o motivo acordado',
    legado: null,
  },
  operadoraProtocoloRespondido: {
    codigo: 'operadora.protocolo.respondido',
    descricao: 'Resposta conclusiva do protocolo de atendimento, com a conclusão e o fundamento',
    legado: null,
  },
  operadoraProtocoloEscritaPedida: {
    codigo: 'operadora.protocolo.escrita-pedida',
    descricao: 'Resposta por escrito pedida pelo beneficiário',
    legado: null,
  },
  operadoraProtocoloEscritaEnviada: {
    codigo: 'operadora.protocolo.escrita-enviada',
    descricao: 'Resposta por escrito do protocolo enviada, com o meio',
    legado: null,
  },
  operadoraProtocoloEncerrado: {
    codigo: 'operadora.protocolo.encerrado',
    descricao: 'Protocolo de atendimento encerrado',
    legado: null,
  },
  operadoraProtocoloCancelado: {
    codigo: 'operadora.protocolo.cancelado',
    descricao: 'Protocolo de atendimento cancelado com o motivo',
    legado: null,
  },
  operadoraProtocoloReanalise: {
    codigo: 'operadora.protocolo.reanalise',
    descricao: 'Reanálise pela ouvidoria pedida, com o novo protocolo',
    legado: null,
  },
  operadoraProtocoloConsultado: {
    codigo: 'operadora.protocolo.consultado',
    descricao: 'Consulta da situação de um protocolo pelo número',
    legado: null,
  },
  operadoraPortalAcessoCriado: {
    codigo: 'operadora.portal.acesso-criado',
    descricao: 'Acesso ao portal do prestador criado, com as funções liberadas e o código de ativação',
    legado: null,
  },
  operadoraPortalAcessoAlterado: {
    codigo: 'operadora.portal.acesso-alterado',
    descricao: 'Funções liberadas do acesso ao portal do prestador alteradas',
    legado: null,
  },
  operadoraPortalAcessoReemitido: {
    codigo: 'operadora.portal.acesso-reemitido',
    descricao:
      'Código de ativação do acesso ao portal do prestador reemitido (a senha e o segundo fator anteriores deixam de valer)',
    legado: null,
  },
  operadoraPortalAcessoEncerrado: {
    codigo: 'operadora.portal.acesso-encerrado',
    descricao: 'Acesso ao portal do prestador encerrado com o motivo',
    legado: null,
  },
  operadoraPortalAtivado: {
    codigo: 'operadora.portal.ativado',
    descricao: 'Acesso ao portal do prestador ativado com a senha e o segundo fator',
    legado: null,
  },
  operadoraPortalEntrada: {
    codigo: 'operadora.portal.entrada',
    descricao: 'Entrada no portal do prestador (sucesso ou falha)',
    legado: null,
  },
  operadoraPortalSenhaTrocada: {
    codigo: 'operadora.portal.senha-trocada',
    descricao:
      'Senha do portal do prestador trocada pelo próprio prestador (senha atual e código do aplicativo conferidos)',
    legado: null,
  },
  operadoraPortalAutenticadorTrocado: {
    codigo: 'operadora.portal.autenticador-trocado',
    descricao:
      'Aplicativo autenticador do portal do prestador trocado (senha e código do atual conferidos; o novo confirmado por código)',
    legado: null,
  },
  operadoraPortalComplementoRespondido: {
    codigo: 'operadora.portal.complemento-respondido',
    descricao:
      'Complemento pedido pelo auditor respondido pelo prestador no portal (texto e anexos guardados sem edição)',
    legado: null,
  },
  operadoraPortalInteracaoRespondida: {
    codigo: 'operadora.portal.interacao-respondida',
    descricao:
      'Interação da operadora no protocolo respondida pelo prestador no portal (texto e anexo guardados sem edição)',
    legado: null,
  },
  operadoraPortalElegibilidadeConsultada: {
    codigo: 'operadora.portal.elegibilidade-consultada',
    descricao:
      'Elegibilidade do beneficiário consultada pelo prestador no portal (carteirinha, validade, carências e cobertura; a consulta fica registrada)',
    legado: null,
  },
  operadoraPortalLoteEnviado: {
    codigo: 'operadora.portal.lote-enviado',
    descricao:
      'Lote XML TISS enviado pelo prestador no portal (validado no XSD e no hash, guardado sem edição, com o protocolo)',
    legado: null,
  },
  // C2-074 (08-SGO L113): pedido de cadastro e alteração do prestador, avisos e regras de arquivo do portal.
  operadoraPortalPedidoEnviado: {
    codigo: 'operadora.portal.pedido-enviado',
    descricao:
      'Pedido de alteração do próprio cadastro enviado pelo prestador no portal (guardado para a análise da operadora)',
    legado: null,
  },
  operadoraPortalPedidoDecidido: {
    codigo: 'operadora.portal.pedido-decidido',
    descricao:
      'Pedido do prestador analisado, aprovado, recusado com motivo ou cancelado pelo próprio prestador',
    legado: null,
  },
  operadoraPortalAvisoPublicado: {
    codigo: 'operadora.portal.aviso-publicado',
    descricao: 'Aviso à rede credenciada publicado ou retirado do portal do prestador (nunca apagado)',
    legado: null,
  },
  operadoraPortalRegraArquivo: {
    codigo: 'operadora.portal.regra-arquivo',
    descricao: 'Regra de documento exigido por tipo de prestador incluída ou inativada (nunca apagada)',
    legado: null,
  },
  // W0-10 (M8): o recurso de glosa por item enviado pelo prestador no portal.
  operadoraPortalRecursoItemEnviado: {
    codigo: 'operadora.portal.recurso-item-enviado',
    descricao:
      'Recurso de glosa por item enviado pelo prestador no portal (registro novo ligado à guia e a cada item, com a justificativa)',
    legado: null,
  },
  // W0-10 (M8): a decisão da operadora sobre o recurso por item (outra pessoa, item a item).
  operadoraContaRecursoItensDecidido: {
    codigo: 'operadora.conta.recurso-itens-decidido',
    descricao:
      'Recurso de glosa por item decidido pelo auditor da operadora, item a item, com o parecer (a guia pela soma)',
    legado: null,
  },
  operadoraPortalDemonstrativoBaixado: {
    codigo: 'operadora.portal.demonstrativo-baixado',
    descricao: 'Demonstrativo de análise da conta baixado pelo prestador no portal (XML TISS)',
    legado: null,
  },
  operadoraPortalDemonstrativoPagamentoBaixado: {
    codigo: 'operadora.portal.demonstrativo-pagamento-baixado',
    descricao: 'Demonstrativo de pagamento do lote baixado pelo prestador no portal (XML TISS)',
    legado: null,
  },
  operadoraPortalSaida: {
    codigo: 'operadora.portal.saida',
    descricao: 'Saída do portal do prestador',
    legado: null,
  },
  operadoraPortalAutorizacaoLida: {
    codigo: 'operadora.portal.autorizacao-lida',
    descricao: 'Pedidos de autorização do prestador lidos no portal',
    legado: null,
  },
  // M45, etapa 1 (regra 16): formulários novos. Nunca o conteúdo das respostas; só código, versão e hash.
  formularioNovoSalvo: {
    codigo: 'pep.formularioNovo.salvo',
    descricao: 'Rascunho de formulário novo salvo no construtor (código e versão; casos de teste executados)',
    legado: null,
  },
  formularioNovoRevisao: {
    codigo: 'pep.formularioNovo.revisao',
    descricao:
      'Formulário novo enviado à revisão, aprovado ou devolvido pela comissão de prontuário (com o parecer)',
    legado: null,
  },
  formularioNovoPublicado: {
    codigo: 'pep.formularioNovo.publicado',
    descricao:
      'FORMULARIO_NOVO_PUBLICADO da ficha: versão de formulário novo publicada (código, versão, content_hash e modelo do prontuário criado ou ponte usada)',
    legado: null,
  },
  formularioNovoAposentado: {
    codigo: 'pep.formularioNovo.aposentado',
    descricao: 'Versão publicada de formulário novo aposentada, com o motivo',
    legado: null,
  },
  // M57, etapa 3: o BI consolidado da Rede (só agregados) e o registro dos serviços compartilhados.
  biRedeConsultado: {
    codigo: 'relatorio.biRede.consultado',
    descricao:
      'BI consolidado da Rede consultado (indicadores, painel operacional ou financeiro; só contagens e somas por estabelecimento)',
    legado: null,
  },
  biRedeExportado: {
    codigo: 'relatorio.biRede.exportado',
    descricao:
      'Série consolidada de um indicador da Rede exportada (planilha com as parcelas de cada estabelecimento)',
    legado: null,
  },
  redeServicoRegistrado: {
    codigo: 'rede.servico.registrado',
    descricao: 'Oportunidade de serviço compartilhado da Rede registrada (sem compromisso de escopo)',
    legado: null,
  },
  redeServicoAlterado: {
    codigo: 'rede.servico.alterado',
    descricao: 'Registro de serviço compartilhado da Rede alterado (situação, título, área ou envolvidos)',
    legado: null,
  },
  redeServicosLidos: {
    codigo: 'rede.servicos.lidos',
    descricao: 'Lista dos serviços compartilhados da Rede consultada',
    legado: null,
  },
  // M45 (etapa 3): balanço hídrico (regra 16: BALANCO_FECHADO; sem dado pessoal, só identificadores e volumes).
  balancoLido: {
    codigo: 'enfermagem.balanco.lido',
    descricao: 'Balanço hídrico do paciente consultado (lançamentos, ganhos da checagem, fechamentos)',
    legado: null,
  },
  balancoLancado: {
    codigo: 'enfermagem.balanco.lancado',
    descricao: 'Ganho ou perda lançado no balanço hídrico (grupo ou tipo de eliminação, volume e hora real)',
    legado: null,
  },
  balancoEstornado: {
    codigo: 'enfermagem.balanco.estornado',
    descricao: 'Lançamento do balanço hídrico estornado com o motivo (o lançamento original fica guardado)',
    legado: null,
  },
  balancoFechado: {
    codigo: 'enfermagem.balanco.fechado',
    descricao:
      'BALANCO_FECHADO da ficha: balanço hídrico fechado (parcial ou 24 horas) com as parcelas, o saldo e o débito urinário; os ganhos da checagem e a diurese dos sinais entram na mesma transação',
    legado: null,
  },
  // M50 (etapa 5): portaria e visitantes (regra 13: VISITA_REGISTRADA e VISITA_BLOQUEADA; sem dado pessoal na trilha,
  // só identificadores, códigos e horários).
  portariaLida: {
    codigo: 'hotelaria.visita.lida',
    descricao:
      'Portaria consultada: busca do paciente para a visita, visitas em curso ou cadastro do visitante',
    legado: null,
  },
  visitanteRegistrado: {
    codigo: 'hotelaria.visitante.registrado',
    descricao: 'Cadastro mínimo do visitante incluído ou atualizado (documento, foto e o prazo de retenção)',
    legado: null,
  },
  visitaRegistrada: {
    codigo: 'hotelaria.visita.registrada',
    descricao:
      'VISITA_REGISTRADA da ficha: entrada do visitante com o crachá e a validade (e a exceção autorizada, se houve)',
    legado: null,
  },
  visitaEncerrada: {
    codigo: 'hotelaria.visita.encerrada',
    descricao: 'Saída do visitante registrada (na portaria ou pela catraca)',
    legado: null,
  },
  visitaRegraDefinida: {
    codigo: 'hotelaria.visita.regraDefinida',
    descricao:
      'Regra de visita da unidade definida (horário, visitantes ao mesmo tempo, idade, UTI, isolamento)',
    legado: null,
  },
  visitaBloqueada: {
    codigo: 'hotelaria.visita.bloqueada',
    descricao:
      'VISITA_BLOQUEADA da ficha: bloqueio da visita a um paciente (pedido, ordem judicial, decisão clínica ou sigilo)',
    legado: null,
  },
  visitaBloqueioRevogado: {
    codigo: 'hotelaria.visita.bloqueioRevogado',
    descricao: 'Bloqueio da visita a um paciente revogado, com o motivo (o bloqueio fica guardado)',
    legado: null,
  },
  acompanhanteRegistrado: {
    codigo: 'hotelaria.acompanhante.registrado',
    descricao:
      'Acompanhante com direito legal registrado (ou trocado) com o fundamento, a refeição e o pernoite',
    legado: null,
  },
  acompanhanteEncerrado: {
    codigo: 'hotelaria.acompanhante.encerrado',
    descricao: 'Fim do acompanhamento registrado, com o motivo',
    legado: null,
  },
  terminalConfigurado: {
    codigo: 'hotelaria.terminal.configurado',
    descricao: 'Terminal ou catraca da portaria cadastrado ou alterado',
    legado: null,
  },
  crachaColaborador: {
    codigo: 'hotelaria.catraca.crachaColaborador',
    descricao: 'Crachá do colaborador ligado à matrícula (ou retirado) para a catraca da portaria',
    legado: null,
  },
  catracaEvento: {
    codigo: 'hotelaria.catraca.evento',
    descricao: 'Passagem do crachá na catraca (liberada ou negada, com o motivo)',
    legado: null,
  },
  contatosEmitidos: {
    codigo: 'hotelaria.visita.contatosEmitidos',
    descricao:
      'Relatório de contatos de visita emitido para a investigação de surto (paciente ou unidade e período)',
    legado: null,
  },
  visitantesExpurgados: {
    codigo: 'hotelaria.visitante.expurgados',
    descricao:
      'Cadastros de visitante com o prazo de retenção vencido anonimizados (nome, documento, telefone e foto)',
    legado: null,
  },
  // M45 (etapa 4): o processo de enfermagem, a prescrição de enfermagem, a prescrição de medicamento pelo enfermeiro e a
  // vacina aplicada (regra 16: SAE_REGISTRADA e CUIDADO_PRESCRITO; sem dado pessoal, só identificadores e códigos).
  saeLida: {
    codigo: 'enfermagem.sae.lida',
    descricao: 'Processo de enfermagem do paciente ou prescrição de enfermagem do turno consultados',
    legado: null,
  },
  saeRegistrada: {
    codigo: 'enfermagem.sae.registrada',
    descricao:
      'SAE_REGISTRADA da ficha: processo de enfermagem registrado ou revisado (avaliação, diagnósticos, resultados com a meta e intervenções), privativo do enfermeiro',
    legado: null,
  },
  saeEvoluida: {
    codigo: 'enfermagem.sae.evoluida',
    descricao: 'Evolução de enfermagem registrada com os resultados reavaliados frente à meta',
    legado: null,
  },
  saeTerminologiaCarregada: {
    codigo: 'enfermagem.sae.terminologiaCarregada',
    descricao: 'Versão da terminologia do processo de enfermagem carregada com a licença (DP-19)',
    legado: null,
  },
  cuidadoPrescrito: {
    codigo: 'enfermagem.cuidado.prescrito',
    descricao:
      'CUIDADO_PRESCRITO da ficha: atividades de enfermagem prescritas com a frequência e os horários aprazados',
    legado: null,
  },
  cuidadoSuspenso: {
    codigo: 'enfermagem.cuidado.suspenso',
    descricao: 'Atividade da prescrição de enfermagem suspensa com o motivo',
    legado: null,
  },
  cuidadoChecado: {
    codigo: 'enfermagem.cuidado.checado',
    descricao: 'Horário da atividade de enfermagem checado (feito, ou não feito com o motivo)',
    legado: null,
  },
  cuidadoEstornado: {
    codigo: 'enfermagem.cuidado.estornado',
    descricao:
      'Checagem do cuidado de enfermagem estornada com a justificativa (a checagem original fica guardada)',
    legado: null,
  },
  receitaEnfermeiroLida: {
    codigo: 'enfermagem.prescricaoMedicamento.lida',
    descricao: 'Receitas de medicamento do enfermeiro na consulta de enfermagem consultadas',
    legado: null,
  },
  receitaEnfermeiroAssinada: {
    codigo: 'enfermagem.prescricaoMedicamento.assinada',
    descricao:
      'Receita de medicamento do enfermeiro assinada pelo protocolo publicado (conteúdo mínimo da Res. COFEN 801/2026; impressão SHA-256)',
    legado: null,
  },
  vacinaLida: {
    codigo: 'enfermagem.vacina.lida',
    descricao: 'Vacinas aplicadas no paciente consultadas',
    legado: null,
  },
  vacinaRegistrada: {
    codigo: 'enfermagem.vacina.registrada',
    descricao:
      'Vacina aplicada registrada (imunobiológico, lote, dose, via e local) com o evento do envio na fila de saída',
    legado: null,
  },
  // M50 (etapa 3): o portal do médico externo (a conta do portal de resultados do M26). Sem dado pessoal: a conta, o
  // profissional e o pedido pelos identificadores.
  portalMedicoVinculado: {
    codigo: 'portal.medico.vinculado',
    descricao:
      'Conta do portal do médico externo ligada ao profissional do corpo clínico (o profissional na chave)',
    legado: null,
  },
  portalMedicoDesvinculado: {
    codigo: 'portal.medico.desvinculado',
    descricao:
      'Conta do portal do médico externo desligada do profissional do corpo clínico (o profissional anterior na chave)',
    legado: null,
  },
  portalMedicoContasLidas: {
    codigo: 'portal.medico.contasLidas',
    descricao:
      'Contas do portal do médico externo e os profissionais ligados consultados pela equipe interna',
    legado: null,
  },
  portalMedicoExtratoLido: {
    codigo: 'portal.medico.extratoLido',
    descricao: 'Extrato de produção e repasse aberto pelo médico externo no portal (só o dele)',
    legado: null,
  },
  portalMedicoAgendaLida: {
    codigo: 'portal.medico.agendaLida',
    descricao: 'Agenda cirúrgica e pedidos abertos pelo médico externo no portal (só os dele)',
    legado: null,
  },
  portalMedicoCirurgiaPedida: {
    codigo: 'portal.medico.cirurgiaPedida',
    descricao:
      'Cirurgia pedida pelo médico externo no portal (solicitada: não ocupa a sala até a confirmação)',
    legado: null,
  },
  portalMedicoPedidoRetirado: {
    codigo: 'portal.medico.pedidoRetirado',
    descricao: 'Pedido de cirurgia retirado pelo médico externo no portal antes da confirmação',
    legado: null,
  },
  // W0-10: os atos do hospital sobre a conta do médico externo (fato novo em SGH_SADT_PORTAL_CONTA_ATO; o motivo fica
  // na tabela, não na trilha).
  portalMedicoContaBloqueada: {
    codigo: 'portal.medico.contaBloqueada',
    descricao: 'Conta do portal do médico externo bloqueada pelo hospital, com motivo',
    legado: null,
  },
  portalMedicoContaDesbloqueada: {
    codigo: 'portal.medico.contaDesbloqueada',
    descricao: 'Conta do portal do médico externo desbloqueada pelo hospital, com motivo',
    legado: null,
  },
  portalMedicoContaEncerrada: {
    codigo: 'portal.medico.contaEncerrada',
    descricao:
      'Conta do portal do médico externo encerrada pelo hospital, com motivo e a decisão sobre os pedidos pendentes',
    legado: null,
  },
  // W0-10: o médico troca a senha e o e-mail da própria conta (ato em SGH_SADT_PORTAL_CONTA_ATO; o e-mail não vai à trilha).
  portalMedicoSenhaTrocada: {
    codigo: 'portal.medico.senhaTrocada',
    descricao: 'Senha da conta do portal do médico externo trocada pelo próprio médico',
    legado: null,
  },
  portalMedicoEmailTrocaPedida: {
    codigo: 'portal.medico.emailTrocaPedida',
    descricao:
      'Troca do e-mail da conta do portal do médico externo pedida (link enviado ao e-mail novo) ou cancelada',
    legado: null,
  },
  portalMedicoEmailTrocado: {
    codigo: 'portal.medico.emailTrocado',
    descricao: 'E-mail da conta do portal do médico externo trocado, confirmado pelo link do e-mail novo',
    legado: null,
  },
  portalMedicoPedidoRetiradoNoEncerramento: {
    codigo: 'portal.medico.pedidoRetiradoNoEncerramento',
    descricao:
      'Pedido de cirurgia não confirmado retirado pelo hospital no encerramento da conta do médico externo',
    legado: null,
  },
  // W0-10: o médico altera o próprio pedido ainda não confirmado (a versão anterior e o motivo em SGH_CC_PEDIDO_VERSAO).
  portalMedicoPedidoAlterado: {
    codigo: 'portal.medico.pedidoAlterado',
    descricao:
      'Pedido de cirurgia não confirmado alterado pelo médico externo no portal (versão anterior guardada, com motivo)',
    legado: null,
  },
  // W0-10 (M4): meus pacientes e o acesso remoto ao prontuário (momento, responsável e registro; o negado também).
  portalMedicoPacientesLidos: {
    codigo: 'portal.medico.pacientesLidos',
    descricao: 'Lista dos pacientes com vínculo assistencial aberta pelo médico externo no portal',
    legado: null,
  },
  portalMedicoProntuarioAcessado: {
    codigo: 'portal.medico.prontuarioAcessado',
    descricao:
      'Resumo do prontuário aberto pelo médico externo no portal (acesso remoto; negado sem vínculo assistencial)',
    legado: null,
  },
  // W0-10 (M5): o aviso de resultado crítico ao médico assistente externo (só identificadores; nunca o valor nem o nome).
  portalMedicoCriticosLidos: {
    codigo: 'portal.medico.criticosLidos',
    descricao:
      'Avisos de resultado crítico dos pacientes com vínculo assistencial abertos pelo médico externo no portal',
    legado: null,
  },
  portalMedicoCriticoNotificado: {
    codigo: 'portal.medico.criticoNotificado',
    descricao:
      'Médico externo notificado do aviso de resultado crítico de paciente seu (simulador no dev; Hal-AI quando ligada; desligado com motivo)',
    legado: null,
  },
  portalMedicoCriticoCiente: {
    codigo: 'portal.medico.criticoCiente',
    descricao:
      'Ciência do resultado crítico registrada pelo médico externo no portal, com a conduta (registro novo)',
    legado: null,
  },
  // W0-10 (M6): a fila de assinatura remota (só identificadores e contadores; a assinatura em si vai aos eventos do M49).
  portalMedicoAssinaturasLidas: {
    codigo: 'portal.medico.assinaturasLidas',
    descricao: 'Fila de documentos pendentes de assinatura aberta pelo médico externo no portal',
    legado: null,
  },
  portalMedicoAssinaturaPedida: {
    codigo: 'portal.medico.assinaturaPedida',
    descricao:
      'Assinatura remota pedida pelo médico externo no portal (o lote vai ao provedor do certificado em nuvem)',
    legado: null,
  },
  portalMedicoAssinaturaConcluida: {
    codigo: 'portal.medico.assinaturaConcluida',
    descricao:
      'Volta do provedor da assinatura remota no portal do médico externo (assinados, pendentes e recusados)',
    legado: null,
  },
  // M45, etapa 2 (regra 16): escores, reavaliações, classificação de pacientes e índices de UTI. Só identificadores,
  // a escala, a versão da regra, o total e a faixa; nunca nome nem texto clínico.
  escoreRegistrado: {
    codigo: 'enfermagem.escore.registrado',
    descricao:
      'ESCORE_REGISTRADO da ficha: escore registrado (escala, versão da regra, total, faixa e gatilho), na aferição ou na tela',
    legado: null,
  },
  escoresLidos: {
    codigo: 'enfermagem.escore.lido',
    descricao: 'Escores e reavaliações do paciente ou da unidade lidos (leitura de prontuário)',
    legado: null,
  },
  regraEscorePublicada: {
    codigo: 'enfermagem.regraEscore.publicada',
    descricao: 'REGRA_ESCORE_PUBLICADA da ficha: nova versão das faixas de uma escala (impressão SHA-256)',
    legado: null,
  },
  reavaliacaoProgramada: {
    codigo: 'enfermagem.reavaliacao.programada',
    descricao:
      'Reavaliação de Braden ou Morse programada (admissão, diária ou mudança de quadro) ou dispensada com o motivo',
    legado: null,
  },
  pacienteClassificado: {
    codigo: 'enfermagem.classificacao.registrada',
    descricao: 'Paciente classificado no turno pelo Fugulin ou pelo NAS (total, categoria e horas)',
    legado: null,
  },
  classificacaoLida: {
    codigo: 'enfermagem.classificacao.lida',
    descricao: 'Classificação de pacientes e carga da unidade lidas',
    legado: null,
  },
  indiceUtiRegistrado: {
    codigo: 'pep.indiceUti.registrado',
    descricao: 'Índice de gravidade da UTI registrado (APACHE II ou SOFA; pontuação e mortalidade esperada)',
    legado: null,
  },
  indiceUtiValidado: {
    codigo: 'pep.indiceUti.validado',
    descricao: 'INDICE_UTI_VALIDADO da ficha: índice de gravidade validado pelo médico com conselho ativo',
    legado: null,
  },
  indicesUtiLidos: {
    codigo: 'pep.indiceUti.lido',
    descricao: 'Índices de gravidade do paciente ou a razão de mortalidade padronizada do período lidos',
    legado: null,
  },
  // M45, etapa 5 (regra 16): nutrição, mapa de dietas, acompanhante e serviço social. Sem conteúdo clínico nem nome:
  // só identificadores, o instrumento, o total, o risco e o retrato (hash).
  nutricaoFilaLida: {
    codigo: 'pep.nutricaoFila.lida',
    descricao: 'Fila da nutrição lida (internados a triar, com nomes): lista auditada',
    legado: null,
  },
  nutricaoTriagemRegistrada: {
    codigo: 'pep.nutricaoTriagem.registrada',
    descricao: 'Triagem nutricional registrada (instrumento, versão da regra, total calculado e risco)',
    legado: null,
  },
  terapiaNutricionalLida: {
    codigo: 'pep.terapiaNutricional.lida',
    descricao: 'Terapia nutricional do paciente lida (metas, acompanhamentos e checagens da dieta)',
    legado: null,
  },
  terapiaNutricionalRegistrada: {
    codigo: 'pep.terapiaNutricional.registrada',
    descricao: 'Meta ou acompanhamento diário da terapia nutricional registrado (percentual atingido)',
    legado: null,
  },
  mapaDietaLido: {
    codigo: 'hotelaria.mapaDieta.lido',
    descricao: 'Mapa de dietas da unidade e refeição lido (lista com nomes, alergias e jejum)',
    legado: null,
  },
  mapaDietaFechado: {
    codigo: 'hotelaria.mapaDieta.fechado',
    descricao:
      'Mapa de dietas da refeição fechado no corte (retrato com o hash do conteúdo; nunca regravado)',
    legado: null,
  },
  etiquetaBandejaImpressa: {
    codigo: 'hotelaria.etiquetaBandeja.impressa',
    descricao: 'Etiquetas de bandeja geradas em ZPL (unidade, refeição, quantidade e o hash do conteúdo)',
    legado: null,
  },
  dietaAcompanhanteRegistrada: {
    codigo: 'hotelaria.dietaAcompanhante.registrada',
    descricao: 'Refeição do acompanhante com direito legal registrada ou encerrada (base legal e refeições)',
    legado: null,
  },
  avaliacaoSocialLida: {
    codigo: 'pep.avaliacaoSocial.lida',
    descricao: 'Serviço social do paciente lido (o parecer só pela categoria; dado sensível)',
    legado: null,
  },
  avaliacaoSocialRegistrada: {
    codigo: 'pep.avaliacaoSocial.registrada',
    descricao: 'Avaliação ou evolução do serviço social registrada (risco; barreira social enviada ao NIR)',
    legado: null,
  },
  // M45, etapa 6 (regra 16; DP-32): especialidades sob demanda e o lactário. Sem conteúdo clínico nem nome: só os
  // identificadores, o código e a versão do protocolo, o número do ciclo, as contagens e o hash.
  especialidadeLida: {
    codigo: 'pep.especialidade.lida',
    descricao:
      'Registros da especialidade do paciente lidos (oftalmologia, oncologia ou obstetrícia) ou a lista de internações para escolher',
    legado: null,
  },
  exameOftalmologicoRegistrado: {
    codigo: 'pep.exameOftalmologico.registrado',
    descricao: 'Exame oftalmológico registrado (classificação da visão e os alertas de pressão intraocular)',
    legado: null,
  },
  protocoloOncologicoPublicado: {
    codigo: 'pep.protocoloOncologico.publicado',
    descricao:
      'Versão de protocolo de quimioterapia publicada (código, versão e o hash do conteúdo; imutável)',
    legado: null,
  },
  cicloOncologicoRegistrado: {
    codigo: 'pep.cicloOncologico.registrado',
    descricao: 'Ciclo de quimioterapia registrado (protocolo, número do ciclo e a redução de dose)',
    legado: null,
  },
  cicloOncologicoPrescricaoVinculada: {
    codigo: 'pep.cicloOncologico.prescricaoVinculada',
    descricao: 'Prescrição geral dos medicamentos ligada ao ciclo de quimioterapia (o número da prescrição)',
    legado: null,
  },
  cicloOncologicoValidado: {
    codigo: 'pep.cicloOncologico.validado',
    descricao:
      'Ciclo de quimioterapia validado pelo farmacêutico com a dupla checagem independente das doses',
    legado: null,
  },
  partogramaRegistrado: {
    codigo: 'pep.partograma.registrado',
    descricao: 'Observação do partograma registrada (os alertas, sem os valores clínicos)',
    legado: null,
  },
  recemNascidoRegistrado: {
    codigo: 'pep.recemNascido.registrado',
    descricao: 'Recém-nascido registrado (as classificações da idade gestacional, do peso e do Apgar)',
    legado: null,
  },
  lactarioLido: {
    codigo: 'hotelaria.lactario.lido',
    descricao: 'Produção do lactário lida (ordens por paciente e horário; lista com nomes)',
    legado: null,
  },
  ordemLactarioRegistrada: {
    codigo: 'hotelaria.ordemLactario.registrada',
    descricao: 'Ordem de produção do lactário registrada (porções, volume e validade)',
    legado: null,
  },
  ordemLactarioConferida: {
    codigo: 'hotelaria.ordemLactario.conferida',
    descricao: 'Ordem de produção do lactário conferida por outra pessoa',
    legado: null,
  },
  etiquetaLactarioImpressa: {
    codigo: 'hotelaria.etiquetaLactario.impressa',
    descricao: 'Etiquetas do lactário geradas em ZPL (ordem, quantidade e o hash do conteúdo)',
    legado: null,
  },
  // W0-05 (programa CRUD completo): correção, estorno, versão, cancelamento e alteração da nutrição, do social, da
  // oncologia e do lactário. Sem conteúdo clínico: o registro, a ação e os identificadores (o motivo fica na tabela SGH_
  // do registro, a versão anterior clínica na própria versão).
  nutricaoRegistroCorrigido: {
    codigo: 'pep.nutricaoRegistro.corrigido',
    descricao:
      'Registro da nutrição corrigido: triagem ou acompanhamento retificado ou estornado, meta da EMTN alterada (nova versão) ou encerrada',
    legado: null,
  },
  nptAvaliada: {
    codigo: 'pep.terapiaNutricional.nptAvaliada',
    descricao: 'Avaliação farmacêutica da formulação de NPT registrada (o parecer e o acesso)',
    legado: null,
  },
  avaliacaoSocialCorrigida: {
    codigo: 'pep.avaliacaoSocial.corrigida',
    descricao: 'Registro do serviço social complementado por adendo ou estornado (inativo e visível)',
    legado: null,
  },
  dietaAcompanhanteAlterada: {
    codigo: 'hotelaria.dietaAcompanhante.alterada',
    descricao: 'Refeição do acompanhante alterada (a dieta, as refeições ou o fim; o valor anterior no log)',
    legado: null,
  },
  protocoloOncologicoAlterado: {
    codigo: 'pep.protocoloOncologico.alterado',
    descricao:
      'Protocolo de quimioterapia: versão revogada (com a contagem dos ciclos) ou protocolo inativado ou reativado',
    legado: null,
  },
  cicloOncologicoAlterado: {
    codigo: 'pep.cicloOncologico.alterado',
    descricao:
      'Ciclo de quimioterapia ajustado antes da validação, suspenso, retomado ou cancelado (a categoria do motivo)',
    legado: null,
  },
  cicloOncologicoPrescricaoDesligada: {
    codigo: 'pep.cicloOncologico.prescricaoDesligada',
    descricao: 'Ligação do ciclo com a prescrição desfeita (só o vínculo do novo; a prescrição não é tocada)',
    legado: null,
  },
  ordemLactarioAlterada: {
    codigo: 'hotelaria.ordemLactario.alterada',
    descricao: 'Ordem do lactário alterada antes da conferência (o valor anterior no log)',
    legado: null,
  },
  ordemLactarioCancelada: {
    codigo: 'hotelaria.ordemLactario.cancelada',
    descricao: 'Ordem do lactário cancelada com o motivo (continua visível como cancelada)',
    legado: null,
  },
  // M55 (fatia F2): rouparia e lavanderia. Sem dado de pessoa: o setor, a peça, os quilos e as quantidades.
  roupariaLida: {
    codigo: 'hotelaria.rouparia.lida',
    descricao: 'Rouparia lida (movimentos, cotas, enxoval, quilos por setor ou indicadores)',
    legado: null,
  },
  movimentoRoupaRegistrado: {
    codigo: 'hotelaria.movimentoRoupa.registrado',
    descricao:
      'Movimento da rouparia registrado (coleta, envio, retorno com a conferência, entrega, perda ou inventário)',
    legado: null,
  },
  movimentoRoupaCancelado: {
    codigo: 'hotelaria.movimentoRoupa.cancelado',
    descricao: 'Movimento da rouparia cancelado, com o motivo',
    legado: null,
  },
  pecaRoupaGravada: {
    codigo: 'hotelaria.pecaRoupa.gravada',
    descricao: 'Peça ou kit do enxoval cadastrado ou alterado',
    legado: null,
  },
  cotaRoupaGravada: {
    codigo: 'hotelaria.cotaRoupa.gravada',
    descricao: 'Cotas de roupa do setor gravadas',
    legado: null,
  },
  // M50, etapa 6 (regra 13): agenda de sessões e digitalização certificada. Sem dado clínico nem nome: identificadores,
  // a série, o recurso, o tipo documental e o resumo do arquivo.
  sessaoGradeLida: {
    codigo: 'agenda.sessaoGrade.lida',
    descricao:
      'Grade da agenda de sessões lida (cadeiras e salas com os pacientes do período): lista auditada',
    legado: null,
  },
  sessaoAgendada: {
    codigo: 'agenda.sessao.agendada',
    descricao: 'Série de sessões agendada (recurso, quantidade, intervalo e o tipo do plano terapêutico)',
    legado: null,
  },
  sessaoAtualizada: {
    codigo: 'agenda.sessao.atualizada',
    descricao: 'Sessão registrada como realizada, falta ou cancelada (ou as restantes da série canceladas)',
    legado: null,
  },
  digitalizacaoLida: {
    codigo: 'hotelaria.digitalizacao.lida',
    descricao:
      'Fila da digitalização certificada ou o documento digitalizado lido (o arquivo aberto vai à trilha)',
    legado: null,
  },
  documentoDigitalizado: {
    codigo: 'hotelaria.documento.digitalizado',
    descricao:
      'Documento em papel capturado e indexado (prontuário, tipo documental, páginas, resolução e o resumo SHA-256)',
    legado: null,
  },
  digitalizacaoConferida: {
    codigo: 'hotelaria.digitalizacao.conferida',
    descricao: 'Fidelidade do documento digitalizado conferida com o papel (fiel ou recusado, com o motivo)',
    legado: null,
  },
  digitalizacaoAssinada: {
    codigo: 'hotelaria.digitalizacao.assinada',
    descricao:
      'Documento digitalizado assinado com o certificado ICP-Brasil de quem conferiu, com o carimbo do tempo',
    legado: null,
  },
  // M50, etapa 4 (regra 13; regra 7): telemedicina. Só identificadores, a modalidade, a versão do termo e a situação;
  // nunca o local informado, o motivo nem o parecer.
  teleconsultaAgendada: {
    codigo: 'atendimento.teleconsulta.agendada',
    descricao: 'Teleconsulta registrada na marcação feita pelo portal (a marcação pelo executor do M17)',
    legado: null,
  },
  teleconsultaSalaEspera: {
    codigo: 'atendimento.teleconsulta.salaEspera',
    descricao:
      'Paciente na sala de espera virtual: termo da teleconsulta aceito (a versão na chave) e local informado',
    legado: null,
  },
  teleconsultaSalaAberta: {
    codigo: 'atendimento.teleconsulta.salaAberta',
    descricao: 'Sala da teleconsulta aberta pelo médico no provedor (a declaração do médico na chave)',
    legado: null,
  },
  teleconsultaIniciada: {
    codigo: 'atendimento.teleconsulta.iniciada',
    descricao:
      'TELECONSULTA_INICIADA da ficha: atendimento de teleconsulta aberto pela receita do M20 (o REG no alvo)',
    legado: null,
  },
  teleconsultaPacienteEntrou: {
    codigo: 'atendimento.teleconsulta.pacienteEntrou',
    descricao: 'Paciente entrou na sala do médico pela sala de espera do portal',
    legado: null,
  },
  teleconsultaEncerrada: {
    codigo: 'atendimento.teleconsulta.encerrada',
    descricao: 'Teleconsulta encerrada pelo médico (o motivo codificado na chave)',
    legado: null,
  },
  teleconsultaCancelada: {
    codigo: 'atendimento.teleconsulta.cancelada',
    descricao:
      'Teleconsulta cancelada com a marcação (cancelamento pelo portal) ou levada para a nova marcação',
    legado: null,
  },
  teleconsultaLida: {
    codigo: 'atendimento.teleconsulta.lida',
    descricao:
      'Teleconsulta ou teleinterconsulta lida na tela do médico (dados do paciente; leitura auditada)',
    legado: null,
  },
  teleinterconsultaSolicitada: {
    codigo: 'atendimento.teleinterconsulta.solicitada',
    descricao:
      'Teleinterconsulta pedida no atendimento, com o consentimento do paciente (o convidado na chave)',
    legado: null,
  },
  teleinterconsultaRespondida: {
    codigo: 'atendimento.teleinterconsulta.respondida',
    descricao: 'Parecer da teleinterconsulta registrado pelo médico convidado',
    legado: null,
  },
  teleinterconsultaCancelada: {
    codigo: 'atendimento.teleinterconsulta.cancelada',
    descricao: 'Teleinterconsulta cancelada por quem pediu, antes do parecer',
    legado: null,
  },
  // M47 (etapa 3; ficha, regra 11): a lista de trabalho DICOM e os status do estudo. Só na trilha própria (o sistema
  // anterior não tem worklist em uso). Sem dado pessoal no payload: exame, número de acesso, modalidade e status.
  worklistLida: {
    codigo: 'sadt.pacs.lida',
    descricao: 'Lista de trabalho DICOM lida (exames de imagem com o nome do paciente e o estado do envio)',
    legado: null,
  },
  mwlEnviada: {
    codigo: 'sadt.pacs.mwlEnviada',
    descricao:
      'Item da lista de trabalho DICOM enviado (ou reenviado com o mesmo número de acesso) ao PACS pela fila de integração',
    legado: null,
  },
  estudoStatusRecebido: {
    codigo: 'sadt.pacs.statusRecebido',
    descricao:
      'Status do exame recebido da modalidade ou do PACS (em andamento, concluído ou descontinuado) com o UID do estudo',
    legado: null,
  },
  estudosLidos: {
    codigo: 'sadt.pacs.estudosLidos',
    descricao: 'Estudos de imagem do paciente lidos no prontuário (link do visualizador)',
    legado: null,
  },
  // M54 (etapa 4): custos — estrutura de custos e estatísticas (só SGH_CUS_*; nenhum dado pessoal).
  custosEstruturaLida: {
    codigo: 'custos.estrutura.lida',
    descricao: 'Estrutura de custos consultada (centros, classes, ordem e critério do rateio)',
    legado: null,
  },
  custosCentroClassificado: {
    codigo: 'custos.centro.classificado',
    descricao:
      'Centro de custo classificado ou reclassificado (classe, ordem e critério do rateio; antes e depois)',
    legado: null,
  },
  custosEstatisticasLidas: {
    codigo: 'custos.estatisticas.lidas',
    descricao: 'Estatísticas de custeio de uma competência consultadas',
    legado: null,
  },
  custosEstatisticasColetadas: {
    codigo: 'custos.estatisticas.coletadas',
    descricao: 'Estatísticas da competência coletadas das fontes do banco (só contagens por fonte)',
    legado: null,
  },
  custosEstatisticaLancada: {
    codigo: 'custos.estatistica.lancada',
    descricao:
      'Estatística lançada à mão para um centro e competência (substitui a anterior, que fica guardada)',
    legado: null,
  },
  // M54 (etapa 7): orçamento empresarial (só SGH_ORC_*; nenhum dado pessoal: centros, itens gerenciais e valores).
  orcamentoLido: {
    codigo: 'financeiro.orcamento.lido',
    descricao: 'Orçamento empresarial consultado (versões ou as linhas de uma versão)',
    legado: null,
  },
  orcamentoCriado: {
    codigo: 'financeiro.orcamento.criado',
    descricao:
      'Versão do orçamento empresarial criada (vazia, cópia de outra versão ou do realizado do ano anterior)',
    legado: null,
  },
  orcamentoLinhasGravadas: {
    codigo: 'financeiro.orcamento.linhasGravadas',
    descricao:
      'Valores do orçamento gravados por centro de custo, item e mês (contagem e total, antes e depois)',
    legado: null,
  },
  orcamentoAprovado: {
    codigo: 'financeiro.orcamento.aprovado',
    descricao: 'Versão do orçamento aprovada (passa a vigente do ano; a anterior fica substituída)',
    legado: null,
  },
  orcamentoDescartado: {
    codigo: 'financeiro.orcamento.descartado',
    descricao: 'Versão do orçamento em elaboração descartada, com o motivo',
    legado: null,
  },
  orcamentoComparativoLido: {
    codigo: 'financeiro.orcamento.comparativoLido',
    descricao: 'Comparativo orçado × realizado consultado (por linha, centro de custo ou item)',
    legado: null,
  },
  orcamentoPremissaGravada: {
    codigo: 'financeiro.orcamento.premissaGravada',
    descricao: 'Premissa da versão do orçamento incluída, alterada ou retirada (tipo, valor e justificativa)',
    legado: null,
  },
  orcamentoCenarioGravado: {
    codigo: 'financeiro.orcamento.cenarioGravado',
    descricao: 'Cenário do orçamento cadastrado ou alterado, ou escolhido para uma versão',
    legado: null,
  },
  orcamentoIndicadorGravado: {
    codigo: 'financeiro.orcamento.indicadorGravado',
    descricao:
      'Indicador orçamentário (diárias, exames, cirurgias) cadastrado ou alterado, com a visão e a projeção',
    legado: null,
  },
  orcamentoEstatisticaGravada: {
    codigo: 'financeiro.orcamento.estatisticaGravada',
    descricao:
      'Quantidades orçadas do indicador por setor e mês gravadas na versão (incluídas, alteradas ou retiradas)',
    legado: null,
  },
  // M54 (etapa 5): custos — apuração do mês, custo por conta, resultado e exportação (só SGH_CUS_*; a conta pelo ID).
  custosApuracaoLida: {
    codigo: 'custos.apuracao.lida',
    descricao: 'Apuração do custo do mês consultada (custo por centro, rateios e pendências)',
    legado: null,
  },
  custosApurado: {
    codigo: 'custos.apuracao.apurada',
    descricao:
      'Custo do mês apurado (absorção com rateio sequencial e custo por conta; a apuração anterior fica substituída)',
    legado: null,
  },
  custosApuracaoAprovada: {
    codigo: 'custos.apuracao.aprovada',
    descricao: 'Apuração do custo do mês aprovada',
    legado: null,
  },
  custosResultadoLido: {
    codigo: 'custos.resultado.lido',
    descricao:
      'Resultado e margem da competência consultados (por convênio, procedimento, unidade, tipo de conta ou paciente pelo prontuário)',
    legado: null,
  },
  custosContasLidas: {
    codigo: 'custos.contas.lidas',
    descricao:
      'Custo e margem por conta consultados (a conta pelo número e o paciente só pelo prontuário; nunca o nome)',
    legado: null,
  },
  custosExportacaoGerada: {
    codigo: 'custos.exportacao.gerada',
    descricao:
      'Arquivo da apuração gerado para o ApuraSUS, a Federassantas ou a planilha própria (só gerado, não enviado)',
    legado: null,
  },
  // M55 (etapa 3; ficha, seções 5 e 7): contratos com fornecedores. Só na trilha própria; sem dado pessoal: os
  // identificadores, o número do contrato, o fornecedor e os valores.
  contratoCriado: {
    codigo: 'suprimentos.contrato.criado',
    descricao: 'Contrato com fornecedor cadastrado (número, fornecedor, vigência, valor, gestor e fiscal)',
    legado: null,
  },
  contratoAlterado: {
    codigo: 'suprimentos.contrato.alterado',
    descricao: 'Cadastro do contrato com fornecedor alterado (objeto, garantias, índice, gestor ou fiscal)',
    legado: null,
  },
  contratoEvento: {
    codigo: 'suprimentos.contrato.evento',
    descricao:
      'Evento do contrato registrado: aditivo, reajuste, renovação, ocorrência, avaliação, anexo, exceção, encerramento ou rescisão',
    legado: null,
  },
  contratoVinculo: {
    codigo: 'suprimentos.contrato.vinculo',
    descricao: 'Pedido de compra ou título a pagar ligado ao contrato (o saldo recalculado)',
    legado: null,
  },
  contratoAlertaVencimento: {
    codigo: 'suprimentos.contrato.alertaVencimento',
    descricao:
      'Aviso de vencimento do contrato com fornecedor (90, 60 e 30 dias e vencido) ao gestor e ao fiscal, pelo worker',
    legado: null,
  },
  // M55 (etapa 5; ficha, seções 6 a 8; regra 11): contratualização SUS. Sem dado de pessoa: o número do contrato, a
  // esfera, os valores, o código SIGTAP ou o indicador da meta e as quantidades.
  contratualizacaoLida: {
    codigo: 'faturamento.contratualizacao.lida',
    descricao:
      'Contratualização SUS lida (contratos com o gestor, metas, apurações ou o painel produção × meta)',
    legado: null,
  },
  contratoSusGravado: {
    codigo: 'faturamento.contratualizacao.contratoGravado',
    descricao:
      'Contrato SUS com o gestor incluído, alterado ou encerrado (esfera, vigência, orçamento, incentivos e habilitação)',
    legado: null,
  },
  metaSusGravada: {
    codigo: 'faturamento.contratualizacao.metaGravada',
    descricao:
      'Meta da contratualização SUS incluída ou alterada (quantitativa por SIGTAP ou qualitativa por indicador)',
    legado: null,
  },
  apuracaoSusRegistrada: {
    codigo: 'faturamento.contratualizacao.apuracaoRegistrada',
    descricao:
      'Apuração do período de uma meta SUS registrada ou corrigida (realizado, cumprimento e escore)',
    legado: null,
  },
  // M55 (etapa 4; ficha, seções 7 e 8; regras 9 e 10): licitação, pregão e compras públicas (desligada, DP-13). Só na
  // trilha própria; sem dado pessoal: os identificadores, o número do processo, a etapa, o fornecedor e os valores.
  licitacaoCriada: {
    codigo: 'suprimentos.licitacao.criada',
    descricao:
      'Processo de compra aberto (termo de referência: modalidade, critério, objeto, itens e agente)',
    legado: null,
  },
  licitacaoAlterada: {
    codigo: 'suprimentos.licitacao.alterada',
    descricao: 'Termo de referência do processo de compra alterado (objeto, itens, critério ou agente)',
    legado: null,
  },
  licitacaoPreco: {
    codigo: 'suprimentos.licitacao.preco',
    descricao: 'Preço registrado na pesquisa de preços do processo (fonte, referência e valor)',
    legado: null,
  },
  licitacaoPrecoDescartado: {
    codigo: 'suprimentos.licitacao.precoDescartado',
    descricao: 'Preço da pesquisa descartado com a justificativa (fica gravado, fora da estimativa)',
    legado: null,
  },
  licitacaoProposta: {
    codigo: 'suprimentos.licitacao.proposta',
    descricao: 'Proposta registrada, classificada, desclassificada ou inabilitada na sessão do processo',
    legado: null,
  },
  licitacaoEtapa: {
    codigo: 'suprimentos.licitacao.etapa',
    descricao:
      'Etapa do processo de compra: pesquisa, edital, aviso publicado, sessão, julgamento, fracassado, deserto, homologação, revogação ou anulação',
    legado: null,
  },
  licitacaoEvento: {
    codigo: 'suprimentos.licitacao.evento',
    descricao:
      'Evento do processo de compra: parecer jurídico, esclarecimento, recurso e decisão, documento, ata ou pedido de compra ligado',
    legado: null,
  },
  licitacaoDocumentoEmitido: {
    codigo: 'suprimentos.licitacao.documento',
    descricao:
      'Documento do processo de compra emitido em PDF/A (termo de referência, registro da etapa ou ata do julgamento)',
    legado: null,
  },
  // M59-F3: segredos de parceiros e senhas secundárias (consultas sensíveis e gravações; nunca o valor do segredo).
  segredosLegadoConsultados: {
    codigo: 'integracao.segredoLegado.consultado',
    descricao:
      'Situação dos segredos de parceiros consultada (quais colunas têm valor, cofre, rotação e retirada; nunca o valor)',
    legado: null,
  },
  segredoLegadoGuardado: {
    codigo: 'integracao.segredoLegado.guardado',
    descricao:
      'Credencial do parceiro guardada no cofre do Sante (referência, coluna e se é a nova combinada com o parceiro; nunca o valor)',
    legado: null,
  },
  segredoLegadoRetirado: {
    codigo: 'integracao.segredoLegado.retirado',
    descricao: 'Segredo antigo de parceiro retirado da tabela (as colunas passam ao valor vazio)',
    legado: null,
  },
  senhasSecundariasConsultadas: {
    codigo: 'acesso.senhaSecundaria.consultada',
    descricao: 'Lista dos usuários com senha secundária consultada (login e quais colunas; nunca a senha)',
    legado: null,
  },
  senhaSecundariaRetirada: {
    codigo: 'acesso.senhaSecundaria.retirada',
    descricao:
      'Senhas secundárias do usuário retiradas (cancelamento de nota e secundária; a reautenticação ocupa o lugar)',
    legado: null,
  },
  // M54 (etapa 6): patrimônio — bens, movimentos, depreciação e inventário (só SGH_PAT_*; nenhum dado de paciente).
  patrimonioBensLidos: {
    codigo: 'patrimonio.bens.lidos',
    descricao: 'Bens patrimoniais consultados (lista, detalhe, notas de entrada e etiqueta)',
    legado: null,
  },
  patrimonioBemCadastrado: {
    codigo: 'patrimonio.bem.cadastrado',
    descricao:
      'Bem patrimonial cadastrado a partir da nota fiscal de entrada ou da doação com termo (plaquetas geradas)',
    legado: null,
  },
  patrimonioBemAlterado: {
    codigo: 'patrimonio.bem.alterado',
    descricao: 'Dados do bem patrimonial alterados (antes e depois)',
    legado: null,
  },
  patrimonioDepreciacaoLida: {
    codigo: 'patrimonio.depreciacao.lida',
    descricao: 'Depreciação de uma competência consultada (prévia ou cotas gravadas)',
    legado: null,
  },
  patrimonioDepreciacaoCalculada: {
    codigo: 'patrimonio.depreciacao.calculada',
    descricao: 'Depreciação do mês calculada e gravada para uma empresa (fato contábil de origem Patrimônio)',
    legado: null,
  },
  patrimonioMovimentosLidos: {
    codigo: 'patrimonio.movimentos.lidos',
    descricao: 'Movimentos de bens consultados',
    legado: null,
  },
  patrimonioMovimentoRegistrado: {
    codigo: 'patrimonio.movimento.registrado',
    descricao: 'Movimento de bem registrado (transferência pedida, empréstimo, comodato, devolução ou baixa)',
    legado: null,
  },
  patrimonioMovimentoDecidido: {
    codigo: 'patrimonio.movimento.decidido',
    descricao: 'Transferência de bem aceita ou recusada por quem recebe',
    legado: null,
  },
  patrimonioMovimentoCancelado: {
    codigo: 'patrimonio.movimento.cancelado',
    descricao: 'Pedido de transferência de bem cancelado',
    legado: null,
  },
  patrimonioInventarioLido: {
    codigo: 'patrimonio.inventario.lido',
    descricao: 'Inventário de bens consultado (leituras e divergências)',
    legado: null,
  },
  patrimonioInventarioAberto: {
    codigo: 'patrimonio.inventario.aberto',
    descricao: 'Inventário de bens aberto',
    legado: null,
  },
  patrimonioInventarioLeitura: {
    codigo: 'patrimonio.inventario.leitura',
    descricao: 'Leitura de QR ou plaqueta registrada no inventário (com o resultado)',
    legado: null,
  },
  patrimonioInventarioEncerrado: {
    codigo: 'patrimonio.inventario.encerrado',
    descricao: 'Inventário de bens encerrado com as divergências registradas (nada corrigido sozinho)',
    legado: null,
  },
  // W0-08 (parte 4): o grupo do bem como cadastro do Sante (SGH_PAT_GRUPO, só SGH_; motivo e versão anterior guardados).
  patrimonioGrupoIncluido: {
    codigo: 'patrimonio.grupo.incluido',
    descricao: 'Grupo do bem incluído (código, nome, vida útil padrão e conta contábil)',
    legado: null,
  },
  patrimonioGrupoAlterado: {
    codigo: 'patrimonio.grupo.alterado',
    descricao:
      'Grupo do bem alterado pela versão lida, com motivo e a versão anterior guardada (vida útil nova só para os bens seguintes)',
    legado: null,
  },
  patrimonioGrupoInativado: {
    codigo: 'patrimonio.grupo.inativado',
    descricao: 'Grupo do bem inativado ou reativado com motivo (a versão anterior guardada)',
    legado: null,
  },
  patrimonioGrupoExcluido: {
    codigo: 'patrimonio.grupo.excluido',
    descricao:
      'Grupo do bem nunca usado excluído, com o motivo e o retrato da linha (com bem ou cota, recusado)',
    legado: null,
  },
  patrimonioInventarioCancelado: {
    codigo: 'patrimonio.inventario.cancelado',
    descricao: 'Inventário de bens aberto cancelado com motivo (as leituras feitas ficam registradas)',
    legado: null,
  },
  patrimonioDepreciacaoEstornada: {
    codigo: 'patrimonio.depreciacao.estornada',
    descricao:
      'Último cálculo da depreciação estornado com motivo (fato novo; as cotas ficam gravadas sem valer e o contábil lança o estorno)',
    legado: null,
  },
  patrimonioAjustesLidos: {
    codigo: 'patrimonio.ajustes.lidos',
    descricao:
      'Consulta dos ajustes de valor do bem (revisão de estimativa, impairment e reavaliação, com os estornos)',
    legado: null,
  },
  patrimonioAjusteRegistrado: {
    codigo: 'patrimonio.ajuste.registrado',
    descricao:
      'Ajuste de valor do bem registrado com motivo e laudo (revisão de estimativa prospectiva, perda por impairment com lançamento contábil ou reavaliação como evento)',
    legado: null,
  },
  patrimonioAjusteEstornado: {
    codigo: 'patrimonio.ajuste.estornado',
    descricao:
      'Ajuste de valor do bem estornado com motivo (fato novo; o contábil lança o estorno da perda e a depreciação volta à base anterior)',
    legado: null,
  },
  patrimonioLaudosLidos: {
    codigo: 'patrimonio.laudos.lidos',
    descricao:
      'Consulta dos laudos anexados ao bem (impairment, reavaliação e revisão de estimativa) ou do PDF de um deles',
    legado: null,
  },
  patrimonioLaudoAnexado: {
    codigo: 'patrimonio.laudo.anexado',
    descricao:
      'Laudo do bem anexado em PDF (guardado no armazenamento com retenção, com o resumo SHA-256; registro imutável)',
    legado: null,
  },
  // M55 (etapa 1): manutenção e engenharia clínica (só SGH_MAN_*; nenhum dado de paciente).
  manutencaoOsLidas: {
    codigo: 'manutencao.os.lidas',
    descricao: 'Ordens de serviço de manutenção consultadas (lista e detalhe, com o histórico)',
    legado: null,
  },
  manutencaoOsAberta: {
    codigo: 'manutencao.os.aberta',
    descricao:
      'Ordem de serviço de manutenção aberta (corretiva ou predial), com a parada do equipamento e o alerta ao setor quando crítico',
    legado: null,
  },
  manutencaoOsAtendida: {
    codigo: 'manutencao.os.atendida',
    descricao:
      'Ordem de serviço assumida (prioridade confirmada, técnico e executor) ou com andamento registrado',
    legado: null,
  },
  manutencaoOsConcluida: {
    codigo: 'manutencao.os.concluida',
    descricao:
      'Ordem de serviço concluída com a causa, a solução, o reparo, a volta ao uso, os custos e o laudo',
    legado: null,
  },
  manutencaoOsEncerrada: {
    codigo: 'manutencao.os.encerrada',
    descricao:
      'Ordem de serviço encerrada pelo aceite (ou depois do prazo do aceite) ou reaberta pela recusa de quem abriu',
    legado: null,
  },
  manutencaoOsCancelada: {
    codigo: 'manutencao.os.cancelada',
    descricao: 'Ordem de serviço cancelada, com o motivo',
    legado: null,
  },
  manutencaoOsCorrigida: {
    codigo: 'manutencao.os.corrigida',
    descricao:
      'Abertura da ordem de serviço corrigida antes de assumida (descrição, prioridade, setor, equipamento), com o motivo e os valores anteriores',
    legado: null,
  },
  manutencaoEquipamentosLidos: {
    codigo: 'manutencao.equipamentos.lidos',
    descricao: 'Equipamentos, planos de manutenção, contratos de manutenção e recursos de agenda consultados',
    legado: null,
  },
  manutencaoEquipamentoCadastrado: {
    codigo: 'manutencao.equipamento.cadastrado',
    descricao: 'Equipamento cadastrado (código da etiqueta, criticidade, setor e recurso de agenda)',
    legado: null,
  },
  manutencaoEquipamentoAlterado: {
    codigo: 'manutencao.equipamento.alterado',
    descricao: 'Equipamento alterado ou desativado, com o motivo (antes e depois)',
    legado: null,
  },
  manutencaoPlanoGravado: {
    codigo: 'manutencao.plano.gravado',
    descricao:
      'Plano de manutenção preventiva, calibração, segurança elétrica ou inspeção incluído ou desativado',
    legado: null,
  },
  manutencaoPlanoAlterado: {
    codigo: 'manutencao.plano.alterado',
    descricao:
      'Plano de manutenção alterado pela versão lida (periodicidade, data base, procedimento ou executor), com o motivo e a versão anterior guardada',
    legado: null,
  },
  manutencaoPlanoExecutado: {
    codigo: 'manutencao.plano.executado',
    descricao:
      'Execução do plano de manutenção registrada com o resultado e o laudo (reprovada abre a corretiva)',
    legado: null,
  },
  manutencaoCoberturaGravada: {
    codigo: 'manutencao.cobertura.gravada',
    descricao: 'Contrato de manutenção (cobertura, vigência e equipamentos) registrado',
    legado: null,
  },
  manutencaoCoberturaAlterada: {
    codigo: 'manutencao.cobertura.alterada',
    descricao:
      'Contrato de manutenção alterado pela versão lida (vigência, SLA, valor ou equipamentos), com o motivo e a versão anterior guardada',
    legado: null,
  },
  manutencaoCoberturaEncerrada: {
    codigo: 'manutencao.cobertura.encerrada',
    descricao: 'Contrato de manutenção encerrado com motivo e data (a versão anterior fica guardada)',
    legado: null,
  },
  manutencaoCoberturaExcluida: {
    codigo: 'manutencao.cobertura.excluida',
    descricao:
      'Contrato de manutenção registrado por engano excluído, sem OS nem plano ligados, com o motivo e o retrato da linha',
    legado: null,
  },
  manutencaoAlertaRegistrado: {
    codigo: 'manutencao.alerta.registrado',
    descricao:
      'Alerta de tecnovigilância ou recall registrado (fabricante, modelo e faixa de série; entrada manual)',
    legado: null,
  },
  manutencaoAlertaAlterado: {
    codigo: 'manutencao.alerta.alterado',
    descricao:
      'Alerta de tecnovigilância alterado pela versão lida, com o motivo (o critério só muda antes da primeira OS de ação de campo)',
    legado: null,
  },
  manutencaoAlertaEncerrado: {
    codigo: 'manutencao.alerta.encerrado',
    descricao: 'Alerta de tecnovigilância encerrado com motivo',
    legado: null,
  },
  manutencaoAlertaExcluido: {
    codigo: 'manutencao.alerta.excluido',
    descricao:
      'Alerta de tecnovigilância registrado por engano excluído, sem OS nem queixa ligadas, com o motivo e o retrato da linha',
    legado: null,
  },
  manutencaoAlertaAcaoDeCampo: {
    codigo: 'manutencao.alerta.acaoDeCampo',
    descricao: 'OS de ação de campo geradas pelo alerta de tecnovigilância, uma por equipamento afetado',
    legado: null,
  },
  manutencaoOsQueixaTecnica: {
    codigo: 'manutencao.os.queixaTecnica',
    descricao:
      'Queixa técnica aberta a partir da OS na vigilância de produto da qualidade (equipamento, série e alerta)',
    legado: null,
  },
  manutencaoCursoModeloVinculado: {
    codigo: 'manutencao.cursoModelo.vinculado',
    descricao:
      'Curso do treinamento passou a ser exigido para operar o modelo de equipamento (fabricante e modelo)',
    legado: null,
  },
  manutencaoCursoModeloExcluido: {
    codigo: 'manutencao.cursoModelo.excluido',
    descricao: 'Curso deixou de ser exigido para operar o modelo, com o motivo e o retrato da linha',
    legado: null,
  },
  manutencaoEquipamentoEvento: {
    codigo: 'manutencao.equipamento.evento',
    descricao:
      'Evento do ciclo de vida do equipamento registrado (incorporação, desativação ou descarte), com data, causa, valor contábil, valor obtido e quem autorizou',
    legado: null,
  },
  manutencaoPgtsGerado: {
    codigo: 'manutencao.pgts.gerado',
    descricao: 'Documento do plano de gerenciamento das tecnologias em saúde (RDC 509) gerado do cadastro',
    legado: null,
  },
  manutencaoPmocGerado: {
    codigo: 'manutencao.pmoc.gerado',
    descricao:
      'Relatório do PMOC (Lei 13.589/2018) gerado para o período, com as execuções dos planos e a assinatura do responsável técnico',
    legado: null,
  },
  manutencaoIndicadoresLidos: {
    codigo: 'manutencao.indicadores.lidos',
    descricao: 'Indicadores de disponibilidade, MTBF e MTTR consultados, com as parcelas',
    legado: null,
  },
} as const satisfies Record<string, EventoAuditavel>;

export const CATALOGO_EVENTOS: readonly EventoAuditavel[] = Object.values(EVENTOS_AUDITAVEIS);

export function eventoAuditavel(codigo: string): EventoAuditavel | null {
  return CATALOGO_EVENTOS.find((e) => e.codigo === codigo) ?? null;
}
