// pnpm sbis:verificar (ficha do M59, seção 4 "Matriz de rastreabilidade SBIS", regras 9 e 10; cap-13 §13.6.2 e
// §13.6.3): a parte escrita à mão da matriz requisito → funcionalidade → teste → resultado. Cada requisito do
// catálogo `REQUISITOS_SBIS` (@sgh/contratos) tem aqui a funcionalidade que o atende (tela, rota ou regra) e os
// testes versionados que o provam. O verificador (`sbis.ts`) cruza esta tabela com o catálogo e com o
// repositório: requisito sem linha, linha sem requisito, teste que não existe ou requisito sem teste = vermelho.
// O resultado vem da execução (`--executar` roda os testes unitários listados; os de integração rodam na cópia,
// pelo verificar:tudo e pelas travas, e aparecem como tal).

export interface LinhaMatrizSbis {
  /** Tela, rota ou regra que atende o requisito (o que o auditor vê). */
  readonly funcionalidade: string;
  /** Testes versionados (caminho a partir da raiz) que provam o requisito. */
  readonly testes: readonly string[];
  /**
   * Parte do requisito que o produto ainda NÃO atende ou não prova (com a referência do pedido). A linha nunca sai
   * "conforme" e vira achado do verificador: aceitar a lacuna para a esteira passar é exceção que só o dono autoriza.
   */
  readonly lacuna?: string;
}

const L = (funcionalidade: string, ...testes: string[]): LinhaMatrizSbis => ({ funcionalidade, testes });
/** Linha com lacuna aberta: os testes listados provam só a parte atendida. */
const LL = (funcionalidade: string, lacuna: string, ...testes: string[]): LinhaMatrizSbis => ({
  funcionalidade,
  testes,
  lacuna,
});

