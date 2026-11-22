# Pedidos do F4 aplicados no modelo (para a trilha F2.2 e a API)

Rodada 4 do conector (2026-11-21), branch `f4-conector`. Lotes novos, só para frente; nenhum gatilho; FKs em `*_chaves.sql`.
Lista por pedido em `docs/obra/fatias/f4/saida/aplicados-r4.md`. O que a API precisa saber:

## Restrições afrouxadas (NOT NULL que virou NULL, sempre com CHECK quando a regra continua)
- `pre_cadastro.data_nascimento` (exigida só na conversão); `laboratorio_apoio.empresa_fornecedora_id` (exigida se ativo);
  `pedido_compra.empresa_fornecedora_id` (só rascunho, em cotação ou cancelado sem ela); `favorecido_repasse.profissional_id`
  (exigido para próprio e terceiro profissional); `lancamento_repasse.favorecido_repasse_id` (nulo só com origem migracao);
  `lancamento_automatico_rubrica.rubrica_id`; `incidencia_rubrica.tributo_folha_id` e `codigo_incidencia_rubrica_id` (com a
  coluna nova `tributo`; CHECK: um dos dois); `auditoria_conta_versao.valor_total_conta`, `auditoria_conta.valor_original`;
  `material_laboratorio_apoio.material_biologico_id`, `elemento_exame_laboratorio_apoio.analito_id` (a integração usa só a
  linha completa); `relatorio_tela.relatorio_id` (exclusivo com `agrupamento_relatorio_id`); `requisicao_exame.setor_diagnostico_id`
  e `solicitante_profissional_id` (exatamente um entre profissional e `solicitante_externo_id`); `cancelamento_marcacao.
  marcacao_horario_id` (nulo só migrado, com `agenda_servico_id` e `horario_inicio_em`); `registro_excluido.entidade_id` (nulo só
  migrado); `insumo_principio_ativo`, `alergia_paciente_principio`, `item_nao_padronizado_principio`, `alergeno_principio_ativo`:
  `principio_ativo_id` OU `principio_ativo_cliente_id` (tabela nova). Telas e portas que leem essas colunas tratam o nulo.

## Restrições apertadas
- `ck_pessoa_juridica_cnpj`: empresa nacional sem CNPJ não passa mais (antes NULL passava).
- `uq_guia_fonte_pagadora_numero` (estabelecimento, fonte, número) no lugar de (estabelecimento, número): afrouxa por fonte.
- Chaves únicas trocadas: `lotacao_profissional` (+ unidade assistencial), `justificativa_ponto` (mantenedora, código),
  `regra_consistencia_lancamento` (+ grupo_item); `unidade_internacao` perdeu a única por unidade assistencial.

## Domínios (CHECK) ampliados
- `cuidado_enfermagem.acao_restricao_*` + exigir_justificativa; `componente_sumario_alta.periodo` + nenhum, ultimas_48_horas;
  `sequencial_guia.tipo_guia` + lote, recurso_glosa; `preco_negociado_matmed` aceita só quantidade_fixa; `dominio_sus.lista`
  VARCHAR(40) + localizacao_tumor; `vinculo_trabalho.tipo_admissao` + transferencia_consorcio, transferencia_domestico,
  transferencia_sucedida_inapta; `estrangeiro_colaborador.condicao_ingresso` + reuniao_familiar, tratado_brasil_portugal;
  `lancamento_automatico_rubrica.evento_gatilho` + licenca_maternidade, rescisao, afastamento; `agenda_servico` sem dono só migrada;
  `interface_equipamento` sem alvo só inativa; `usuario_escopo` aceita só pode_excluir.

