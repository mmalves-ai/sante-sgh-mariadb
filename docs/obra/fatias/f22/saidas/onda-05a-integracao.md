# F2.2 onda 5a: integração (lotes 05-06, 05-07, 05-08, 05-10, 05-11, 05-14), tentativa 1

- **Lotes:** massa de testes sem a convivência (05-06, 05-07, 05-08), ferramentas de verificação sobre o banco
  próprio (05-10, 05-11) e entrega de integração do worker (05-14). Nenhum módulo novo no registro (52 entradas).
- **DDL aplicado** (só para frente, ADR 0002; validar_migracoes 0 erros, 3604 tabelas, 13798 FKs; aplicado aos 9
  clientes de dev e teste):
  - `17_INTG/05_tabelas.sql`: `mensagem_integracao_saida.recibo` (até 120); a porta do worker grava e lê o recibo
    inteiro (antes truncado a 30 e repetido na resposta).
  - `19_REL/04_tabelas.sql`: `triagem_relatorio_legado.area` com comentário e CHECK pelas chaves de
    `PAPEIS_TRIAGEM`; triagem decidida exige área.
- **Outros pedidos aplicados:** scripts `copia:*` removidos e `SGH_DEV_PERMITIR_SYSDBA` fora das ferramentas
  migradas (package.json); núcleo sem propriedade de parâmetro (executor, pool) e com `program_name` do processo
  na conexão; vitest de `packages/testes` com `src/massa/**/*.int.spec.ts` só na integração; linhas das massas
  apagadas fora de `sem-coexistencia.pendentes`; `privilegios:gerar` regenerado e versionado em
  `infra/mariadb/privilegios`; apagados `infra/firebird/fase7/privilegios/` e
  `tools/verificadores/dados/dependencias-gatilhos.pc.json`; dublê do datamart com o id do estabelecimento.
- **Conferidor --estrito:** 05-10, 05-11 e 05-14 ok. 05-06, 05-07 e 05-08 só acusam o tsc do pacote
  `packages/testes` (1896 erros, todos em arquivos dos lotes 05-01 a 05-05 e 05-09, ainda abertos; nenhum em
  `src/massa`); o vitest desses lotes passa.
- **Provas:** tsc migrado (API) 0, login 0, worker migrado 0, núcleo 0; vitest API 2130 verdes e 19 pulados, núcleo 73;
  eslint 0 nos arquivos tocados; `/api/saude` 200 com API_MODULOS=todos. Legado: 200 imports em 158 arquivos.
- **Não aplicados** (dono, outra trilha ou outro lote): exclusão física dos destinatários do envio de relatório
  (o `agendamento_relatorio` também é excluído fisicamente: a troca pede decisão no módulo relatorio; o gerador de
  privilégios descarta o DELETE); conta de monitoramento do k6; papel por módulo ligado à conta da API (núcleo/TI);
  generalização do `dominio-acesso` para o banco próprio; lista clínica no `packages/contratos`; tabelas explícitas
  nos 14 módulos com nome dinâmico; `dono_papel_seguranca_id` da triagem (decisão); internação em vocabulário neutro
  e `leiturasDoBanco()` do datamart; preço gravado na origem (`faturamento:reproduzir`); retratos e inventários do
  conector (F4); treino; coordenação com 05-01 a 05-05, 05-09, 05-13 e 05-16.
