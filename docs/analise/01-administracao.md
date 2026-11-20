# Análise cruzada 01: administração, segurança, auditoria, técnico do fornecedor e relatórios/BI

Grupo: **ADM** (administração, segurança, auditoria), **SIS** (técnico do fornecedor) e **REL** (relatórios e BI).
Data: 2026-11-20. Fontes: só leitura de `referencias/mv-tabelas.tsv`, da matriz de 1.503 tabelas do SPDATA
(`new-sgh/planejamento/referencias/matriz-cobertura-1503-tabelas.tsv`), de `new-sgh/planejamento/ESTADO.md`,
da árvore de menus e do código do new-sgh (`packages/dominio-*`, `apps/api/src`, `apps/web/src`).

Como ler:
- **MV (evidência):** tabelas do MV por esquema e prefixo, com "N tab / M com dados". Os nomes só aparecem aqui, como evidência.
- **SPDATA (evidência, uso):** tabelas da matriz com o volume de linhas. "1.000+" quer dizer que a contagem da matriz
  parou em 1.001.
- **new-sgh (estado):** onde está construído (pacote, rota da API, tela) e em que marco. Quase tudo está "aguardando
  validação" no ESTADO.md. Muitas gravações estão desligadas por estabelecimento, porque o new-sgh grava no Firebird
  ao vivo. No banco próprio, essas gravações passam a ser nativas.
- **Entidades próprias:** nomes nossos, em `snake_case`, só para as decisões F3 e F7. Nenhuma tabela do MV nem do SPDATA
  vira nome nosso.

## Resumo numérico

| Item | Valor |
|---|---|
| Tabelas do MV analisadas no grupo | **1.636** (507 com dados) |
| Esquemas do MV cobertos | DBASGU, DBACP, DBADW, MVBIKE, DBAPORTAL (parte estratégica e BI), DBATUALIZA, GCMMV, MVONEPASS, CARTORIO e o recorte do DBAMV (prefixos `LOG_`, `CONFIG_`, `CONFIGURACAO_`, `USUARIO_`/`USUARIOS_`/`USU_`, `MULTI_EMPRESAS`, `REPORTS_`, `BATCH_`, `PW_QRTZ_`, `GCM_`, `TROCPAC_`, `PAINEL_`, `NOTIFICACAO`, assinatura digital, feriados, e-mail, impressão) |
| Tabelas do MV deixadas para o grupo de qualidade (DBAPORTAL: ocorrências, riscos, documentos, auditorias, acreditação) | 109 (28 com dados), fora da conta acima |
| Tabelas do SPDATA no grupo (módulos ADM, SIS, REL e as de natureza auditoria dos outros módulos) | 64 ADM + 17 SIS + 16 REL + 9 de auditoria em outros módulos = **106** |
| Funcionalidades | **55** |
| Decisão F3 (paridade) | **33** |
| Decisão F7 (hospital do zero) | **2** |
| Decisão F8 (recurso novo) | **8** |
| Decisão NAO | **12** |
| Entidades próprias propostas (F3 e F7) | **110** |

Conta das tabelas do MV: 1.745 tabelas classificadas menos 109 tabelas de qualidade = 1.636. Com dados: 535 − 28 = 507.

Conta das decisões: 33 + 2 + 8 + 12 = 55.

Leitura rápida:
- Do lado do **MV**, o grupo é grande (1.636 tabelas) mas pouco usado: só 31% têm dados (507 de 1.636). Três blocos
  respondem por 40% das tabelas:
  - a trilha por módulo: 265;
  - o data warehouse dimensional: 245;
  - a parametrização: 151.
- Do lado do **SPDATA**, o uso real está concentrado em quatro pontos:
  - na trilha de auditoria (mais de 1 milhão de eventos);
  - nos vínculos de acesso do usuário;
  - nos parâmetros por módulo e por usuário;
  - no editor de relatórios (252 relatórios de SQL livre).
- O **new-sgh** já cobre quase todo o grupo, e cobre mais do que o SPDATA em privacidade, quebra de vidro,
  recertificação, painéis com ficha técnica e data mart. As lacunas estão no fim do documento.

## Matriz de cobertura

