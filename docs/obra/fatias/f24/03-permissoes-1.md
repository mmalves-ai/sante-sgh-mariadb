# Fatia F2.4 03-permissoes-1 (assunto: permissoes-1; cliente de teste próprio: f24_03permissoes1)

## packages/contratos/src/permissoes/administracao.ts  (só comentário)
- nome-origem: linhas 4,12
    4: // no legado tem a permissão no novo (opções da árvore de TBOPCOES do módulo de abertura e do módulo Tabelas:
    12: * Opções do legado (TBOPCOES) usadas aqui, com o caminho no menu:

## packages/contratos/src/permissoes/agenda.ts  (só comentário)
- nome-origem: linhas 2
    2: // permissão no novo (regra 1 do M06): as opções do módulo Recepção externa › Agenda da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/anestesia.ts  (só comentário)
- nome-origem: linhas 3
    3: // Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/atendimento.ts  (só comentário)
- nome-origem: linhas 2
    2: // legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/balanco.ts  (só comentário)
- nome-origem: linhas 2
    2: // (regra 1 do M06). Opções do módulo do PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json), todas

## packages/contratos/src/permissoes/bloco-seguro.ts  (só comentário)
- nome-origem: linhas 3
    3: // Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/cadastro.ts  (só comentário)
- nome-origem: linhas 3
    3: // do SPDATA que fazem o mesmo (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/catalogo-legado.ts  (só comentário)
- nome-origem: linhas 1
    1: // Catálogo de permissões GERADO da árvore de opções do legado (TBOPCOES; ficha do M06, regra 2): os dados

## packages/contratos/src/permissoes/catalogos.ts  (só comentário)
- nome-origem: linhas 3
    3: // legado tem a permissão no novo: as opções vêm da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/cirurgia.ts  (só comentário)
- nome-origem: linhas 2,59
    2: // Bloco Cirúrgico). Quem tem a opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES
    59: // Os escopos do módulo agenda (unidade e tipo de agenda); a agenda de exames não tem tipo (SIAGENDA sem TIPO): o

## packages/contratos/src/permissoes/config.ts  (só comentário)
- nome-origem: linhas 1
    1: // Permissões do módulo config (M02 a M04; convencoes.md §12). Recursos novos, sem opção em TBOPCOES:

## packages/contratos/src/permissoes/consignado-manipulacao.ts  (só comentário)
- nome-origem: linhas 2
    2: // sistema anterior tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/contabil.ts  (só comentário)
- nome-origem: linhas 3
    3: // opção no outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (catalogo-legado.json, pc;

## packages/contratos/src/permissoes/custos.ts  (só comentário)
- nome-origem: linhas 3
    3: // estatísticas. Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES

## packages/contratos/src/permissoes/desligamento.ts  (só comentário)
- nome-origem: linhas 1
    1: // Permissões do M58 (ficha, seção 7): recursos novos, sem opção em TBOPCOES, concedidos por perfil ao Administrador do

## packages/contratos/src/permissoes/documento-assinatura.ts  (só comentário)
- nome-origem: linhas 3
    3: // tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES levantadas no preparo (catalogo-legado.json, pc):

## packages/contratos/src/permissoes/enfermagem.ts  (só comentário)
- nome-origem: linhas 4
    4: // legado tem a permissão no novo (regra 1 do M06). Opções do módulo do PEP (TBOPCOES, retrato

## packages/contratos/src/permissoes/escores.ts  (só comentário)
- nome-origem: linhas 3
    3: // PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/especialidades.ts  (só comentário)
- nome-origem: linhas 2
    2: // Quem tem a opção no sistema anterior tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/farmacia.ts
- nome-origem: linhas 2,9,39
    2: // a opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato
    9: // A marca do usuário do estoque "lançar controlado" (GEUSERS.PERM_LAN_MAT_MED_CONT) concede a conferência e a perda do
    39: const flag = (coluna: string): FlagLegado => ({ tabela: 'GEUSERS', coluna });

