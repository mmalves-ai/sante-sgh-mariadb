# Fatia F2.4 17-misto-internacao (assunto: internacao+repasse+config; cliente de teste próprio: f24_17mistointernacao)

## apps/api/src/modulos/internacao/fonte-propria.ts
- vocab-antigo: linhas 93
    93: /** Data civil à meia-noite UTC (a forma do contrato do movimento) e a hora "HHMM", no fuso do estabelecimento. */

## apps/api/src/modulos/internacao/leitos.controller.ts
- nome-origem: linhas 292
    292: tabelaAlvo: 'RICADINT',

## packages/contratos/src/internacao/adt-respostas.ts  (só comentário)
- nome-origem: linhas 319
    319: * Na fila de quem só executa: o profissional ligado ao login (CHPROFISLIMP.USUARIO_SISTEMA). A etapa sai sempre em

## packages/contratos/src/internacao/adt.ts
- vocab-antigo: linhas 18,321
    18: const hhmm = z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/, 'Hora no formato HHMM (quatro dígitos).');
    321: /** Hora da saída (HHMM) dentro do dia de hoje; sem ela, a hora do banco. */
- nome-origem: linhas 191
    191: * Situação da execução no legado (CHSITUACAO: 1 Alta hospitalar, 2, 3 Em higienização, 4 Liberado). Só 1 e 2 foram

## packages/contratos/src/internacao/digitalizacao.ts  (só comentário)
- nome-origem: linhas 53,55
    53: /** O prontuário (RICADPAC.PRONT) do paciente; o servidor confere e tira o paciente dele. */
    55: /** A internação (RICADINT.REG) quando o papel é de uma internação; null = documento do prontuário. */

## packages/contratos/src/internacao/movimento.ts
- vocab-antigo: linhas 3
    3: // meia-noite UTC (o processo roda em TZ=UTC e o banco guarda a data sem fuso) e as horas como texto "HHMM",

## packages/dominio-internacao/src/painel.ts
- vocab-antigo: linhas 60
    60: readonly destino: 'legado' | 'memoria';
- nome-origem: linhas 21
    21: /** RILEITOS.STATUS: 'I' inativo; vazio ou 'A' ativo (como o legado trata). */

## packages/dominio-internacao/src/tempo.ts
- vocab-antigo: linhas 1,9,20
    1: // Tempo do movimento (M16): o legado guarda a data sem fuso e a hora como texto "HHMM". O motor trabalha com o
    9: /** "HHMM" (ou "HH:MM") → minutos do dia; vazio ou inválido → 0 (meia-noite, como o legado lê). */
    20: /** Data de calendário (meia-noite UTC) + hora "HHMM" → instante do relógio de parede (ms). */

## apps/api/src/modulos/repasse/porta-memoria.ts  (só comentário)
- nome-origem: linhas 60
    60: /** Médicos sintéticos: o código do prestador → o registro (TBCBOPRO.ID). */

## apps/api/src/modulos/repasse/porta-propria.ts
- modelo-pendente: linhas 606
    606: throw recusa('modelo-pendente', 'A regra de repasse por profissional ainda não pode ser incluída (aguarda o modelo).');

## apps/api/src/modulos/repasse/servico.ts  (só comentário)
- nome-origem: linhas 756
    756: /** O registro (TBCBOPRO.ID) do médico pelo código do prestador. */

## packages/contratos/src/repasse/entradas.ts  (só comentário)
- nome-origem: linhas 23,96,113,115,126,154,179
    23: /** Profissional (TBCBOPRO) ou prestador; null: qualquer um. */
    96: * repasse.lancarEvento: o lançamento do repasse em RPLANEVE (+ o vínculo do médico em RPLANEVE_TBCBOPRO). Origem:
    113: /** Código do prestador (TBCBOPRO.COD do médico; o da empresa médica no tipo E). */
    115: /** Registro do médico (TBCBOPRO.ID; obrigatório no tipo M: o vínculo RPLANEVE_TBCBOPRO). */
    126: /** Lançamento original (RPLANEVE.ID_RPLANEVE) na origem `estorno`. */
    154: /** repasse.incluirRegra: a versão aprovada incluída em TBREPGER (+ TBREPGER_TBCBOPRO), só pelo servidor. */
    179: /** repasse.integrarItens: os itens do período com o valor do motor (FCINTEGRPA), ligados ao lançamento da apuração. */

## packages/contratos/src/repasse/modelo.ts
- vocab-antigo: linhas 32,50
    32: /** Janela de horário HHMM (TBREPGER.HORA_INI/HORA_FIN; no pc todas 0000–2359). */
    50: /** Data e hora da realização (AAAA-MM-DD e HHMM). */
- nome-origem: linhas 2,7,9,12,15,32,42,46,48,73,75,77
    2: // (@sgh/legado, repasse/repositorios) os entrega: TBREPGER, TBREPGER_TBCBOPRO e FCLANEXT traduzidos, com o "0" do outro
    7: /** TBREPGER.ID (ou o ID da versão em rascunho, negativo, no simulador). */
    9: /** Início da vigência (TBREPGER.DATA), AAAA-MM-DD. */
    12: /** Profissional do vínculo (TBREPGER_TBCBOPRO.ID_TBCBOPRO), casado com o executante do item; null: qualquer. */
    15: * Código do prestador (TBREPGER.COD; 103.957 regras com COD e 98.406 com vínculo no pc). Só informativo: o motor casa
    32: /** Janela de horário HHMM (TBREPGER.HORA_INI/HORA_FIN; no pc todas 0000–2359). */
    42: /** Evento de RPA (TBREPGER.ID_RPEVENTOS). */
    46: /** Item faturado com o executante (FCLANEXT + FCCTAEXT; regra 5). */
    48: /** FCLANEXT.ID. */
    73: /** Linha da apuração gravada pelo outro sistema (FCINTEGRPA, valor faturado com valor), para o teste dourado. */
    75: /** FCLANEXT.ID. */
    77: /** TBREPGER.ID; null quando a linha não guarda a regra. */