## Colunas e tabelas novas
- Tabelas: `principio_ativo_cliente`, `item_faturavel_tipo_servico`, `tabela_preco_item_padrao`.
- `usuario_escopo.pode_excluir`; `politica_senha.exige_alfanumerico`, `periodicidade_aceite_quantidade/_unidade`,
  `reutilizacao_bloqueada_dias` (`periodicidade_aceite_dias` FICA até a API migrar; o CHECK aceita qualquer das duas);
  `sequencia_negocio.descricao`; `lotacao_profissional.unidade_assistencial_id`; `pessoa_fisica.numero_declaracao_obito`,
  `causa_obito_termo_terminologia_id`; `regra_impressao_ficha.clinica_assistencial_id`; `motivo_marcacao` e `canal_marcacao.
  categoria_agenda_id`; `agenda_servico.vigencia_inicio/fim`; `condicao_se_necessario.codigo_interoperabilidade`;
  `painel_filtro_usuario.unidade_assistencial_id/bloco_internacao_id`; `horario_administracao.observacao_enfermagem/urgente`;
  `receita_medica_item.duracao_/frequencia_/prazo_descricao`; `acomodacao.local_cobranca_id`; `ocupacao_leito.
  categoria_acomodacao_id`; `leito_hospitalar.criticidade_area_id`; `internacao.autorizado_em/autorizacao_validade`;
  `dados_origem` (JSON) em ato_cirurgico, ato_cirurgico_procedimento e agendamento_cirurgico; `movimento_prontuario.
  saida_/destino_setor_tramite_id`; `doacao_sangue.intercorrencia_tipo_reacao_transfusional_id`; `exame_item.
  motivo_cancelamento_texto/conta_hospitalar_item_id`; `resultado_exame.referencia_texto`; `saldo_estoque_mensal.*_nao_classificada`;
  `pedido_compra.numero_documento_origem`; `nota_entrada.origem_recurso_compra_id`; `documento_estoque.numero_origem/
  numero_chamada/numero_ocorrencia/documento_origem_id`; `evento_repasse.tipo_deducao_irrf_id/tipo_rendimento_isento_id`;
  `regra_consistencia_lancamento.grupo_item`; `cooperativa_medica.percentual_repasse_{consulta,procedimento,exame,internacao}`;
  `tabela_preco.valor_cirurgico`; `local_cobranca` (tabelas padrão de medicamento e material, referência unificada/operadora,
  cobra particular, despesa do paciente); `conta_hospitalar_item` (sequencial na guia, autorização, local de atendimento,
  função da equipe, procedimento SUS informado, validade do lote, CID, guia complementar, APAC); `titulo_pagar`, `titulo_receber`,
  `movimento_bancario`, `adiantamento`: `grupo_lancamento_financeiro_id`; `conta_bancaria.acesso_restrito`; `depara_conta_externa.
  tipo_conta_id/tipo_lancamento_id`; `cadastro_empregador.geracao_evento_pagamentos` (pagamento_folha, baixa_financeira, manual);
  `justificativa_ponto.mantenedora_id`; `motivo_movimento_cadastral.situacao_cadastral_beneficiario_id`; `relatorio_parametro.visivel`;
  `relatorio_parametro_pesquisa.especificacao`; `relatorio_tela.agrupamento_relatorio_id`.

## Sementes nativas (idempotentes, nos `*_chaves.sql`)
- `modulo_sistema` 'financeiro' (se não houver) e 17 `parametro_definicao` `financeiro.*` (nível estabelecimento): centros de custo
  padrão (créditoPagar, bancoPagar, devedorReceber, bancoReceber, glosa), tipos de ajuste padrão (glosa, acréscimo, desconto,
  adiantamento, cheque compensado), diasAlertaVencimento, diasVencimentoPadrao, mesesConsulta, formaPagamentoObrigatoria, usaEmpenho,
  restringeContaBancariaPorUsuario, naturezaFinanceiraPadrao. A tela de configuração do financeiro deve lê-los.
- `tipo_conta` (ambulatorial, externa, urgencia, internacao), `tipo_auditoria` 'migracao', `regime_atendimento_internacao` (TISS 1, 2, 3),
  `unidade_duracao_tratamento` (dia, semana, mes, ano) e `sexo.codigo_hl7` pela sigla (HL7 v2, tabela 0001).

