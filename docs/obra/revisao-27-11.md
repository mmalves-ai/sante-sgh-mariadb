# Revisão com o dono, 27/11/2026

Roteiro gerado na noite de 26/11 (Sessão de Construção). Números recontados por script em `docs/fases/fichas/README.md`.

## 1. Onde a obra está (atualizado em 27/11 04h, depois da completar-8)

| Fase | Cobertas | Parciais | Faltam | Total |
|---|---|---|---|---|
| F3, cobertura dos módulos | 225 | 29 | 0 | 254 |
| F7, exigido para vender | 89 | 20 | 0 | 109 |
| F8, recursos novos | 97 | 6 | 1 | 104 |
| **Total** | **411 (88%)** | **55** | **1** | **467** |

GitHub: `origin/main` = 215c37da (esteira simulada com 4 CPUs VERDE; a execução do GitHub é conferida a cada push).
Painel 5310 e API 3310 no mesmo commit, cliente ProntoCardio com as migrações aplicadas. Evolução: 163 (36%) em 25/11 de
manhã; 326 (70%) em 26/11 às 08h; 370 (79%) às 21h; 411 (88%) em 27/11 às 03h (completar-7 na F7 e completar-8 na F3/F8).

## 2. Decisões para revisar

`docs/obra/decisoes-tomadas.md`, 49 decisões numeradas, cada uma com o que, por quê e como desfazer. As que mais pedem o
seu olhar (produto e regra de negócio, não processo da obra):

- 13, 14 e 18 a 34: decisões de classe C da construir-3 e da completar-4 (assinatura ICP-Brasil do laudo, central de regulação com SISREG como
  primeiro adaptador, foto facial na identificação, segundo fator por chave de dispositivo, LALUR/LACS, plano de contas
  da ANS, catálogo TACO na nutrição, pesquisa clínica que só sugere candidatos).
- 36 a 40: decisões de produto da completar-5 (restrição de exame por sexo com justificativa por padrão, grade diária da
  dispensação, nota fiscal só pelo vínculo do faturamento, refeição do acompanhante por regra do estabelecimento, prazo
  de guarda da soroteca por regra do estabelecimento).
- 41 a 49: decisões da fase 2 das recusas da carga (sessão Painel de Injeção), entre elas o lote migrado sem validade
  (41: entra visível com alerta; uso em paciente e saída a terceiro recusam).

## 3. Pendências (56 funções não cobertas, lista gerada por script)

Por motivo: **25 dependem de peça externa** (eSocial, webservice de operadora, PIX real, aparelhos do laboratório,
certificado, SISREG, carregador oficial do CNES, conector); **31 são internas que já tiveram três tentativas** (construção,
completar e a rodada dirigida da integrar-4/completar-7/8) sem fechar. Pela regra 5 do plano de redução, uma quarta
tentativa só com informação nova: o que falta em cada uma está escrito na linha da ficha. Pede a sua prioridade.
Carga (sessão Painel de Injeção): pendências em `docs/obra/passagens/RETOMADA-carga-painel.md`.
Regressão achada em 27/11 05h50 (fora das fichas Parciais): o E2E `w0-10-medico` (portal do médico externo) cai 0/4 no
cadastro do segundo fator. Corrigido em 27/11 (CPF exigido no autocadastro desde 21/11; "Cadastrar o médico" recusado como
operação desconhecida no SADT, 9e3cadeb e f444c5d5): 2/4 verdes. Seguem 2 defeitos à parte no portal do médico externo: a
situação do valor crítico não passa a "Já com plantonista/supervisor" depois da ciência, e a assinatura remota não mostra a
opção "Certificado em nuvem" (pm-ass-certificado).
Atualização 27/11 10h (6b18fddb, b595e04b): o crítico e o certificado em nuvem voltaram a ser ligados (perdidos com o fim do
boot antigo, d0c9ef19). Seguem 2/4: a fila da assinatura remota está vazia porque FONTE_CONTEUDO_ICP e ARMAZEM_PDF_ICP não
têm provedor na API; e o teste do crítico esbarra no aviso de exame repetido em 24 h da massa sintética do dia.