### ADM: administração, segurança e auditoria

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Cadastro de usuários e ciclo de vida da conta (criação, bloqueio, contas dormentes, pedido de acesso, recertificação) | 14 tab / 10 com dados. DBASGU `USUARIOS`, `USUARIOS_MASTER`, `CONFIGURACAO_USUARIO`; DBACP `USUARIO_PORTAL*`; usuários próprios dos portais (`PLAUDOS_USUARIOS*`) e do MVBIKE | `TBUSERS` (1.000+) | M05/M10: `dominio-acesso` (`usuario`, `contas`, `concessao`), API `modulos/acesso` e `administracao/usuarios.controller`; telas `/administracao/acesso/usuarios`, `/pedidos`, `/recertificacao`, `/contas-dormentes`. Aguardando validação | F3: sem usuário não há virada; os 168+ usuários ativos migram no dia 0 | `usuario`, `usuario_vinculo_profissional`, `pedido_acesso`, `recertificacao_acesso` |
| Perfis, papéis de segurança e permissões por ação | 37 tab / 26 com dados. DBASGU `PAPEL*`, `PER_*`, `GRUPO_USUARIO`; DBACP `FUNCAO_PERMISSAO_*`, `MODULO_PERMISSAO_*`, `SISTEMA_PERMISSAO_*`; MVBIKE `PERFIL*` | `TBGRUUSU` (42 grupos), `TBPERUSU` (1.000+), `TBOPCOES` (1.000+), `TBPAPEL` (5), `TBPAPEL_TBOPCOES` (520), `TBUSERS_TBPAPEL` (1.000+); `DIPERMPS` descartada | M06/M10: `dominio-acesso` (`ability`, `catalogo`, `mapa-grupos`, `segregacao`); telas `/administracao/acesso/grupos`, `/perfis`, `/permissoes`, `/mapa`, `/simulador`. Aguardando validação | F3: as permissões de hoje têm de valer no dia 1; o simulador e a segregação de funções já existem | `grupo_usuario`, `perfil_acesso`, `acao_sistema`, `perfil_acao`, `usuario_perfil`, `papel_seguranca`, `regra_segregacao_funcao` |
| Escopo do usuário e permissões finas: estabelecimento, unidade, local, convênio, tipo de agenda, tipo de prontuário, alçadas de aprovação | 83 tab / 19 com dados. DBAMV `USUARIO_*` (ex.: `USUARIO_MULTI_EMPRESA`, `USUARIO_SETOR`, `USUARIO_CAIXA`), `USUARIOS_AUTORIZADORES*`, `USU_AUT_*`, `ALCADA_TRANSF`; DBASGU `USUARIO_LEITO`, `USUARIO_EMPRESA_COLETA` | `TBUNIUSE` (825), `TBLOCAL_TBUSERS` (1.000+), `TBUSERS_TBCONVEN` (1.000+), `TBUSERCON` (1.000+), `TBCTRPRTUSU` (1.000+), `TBAGEUSE` (29), `TBUSUCPL` (400), `TBPERMISSAO_SUS` (1.000+) | M06/M10: seletor de unidade na sessão, vínculos lidos de `TBUNIUSE`; parâmetros por usuário em cada módulo. `TBPERMISSAO_SUS` só no inventário, sem contrato nem tela | F3: o recorte de quem vê o quê é uso diário (mais de 1.000 vínculos em cinco tabelas) | `usuario_estabelecimento`, `usuario_unidade`, `usuario_local_atendimento`, `usuario_convenio`, `usuario_tipo_agenda`, `usuario_tipo_prontuario`, `alcada_aprovacao` |
| Política de senha, sessão, bloqueio por tentativas e segundo fator | 8 tab / 5 com dados. DBASGU `DIRETRIZ_SENHA`, `LOG_SENHA`, `CONFIG_SGU`; DBAMV `CONFIG_ACESSO_SISTEMA`; tokens do portal de laudos | `TBCFGLOGIN` (1), `TBHISTSENHA` (1.000+) | M05: `dominio-acesso` (`politica-senha`, `politica-2fa`, `totp`, `tentativas`, `tempo-sessao`, `reautenticacao`); telas `/administracao/acesso/politica-senha`, `/2fa`, `/preferencias/segundo-fator`. Troca de senha pelo novo especificada, gravação bloqueada (M04) | F3: no banco próprio, a credencial passa a ser nossa (Argon2id); o histórico do legado só serve para a regra de não repetir | `politica_senha`, `credencial_usuario`, `historico_senha`, `segundo_fator_usuario`, `bloqueio_login` |
| Login único corporativo (LDAP, Active Directory, SSO) | 11 tab / 2 com dados. MVONEPASS (4); DBASGU `CONFIG_SGU_LDAP`; DBACP `CONFIG_LOGIN_UNICO`, `CONFIGURACAO_AD`, `AUTH_CHAVE`; DBAPORTAL `CONFIGURACAO_LDAP`, `CONFIG_AUTENTICACAO_CONNECT` | Não tem | Não tem (login próprio e conta da plataforma separada) | F7: hospital com TI corporativa exige o diretório da casa; a Rede Santé não usa | `provedor_identidade`, `vinculo_identidade_externa` |
| Biometria do usuário no login | 4 tab / 0 com dados. DBASGU `BIOMETRIA_USUARIOS`; DBAMV `CONFIG_BIO_AUTENTICACAO`, `CONFIG_ACESSO_BIO_MAQUINA`, `CONFIGURACAO_BIOMETRIA` | `TBLEITORBIOME` (2: modelos de leitor); biometria usada no cadastro do paciente, não no login | Não tem | F8: o MV também não usa (nenhuma linha); o segundo fator cobre a necessidade | — |
| Termo de uso do sistema com aceite por usuário | 1 tab / 0 com dados. DBASGU `TERMO_USO` | `PRTERMOCAD` (1), `PRTERMOACEITE` (814 aceites, 2022-2026) | M05/M10: `dominio-acesso/termo`, tela `/administracao/acesso/termo` (publicar versão). Aguardando validação | F3: exigência da certificação SBIS; os aceites migram como histórico | `termo_uso_versao`, `aceite_termo_uso` |
| Registro de sessões, entradas e últimos acessos | 19 tab / 6 com dados. DBASGU `LOG_ACESSO_MV2000`, `MOD_LOG_ACESSO_MV2000`, `ESTAT_*`; DBAMV `USUARIO_ULTIMO_ACESSO`, `LOG_CONTAGEM_USUARIO`, `LOG_ACESSO_PEP`; DBACP `USUARIO_LOGADO` | `TBSGHCONEXAO` (1.000+, 2012-2026); `TBUSERMODULO` e `FPCON` descartadas | M06/M58: trilha de login; relatório de sessões pela tabela de conexões (M58.1); contas dormentes usam o último acesso | F3: alimenta contas dormentes, recertificação e a trilha SBIS | `evento_sessao`, `ultimo_acesso_usuario` |
| Trilha de auditoria: inclusões, alterações e exclusões com quem, quando, de onde e o antes e depois | 265 tab / 57 com dados. DBAMV `LOG_*` (uma por assunto: alta, conta, prescrição, estoque, repasse, exclusões de paciente, atendimento e exame), `AUDIT_TABELA*`, `AUDIT_COLUNA*`, `HIST_*`; DBACP `LOGS_EDICAO` | `TBCABTRILHA` (1.000+; mais de 1 milhão, 2020-2026), `TBLANTRILHASGH` (1.000+), `TBLANTRALERTA` (1.000+), `TBEVENTOS` (117), `TBTPACAOAUDIT` (29), `TBNVLCRITICID` (8); cópias de excluídos `REEXCATE` (520), `RIALTA_EXCLUSAO` (75), `RIEXCINT` (30), `REPACAGD_EXCLUSAO` (20), `SIRES01_DELETE` (1.000+), `CCCADCIR_EXCLUSAO` (3), `SICADATE_EXCLUSAO` (3), `SIPACAGD_EXCLUSAO` (1); históricos `HTTBCBOPRO` (1.000+), `HTTBHOSPIT` (14), `HTCHKGERAL` (1.000+), `GEATUALIZASALDO` (507) | M06: `apps/api/src/autorizacao` (`auditoria.interceptor`, `trilha`), `dominio-acesso/sbis` e `imutabilidade`; telas `/administracao/auditoria/trilha` e `/sbis`. Aguardando validação | F3: obrigação SBIS e base da investigação; no banco próprio, uma trilha única gravada pela aplicação na mesma transação, sem gatilho, no lugar das 265 tabelas por assunto do MV | `evento_auditoria`, `evento_auditoria_registro`, `tipo_acao_auditavel`, `nivel_criticidade_auditoria`, `registro_excluido` |
| Histórico de mudança de parâmetros e configurações | 11 tab / 5 com dados. DBAMV `AUDITORIA_CONFIG`, `CONFIG_*_LOG`, `LOG_CONFIG_*`, `HIST_CONFIG_*` | Sem tabela própria; só `FPPARAMVIG` (1: vigência dos parâmetros da folha) | M08: parâmetros com vigência e gravação auditada (`config/gravacao`) | F3: mudar um parâmetro muda o faturamento ou a prescrição; precisa de quem, quando e o valor anterior | `parametro_valor_historico` |
| Prontuário restrito, acesso de emergência (quebra de vidro) e registro de quem leu | 3 tab / 0 com dados. DBAMV `PW_AUDITORIA_PRONTUARIO_VIP`, `PW_SENHA_PACIENTE_VIP`, `CONFIGURACAO_SISTEM_ACES_ANEXO` | `TBTPPERM_RICADPAC` (2: restrito ou consentido) | M10/M15: `dominio-acesso/emergencia`, tela `/administracao/acesso/quebras-de-vidro`; registro de leitura do prontuário (item novo da árvore, F1) | F3: o new-sgh já trava o prontuário restrito; a revisão da quebra de vidro é exigência SBIS | `restricao_prontuario`, `acesso_emergencial`, `leitura_prontuario` |
| LGPD: termos de consentimento e revogação, pedidos do titular, anonimização, encarregado | Nenhuma tabela específica no MV (os termos de consentimento do MV são clínicos, de procedimento) | `TBLGPDANONMOT` (6), `TBMOVTERMSTATUS` (5), `TBTERMCONREVTP` (4), `TBLGPDANONUSERFUNCAO` (2), `TBTIPOREPRE` (2); só os domínios, sem movimento | M10/M50: `dominio-acesso/privacidade` (`pedido-titular`, `copia-prontuario`), tela `/administracao/privacidade`; tabelas da privacidade só em consulta pelo CRUD genérico | F3: obrigação legal; o pedido do titular com prazo de 15 dias já existe | `base_legal_tratamento`, `termo_consentimento`, `consentimento_titular`, `pedido_titular`, `anonimizacao_registro`, `encarregado_dados` |
| Estabelecimentos da rede (multiempresa), dados fiscais e identidade visual nos documentos | 9 tab / 5 com dados. DBAMV `MULTI_EMPRESAS`, `MULTI_EMPRESAS_LOGOMARCA`, `MULTI_EMPRESAS_REPASSE` e afins | `TBEMPHOS` (1), `TBHOSPIT` (1), `TBUNIDAD` (6), `TBEMPHOSLOGO` (1), `TBTPEMP` (2) e domínios fiscais | M10: tela `/administracao/empresa` (só consulta); `dominio-organizacao/hierarquia`; uma conexão por hospital em `/administracao/coexistencia/estabelecimentos` | F3: tudo no banco novo pende de estabelecimento; o cadastro em si é do grupo de estrutura | `rede`, `empresa`, `estabelecimento`, `unidade_atendimento`, `logotipo_estabelecimento` |
| Parametrização por escopo (rede, estabelecimento, unidade, módulo, usuário) com vigência | 151 tab / 60 com dados. DBAMV `CONFIG_*` (ex.: `CONFIG_FATURAMENTO`, `CONFIG_ESTOQUE`, `CONFIG_GERAL`), `CONFIGURACAO_*`, `PARAMETROS_*`; DBASGU `PARAMETRO`, `PARAM_MODULO*`; DBACP `PARAMETRO_GLOBAL*` | Cerca de 40 tabelas: `SIPAREND` (1.000+), `SIPARLAB` (1.000+), `SIPARTM` (1.000+), `SIPARULT` (1.000+), `SIPARRX` (934), `SIPAROUT` (806), `GEPARAM` (525, cerca de 300 campos), `FCPARUSU` (403), `CCPARAM` (97), `MFPARUSU` (59), `FCPARAM`, `FIPARAM`, `FAPARAM` e os domínios de obrigatoriedade `TBDIGITAR*` | M08: `dominio-config/parametros`, `config/parametros.controller`, telas `/administracao/parametros` e `/:chave`. Aguardando validação | F3: o comportamento de hoje depende desses valores. No modelo próprio, um mecanismo só com definição tipada, escopo e vigência, no lugar de uma tabela larga por módulo | `parametro_definicao`, `parametro_valor` |
| Feriados e calendário do estabelecimento | 7 tab / 4 com dados. DBAMV `FERIADO`, `FERIADO_EMPRESA`, `MANUTENCAO_FERIADO`; DBASGU `HORARIO_VERAO`; DBAPORTAL `CALENDARIO` | `TBFERIAD` (11) | M14: CRUD genérico de domínios (feriados fixos, móveis e facultativos) | F3: agenda, prazos em dias úteis e escala dependem disso | `feriado` |
| Catálogo de módulos, telas e ações, menu, busca e favoritos | 42 tab / 20 com dados. DBASGU `MENU`, `MODULOS`, `MENU_PROCESSO`, `PESQUISA_MENU*`, `USUARIO_MENU_FAVORITO`; DBAMV `MENU_SOUL`; DBACP `FUNCIONALIDADE`, `MODULO_SISTEMA` | `TBMODULO` (75), `TBOPCOES` (1.000+) | M06/M10: catálogo de permissões em `dominio-acesso/catalogo`; busca global Ctrl+K (F1); o menu vem das rotas do web | F3: a permissão é por ação do catálogo; menu e favoritos vêm do código, só o favorito do usuário fica no banco | `modulo_sistema`, `tela_sistema`, `favorito_usuario` |
| Liberação de funcionalidades por estabelecimento (ligar e desligar por hospital) | Só na forma de licença comercial: DBACP `FUNCIONALIDADE_SISTEMA_LICENCA` (contada na linha de licenciamento) | Não tem | M08/M37: `dominio-config/liberacao`, tela `/administracao/liberacao` (chaves desligadas por estabelecimento, POL-3) | F3: a virada por hospital e por setor depende disso | `funcionalidade_estabelecimento` |
| Mensagens internas e comunicados com ciência | 13 tab / 9 com dados. DBASGU `MENSAGEM`, `USUARIO_MENSAGEM`, `CRMI*` (comunicados com controle de leitura); DBAPORTAL `MENSAGEM`, `MENSAGEM_NOTICIA`, `PARA_MENSAGEM` | `TBMENSAG` (98, parada desde 2024) | M27: `acesso/comunicacao.controller` (comunicado com ciclo de publicação); o legado só em consulta | F3: o comunicado com ciência substitui a mensagem interna; o legado migra como leitura | `comunicado`, `comunicado_destinatario`, `comunicado_ciencia`, `mensagem_interna` |
| Alertas configuráveis do sistema e central de notificações do usuário | 15 tab / 6 com dados. DBAMV `CONFIG_NOTIFICACAO*`, `NOTIFICACAO`, `MVPEP_NOTIFICACAO`, `PERFIL_ALERTA*`; DBAPORTAL `PENDENCIA` | `TBALERTA` (2), `TBALERTA_TBOPCOES_TBEVENTOS` (2), `TBCENARIO` (1), `TBUSERS_TBALERTA` (1) | M10: tela `/administracao/alertas` só em consulta; as filas de trabalho por perfil do Início fazem o papel da central | F3: pouco uso no legado, mas as worklists e os avisos de prazo do new-sgh precisam de onde registrar o aviso | `regra_alerta`, `alerta_gatilho`, `assinatura_alerta`, `notificacao_usuario` |
| Notificação por regra com consolidação e histórico de envio | 8 tab / 0 com dados. DBACP `NI_*` (regra, consolidadora, envio, resposta) | Não tem | Não tem | F8: ideia boa (juntar avisos e medir resposta); o MV não usa | — |
| Servidor de e-mail, tipos e modelos de mensagem, registro de envio | 14 tab / 4 com dados. DBASGU `TIPO_EMAIL`, `TAG_CAMPO_EMAIL`, `SERVICO_ENVIO_EMAIL`; DBAMV `CONFIG_EMAIL`, `PROCESSO_EMAIL`, `DESTINATARIO_UNIFICADO` | `PREMAILCFG` (2, com credencial), `PREMAILMODULO` (4) | M10: tela `/administracao/notificacoes` (só consulta, credencial mostrada como definida ou não); fora de produção, a saída é a caixa de teste | F3: envio de laudo, relatório agendado e convite de conta dependem disso; a credencial fica no cofre, nunca no banco | `servidor_email`, `modelo_email`, `envio_email` |
| Assinatura digital de documentos (ICP-Brasil, nuvem), política por tipo de documento e verificação pública | 19 tab / 4 com dados. CARTORIO (`DOCUMENT`, `SIGNATURE`, `STATUS`); DBAMV `ASSINATURA_DIGITAL*`, `DOCUMENTO_DIGITAL`, `FILA_CARTORIO_DIGITAL`, `CONFIGURACAO_ASSINATURA_DIGIT`, `PW_RELATORIO_ASSINATURA_DIGIT` | `TBOID` (85), `TBTIPOOID` (10), `TBTIPOCERTIFICADO` (3), `TBFORMA_ASSINATURA_ICP` (2); documentos do prontuário `PRASSINATURA_DOC` (1.000+, cerca de 1,4 milhão, módulo PEP) | M49.1 a M49.3: `dominio-documento/assinatura`, API `modulos/assinatura` (assinatura em lote, prévia com selo, verificador público com limite de taxa); cadastros no CRUD genérico | F3: o prontuário da Rede Santé já é assinado; o documento é do grupo PEP, e aqui ficam a política e a verificação | `politica_assinatura`, `documento_assinado`, `assinatura_documento`, `consulta_verificacao_documento`, `oid_icp`, `tipo_certificado` |
| Impressoras por estação de trabalho e controle de reimpressão | 11 tab / 0 com dados. DBAMV `IMP_REGISTRO_TERMINAL`, `IMP_REGISTRO_GIW`, `IMPRESSORA_TERMINAL*`, `PRINTER_REGISTRY_INFO`, `TAB_REIMPRESSAO` | Não tem (o desktop imprime na impressora local) | Etiquetas e pulseiras em ZPL e PDF em `dominio-documento` (`zpl`, `pdf`); a estação é só origem da trilha (`autorizacao/estacao.ts`) | F3: na web, a etiqueta e a pulseira precisam saber a impressora de cada guichê e posto | `estacao_trabalho`, `impressora`, `estacao_impressora`, `registro_reimpressao` |
| Unificação de cadastros duplicados, com registro do que mudou e reversão | 35 tab / 0 com dados. DBAMV `TROCPAC_*` (cópia de cada tabela afetada na troca de paciente); DBASGU `TROCPAC_PLAUDOS_*` | `HTPRONTUNIF` (6, 2020-2025) | M57.1: índice de pacientes da Rede (pareamento e fila de revisão); unificação no cadastro | F3: o legado tem duplicados que o dia 0 vai trazer; a fronteira é com o grupo de cadastro | `unificacao_cadastro`, `unificacao_item` |
| Backup verificado e restauração testada | Nenhuma tabela (o MV faz backup no banco) | `TBSITBACKUP` (4), `TBPROCBACKUP` (2); `TBBASEDADOS` descartada | M10/M59: telas `/administracao/backup` e `/administracao/auditoria/backup` (restaurações diária e mensal verificadas); `dominio-acesso/sbis/backup` | F3: exigência SBIS; no banco próprio é a operação do MariaDB, com o registro da verificação no sistema | `verificacao_backup` |
| Justificativa para imprimir ou exportar o prontuário | Nenhuma tabela equivalente no grupo (`ACESSO_DOCUMENTO` do DBAMV só registra o acesso) | `PRJUSTIF_IMP_EXPORTACAO` (1.000+), `PRTIPO_JUSTIF_EXPORTACAO` (4) | M34: exportação com justificativa no catálogo de relatórios; cópia do prontuário em `privacidade/copia-prontuario` | F3: exigência SBIS, com uso alto | `tipo_justificativa_exportacao`, `exportacao_documento` |
| Dicionário ortográfico pessoal | Nenhuma tabela | `TBDICIONARIO_TBUSERS` (77, 8 usuários) | M27: `contratos/texto/fonetica`, Preferências do usuário | F3: pouco uso, mas os médicos que usam perdem as palavras sem ele | `dicionario_usuario` |
| Preferências do usuário (tela inicial, densidade, colunas, ordenação) | 7 tab / 3 com dados. DBACP `PAINEL_PREFERENCIAS_USUARIO`; DBAPORTAL `PREFERENCIA_*`, `ORDENACAO_PREFERENCIA` | `TBUSERSCOMPL` (962) | M05/M10: tela `/preferencias` (`SGH_ACESSO_PREFERENCIA`) | F3: 962 usuários têm preferência gravada | `preferencia_usuario` |
| Acesso de suporte técnico auditado ("entrar como" o usuário) | Só conta mestre: DBASGU `USUARIOS_MASTER` (contada no cadastro de usuários) | Não tem | ADR 0021: contas da plataforma, designação de suporte por estabelecimento, sessão do alvo marcada com o ator real, prazo absoluto e auditoria de cada escrita; telas `/plataforma/*` | F3: é como o novo será operado e suportado desde o dia 1 | `conta_plataforma`, `atribuicao_suporte`, `sessao_suporte`, `auditoria_plataforma` |