## packages/contratos/src/repasse/respostas.ts  (só comentário)
- nome-origem: linhas 55,181,207
    55: /** TBREPGER.ID depois da inclusão aprovada. */
    181: /** Título a pagar que nasceu com o RPA (MFCONPAG.ID). */
    207: /** Adiantamentos ao médico (MFADIFOR M; só consulta: regra 11). */

## packages/contratos/src/repasse/vocabulario.ts  (só comentário)
- nome-origem: linhas 4,16,22,27,28,34
    4: /** Tipo de prestador do repasse (RPTIPOPRESTADOR.COD; 6 linhas no pc). */
    16: * Tipo de credor do título a pagar que nasce do repasse (MFCONPAG.TIPO com ONDE='R'; ref 01 §2.5): M (médico,
    22: /** Beneficiário da regra (TBREPGER.MED_PRS): médico ou prestador. */
    27: * Tipo de conta da regra (TBREPGER.TIPO_CTA): A 756, E 38.525, I 66.149 regras no pc. A conta só tem E e I
    28: * (FCCTAEXT); "A" é lido como "as duas" (vale para qualquer conta), a confirmar no teste dourado.
    34: * Valor do item que a apuração integrou (FCINTEGRPA.ID_TBTIPOLANCVLR → TBTIPOLANCVLR). No pc: 6.016 linhas de valor

## packages/dominio-repasse/src/adicionais.ts  (só comentário)
- nome-origem: linhas 1
    1: // Regra 6 do M33: adicionais de feriado e de fim de semana da regra (TBREPGER.PERC_FERIADO e PERC_FIM_SEMANA). Sem

## packages/dominio-repasse/src/apuracao.ts  (só comentário)
- nome-origem: linhas 3
    3: // aberta. Uma apuração por período e empresa num só sistema: se o outro sistema já apurou (FCINTEGRPA ou RPLANEVE no

## packages/dominio-repasse/src/calculo.ts  (só comentário)
- nome-origem: linhas 95
    95: /** Itens já integrados (FCINTEGRPA) não entram de novo (ficha, seção 5, repasse.integrarItens). */

## packages/dominio-repasse/src/credor.ts  (só comentário)
- nome-origem: linhas 1,2,26
    1: // Regra 8 do M33: tipo de credor do título que nasce do repasse (MFCONPAG.TIPO com ONDE='R'; ref 01 §2.5). M: médico
    2: // pessoa física, exige o vínculo com o profissional (TBCBOPRO) e recebe RPA. E: empresa médica e cooperativa, recebem
    26: /** Lançamento já em RPA (RPLANRPA) não entra em outro RPA (cenário recusa-ja-em-rpa). */

## packages/dominio-repasse/src/dinheiro.ts  (só comentário)
- nome-origem: linhas 2
    2: // em NUMERIC(15,2): metade para longe do zero. Percentuais com 4 casas (TBREPGER.PERC é NUMERIC(6,4)).

## packages/dominio-repasse/src/dourado.ts  (só comentário)
- nome-origem: linhas 2
    2: // (FCINTEGRPA, valor faturado com valor: 3.914 itens, R$ 508.581,47 no pc) e compara item a item com o gravado; cada

## packages/dominio-repasse/src/rpa.ts  (só comentário)
- nome-origem: linhas 2,76
    2: // entre as empresas que somam impostos (RPEMPCALCIMP); IRRF pela tabela progressiva vigente sobre o bruto menos o
    76: /** Base de INSS já usada no mês nas outras empresas que somam impostos (RPEMPCALCIMP). */

## packages/dominio-repasse/src/versao-regra.ts  (só comentário)
- nome-origem: linhas 3
    3: // incluída em TBREPGER (incluir antes faria o outro sistema já usá-la). Recusada não volta.

## apps/api/src/modulos/config/parametros.controller.ts  (só comentário)
- nome-origem: linhas 66
    66: // Empresa (TBEMPHOS) da sessão: o M10 liga; até lá o nível empresa não se aplica à pessoa.

## packages/dominio-config/src/dominio/declaracao.ts  (só comentário)
- nome-origem: linhas 101,119
    101: // M14: a enumeração interna pode vir de `migrar-leitura` (TBDIASEMANA: a matriz manda só ler).
    119: // M51.4: tabela sem PK no catálogo (FHLEITOUTI): a chave é a coluna gerada pelo trigger BI e a declaração diz o

## packages/dominio-config/src/dominio/exportar.ts  (só comentário)
- nome-origem: linhas 2
    2: // exige a justificativa de PRTIPO_JUSTIF_EXPORTACAO (4 justificativas do legado, domínio de auditoria).

## packages/dominio-config/src/fim-coexistencia/usuarios-restantes.ts  (só comentário)
- nome-origem: linhas 20,22
    20: /** TBUSERS.STATUS ('T' ativo). */
    22: /** TBUSERS.BLOQUEADO ('T' bloqueado; 'F' ou nulo, livre). */

## packages/dominio-config/src/homologacao/homologacao.ts  (só comentário)
- nome-origem: linhas 268
    268: /** Tabelas gravadas e a ação (`SIPACAGD (INSERT)`), para a TI localizar o que abrir. */

## packages/dominio-config/src/parametros/vigencia.ts  (só comentário)
- nome-origem: linhas 66
    66: // Unidade (TBUNIDAD.COD) e empresa (TBEMPHOS.COD) são SMALLINT no legado: alvo tem de ser o código.
