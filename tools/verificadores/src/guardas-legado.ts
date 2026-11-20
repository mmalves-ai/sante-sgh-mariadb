// pnpm guardas:legado (ficha do M04, seção 1; convencoes.md §3, §5 e §8; regras 1, 4 e 10): recusa, no código
// versionado,
//   (a) nome de tabela do SPDATA (lista do legado:tipos) em SQL fora de packages/legado, e qualquer SQL em apps/*;
//   (b) INSERT, UPDATE, DELETE, MERGE ou EXECUTE PROCEDURE fora de gravacao/, do executor e da massa
//       sintética de packages/testes;
//   (c) DDL (CREATE, ALTER, DROP, RECREATE, GRANT, REVOKE, COMMENT) sobre objeto sem o prefixo SGH_;
//   (d) CREATE TRIGGER (em tabela legada ou SGH_: tabelas novas não têm trigger);
//   (e) REFERENCES de SGH_ para tabela legada;
//   (f) MAX(ID)+1 ou equivalente;
//   (g) UPPER(, TRIM( ou LOWER( sobre coluna que abre índice no WHERE (lista do legado:tipos);
//   (M56, regra 4) qualquer SQL sobre os registros fictícios de beneficiário (PSBENEFI e os outros 5);
// e, das pendências do M02 e do M09: GEN_ID com passo e NEXT VALUE FOR fora do executor, procedimento
// selecionável com efeito colateral em FROM, e as colunas de credencial de TBTISS, TBTISSWEBSERV e TBCONVEN
// (colunas-proibidas.ts, incorporada aqui). Exceções revisadas, cada uma com o motivo, em EXCECOES.
// Fixtures: tools/verificadores/src/__fixtures__/guardas/ (uma por padrão proibido; `--arquivo=` roda uma só,
// no caminho que a primeira linha `// guarda-caminho: <caminho>` declara, e o comando tem de falhar).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { procurarColunasProibidas } from './colunas-proibidas.ts';

export type Regra =
  | 'a-tabela-legada-fora'
  | 'b-escrita-fora'
  | 'c-ddl-fora-sgh'
  | 'd-trigger'
  | 'e-fk-legada'
  | 'f-max-mais-um'
  | 'g-funcao-em-indice'
  | 'generator-fora'
  | 'procedimento-com-efeito'
  | 'coluna-credencial'
  | 'tbtabthm-escrita'
  | 'catalogo-delete'
  | 'beneficiario-ficticio';

export interface Achado {
  readonly arquivo: string;
  readonly linha: number;
  readonly regra: Regra;
  readonly detalhe: string;
}

export interface Listas {
  readonly tabelas: ReadonlySet<string>;
  readonly indexadas: Readonly<Record<string, readonly string[]>>;
  readonly procedimentos: Readonly<Record<string, { readonly efeito: boolean }>>;
  /** M13: tabelas dos catálogos oficiais (marcos.yaml, M13) e as de mat/med que os importadores gravam. */
  readonly catalogo?: ReadonlySet<string>;
}