## packages/contratos/src/permissoes/faturamento-sus.ts  (só comentário)
- nome-origem: linhas 4,14,153
    4: // `faturamento.sus.fecharCompetencia`. Opções da árvore TBOPCOES levantadas no preparo do M51 (retrato
    14: //     Encerramento 961; Importa tabela FAMEDSOL 1100; Fechamento de fatura 1103.
    153: // Os médicos solicitantes SUS (FAMEDSOL) vão pelo CRUD genérico (M51, etapa 2): as permissões

## packages/contratos/src/permissoes/faturamento-tiss.ts  (só comentário)
- nome-origem: linhas 3,14
    3: // sistema tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES do Faturamento convênios (módulo 4)
    14: // O escopo por convênio (TBUSERS_TBCONVEN, TBUSERCON) vale em toda leitura e gravação (como no M30). Supervisor do

## packages/contratos/src/permissoes/faturamento.ts  (só comentário)
- nome-origem: linhas 3,15
    3: // (regra 1 do M06). Opções da árvore TBOPCOES levantadas na primeira hora do marco (retrato
    15: // O escopo por convênio (TBUSERS_TBCONVEN, TBUSERCON) vale em toda leitura e gravação da conta (regra 13, `convenio`).

## packages/contratos/src/permissoes/financeiro.ts
- nome-origem: linhas 5,111,289
    5: // novo (regra 1 do M06). Opções da árvore TBOPCOES do Controle Financeiro (módulo 14, 248 opções; retrato
    111: // O escopo do módulo financeiro (a conta bancária, MFCTAUSU): vale para todas, como o catálogo gerado.
    289: 'Editar os parâmetros financeiros, as faixas de alçada e o escopo por conta (MFCTAUSU)',

## packages/contratos/src/permissoes/inicio.ts  (só comentário)
- nome-origem: linhas 4,6
    4: // (SGH_ACESSO_MAPA_OPCAO). Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
    6: //     publicação de comunicado e a consulta das mensagens do sistema anterior (TBMENSAG) seguem quem as tinha;

## packages/contratos/src/permissoes/internacao-adt.ts  (só comentário)
- nome-origem: linhas 4
    4: // opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/internacao.ts  (só comentário)
- nome-origem: linhas 3
    3: // permissão no novo (regra 1 do M06). Opções da árvore do legado (TBOPCOES, retrato

## packages/contratos/src/permissoes/manutencao.ts  (só comentário)
- nome-origem: linhas 3,4
    3: // Levantamento na cópia do pc (24/10/2026, só contagens): o módulo "Manutenção" (TBMODULO 21) existe, mas não tem
    4: // nenhuma opção em TBOPCOES, e as 22 tabelas GM* estão vazias. A opção mais próxima é a do patrimônio, módulo 19,

## packages/contratos/src/permissoes/nir.ts  (só comentário)
- nome-origem: linhas 3
    3: // permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/nutricao.ts  (só comentário)
- nome-origem: linhas 4
    4: // anterior tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/operadora.ts  (só comentário)
- nome-origem: linhas 4
    4: // TBMODULO têm 233 opções (abertura 53, controle financeiro 177, gerador de relatórios 3) e NENHUMA concessão a grupo

## packages/contratos/src/permissoes/opme.ts  (só comentário)
- nome-origem: linhas 3
    3: // tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/orcamento.ts  (só comentário)
- nome-origem: linhas 3
    3: // outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES "Gestão de orçamento" (4261;

## packages/contratos/src/permissoes/patrimonio.ts  (só comentário)
- nome-origem: linhas 3
    3: // Opções da árvore TBOPCOES "Gestão patrimonial" (4266; catalogo-legado.json, pc): Tabelas › Bens 266; Movimentação 268