| Fase | Ficha | Linha | Função | Motivo | O que o hospital faz |
|---|---|---|---|---|---|
| F3 | F3.2-recepcao-agenda | 02-REC linha 33 | C2-005 | externa | Senha, fila, guichê, totem e painel de chamada com voz e prioridade le |
| F3 | F3.2-recepcao-agenda | 02-AGE linha 42 | C1-101 | interna | Marcar, encaixar, remarcar, confirmar e registrar falta, com situação, |
| F3 | F3.2-recepcao-agenda | 02-AGE linha 44 | C1-113 | externa | Agenda de exames do diagnóstico, com sala ou equipamento como recurso, |
| F3 | F3.2-recepcao-agenda | 02-AGE linha 48 | C1-121 | externa | Lista de espera por vaga: incluir, ofertar vaga, encerrar, com históri |
| F3 | F3.3-prontuario | 03-PEP L95 | C3-002 | externa | Construtor de modelos de documento clínico: campos, regras de habilita |
| F3 | F3.3-prontuario | 03-PEP L108 | C2-104 | externa | Apoio à decisão na prescrição: alergia, dose máxima, duplicidade, inte |
| F3 | F3.3-prontuario | 03-PEP L115 | C2-003 | interna | Sinais vitais e medidas, com limites de alerta, instrumento, posição e |
| F3 | F3.3-prontuario | 03-PEP L131 | C2-036 | externa | Impressão, cópia e exportação do prontuário, com cabeçalho por tipo de |
| F3 | F3.4-internacao-cc | 04-INT linha 69 | C2-034 | interna | Emite os documentos da internação (fichas, termos, guias) conforme o c |
| F3 | F3.5-sadt | 05-SADT linha 4 | C3-003 | interna | Requisição de exames: atendimento de diagnóstico, itens, kits e trilha |
| F3 | F3.5-sadt | 05-SADT linha 5 | C2-006 | interna | Restrições clínicas da solicitação: sexo, idade, material, horário e s |
| F3 | F3.5-sadt | 05-SADT linha 8 | C1-060 | externa | Mapa de trabalho: distribuição dos exames por bancada, lote de trabalh |
| F3 | F3.5-sadt | 05-SADT linha 13 | C3-004 | externa | Interface com os equipamentos do laboratório: cadastro da interface, m |
| F3 | F3.5-sadt | 05-SADT linha 14 | C1-092 | externa | Laboratório de apoio: catálogo do apoio, de-para de exame, analito e m |
| F3 | F3.7-faturamento | 06-FAT linha 12 | C2-035 | interna | Conta: abertura, contas parciais por período, dados do segurado, confe |
| F3 | F3.7-faturamento | 06-FAT linha 36 | C1-134 | externa | Nota fiscal de serviço da fatura do convênio e do particular |
| F3 | F3.7-faturamento | 06-FAT linha 38 | C1-135 | externa | Parâmetros, preferências e alçadas do faturamento |
| F3 | F3.7-faturamento | 06-FAT linha 45 | C3-006 | externa | RPA do autônomo com INSS e IRRF, natureza do rendimento e eSocial |
| F3 | F3.8-financeiro | 07-FIN linha 63 | C1-008 | interna | Títulos a pagar: incluir em parcelas, com classificação, rateio e rete |
| F3 | F3.8-financeiro | 07-FIN linha 66 | C1-026 | interna | Borderô e pagamento eletrônico: lote de pagamento, remessa ao banco, r |
| F3 | F3.9-apoio | 01-ADM L59 | C2-051 | interna | Escopo do usuário: estabelecimento, unidade, local, convênio, tipo de |
| F3 | F3.9-apoio | 01-REL L112 | C2-077 | interna | Indicadores com ficha técnica, meta, apuração com numerador e denomina |
| F3 | F3.9-apoio | 04-HOT L126 | C2-008 | externa | SAME: guarda física do prontuário, local no arquivo e movimentação ent |
| F3 | F3.9-apoio | 08-INTG L128 (31) | C3-007 | externa | Troca eletrônica com as operadoras (elegibilidade, autorização, envio, |
| F3 | F3.9-apoio | 08-INTG L133 (36) | C2-023 | externa | Comunicação com o paciente: confirmação, lembrete e aviso, pela plataf |
| F3 | F3.9-apoio | publicarDocumento | C2-060 | interna | Publica uma versão de documento da qualidade (POP, protocolo, política |
| F3 | F3.9-apoio | retirarDocumento | - | interna | Retira de uso a versão vigente, com motivo |
| F3 | F3.9-apoio | registrarCiencia | - | interna | Registra a ciência do colaborador no documento publicado |
| F3 | F3.9-apoio | registrarAuditoria | C2-060 | interna | Registra a auditoria interna com o referencial e os auditores |
| F7 | F78-01-administracao | 01-ADM L61 | C2-010 | interna | Login único corporativo: o usuário entra com a conta do diretório do h |
| F8 | F78-02-cadastro-recepcao-agenda | 02-CAD linha 10 | C2-011 | interna | Paciente confidencial ou VIP: acesso restrito ao prontuário com libera |
| F7 | F78-02-cadastro-recepcao-agenda | 02-CAD linha 24 | C2-026 | interna | Planos e categorias da fonte pagadora, com regras próprias (teto, pend |
| F7 | F78-02-cadastro-recepcao-agenda | 02-CAD linha 29 | C3-011 | interna | Conferência e exportação com o CNES (habilitações, serviços e classifi |
| F7 | F78-02-cadastro-recepcao-agenda | 02-REC linha 38 | C1-080 | externa | Regulação: receber pedidos da central de regulação, aceitar ou recusar |
| F8 | F78-02-cadastro-recepcao-agenda | 02-AGE linha 52 | - | interna | Agenda de atendimento domiciliar: escala por área e por profissional |
| F7 | F78-04-internacao-cc-hotelaria | 04-INT linha 80 | C1-108 | externa | Comunica a internação e a alta à operadora |
| F7 | F78-05-diagnostico-suprimentos | 05-SUP linha 26 | C2-030 | interna | Compras públicas (Lei 14.133/2021): licitação, pregão, propostas, ata |
| F7 | F78-06-faturamento | 06-FAT linha 26 | C2-070 | externa | Elegibilidade do beneficiário e comunicação de internação e alta à ope |
| F7 | F78-06-faturamento | 06-FAT linha 27 | C2-081 | externa | Solicitação eletrônica de autorização prévia (SP/SADT, internação, pro |
| F8 | F78-06-faturamento | 06-FAT linha 47 | C2-100 | interna | Repasse por plantão, por valor fixo e com mínimo garantido |
| F7 | F78-06-faturamento | 06-SUS linha 53 | C1-051 | interna | Competência SUS, crítica prévia, parâmetros do instrumento e permissõe |
| F7 | F78-06-faturamento | 06-SUS linha 61 | C2-123 | externa | Habilitações e serviços SUS do estabelecimento e regras por tipo de pr |
| F7 | F78-07-financeiro-pessoas | 07-FIN linha 90 | C2-045 | externa | Pix com cobrança, retorno e baixa automática |
| F7 | F78-07-financeiro-pessoas | 07-FIN linha 124 | C2-093 | interna | Regras de contabilização automática dos módulos (faturamento, financei |
| F8 | F78-07-financeiro-pessoas | 07-FIN linha 130 | C2-112 | interna | Controle orçamentário na compra e no pagamento (saldo conferido, bloqu |
| F7 | F78-08-operadora-integracoes | 08-SGO L98 (6) | C2-116 | interna | Coparticipação e franquia: regra por produto e por tipo de guia, limit |
| F7 | F78-08-operadora-integracoes | 08-SGO L101 (9) | C2-118 | externa | Rede credenciada: credenciamento PF e PJ, locais e especialidades, con |
| F7 | F78-08-operadora-integracoes | 08-SGO L103 (11) | C2-122 | interna | Autorização de guias e auditoria médica: pedido, protocolo e prazo pel |
| F7 | F78-08-operadora-integracoes | 08-SGO L113 (21) | C2-074 | interna | Portal do prestador credenciado: pedido de autorização pela web, envio |
| F7 | F78-08-operadora-integracoes | 08-INTG L131 (34) | C1-054 | externa | Webservices e arquivos do SUS: rastreamento de câncer, cadastro de pre |
| F8 | F78-08-operadora-integracoes | 08-SGO L114 (22) | C3-027 | interna | Portal do beneficiário, da empresa contratante e do corretor; segunda |
| F8 | F78-09-completude | 09-AREA linha 65 (3) | C2-060 | interna | Gestão da qualidade para acreditação: documento controlado com versão |
| F7 | F78-09-completude | 09-AREA linha 73 (11) | C1-099 | externa | Atributos sociodemográficos do cadastro nacional: orientação sexual, p |
| F7 | F78-09-completude | 09-AREA linha 76 (14) | C2-084 | externa | Restrição de cobertura por fonte pagadora (procedimento proibido por p |
| F7 | F78-09-completude | 09-AREA linha 81 (19) | C2-017 | interna | Compras públicas: coleta de preços para licitação, adesão a pregão (at |
| F8 | F78-09-completude | 09-AREA linha 84 (22) | C2-032 | interna | Terminologia clínica (SNOMED CT), região e localização anatômica, late |

## 4. Consumo

Plano de redução (25/11): de ~3,3 M para ~1,5 M por função pronta. Medido em 26/11: ~0,7 M por função coberta
(integrar-4, completar-5 e completar-6); cadência de 1 a 13 M/h contra ~76 M/h na manhã de 25/11. Detalhe em
`docs/obra/consumo.md`.
