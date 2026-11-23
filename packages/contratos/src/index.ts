export { esquemaSaude, esquemaVersao, type Saude, type Versao } from './sistema.js';
export {
  TROCAS_CP1252,
  normalizarTextoCp1252,
  problemasCp1252,
  textoCp1252,
  type ProblemaCp1252,
} from './texto-cp1252.js';
export * from './config/coexistencia.js';
export * from './permissoes/config.js';
export * from './validacao/erro.js';
export * from './validacao/id-banco.js';
export * from './codec/cp1252.js';
export * from './codec/corpus-cp1252.js';
export * from './formatacao/data-legada.js';
export * from './formatacao/hora.js';
export * from './formatacao/booleano.js';
export * from './texto/normalizar.js';
export * from './menu/tipos.js';
export { ARVORE_MENU, CONTAGEM_DO_CABECALHO } from './menu/arvore.js';
export * from './permissoes/tipos.js';
export * from './permissoes/acesso.js';
export * from './permissoes/catalogo.js';
export * from './sessao.js';
export * from './acesso/entrada.js';
export * from './problema.js';
export * from './ui/paciente.js';
export * from './assinatura/assinatura.js';
export * from './assinatura/catalogo.js';
export * from './assinatura/fatias.js';
export * from './assinatura/resultado.js';
export * from './redacao.js';
export * from './logger-nest.js';
export * from './permissoes/sistema.js';
export * from './validacao/cpf.js';
export * from './validacao/cns.js';
export * from './cadastro/paciente.js';
export * from './acesso/usuario-integracao.js';
export * from './config/gravacao.js';
export * from './auditoria/eventos.js';
export * from './acesso/emergencia.js';
export * from './acesso/gestao.js';
// M59-F1: contas do banco e privilégio mínimo por módulo.
export * from './acesso/contas-banco.js';
export * from './permissoes/endurecimento.js';
// M59-F3: imutabilidade clínica, segredos de parceiros e senhas secundárias.
export * from './acesso/imutabilidade.js';
export * from './acesso/tabelas-clinicas.gerado.js';
export * from './integracao/segredos-legado.js';
// M08: CRUD genérico, parâmetros e funcionalidades por estabelecimento (POL-3).
export * from './dominios/tipos.js';
export * from './dominios/catalogo.js';
export * from './permissoes/dominios.js';
export * from './parametros/definicoes.js';
export * from './liberacao/recursos.js';
// M42: vocabulário da onda 4 (setores, ordem, saídas, envios SUS, respostas, cenários mínimos e o painel da competência).
export * from './liberacao/onda4.js';
export * from './liberacao/liberacao-full.js';
export * from './dominios/duplicidade.js';
export * from './dominios/versao.js';
// ADR 0021: suporte técnico e login como.
export * from './suporte/suporte.js';
// M11: pacientes e profissionais (chaves de busca, telas, permissões).
export * from './cadastro/chaves.js';
export * from './cadastro/telas.js';
export * from './cadastro/profissional.js';
export * from './permissoes/cadastro.js';
// M12: convênios, contratos e tabelas de preço.
export * from './preco/constantes.js';
export * from './preco/entradas.js';
export * from './preco/respostas.js';
export * from './preco/credenciais.js';
export * from './permissoes/precos.js';
// M10: acesso, organização e auditoria (telas).
export * from './permissoes/administracao.js';
export * from './administracao/usuarios.js';
export * from './administracao/flags-usuario.js';
export * from './administracao/permissoes.js';
export * from './administracao/estrutura.js';
export * from './administracao/auditoria.js';
export * from './administracao/consultas.js';
export * from './administracao/segredos.js';
// M13: catálogos oficiais e importadores.
export * from './catalogo/definicoes.js';
export * from './catalogo/api.js';
export * from './catalogo/consultas.js';
export * from './permissoes/catalogos.js';
// M15: prontuário ao vivo (consulta) e registro de acesso ao prontuário.
export * from './pep/prontuario.js';
export * from './permissoes/pep.js';
// M23: documentos, exames, resultados e multiprofissional.
export * from './pep/documentos.js';
// M14: domínios em massa (lote gerado), consultas somente leitura de todas as tabelas e matriz fechada.
export * from './consultas/tipos.js';
export * from './consultas/catalogo.js';
export * from './permissoes/consultas.js';
export * from './dominios/mestre-detalhe.js';
// W0-02: o portão do I/A/E dos domínios (modo relatório até o W4-01).
export * from './dominios/portao-iae.js';
export * from './legendas/legendas.js';
// M22: registros clínicos nos modelos do formulário de origem.
export * from './pep/registro-clinico.js';
export * from './pep/formulario-novo.js';
export * from './pep/prova.js';
export * from './pep/prescricao.js';
// M16: painel de leitos ao vivo, censo, indicadores, painéis gerenciais e o vigia de mudanças.
export * from './internacao/leitos.js';
export * from './relatorio/indicadores.js';
export * from './integracao/vigia.js';
export * from './integracao/novas.js';
export * from './relatorio/catalogo.js';
export * from './relatorio/gestao.js';
export * from './permissoes/relatorio-integracao.js';
export * from './permissoes/internacao.js';
export * from './internacao/movimento.js';
// M17: agenda de consultas.
export * from './agenda/vocabulario.js';
export * from './agenda/entradas.js';
export * from './agenda/respostas.js';
export * from './agenda/pedidos.js';
export * from './permissoes/agenda.js';
// M19: recepção, senhas, guichês, totens e painéis.
export * from './recepcao/vocabulario.js';
export * from './recepcao/entradas.js';
export * from './recepcao/respostas.js';
export * from './recepcao/estados.js';
export * from './recepcao/fila.js';
export * from './permissoes/recepcao.js';
// M44 (etapa 1): classificação de risco no pronto atendimento.
export * from './recepcao/classificacao.js';
export * from './permissoes/classificacao.js';
// M44 (etapa 3): protocolos gerenciados no PA.
export * from './recepcao/protocolo-gerenciado.js';
export * from './permissoes/protocolo-gerenciado.js';
// W1-04 (mercado): termos de consentimento e LGPD do balcão.
export * from './recepcao/termos.js';
// M18: agenda de exames e centro cirúrgico.
export * from './agenda/exame.js';
export * from './agenda/estruturada.js';
export * from './cirurgia/vocabulario.js';
export * from './cirurgia/entradas.js';
export * from './cirurgia/respostas.js';
export * from './permissoes/cirurgia.js';
// M46 (etapa 1): APA, ficha anestésica e SRPA.
export * from './cirurgia/anestesia-vocabulario.js';
export * from './cirurgia/anestesia-entradas.js';
export * from './cirurgia/anestesia-respostas.js';
export * from './permissoes/anestesia.js';
// M46 (etapa 2): checklist de cirurgia segura, rastreio no bloco e painel para familiares.
export * from './cirurgia/bloco-seguro-vocabulario.js';
export * from './cirurgia/bloco-seguro-entradas.js';
export * from './cirurgia/bloco-seguro-respostas.js';
export * from './permissoes/bloco-seguro.js';
// M20: atendimento ambulatorial e pronto atendimento.
export * from './atendimento/vocabulario.js';
export * from './atendimento/entradas.js';
export * from './atendimento/respostas.js';
export * from './permissoes/atendimento.js';
export * from './atendimento/conta.js';
export * from './atendimento/escore-pa.js';
// M21: internação, leitos, higienização e SAME.
export * from './internacao/adt.js';
export * from './internacao/adt-respostas.js';
export * from './permissoes/internacao-adt.js';
export * from './internacao/nir.js';
export * from './internacao/nir-crud.js';
export * from './internacao/os-leito.js';
export { PARAMETRO_OS_BLOQUEIA_LEITO } from './parametros/pa-leitos.js';
export * from './permissoes/nir.js';
// M44 (etapa 3): regulação estadual.
export * from './internacao/regulacao.js';
// M50 (etapa 5): portaria e visitantes.
export * from './internacao/portaria.js';
export * from './permissoes/portaria.js';
// M45 (etapa 5): nutrição clínica (triagem e EMTN), mapa de dietas e etiqueta de bandeja, acompanhante e serviço social.
export * from './pep/nutricao.js';
export * from './pep/servico-social.js';
// W0-05 (programa CRUD completo): correção, estorno, cancelamento e versões da nutrição, social, oncologia e lactário.
export * from './pep/correcoes-nutricao.js';
export * from './internacao/mapa-dieta.js';
export * from './permissoes/nutricao.js';
// M45 (etapa 6): especialidades sob demanda (oftalmologia, oncologia, obstetrícia) e o lactário (DP-32, desligados).
export * from './pep/especialidades.js';
export * from './permissoes/especialidades.js';
export * from './parametros/especialidades.js';
// M26: SADT (laboratório, imagem, laudos) e portal de resultados.
export * from './sadt/vocabulario.js';
export * from './sadt/entradas.js';
export * from './sadt/respostas.js';
export * from './sadt/regras.js';
export * from './sadt/estados.js';
export * from './sadt/pacs.js';
export * from './sadt/transfusao.js';
export * from './sadt/agencia.js';
export * from './sadt/correcao-hemo.js';
export * from './permissoes/sadt.js';
export * from './permissoes/transfusao.js';
// M25: enfermagem beira-leito (checagem, aprazamento, sinais vitais, infusão, conflitos e passagem de plantão).
export * from './enfermagem/vocabulario.js';
export * from './enfermagem/entradas.js';
export * from './enfermagem/respostas.js';
// M45 (etapa 3): balanço hídrico.
export * from './enfermagem/balanco.js';
export * from './permissoes/balanco.js';
export * from './permissoes/enfermagem.js';
// M45 (etapa 2): escores, reavaliações, classificação de pacientes e índices de gravidade da UTI.
export * from './enfermagem/escores.js';
export * from './enfermagem/escalas-mercado.js';
export * from './enfermagem/contencao.js';
export * from './enfermagem/trr-pcr.js';
export * from './enfermagem/protocolo-internado.js';
export * from './enfermagem/ferida.js';
export * from './pep/indices-uti.js';
export * from './permissoes/escores.js';
// M45 (etapa 4): SAE, prescrição de enfermagem, prescrição de medicamento pelo enfermeiro e vacina aplicada.
export * from './enfermagem/sae.js';
export * from './enfermagem/prescricao-enfermeiro.js';
export * from './enfermagem/vacina.js';
export * from './permissoes/sae.js';
// M27: filas de trabalho da página inicial, mensagens internas, avisos e dicionário pessoal.
export * from './inicio/worklist.js';
export * from './inicio/comunicacao.js';
export * from './inicio/respostas.js';
export * from './texto/fonetica.js';
export * from './permissoes/inicio.js';
// M28: estoque, almoxarifado e compras.
export * from './suprimentos/vocabulario.js';
export * from './suprimentos/entradas.js';
export * from './suprimentos/respostas.js';
// M41: onda 3 (setores, operações e chaves da liberação; painel de acompanhamento dos efeitos no estoque).
export * from './suprimentos/onda3.js';
// M46 (etapa 3): OPME (solicitação, etapas, consumo em sala com rastreio, conciliação e rastreio reverso).
export * from './suprimentos/opme-vocabulario.js';
export * from './suprimentos/opme-entradas.js';
export * from './suprimentos/opme-respostas.js';
export * from './permissoes/opme.js';
// M46 (etapa 4): consignados (saldo por fornecedor, remessa, reposição, faturamento) e manipulação (ordem, capela,
// dupla conferência e a baixa do insumo).
export * from './suprimentos/consignado.js';
export * from './suprimentos/manipulacao.js';
export * from './permissoes/consignado-manipulacao.js';
export * from './rouparia/rouparia.js';
export * from './rouparia/respostas.js';
export * from './permissoes/rouparia.js';
export * from './parametros/rouparia.js';
// M55 (etapa 3): contratos com fornecedores (vigência, aditivos, reajuste, saldo por pedidos e títulos, avaliação).
export * from './suprimentos/contrato.js';
export * from './permissoes/contrato-fornecedor.js';
// M55 (etapa 5): contratualização SUS (contrato com o gestor, metas quantitativas e qualitativas, painel produção × meta).
export * from './faturamento/contratualizacao.js';
export * from './permissoes/contratualizacao.js';
export * from './parametros/contratualizacao.js';
// M55 (etapa 4): licitação, pregão e compras públicas (construída e desligada, DP-13).
export * from './suprimentos/licitacao.js';
export * from './permissoes/licitacao.js';
export * from './permissoes/suprimentos.js';
// M29: farmácia hospitalar, dispensação e farmácia clínica.
export * from './farmacia/entradas.js';
export * from './farmacia/respostas.js';
export * from './permissoes/farmacia.js';
// M30: conta do paciente, lançamentos e auditoria de contas (as regras puras em @sgh/contratos/regras-faturamento).
export * from './faturamento/entradas.js';
export * from './faturamento/respostas.js';
export * from './faturamento/preco-particular.js';
export * from './permissoes/faturamento.js';
// M31: TISS, competência, demonstrativos, glosa e recurso (as regras puras em @sgh/contratos/regras-faturamento).
export * from './faturamento/tiss-entradas.js';
export * from './faturamento/tiss-respostas.js';
export * from './faturamento/tiss-lote.js';
export * from './permissoes/faturamento-tiss.js';
// M51: faturamento SUS próprio (competência SUS, crítica prévia, CIHA; BPA, APAC e AIH desligadas, DP-35).
export * from './faturamento/sus.js';
export * from './faturamento/sus-bpa.js';
export * from './faturamento/sus-apac.js';
export * from './faturamento/sus-aih.js';
export * from './permissoes/faturamento-sus.js';
// M33: repasse médico (vocabulário, entradas e permissões; as regras puras em @sgh/dominio-repasse).
export * from './repasse/vocabulario.js';
export * from './repasse/modelo.js';
export * from './repasse/entradas.js';
export * from './repasse/respostas.js';
export * from './permissoes/repasse.js';
// M49: assinatura ICP-Brasil (vocabulário, entradas, respostas e permissões; as regras puras em @sgh/dominio-documento).
export * from './documento-assinatura/vocabulario.js';
export * from './documento-assinatura/entradas.js';
export * from './documento-assinatura/respostas.js';
export * from './permissoes/documento-assinatura.js';
// M35: consolidação da semana e prontidão por setor (papéis, setores das ondas, relatório).
export * from './prontidao/catalogo.js';
export * from './prontidao/relatorio.js';
export * from './homologacao/homologacao.js';
// M43: fim da coexistência por hospital (painel de fim e registro versionado do fim).
export * from './coexistencia/fim.js';
// M32: financeiro e fiscal (as regras puras em @sgh/contratos/regras-financeiro).
export * from './financeiro/entradas.js';
export * from './financeiro/respostas.js';
export * from './permissoes/financeiro.js';
// M37: painel de migração gradual, treinamento e governança.
export * from './coexistencia/migracao.js';
export * from './coexistencia/desligamento.js';
export * from './coexistencia/ensaio-firebird5.js';
export * from './coexistencia/ensaio-utf8.js';
export * from './coexistencia/janela.js';
export * from './coexistencia/retrocompatibilidade.js';
export * from './permissoes/desligamento.js';
// M58-F4: a fachada de compatibilidade da API de integração da Hal-AI (contrato, catálogo, erros, limites, painel).
export * from './integracao/fachada.js';
// M38: onda 0 (consultas ao vivo): público, telas, gravações admitidas, primeira liberação e vigilância.
export * from './onda0/onda0.js';
// M55-F1: manutenção e engenharia clínica (equipamento, OS corretiva e predial com SLA, plano de manutenção com laudo,
// cobertura por contrato de manutenção e indicadores; as regras puras em @sgh/dominio-manutencao).
export * from './manutencao/vocabulario.js';
export * from './manutencao/entradas.js';
export * from './manutencao/respostas.js';
export * from './manutencao/tecnovigilancia.js';
export * from './manutencao/ciclo-vida.js';
export * from './manutencao/infraestrutura.js';
export * from './permissoes/manutencao.js';
export * from './parametros/manutencao.js';
export * from './parametros/hora-confiavel.js';
// M54 (etapa 1): contabilidade — plano de contas, regras versionadas e leitura dos fatos (motor em @sgh/dominio-contabil).
export * from './contabil/vocabulario.js';
export * from './contabil/modelo.js';
export * from './contabil/entradas.js';
export * from './contabil/rotas.js';
export * from './contabil/lancamentos.js';
export * from './contabil/demonstracoes.js';
export * from './permissoes/contabil.js';
// M48, etapa 1: notificação de incidentes (vocabulário, entradas e permissões; as regras puras em @sgh/dominio-qualidade).
export * from './qualidade/notificacao.js';
// M48, etapa 2: análise e plano de ação 5W2H, sugestão automática, tecnovigilância e farmacovigilância, painel do PSP.
export * from './qualidade/analise.js';
export * from './permissoes/qualidade.js';
// M48, etapa 3: CCIH (vigilância, dispositivos, IRAS, antimicrobianos, precauções, higiene das mãos e surtos).
export * from './qualidade/ccih.js';
export * from './permissoes/qualidade-ccih.js';
// M48, etapa 4: notificação compulsória (gatilhos, caso, prazo, ficha SINAN, notificação).
export * from './qualidade/agravo.js';
export * from './permissoes/qualidade-agravo.js';
// M48, etapa 5: gestão da qualidade (ONA) e envios regulatórios.
export * from './qualidade/gestao.js';
export * from './permissoes/qualidade-gestao.js';
// W0-04: correção e cancelamento da qualidade e da CCIH.
export * from './qualidade/crud.js';
export * from './qualidade/ouvidoria-indicadores.js';
export * from './qualidade/dispositivos-enfermagem.js';
export * from './qualidade/revisao-prontuario.js';
// M53-F0: interface com a folha externa (lote exportado e retorno) e as permissões da fatia.
export * from './pessoas/folha-interface.js';
export * from './pessoas/folha-api.js';
export * from './permissoes/pessoas-folha.js';
// M53-F2: cálculo mensal da folha (salário contratual, parâmetros, processamento e memória).
export * from './pessoas/folha-calculo.js';
export * from './pessoas/folha-ferias.js';
export * from './pessoas/folha-rescisao.js';
export * from './pessoas/folha-esocial.js';
export * from './pessoas/folha-periodicos.js';
export * from './pessoas/folha-obrigacoes.js';
// M53-F8 (M53.9): títulos e fatos contábeis da folha.
export * from './pessoas/folha-titulos.js';
// M52-F1: gestão de pessoas (colaborador, vínculos, lotação, desligamento ligado ao acesso, validade do conselho; as
// regras puras em @sgh/dominio-pessoas).
export * from './pessoas/vocabulario.js';
export * from './pessoas/entradas.js';
export * from './pessoas/respostas.js';
export * from './permissoes/pessoas.js';
// M52-F2: escala de plantão (regimes, montagem e publicação, com as regras de bloqueio).
export * from './pessoas/escala-vocabulario.js';
export * from './pessoas/escala-entradas.js';
export * from './pessoas/escala-respostas.js';
// M52-F3: troca de plantão, quem está de plantão agora, sobreaviso e dimensionamento de enfermagem (COFEN 543/2017).
export * from './pessoas/plantao-vocabulario.js';
export * from './pessoas/plantao-entradas.js';
export * from './pessoas/plantao-respostas.js';
// M56: operadora própria (vocabulário dos domínios, inventário da F0, chaves por fatia e permissões; as regras puras
// em @sgh/dominio-operadora).
export * from './operadora/vocabulario.js';
export * from './operadora/inventario.js';
export * from './operadora/chaves.js';
export * from './operadora/api.js';
// M56 (etapa 4, F3): rede credenciada e prestadora da operadora própria.
export * from './operadora/rede.js';
// M56 (etapa 5, F4): autorização de guias e auditoria médica da operadora própria.
export * from './operadora/autorizacao.js';
export * from './operadora/beneficiarios.js';
// M56 (etapa 3, F2): cobrança e mensalidades da operadora própria.
export * from './operadora/cobranca.js';
// M56 (etapa 6, F5): contas médicas recebidas pela operadora própria (XML TISS, glosa, recurso e pagamento).
export * from './operadora/contas.js';
// M56 (etapa 7, F6): obrigações da operadora com a ANS (SIB, SIP, DIOPS, TPS, monitoramento TISS e ressarcimento ao SUS).
export * from './operadora/ans.js';
// M56 (etapa 8, F7): atendimento ao beneficiário com protocolo e portal do prestador credenciado.
export * from './operadora/atendimento.js';
export * from './permissoes/operadora.js';
// M57 (etapa 1): MPI da Rede (vocabulário, contratos das telas e permissões; as regras puras em @sgh/dominio-rede).
export * from './rede/vocabulario.js';
export * from './rede/telas.js';
export * from './permissoes/rede.js';
// M50 etapa 1: portal do paciente (conta, responsável legal, consentimentos, pedidos do titular e documentos).
export * from './portal/vocabulario.js';
export * from './portal/entradas.js';
export * from './portal/respostas.js';
// M50 etapa 2: agendamento online, pré-check-in, pagamento e pesquisa do portal.
export * from './portal/agenda-online.js';
export * from './permissoes/portal.js';
// M57 (etapa 3): BI consolidado da Rede, pseudônimo da Rede e serviços compartilhados.
export * from './rede/bi.js';
export * from './permissoes/rede-bi.js';
// M50 etapa 3: portal do médico externo (extrato, agenda cirúrgica e pedido de cirurgia; vínculo com o corpo clínico).
export * from './portal-medico/portal-medico.js';
export * from './permissoes/portal-medico.js';
// M50 etapa 4: telemedicina (teleconsulta com a sala de espera do portal e teleinterconsulta).
export * from './telemedicina/teleconsulta.js';
export * from './permissoes/telemedicina.js';
// M39: onda 1 (cadastros, agenda, call center, recepção ambulatorial e painéis).
export * from './onda1/onda1.js';
// M40: onda 2 (ordem dos setores, operações da ficha, critério de liberação, regras 6, 14, 15 e 16, registro do setor).
export * from './onda2/onda2.js';
// M50, etapa 6: agenda de sessões e recursos; digitalização certificada do prontuário em papel.
export * from './agenda/sessoes.js';
export * from './internacao/digitalizacao.js';
export * from './permissoes/sessoes-digitalizacao.js';
// M52-F5: SESMT (prontuário ocupacional e ASO, vacinas, acidente e CAT, riscos por função, EPI e dosimetria).
export * from './pessoas/sesmt-vocabulario.js';
export * from './pessoas/sesmt-entradas.js';
export * from './pessoas/sesmt-respostas.js';
export * from './permissoes/pessoas-sesmt.js';
// M52.4 (gestão de pessoas, F4): ponto (AFD, ajustes, apuração, banco de horas, espelho com ciência, AEJ).
export * from './pessoas/ponto-vocabulario.js';
export * from './pessoas/ponto-entradas.js';
export * from './pessoas/ponto-respostas.js';
export * from './permissoes/pessoas-ponto.js';
// M52.6 (gestão de pessoas, F6): treinamentos e POP, autosserviço, plantão realizado para o repasse.
export * from './pessoas/treinamento-vocabulario.js';
export * from './pessoas/treinamento-entradas.js';
export * from './pessoas/treinamento-respostas.js';
export * from './permissoes/pessoas-f6.js';
// M53-F1: rubricas, incidências e tabelas legais da folha (as regras puras em @sgh/dominio-pessoas).
export * from './pessoas/rubricas.js';
// W0-06, parte 4: cargos e salários (M1 de mercado).
export * from './pessoas/cargos.js';
// W0-06, parte 5: avaliação de desempenho, competências e PDI (M2 de mercado).
export * from './pessoas/avaliacao.js';
// W0-06, parte 6: solicitações do autoatendimento e fila do gestor (M3 de mercado).
export * from './pessoas/autoatendimento-solicitacao.js';
// W0-06, parte 7: painel de indicadores de pessoas (M4 de mercado).
export * from './pessoas/indicadores-pessoas.js';
// M60-F2: conferência da instalação e da conexão ao banco (as regras puras em @sgh/dominio-config).
export * from './implantacao/instalacao.js';
// M60-F3: fumaça do servidor e verificação pós-implantação (as regras puras em @sgh/dominio-config).
export * from './implantacao/fumaca.js';
// M54 (etapa 4): custos — estrutura de custos (centros classificados, ordem e critério do rateio) e estatísticas.
export * from './custos/estrutura.js';
// M54 (etapa 5): custos — apuração do mês (absorção), custo por conta, resultado e exportação.
export * from './custos/apuracao.js';
export * from './permissoes/custos.js';
// M54 (etapa 7): orçamento empresarial — versões, linhas por centro e item, aprovação e orçado × realizado.
export * from './orcamento/orcamento.js';
export * from './permissoes/orcamento.js';
// M59-F2: senhas, segundo fator e identidade.
export * from './acesso/identidade.js';
export * from './permissoes/endurecimento-identidade.js';
// M59-F4: saneamento dos grupos genéricos em perfis de função.
export * from './acesso/saneamento.js';
export * from './permissoes/endurecimento-saneamento.js';
// M59-F5: pacote de evidências SBIS, ciclos de avaliação, termo das concessões e backup verificado.
export * from './auditoria/sbis.js';
export * from './permissoes/endurecimento-sbis.js';
// M54 (etapa 6): patrimônio — bens a partir da nota, plaqueta e QR, movimentos com aceite, depreciação e inventário.
export * from './patrimonio/patrimonio.js';
export * from './patrimonio/ajuste.js';
export * from './permissoes/patrimonio.js';
export * from './plataforma/onboarding.js';
