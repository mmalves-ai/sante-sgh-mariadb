# Integração da onda 3 da F2.2 (lotes 03-01 a 03-05)

- **Módulos ligados** (`REGISTRO_MODULOS`, 34 no total): entram adt, digitalizacao, manutencao, nutricao, repasse e sus.
  - A digitalização entrou depois do DDL do `documento_digitalizado` que ela condicionava.
  - O `sus` entrou contra o pedido do lote 03-05 (a ficha manda registrar e o conferidor `--estrito` exige). Sem o
    registro, as rotas do SUS nem existiriam, porque o boot é pelo registro. Com ele, a porta própria responde, e
    o que ainda não foi mapeado recusa com `modelo-pendente` explícito: gravar a crítica, o arquivo CIHA/BPA/APAC/SISAIH,
    as faixas de AIH e o retorno do gestor. Falta a montagem (dadosCiha e os outros) ler a conta própria; fica como
    pendência do lote.
  - A ação `faturamento.susEquivalencia.editarRede` entrou no catálogo de permissões (`packages/contratos`). Os
    clientes já criados só a recebem quando o catálogo for regravado; até lá a recusa é 403 (falha fechada).
- **Typecheck cumulativo:** `apps/api/tsconfig.migrado.json` passa de 703 para 832 arquivos (fecho dos 5 lotes).
- **DDL aplicado** (só para frente, convenções do ADR 0002), em 7 pares `NN_tabelas.sql`/`NN_chaves.sql`:
  02_ADM/07, 06_PEP/15, 07_INT/06, 09_HOT/06, 12_FAT/09, 13_SUS/05 e 18_QUA/04. São 13 tabelas novas no catálogo, mais
  colunas, restrições e índices nas tabelas dos lotes.
  - 03-01: limite_permanencia; faixa etária do leito; uma internação aberta por paciente (coluna gerada + UNIQUE);
    procedimento da pré-internação (SIGTAP ou item, nunca os dois); cirurgia no pedido de leito; foto da inspeção da
    limpeza; registro_prontuario_ocorrencia (SAME).
  - 03-02: documento_digitalizado (lote, ordem, assinatura, CHECKs de segregação) e pin_troca_rapida. A carga dos 9
    tipos documentais fica no `09_HOT/06_chaves.sql`, e é idempotente.
  - 03-03: alerta_sanitario (modelo, série, registro), alerta_sanitario_equipamento, queixa técnica de equipamento,
    modelo_equipamento_curso, evento_ciclo_equipamento, `desativado_em`, laudo da OS e modelo pronto do plano.
    - A UNIQUE do contrato de manutenção passa a ser por fornecedor e número, e a porta usa o nome novo.
    - O contrato de suprimentos de origem é `contrato_fornecedor_id` (FK `contrato_fornecedor`), não
      `contrato_fornecimento_id` como foi pedido.
  - 03-04:
    - acompanhamento_terapia_nutricional, com um vigente por dia por coluna gerada, em vez da UNIQUE com a situação;
    - registro_social, correcao_registro_nutricao, avaliacao_nutricao_parenteral e plano_refeicao_acompanhante (+ _refeicao);
    - no mapa de dieta, o hash e o `tipo_linha`. O valor é `sem_prescricao` com sublinhado, não `sem-prescricao`;
    - na apuração do repasse, o resumo, o conferente e a memória completa, mais o CHECK de segregação;
    - no RPA, o título e a data de pagamento; na produção, o valor recebido; na regra, o profissional.
  - 03-05: crítica por conta com justificativa, competência criticada, chave do objeto nas remessas, faixas de AIH e
    retorno_sus_item.
  - Ficou de fora o adiantamento ao prestador (03-04), porque o próprio pedido não decidiu entre lançamento e tabela.
  - O DDL foi aplicado aos 8 clientes de dev e teste: 3577 tabelas e 13703 FKs, iguais ao banco de validação. O
    `cliente_teste_catalogos` já tinha uma tabela a menos antes.
- **Código ajustado ao DDL:**
  - O int spec do repasse aprovava com o mesmo usuário que recalculou. Agora prova a recusa do banco e aprova com
    outro usuário.
  - O int spec da digitalização usava `folha-sala` como tipo sem cadastro; agora o desativa durante a checagem.
  - O int spec da digitalização e o do PIN já reconhecem as colunas e a tabela aplicadas, e não desfazem nada.
- **Outros pedidos atendidos:**
  - `dominio-repasse`: o vocabulário neutro em `podeApurarPeriodo` (`lancamentosDaApuracaoNoPeriodo`,
    `apuracaoFechada`, uma recusa só, `periodo-ja-apurado`).
  - A tela do BPA usa a rota `/api/sus/parametros-ambulatoriais`.
  - Os comentários de `porta-pin.ts` e `trilha.ts` não citam mais arquivos apagados.
- **Pendências para as próximas ondas:**
  - mover `adt/limpeza-da-alta.ts` para o `dominio-hotelaria`;
  - os contratos da tela pedidos pelos lotes 03-01 e 03-05 (campos por id, `situacaoLegado`, `leitosEspelho`,
    `competenciaFinal = 0`, código numérico);
  - as portas passarem a usar as colunas e tabelas novas, que hoje respondem vazio ou `modelo-pendente`;
  - o ciclo de AIH/APAC e a montagem do SUS sobre a conta própria;
  - a ligação do PIN e as portas antigas ainda importadas no `app.module.ts` saem na desmontagem;
  - `pep/infra/acesso-entre-hospitais.int.spec.ts` (onda 4) ainda importa a trilha apagada;
  - a idempotência transversal pela Idempotency-Key nas portas com `gravarSgh` (aviso do 03-02).
