# Fatia F2.4 18-misto-dominios (assunto: dominios+cadastro+administracao; cliente de teste próprio: f24_18mistodominios)

## packages/contratos/src/dominios/ajudantes.ts  (só comentário)
- nome-origem: linhas 7,146,147,148,149,150,155,156,157,163,191,223,224
    7: // Opções de menu (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json):
    146: // M19 (ficha, seção 5, "Cadastros pelo CRUD genérico"): recepções (TBRECEPCAO 11; Tabelas › Painel eletrônico ›
    147: // Recepção 3725), geradores de senha (TBGERASENHA 36; Opções de geração de senha 3726 e Recepção externa › Gerador
    148: // de senhas 3308), configuração dos painéis de chamada (PNCONFIG 5; Painel eletrônico 3724, Painel atendimento ›
    149: // Salvar configurações 3971), tipos de painel (PNTIPO 3, travado: o legado lê os códigos 1 a 3) e os painéis de TV de
    150: // outros setores (PNCONFIGPORTAL 19; Painel portal 3972, Salvar configurações 3973). A recepção, o painel e o painel
    155: // M18 (ficha, seção 5, "Cadastros pelo CRUD genérico"): a agenda de exames (SIAGENDA), a escala semanal da agenda de
    156: // exames (SICTRAGE) e as salas cirúrgicas (CCSALAS), com as opções do SADT › Agenda › Manutenção (2759, 2760) e do
    157: // Bloco Cirúrgico › Tabelas › Salas (2233). Os usuários permitidos por sala (CCSALAS_TBUSERS) têm receita própria
    163: // Tabelas › Fichas a imprimir, TBOPCOES 3230, e Criação de fichas 3225) e os leitos de observação do pronto
    191: // TBOPCOES 4742), as grandezas do laudo estruturado do eco (Tabelas do S.A.D.T. 2677: sem item próprio, inferida), a
    223: // M25 (ficha, seção 5): os procedimentos e cuidados de enfermagem prescritíveis (TBPROENF, 200, com a restrição de sexo e

## packages/contratos/src/dominios/catalogo.ts  (só comentário)
- nome-origem: linhas 147
    147: // M51 (etapa 2): os médicos solicitantes SUS (FAMEDSOL).

## packages/contratos/src/dominios/dominios-m23.ts  (só comentário)
- nome-origem: linhas 4
    4: // Opções do legado (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json): as da nutrição do PEP

## packages/contratos/src/dominios/dominios-m24.ts  (só comentário)
- nome-origem: linhas 4,52
    4: // consulta na prescrição (o item de estoque é buscado, não listado). Opções do legado (TBOPCOES, retrato
    52: // Lidos na cópia em 22/10/2026 (estrutura RDB$ e agregados; nada de pessoa). Opções do legado (TBOPCOES, retrato

## packages/contratos/src/dominios/dominios-m32.ts  (só comentário)
- nome-origem: linhas 5,8
    5: // usuário, o escopo de conta bancária (MFCTAUSU, que vale nos dois sistemas), os tipos de lançamento por opção e por
    8: // consulta. Opções do outro sistema (TBOPCOES do Controle Financeiro, módulo 14): Tabelas 102, Parâmetros 103,

## packages/contratos/src/dominios/dominios-m33.ts  (só comentário)
- nome-origem: linhas 5,6
    5: // de repasse (TBREPGER) não entram aqui: a regra nova nasce como rascunho no novo e só é incluída depois da aprovação do
    6: // supervisor (tela de regras). Opções do outro sistema (TBOPCOES, "Gestão de repasses e terceiros" 6609): Tabelas 3025,

## packages/contratos/src/dominios/dominios-m34.ts  (só comentário)
- nome-origem: linhas 6
    6: // tabela (cap-12 §12.2). Opções do legado (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/dominios/dominios-m47.ts  (só comentário)
