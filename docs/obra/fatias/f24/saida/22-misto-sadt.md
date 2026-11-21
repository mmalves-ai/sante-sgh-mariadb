# F2.4, lote 22-misto-sadt (SADT, permissões 2, manutenção, TISS, patrimônio, raiz da API)

## O que mudou
- **Aviso de valor crítico (SADT):** `avisarCriticos` grava em `aviso_valor_critico`.
  - Grava um aviso por analito crítico do resultado liberado, ou um aviso do exame quando o crítico não tem analito.
  - O prazo vem da regra vigente: a da unidade vale antes da da rede, e a do analito antes da do exame. Sem regra, o prazo é de 30 min.
  - Avisar de novo o mesmo resultado não repete o aviso.
  - A vigia deixa de depender da recusa.
- **Manutenção:** o contrato de manutenção liga-se ao contrato de suprimentos (`contrato_fornecedor_id`), que precisa ser do mesmo fornecedor e do mesmo estabelecimento. A leitura devolve a ligação.
- **Patrimônio:** o laudo do bem grava em `laudo_bem`. O mesmo PDF no mesmo bem não duplica, e as leituras `laudos` e `laudo` devolvem o registro. O `ajustes.int.spec.ts` foi atualizado e prova isso.
- **TISS:** a evidência do prontuário na decisão de recorrer a glosa grava em `glosa_item.evidencia_prontuario`.
  - A leitura auditada `evidenciaDoItem` devolve a evidência.
  - A lista de itens mostra só se a evidência existe (`temEvidencia`).
- **Web (manutenção):** `juntarInstante` lê a hora pelo `lerHoraDigitada`. `separarInstante` devolve a hora como `HH:MM`, não mais com quatro dígitos.
- **Nomes de origem nos comentários:** reescritos com o termo de negócio. Arquivos: entradas, transfusão e vocabulário do SADT; ato transfusional; permissões (rouparia, SADT, sessões e digitalização, sistema, suprimentos e tipos); entradas da manutenção; patrimônio (contrato e domínio); TISS (acompanhamento e simulador); `catalogo.ts`; `versao.ts`.
- **Chave do código de baixa confiança:** `'MFLANCTO.TIPO_TRF'` passou a `'movimentoBancario.tipoTransferencia'`, a chave neutra já declarada em `CODIGOS_BAIXA_CONFIANCA_ONDA_4`.

- **Correção da revisão, valor crítico:** a escolha da regra e o prazo saíram da porta para o domínio, em `packages/dominio-sadt/src/critico/regra-aviso.ts`.
  - O arquivo traz `alvosDoAviso`, `escolherRegraCritico`, `prazoDoAviso`, `avisoDoAlvo` e o padrão nomeado `PRAZO_PADRAO_AVISO_CRITICO_MINUTOS`, com spec de 9 casos.
  - A porta só lê as regras candidatas vigentes e grava.
  - O `porta-propria.int.spec.ts` do SADT prova o contrato de efeito: um aviso por analito; a regra do analito na unidade vence a da rede e a do exame; `prazo_em` é `gerado_em` mais o prazo da regra; a segunda chamada devolve 0; e o crítico do exame sem analito usa só a regra do exame.
- **Correção da revisão, TISS:** o `porta-propria.int.spec.ts` prova a evidência da glosa.
  - Recorrer grava a evidência aparada em `glosa_item.evidencia_prontuario`.
  - Aceitar grava null, mesmo quando vem texto.
  - `evidenciaDoItem` devolve a evidência, e null no item aceito.
  - A lista traz só `temEvidencia` (true ou false), sem o texto.
  - O comentário velho de `evidenciaDoItem` ("aguarda a coluna") foi corrigido.
- **Correção da revisão, manutenção:** o `porta-propria.int.spec.ts` prova a ligação ao contrato de suprimentos.
  - O contrato do mesmo fornecedor e da mesma unidade grava `contrato_fornecedor_id` e volta em `coberturas().contrato`.
  - O contrato de outro fornecedor ou de outra unidade recusa com `contrato-fornecedor-invalido`, sem gravar nada.
  - A limpeza da massa (`massa.spec-util.ts`) apaga `contrato_fornecedor`.

## Decisões pela melhor prática (para o dono ver)
- **O aviso de valor crítico nasce mesmo sem regra cadastrada,** com prazo de 30 min, o padrão da coluna. O resultado crítico nunca fica sem aviso.
- **Laudo do bem com o mesmo PDF:** se o PDF já foi anexado ao bem, a porta devolve o laudo existente. Se aquele laudo foi excluído, a porta recusa (`laudo-excluido`), porque a UNIQUE do banco conta também a linha excluída.
- **A evidência da glosa só é gravada na decisão de recorrer.** É a mesma regra da porta de memória.

- **Precedência da regra de valor crítico:** a abrangência pesa mais que a especificidade. A regra do exame cadastrada na unidade vence a regra do analito da rede. Com o mesmo peso, vale a regra mais recente. A vigência e a situação ativa continuam filtradas na leitura.

## Pedidos
Estão em `22-misto-sadt.json`.
- **Implementação no SADT:** 19 leituras e 6 gravações (portal de resultados, orçamento do diagnóstico, filas da bancada).
- **Implementação na manutenção:** a estrutura pedida no f22 03-03 já existe. Falta ligar tecnovigilância, queixa técnica, curso exigido por modelo, ciclo de vida, laudo da OS e plano de modelo pronto.
- **Implementação no patrimônio:** a estrutura já existe. Falta ligar o cálculo e o estorno da depreciação e o ajuste de valor e o seu estorno. Doador e responsável dependem da troca de contrato pedida no 02-11.
- **Etapa coordenada da seção 5:** `FlagLegado.tabela` em `tipos.ts` e `suprimentos.ts`.
- **Patrimônio, estrutura (novo pedido DDL):** `cota_depreciacao` não se liga a `calculo_depreciacao`, e a `UNIQUE (bem_patrimonial_id, competencia, base)` conta a cota excluída.
  - Por isso, depois de um estorno, o recálculo da mesma competência (rodada N+1) não consegue gravar as cotas sem apagar fisicamente as da rodada estornada.
  - Pedido: `cota_depreciacao.calculo_depreciacao_id` (FK), com a unicidade só entre as cotas vigentes (chave gerada, como o `vigente_chave` do cálculo).
  - O estorno do cálculo e o do ajuste também dependem da leitura dos lotes contábeis exportados e das contas da perda por recuperabilidade. Hoje só a porta de memória tem essas duas leituras.

