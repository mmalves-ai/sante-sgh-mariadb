# Fatia F2.4 22-misto-sadt (assunto: sadt+permissoes-2+manutencao+tiss+patrimonio+raiz-api; cliente de teste próprio: f24_22mistosadt)

## apps/api/src/modulos/sadt/aplicacao/vigia-criticos.ts
- modelo-pendente: linhas 8
    8: // 409 modelo-pendente. A falha é isolada por exame: o escalonamento dos avisos existentes segue, o cursor não avança

## apps/api/src/modulos/sadt/porta-propria.ts
- modelo-pendente: linhas 115
    115: 'modelo-pendente',

## packages/contratos/src/sadt/entradas.ts  (só comentário)
- nome-origem: linhas 2,11
    2: // Vocabulário do novo: o exame é o ID do exame lançado (SILANEXA.ID) com a chave natural de 7 colunas lida pela tela
    11: /** ID do legado em DOUBLE PRECISION (SILANEXA.ID, SIRES01.ID): inteiro seguro. */

## packages/contratos/src/sadt/transfusao.ts  (só comentário)
- nome-origem: linhas 259,316
    259: /** Item de hemoterapia da prescrição (PRPRESCHEMO.ID). */
    316: /** Horário de checagem do item no outro sistema (PRCHKGERAL.ID), quando nasceu. */

## packages/contratos/src/sadt/vocabulario.ts  (só comentário)
- nome-origem: linhas 24
    24: /** Atos do legado (SILANEXA.ATO; Anexo A §A.1) com o rótulo de produto e o setor. */

## packages/dominio-sadt/src/transfusao/ato-transfusional.ts  (só comentário)
- nome-origem: linhas 84
    84: /** Situação do horário no outro sistema (PRCHKGERAL), quando nasceu; null = o item não tem horário. */

## packages/contratos/src/permissoes/rouparia.ts  (só comentário)
- nome-origem: linhas 3
    3: // (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json): Painel de leitos 5012, Gerenciar limpeza 5014 e

## packages/contratos/src/permissoes/sadt.ts  (só comentário)
- nome-origem: linhas 3
    3: // TBOPCOES do módulo S.A.D.T. (9) (retrato tools/verificadores/dados/acesso-legado.pc.json):

## packages/contratos/src/permissoes/sessoes-digitalizacao.ts  (só comentário)
- nome-origem: linhas 2,7
    2: // legado tem a permissão no novo (regra 1 do M06). Opções do outro sistema (TBOPCOES, retrato
    7: //     quimioterapia do outro sistema é a das cadeiras (AGCADEIRA): a agenda de sessões é a mesma ideia, para qualquer

## packages/contratos/src/permissoes/sistema.ts  (só comentário)
- nome-origem: linhas 2
    2: // só do novo, sem opção em TBOPCOES: concedidos por perfil (ficha do M06, regra 3) ao Administrador do

## packages/contratos/src/permissoes/suprimentos.ts
- nome-origem: linhas 2,24,26,128,145
    2: // tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES do módulo Gestão de estoque (1) (retrato
    24: // As flags do usuário do estoque (GEUSERS) concedem as ações de alçada: autorizar requisição (AUT_REQ), autorizar pedido
    26: // locais por tipo de movimento (GELOCUSU) são escopo (`localEstoque`), conferido no servidor.
    128: const flag = (coluna: string): FlagLegado => ({ tabela: 'GEUSERS', coluna });
    145: // Os escopos do módulo (ESCOPOS_DO_MODULO): o local de estoque (GELOCUSU) e o centro de custo do requisitante.

## packages/contratos/src/permissoes/tipos.ts
- nome-origem: linhas 38,46,48
    38: readonly tabela: 'TBUSUCPL' | 'GEUSERS' | 'FCPARUSU';
    46: /** Opções de TBOPCOES que concedem a permissão (cap-08 §8.6). Vazio = recurso só do novo. */
    48: /** Flags de TBUSUCPL, GEUSERS ou FCPARUSU que também concedem. */

