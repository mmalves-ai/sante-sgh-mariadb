# Revisão com o dono, 27/11/2026

Roteiro gerado na noite de 26/11 (Sessão de Construção). Números recontados por script em `docs/fases/fichas/README.md`.

## 1. Onde a obra está

| Fase | Cobertas | Parciais | Faltam | Total |
|---|---|---|---|---|
| F3, cobertura dos módulos | 201 | 53 | 0 | 254 |
| F7, exigido para vender | 78 | 31 | 0 | 109 |
| F8, recursos novos | 91 | 12 | 1 | 104 |
| **Total** | **370 (79%)** | **96** | **1** | **467** |

GitHub: `origin/main` = 8acaefe1 (esteira simulada VERDE). Painel 5310 e API 3310 no mesmo commit, cliente ProntoCardio
com as migrações aplicadas. Evolução: 163 (36%) em 25/11 de manhã; 326 (70%) em 26/11 às 08h; 370 (79%) em 26/11 às 21h.

## 2. Decisões para revisar

`docs/obra/decisoes-tomadas.md`, 49 decisões numeradas, cada uma com o que, por quê e como desfazer. As que mais pedem o
seu olhar (produto e regra de negócio, não processo da obra):

- 13, 14 e 18 a 34: decisões de classe C da construir-3 e da completar-4 (assinatura ICP-Brasil do laudo, central de regulação com SISREG como
  primeiro adaptador, foto facial na identificação, segundo fator por chave de dispositivo, LALUR/LACS, plano de contas
  da ANS, catálogo TACO na nutrição, pesquisa clínica que só sugere candidatos).
- 36 a 40: decisões de produto da completar-5 (restrição de exame por sexo com justificativa por padrão, grade diária da
  dispensação, nota fiscal só pelo vínculo do faturamento, refeição do acompanhante por regra do estabelecimento, prazo
  de guarda da soroteca por regra do estabelecimento).
- 41 a 49: decisões da fase 2 das recusas da carga (sessão Painel de Injeção), entre elas o lote migrado sem validade
  (41: entra visível com alerta; uso em paciente e saída a terceiro recusam).

## 3. Pendências (97 funções não cobertas)

Detalhe por linha em `docs/obra/pendencias-2026-11-26.md` (situação da integrar-4; 7 linhas de lá já viraram Coberta
depois: C2-064, C2-063, C2-091, C2-004, C2-057, C2-024 e as decisões da completar-5). Por motivo:

- **Construção parcial** (tela, regra ou prova faltando; a maior parte): trabalho que dá para terminar, ~0,7 M por
  função no modelo atual. Pede a sua prioridade: quais áreas primeiro.
- **Teste de tela vermelho sem causa achada em duas tentativas** (sem terceira, regra 5 do plano): m45-1, c2-030 (ata e
  pregão), c2-060-controles-risco, c2-103-receita-contabil e outros da lista.
- **Dependência externa:** envio ao eSocial (S-1200/S-1210 do RPA), transmissor ao webservice da operadora (autorização
  prévia), adaptador dos aparelhos do laboratório.
- **Depende de outra função:** requisição de exames (lote do SADT), retirada de documento (publicação), conferência com o
  CNES (carregador oficial).
- **Carga (sessão Painel de Injeção):** pendências em `docs/obra/passagens/RETOMADA-carga-painel.md` (termo de
  consentimento, ruído do SIRESPAD, medição do R9).

## 4. Consumo

Plano de redução (25/11): de ~3,3 M para ~1,5 M por função pronta. Medido em 26/11: ~0,7 M por função coberta
(integrar-4, completar-5 e completar-6); cadência de 1 a 13 M/h contra ~76 M/h na manhã de 25/11. Detalhe em
`docs/obra/consumo.md`.