### SIS: técnico do fornecedor

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Controle de versão, atualização e scripts do produto | 46 tab / 33 com dados. GCMMV (13: agentes, servidores, planos de execução); DBASGU `VERSAO`, `AS_*`; DBAMV `GCM_*`, `VERSAO`, `CONTROLE_ATUALIZACAO`, `EDITOR_PATCH`; `DATABASECHANGELOG*` em três esquemas | `HTALTESTRUTBD` (847), `TBSGHSCR` (1.000+), `TBSGHVERSAO` (25), `TBSCRSAC` (18), `IBE$VERSION_HISTORY` (59): todas descartadas | M60: pacote de implantação (`instalar.sh`, `atualizar.sh` com volta automática, `sgh:aplicar` com simulação) | NAO: as migrações versionadas ficam na ferramenta de esquema do projeto, não em tabela de negócio | — |
| Motor de regras em banco disparado por evento de tabela e coluna | 8 tab / 7 com dados. DBASGU `RN_*` (evento por coluna, código PL/SQL a executar, rastro) | Equivalente: os gatilhos do Firebird (não estão na matriz) | Regras puras em `packages/dominio-*` | NAO: premissa do dono, nenhuma regra de negócio em gatilho ou em código guardado no banco | — |
| Dicionário de dados, metadados e customização de objetos do fornecedor | 37 tab / 13 com dados. DBASGU `TABELAS`, `TAB_ENTIDADE`, `CE_*`; DBAMV `CG_REF_CODES`; DBACP `LISTA_VALORES`, `MASCARA`; DBAPORTAL `CAMPOS`, `DUMMY_SEQ` | `GETRUFA` (2), `TBDIASEMANA` (7), `TBEDITORTXT` (4) | Enumerações no código (`/cadastros/dominios/enumeracoes`) | NAO: domínio fechado vira enumeração tipada; domínio aberto vira cadastro próprio | — |
| Ferramentas de diagnóstico de desempenho do banco | 18 tab / 5 com dados. DBAPORTAL `PLSQL_PROFILER*`, `SQLN_*`, `DEBUG_*`; `PLAN_TABLE` | Não tem | Telemetria e logger da API (`telemetria.ts`, `logger.ts`) | NAO: é ferramenta do Oracle | — |
| Rotinas agendadas e histórico de execução (cargas, envios, fechamentos automáticos) | 23 tab / 13 com dados. DBAMV `BATCH_*` (6), `PW_QRTZ_*` (10), `EDITOR_JOB`, `LOG_TASK`, `FECHA_CONTA_CONFIG_JOB_AGEND`; MVBIKE `TAREFA`, `ROTINA_CARGA` | `TBEDITREL_AGENDA_LOG` (1.000+: o único agendador com registro; o resto roda no desktop) | Filas e retentativas em `dominio-integracao` (`retentativa`, `idempotencia`); filas de implantação (`implantacao/filas.ts`) | F3: o sincronismo diferencial, o envio agendado de relatório e a carga do data mart precisam de execução registrada e visível na Administração | `rotina_agendada`, `execucao_rotina` |
| Log técnico de erros da aplicação | 16 tab / 5 com dados. DBAMV `LOG_ERRO`, `SITE_LOG_EVENTO*`; DBACP `LOGS`; DBAPORTAL `LOG_SISTEMA` | `TBSGHLOG` (1.000+, descartada) | Saúde do sistema `/administracao/saude`, fumaça do servidor, telemetria | NAO no banco: o erro técnico vai para a observabilidade, não para tabela de negócio | — |
| Ajuda de tela e tradução de conteúdo | 2 tab / 0 com dados. DBAMV `CG_FORM_HELP`; DBATUALIZA `DICTRADUCAO_CONTEUDO` | Não tem | i18n no código (`apps/web/src/i18n`) | NAO: o texto da tela fica no código | — |
| Kit de implantação e diagnóstico de processos do cliente (cenários, cadastros mínimos, aceleradores, metas da implantação) | 108 tab / 40 com dados. MVBIKE (96: `DIAGNOSTICO_*`, `METAS_DIAG*`, `ITEM_CADASTRO`, `ACELERADOR*`, `GRF_*`, `CENTRAL_PARAMETRIZACAO`); DBATUALIZA (10); DBASGU `CHECAGEM_IMPLANTACAO`, `IMPLANTACAO` | Não tem | M36/M37/M60: prontidão por setor (`dominio-config/prontidao`), homologação, conferência e manual de implantação | F7: para vender a um hospital novo, a prontidão precisa listar os cadastros mínimos e o que falta; a Rede Santé usa a versão de virada | `implantacao_estabelecimento`, `item_prontidao` |
| Cadastro de clientes, hospitais e produtos do fornecedor | 13 tab / 4 com dados. DBASGU `CLIENTE`, `HOSPITAL`, `MV_ADM*`, `PRODUTO_SISTEMA`; MVBIKE `CLIENTE*`, `EMPRESA*` | `FPEMPSOFTWARE` (1, descartada) | Não se aplica | NAO: dado do fornecedor; o estabelecimento é nosso (linha de estabelecimentos) | — |
| Licenciamento comercial de módulos e usuários | 11 tab / 9 com dados. DBACP `SISTEMA_LICENCA`, `TIPO_LICENCA`, `USUARIO_SISTEMA_LICENCA`, `FUNCIONALIDADE_SISTEMA_LICENCA`; DBAPORTAL `TIPO_LICENCA_SE`, `CONTA_CLOUD` | `TBPAPEL` (limite de usuários por papel, visto como permissão) | Liberação por estabelecimento (feature flags) | NAO: o ligar e desligar por hospital já está na linha de liberação de funcionalidades | — |
| Servidor de relatórios do fornecedor (agentes, repositório, impressoras, monitor) | 7 tab / 0 com dados. DBAMV `REPORTS_AGENTS_*`, `REPORTS_BATCH_INFO`, `REPORTS_MONITOR_*`, `REPORTS_REPOSITORY_INFO` | `TBEDITQRP` (1.000+: componentes QuickReport do desktop, só referência) | PDF gerado pela API (`dominio-documento/pdf`) | NAO: infraestrutura do fornecedor | — |
| Carga inicial e sincronismo diferencial a partir do legado (conector) | Nenhuma no grupo (o de-para do MV é de integração, de outro grupo) | Origem: as 1.503 tabelas; a matriz já diz o destino de cada uma (`migrar-crud` 734, `carga-referencia` 423, `migrar-movimento` 156, `migrar-leitura` 140, `descartar` 50) | Coexistência ao vivo (M38 a M43, `modulos/coexistencia`: migração, retrocompatibilidade, desligamento); a conferência de assinatura de dados (`config/assinaturas`) é a base da avaliação do dia 1 | F3: é o caminho da virada. Dia 0: carga a partir da cópia do Firebird. Dia 1: avaliação dos dados pelas áreas. Dia 2+n: sincronismo diferencial e abertura da gravação | `lote_carga_legado`, `marca_sincronismo`, `mapa_identificador_legado`, `divergencia_carga` |
| Cadastros paralelos dos produtos satélite (pessoa, organização, cargo, telefone e endereço próprios) | 18 tab / 9 com dados. DBAPORTAL `ORGANIZACAO`, `CONTATO*`, `TELEFONE`, `ENDERECO`, `CARGO`, `DIVISAO_SETOR`, `PESSOA_INTEGRACAO` | Não tem | Um só cadastro de pessoa e estrutura (`dominio-pessoas`, `dominio-organizacao`) | NAO: duplica o cadastro central | — |