- nome-origem: linhas 10
    10: // Opções do outro sistema (TBOPCOES, módulo Hemoterapia, nenhuma concedida no pc): Tabelas 3048 › Cadastro 3050 e o item

## packages/contratos/src/dominios/dominios-m48.ts  (só comentário)
- nome-origem: linhas 1,2,9
    1: // Cadastros da qualidade no CRUD genérico (M48, etapa 5; ficha, seção 5, "Receita genérica do CRUD para TBTPAUTORIDADE,
    2: // RPMATRIZ_GUT_DESCRICAO e RPMATRIZ_GUT_TIPO": domínios sem uso de movimento no outro sistema, edição a pedido da
    9: // consultas provisórias do M14. Opções do outro sistema (TBOPCOES): nenhuma tela edita estas tabelas; inferidas da

## packages/contratos/src/dominios/dominios-m49.ts  (só comentário)
- nome-origem: linhas 8
    8: // item). Opções do outro sistema (TBOPCOES): Tabelas › Geral A–L › Assinatura avançada 6922 (Gerenciamento 6923): o

## packages/contratos/src/dominios/dominios-m50-sessoes.ts  (só comentário)
- nome-origem: linhas 4,5,6,7,8,9,10
    4: //   - agendas de sessões (AGCADAGENDA): o banco gera o código (gen_idagenda em laço); nome, tipo de agenda da recepção
    5: //     (RETPAGEN), unidade de atendimento (TBUNIDAD), situação (A/I, sem CHECK: o perfil vê "A"), atendimento domiciliar
    6: //     (CHECK F/T) e o centro de custo (TBCENCUS);
    7: //   - recursos de sessão (AGCADEIRA): as cadeiras e salas de cada agenda; o banco gera o código (GEN_IDCADEIRA em laço;
    8: //     CHECK código > 0); a identificação, o tipo e a prioridade, a faixa etária aceita, a complexidade (AGCOMPLEXIDADE) e
    9: //     a duração (AGDURACAO) aceitas (0 = todas) e a situação.
    10: // Opções do outro sistema (TBOPCOES, módulo Agendamento): Configurações 4831 › Manutenção/criação de agendas 4834 para

## packages/contratos/src/dominios/dominios-m50.ts  (só comentário)
- nome-origem: linhas 10
    10: // Opções do outro sistema (TBOPCOES, módulo Controle de acesso): Tabelas 4528 (com Crachás 4530 na portaria e Terminais

## packages/contratos/src/dominios/dominios-m51.ts  (só comentário)
- nome-origem: linhas 2,4,5,8
    2: // FHLEITOUTI e FAMEDSOL": o FAMEDSOL nesta etapa; os leitos de UTI habilitados na etapa 4). FAMEDSOL (1 linha na cópia
    4: // consulta provisória do M14 (`faturamento.medicoSolicitanteExterno`). Opções do outro sistema (TBOPCOES, módulo
    5: // Faturamento A.P.A.C.): Tabelas 920 e "Importa tabela FAMEDSOL" 1100 para gravar; com a raiz do módulo 4262 para ler.
    8: // Etapa 4: os leitos de UTI habilitados (FHLEITOUTI, 12 linhas): opções do módulo Faturamento A.I.H. (Tabelas 643 e

## packages/contratos/src/dominios/dominios-m54-custos.ts  (só comentário)
- nome-origem: linhas 3,4,5,7
    3: // (CTCTARECEITANCI), grupos de exportação do custeio (CTWGRUPOEXPORTACAO: próprio, ApuraSUS, Federassantas), tipos de dado
    4: // da estatística (CTTIPODADO: 1 variável, 2 referência), tipos de regra de rateio (CTWTPREGRA) e unidades de mensuração
    5: // (TBUNIMEN). D-CRUD-544: os grupos de exportação, os tipos de dado e os tipos de regra são lidos por código pelas regras
    7: // altera o nome. Opções do outro sistema (TBOPCOES, Gestão de custos 4258): Tabelas 295, Parâmetros 296, Centros de custo

