# Integração da onda 4 da F2.2 (lotes 04-01 a 04-04)

- **Módulos ligados** (`REGISTRO_MODULOS`, 39 no total): entram integracao, pep, qualidade e relatorio.
  - `registro.spec.ts` e `app-base.spec.ts` passam a usar `sadt` como exemplo de módulo não migrado (o `pep` agora é).
- **Typecheck cumulativo:** `apps/api/tsconfig.migrado.json` passa de 832 para 953 arquivos (fecho dos 4 lotes).
- **DDL aplicado** (só para frente, convenções do ADR 0002), em 2 pares `NN_tabelas.sql`/`NN_chaves.sql`:
  - `10_SADT/07`: `visualizacao_resultado_exame` (pedido do 04-02: primeira abertura do resultado por usuário,
    UNIQUE resultado+usuário), para a pendência "resultado novo" da fila do médico.
  - `19_REL/03`: `pedido_relatorio` (pedido do 04-04: pedido de relatório novo, CHECKs de resposta, publicação e
    cancelamento com motivo).
  - 2 tabelas novas no catálogo; validar_migracoes 0 erros, 3579 tabelas, 13713 FKs.
  - Aplicado aos 8 clientes de dev e teste (as 2 tabelas presentes nos 8).
- **Código ajustado:**
  - `pep/worklist-porta-propria.ts`: variável sem uso (`fim`) que quebrava o tsc.
  - Lint da qualidade: as portas de agravo, CCIH e gestão declaram as operações pendentes como propriedades
    tipadas pela porta (sem parâmetros sem uso); filtros da lista de notificações em blocos (sem expressão com vírgula).
- **Conferidor `--estrito`:** ok em 04-01, 04-03 e 04-04. O 04-02 só falha nos 2 specs de PDF/A
  (`documentos-pdf.int.spec.ts`, `prescricao-pdf.int.spec.ts`, 4 testes): o S3 de dev recusa gravar objeto
  (500), o mesmo esgotamento de volumes já registrado na onda 2. É do ambiente; mexer no container precisa do dono.
- **Provas:** tsc 0 erros (migrado e login); vitest API 195 arquivos, 1395 testes verdes e 3 pulados; núcleo 73
  verdes; `/api/saude` 200 após subir-login.
- **Legado restante:** 518 arquivos (602 imports), 0 no fecho do login.
- **Pendências para as próximas ondas** (detalhe em `saida/04-0*.json`):
  - PEP: "resultado novo" degradado (`vistoPeloMedico` sempre falso) até a porta dos documentos gravar em
    `visualizacao_resultado_exame` na abertura e a fila ler dela; regra 2 do M27 e p95 da fila sem prova no banco
    próprio; PortaProntuario, PortaDocumentos, PortaPrescricao e PortaFormularioNovo sem adaptador próprio (503);
    `visualizadoNoOutroSistema` sai do dominio-pep; `RICADPAC`/`PRPRESC` como entidade da trilha viram nomes neutros;
    `carga.controller.ts` ainda compara `destino !== 'legado'`.
  - Integração: carga dos padrões de troca no "criar cliente"; contratos do monitor (`legado` → `filas`, eventos ADT);
    worker (`registrarEnvio`/`fatosResultadoLiberado`); levar `interpretarValorApoio` ao dominio-sadt.
  - Qualidade: carga de tipo de incidente, classificação e grau de dano no "criar cliente"; SQL próprio de CCIH,
    agravo, gestão e etapa 2 da notificação (hoje `modelo-pendente`); `REGISTROS_VERSIONADOS_QUALIDADE` com nomes da
    origem; errno 1020 do MariaDB tratado como trava ocupada no núcleo.
  - Relatório: carga dos 19 relatórios do catálogo no "criar cliente"; `versao` e aceite da triagem no contrato;
    regra do aceite e curva ABC no dominio-relatorio; o BI da Rede depende de rede e internacao em `API_MODULOS`.