/** Exceções revisadas (arquivo, regra e motivo). */
export const EXCECOES: readonly {
  readonly arquivo: RegExp;
  readonly regras: readonly Regra[];
  readonly motivo: string;
}[] = [
  {
    arquivo:
      /^(packages\/legado\/src\/copia\/(ddl|bombeamento)-utf8(\.spec)?\.ts|tools\/schema-check\/src\/ensaio-utf8-(converter|md)(\.spec)?\.ts)$/,
    regras: ['c-ddl-fora-sgh', 'd-trigger', 'b-escrita-fora'],
    motivo:
      'M58.3: ensaio da conversão para UTF-8 (regra 4 da Fase 7, exceção nominal; ADR 0032): a estrutura e a carga vão só ao banco convertido descartável do servidor de ensaio (*-utf8.fdb na porta do ensaio, conferirDestinoConvertido), nunca às cópias de dev nem à produção; os testes usam DDL sintética',
  },
  {
    arquivo: /^infra\/firebird\/conta-dev\.sql$/,
    regras: ['c-ddl-fora-sgh', 'a-tabela-legada-fora'],
    motivo: 'M02: script de privilégio executado por pessoa (só GRANT SELECT para a conta de dev; DP-15)',
  },
  {
    arquivo:
      /^(?:packages\/dominio-acesso\/src\/contas\/privilegio-minimo(?:\.spec)?\.ts|infra\/firebird\/fase7\/privilegios\/.+\.sql)$/,
    regras: ['c-ddl-fora-sgh', 'a-tabela-legada-fora'],
    motivo:
      'M59-F1 (regra 4; ficha, seções 6 e 11): gerador puro e scripts de GRANT e REVOKE do privilégio mínimo por módulo e da revogação das contas técnicas, executados pela TI com autorização do dono por passo (isql, fora da aplicação); nenhuma tabela, coluna ou procedure é criada ou alterada',
  },
  {
    arquivo: /^packages\/legado\/src\/acesso\/privilegios\/varredura\.spec\.ts$/,
    regras: ['c-ddl-fora-sgh'],
    motivo:
      'M59-F1: teste de unidade da varredura do alcance; o texto com CREATE SEQUENCE é a entrada sintética do leitor de generators (nunca vai ao banco)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/privilegio-modulo\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora', 'c-ddl-fora-sgh', 'g-funcao-em-indice'],
    motivo:
      'M59-F1 (regra 4; ficha, seção 10): prova na cópia que o papel do módulo lê e grava só o que o plano dá: leituras de PRTERMOCAD e PRTERMOACEITE e um UPDATE na trilha que o banco tem de RECUSAR (sem privilégio), numa transação desfeita; a DDL é o DROP ROLE da limpeza dos papéis efêmeros do teste, pelo isql',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/imutabilidade-clinica\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora', 'c-ddl-fora-sgh'],
    motivo:
      'M59-F3 (regra 6; ficha, seção 10): prova na cópia que o DELETE em tabela clínica é RECUSADO pelo banco ao papel do pep (WHERE 1 = 0, transação desfeita) e ensaia o par 0002 com uma conta efêmera (GRANT, REVOKE e DROP USER da limpeza, pelo isql); nenhuma tabela, coluna ou procedure é criada ou alterada',
  },
  {
    arquivo:
      /^(docs\/implantacao\/anexos\/privilegios-papel\.sql|tools\/implantacao\/src\/privilegios(\.spec)?\.ts)$/,
    regras: ['c-ddl-fora-sgh', 'a-tabela-legada-fora'],
    motivo:
      'M60.3: anexo C do manual (e o gerador com o teste), executado pela TI como administrador do banco: só GRANT ao papel SGH_APLICACAO das tabelas gravadas pelas receitas (gerado e conferido por implantacao:listas; D-PRIVILEGIOS-60.3)',
  },
  {
    arquivo: /^packages\/dominio-relatorio\/src\/datamart\.ts$/,
    regras: ['c-ddl-fora-sgh'],
    motivo:
      'M16: DDL do data mart pseudonimizado em SQLite, um arquivo fora do banco do estabelecimento (ADR 0025); nunca vai ao Firebird',
  },
  {
    arquivo: /^tools\/verificadores\/src\/datamart-carga\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M16/M57 (etapa 3): INSERT nos arquivos SQLite do data mart (de cada estabelecimento e o da Rede), fora de qualquer banco do estabelecimento (ADR 0025 e 0030); a leitura da cópia é READ ONLY',
  },
  {
    arquivo: /^tools\/verificadores\/src\/lgpd\/datamart-sem-dado-pessoal\.spec\.ts$/,
    regras: ['c-ddl-fora-sgh'],
    motivo:
      'M57 (etapa 3, regra 9): o teste cria, num SQLite descartável, um arquivo de estabelecimento com coluna identificadora para provar que o arquivo da Rede não a copia; nunca vai ao Firebird',
  },
  {
    arquivo: /^tools\/verificadores\/src\/treino(?:\.spec)?\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M37 (regra 5): mascaramento e neutralização do banco de TREINO por isql no container de treino do projeto (redesante-fb-treino-<cod>, AMBIENTE=treino), administrador, só com o método registrado pelo dono (DP-41); nunca a cópia de dev nem produção',
  },
  {
    arquivo: /^packages\/legado\/src\/copia\//,
    regras: ['b-escrita-fora'],
    motivo:
      'M01: ferramentas de cópia (neutralização dos destinos externos e prova dos triggers, sempre desfeita), por isql no container da cópia, administrador',
  },
  {
    arquivo: /^packages\/legado\/src\/nucleo\/sgh\/sgh-aplicar\.spec\.ts$/,
    regras: ['c-ddl-fora-sgh', 'd-trigger', 'e-fk-legada'],
    motivo:
      'M04: comandos proibidos que o teste confere que o aplicador de scripts SGH_ RECUSA (nunca executados)',
  },
  {
    arquivo: /^packages\/testes\/src\/massa\//,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M04: massa sintética (ficha: packages/testes), que consulta a cópia na transação desfeita da reprodução para achar CPF, login e CEP livres; M06: e grava, sempre na transação desfeita (nunca confirmada), fora do executor, três ligações do usuário sintético: UPDATE TBUSERS SET GRUPO (grupoSintetico), INSERT INTO TBUSERS_TBPAPEL (papelSintetico) e INSERT INTO TBUNIUSE (unidadeSintetica); desvio registrado nas evidências do M06',
  },
  {
    arquivo: /^apps\/worker\/src\/contabil\/fatos\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M54.1 (ficha, regra 1: o teste é este arquivo): a integração na cópia grava "por fora" (como o outro sistema) a alteração de um título a pagar e conta as linhas SGH_CTB_*, sempre em desfazendoNaCopia (ROLLBACK; nunca confirmada) e sob a trava da cópia',
  },
  {
    arquivo: /^packages\/legado\/src\/internacao\/sgh\/nir-crud\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'W0-07 (critério 3, recusa de órfão): para simular a reserva já convertida em internação, o teste marca REG_CONSUMO numa reserva SINTÉTICA da tabela nova SGH_INT_RESERVA_LEITO (nenhuma tabela do legado), sempre em desfazendoNaCopia (ROLLBACK; nunca confirmada) e sob a trava da cópia; a conversão real (internar) gravaria no legado',
  },
  {
    arquivo: /^apps\/worker\/src\/contabil\/dourado\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M54.1 (correção da revisão; preparo §1.8: o dourado na cópia com ROLLBACK): grava contas SINTÉTICAS (990101, 990102) no nível do convênio de três linhas do de-para da exportação (UPDATE TBINTCRC SET CTA_CONTABIL), lido pela leitura do @sgh/legado (deParaDaExportacao), sempre em desfazendoNaCopia (ROLLBACK; nunca confirmada) e sob a trava da cópia; a contagem das linhas com conta antes e depois prova que nada fica',
  },
  {
    arquivo: /^packages\/legado\/src\/nucleo\/transacao\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M02: rótulo da guarda de leitura, que RECUSA EXECUTE PROCEDURE no caminho de leitura (não é SQL)',
  },
  {
    arquivo: /^packages\/legado\/src\/assinatura\/(cenarios|captura)\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M03: cenário sintético da ferramenta de assinatura (uma linha fictícia, transação sempre desfeita) e SAVEPOINT da captura',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/prontuario-diario\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M23: conferência do gravado pelo executor na transação desfeita (COUNT(*) das tabelas gravadas e a ligação da linha ao paciente, só SELECT); nenhuma escrita',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m48-e2-sugestao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M48.2: só LEITURA (COUNT(*) da PRCHKGERAL e da SGH_PEP_CHECAGEM_EXT antes e depois, para conferir o ROLLBACK); a marcação "por fora" fica na massa sintética (packages/testes/src/massa/checagem-outro-sistema.ts), na transação desfeita',
  },
  // W1-01 (revisões 2 e 3): provas de CHECK e de índice único das tabelas SGH_ do acesso.
  {
    arquivo:
      /^packages\/legado\/src\/acesso\/(?:pedido-acesso|pin|provisionamento-rh|recertificacao)\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'W1-01: prova de que o banco RECUSA a escrita fora da regra (CHECK de situação e índice único) em SGH_ACESSO_PEDIDO, SGH_ACESSO_PIN, SGH_ACESSO_RH_TAREFA e SGH_ACESSO_RECERT_ITEM; só tabelas SGH_, na transação SEMPRE desfeita da cópia; nenhum objeto do legado',
  },
  {
    arquivo: /^tools\/verificadores\/src\/privilegios\.spec\.ts$/,
    regras: ['c-ddl-fora-sgh'],
    motivo:
      'W1-01 (revisão 3): o teste só confere o TEXTO do GRANT gerado para o papel SGH_MOD_ACESSO no script da fase 7; não executa DDL',
  },
  // Testes de integração: as regras valem para eles (executam o SQL na cópia); exceção nominal, arquivo a
  // arquivo, com o motivo (revisão do M04).
  {
    arquivo:
      /^(?:packages\/testes\/src\/integracao\/(?:executor|idempotencia)\.int\.spec\.ts|tools\/assinatura\/src\/integracao\/(?:assinatura|captura-controlada)\.int\.spec\.ts)$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M03/M04: conferência por COUNT(*) das linhas que a operação gravou (ou não), na transação desfeita ou em READ ONLY; nenhuma escrita (M36: também a captura controlada com o escritor legado simulado, cuja escrita fica em @sgh/legado)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/trilha\.int\.spec\.ts$/,
    regras: ['b-escrita-fora', 'generator-fora'],
    motivo:
      'M04: prova de que o banco RECUSA UPDATE e DELETE em SGH_TRILHA para o papel da aplicação; INSERT sintético (HOSPITAL zz) desfeito; NEXT VALUE FOR da sequência SGH_GEN_TRILHA (SGH_, não do legado)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m60-e1-migracao\.int\.spec\.ts$/,
    regras: ['b-escrita-fora', 'c-ddl-fora-sgh'],
    motivo:
      'M60.1: prova de que o Firebird aceita o DDL de um script SGH_ (SGH_M60_PROVA_TX) e o INSERT do registro em SGH_VERSAO_SCRIPT na mesma transação, SEMPRE desfeita (desfazendoNaCopia); nenhum objeto do legado',
  },
  {
    arquivo: /^tools\/implantacao\/src\/ensaio-relatorio\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M60.1: o ensaio da primeira aplicação simula o sistema anterior em uso com um UPDATE da chave no mesmo valor, SEMPRE desfeito (ROLLBACK), só na cópia limpa descartável da porta própria (nunca nas compartilhadas nem em produção), em tabela legada sem trigger e sem FK',
  },
  // M52.4 (regra 11): a marcação original só de inclusão, provada com o papel da aplicação.
  {
    arquivo: /^packages\/testes\/src\/integracao\/ponto-marcacao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora', 'generator-fora'],
    motivo:
      'M52.4: prova de que o banco RECUSA UPDATE e DELETE em SGH_PES_MARCACAO, SGH_PES_AFD_ARQUIVO, SGH_PES_PONTO_FECHAMENTO e SGH_PES_BANCO_HORAS (e o DELETE em SGH_PES_PONTO_AJUSTE) para o papel da aplicação; INSERT sintético (HOSPITAL zz) em tabelas SGH_ desfeito; NEXT VALUE FOR de sequências SGH_ (não do legado)',
  },
  // M06 (revisão por arquivo, como no M04).
  {
    arquivo: /^packages\/testes\/src\/integracao\/trilha-cadeia\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M06: leitura (SELECT) do cabeçalho e do detalhe da trilha do legado que a operação gravou, na transação desfeita e, depois, por contagem READ ONLY; UPDATE/DELETE só em SGH_TRILHA para provar que um evento alterado quebra a cadeia (transação desfeita) e que o papel da aplicação os recusa',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/matriz-autorizacao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M06: contagem (COUNT) de TBPERUSU por grupo para conferir as opções efetivas lidas; nenhuma escrita',
  },
  // M08 (revisão por arquivo, como no M04 e no M06).
  {
    arquivo: /^packages\/testes\/src\/integracao\/dominios\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M08: prova do LOCK TIMEOUT — uma segunda conexão segura a linha de TBRELIG por SELECT … WITH LOCK numa transação de escrita SEMPRE desfeita, para o executor receber "registro em edição"; nenhuma escrita',
  },
  // M17 (revisão por arquivo, como no M04 a M14).
  {
    arquivo: /^packages\/testes\/src\/integracao\/agenda\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M17: retrato das tabelas da agenda fora da transação (MAX da chave e COUNT) para provar que o ROLLBACK deixou tudo igual, a contagem dos horários vagos na transação desfeita e a trava de uma agenda por SELECT … WITH LOCK numa transação SEMPRE desfeita, para o executor receber "registro em edição"; nenhuma escrita fora do executor',
  },
  // M50 (etapa 2; revisão por arquivo, como no M17).
  {
    arquivo: /^packages\/testes\/src\/integracao\/colisao-portal\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M50 (regra 3): retrato das tabelas da agenda fora da transação (MAX da chave e COUNT) para provar que o ROLLBACK deixou tudo igual depois da colisão do portal com o outro sistema; nenhuma escrita fora do executor (o outro sistema é o escritor legado simulado da massa do M39)',
  },
  // M19 (revisão por arquivo, como no M04 a M17).
  {
    arquivo: /^packages\/testes\/src\/integracao\/recepcao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M19: retrato das tabelas da recepção fora da transação (MAX da chave e COUNT) para provar que o ROLLBACK deixou tudo igual, e as leituras na transação desfeita (os números do dia, a senha seguinte da fila, as linhas do fluxo, um par de encaminhamento e um atendimento sem senha) e a trava de uma senha por SELECT … WITH LOCK numa segunda conexão SEMPRE desfeita, para a chamada sem espera passar à seguinte; a escrita do outro sistema simulado está na massa (reproducao-recepcao.ts); nenhuma escrita aqui',
  },
  // M32 (revisão por arquivo, como no M04 a M31).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m32\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M32: retrato dos títulos, do movimento, dos borderôs, da SGH_OUTBOX e das tabelas SGH_FIN_ fora da transação (contagens) para provar que o ROLLBACK deixou tudo igual; as leituras da massa na transação desfeita (título a receber em aberto, conta bancária, classificação, título pago, o histórico relido); o escopo de conta do operador sintético (INSERT em MFCTAUSU, como o cadastro de parâmetros) e o outro sistema simulado mexendo no título (UPDATE que só recarimba), ambos na transação SEMPRE desfeita; a trava do título por SELECT … WITH LOCK numa segunda conexão desfeita, para o LOCK TIMEOUT',
  },
  {
    arquivo:
      /^apps\/api\/src\/modulos\/financeiro\/(?:api\/escopo-conta|aplicacao\/titulo-por-competencia)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M32: o esperado calculado à parte no banco (o escopo MFCTAUSU do usuário, a competência com contas sem título, a ligação das contas ao título e a contagem do movimento), em leitura na transação SEMPRE desfeita; as gravações vão pelo executor (a porta do financeiro na transação)',
  },
  // M33 (revisão por arquivo): o extrato e a integração do repasse na cópia.
  {
    arquivo: /^apps\/api\/src\/modulos\/repasse\/(?:api\/extrato|aplicacao\/repasse)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M33: o esperado calculado à parte no banco (o usuário com vínculo ao profissional e o sem vínculo, o médico e o evento com integração contábil, itens ainda não integrados e as contagens de RPA, título e apuração), em leitura na transação SEMPRE desfeita; as gravações no outro sistema vão pelo executor',
  },
  // W0-09 (CRUD completo): integração na cópia do comunicado, perfil/parâmetro, mapa/2FA, coexistência e relatórios.
  {
    arquivo:
      /^apps\/api\/src\/modulos\/(?:acesso\/(?:aplicacao\/comunicado-ciclo|perfil-parametro-ciclo|mapa-2fa-ciclo)|coexistencia\/(?:ciclo|registro)|relatorio\/infra\/(?:catalogo-w0-09|gestao-ciclo))\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'W0-09: contagens das tabelas SGH_ (eventos, trilha, versões) e a escolha de um grupo com usuários ativos em TBUSERS para a prévia do mapa (e de um local em GECONITL/GEVALMEM para as variantes com filtro do catálogo), em leitura na transação SEMPRE desfeita; as gravações vão pela porta (gravarSgh)',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/relatorio\/infra\/gestao-ciclo\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'W0-09: só TENTA marcar como cancelado um pedido SINTÉTICO em SGH_REL_PEDIDO (tabela do novo), na transação SEMPRE desfeita, para provar que o CHECK SGH_CK_REL_PEDIDO_CANCELA recusa o cancelamento sem motivo e o do pedido já respondido (publicado ou recusado); nenhuma escrita em tabela do outro sistema',
  },
  {
    arquivo: /^packages\/legado\/src\/nucleo\/sgh\/sgh-faixa-w0-09\.spec\.ts$/,
    regras: ['c-ddl-fora-sgh'],
    motivo:
      'W0-09: o teste da faixa 1120–1139 confere o TEXTO dos scripts (ALTER TABLE de tabela SGH_ com CHECK SGH_CK_); nada é executado',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/repasse\/aplicacao\/repasse\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M33: só a apuração aprovada SINTÉTICA em SGH_REP_APURACAO (tabela do novo), na transação SEMPRE desfeita, para a receita da apuração gravada conferir o estado; nenhuma escrita em tabela do outro sistema fora do executor',
  },
  // M52.1 (regras 1 e 2 na cópia): o desligamento ligado ao acesso.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/desligar\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M52.1: o esperado calculado à parte no banco (um usuário livre e o operador, um centro de custo ativo, um tipo de rescisão, as contagens de TBUSERS e TBPROFIS e o BLOQUEADO relido), em leitura na transação SEMPRE desfeita; a única escrita direta é a ligação do vínculo SINTÉTICO de SGH_PES_VINCULO ao usuário (tabela do novo), na mesma transação desfeita; o bloqueio vai pelo executor (a porta da gestão de pessoas na transação)',
  },
  // W0-06 (programa CRUD completo, parte 1, na cópia): exclusão do rascunho, cancelamento, anulação e desistência.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/crud-w006\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'W0-06: na transação SEMPRE desfeita, só LEITURA do sistema anterior (um centro de custo ativo e uma unidade, só o código) e as contagens das tabelas SGH_ tocadas; as escritas diretas são só em tabelas do novo: o realizado SINTÉTICO ligado ao plantão (prova da recusa de órfão) e apagado em seguida, e o UPDATE direto da desistência por outra pessoa que o CHECK SGH_CK_PES_PONTO_AJ_OUTRO recusa (prova da trava no banco)',
  },
  // W0-06 (partes 6c e 7c, na cópia): solicitações do autoatendimento e painel de indicadores de pessoas.
  {
    arquivo:
      /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/crud-w006-(?:solicitacoes|indicadores)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'W0-06: na transação SEMPRE desfeita, só LEITURA do sistema anterior (um usuário ativo e um centro de custo, só o código) e as contagens das tabelas SGH_ tocadas; as escritas diretas são só em tabelas do novo (somenteSgh): na 6c, a ligação do vínculo sintético ao login e os UPDATE que o CHECK SGH_CK_PES_SOLIC_QUEM tem de RECUSAR (prova da trava no banco); na 7c, a base de teste do painel num estabelecimento sintético (W06IND, IDs negativos, sem generator) que as leituras reais calculam',
  },
  // M48.1 (regras 1 e 11 na cópia): o anonimato da notificação de incidentes de ponta a ponta.
  {
    arquivo: /^apps\/api\/src\/modulos\/qualidade\/notificacao\.autorizacao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M48.1: só LEITURA na transação SEMPRE desfeita: as colunas de texto das SGH_QUA_*, da SGH_TRILHA e das SGH_CFG_COEX_* (RDB$RELATION_FIELDS) para a busca do login (só contagens), um atendimento aberto de ATCABECATEND (só o ID em memória) e o MAX(ID) da trilha; toda escrita é SGH_ pelas funções do @sgh/legado e pelo serviço da qualidade',
  },
  // M48.2 (regras 1, 4 e 11 na cópia): a análise, o plano, a sugestão e a vigilância de produto de ponta a ponta.
  {
    arquivo: /^apps\/api\/src\/modulos\/qualidade\/seguranca\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M48.2: só LEITURA na transação SEMPRE desfeita: um atendimento aberto de ATCABECATEND e um item com lote de uma saída do estoque (GERASVALSAIDLOTE com GELANSAI), só em memória, as contagens das SGH_QUA_*, o resumo da SGH_QUA_SUGESTAO_RESOLVIDA e o MAX(ID) e as linhas novas da SGH_TRILHA (só contagens); toda escrita é SGH_ pela API com a porta da qualidade na transação',
  },
  // M48.3 (regras 5, 7 e 11 na cópia): a CCIH sobre uma transação desfeita.
  {
    arquivo: /^apps\/api\/src\/modulos\/qualidade\/ccih\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M48.3: só LEITURA na transação SEMPRE desfeita: COUNT(*) das SGH_QUA_* da CCIH e MAX(ID) da SGH_TRILHA, antes e depois, para provar o ROLLBACK e as linhas da trilha (só contagens); toda escrita é SGH_ pelas funções do @sgh/legado e pela API',
  },
  // M48.4 (regras 3, 8 e 11 na cópia): a notificação compulsória sobre uma transação desfeita.
  {
    arquivo: /^apps\/api\/src\/modulos\/qualidade\/agravo\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M48.4: só LEITURA na transação SEMPRE desfeita: COUNT(*) das SGH_QUA_AGRAVO_* e MAX(ID) e COUNT(*) das linhas novas da SGH_TRILHA (só contagens, e a prova de que o CID e o nome não vão à trilha); toda escrita é SGH_ pela API com a porta da notificação compulsória na transação',
  },
  // M48.5 (regras 9, 10 e 11 na cópia): a gestão da qualidade e os envios regulatórios sobre uma transação desfeita.
  {
    arquivo: /^apps\/api\/src\/modulos\/qualidade\/gestao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M48.5: só LEITURA na transação SEMPRE desfeita: COUNT(*) das 10 SGH_QUA_* da etapa e MAX(ID) e COUNT(*) das linhas novas da SGH_TRILHA (só contagens, e a prova de que o relato, o título e o conteúdo marcados não vão à trilha); toda escrita é SGH_ pela API com as portas da gestão e da CCIH na transação',
  },
  // M52.2 (regras 3 e 5 a 8 na cópia, e a regra 7 nas duas cópias): a escala de plantão.
  {
    arquivo:
      /^apps\/api\/src\/modulos\/pessoas\/(?:aplicacao\/escala|infra\/sobreposicao-rede)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M52.2: só LEITURA na transação SEMPRE desfeita para montar a massa (um centro de custo ativo, uma unidade, um registro COREN ativo, só o ID em memória) e conferir a SGH_OUTBOX e a matrícula nula de SGH_PES_VINCULO (tabelas do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelo serviço da escala',
  },
  // M52.5 (regras 16 a 19 na cópia): o SESMT e a segregação do prontuário ocupacional.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/sesmt\/sesmt\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M52.5: só leituras de conferência na transação SEMPRE desfeita (contagens de TBPROFIS, TBUSERS, FPFUNC, STCAT e FPCATFATRISCO antes e depois, um centro de custo ativo, a data do banco, as linhas da SGH_TRILHA e os privilégios do papel); toda gravação vai pela porta do SESMT na transação (só SGH_PES_*)',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/infra\/segregacao-ocupacional\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M52.5 (regra 16): leituras do catálogo do banco (RDB$DEPENDENCIES, RDB$RELATIONS, RDB$TRIGGERS e RDB$USER_PRIVILEGES) em transação só de leitura, para provar que nenhum objeto do outro sistema depende das tabelas do SESMT e que o papel só lê e inclui no prontuário ocupacional',
  },
  // M52.3 (regras 8 a 10 na cópia): troca de plantão, plantão agora, sobreaviso e dimensionamento.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/plantao-agora\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M52.3: só LEITURA na transação SEMPRE desfeita para montar a massa (um centro de custo ativo, uma unidade, dois registros COREN ativos e uma unidade de internação, só o ID e o código em memória) e conferir SGH_PES_PLANTAO, SGH_PES_ESCALA_EVENTO e a SGH_OUTBOX (tabelas do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelos serviços da escala e do plantão',
  },
  // M52.4 (regras 11 a 14 na cópia): o ponto.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/ponto\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M52.4: só LEITURA na transação SEMPRE desfeita para montar a massa (um centro de custo ativo e uma unidade) e conferir a SGH_OUTBOX e as marcações dos arquivos em quarentena (tabelas do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelo serviço do ponto',
  },
  // M52.6 (regras 20 e 21 na cópia): o plantão realizado ao repasse e o autosserviço só do próprio.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/realizado\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M52.6: só LEITURA na transação SEMPRE desfeita para montar a massa (um registro profissional ativo de TBCBOPRO, um centro de custo ativo e uma unidade, só o ID e o código em memória) e conferir a SGH_PES_PLANTAO_REALIZADO (tabela do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelo serviço do realizado',
  },
  // M53.1 (regras 3 a 6 na cópia): a interface com a folha externa só grava em SGH_.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/folha\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.1: só LEITURA na transação SEMPRE desfeita: COUNT(*) das tabelas da folha e do contas a pagar antes e depois (nada muda nelas), um centro de custo ativo para a massa e a soma do líquido em SGH_PES_FOLHA_RESUMO (tabela do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelo serviço da folha',
  },
  // M53.3 (regras 7 e 8 na cópia): o cálculo mensal da folha só grava em SGH_.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/calculo-folha\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.3: só LEITURA na transação SEMPRE desfeita: COUNT(*) das tabelas da folha e do contas a pagar antes e depois (nada muda nelas), um centro de custo ativo para a massa e a soma das linhas em SGH_PES_FOLHA_CALCULO (tabela do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelo serviço do cálculo',
  },
  // M53.4 (F3 na cópia): férias e 13º só gravam em SGH_.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/ferias-decimo\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.4: só LEITURA na transação SEMPRE desfeita: COUNT(*) das tabelas da folha e do contas a pagar antes e depois (nada muda nelas), um centro de custo ativo para a massa e a fração relida de SGH_PES_FERIAS (tabela do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelos serviços de férias e do cálculo',
  },
  // M53.5 (F4 na cópia): a rescisão só grava em SGH_.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/rescisao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.5: só LEITURA na transação SEMPRE desfeita: COUNT(*) das tabelas da folha e do contas a pagar antes e depois (nada muda nelas), um centro de custo ativo para a massa e a rescisão relida de SGH_PES_RESCISAO (tabela do novo); toda escrita é SGH_ pelas funções do @sgh/legado e pelos serviços da rescisão e do cálculo',
  },
  // M53.6 (F5 na cópia): o eSocial só grava em SGH_; as pendências do outro sistema só se contam.
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/esocial\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.6: só LEITURA na transação SEMPRE desfeita: COUNT(*) das pendências de eSocial e das tabelas da folha antes e depois (regra 2: nada muda nelas), um centro de custo ativo para a massa; toda escrita é SGH_ pelas funções do @sgh/legado e pelos serviços do eSocial e do cálculo',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/fechamento-periodicos\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.7: só LEITURA na transação SEMPRE desfeita: COUNT(*) das pendências de eSocial e das tabelas da folha antes e depois (nada muda nelas), um centro de custo ativo para a massa; toda escrita é SGH_ pelas funções do @sgh/legado e pelos serviços do fechamento e dos periódicos',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/aplicacao\/obrigacoes\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.8: só LEITURA na transação SEMPRE desfeita: COUNT(*) das pendências de eSocial e das tabelas da folha antes e depois (nada muda nelas), um centro de custo ativo para a massa; toda escrita é SGH_ pelas funções do @sgh/legado e pelos serviços do fechamento, do eSocial e das obrigações',
  },
  {
    arquivo:
      /^apps\/api\/src\/modulos\/pessoas\/(?:aplicacao\/titulos-folha|infra\/outbox-custo-pessoal)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M53.9: só LEITURA na transação SEMPRE desfeita: COUNT(*) e SUM dos títulos (MFCONPAG), das apropriações (MFLANGSI), do lançamento, dos fatos e da SGH_OUTBOX depois do lançamento (e depois da falha forçada no segundo título, regra 10); toda escrita é a do executor (financeiro.criarTituloPagar, incluir-folha) e as SGH_ pelas funções do @sgh/legado',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/pessoas\/infra\/autoatendimento-escopo\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M52.6: leituras na transação SEMPRE desfeita (o ID dos dois usuários sintéticos de TBUSERS, um centro de custo ativo, uma unidade, a SGH_PES_POP_CIENCIA) e os privilégios do papel em RDB$USER_PRIVILEGES; a única escrita direta é a ligação do vínculo SINTÉTICO de SGH_PES_VINCULO ao usuário (tabela do novo), na mesma transação desfeita, como no M52.1',
  },
  // M44.1 (integração em fase0): a medição da fila em lote sobre a cópia.
  {
    arquivo: /^apps\/api\/src\/modulos\/recepcao\/aplicacao\/sinais-fila\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M44.1: o índice SGH_IDX_PEP_SINAL_ATEND conferido em RDB$INDICES, 30 mil sinais SINTÉTICOS semeados só em SGH_PEP_SINAL_VITAL (tabela do novo, IDs negativos fora do gerador) na transação SEMPRE desfeita e a contagem depois do ROLLBACK; a leitura medida vai pelo adaptador (@sgh/legado); nenhuma tabela do outro sistema',
  },
  // M31 (revisão por arquivo, como no M04 a M30).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m31\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M31: retrato do contador, dos lotes e das tabelas SGH_ do marco fora da transação (contagens) para provar que o ROLLBACK deixou tudo igual; as leituras da massa na transação desfeita (contas prontas, lote, item, convênio e competência); a trava do contador e do item por SELECT … WITH LOCK numa segunda conexão SEMPRE desfeita, para o LOCK TIMEOUT; o DELETE do lote protocolado na transação desfeita só para provar que os gatilhos o RECUSAM (E_GERAL_TISS_PROTOCOLO); nenhuma escrita fora do executor que fique',
  },
  // M30 (revisão por arquivo, como no M04 a M28).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m30\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M30: retrato da conta, dos itens e das tabelas SGH_ do marco fora da transação (contagens e somas) para provar que o ROLLBACK deixou tudo igual; as leituras na transação desfeita (a conta emitida da massa, o carimbo da versão, as fichas da fila e o número de contas); a trava da conta por SELECT … WITH LOCK numa segunda conexão SEMPRE desfeita, para o LOCK TIMEOUT; nenhuma escrita fora do executor (o outro sistema simulado é da massa: conta-outro-sistema.ts)',
  },
  // M45 (etapa 5; revisão por arquivo, como no M44.2).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m45-e5\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M45 (etapa 5): leituras READ ONLY para montar os casos na cópia (o dia da prescrição mais recente dos internados, uma cirurgia agendada com internação, a vigência da prescrição gravada na transação desfeita e os logins com o CBO de nutricionista, só contagem); nenhuma escrita fora do executor e das gravações SGH_',
  },
  // M44 (etapa 2; revisão por arquivo, como no M21).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m44-nir\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M44 (etapa 2): retrato da internação fora da transação (MAX da chave) para provar que o ROLLBACK deixou tudo igual e a mesma contagem na transação desfeita (a admissão recusada não gravou nada); nenhuma escrita fora do executor (a reserva fora de vista do outro sistema simulado é da massa: internacao-outro-sistema.ts)',
  },
  // M21 (revisão por arquivo, como no M04 a M20).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m21\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M21: retrato das tabelas da internação fora da transação (MAX da chave e COUNT) para provar que o ROLLBACK deixou tudo igual, as leituras na transação desfeita (o carimbo da internação, o cabeçalho, as contas, os trechos, a ocupação e as transferências nascidos nos gatilhos e, só por contagem, os bancos externos neutralizados) e a trava de um leito por SELECT … WITH LOCK numa segunda conexão SEMPRE desfeita, para o LOCK TIMEOUT; nenhuma escrita fora do executor (o outro sistema simulado é da massa)',
  },
  // M20 (revisão por arquivo, como no M04 a M19).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m20\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M20: retrato das tabelas do atendimento fora da transação (MAX da chave e COUNT) para provar que o ROLLBACK deixou tudo igual, e as leituras na transação desfeita (o prontuário do paciente sintético, a contagem da fila HL7 e a configuração de integração que o gatilho dela lê, a conta e o item nascidos no gatilho, o carimbo da ficha, a carteirinha do cabeçalho e, só por contagem, os bancos externos neutralizados); nenhuma escrita fora do executor (o outro sistema simulado é da massa)',
  },
  // M29 (revisão por arquivo, como no M04 a M28).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m29\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M29: retrato das tabelas da dispensação fora da transação (MAX da chave e COUNT, as linhas do horário e o saldo do item) para provar que o ROLLBACK deixou tudo igual, as leituras na transação desfeita (a saída, o lançamento, a dose, o controle de entrega e a integração com o estoque nascidos nos gatilhos) e a trava de um horário por SELECT … WITH LOCK numa segunda conexão SEMPRE desfeita, para a fila disputada; nenhuma escrita fora do executor (a suspensão do horário pelo outro sistema é da massa, reproducao-farmacia.ts)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m42-onda4\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M42: a escolha de uma conta emitida e consistente que o fechamento aceita (o mesmo critério do teste do M30; só o ID e a competência) e o retrato antes e depois (a conta, os itens, as tabelas SGH_ do fechamento, COUNT(*) da FCCTAEXT, o operador em TBUSERS e a trilha dele, só contagens) para provar que o ROLLBACK deixou tudo igual; o fechamento é do executor e as leituras do acompanhamento são as do adaptador. D-IDX-42: uma trilha SINTÉTICA no volume de produção semeada só em SGH_TRILHA (tabela do novo, IDs negativos fora do gerador; a FCCTAEXT só é lida dentro do banco) na transação SEMPRE desfeita, a leitura antiga só para comparar o tempo e a contagem depois do ROLLBACK; nenhuma escrita em tabela do outro sistema fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m43-fim\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M43: o retrato antes e depois (COUNT(*) dos três logins sintéticos em TBUSERS, fora da transação, para provar que o ROLLBACK deixou tudo igual) e a releitura de TBUSERS.BLOQUEADO do login sintético bloqueado pelo executor na transação desfeita; as demais leituras são as do adaptador; nenhuma escrita fora do executor (os usuários sintéticos são criados, trocados de grupo e bloqueados pelas receitas do M10)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m41-onda3\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M41: retrato das tabelas da dispensação fora da transação (MAX da chave e COUNT, as linhas do horário e o saldo do item) para provar que o ROLLBACK deixou tudo igual; a trava de um horário por SELECT … WITH LOCK numa segunda conexão SEMPRE desfeita (a outra estação); a amostra de saídas consolidadas de um dia do dump (só as chaves) e a releitura linha a linha do saldo do local e do preço médio pela outra conexão, para a conferência numérica; nenhuma escrita fora do executor (a outra estação editando o horário é da massa, reproducao-farmacia.ts)',
  },
  // M18 (revisão por arquivo, como no M04 a M17).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m39-onda1\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M39: as leituras na transação desfeita (o último dia de senhas da cópia, só a data, para a medida das senhas por sistema; o catálogo RDB$ para achar a coluna imutável que aceita nulo); nenhuma escrita fora do executor (a gravação por fora na lista para ligar e o outro sistema simulado esvaziando a coluna são da massa: onda1-outro-sistema.ts)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m18\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M18: retrato das tabelas da agenda de exames e do centro cirúrgico fora da transação (MAX da chave e COUNT) para provar que o ROLLBACK deixou tudo igual, e a releitura (SELECT) da DURACAO 1899-12-30, da cópia do cancelamento e do estado do novo na transação desfeita; nenhuma escrita fora do executor (o escritor legado simulado é da massa)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m46-e1\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M46 (etapa 1): retrato do centro cirúrgico fora da transação (MAX da chave e COUNT da cópia do cancelamento) para provar que o ROLLBACK deixou tudo igual, a amostra dos agendamentos recentes (só os IDs, para medir o tempo da leitura do contexto da APA) e a contagem da linha do agendamento depois do cancelamento pela receita compatível; na revisão, o ID de uma cirurgia realizada sem ligação (CCCADCIR, só o ID) para ligar à SRPA pela gravação SGH_ do M18; nenhuma escrita fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m46-e2\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M46 (etapa 2): retrato do centro cirúrgico fora da transação (MAX da chave e COUNT da cópia do cancelamento) para provar que o ROLLBACK deixou tudo igual, a amostra dos agendamentos recentes (só os IDs, para medir o tempo das leituras do quadro) e a contagem da linha do agendamento depois do cancelamento pela receita compatível; nenhuma escrita fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m46-e3\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M46 (etapa 3): retrato fora da transação (MAX da chave da saída e da agenda) para provar que o ROLLBACK deixou tudo igual, a amostra das contas de internação e dos itens da classe de OPME (só os códigos, para medir o tempo da conciliação), um lote do estoque com saídas (só o item e o lote, para medir o rastreio reverso), o lançamento da saída gravada pelo executor (só o ID) e a contagem da linha do agendamento depois do cancelamento pela receita compatível; nenhuma escrita fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m46-e4\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M46 (etapa 4): retrato fora da transação (MAX da chave da saída) para provar que o ROLLBACK deixou tudo igual e que a baixa sem conferência não gravou, uma nota da entrada com o fornecedor e um item (só o código, o documento e o fornecedor, para o faturamento do consignado) e o lançamento da saída gravada pelo executor (só o ID); a única escrita é a avaliação farmacêutica SINTÉTICA em SGH_SUP_AVALIACAO_FARM (tabela só do Sante, sem FK para a prescrição), na transação SEMPRE desfeita; nenhuma escrita em tabela antiga fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m55-e3\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M55 (etapa 3): retrato fora da transação (MAX da chave do pedido e do título) para provar que o ROLLBACK deixou tudo igual e que o pedido recusado ou desfeito não gravou, o fornecedor de pedido recente e a classificação gerencial recente (só os códigos) para o pedido e o título com contrato gravados pelo EXECUTOR; o contrato SINTÉTICO só em SGH_SUP_CONTRATO, na transação SEMPRE desfeita; nenhuma escrita em tabela antiga fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m55-e4\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M55 (etapa 4): retrato fora da transação (MAX da chave do pedido) para provar que o ROLLBACK deixou tudo igual, os códigos de dois fornecedores com pedido recente e o ID de um pedido deles (só os códigos) para as propostas e o pedido ligado ao processo; o processo SINTÉTICO só em SGH_SUP_LICITACAO*, na transação SEMPRE desfeita; nenhuma escrita em tabela antiga fora do executor',
  },
  {
    arquivo: /^tools\/assinatura\/src\/sem-legado-m46-e4\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M46 (etapa 4): o cenário só SGH_ da ordem de manipulação precisa de uma avaliação farmacêutica SINTÉTICA aprovada pela regra em SGH_SUP_AVALIACAO_FARM (tabela só do Sante, sem FK para a prescrição), gravada na transação da captura, que é SEMPRE desfeita; nenhuma tabela antiga é escrita',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m50-3\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M50.3 (correção da revisão): retrato da agenda do bloco e do cadastro fora da transação (MAX da chave e COUNT) para provar o ROLLBACK, a escolha de um registro de profissional que não atuou no bloco (só ID e código) e a releitura do agendamento confirmado na transação desfeita; nenhuma escrita fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/m50-4\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M50.4: retrato do atendimento e do cadastro fora da transação (MAX da chave) para provar o ROLLBACK, o prontuário do paciente sintético e a releitura da marcação, do horário (TELEATENDIMENTO), da senha e das fichas na transação desfeita; nenhuma escrita fora do executor (a marcação antiga trazida para hoje é a da massa do M20)',
  },
  {
    arquivo: /^packages\/legado\/src\/cirurgia\/gravacao\/registro\.ts$/,
    regras: ['f-max-mais-um'],
    motivo:
      'M18: CCCADCIR.ORDEM é o número do ato na internação no dia (parte da chave natural REG + DATA + ORDEM + ATEND, não uma chave gerada), calculado como o Delphi calcula; dois registros simultâneos do mesmo REG no mesmo dia colidem na chave única do banco e o segundo é recusado (nunca dupla gravação)',
  },
  {
    arquivo: /^packages\/legado\/src\/agenda\/mundo-agenda\.spec-util\.ts$/,
    regras: ['f-max-mais-um'],
    motivo:
      'M18: banco falso dos testes unitários das receitas, que reconhece e responde à mesma consulta da ORDEM de CCCADCIR (nada é executado no banco)',
  },
  // M14 (correção; revisão por arquivo, como no M04 a M11).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m14\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M14: retrato das tabelas tocadas fora da transação (COUNT nas pequenas, MAX da chave na trilha dupla) para provar que o ROLLBACK deixou tudo igual; só leitura, nenhuma escrita',
  },
  // M11 (revisão por arquivo, como no M04 a M08).
  {
    arquivo: /^packages\/testes\/src\/integracao\/cadastro\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M11: escolha de um paciente ativo pelo ID (SELECT FIRST 1) e a trava da linha por SELECT … WITH LOCK numa transação SEMPRE desfeita, para o executor receber "registro em edição"; estatística de leitura da transação (MON$); nenhuma escrita fora do executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/emergencia\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M06 (revisão): leitura (JOIN com RICADPAC pelo ID) para conferir que prontuário, tipo e OTMU gravados na quebra de vidro vêm do cadastro do paciente sintético, na transação desfeita; nenhuma escrita em tabela do legado',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/(?:perfil-complementar|emergencia)\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M06: INSERT só em tabelas SGH_ do acesso (perfil concedido, mapa, quebra de vidro) na transação desfeita, para provar as CHECKs (conceder a si, abertura sem justificativa) e a leitura das concessões',
  },
  // ADR 0022 (revisão por arquivo, como no M04, M06 e M08).
  {
    arquivo: /^packages\/testes\/src\/integracao\/gestao-acesso\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'ADR 0022: contagens (COUNT e MAX(ID)) antes e depois e a leitura do evento da trilha do legado e das opções do grupo sintético que as receitas do executor gravaram, na transação SEMPRE desfeita; toda escrita no legado é pelo executor; nenhuma escrita direta',
  },
  // M59-F4 (revisão por arquivo, como a da ADR 0022).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m59-4-saneamento\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M59-F4: contagens antes e depois (TBPERUSU, TBGRUUSU, TBUSERS, TBCABTRILHA depois do gerador) e a escolha de opções ativas (TBOPCOES) para a massa sintética que as receitas do executor gravam, na transação SEMPRE desfeita; toda escrita no legado é pelo executor; nenhuma escrita direta',
  },
  // M10 (revisão por arquivo, como no M04 a M11).
  {
    arquivo: /^packages\/testes\/src\/integracao\/administracao\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M10: contagens (COUNT e MAX(ID)) antes e depois, escolha de unidade, termo vigente, bloco, tipo de acomodação, centro de custo, local de conta, tipo TISS e paciente pelo ID (SELECT FIRST 1), releitura do que as receitas do executor gravaram (sem vazio onde o banco sempre preenche), o login de um usuário bloqueado e a trava da linha por SELECT … WITH LOCK, na transação SEMPRE desfeita; toda gravação é pelo executor',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/administracao\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M10 (regras 1 e 16 da ficha): dois comandos que o BANCO RECUSA, só sobre a massa sintética criada pelo executor na transação SEMPRE desfeita: DELETE de TBUSERS (TRG_TBUSERS_BD, exclusão proibida) e UPDATE da chave de RILEITOS (TRG_RILEITOS_BU, código em uso); nenhuma receita os faz',
  },
  {
    arquivo: /^packages\/legado\/src\/acesso\/identidade\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M59.2: usuário SINTÉTICO incluído em TBUSERS (senha e sal sintéticos) na transação SEMPRE desfeita, para provar a credencial forte, o segundo fator, a política e a recusa da retirada da senha antiga; a retirada em si vai pela receita do executor',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/acesso\/aplicacao\/rehash-primeiro-login\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M59.2 (ficha do M59, seção 10): usuário SINTÉTICO incluído em TBUSERS (com a data da senha antiga 30 dias antes, D-DIA-F2-59) na transação SEMPRE desfeita, o serviço da API sobre a porta do núcleo nessa mesma transação, e leituras só de contagem e classe (credencial forte viva, senha antiga presente) para conferir o rehash; depois do ROLLBACK, a contagem prova que nada ficou',
  },
  {
    arquivo: /^packages\/legado\/src\/acesso\/credencial\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M05: usuários sintéticos marcados em TBUSERS para provar as cifras de senha, na transação desfeita (confirmar: false); passar pelo executor fica com o M05',
  },
  {
    arquivo: /^apps\/api\/src\/telemetria\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M09: consulta sem tabela (RDB$DATABASE) pelo núcleo do @sgh/legado, para provar que o rastro sai sem literais nem CPF sintético',
  },
  // ADR 0021 (suporte técnico e "login como"; revisão por arquivo, como no M04, M06 e M08).
  {
    arquivo: /^packages\/legado\/src\/suporte\/repositorios\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'ADR 0021: contas, atribuições, auditoria, sessões, escritas e leituras do suporte técnico, só em tabelas SGH_PLAT_/SGH_SUP_ e sempre pela transação SGH_ do núcleo (gravarSgh: somenteSgh recusa tabela do legado)',
  },
  {
    arquivo: /^packages\/legado\/src\/suporte\/suporte\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'ADR 0021: inserir, alterar e excluir religiões SINTÉTICAS (TBRELIG, código MAX+1 lido, sem generator) numa sessão "como" e desfazer, na transação SEMPRE desfeita (desfazendoNaCopia), sob a trava da cópia',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/suporte\/fonte-copia\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'ADR 0021: COUNT(*) READ ONLY de TBUSERS, TBHISTSENHA, TBCABTRILHA, TBLANTRILHASGH, SGH_TRILHA e SGH_IDEMPOTENCIA pelo núcleo do @sgh/legado, antes e depois do login com ACESSO_FONTE_DEV=copia (prova de que nada grava); nenhuma escrita',
  },
  // M34 (revisão por arquivo): a gestão do catálogo de relatórios e as integrações novas gravam só tabelas SGH_REL_* e
  // SGH_INTG_* pela transação SGH_ do núcleo (gravarSgh: somenteSgh recusa tabela do legado), como o ADR 0021.
  {
    arquivo:
      /^packages\/legado\/src\/(?:relatorio\/repositorios\/gestao|integracao\/repositorios\/novas)\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      "M34: triagem, agendamento, execução e pedido de relatório (SGH_REL_*); parceiros, envios, entrada idempotente e marca d'água dos fatos (SGH_INTG_*), só pela transação SGH_ do núcleo (gravarSgh: somenteSgh recusa tabela do legado)",
  },
  {
    arquivo:
      /^apps\/api\/src\/modulos\/(?:integracao\/infra\/outbox|relatorio\/infra\/execucao)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M34 (regras 3, 7 e 8): na transação DESFEITA, sob a trava da cópia: a unicidade do banco em SGH_INTG_ENVIO e a escrita recusada na transação READ ONLY (SGH_REL_PEDIDO); leituras de prova em SGH_OUTBOX, SGH_TRILHA, SGH_REL_PEDIDO e RDB$DATABASE, só contagens; a API não importa @sgh/testes (fronteira do Nx)',
  },
  {
    arquivo: /^apps\/worker\/src\/integracao\/vigia-fatos\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M34 (regra 11): leituras READ ONLY de prova da vigia dos fatos (o carimbo mais recente do SILANEXA, os eventos em SGH_OUTBOX e nenhum gatilho SGH_ em RDB$TRIGGERS), sem dado pessoal',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/relatorio\/aplicacao\/executar\.spec\.ts$/,
    regras: ['c-ddl-fora-sgh'],
    motivo:
      'M34 (regra 1): o texto "DROP TABLE X" é o parâmetro malicioso que o teste prova ser recusado pelo esquema do relatório; nunca chega ao banco',
  },
  // M26 (revisão por arquivo): os testes de integração do SADT na API, sob a trava da cópia e sempre na transação
  // DESFEITA (desfazendoNaCopia); a API não importa @sgh/testes (fronteira do Nx), por isso o preparo fica no arquivo.
  {
    arquivo: /^apps\/api\/src\/modulos\/sadt\/aplicacao\/aviso-critico\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M26 (regra 7): a liberação "pelo outro sistema" simulada como o executável grava (as marcas da liberação no SILANEXA), na transação desfeita, para provar que a vigia acha a liberação e avisa em menos de 1 minuto',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/sadt\/aplicacao\/(portal\.autorizacao|retificar)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M26 (regras 4 e 9): leitura READ ONLY da liberação para visualização (a visualização gravada com data e IP; a situação 2 da liberação substituída) na transação desfeita, só contagens',
  },
  // M27 (revisão por arquivo, como no M04 a M26).
  {
    arquivo: /^packages\/testes\/src\/integracao\/m27-jornada\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M27 (jornada e J10): as leituras na transação SEMPRE desfeita que conferem o efeito de cada passo da jornada (a linha que a assinatura do marco descreve, a conta e a alta nascidas nos gatilhos, os horários da enfermagem, o exame liberado, a ligação da senha) e a trilha própria dos logins da jornada, só contagens; nenhuma escrita fora do executor (o outro sistema simulado é da massa)',
  },
  {
    arquivo:
      /^apps\/api\/src\/modulos\/(?:pep\/aplicacao\/worklist-medico\.autorizacao|recepcao\/aplicacao\/worklist-recepcao|acesso\/aplicacao\/mensagem)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M27 (regras 2, 5 e 7): leituras READ ONLY na cópia para escolher os logins e o dia de movimento (só em memória) e conferir, à parte, o conjunto com vínculo da fila do médico; nenhuma escrita, só contagens e tempos',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/sadt\/infra\/parametros-sem-segredo\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M26 (regra 10): o login de um usuário com parâmetros do laboratório (só o login, em memória), READ ONLY, para provar que a resposta não tem segredo',
  },
  // M13 (revisão por arquivo, como no M04 a M11).
  {
    arquivo: /^packages\/testes\/src\/integracao\/catalogos\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M13: SELECT FIRST e COUNT(*) das tabelas de catálogo (CBO, SIGTAP, CEP) para montar o arquivo sintético sobre códigos reais e conferir o que os lotes do executor gravaram, na transação SEMPRE desfeita; UPDATE só em SGH_CAT_CARGA (LOTES_TOTAL da carga sintética); toda escrita no legado é pelo executor',
  },
  {
    arquivo: /^packages\/legado\/src\/nucleo\/spike-driver\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'M02/M09: DELETE em tabelas virtuais MON$ (encerra a própria conexão do teste, filtrada por PID), não em tabela do legado',
  },
  // M16 (revisão por arquivo): a integração na cópia e o data mart.
  {
    arquivo: /^packages\/testes\/src\/integracao\/painel-leitos\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M16: consulta pesada de propósito (soma dos itens de conta pela conta) para provar o cancelamento pelo driver, READ ONLY; estatística de leitura da transação (MON$)',
  },
  {
    arquivo: /^packages\/testes\/src\/integracao\/censo-fechamento\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'M16: comando que o escritor SGH_ do núcleo RECUSA antes de chegar ao banco (prova da transação só SGH_; nunca executado), numa transação desfeita',
  },
  {
    arquivo: /^tools\/verificadores\/src\/datamart(-carregar)?(\.spec)?\.ts$/,
    regras: ['b-escrita-fora', 'c-ddl-fora-sgh'],
    motivo:
      'M16 (ADR 0025): INSERT e CREATE TABLE no arquivo SQLite do data mart (e nas fixtures sintéticas do verificador), fora de qualquer banco do estabelecimento',
  },
  // W0-10 (portais: paciente, médico externo e prestador; revisão por arquivo).
  {
    arquivo:
      /^packages\/legado\/src\/(?:auditoria\/sgh\/(?:copia-prontuario|pedido-titular-cancelamento)|cirurgia\/sgh\/pedido-portal-versao|sadt\/sgh\/portal-medico)\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'W0-10: as integrações na cópia montam o estado SINTÉTICO só nas tabelas novas SGH_ dos portais (pedido do titular, atos da cópia, versão do pedido de cirurgia, atos da conta, troca de e-mail, aviso e notificação do crítico; nenhuma tabela do legado) e provam por INSERT/UPDATE direto que os CHECKs, índices únicos e FKs recusam o inválido, sempre em desfazendoNaCopia (ROLLBACK; nunca confirmada) e sob a trava da cópia',
  },
  {
    arquivo: /^apps\/api\/src\/modulos\/portal-paciente\/aplicacao\/copia-prontuario\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'W0-10 (M2): a integração na cópia só LÊ um paciente qualquer (RICADPAC, ID e PRONT) para o pedido sintético e a trilha (SGH_TRILHA) da correlação do teste, em desfazendoNaCopia (ROLLBACK; nunca confirmada) e sob a trava da cópia; nenhuma escrita fora do executor',
  },
  // M15 (revisão por arquivo, como no M04 a M11).
  {
    arquivo: /^packages\/testes\/src\/integracao\/prontuario\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora'],
    motivo:
      'M15: consulta pesada de propósito (COUNT de PREVOLPAC com PRCABEVOL) para provar o cancelamento pelo driver; contagem READ ONLY depois do ROLLBACK do registro sintético; privilégios do papel da aplicação (RDB$) e estatística de leitura da transação (MON$); a gravação "por fora" fica na massa sintética (packages/testes/src/massa/prontuario.ts), na transação desfeita',
  },
  // W0-08 (CRUD completo, manutenção e patrimônio): integração na cópia, sempre na transação desfeita.
  {
    arquivo:
      /^apps\/api\/src\/modulos\/(?:manutencao\/(?:ciclo-vida|tecnovigilancia)|patrimonio\/ajustes)\.int\.spec\.ts$/,
    regras: ['a-tabela-legada-fora', 'b-escrita-fora'],
    motivo:
      'W0-08: na transação SEMPRE desfeita (desfazendoNaCopia), só tabelas SGH_: retrato COUNT/MAX antes e depois para provar o ROLLBACK, conferência do gravado (SGH_MAN_OS, SGH_QUA_TECNOVIG, SGH_HIST_EXCLUSAO, SGH_PAT_DEPRECIACAO) e massa sintética do novo que a cópia não tem (SGH_PES_VINCULO, SGH_PES_TREIN_PARTICIPANTE, SGH_PES_CURSO, custo da SGH_MAN_OS, SGH_PAT_BEM, SGH_CTB_REGRA); nenhuma tabela do legado lida ou escrita',
  },
  {
    arquivo: /^packages\/legado\/src\/patrimonio\/sgh\/grupos\.int\.spec\.ts$/,
    regras: ['b-escrita-fora'],
    motivo:
      'W0-08: massa sintética de um SGH_PAT_BEM do grupo para provar a recusa de órfão, na transação SEMPRE desfeita (desfazendoNaCopia); só tabela SGH_',
  },
];

