# Anexo: variáveis do arquivo de ambiente e portas

<!-- Gerado por `pnpm instalacao:gerar`; não edite à mão. -->

O arquivo é `/etc/sante-sgh/sante.env` (0600, dono o usuário do serviço), a partir do modelo
`deploy/ubuntu/sante.env.modelo`. **Obrigatória**: sem ela a conferência recusa a instalação. **Segredo**: só no
servidor, nunca em repositório, e-mail ou chamado.

## Produto, rede e endereços

| variável | uso | segredo | descrição |
|---|---|---|---|
| `AMBIENTE` | obrigatoria |  | Ambiente da instalação. |
| `PRODUTO_NOME` | obrigatoria |  | Nome do produto exibido nas telas e documentos (DP-49). |
| `MARCA` | recomendada |  | Código do pacote de marca da rede nos documentos e e-mails (letras minúsculas, dígitos e hífen; padrão: rede-sante). |
| `REDE_PADRAO` | obrigatoria |  | Código da rede (minúsculas, dígitos e hífen). |
| `DOMINIO_BASE` | obrigatoria |  | Domínio base: a rede é resolvida pelo endereço de acesso. |
| `REDE_ENDERECOS` | opcional |  | Nome do servidor ligado à rede, nome=rede (vários com ;); o do --dominio, salvo <rede>.<DOMINIO_BASE>. |
| `WEB_ENDERECO` | obrigatoria |  | Endereço público https das telas (links dos e-mails). |
| `PORTAL_ENDERECO` | opcional |  | Endereço público do portal do paciente, se diferente do das telas. |
| `DOCUMENTO_URL_VALIDACAO` | obrigatoria |  | Endereço https do verificador público dos documentos. |
| `BI_ENDERECO` | opcional |  | Endereço do BI externo, quando houver. |
| `CLIENTE_PADRAO` | opcional |  | Cliente usado quando a requisição não traz o cliente (instalação com um só cliente). |

## Banco de cada estabelecimento e conexões

| variável | uso | segredo | descrição |
|---|---|---|---|
| `ESTABELECIMENTOS` | obrigatoria |  | Códigos dos estabelecimentos deste servidor, separados por vírgula. |
| `REDE_MPI_ESTABELECIMENTOS` | opcional |  | Estabelecimentos que entram no índice de pacientes da rede. |
| `SGH_MARIADB_HOST` | obrigatoria |  | Servidor do MariaDB dos bancos dos clientes e da plataforma (nome ou endereço). |
| `SGH_MARIADB_USUARIO` | obrigatoria |  | Conta da aplicação no MariaDB, com o papel_aplicacao como papel padrão (anexos de privilégios do manual). |
| `MARIADB_SENHA` | obrigatoria | sim | Senha da conta da aplicação no MariaDB (definida pela TI ao criar a conta). |
| `SGH_MARIADB_USUARIO_MIGRACOES` | opcional |  | Conta que aplica as migrações (DDL) dos bancos; vazio: as migrações não rodam pela aplicação. |
| `SGH_BANCO_PLATAFORMA` | opcional |  | Nome do banco da plataforma (clientes, credenciais e fila do conector). Vazio: plataforma. |

### Série por estabelecimento (`FB_<CÓDIGO>_<CAMPO>`)

| campo | uso | segredo | descrição |
|---|---|---|---|
| `NOME` | obrigatoria |  | Nome de exibição do estabelecimento. |
| `HOST` | obrigatoria |  | Servidor do banco (nome ou endereço; com túnel, 127.0.0.1 e a porta local do túnel). |
| `PORTA` | obrigatoria |  | Porta do Firebird (ou a porta local do túnel). |
| `BANCO` | obrigatoria |  | Caminho do banco no servidor do banco, ou o apelido do databases.conf. |
| `USUARIO` | obrigatoria |  | Conta da APLICAÇÃO, com o papel SGH_APLICACAO (nunca SYSDBA). |
| `SENHA` | obrigatoria | sim | Senha da conta da aplicação. |
| `SCRIPTS_USUARIO` | obrigatoria |  | Conta de SCRIPTS, dona dos objetos SGH_ (só a migração a usa). |
| `SCRIPTS_SENHA` | obrigatoria | sim | Senha da conta de scripts (pode ficar fora do arquivo e ser informada só na hora da migração). |
| `LEITURA_USUARIO` | obrigatoria |  | Conta de LEITURA, para a simulação da migração e a fumaça pós-implantação. |
| `LEITURA_SENHA` | obrigatoria | sim | Senha da conta de leitura. |