### REL: relatórios e BI

| Funcionalidade | MV (evidência) | SPDATA (evidência, uso) | new-sgh (estado) | Decisão | Entidades próprias |
|---|---|---|---|---|---|
| Catálogo de relatórios parametrizados, com permissão por perfil, máscara de dado pessoal e execução registrada | 29 tab / 8 com dados. DBAMV `TAB_RELATORIOS_EXECUTADOS`, `REPORTS_CHECKLIST`, `EMPRESA_CAT_REPORTS`, `PAGU_OBJETO_RELATORIO`, `CONFIG_RELATORIO_*`, `LISTA_RELATORIO_CSV`; DBASGU `RELATORIO_CABECALHO_COLUNA` | `TBEDITREL` (252 relatórios de SQL livre), `TBEDITPARAM` (1.000+), `TBEDITPESQ` (41), `TBAGRUPRELAT` (29), `TBAGRUPRELAT_TBEDITREL` (61), `TBEDITREL_GRUUSU` (52), `TBEDITREL_TBUSERS` (15), `TBBTNOPREL` (3), `TBOPCAOREL` (3), `TBPARAMOPREL` (9) | M34: `dominio-relatorio` (`catalogo`, `triagem` dos 252 com destino, dono e onda), telas `/relatorios`, `/relatorios/triagem`. As áreas conferem cada relatório antes de ligar (DP-3) | F3: os 252 relatórios são uso real; cada um vira item do catálogo, tela, indicador ou é descartado | `relatorio`, `relatorio_parametro`, `relatorio_permissao`, `execucao_relatorio`, `triagem_relatorio_legado` |
| Envio agendado de relatório por e-mail, com o link e o alerta de falha | 1 tab / 0 com dados. DBAMV `REPORTS_SCHEDULE_INFO` | `TBEDITREL_AGENDA` (2), `TBEDITREL_AGENDA_LOG` (1.000+, cerca de 2.600 "não enviado" sem aviso), `TBEDITREL_AGENDA_SITUACAO` (4) | M34: `dominio-relatorio/agendamento` (o e-mail leva só o link autenticado; a falha conta as seguidas e avisa o dono), tela `/relatorios/agendamentos` | F3: está em uso, e o legado falha sem que ninguém saiba | `agendamento_relatorio`, `envio_relatorio` |
| Editor de consultas SQL livre pelo usuário | 11 tab / 8 com dados. DBACP `PORTLET_SQL`, `DATA_SOURCE_SQL`, `PARAMETROS_SQL`, `COLUNA_SQL`, `FILTRO_DINAMICO` | O mesmo `TBEDITREL` acima (o SQL fica no texto do relatório) | M34: o texto da consulta nunca é lido; a triagem decide o destino pelo nome e pelo módulo | NAO: SQL livre contra o banco transacional abre vazamento de dado pessoal e trava o banco; a necessidade é atendida pelo catálogo e pelo data mart | — |
| Indicadores hospitalares com ficha técnica, meta, apuração com numerador e denominador, e painéis gerenciais | 62 tab / 21 com dados. DBAPORTAL `INDICADOR*`, `IVM*`, `FICHA_IVM*`, `META_INDICADOR`, `META_MENSAL`, `FORMULA`, `TB_RESUMO_INDICADORES`, `DIMENSAO*`; DBAMV `INDICADOR_ESTATISTICA_HOSP`, `GF_INDICADORES`, `GF_META`; DBACP `CONFIG_GRAFICO_*`, `FORMATACAO_CONDICIONAL` | Não tem como função (o legado só tem o censo); domínios da contratualização SUS `CMTPINDICADOR` (8), `CMTPITEMINDIC` (7) | M16/M48.5: `dominio-relatorio` (`fichas`, `calculo`, `paineis`, `reguas-receita`, `indicador/consolidacao`); painel assistencial, operacional e financeiro; análise crítica da qualidade (ONA) | F3: o censo e os indicadores da Portaria 312 são obrigação e já estão prontos no new-sgh | `indicador`, `indicador_versao`, `meta_indicador`, `apuracao_indicador` |
| Data mart analítico (dimensões e fatos, carga registrada, sem dado identificável) | 245 tab / 46 com dados. DBADW (210: dimensões `DI_*` e fatos `FA_*` de atendimento, faturamento, estoque, custos, cirurgia e infecção); DBAMV `DW_LOG_CARGA*`, `GF_DADOS*`; DBAPORTAL `DW_*`, `CARGA*`, `AUTOMATION*`, `ST_*` | `INTEGRA_BI` (descartada: fila de exclusões do BI antigo) | M16/M57.3: `dominio-relatorio/datamart` (pseudônimo HMAC por estabelecimento, faixa etária no lugar do nascimento, verificador que reprova coluna identificadora), carga da cópia diária | F3: os painéis gerenciais leem dele. Fica fora do banco transacional, em esquema analítico separado; no MariaDB só fica o controle da carga | `carga_data_mart` |
| Página inicial com blocos configuráveis por papel (widgets, links, gráficos) | 32 tab / 18 com dados. DBACP `PORTLET*`, `PAGINA*`, `PASTA*`, `GRUPO_PORTLET`; DBAPORTAL `CONFIG_PORTAL*` | Não tem | Início com fila de trabalho por perfil (worklists, F2), fixa por perfil | F8: a home montável pelo próprio hospital tem valor, mas a worklist por perfil resolve a virada | — |
| Análise ad hoc (tabela dinâmica, cubo, filtros salvos pelo usuário) | 24 tab / 0 com dados. DBACP `PLAN_*` (planilha dinâmica, datamart por papel, prompts), `OBJETO_OLAP`, `MICROSTRATEGY_DATA_SOURCE` | Não tem | O BI da Rede usa ferramenta externa sobre o data mart (Metabase, DP-15) | F8: feito por ferramenta de BI sobre o data mart, não por tabelas no banco de produção | — |
| Painéis de TV operacionais (UTI, farmácia, mapa cirúrgico, laboratório, chamada) | 16 tab / 6 com dados. DBAMV `PAINEL_*`, `CONFIG_PAINEL*`, `MVPAINEL_CFG_VOZ`, `ATENDIME_CHAMADA_PAINEL`; MVBIKE `PAINEL*` | `PNCONFIGPORTAL` (19 painéis configurados) | M16/M19/M39: painéis de TV na onda 1 (domínio `PNCONFIGPORTAL` nos contratos), painel de senhas, painel do PA e painel do bloco para familiares | F3: os 19 painéis estão ligados nas TVs hoje | `painel_tv`, `painel_tv_bloco` |
| Central de comando assistencial (riscos clínicos por exame, medicamento e CID, alertas de fluxo, metas das 24 horas) | 18 tab / 1 com dados. DBATUALIZA `RISCO_*` (5); MVBIKE `RISCO_*`, `TEMA_CLINICO`, `AGRUPADOR_TEMA_CLINICO`; DBAMV `GF_ALERTAS`, `GF_USUARIO_ALERTA` | Não tem | Partes avulsas: NEWS2 e escalas (M45.2), quadro do NIR (M44.2), relógio dos protocolos (M44.3) | F8: juntar os sinais num quadro de risco da unidade tem valor real, mas depende das escalas já migradas | — |
| Gestão estratégica (mapa estratégico, perspectivas, objetivos, iniciativas, reuniões de análise crítica) | 56 tab / 7 com dados. DBAPORTAL `ESTRATEGIA*`, `PERSPECTIVA*`, `OBJETIVO*`, `INICIATIVA*`, `REUNIAO`, `ANALISE_CRITICA`, `CADEIA_VALOR`, `PROGRAMA`; MVBIKE `PERSPECTIVA_ESTRATEGIA` | Não tem | Parcial: análise crítica de indicador com plano de ação na qualidade (M48.5) | F8: útil para a diretoria, mas fora da operação | — |
| Gestão de projetos (cronograma, linha de base, caminho crítico) | 9 tab / 2 com dados. DBAPORTAL `PRE_PROJETO*`, `BASELINE_PROJETO`, `CAMINHO_CRITICO`, `DURACAO_ATIVIDADE` | Não tem | Não tem | NAO: ferramenta genérica de mercado resolve | — |
| Simulação de cenários de receita (troca de tabela de preço, reajuste de convênio, conversão de procedimentos) | 39 tab / 7 com dados. DBACP `SD_*` (cenário, simulação, conversão de procedimento e de tabela, inconsistências); DBADW `FA_SIMULA_ATENDIMENTO`, `FA_SD_*` | Não tem | Não tem (há as duas réguas da receita e o painel de glosas) | F8: responde "quanto muda a receita se o convênio aceitar o reajuste", sobre a produção real | — |
| BI consolidado da Rede (vários estabelecimentos, pseudônimo comum) | Só a dimensão multiempresa do DBADW (`DI_MULTI_EMPRESA`, contada no data mart) | Não tem | M57.3: BI da Rede com parcelas e conta, perfil `diretoria-rede` sem prontuário; `rede.bi` desligada | F8: já construído; liga depois da virada dos hospitais, sem tabela nova no transacional | — |