export const MATRIZ_SBIS: Readonly<Record<string, LinhaMatrizSbis>> = {
  // NGS1: segurança da informação
  'SBIS-01': L(
    'Tela "Sobre" e versão em /api/versao e em toda exportação',
    'apps/api/src/versao.spec.ts',
    'packages/dominio-config/src/dominio/versao.spec.ts',
  ),
  'SBIS-02': L(
    'Login no servidor (/api/sessao) e segundo fator por perfil (/administracao/acesso/2fa)',
    'packages/dominio-acesso/src/usuario/login.spec.ts',
    'packages/dominio-acesso/src/politica-2fa.spec.ts',
    'apps/api/src/sessao/sessao.spec.ts',
  ),
  'SBIS-03': L(
    'Credencial forte em SGH_ACESSO_CREDENCIAL com nova gravação no primeiro login',
    'packages/dominio-acesso/src/identidade/credencial-forte.spec.ts',
    'apps/api/src/modulos/acesso/identidade/servico-identidade.spec.ts',
  ),
  'SBIS-04': L(
    'Política de senha parametrizável (qualidade e ciclo)',
    'packages/dominio-acesso/src/identidade/credencial-forte.spec.ts',
  ),
  'SBIS-05': L(
    'Bloqueio por tentativas com mensagem genérica',
    'apps/api/src/sessao/forca-bruta.spec.ts',
    'packages/dominio-acesso/src/sbis/sbis.spec.ts',
  ),
  'SBIS-06': L('Último acesso mostrado ao entrar', 'apps/api/src/sessao/sessao.spec.ts'),
  'SBIS-07': L(
    'Reautenticação nas operações críticas (lista configurável)',
    'apps/api/src/autorizacao/reautenticacao.spec.ts',
    'apps/api/src/sessao/reautenticacao.spec.ts',
  ),
  'SBIS-08': L(
    'Segundo fator TOTP e login por certificado; exigência dos dois por perfil',
    'packages/dominio-acesso/src/politica-2fa.spec.ts',
    'apps/api/src/modulos/assinatura/aplicacao/login-certificado.spec.ts',
  ),
  'SBIS-09': L(
    'Bloqueio da sessão por inatividade sem perder o digitado',
    'apps/web/src/casca/bloqueio/bloqueio.spec.ts',
    'apps/api/src/sessao/sessao.spec.ts',
  ),
  'SBIS-10': L(
    'Toda rota protegida pelo catálogo de permissões; segregação administrativo × clínico',
    'apps/api/src/autorizacao/autorizacao.spec.ts',
    'packages/dominio-acesso/src/segregacao.spec.ts',
    'tools/verificadores/src/permissoes.spec.ts',
  ),
  'SBIS-11': L(
    'Usuário ligado a CPF único; usuário com operação só é inativado',
    'packages/dominio-cadastro/src/documento/cpf.spec.ts',
    'packages/dominio-config/src/dominio/inativar.spec.ts',
  ),
  'SBIS-12': L(
    'Sempre um administrador ou gestor de acessos ativo',
    'apps/api/src/modulos/administracao/usuarios-administradores.spec.ts',
    'packages/dominio-acesso/src/usuario/segregacao-gestao.spec.ts',
  ),
  'SBIS-13': L(
    'Backup verificado (/administracao/auditoria/backup): restauração diária e mensal conferidas',
    'packages/dominio-acesso/src/sbis/sbis.spec.ts',
    'apps/api/src/modulos/administracao/sbis/servico.spec.ts',
    'apps/api/src/modulos/administracao/sbis/porta-propria.spec.ts',
  ),
  'SBIS-14': L(
    'TLS entre componentes e privilégio mínimo no banco',
    'apps/api/src/modulos/suporte/seguranca.spec.ts',
    'packages/dominio-acesso/src/contas/privilegio-minimo.spec.ts',
    'tools/verificadores/src/privilegios.spec.ts',
  ),
  'SBIS-15': L(
    'Anexos cifrados com nome opaco; cifra da plataforma',
    'apps/api/src/modulos/digitalizacao/digitalizacao.spec.ts',
    'packages/dominio-acesso/src/cifra-plataforma.spec.ts',
  ),
  'SBIS-16': LL(
    'SGH_TRILHA só de inclusão com hash encadeado; imutabilidade',
    'a cadeia de integridade da trilha (fecho diário por hash) não tem tabela no modelo; a verificação de ' +
      'integridade responde "trilha-sem-encadeamento" até o DDL pedido (docs/obra/fatias/f22/saida/05-05.json)',
    'packages/testes/src/integracao/trilha.int.spec.ts',
    'apps/api/src/autorizacao/trilha.spec.ts',
    'packages/dominio-acesso/src/imutabilidade/imutabilidade.spec.ts',
  ),
  'SBIS-17': L(
    'Catálogo de eventos auditáveis',
    'apps/api/src/autorizacao/trilha.spec.ts',
    'packages/testes/src/integracao/trilha.int.spec.ts',
  ),
  'SBIS-18': L(
    'Evento com ID, data e hora com fuso, estação, usuário e objeto',
    'apps/api/src/autorizacao/trilha.spec.ts',
    'packages/testes/src/integracao/trilha.int.spec.ts',
  ),
  'SBIS-19': L(
    'Trilha cronológica (/administracao/auditoria/trilha) e exportação SBIS CSV/XML com nome, CNES e CNPJ',
    'packages/dominio-acesso/src/sbis/sbis.spec.ts',
    'packages/dominio-acesso/src/auditoria/periodo.spec.ts',
    'apps/web/src/modulos/administracao/sbis.spec.ts',
  ),
  'SBIS-20': L('Manual de implantação e notas de versão gerados', 'tools/implantacao/src/manual.spec.ts'),
  'SBIS-21': L(
    'Hora com milissegundos e fuso; exportação RFC 3339',
    'packages/dominio-acesso/src/sbis/sbis.spec.ts',
    'apps/api/src/autorizacao/trilha.spec.ts',
  ),
  'SBIS-22': L(
    'Canal de suporte para incidente, problema ou sugestão',
    'apps/api/src/modulos/suporte/suporte.spec.ts',
    'packages/dominio-acesso/src/suporte.spec.ts',
  ),
  'SBIS-23': L(
    'Termo de uso e privacidade no primeiro acesso e a cada versão',
    'apps/api/src/sessao/termo.spec.ts',
    'apps/api/src/modulos/administracao/termo-publicar.spec.ts',
  ),
  'SBIS-24': L(
    'Pedido do titular (correção de dado) com resposta, no portal do paciente',
    'packages/dominio-acesso/src/portal/privacidade.spec.ts',
    'packages/dominio-acesso/src/privacidade/pedido-titular.spec.ts',
  ),
  'SBIS-25': L(
    'Pseudonimização no BI e nas bases de treino; mascaramento',
    'tools/verificadores/src/treino-sem-dado-real.spec.ts',
    'tools/verificadores/src/lgpd/datamart-sem-dado-pessoal.spec.ts',
    'packages/dominio-cadastro/src/paciente/mascaramento.spec.ts',
  ),
  'SBIS-26': LL(
    'Correção do registro clínico só pelo autor, com nova versão; apagar recusado',
    'falta o teste de integração em que o banco recusa o DELETE em tabela clínica ao papel do módulo ' +
      '(pedido em docs/obra/fatias/f22/saida/05-01.json); hoje a recusa é provada só nos scripts de privilégio',
    'tools/verificadores/src/imutabilidade.spec.ts',
    'apps/api/src/modulos/pep/registro.spec.ts',
    'apps/api/src/modulos/pep/registro-regras.spec.ts',
  ),
  // ECF (modalidade assistencial)
  'ECF.01': L(
    'Estabelecimento, setores, leitos e profissional com conselho, UF e CBO',
    'apps/api/src/modulos/administracao/administracao.spec.ts',
    'packages/dominio-config/src/coexistencia/setores.spec.ts',
    'apps/api/src/modulos/internacao/leitos.spec.ts',
    'packages/dominio-cadastro/src/profissional/categoria.spec.ts',
  ),
  'ECF.03.01': L(
    'Cadastro do paciente (nome social, gênero, raça/cor, representante legal)',
    'apps/api/src/modulos/cadastro/cadastro.spec.ts',
    'packages/ui/src/componentes/SanteCabecalhoPaciente.spec.ts',
  ),
  'ECF.03.10': L(
    'Duplicidades, unificação, busca fonética e cabeçalho fixo do paciente',
    'packages/dominio-cadastro/src/duplicidade/escore.spec.ts',
    'packages/dominio-cadastro/src/busca/fonetica.spec.ts',
    'packages/dominio-cadastro/src/unificacao/referencias-paciente.spec.ts',
    'packages/ui/src/componentes/SanteCabecalhoPaciente.spec.ts',
  ),
  'ECF.06': L(
    'Abertura de atendimento, alocação de leito, alta médica e administrativa',
    'apps/api/src/modulos/internacao/servico.spec.ts',
    'apps/api/src/modulos/adt/adt.spec.ts',
    'packages/dominio-internacao/src/motivo-alta.spec.ts',
  ),
  'ECF.07': L(
    'Prontuário: sumário, alergias, problemas, evoluções, interconsulta e óbito',
    'apps/api/src/modulos/pep/registro.spec.ts',
    'packages/dominio-pep/src/alergia.spec.ts',
    'packages/dominio-pep/src/problemas.spec.ts',
    'packages/dominio-pep/src/interconsulta.spec.ts',
  ),
  'ECF.07.SAE': L(
    'SAE: diagnósticos e prescrição de enfermagem, balanço hídrico e escalas',
    'packages/dominio-enfermagem/src/sae/sae.spec.ts',
    'packages/dominio-enfermagem/src/balanco/balanco.spec.ts',
    'packages/dominio-enfermagem/src/escores/escalas.spec.ts',
  ),
  'ECF.07.30': L(
    'Preceptoria: residente registra, preceptor valida e coassina',
    'apps/api/src/modulos/pep/documentos.spec.ts',
    'apps/api/src/modulos/pep/prescricao.spec.ts',
  ),
  'ECF.07.33': L(
    'Sumário de alta no modelo oficial, editável, em PDF',
    'packages/dominio-pep/src/sumario-alta.spec.ts',
    'apps/api/src/modulos/pep/documentos-pdf.int.spec.ts',
  ),
  'ECF.09': L(
    'Centro cirúrgico: equipe, horários, relatório e sala',
    'apps/api/src/modulos/cirurgia/cirurgia.spec.ts',
    'packages/dominio-cirurgia/src/sobreposicao.spec.ts',
  ),
  'ECF.09.SEG': L(
    'Avaliação pré-anestésica, ficha anestésica e checklist de cirurgia segura',
    'apps/api/src/modulos/cirurgia/anestesia.spec.ts',
    'packages/dominio-cirurgia/src/ficha/ficha-anestesica.spec.ts',
    'packages/dominio-cirurgia/src/checklist/checklist.spec.ts',
  ),
  'ECF.10': L(
    'Prescrição estruturada, favoritos, suspensão e situação por item',
    'apps/api/src/modulos/pep/prescricao.spec.ts',
    'apps/web/src/modulos/pep/componentes/prescricao/prescricao.spec.ts',
    'apps/web/src/modulos/pep/preferencias-painel.spec.ts',
  ),
  'ECF.11': L(
    'Validação farmacêutica e dispensação',
    'apps/api/src/modulos/farmacia/farmacia.spec.ts',
    'packages/dominio-suprimentos/src/fila-dispensacao.spec.ts',
    'packages/dominio-suprimentos/src/politica-dispensacao.spec.ts',
  ),
  'ECF.12': L(
    'Checagem à beira do leito com pulseira e medicamento',
    'packages/dominio-enfermagem/src/checagem/pulseira.spec.ts',
    'apps/api/src/modulos/enfermagem/aplicacao/dupla-checagem.int.spec.ts',
  ),
  'ECF.12.RAS': L(
    'Hemocomponentes e OPME com código e lote na administração',
    'apps/api/src/modulos/enfermagem/transfusao.spec.ts',
    'packages/dominio-sadt/src/transfusao/ato-transfusional.spec.ts',
    'packages/dominio-suprimentos/src/opme/opme-fluxo.spec.ts',
  ),
  'ECF.13': L(
    'Pedido e resultado de exames com destaque fora da referência',
    'packages/dominio-pep/src/pedido-exame.spec.ts',
    'packages/dominio-pep/src/resultados.spec.ts',
    'apps/api/src/modulos/sadt/aplicacao/aviso-critico.int.spec.ts',
  ),
  'ECF.14': L(
    'Apoio à decisão na prescrição (alergia, dose, interação) com justificativa',
    'packages/dominio-pep/src/alertas/interacao.spec.ts',
    'packages/dominio-pep/src/alertas/dose.spec.ts',
    'packages/dominio-pep/src/alertas/alergia.spec.ts',
  ),
  'ECF.15': L(
    'Rascunho, registro retroativo marcado, terminologia com versão',
    'apps/web/src/modulos/pep/rascunho-local.spec.ts',
    'apps/api/src/modulos/pep/prontuario-regras.spec.ts',
    'apps/api/src/modulos/enfermagem/sae.spec.ts',
  ),
  'ECF.18': L(
    'Modelos de TCLE e termos; impressão do prontuário',
    'apps/api/src/modulos/pep/documentos.spec.ts',
    'apps/api/src/modulos/pep/documentos-pdf.int.spec.ts',
  ),
  'ECF.19': L(
    'Agravos de notificação parametrizáveis',
    'apps/api/src/modulos/qualidade/agravo.spec.ts',
    'apps/web/src/modulos/qualidade/vigilancia/regras-agravo.spec.ts',
  ),
  'ECF.20.03': L(
    'Sumário de alta gerado e guardado no modelo oficial',
    'packages/dominio-pep/src/sumario-alta.spec.ts',
    'apps/api/src/modulos/pep/documentos-pdf.int.spec.ts',
  ),
  // NGS2: assinatura digital
  'SBIS-30': L(
    'Certificados A1, A3 e em nuvem; autoridades por mídia',
    'packages/dominio-documento/src/assinatura/politica.spec.ts',
    'apps/api/src/modulos/assinatura/infra/clientes.spec.ts',
  ),
  'SBIS-31': L(
    'CPF do certificado igual ao do usuário a cada uso',
    'packages/dominio-documento/src/assinatura/cpf-certificado.spec.ts',
  ),
  'SBIS-32': L(
    'Validação no servidor: cadeia, vigência e revogação',
    'packages/dominio-documento/src/assinatura/validacao.spec.ts',
    'packages/dominio-documento/src/assinatura/verificador.spec.ts',
  ),
  'SBIS-33': L(
    'PAdES/CAdES com política AD-RB',
    'packages/dominio-documento/src/assinatura/pdfa-pades.spec.ts',
    'packages/dominio-documento/src/assinatura/politica.spec.ts',
  ),
  'SBIS-35': L(
    'Prévia exata do conteúdo assinado',
    'apps/api/src/modulos/assinatura/previa-hash.int.spec.ts',
    'apps/api/src/modulos/assinatura/aplicacao/documentos.spec.ts',
  ),
  'SBIS-36': L(
    'Pendências de assinatura: aviso, lista e assinatura em lote',
    'apps/api/src/modulos/pep/documentos.spec.ts',
    'packages/dominio-pep/src/worklist/pendencias.spec.ts',
  ),
  'SBIS-37': L(
    'Serviço externo fora do ar: pendente, aviso e reprocessamento',
    'packages/dominio-documento/src/assinatura/reprocessamento.spec.ts',
    'apps/api/src/modulos/assinatura/porta-propria.int.spec.ts',
  ),
  'SBIS-38': L(
    'Selo de assinado e encadeamento por paciente',
    'packages/dominio-documento/src/assinatura/selo.spec.ts',
    'apps/api/src/modulos/pep/registro.spec.ts',
  ),
  'SBIS-39': L(
    'Validação ao incluir, assinar, imprimir, importar e exportar',
    'packages/dominio-documento/src/assinatura/validacao.spec.ts',
    'apps/api/src/modulos/assinatura/aplicacao/verificador.spec.ts',
  ),
  'SBIS-40': L(
    'Carimbo do tempo na prescrição e no atestado',
    'packages/dominio-documento/src/assinatura/carimbo.spec.ts',
  ),
  'SBIS-42': L(
    'Exportação validável e rodapé legal; rodapé "Sistema certificado SBIS nº" só com o certificado vigente',
    'packages/dominio-documento/src/pdf/emissao.spec.ts',
    'apps/api/src/modulos/documento/aplicacao/emissao.service.spec.ts',
    'apps/api/src/modulos/assinatura/aplicacao/documentos.spec.ts',
    'apps/web/src/modulos/administracao/sbis.spec.ts',
  ),
  'SBIS-43': L(
    'Login por certificado: vigência, cadeia, revogação, CPF e uso',
    'apps/api/src/modulos/assinatura/aplicacao/login-certificado.spec.ts',
  ),
  'ICP-06': L(
    'Segredos dos serviços de assinatura em cofre',
    'apps/api/src/modulos/assinatura/infra/cofre.spec.ts',
    'packages/dominio-acesso/src/segredos/segredos.spec.ts',
  ),
};