## Serviços do servidor (portas, fila, documentos)

| variável | uso | segredo | descrição |
|---|---|---|---|
| `API_PORTA` | opcional |  | Porta local da API (só 127.0.0.1; o nginx encaminha /api). Fixada pelo pacote: só vazia ou 3300. |
| `VALKEY_URL` | obrigatoria |  | Fila e cache (Valkey local do servidor). |
| `FILAS_PREFIXO` | opcional |  | Prefixo das filas (só quando dois ambientes dividem o Valkey). |
| `GOTENBERG_URL` | recomendada |  | Conversor de documentos para PDF. |
| `WORKER_SERVICOS` | opcional |  | Lista dos serviços do worker (vazio: todos). |
| `WORKER_SINAL_MS` | opcional |  | Intervalo do sinal de vida do worker, em ms. |
| `WORKER_CLIENTES` | opcional |  | Clientes atendidos pelos ciclos do worker, separados por vírgula (vazio: os clientes em uso na plataforma). |
| `LOG_NIVEL` | opcional |  | Nível dos logs. |
| `TZ` | obrigatoria |  | Fuso dos processos: sempre UTC (o banco guarda a hora local e o sistema converte; as telas mostram a hora de Brasília). |
| `API_MODULOS` | opcional |  | Módulos da API ligados: todos ou a lista separada por vírgula. |

## Segurança, chaves e sessão

| variável | uso | segredo | descrição |
|---|---|---|---|
| `PLATAFORMA_CHAVE_MESTRA` | obrigatoria | sim | Chave mestra (32 bytes em base64): segundo fator, selos e cifras. |
| `ACESSO_CHAVE_MESTRA` | opcional | sim | Chave própria do envelope da credencial forte e do segundo fator do login (32 bytes em base64; padrão: a mestra). Nunca troque depois do uso. |
| `PORTAL_CHAVE_MESTRA` | opcional | sim | Chave própria do portal (32 bytes em base64; padrão: a mestra). |
| `PESSOAS_CHAVE_CPF` | recomendada | sim | Chave da cifra do CPF dos colaboradores (padrão: a mestra). Nunca troque depois do uso. |
| `PLATAFORMA_EM_NOME_DE` | opcional |  | Rótulo do atendimento da plataforma na trilha. |
| `ACESSO_BLOQUEIO_PORTA_MINUTOS` | opcional |  | Minutos de bloqueio após tentativas de login erradas. |
| `ACESSO_EMERGENCIA_MINUTOS` | opcional |  | Duração do acesso de emergência, em minutos. |
| `SUPORTE_SESSAO_MINUTOS` | opcional |  | Duração da sessão de suporte, em minutos. |
| `SUPORTE_AVISO_AUDITOR` | opcional |  | nao: desliga o aviso ao auditor nas sessões de suporte. |
| `TRILHA_ESTACAO` | opcional |  | Como a estação entra na trilha. |
| `COFRE_DIR` | opcional |  | Pasta do cofre dos certificados (0700, dono o usuário do serviço). |
| `QZ_CERTIFICADO_ARQUIVO` | opcional |  | Certificado da impressão local (QZ Tray). |
| `QZ_CHAVE_PRIVADA_ARQUIVO` | opcional |  | Chave privada da impressão local (arquivo 0600). |
| `ACESSO_CONTAS_DORMENTES_ESTABELECIMENTOS` | opcional |  | Estabelecimentos (códigos separados por vírgula) em que o aviso de contas sem uso roda. |

## E-mail e destinatários de aviso