## Recursos novos do MV que valem a pena

Em ordem de valor para depois da virada (F8, salvo o login único, que é F7):

1. **Login único corporativo (LDAP, AD, SSO), F7.** Um hospital com TI própria não aceita outra senha. O MV tem 11 tabelas
   para isso e quase não as usa (2 com dados). Para nós, bastam um provedor de identidade e o vínculo da conta, sem
   abrir mão do segundo fator nem da trilha.
2. **Simulação de cenários de receita.** São 39 tabelas e 7 com dados. Responde "quanto a receita muda se a tabela ou o
   convênio mudar", com a produção real. Nenhum dos outros dois sistemas tem.
3. **Central de comando assistencial.** Riscos clínicos por exame, medicamento, CID e aferição, com metas das 24 horas e
   alertas a quem precisa agir. O new-sgh já tem as peças (NEWS2, NIR, protocolos); falta o quadro único por unidade.
4. **Notificação por regra com consolidação e medida de resposta.** Junta os avisos repetidos num só e registra quem
   respondeu e quando, para não afogar o usuário em alertas.
5. **Página inicial com blocos configuráveis por papel.** O hospital monta a própria home de gestão sem pedir ao
   fornecedor. Fica bem sobre a worklist que já existe.
6. **Análise ad hoc sobre o data mart.** Tabela dinâmica com filtros salvos e permissão por papel, feita com ferramenta de
   BI e não com tabela no banco de produção.
