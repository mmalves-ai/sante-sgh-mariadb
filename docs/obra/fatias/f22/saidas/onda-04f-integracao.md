# Integração da onda 4 das ondas finais da F2.2 (lotes 04-01 contabilidade e 04-02 portal do médico externo)

- **Módulos ligados** (`REGISTRO_MODULOS`, 51 no total; todas as pastas de `apps/api/src/modulos` registradas): entram
  `contabil` e `portal-medico`. `sadt`, `repasse` e `pep` passam a globais (o portal do médico injeta as portas deles;
  sem isso a partida com `todos` recusava).
- **Typecheck cumulativo:** `tsconfig.migrado.json` 1445 → 1487 arquivos (fecho dos dois lotes).
- **Specs ajustados:** registro.spec e app-base.spec usam um nome inexistente como "não migrado" e a lista de `todos`
  inclui contabil e portal-medico. Lint: diretiva com motivo nas desestruturações que tiram a chave de idempotência e na
  assinatura de `regras()`.
- **DDL aplicado** (só para frente, ADR 0002; validar_migracoes 0 erros, 3604 tabelas, 13798 FKs; aplicado aos 9
  clientes de dev e teste; catálogo com 2 tabelas novas):
  - `03_CAD/07`: NIRE e data do NIRE no estabelecimento (04-01);
  - `14_FIN/13`: leiaute, conferência, linhas e parâmetros do arquivo SPED; observação do encerramento do período (04-01);
  - `17_INTG/04`: profissional numa só conta vigente (coluna gerada `profissional_vigente_id` + único `*_vigente`; o
    único antigo por profissional sai), comentário de `pessoa_fisica_id` (pessoa do médico), `ato_conta_portal_profissional_externo`
    e `troca_email_conta_portal` (paciente ou médico, uma pendente por conta; código só por resumo SHA-256; envio
    `simulador`/`plataforma`, sem nome de fornecedor) (04-02 e 03-12).
- **Pedidos não aplicados:**
  - 04-01 `versao_regra_contabil` e a versão da regra no lançamento/fato: o modelo já tem `regra_contabilizacao`,
    `regra_contabilizacao_item`, `versao_regra_contabilizacao` e `leitura_fato_contabil` (fato × regra × versão ×
    lançamento). Tabela paralela duplicaria. Regras, simulação, publicação, contabilização automática e reprocessamento
    seguem `modelo-pendente` até o lote de continuação ler e gravar nessas tabelas; a trilha da publicação já aponta
    `versao_regra_contabilizacao`.
  - 04-01 conciliação várias por conta e mês: muda o sentido da tabela (conciliação mensal da conta); a conciliação de
    grupos de partidas pede tabela própria de itens. Decisão do dono.
  - 04-01 permissão `contabil.plano.rede` e contratos (`bloqueado` no período, `aceita_lancamento_manual` na conta):
    pacotes de contrato, fora desta integração.
  - 04-02 conta do médico em `aviso_valor_critico_tentativa` + canal `portal_medico`: misturaria o envio (`simulador`,
    `halai`, `desligado`) no `resultado` do contato; pede tabela própria de notificação do aviso ao portal.
  - 04-02 leituras `acessoPorId`/`autocadastros` na porta própria do sadt, provedor de identidade para `trocarSenha`,
    assinatura de documentos na API migrada, troca `cbos`→`profissionais` no pep e no domínio da cirurgia, contrato
    `notificacaoIndisponivel`, Idempotency-Key nas telas: código de outros lotes.
- **Provas:** conferidor `--estrito` ok em 04-01 e 04-02; tsc 0 (migrado e login); vitest API 323 arquivos, 2130 verdes e
  19 pulados; núcleo 73; eslint dos arquivos tocados 0; `/api/saude` 200 com API_MODULOS=todos (rotas de contabil e
  portal-medico respondem 401 sem sessão).
- **Legado restante:** 304 imports em 244 arquivos (apps/api 1: app.module.ts, desmontagem da última onda), 0 no fecho do login.