| variável | uso | segredo | descrição |
|---|---|---|---|
| `SMTP_URL` | obrigatoria | sim | Servidor de e-mail (smtps://conta:senha@host:465). |
| `EMAIL_REMETENTE` | obrigatoria |  | Remetente dos e-mails do sistema. |
| `AUDITORIA_EMAIL` | recomendada |  | Destino dos avisos de auditoria. |
| `ALERTA_RELATORIO_EMAIL` | opcional |  | Destino do alerta quando o dono do relatório não tem e-mail. |
| `SMTP_HOST` | opcional |  | Servidor SMTP de saída. Fora de produção só é aceito destino local (neutralização). |

## Armazenamento de arquivos (disco da máquina, ADR 0004)

| variável | uso | segredo | descrição |
|---|---|---|---|
| `ARQUIVOS_RAIZ` | obrigatoria |  | Pasta absoluta dos arquivos (uma subpasta por banco de cliente), no disco da máquina; ex.: /srv/sante-sgh/arquivos. Cópia de segurança pela hospedagem (snapshot do volume ou backup do cliente). |
| `ARQUIVOS_ALERTA_LIVRE_GB` | opcional |  | Alerta (instalação e vigia do worker) quando o espaço livre da pasta de arquivos fica abaixo deste valor, em GB. |
| `DOCUMENTO_RETENCAO_DIAS` | opcional |  | Dias de retenção dos documentos de prova. |

## Integrações externas

| variável | uso | segredo | descrição |
|---|---|---|---|
| `OIE_URL` | opcional |  | Motor de integração (HL7) do hospital. |
| `OIE_MLLP_HOST` | opcional |  | Servidor MLLP do motor de integração. |
| `ASSINATURA_ICP_MODO` | recomendada |  | Modo da assinatura ICP-Brasil (vazio: desligada com motivo). |
| `ASSINATURA_ACT_URL` | opcional |  | Carimbo do tempo (ACT). |
| `ASSINATURA_AGENTE_LOCAL_URL` | opcional |  | Agente local de assinatura das estações. |
| `ASSINATURA_RETORNO_URL` | opcional |  | Retorno da assinatura em nuvem. |
| `ASSINATURA_POLITICA_AD_RB` | opcional |  | Política AD-RB da assinatura. |
| `ASSINATURA_POLITICA_AD_RT` | opcional |  | Política AD-RT da assinatura. |
| `ASSINATURA_REPROCESSAR` | opcional |  | Reprocessamento das assinaturas pendentes. |
| `ASSINATURA_REPROCESSAR_MS` | opcional |  | Intervalo do reprocessamento das assinaturas, em ms. |
| `ICP_RAIZES_DIR` | opcional |  | Pasta das raízes ICP-Brasil. |
| `ICP_INTERMEDIARIAS_DIR` | opcional |  | Pasta das intermediárias ICP-Brasil. |
| `PACS_MODO` | opcional |  | Modo do PACS (vazio: desligado com motivo). |
| `PORTAL_PAGAMENTO_MODO` | opcional |  | Modo do pagamento no portal (vazio: desligado). |
| `TELECONSULTA_PROVEDOR_MODO` | opcional |  | Provedor da teleconsulta (vazio: desligado). |
| `RNDS_HOMOLOGACAO_AUTORIZADA` | opcional |  | sim: autoriza o envio à RNDS de homologação. |
| `RNDS_CERTIFICADO_PFX` | opcional |  | Certificado ICP-Brasil (e-CNPJ A1) do estabelecimento para a RNDS; vazio: o RIA não sai para a homologação nem para a produção (dev e ci usam sempre o simulador). |
| `TISS_XSD_PASTA` | opcional |  | Pasta do XSD da TISS (padrão: o do pacote). |
| `ESOCIAL_XSD_PASTA` | opcional |  | Pasta dos XSD do eSocial, uma subpasta por leiaute (padrão: o do pacote). |
| `ESOCIAL_MODO` | opcional |  | producao: envia os lotes ao serviço do eSocial (só com AMBIENTE=producao e o certificado); vazio ou coletor: coletor local. |
| `ESOCIAL_CERTIFICADO_ARQUIVO` | opcional |  | Certificado e-CNPJ (A1) do transmissor do eSocial em PEM, no cofre (convertido do .pfx na implantação). |
| `ESOCIAL_CHAVE_ARQUIVO` | opcional |  | Chave privada do certificado do eSocial em PEM (arquivo 0600, no cofre). |
| `ESOCIAL_CHAVE_SENHA` | opcional | sim | Senha da chave do certificado do eSocial. |
| `ESOCIAL_ENVIO_URL` | opcional |  | Endereço do serviço de envio do eSocial (padrão: o oficial de produção). |
| `ESOCIAL_CONSULTA_URL` | opcional |  | Endereço do serviço de consulta do eSocial (padrão: o oficial de produção). |
| `INTEGRACAO_CLIENTES` | opcional |  | Clientes cujo ciclo de integração o worker roda (separados por vírgula). Vazio: os ativos da plataforma. |

## Rotinas do worker (ligar, desligar, intervalos)

| variável | uso | segredo | descrição |
|---|---|---|---|
| `VIGIA_ARQUIVOS` | opcional |  | Vigia de integridade dos arquivos (hash x registro). |
| `VIGIA_ARQUIVOS_MS` | opcional |  | Intervalo do vigia dos arquivos, em ms (padrão 6 h). |
| `OUTBOX_RELAY` | opcional |  | Envio da caixa de saída (e-mails, avisos e integrações). Vazio: o padrão do ambiente. |
| `INTEGRACAO` | opcional |  | Integrações de saída do worker. Vazio: o padrão do ambiente. |
| `VIGIA_BANCO` | opcional |  | Vigia do banco (transações, travas e conexões; desligado desliga). Vazio: o padrão do ambiente. |
| `RELATORIO_ENVIO` | opcional |  | Envio agendado de relatórios. Vazio: o padrão do ambiente. |
| `RELATORIO_ENVIO_VENCIDOS` | opcional |  | Envio dos relatórios agendados vencidos ao subir. Vazio: o padrão do ambiente. |
| `BUSCA_VIGIA` | opcional |  | Índice de busca de pacientes. Vazio: o padrão do ambiente. |
| `CATALOGO_PUBLICADOR` | opcional |  | Publicação dos catálogos. Vazio: o padrão do ambiente. |
| `CENSO_FECHAMENTO` | opcional |  | Fechamento diário do censo. Vazio: o padrão do ambiente. |
| `CLASSIFICACAO_ESTOURO` | opcional |  | Aviso de estouro do tempo da classificação de risco. Vazio: o padrão do ambiente. |
| `CONTABIL_LEITURA` | opcional |  | Leitura dos fatos contábeis dos módulos. Vazio: o padrão do ambiente. |
| `CONTABIL_CONTABILIZAR` | opcional |  | Contabilização dos fatos lidos em lançamentos automáticos (desligado: só lê). Vazio: o padrão do ambiente. |
| `CONTINGENCIA_POR_HORA` | opcional |  | Folha de contingência da enfermagem por hora. Vazio: o padrão do ambiente. |
| `NIR_EXPIRACAO` | opcional |  | Expiração das reservas de leito. Vazio: o padrão do ambiente. |
| `PACS_WORKLIST` | opcional |  | Lista de trabalho do PACS. Vazio: o padrão do ambiente. |
| `PESSOAS_CONSELHO_DIARIO` | opcional |  | Conferência diária dos conselhos profissionais. Vazio: o padrão do ambiente. |
| `CONTRATOS_ALERTA_DIARIO` | opcional |  | Alerta diário de vencimento dos contratos com fornecedores. Vazio: o padrão do ambiente. |
| `REDE_MPI_NOTURNO` | opcional |  | Carga noturna do índice de pacientes da rede. Vazio: o padrão do ambiente. |
| `ENFERMAGEM_VIGIA` | opcional |  | Vigia dos horários da enfermagem. Vazio: o padrão do ambiente. |
| `ENFERMAGEM_VIGIA_CONTENCAO` | opcional |  | Vigia da contenção mecânica vencida (aviso ao prescritor; "nao" desliga). Vazio: o padrão do ambiente. |
| `SADT_VIGIA_CRITICOS` | opcional |  | Vigia dos resultados críticos. Vazio: o padrão do ambiente. |
| `ACESSO_CONTAS_DORMENTES_DESPERTAR` | opcional |  | Despertar diário das contas dormentes (sim liga em dev/ci; nao desliga). Vazio: o padrão do ambiente. |
| `PORTAL_VIGENCIA` | opcional |  | Vigência dos acessos ao portal. Vazio: o padrão do ambiente. |
| `VIGIA_MUDANCAS_MS` | opcional |  | Intervalo ou tamanho: vigia de mudanças das telas ao vivo. Vazio: o padrão. |
| `VIGIA_BANCO_MS` | opcional |  | Intervalo ou tamanho: vigia do banco. Vazio: o padrão. |
| `VIGIA_TRANSACAO_LIMITE_MS` | opcional |  | Intervalo ou tamanho: limite da transação longa no vigia do banco. Vazio: o padrão. |
| `OUTBOX_INTERVALO_MS` | opcional |  | Intervalo ou tamanho: caixa de saída. Vazio: o padrão. |
| `INTEGRACAO_INTERVALO_MS` | opcional |  | Intervalo ou tamanho: integrações. Vazio: o padrão. |
| `INTEGRACAO_LOTE_FATOS` | opcional |  | Intervalo ou tamanho: lote das integrações (fatos por ciclo). Vazio: o padrão. |
| `BUSCA_VIGIA_MS` | opcional |  | Intervalo ou tamanho: índice de busca. Vazio: o padrão. |
| `CATALOGO_PUBLICADOR_MS` | opcional |  | Intervalo ou tamanho: publicação dos catálogos. Vazio: o padrão. |
| `CATALOGO_LOTES_POR_CICLO` | opcional |  | Intervalo ou tamanho: lotes de catálogo por ciclo. Vazio: o padrão. |
| `CATALOGO_JANELA_PUBLICACAO` | opcional |  | Intervalo ou tamanho: janela de publicação dos catálogos. Vazio: o padrão. |
| `CONTABIL_JANELA_LEITURA` | opcional |  | Intervalo ou tamanho: janela da leitura dos fatos contábeis. Vazio: o padrão. |
| `PORTAL_VIGENCIA_MS` | opcional |  | Intervalo ou tamanho: vigência dos acessos ao portal. Vazio: o padrão. |
| `BUSCA_CONFERENCIA_MS` | opcional |  | Intervalo ou tamanho: conferência do índice de busca. Vazio: o padrão. |
| `RELATORIO_ENVIO_INTERVALO_MS` | opcional |  | Intervalo ou tamanho: envio agendado de relatórios. Vazio: o padrão. |
| `FATURAMENTO_ROTINA_DIARIA` | opcional |  | Lançamento automático do dia nas contas abertas (diárias e taxas). Em produção roda sempre, salvo "desligado"; em desenvolvimento e homologação só com "ligado". |

## Observabilidade e sondas

| variável | uso | segredo | descrição |
|---|---|---|---|
| `OTEL_EXPORTER_URL` | recomendada |  | Coletor OpenTelemetry (métricas e rastros). |
| `OTEL_INTERVALO_MS` | opcional |  | Intervalo de exportação das métricas, em ms. |
| `SONDA_TOKEN` | obrigatoria | sim | Segredo das sondas de implantação (32+ caracteres). |
| `SONDA_LOGIN` | recomendada |  | Usuário técnico de sonda (sem acesso a paciente). |
| `SONDA_SENHA` | recomendada | sim | Senha do usuário técnico de sonda. |
| `SONDA_VERSAO_ESPERADA` | recomendada |  | Identificação da versão que o pacote promete (gravada pelo instalador). |
| `IMPLANTACAO_CHAVES_ESPERADAS` | opcional |  | Chaves de liberação que podem estar ligadas (lista; prefixo.* vale para o prefixo; todas; todas-exceto:<lista>; nenhuma). Vazio: o padrão da liberação full na instalação (todas, menos as que o liberacao:ligar-tudo não liga sem decisão do dono). |

## Caminhos de dados do pacote

| variável | uso | segredo | descrição |
|---|---|---|---|
| `CONECTOR_ORIGENS_DIR` | opcional |  | Pasta das imagens de origem lidas pelo conector (somente leitura). Vazio: a do pacote. |
| `CONECTOR_LOG_DIR` | opcional |  | Pasta dos logs de execução do conector (worker e serviço), lida pela tela Carga e sincronismo. Vazio: a do pacote. |
| `SGH_RAIZ_REPOSITORIO` | opcional |  | Pasta das ferramentas do pacote usadas pelo painel da plataforma (criar cliente). Vazio: a do pacote. |
| `ESTRUTURA_HOMOLOGADA` | opcional |  | Resumo homologado da estrutura do banco, conferido pela fumaça da implantação. Vazio: o do pacote. |
| `SGH_M58_ENSAIOS` | opcional |  | Pasta ou arquivo: relatórios do ensaio da versão 5 do banco. Vazio: o do pacote. |
| `SGH_HOMOLOGACAO` | opcional |  | Pasta ou arquivo: registro da homologação. Vazio: o do pacote. |
| `SGH_PRONTIDAO` | opcional |  | Pasta ou arquivo: relatório de prontidão. Vazio: o do pacote. |
| `SGH_MAPA_PERMISSOES` | opcional |  | Pasta ou arquivo: mapa das permissões (implantação fora do repositório). Vazio: o do pacote. |

## Portas

| porta | onde | quem acessa |
|---|---|---|
| 443 | nginx (HTTPS) | as estações e os celulares do hospital |
| 80 | nginx (só redireciona para 443 e atende o desafio ACME) | as estações; a autoridade ACME |
| 22 | SSH | só a TI (restrinja a origem no ufw) |
| 3300 | API (só 127.0.0.1) | o nginx do próprio servidor |
| 6379 | Valkey (só 127.0.0.1) | a API e o worker do próprio servidor |
| 3000 | conversor de documentos (só 127.0.0.1) | a API e o worker |
| 3050 | Firebird, no servidor do banco | o servidor de aplicação (ou o túnel) |

## Cabeçalhos de segurança do site

| cabeçalho | valor |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=()` |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* wss://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