7. **Gestão estratégica.** Mapa estratégico, objetivos, iniciativas e reunião de análise crítica ligados aos
   indicadores que já têm ficha técnica.
8. **Uma ideia de desenho, não um recurso.** O MV grava a configuração auditada (`AUDITORIA_CONFIG`) e o histórico de
   cada parâmetro. Já entrou como F3 (`parametro_valor_historico`), porque mudar parâmetro sem histórico é risco de
   faturamento.

O que **não** vale copiar do MV:
- as 265 tabelas de log, uma por assunto (no modelo próprio, uma trilha única dá conta);
- o motor de regras em PL/SQL disparado por coluna (contraria a premissa de não ter gatilho com regra);
- o kit de implantação de 96 tabelas do MVBIKE (para nós, bastam a prontidão e o checklist);
- o licenciamento comercial.

## Lacunas do new-sgh frente ao SPDATA

O que o SPDATA tem, e a Rede Santé usa, mas o new-sgh ainda não implementou por inteiro:

1. **Permissões finas do faturamento SUS por usuário** (`TBPERMISSAO_SUS`, 1.000+ linhas: AIH, BPA, APAC). Hoje está só no
   inventário e no alcance dos privilégios. Não tem contrato, regra no domínio nem tela. Sem isso, o faturista SUS
   perde o recorte que tem hoje.