## apps/api/src/modulos/manutencao/porta-propria.ts
- modelo-pendente: linhas 30,174
    30: // código `modelo-pendente` (nada é gravado pela metade) e as leituras devolvem vazio.
    174: 'modelo-pendente',

## apps/web/src/modulos/manutencao/comum-manutencao.ts
- vocab-antigo: linhas 104
    104: // O SanteHora entrega HHMM (4 dígitos, o modelo da hora legada); HH:MM também vale.

## packages/contratos/src/manutencao/entradas.ts  (só comentário)
- nome-origem: linhas 89,156
    89: /** Unidade (TBUNIDAD.COD) e setor (TBCENCUS.COD) onde o equipamento fica. */
    156: /** Setor do solicitante (TBCENCUS.COD); o servidor confere contra os centros de custo do usuário. */

## apps/api/src/modulos/tiss/acompanhamento.ts
- nome-origem: linhas 72,180
    72: * As contas bancárias do escopo da sessão para o movimento (regra 15 do M32, MFCTAUSU): só com a leitura do
    180: rotulo: conferirCodigoOnda4('MFLANCTO.TIPO_TRF', m.tipo, []).legenda,

## apps/api/src/modulos/tiss/porta-propria.ts
- modelo-pendente: linhas 1400
    1400: 'modelo-pendente',

## apps/api/src/modulos/tiss/simulador.ts  (só comentário)
- nome-origem: linhas 17
    17: /** TBTISSSITPROT: 1 recebido. */

## apps/api/src/modulos/patrimonio/porta-propria.ts
- modelo-pendente: linhas 20,144
    20: // `modelo-pendente` (nada é gravado pela metade) e as leituras devolvem vazio.
    144: 'modelo-pendente',

## packages/contratos/src/patrimonio/patrimonio.ts  (só comentário)
- nome-origem: linhas 56,128,130,133,151,155,166,178,350,360,567,569,571
    56: /** Origem "Doação" no domínio de origens do patrimônio do banco (GPORIGEM; 5 linhas no pc em 24/10/2026). */
    128: /** GPORIGEM.ID. */
    130: /** TBCENCUS.ID (onde o bem fica). */
    133: /** GPTP_RESPONSAVEL.ID. */
    151: /** GPCOEFICIENTE_DEPREC.ID (turnos de uso); null: um turno. */
    155: /** Sem ela, a marca da origem (GPORIGEM.DEPRECIAR). */
    166: /** GECADNFS.ID e GELANNFS.ID_GELANNFS. */
    178: /** Empresa (TBEMPHOS) que recebe a doação. */
    350: /** TBCENCUS.ID; null: o estabelecimento inteiro. */
    360: /** TBCENCUS.ID do setor onde a leitura é feita. */
    567: /** GPPARAMG.DEPRECIAR: a empresa deprecia os bens. */
    569: /** GPPARAMG.APLICAR_COEFICIENTE: aplica o coeficiente por turno. */

## packages/dominio-patrimonio/src/depreciacao.ts  (só comentário)
- nome-origem: linhas 2
    2: // (GPCOEFICIENTE_DEPREC: 1 turno 1,0; 2 turnos 1,5; 3 turnos 2,0 no pc) quando o parâmetro da empresa manda aplicar, e

## packages/dominio-patrimonio/src/movimento.ts  (só comentário)
- nome-origem: linhas 119
    119: /** O setor (TBCENCUS.ID) que recebe; só a transferência tem. */

## packages/dominio-patrimonio/src/origem.ts  (só comentário)
- nome-origem: linhas 22,31,35
    22: /** GECADNFS.ID da nota do item. */
    31: /** Origens do banco (GPORIGEM): id → deprecia. */
    35: /** Centros de custo ativos (TBCENCUS.ID). */

## apps/api/src/autorizacao/catalogo.ts  (só comentário)
- nome-origem: linhas 9
    9: /** Flags do legado que alguma permissão declara (só elas são lidas de TBUSUCPL, GEUSERS e FCPARUSU). */

## apps/api/src/versao.ts
- vocab-antigo: linhas 19
    19: * Identificação rastreável (cap-14 §14.10): `<versão>+<commit>` ou, sem git, `<versão>+build.<AAAAMMDDHHMMSS>`.