## packages/contratos/src/permissoes/pep.ts  (só comentário)
- nome-origem: linhas 3,47,105,308,309,546
    3: // opções do módulo do PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json) que abrem o
    47: // Opções inferidas (POL-1b) do módulo do PEP pelo perfil da trilha do legado (TBCABTRILHA, 2026-06 a 2026-07):
    105: // M24 (ficha, seção 7): prescrição eletrônica (CPOE). Opções do módulo do PEP (TBOPCOES, retrato
    308: // M23 (ficha, seção 7): documentos, exames, resultados e multiprofissional. Opções do módulo do PEP (TBOPCOES,
    309: // retrato tools/verificadores/dados/acesso-legado.pc.json) e a trilha do legado (TBCABTRILHA, 2026-06-01 a
    546: // `pep.admin.ler` (M22). Opções do módulo do PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json),

## packages/contratos/src/permissoes/pessoas-folha.ts  (só comentário)
- nome-origem: linhas 3
    3: // (regra 1 do M06). Opções da árvore TBOPCOES levantadas no preparo (catalogo-legado.json, pc):

## packages/contratos/src/permissoes/pessoas-ponto.ts  (só comentário)
- nome-origem: linhas 4
    4: // Opções do Ponto eletrônico (novo) na árvore TBOPCOES (catalogo-legado.json, pc): Importações › AFD (5067) e

## packages/contratos/src/permissoes/pessoas-sesmt.ts  (só comentário)
- nome-origem: linhas 3
    3: // (regra 1 do M06). Opções da árvore TBOPCOES (catalogo-legado.json, pc), módulo "Segurança do trabalho" (554, 582):

## packages/contratos/src/permissoes/pessoas.ts  (só comentário)
- nome-origem: linhas 3,126
    3: // Opções da árvore TBOPCOES (catalogo-legado.json, pc), módulo "Folha de pagamento" (351, 553, 4259):
    126: // §12). Opções do Ponto eletrônico (novo) na árvore TBOPCOES (catalogo-legado.json, pc): Gerenciamento › Programação

## packages/contratos/src/permissoes/portal-medico.ts  (só comentário)
- nome-origem: linhas 6
    6: //   - portal (identidade própria em SGH_SADT_PORTAL_ACESSO, nunca TBUSERS): a SESSÃO DO PORTAL do perfil

## packages/contratos/src/permissoes/portal.ts  (só comentário)
- nome-origem: linhas 4,9
    4: //     permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
    9: //   - portal (identidade própria em SGH_POR_CONTA, nunca TBUSERS): o servidor do portal dá à SESSÃO DO PORTAL os perfis

## packages/contratos/src/permissoes/portaria.ts  (só comentário)
- nome-origem: linhas 2
    2: // novo (regra 1 do M06). Opções do módulo "Controle de acesso" (35) do outro sistema (TBOPCOES, retrato

## packages/contratos/src/permissoes/precos.ts  (só comentário)
- nome-origem: linhas 3
    3: // da árvore TBOPCOES do módulo Tabelas › Convênios (Consultar 6307, Alterar 3567, Excluir 3569, Gerenciamento

## packages/contratos/src/permissoes/protocolo-gerenciado.ts  (só comentário)
- nome-origem: linhas 3
    3: // árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json). Por isso, como a classificação (etapa 1):

## packages/contratos/src/permissoes/recepcao.ts  (só comentário)
- nome-origem: linhas 2
    2: // opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato

## packages/contratos/src/permissoes/relatorio-integracao.ts  (só comentário)
- nome-origem: linhas 5,7,11
    5: // Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
    7: //     curador e quem configura o envio agendado (TBEDITREL_AGENDA é do editor); Emissão de relatórios v1.0 4241 e
    11: //     (TBEDITREL_GRUUSU, TBEDITREL_TBUSERS) restringe ainda mais na execução (ninguém ganha acesso que não tinha);

## packages/contratos/src/permissoes/repasse.ts  (só comentário)
- nome-origem: linhas 3,146
    3: // outro sistema tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES levantadas no preparo do marco
    146: // usuário com o profissional (TBPROFIS; o filtro é do servidor; sem vínculo, a lista vem vazia; o escopo 'vinculo' do