## Pedidos NÃO aplicados (abertos para a F2.2, catálogos ou decisão)

- L5-01 (9): permissões de prontuário por usuário: estrutura do produto (acao_sistema/parametro_definicao) a definir pela F2.2
- L5-05 (12): ISS por município do cliente: desenho de retenção maior (F2.2)
- L5-05 (13): configuração fiscal da mantenedora (NFS-e, ECD): desenho amplo (F2.2)
- L5-07 (3): carregadores oficiais do eSocial: precisam da fonte oficial (trilha de catálogos)
- L5-09 (2): idem: carregador oficial do eSocial
- L5-12 (4): carregador oficial das tabelas legais da folha (trilha de catálogos)
- L8-09 (8): carregadores oficiais da ECD e NIRE (trilha de catálogos)
- L8-11 (16): carregador oficial de codigo_receita_federal: fonte da Receita Federal (TBFINCODRECOL segue BLOQUEADA, catalogo_oficial_faltante)
- L8-15 (12): carregador da taxa de saúde suplementar (fonte da ANS)
- L6-09 (2): conferência de redundância no modelo (decisão)
- L6-09 (6): decisão do dono sobre PRSINAIS
- L6-09 (10): decisão grade x unidade
- L6-09 (11): significado da letra A/E/M a confirmar
- L6-10 (17): decisão grade x bloco
- L6-12 (13): lista de colunas sem destino a detalhar por tabela
- L6-13 (10): documento_emitido tipo receita: depende do gerador do mapa
- L6-15 (M2b): sementes de catálogos-base da internação (carater_admissao, modalidade, situacao_leito...): carga inicial do 'criar novo cliente' com domínio de produto a fechar
- L6-15 (LEITO_DIARIA): diária por leito: decisão de modelo de cobrança
- L6-16 (16): ficha anestésica do ato migrado: desenho do PEP cirúrgico
- L7-02 (4): laboratório de apoio por coluna: mecanismo do motor
- L7-06 (7): numeração na virada: regra do produto
- L7-06 (14): retenção por credor: desenho fiscal (F2.2)
- L8-06 (17): glosa agrupada opcional: mecanismo do motor
- L8-08 (12): domínio do tipo de prestador SUS: decisão de catálogo
- L8-08 (15): autorizador e órgão gestor SUS: desenho (F2.2)
- L8-15 (10): foto da pessoa: armazenamento de arquivos do produto

## Rodada 5 (2026-11-21): modelo da continuidade (ADR 0006) para a trilha F2.2 e a API

Lotes `40_` (faixa do F4, para não colidir com a numeração da pasta principal), sem gatilho, FKs RESTRICT.

### Rascunho clínico: regra de domínio "rascunho só o autor finaliza ou apaga, com trilha"
- Evolução em rascunho: `registro_assistencial_rascunho` (já existia, `situacao = 'aberto'`). Novas colunas:
  `iniciado_em` (data ORIGINAL em que o autor abriu; na migração, a da origem, nunca a da carga), `imagem_anotada`
  (JSON), `encerrado_por_profissional_id` e `encerrado_por_usuario_id`. `autor_usuario_id` aceita nulo só com
  `origem = 'migracao'` (o autor é o profissional; a API resolve o usuário dele no primeiro acesso).
- Alergia em rascunho: `alergia_paciente.situacao_registro` (`rascunho`, `confirmado` padrão, `descartado`), com
  `registro_assistencial_rascunho_id` (o rascunho de evolução em que está sendo informada), `rascunho_autor_usuario_id`,
  `encerrado_em`, `encerrado_por_profissional_id`. O autor é `registrado_profissional_id`; a data original é
  `registrado_em`.
- CHECK no banco (integridade): quem encerra é o autor (`encerrado_por_profissional_id` igual ao autor quando
  preenchido); rascunho de alergia exige autor; descartado exige `encerrado_em`.