## packages/contratos/src/dominios/prefixos/recepcao.ts  (só comentário)
- nome-origem: linhas 16,23
    16: // W1-04: inativar só no novo (TBMOTEXC não tem coluna de situação) e excluir o motivo nunca usado, com o mapa de
    23: // W1-04: a procedência (TBPROCED) sai do lote gerado do M14 e ganha a alteração (todas as colunas; o gatilho do

## packages/contratos/src/dominios/tipos.ts
- vocab-antigo: linhas 604,607,718
    604: * M23: texto com formato fixo do legado (ex.: hora em `HHMM`, sem os dois-pontos). M54.1: `digitos`, texto só com
    607: readonly formatoTexto?: 'HHMM' | 'digitos';
    718: * M54.4: `formato` troca o formato que o perfil mediu (ex.: ordem 0001 a 0004 parece hora HHMM e não é).
- nome-origem: linhas 4,22,203,219,545,591,605,636,730,767,768,804,810,811
    4: //     natureza, ações e as opções de menu do legado (TBOPCOES) que concedem cada ação; dela saem as
    22: /** Enumeração interna (TBDIASEMANA e afins): só consulta. */
    203: * De onde vêm as opções de menu do legado: lidas na árvore TBOPCOES (a tela do SPDATA que edita a tabela)
    219: /** TBOPCOES.ID que concedem cada ação (cap-08 §8.6). */
    545: /** Código de PRTIPO_JUSTIF_EXPORTACAO (domínio de auditoria), quando o domínio tem dado pessoal. */
    591: /** TBUSERS.NOME de quem inclui. */
    605: * algarismos (a ordem de 4 dígitos da conta de receita da apuração de custos, CTCTARECEITANCI.ORDEM).
    636: * final "sem fim"; ou o 0 do número não informado, como o CNS e o CRM do FAMEDSOL): a tela mostra vazio e o vazio
    730: * M11: itens de sistema que o novo não altera (o trigger *_BU do legado os protege, ex.: TBCONSPROF 1 a 12
    767: * M14: trilha do legado que o Delphi grava para a tabela (perfil de TBCABTRILHA × TBLANTRILHASGH): tipo
    768: * (TBTPACAOAUDIT 2 inclusão, 3 alteração), criticidade e opção por verbo, e a coluna do alvo.
    804: * W1-04: obrigatório na inclusão (o perfil mediu a coluna sempre preenchida, ex.: TBRECEPCAO.TEXTOIMP, o texto

## apps/api/src/modulos/cadastro/pacientes.controller.ts
- nome-origem: linhas 7,185,205,442,450,478,520
    7: //   GET  /api/cadastros/pacientes/:id/historico           linha do tempo (HTPACIENTE) e unificações do legado
    185: req.sghAlvo = { tabelaAlvo: 'RICADPAC', chaveNaturalAlvo: `busca:${r.tipo};n:${r.itens.length}` };
    205: tabelaAlvo: 'RICADPAC',
    442: req.sghAlvo = { paciente: n, tabelaAlvo: 'RICADPAC', idAlvo: String(n) };
    450: 'executor: TBCABTRILHA e SGH_TRILHA na mesma transação da receita (memória: registrador da API)',
    478: 'executor: TBCABTRILHA e SGH_TRILHA na mesma transação da receita (memória: registrador da API)',
    520: req.sghAlvo = { paciente: n, tabelaAlvo: 'HTPACIENTE', idAlvo: String(n) };

## apps/api/src/modulos/cadastro/porta-memoria.ts  (só comentário)
- nome-origem: linhas 393
    393: /** Revisão do M39: o cadastro de conselhos sintético (sigla → ID), como TBCONSPROF. */

## apps/api/src/modulos/cadastro/profissionais-memoria.ts
- nome-origem: linhas 622,624,637
    622: this.retratos.push({ tabela: 'TBPROFIS', chave: String(p.id), motivo: e.motivo });
    624: this.retratos.push({ tabela: 'TBCBOPRO', chave: String(r.id), motivo: e.motivo });
    637: this.retratos.push({ tabela: 'TBCBOPRO', chave: String(r.id), motivo: e.motivo });

## apps/api/src/modulos/cadastro/profissionais.controller.ts
- nome-origem: linhas 19,28,29,126,308,752,837,905
    19: //   GET /api/cadastros/profissionais/:id/historico           histórico (HTPROFIS)
    28: // Dados bancários e de repasse do profissional nunca saem (regra 11). Situação do TBPROFIS com a legenda
    29: // "a confirmar" (DP-46.1); a atividade real é a do registro (TBCBOPRO.ATIVO).
    126: * que concede papéis em TBUSERS_TBPAPEL), não a de editar o cadastro.
    308: req.sghAlvo = { tabelaAlvo: 'TBPROFIS', idAlvo: String(n) };
    752: req.sghAlvo = { tabelaAlvo: 'HTPROFIS', idAlvo: String(n) };
    837: 'executor: TBCABTRILHA e SGH_TRILHA na mesma transação da receita (memória: registrador da API)',
    905: req.sghAlvo = { tabelaAlvo: 'TBPESSOA', chaveNaturalAlvo: `busca:documento;n:${r.length}` };

## packages/contratos/src/cadastro/paciente.ts  (só comentário)
- nome-origem: linhas 55,78,106
    55: /** M11: responsável/contato (RICADPAC.CONTATO e FCONT; o trigger retrata o telefone do contato). */
    78: * Campos que a ficha altera: só os que o perfil das alterações recentes confirma (RICADPAC × HTPACIENTE,
    106: /** TBECIV.ID (só os valores já vistos em RICADPAC.ECIV). */

## packages/contratos/src/cadastro/profissional.ts  (só comentário)
- nome-origem: linhas 226
    226: // TBUSERS_TBPAPEL.ID_TBCBOPRO; 679 logins medidos, cada um num registro). O profissional com o mesmo conselho em

## packages/contratos/src/cadastro/telas.ts  (só comentário)
- nome-origem: linhas 187,352,354
    187: /** Login de quem alterou (TBUSERS), quando o legado gravou. */
    352: /** TBPROFIS.SITUACAO, baixa confiança (DP-46.1): o código e a legenda "a confirmar". */
    354: /** Atividade real: algum registro ativo (TBCBOPRO.ATIVO). */

## packages/dominio-cadastro/src/documento/cpf.ts  (só comentário)
- nome-origem: linhas 2,35
    2: // "00000000000" recusadas nas telas do novo. O legado guarda CPF como NÚMERO (RICADPAC.CPF DOUBLE PRECISION):
    35: /** Para gravar: o número do CPF (RICADPAC.CPF é numérico). Recusa o inválido. */

## packages/dominio-cadastro/src/paciente/historico.ts  (só comentário)
- nome-origem: linhas 1
    1: // Linha do tempo do cadastro (ficha do M11, seção 4; HTPACIENTE e HTPROFIS): cada versão do retrato do legado

## packages/dominio-cadastro/src/profissional/categoria.ts  (só comentário)
- nome-origem: linhas 2,3,4,5,49,55
    2: // (TBCBOSUS.COD), nunca da sigla do conselho (divergem em 481 de 2.095 registros). Médico: CBO começando em
    3: // 225 (família 2251–2253 da CBO 2002). A atividade real é TBCBOPRO.ATIVO (T 1.949, F 144, nulo 2);
    4: // TBPROFIS.SITUACAO (O 758, F 109, E 4) só aparece com a legenda "a confirmar" (DP-46.1). As sentinelas
    5: // (TBPROFIS IDs 1 e 2, TBCBOPRO IDs 1 e 488) ficam fora das listas.
    49: /** TBCBOPRO.ATIVO: T ativo, F inativo, nulo desconhecido (2 registros). */
    55: /** O profissional está ativo se algum registro está (a situação do TBPROFIS é "a confirmar"). */

## apps/api/src/modulos/administracao/fonte-memoria.ts  (só comentário)
- nome-origem: linhas 539
    539: * a de TBOPCOES (fonte do legado).

## apps/api/src/modulos/administracao/permissoes.controller.ts  (só comentário)
- nome-origem: linhas 3,125
    3: //   GET  /api/administracao/acesso/permissoes/arvore       árvore de TBOPCOES (regra 5) com as opções do grupo/papel
    125: /** A árvore de TBOPCOES em cache por poucos minutos (ficha, seção 4: metadado, muda raramente). */

## apps/api/src/modulos/administracao/usuarios.controller.ts
- nome-origem: linhas 246,311,329,345,372,398,441,459
    246: tabelaAlvo: 'TBUSERS',
    311: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')
    329: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')
    345: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')
    372: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')
    398: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')
    441: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')
    459: @AuditadoNoHandler('executor: TBCABTRILHA (tipo 17) e SGH_TRILHA na mesma transação da receita')

## packages/contratos/src/administracao/auditoria.ts  (só comentário)
- nome-origem: linhas 27,32,77
    27: /** Tipo de ação do banco (TBTPACAOAUDIT.ID). */
    32: /** Prontuário do paciente (RICADPAC.PRONT): o filtro de quem chega pelo número, não pelo ID interno. */
    77: /** Prontuário do paciente (RICADPAC.PRONT). */

## packages/contratos/src/administracao/estrutura.ts  (só comentário)
- nome-origem: linhas 3,112
    3: // o banco mantém (o novo nunca o grava). Credenciais de TBHOSPIT nunca entram no SELECT.
    112: /** Retratos do registro de conferência (HTLEITO): quantidade, só leitura. */

## packages/contratos/src/administracao/flags-usuario.ts  (só comentário)
- nome-origem: linhas 1
    1: // W1-01 (parte 3b): permissões complementares do usuário (TBUSUCPL, uma linha por empresa) que o Sante altera pela

## packages/contratos/src/administracao/permissoes.ts  (só comentário)
- nome-origem: linhas 71,145,204
    71: /** Tipos de permissão de acesso ao prontuário (TBTPPERM_RICADPAC), só consulta. */
    145: * mudar o texto, a data e o autor de PRTERMOCAD): a nova entra ativa e a anterior sai de vigência, com os aceites
    204: /** Prontuário do paciente (RICADPAC.PRONT): o número que a tela mostra. */

## packages/contratos/src/administracao/segredos.ts  (só comentário)
- nome-origem: linhas 2,3
    2: // de e-mail nunca saem pela API: SENHA, SALT e CODIGO_VERIFICACAO de TBUSERS, as senhas secundárias de TBUSUCPL, as
    3: // credenciais de TBHOSPIT e de PREMAILCFG, o CPF, o e-mail e a biometria. Esta é a conferência sobre as RESPOSTAS

## packages/contratos/src/administracao/usuarios.ts  (só comentário)
- nome-origem: linhas 3,176,212,229,244,265
    3: // do M04 (TBUSERS e as tabelas de escopo, exatamente como o legado grava). Nada aqui leva senha, hash, código de
    176: * A leitura fica na trilha (acesso.usuario.consultado com o alvo TBUSERS e a marca `cpf:visto`).
    212: /** O profissional ligado ao login pelo papel Operador de sistema ativo (TBUSERS_TBPAPEL.ID_TBCBOPRO); null sem vínculo. */
    229: /** acesso.criarUsuario: TBUSERS (login exato; grupo ativo; CPF opcional, nunca repetido). */
    244: * acesso.alterarUsuario: TBUSERS.NOMEC e, W1-01, TBUSERS.CPF (o grupo troca pela receita própria; nunca NOME nem
    265: /** acesso.bloquearUsuario / acesso.desbloquearUsuario: TBUSERS.BLOQUEADO. */