2. **Alertas configuráveis** (`TBALERTA` e gatilhos). A tela `/administracao/alertas` é só de consulta. O uso é baixo
   (2 alertas), mas a criação e a edição precisam existir no banco novo.
3. **Servidor de e-mail e dados fiscais da empresa.** As telas `/administracao/notificacoes` e `/administracao/empresa`
   são só de consulta. No banco próprio, a manutenção tem de ser feita pela tela, e a credencial vai para o cofre.
4. **Termos LGPD (emissão, autorização e revogação).** O pedido do titular está pronto. Os domínios de termo, situação e
   representante só aparecem em consulta pelo CRUD genérico, e falta o fluxo de emitir e revogar o termo.
5. **Botões de relatório dentro das telas** (`TBBTNOPREL`, `TBOPCAOREL`, `TBPARAMOPREL`). Só são lidos na consulta do M34,
   e ainda não há onde mostrar, na tela de origem, o relatório ligado a ela.
6. **Triagem dos 252 relatórios.** A proposta automática está pronta, mas cada área ainda precisa confirmar o destino
   (DP-3). Enquanto isso, o relatório que não tiver destino confirmado não migra no dia 0.
7. **Parâmetros largos por módulo.** São cerca de 40 tabelas; só o estoque (`GEPARAM`) tem cerca de 300 campos por
   usuário e empresa. O mecanismo hierárquico existe (M08), mas o conector do dia 0 precisa do mapa campo a campo,
   para cada valor cair na `parametro_definicao` certa.