/** Onde a escrita é permitida (regra b): receitas, executor (e suas tabelas SGH_), massa sintética. */
/** M56, regra 4 (Anexo B: descartar): tabelas do registro fictício de beneficiário, sem SQL nenhum. */
const TABELAS_BENEFICIARIO_FICTICIO: ReadonlySet<string> = new Set([
  'PSBENEFI',
  'PSBENCPL',
  'PSBENTMP',
  'PSPLNASS',
  'PSVENDAS',
  'PSATVASS',
]);

const ESCRITA_PERMITIDA = [
  /^packages\/legado\/src\/[a-z]+\/gravacao\//,
  /^packages\/legado\/src\/nucleo\/(executor|gravador)\.ts$/,
  /^packages\/legado\/src\/nucleo\/sgh\/(tecnicas|aplicador)\.ts$/,
  // ADR 0021: o retrato antes/depois da escrita do "como" (na transação do executor; grava só SGH_SUP_IMAGEM)
  // e a correção (compensação na transação curta do núcleo, com os gatilhos do legado disparando).
  /^packages\/legado\/src\/nucleo\/como\.ts$/,
  /^packages\/legado\/src\/suporte\/correcao\.ts$/,
  // Massa sintética e reprodução da assinatura (ficha: "massa sintética de packages/testes"); o resto de
  // packages/testes (os testes de integração) só com exceção nominal em EXCECOES.
  /^packages\/testes\/src\/massa\//,
  /^packages\/testes\/src\/reproducao\.ts$/,
];
/** Onde generator com passo e NEXT VALUE FOR são permitidos (o executor e as tabelas SGH_). */
const GENERATOR_PERMITIDO = [
  /^packages\/legado\/src\/nucleo\/(executor|gravador)\.ts$/,
  /^packages\/legado\/src\/nucleo\/sgh\//,
];

