# Fatia F2.4 07-acesso (assunto: acesso; cliente de teste próprio: f24_07acesso)

## apps/api/src/modulos/acesso/comunicacao.controller.ts
- nome-origem: linhas 276
    276: req.sghAlvo = { tabelaAlvo: 'TBMENSAG', chaveNaturalAlvo: `n:${mensagens.length}` };

## apps/api/src/modulos/acesso/estado-sintetico.ts  (só comentário)
- nome-origem: linhas 125,151
    125: /** W1-01 (parte 9b): última conexão (AAAA-MM-DD) por login, como a TBSGHCONEXAO; ausente = nunca entrou. */
    151: // As opções de papel das sementes ficam no papel especial (0 a 3), como em TBPAPEL_TBOPCOES.

## apps/api/src/modulos/acesso/fonte-sintetica.ts
- nome-origem: linhas 2,3,74,214,266,356,371,1207,1394,1395,1396,2350,3175
    2: // tocar no TBUSERS da cópia, para exercitar o BFF (sessão no servidor, cookie, inatividade,
    3: // reautenticação, tentativas) sem credencial de pessoa real (regra 1.7). O login sobre o TBUSERS da cópia
    74: /** M17: escopos sintéticos (TBUNIUSE, TBAGEUSE…); ausente = sem restrição. */
    214: /** M51 (etapa 2): as opções do CRUD dos médicos solicitantes SUS (Tabelas 920 e "Importa tabela FAMEDSOL" 1100). */
    266: /** Acesso a duas unidades: depois do login, o segundo seletor (TBUNIDAD). */
    356: /** M17: as mesmas opções da agenda, com o escopo restrito à unidade 2 (TBUNIUSE). */
    371: /** M17: as mesmas opções da agenda, com o escopo restrito ao tipo de agenda 5 (TBAGEUSE). */
    1207: * escopo (GELOCUSU) vêm da porta do estoque.
    1394: 'GEUSERS.PERMITIR_AUTORIZAR_PEDIDO',
    1395: 'GEUSERS.AUT_REQ',
    1396: 'GEUSERS.PERMITIR_DESBLOQUEIO_FECHAMENTO',
    2350: * M51 (etapa 2): o faturista do BPA e dos solicitantes SUS (as opções do BPA, das tabelas e da importação do FAMEDSOL;

## apps/api/src/modulos/acesso/gestao-fonte-propria.ts
- modelo-pendente: linhas 17,74
    17: // Pendências (pedidos em docs/obra/fatias/f22/saida/02-02.json; respondem "modelo-pendente" ou "adaptador-pendente",
    74: 'modelo-pendente',

## apps/api/src/modulos/acesso/gestao-fonte.ts  (só comentário)
- nome-origem: linhas 175
    175: /** W1-01 (parte 11d): registros de conselho do papel ativo do usuário (TBUSERS_TBPAPEL → TBCBOPRO). */

## apps/api/src/modulos/acesso/gestao.controller.ts
- modelo-pendente: linhas 26
    26: // a origem da trilha). O que a fonte própria ainda não grava responde "modelo-pendente" ou "adaptador-pendente".

## apps/api/src/modulos/acesso/identidade/porta-identidade-propria.ts
- modelo-pendente: linhas 20,151
    20: //   (politica_segundo_fator; até lá incluir, alterar e encerrar respondem "modelo-pendente"), e a coluna do segredo
    151: 'modelo-pendente',

## apps/api/src/modulos/acesso/recertificacao.controller.ts
- nome-origem: linhas 244
    244: 'SGH_ACESSO_RECERT_ITEM e SGH_TRILHA na transação SGH_; retirar: executor acesso.bloquearUsuario (TBCABTRILHA) ou revogarPerfil (SGH_TRILHA)',

## apps/web/src/modulos/acesso/api-gestao.ts
- vocab-antigo: linhas 220,240,252,264,272,310
    220: gravar<{ id: string; anterior: string | null; atual: string | null; destino: 'legado' | 'memoria' }>(
    240: gravar<{ id: string; itens: number; destino: 'legado' | 'memoria' }>('/recertificacoes', p, buscar);
    252: destino: 'legado' | 'memoria';
    264: gravar<{ id: string; destino: 'legado' | 'memoria' }>('', p, buscar, PEDIDOS);
    272: gravar<{ id: string; situacao: 'cancelado'; destino: 'legado' | 'memoria' }>(
    310: gravar<{ id: string; anterior: string | null; perfil: string | null; destino: 'legado' | 'memoria' }>(

## apps/web/src/modulos/acesso/i18n-segredos.ts
- nome-origem: linhas 33,34,35,36,41,42,43,46,51
    33: TBCONVEN: { SENHA: 'Senha do portal' },
    34: TBTISSWEBSERV: { SENHA_PRESTADOR: 'Senha do prestador' },
    35: TBCODATI: { SENHA_PRESTADOR: 'Senha do prestador' },
    36: TBHOSPIT: {
    41: GEUSERS: { SENHA: 'Senha do almoxarifado' },
    42: PREMAILCFG: { SENHA_AUTENTICACAO: 'Senha de autenticação' },
    43: SITPEQV: { SENHA_FTP: 'Senha de transferência de arquivos', SENHA_EXPORTACAO: 'Senha de exportação' },
    46: TBINFBANCO: 'Dados de acesso ao banco externo do estabelecimento',
    51: TBINFBANCO:

## packages/contratos/src/acesso/entrada.ts  (só comentário)
- nome-origem: linhas 8,10,13
    8: /** Tamanho de TBUSERS.NOME (VARCHAR(31)). */
    10: /** Tamanho de TBUSERS.SENHA (VARCHAR(100)). */
    13: /** Login exato do legado (TBUSERS.NOME): sem espaço nas pontas, maiúsculas contam. */

## packages/contratos/src/acesso/gestao.ts  (só comentário)
- nome-origem: linhas 4,5,11,16,31,51,55,61,65,69,73,77,112,200
    4: // administrar as permissões do PRÓPRIO legado pelas receitas do executor do M04 (TBPERUSU, TBPAPEL_TBOPCOES,
    5: // TBUSERS_TBPAPEL, TBUSERS.GRUPO, TBGRUUSU), gravadas exatamente como o SPDATA grava. Nada aqui leva senha
    11: /** TBGRUUSU.NOME (VARCHAR(50)): exato, sem espaço nas pontas (o legado tem nome com espaço no meio). */
    16: /** TBPAPEL.COD_PAPEL: 0 Gestor de acessos, 1 Administrador, 2 Auditor, 3 Operador de backup, 4 Operador. */
    31: /** acesso.concederOpcoesGrupo / acesso.revogarOpcoesGrupo: TBPERUSU (GRUPO, ID_TBOPCOES). */
    51: /** acesso.concederOpcoesPapel / acesso.revogarOpcoesPapel: TBPAPEL_TBOPCOES (pelo COD_PAPEL). */
    55: /** acesso.concederPapelUsuario: TBUSERS_TBPAPEL nova (o par nunca existiu; o inativo é reativado). */
    61: /** acesso.revogarPapelUsuario / acesso.reativarPapelUsuario: TBUSERS_TBPAPEL.ATIVO (nunca DELETE). */
    65: /** acesso.trocarGrupoUsuario: TBUSERS.GRUPO (só para grupo ativo do TBGRUUSU). */
    69: /** acesso.criarGrupo: TBGRUUSU (NOME, ATIVO = 'T'), sem opções (concedidas depois). */
    73: /** acesso.desativarGrupo / acesso.reativarGrupo: TBGRUUSU.ATIVO (o TRG_TBGRUUSU_BU recusa com usuário ativo). */
    77: /** W1-01: acesso.renomearGrupo — TBGRUUSU.NOME (a chave) só sem dependente nenhum (D-W101-18). */

## packages/contratos/src/acesso/identidade.ts  (só comentário)
- nome-origem: linhas 6
    6: //   Sante SGH; o legado (TBUSERS.SENHA) fica como está até a retirada (acesso.retirarSenhaLegado), que só roda

## packages/contratos/src/acesso/tabelas-clinicas.gerado.ts
- nome-origem: linhas 5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24
    5: 'CCCADCIR',
    6: 'CCCADCIR_EXCLUSAO',
    7: 'CCLANCIR',
    8: 'HTATENDALTA',
    9: 'HTATENDIMENTO',
    10: 'HTATENDRESP',
    11: 'HTCHKGERAL',
    12: 'PRALERGIAPAC',
    13: 'PRALERGIAPAC_TBPRINC',
    14: 'PRASSINATURA_CAB',
    15: 'PRASSINATURA_DOC',
    16: 'PRASSINAT_DOC_PRCHKGERAL',

## packages/contratos/src/acesso/usuario-integracao.ts  (só comentário)
- nome-origem: linhas 2,3,15
    2: // TBUSERS (sem grupo, bloqueado, sem senha, sem poder de login). O nome é a chave de auditoria do legado
    3: // (TBUSERS.NOME, VARCHAR(31), comparação exata e sensível a maiúsculas; ref 01 §4.3).
    15: /** Nome completo (TBUSERS.NOMEC); vazio aceito quando o perfil mostrar que o legado aceita. */

## packages/dominio-acesso/src/catalogo/reconstrucao-arvore.ts  (só comentário)
- nome-origem: linhas 1
    1: // Árvore de opções de menu do legado para a TELA de permissões (ficha do M10, regra 5; cap-08 §8.6): TBOPCOES não

## packages/dominio-acesso/src/concessao.ts  (só comentário)
- nome-origem: linhas 2,3,12
    2: // uma opção de P.opcoesLegado (pelo grupo em TBPERUSU ou por papel em TBPAPEL_TBOPCOES) ou uma flag listada
    3: // (TBUSUCPL, GEUSERS, FCPARUSU); perde quando perde no legado (o novo lê ao vivo, com cache curto). Recurso
    12: /** Papéis SBIS do legado (TBPAPEL.COD_PAPEL) → perfil complementar do novo (cap-08 §8.3.4). */

## packages/dominio-acesso/src/politica-2fa.ts  (só comentário)
- nome-origem: linhas 28
    28: /** Grupo do legado (TBGRUUSU.NOME) ou null. */

## packages/dominio-acesso/src/politica-senha.ts  (só comentário)
- nome-origem: linhas 1,5,21,72,259
    1: // Política de senha (cap-08 §8.8): as regras de TBCFGLOGIN somadas às mínimas do Sante SGH quando a troca é
    5: /** Regras lidas de TBCFGLOGIN (null: coluna vazia no legado). */
    21: * TBCFGLOGIN: a efetiva é a mais exigente entre as duas (só aperta, nunca afrouxa).
    72: * Política efetiva: a mais exigente entre o legado (TBCFGLOGIN), o mínimo do novo e, se houver, a política do Sante
    259: /** Início da janela de reutilização (TBHISTSENHA dentro dela não pode ser repetida). */

## packages/dominio-acesso/src/portal/conta.ts  (só comentário)
- nome-origem: linhas 2
    2: // identidade própria em SGH_POR_CONTA (nunca TBUSERS), nascida de um convite do hospital (o código sai impresso: nenhuma

## packages/dominio-acesso/src/portal/privacidade.ts  (só comentário)
- nome-origem: linhas 55,68
    55: * ID do signatário no domínio do cadastro (TBTIPOREPRE), pela descrição lida ao vivo ("Paciente", "Representante Legal"):
    68: * Situação do termo (TBMOVTERMSTATUS) para "consentiu" e "não consentiu", pela descrição (na cópia do pc: 3

## packages/dominio-acesso/src/prova-grupos.ts  (só comentário)
- nome-origem: linhas 2
    2: // conjunto de opções que o legado concede (TBPERUSU) e o que as permissões do novo cobrem têm de bater.

## packages/dominio-acesso/src/tempo-sessao.ts  (só comentário)
- nome-origem: linhas 1
    1: // Tempo de sessão (cap-08 §8.8): inatividade pelo menor valor entre TBCFGLOGIN.TEMPO_MAX_INATIVO_ENC_SESSAO e o

## packages/dominio-acesso/src/tentativas.ts  (só comentário)
- nome-origem: linhas 2
    2: // TBCFGLOGIN.QTDE_TENTATIVA_INVALIDA_BLOQ, no máximo 10; o novo bloqueia só a própria porta (contador no

## packages/dominio-acesso/src/termo.ts  (só comentário)
- nome-origem: linhas 1,3,6
    1: // Termo de uso (cap-08 §8.8; ficha do M05, regra 12): sem aceite da versão vigente em PRTERMOACEITE, a sessão
    3: // aceite periódico ligado (TBCFGLOGIN.SOLIC_TERMO_ACEITE_PERIODICO), o aceite vence após o período.
    6: /** Há termo vigente (PRTERMOCAD ativo). */

## packages/dominio-acesso/src/usuario/login.ts  (só comentário)
- nome-origem: linhas 1,6
    1: // O login é a chave (ficha do M10, regra 2; cap-08 §8.9; ref 01 §4.3): TBUSERS.NOME é a PK, texto exato de até
    6: /** Tamanho de TBUSERS.NOME (VARCHAR(31)). */

## packages/dominio-acesso/src/usuario/tarefas-rh.ts  (só comentário)
- nome-origem: linhas 35,191
    35: /** TBUSERS.ID_TBUSERS do vínculo (null: ainda sem usuário). */
    191: /** criar-acesso feita: o login criado (TBUSERS.NOME). */

## packages/dominio-acesso/src/usuario/ultimo-gestor.ts  (só comentário)
- nome-origem: linhas 4,5,14
    4: //   - grupo de acesso total (TBUSERS.GRUPO = MASTER, a chave GRUPO_ADMINISTRADORES);
    5: //   - papel SBIS "Gestor de acessos" ativo (TBUSERS_TBPAPEL com TBPAPEL.COD_PAPEL 0; PERFIL_DO_PAPEL);
    14: /** TBPAPEL.COD_PAPEL do papel SBIS "Gestor de acessos" (PERFIL_DO_PAPEL[0] = 'gestor-acessos'). */

## packages/dominio-acesso/src/usuario/usuario-modelo.ts  (só comentário)
- nome-origem: linhas 5
    5: // Acessos copiados: o grupo (TBUSERS.GRUPO), os papéis SBIS ativos (TBUSERS_TBPAPEL) e as concessões nominais

## packages/dominio-acesso/src/vinculo.ts  (só comentário)
- nome-origem: linhas 2,6
    2: // PRPARAM.REST_ACESS_PACI_NAO_ESTE_ATEND, igual nos dois sistemas (se o novo restringisse o que o legado
    6: /** Paciente do legado pelo ID (RICADPAC.ID) e, quando houver, o atendimento (REG). */