8. **Gravações que hoje dependem do legado.** Troca de senha, bloqueio por tentativas e registro de entrada estão
   especificados, mas a gravação está bloqueada (M04, HS-1), e o plano B ainda é o SPDATA. No banco próprio elas
   passam a ser nativas, e é preciso fechar a regra no domínio antes da virada.
9. **Carga da trilha histórica.** São mais de 1 milhão de eventos (`TBCABTRILHA` e detalhes) e as cópias de excluídos, hoje
   em `migrar-leitura`. Para o banco próprio, falta decidir:
   - se a trilha entra no dia 0 como histórico só de leitura (`evento_auditoria` marcado como origem legado);
   - ou se fica num arquivo frio consultável.

   A SBIS exige a guarda.
10. **Impressora por estação.** O SPDATA imprime na impressora local do desktop. Na web, etiqueta e pulseira precisam
    do mapa estação × impressora, que ainda não existe no new-sgh.

## Fronteiras com outros grupos

- **Qualidade.** O DBAPORTAL tem 109 tabelas (28 com dados) de ocorrências, riscos, gestão de documentos, auditorias
  internas, acreditação e evento sentinela. Ficaram fora da conta deste grupo, e o new-sgh as cobre no M48.
- **Integração.** Os esquemas MVINTEGRA e o motor `SITE_*` do DBAMV (barramento, XML e certificados de comunicação) são
  do grupo de integração. Aqui entrou só a assinatura digital de documento.
- **Parâmetros de cada módulo.** O mecanismo de parametrização é deste grupo. O conteúdo de cada parâmetro (o que o
  faturamento, o estoque ou o PEP lê) é decidido no grupo do módulo.
- **Estrutura e cadastro.** Estabelecimento, unidade e unificação de paciente aparecem aqui pelo lado do acesso e da
  auditoria. O cadastro em si é do grupo de cadastro.