- A API DEVE: (1) listar o rascunho só para o autor (e para o administrador da plataforma, ADR 0002); (2) finalizar
  ou descartar só pelo autor, preenchendo `encerrado_por_*` e `encerrado_em`, gravando a `trilha_auditoria`
  (`alteracao` na finalização com `motivo = 'finalizacao_rascunho'`, `exclusao` no descarte com `dados_antes`);
  apagar = descartar (lógico, nunca DELETE); (3) nunca mostrar rascunho como registro finalizado: alerta de alergia,
  lista de alergias, prescrição e interação leem só `situacao_registro = 'confirmado'`; (4) a finalização de um
  rascunho de evolução confirma junto as alergias ligadas a ele (`registro_assistencial_rascunho_id`).

### Item do hospital ao lado do catálogo oficial
- `termo_terminologia` (CID-10, TUSS e termos TISS), `procedimento_sigtap`, `ocupacao_cbo`, `municipio_ibge`, `banco`,
  `cfop`, `codigo_fiscal_oficial`, `codigo_esocial`: colunas `item_hospital`, `motivo_item_hospital` (`versao_antiga`,
  `codigo_local`), `descricao_hospital` (personalização: o nome que o hospital usa; a oficial não muda) e
  `mantido_ativo_hospital` (código oficial revogado que o hospital segue usando). Os CHECKs de formato do código
  (SIGTAP, IBGE, COMPE/ISPB, CFOP) valem só para o item oficial.
- Telas de busca: item ativo para o hospital = `ativo OR mantido_ativo_hospital OR item_hospital`; mostrar
  `COALESCE(descricao_hospital, descricao)` e um selo "próprio do hospital" no item do hospital.
- O princípio ativo já tinha o desenho próprio (`principio_ativo_cliente`, rodada 4) e ficou como está.

### Espelho padrão da base
- `tools/db/espelho.py` (criar, situacao, atualizar), `db/espelho/0001_espelho.sql` (controle), carga oficial por
  `catalogos/carregar.py --espelho BANCO`, licenciados por `catalogos/licenciados/carregar.py` (formato em
  `catalogos/licenciados/FORMATO.md`). O `criar_cliente` leva o espelho (quando existir) a todo cliente novo e grava
  o resumo no evento `criado`; `espelho.py atualizar` grava o evento `espelho_atualizado`. O painel pode mostrar as
  edições do evento e oferecer "atualizar catálogos" chamando o comando.

### Rodada 5, motor do conector: credenciais copiadas e cofre do cliente (ADR 0007, item 17)
- `credencial_usuario` (02_ADM/40): `algoritmo` aceita `md5`, `sha1`, `sha256`, `sha512` (resumo importado da origem,
  hex em minúsculas) com `regravar_no_login = TRUE`. A API DEVE, no login: conferir a senha pelo algoritmo marcado
  (comparação em tempo constante); no primeiro login bem-sucedido, regravar `resumo_senha` em argon2id,
  `algoritmo = 'argon2id'`, `regravar_no_login = FALSE`, gravando `historico_senha` com `forma_troca = 'migracao'`.
  bcrypt/scrypt importados seguem a mesma regravação quando marcados.
- Cofre do cliente (17_INTG/41): `segredo_cofre` (referência `cofre:migracao/<tabela>/<coluna>/<resumo>`, envelope
  `v1.<iv>.<tag>.<corpo>` em AES-256-GCM com `PLATAFORMA_CHAVE_MESTRA`, o mesmo de `assinatura/infra/cofre.ts`). A API
  DEVE ler essas referências por um adaptador de cofre em banco (aceitar o prefixo `migracao/` em
  `lerReferenciaCofre`/`exigirReferencia`) e mostrar só "definido"/"não definido".
- Mescla da migração (17_INTG/41): `historico_mescla_migracao` (registro adotado, coluna, valor que a origem trazia).
  A tela do registro pode mostrar "a origem trazia outro valor" e permitir aplicar com trilha.