const LITERAL = /`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
/**
 * SQL do projeto: a convenção é de palavras-chave em maiúsculas, mas o Firebird aceita qualquer caixa; o
 * trecho é conferido em maiúsculas (`insert into ricadpac` não passa invisível). Identificador entre aspas
 * muda de sentido em maiúsculas, mas o projeto não usa (e a regra continua valendo para o nome sem aspas).
 */
const PARECE_SQL =
  /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+[A-Z_$"][\w$"]*\s+SET|DELETE\s+FROM|MERGE\s+INTO|EXECUTE\s+(?:PROCEDURE|BLOCK)|CREATE|ALTER|DROP|RECREATE|GRANT|REVOKE|COMMENT\s+ON)\b/;

function linhaDe(conteudo: string, indice: number): number {
  return conteudo.slice(0, indice).split('\n').length;
}

function* trechosSql(conteudo: string, arquivo: string): Generator<{ sql: string; indice: number }> {
  if (/\.sql$/i.test(arquivo)) {
    let indice = 0;
    for (const parte of conteudo.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length)).split(';')) {
      const ini = indice + (parte.length - parte.trimStart().length);
      if (parte.trim()) yield { sql: parte.trim().toUpperCase(), indice: ini };
      indice += parte.length + 1;
    }
    return;
  }
  for (const m of conteudo.matchAll(LITERAL)) {
    const sql = m[0]
      .slice(1, -1)
      .replace(/\$\{[^}]*\}/g, ' X ')
      .toUpperCase();
    if (PARECE_SQL.test(sql)) yield { sql, indice: m.index };
  }
}

const NOME = String.raw`"?([A-Z][A-Z0-9_$]*)"?`;
const ehSgh = (n: string) => n.toUpperCase().startsWith('SGH_');

/** Tabelas citadas (FROM, JOIN, INTO, UPDATE, TABLE, REFERENCES) no trecho. */
function tabelasCitadas(sql: string): string[] {
  const r: string[] = [];
  for (const m of sql.matchAll(
    new RegExp(String.raw`\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|ON)\s+${NOME}`, 'g'),
  )) {
    if (m[1]) r.push(m[1]);
  }
  return r;
}

export function procurarNoArquivo(conteudo: string, arquivo: string, listas: Listas): Achado[] {
  const achados: Achado[] = [];
  // Teste de unidade (dublê, o SQL nunca vai ao banco). O teste de integração (*.int.spec.ts e os
  // utilitários de packages/testes/src/integracao e de integracao.spec-util.ts) EXECUTA o SQL na cópia: as
  // regras valem para ele, com exceção nominal e motivo em EXCECOES.
  const integracao =
    /\.int\.spec\.ts$/.test(arquivo) ||
    /(?:^|\/)integracao(?:\.spec-util)?\.ts$/.test(arquivo) ||
    arquivo.startsWith('packages/testes/src/integracao/');
  const teste = /\.spec(?:-util)?\.ts$/.test(arquivo) && !integracao;
  const noAdaptador = arquivo.startsWith('packages/legado/');
  const add = (indice: number, regra: Regra, detalhe: string) => {
    if (EXCECOES.some((e) => e.arquivo.test(arquivo) && e.regras.includes(regra))) return;
    achados.push({ arquivo, linha: linhaDe(conteudo, indice), regra, detalhe });
  };
  for (const { sql, indice } of trechosSql(conteudo, arquivo)) {
    const citadas = tabelasCitadas(sql);
    // (a) tabela do SPDATA em SQL fora do adaptador (testes ficam de fora: dublês, nunca executados no banco).
    if (!noAdaptador && !teste) {
      for (const t of citadas) if (listas.tabelas.has(t)) add(indice, 'a-tabela-legada-fora', t);
    }
    // (a) em apps/*, nenhum SQL (nem de catálogo RDB$/MON$): só @sgh/legado conhece o banco.
    if (
      arquivo.startsWith('apps/') &&
      !teste &&
      /\bSELECT\b[\s\S]*\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\S+\s+SET\b|\bDELETE\s+FROM\b|\bEXECUTE\s+(?:PROCEDURE|BLOCK)\b/.test(
        sql,
      )
    )
      add(indice, 'a-tabela-legada-fora', 'SQL em apps/* (só @sgh/legado conhece o banco)');
    // (b) escrita fora das receitas, do executor e da massa sintética.
    const escrita =
      /\b(?:INSERT\s+INTO|UPDATE\s+[A-Z_$"][\w$"]*\s+SET|UPDATE\s+OR\s+INSERT|DELETE\s+FROM|MERGE\s+INTO|EXECUTE\s+PROCEDURE)\b/.exec(
        sql,
      );
    if (escrita && !teste && !ESCRITA_PERMITIDA.some((re) => re.test(arquivo)))
      add(indice, 'b-escrita-fora', escrita[0]);
    // M56 (regra 4): os registros fictícios de beneficiário do módulo de operadora (data sentinela de 1899) nunca são
    // lidos como beneficiário real nem alterados: nenhum SQL os cita, nem em teste, nem no adaptador.
    for (const t of citadas)
      if (TABELAS_BENEFICIARIO_FICTICIO.has(t)) add(indice, 'beneficiario-ficticio', t);
    // M12 (regra 4): o novo nunca grava TBTABTHM (o TRG_TBTABTHM_BIU propaga para TBPROCTO); item novo de
    // tabela não é gravado pelo novo. Sem exceção, nem em teste: a trava "seca" é só SELECT … WITH LOCK.
    if (
      /\b(?:INSERT\s+INTO|UPDATE(?:\s+OR\s+INSERT\s+INTO)?|DELETE\s+FROM|MERGE\s+INTO)\s+"?TBTABTHM\b/i.test(
        sql,
      )
    )
      add(indice, 'tbtabthm-escrita', 'escrita em TBTABTHM');
    // M13 (ficha, seção 10): o novo nunca exclui linha de tabela de catálogo (item que sai da fonte oficial fica
    // "removido na fonte" na comparação, sem DELETE). Sem exceção, nem em teste.
    for (const m of sql.matchAll(new RegExp(String.raw`\bDELETE\s+FROM\s+${NOME}`, 'g'))) {
      if (m[1] && listas.catalogo?.has(m[1])) add(indice, 'catalogo-delete', `DELETE em ${m[1]}`);
    }
    // (c) DDL sobre objeto sem o prefixo SGH_.
    for (const m of sql.matchAll(
      new RegExp(
        String.raw`\b(?:CREATE(?:\s+OR\s+ALTER)?|ALTER|DROP|RECREATE)\s+(?:UNIQUE\s+)?(?:(?:ASC|ASCENDING|DESC|DESCENDING)\s+)?(TABLE|VIEW|INDEX|SEQUENCE|GENERATOR|PROCEDURE|FUNCTION|PACKAGE|DOMAIN|EXCEPTION|ROLE|TRIGGER)\s+${NOME}`,
        'g',
      ),
    )) {
      if (m[1] !== 'TRIGGER' && m[2] && !ehSgh(m[2])) add(indice, 'c-ddl-fora-sgh', `${m[1]} ${m[2]}`);
    }
    for (const m of sql.matchAll(new RegExp(String.raw`\bCOMMENT\s+ON\s+\w+\s+${NOME}`, 'g'))) {
      if (m[1] && !ehSgh(m[1])) add(indice, 'c-ddl-fora-sgh', `COMMENT ${m[1]}`);
    }
    for (const m of sql.matchAll(
      new RegExp(
        String.raw`\b(GRANT|REVOKE)\s+([\s\S]+?)\s+(?:(?:ON\s+(?:TABLE\s+|SEQUENCE\s+|GENERATOR\s+|PROCEDURE\s+)?${NOME})|(?=TO\b|FROM\b))`,
        'g',
      ),
    )) {
      const alvo = m[3] ?? (m[2] ?? '').trim().split(/\s+/)[0] ?? '';
      if (!ehSgh(alvo)) add(indice, 'c-ddl-fora-sgh', `${m[1]} sobre ${alvo}`);
    }
    // (d) trigger: nenhum (em tabela legada nunca; em SGH_, sem trigger de regra de negócio).
    for (const m of sql.matchAll(
      new RegExp(String.raw`\b(?:CREATE|RECREATE)(?:\s+OR\s+ALTER)?\s+TRIGGER\s+${NOME}`, 'g'),
    )) {
      const tabela =
        new RegExp(String.raw`\b(?:FOR|ON)\s+${NOME}`).exec(sql.slice((m.index ?? 0) + m[0].length))?.[1] ??
        '';
      add(
        indice,
        'd-trigger',
        `${m[1]}${tabela ? ` em ${tabela}` : ''}${listas.tabelas.has(tabela) ? ' (tabela legada)' : ''}`,
      );
    }
    // (e) FK de SGH_ para tabela legada.
    for (const m of sql.matchAll(new RegExp(String.raw`\bREFERENCES\s+${NOME}`, 'g'))) {
      if (m[1] && !ehSgh(m[1])) add(indice, 'e-fk-legada', m[1]);
    }
    // (f) MAX(...)+1: nunca (IDs pelos generators do legado).
    if (/\bMAX\s*\(\s*[\w."$]+\s*\)\s*\)?\s*\+\s*1\b/i.test(sql)) add(indice, 'f-max-mais-um', 'MAX(...)+1');
    // (g) UPPER/TRIM/LOWER sobre coluna que abre índice, no WHERE.
    const onde = sql.search(/\bWHERE\b/);
    if (onde >= 0) {
      const colunas = new Set(citadas.flatMap((t) => listas.indexadas[t] ?? []));
      for (const m of sql
        .slice(onde)
        .matchAll(/\b(UPPER|TRIM|LOWER)\s*\(\s*(?:[A-Za-z_]\w*\.)?"?([A-Z][A-Z0-9_$]*)"?\s*\)/g)) {
        if (m[2] && colunas.has(m[2])) add(indice, 'g-funcao-em-indice', `${m[1]}(${m[2]})`);
      }
    }
    // Generator do LEGADO com passo ou NEXT VALUE FOR fora do executor (pendência 12a do M02). Sequência SGH_
    // (do novo, criada pelos scripts SGH_) não é do legado: as gravações SGH_ do M06 a usam (POL-5, M06).
    if (
      (/\bGEN_ID\s*\(\s*(?!"?SGH_)[^,()]+,(?!\s*0\s*\))/i.test(sql) ||
        /\bNEXT\s+VALUE\s+FOR\s+(?!"?SGH_)/i.test(sql)) &&
      !GENERATOR_PERMITIDO.some((re) => re.test(arquivo)) &&
      !/\.sql$/.test(arquivo) &&
      !teste
    ) {
      add(indice, 'generator-fora', 'GEN_ID com passo ou NEXT VALUE FOR');
    }
    // Procedimento selecionável com efeito colateral em FROM (pendência 12b do M02).
    for (const m of sql.matchAll(new RegExp(String.raw`\b(?:FROM|JOIN)\s+${NOME}\s*\(`, 'g'))) {
      if (m[1] && listas.procedimentos[m[1]]?.efeito) add(indice, 'procedimento-com-efeito', m[1]);
    }
  }
  for (const c of procurarColunasProibidas(conteudo, arquivo)) {
    if (!/colunas-proibidas/.test(arquivo))
      achados.push({ arquivo, linha: c.linha, regra: 'coluna-credencial', detalhe: c.motivo });
  }
  return achados;
}

export function lerListas(raiz: string): Listas {
  const tipos = resolve(raiz, 'packages/legado/src/tipos');
  const l = JSON.parse(readFileSync(resolve(tipos, 'tabelas-legadas.json'), 'utf8')) as {
    tabelas: string[];
    visoes: string[];
  };
  const i = JSON.parse(readFileSync(resolve(tipos, 'indices-legados.json'), 'utf8')) as {
    colunasIndexadas: Record<string, string[]>;
  };
  const p = JSON.parse(readFileSync(resolve(tipos, 'procedimentos-legados.json'), 'utf8')) as {
    procedimentos: Record<string, { efeito: boolean }>;
  };
  const marcos = parse(readFileSync(resolve(raiz, 'tools/matriz/marcos.yaml'), 'utf8')) as {
    marcos: Record<string, string[]>;
  };
  return {
    tabelas: new Set([...l.tabelas, ...l.visoes]),
    indexadas: i.colunasIndexadas,
    procedimentos: p.procedimentos,
    catalogo: new Set([...(marcos.marcos['M13'] ?? []), 'TBMATMED', 'TBVLRMEM', 'TBVERSAOBRASIN']),
  };
}

const FIXTURES = 'tools/verificadores/src/__fixtures__/guardas/';

/** Código versionado a conferir (gerados, a própria guarda e as fixtures ficam de fora). */
export function arquivosConferidos(raiz: string): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', '*.ts', '*.js', '*.mjs', '*.vue', '*.sql'], {
    cwd: raiz,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((f) => !f.startsWith('packages/legado/src/tipos/'))
    .filter((f) => !f.startsWith(FIXTURES))
    .filter((f) => !/tools\/verificadores\/src\/guardas-legado(\.spec)?\.ts$/.test(f));
}

/** Caminho que a fixture declara na primeira linha (`// guarda-caminho: <caminho>` ou `-- guarda-caminho:`). */
export function caminhoDeclarado(conteudo: string, real: string): string {
  return /^(?:\/\/|--)\s*guarda-caminho:\s*(\S+)/.exec(conteudo)?.[1] ?? real;
}

export function conferir(raiz: string, arquivos: readonly string[], listas = lerListas(raiz)): Achado[] {
  return arquivos.flatMap((f) => {
    const conteudo = readFileSync(resolve(raiz, f), 'utf8');
    return procurarNoArquivo(conteudo, caminhoDeclarado(conteudo, f), listas);
  });
}

function principal(): number {
  const raiz = resolve(import.meta.dirname, '../../..');
  const unico = process.argv.find((a) => a.startsWith('--arquivo='))?.slice('--arquivo='.length);
  const arquivos = unico ? [unico] : arquivosConferidos(raiz);
  const achados = conferir(raiz, arquivos);
  for (const a of achados)
    console.error(`[guardas:legado] ${a.arquivo}:${a.linha}: (${a.regra}) ${a.detalhe}`);
  // Prefixo com o hífen: 'g' não conta 'generator-fora'.
  const por = (r: string) => achados.filter((a) => a.regra.startsWith(`${r}-`)).length;
  console.log(
    `[guardas:legado] ${arquivos.length} arquivo(s); SQL legado fora do adaptador ${por('a')}, escrita fora do executor ${por('b')}, ` +
      `DDL fora de SGH_ ${por('c')}, trigger ${por('d')}, FK para legada ${por('e')}, MAX+1 ${por('f')}, função em coluna indexada ${por('g')}, ` +
      `generator fora do executor ${por('generator')}, procedimento com efeito ${por('procedimento')}, coluna de credencial ${por('coluna')}, escrita em TBTABTHM ${por('tbtabthm')}, DELETE em catálogo ${por('catalogo')}, beneficiário fictício ${por('beneficiario')} → ` +
      `${achados.length === 0 ? 'verde' : 'VERMELHO'}`,
  );
  return achados.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--privilegios')) {
    // M59-F1: o Desvio do privilégio mínimo por módulo (lê a cópia; ver guardas-privilegios.ts).
    await import('./caminhos-sgh.ts');
    const { principalPrivilegios } = await import('./guardas-privilegios.ts');
    process.exit(await principalPrivilegios(process.argv.slice(2)));
  } else process.exit(principal());
}
