# F2.4 lote 07-misto-internacao (2ª volta)

Resultado: 29 dos 30 arquivos sem dívida. Resta `apps/api/src/modulos/sadt/porta-propria.ts` (modelo-pendente),
devolvido como pedido de lote próprio (ver `07-misto-internacao.json`).

## O que mudou
- **Declarações compiladas (`packages/dominio-*/dist/*.d.ts`, 27 arquivos):** o código-fonte já estava limpo desde a
  1ª volta; o `dist/` (fora do git) estava velho. Foi recompilado com `tsc -p packages/dominio-<x>/tsconfig.lib.json`
  em internação, custos, contábil, preço, SADT, relatório, documento, financeiro e repasse, sem erro.
- **Internação, atributo por tipo de acomodação** (`adt/porta-propria.ts`, `gravarAtributo` e `limparAtributos` com
  escopo `tipo`): grava em `atributo_categoria_acomodacao` (uma linha por estabelecimento e tipo). Inclui na primeira
  vez; altera depois. Limpar põe os atributos em nulo (volta ao padrão) e mantém a linha e a versão.
- **Arquivo de prontuários, registro sem movimento** (`gravarSameExt`): grava em `ocorrencia_arquivo_prontuario`
  (remessa, aceite, cobrança, exclusão, ocorrência e descarte), com o movimento quando vier.
- As duas tabelas entraram na lista de tabelas da gravação direta da internação.
- **Testes:** dois casos novos em `adt/porta-propria.int.spec.ts` (efeito no banco, versão, trilha e recusas); `massa-adt.spec-util.ts` limpa as duas tabelas novas antes do atendimento. Os 15
  testes de integração da internação e do NIR passam no cliente `f24_07mistointernacao`.
- **Cliente de teste:** recebeu a carga dos catálogos públicos (IBGE, BCB, CID-10 e SIGTAP, pelo
  `catalogos/carregar.py`, a partir do cache local). Sem ela, a massa da internação não monta.

## Decisões pela melhor prática (para o dono ver)
- **Faixa etária do tipo de acomodação:** a tela manda anos (0 a 130) e o banco guarda dias. A conversão usa 365 dias
  por ano. Se a tela passar a mandar dias ou meses, a conversão sai.
- **Chave do atributo por tipo:** é o id do tipo de acomodação (o mesmo `tipo` que a tela recebe no apoio). Tipo
  inexistente é recusado (`tipo-acomodacao-inexistente`).
- **Motivo na alteração por tipo:** como no leito, mudar atributos que já existem exige motivo (`motivo-obrigatorio`).
- **Registro do arquivo de prontuários:** a porta confere as regras do domínio antes do banco e recusa com código
  próprio: motivo na exclusão, na ocorrência e no descarte (`motivo-obrigatorio`); aval da comissão no descarte
  (`aval-obrigatorio`); movimento de outra conta (`movimento-inexistente`); conta de outro estabelecimento
  (`registro-inexistente`); prazo fora de AAAA-MM-DD (`data.formato`). Os CHECKs do banco continuam como segunda
  barreira.

## Pedidos
- **SADT (`sadt/porta-propria.ts`):** 19 leituras, 6 gravações, as operações pendentes e a leitura no portal. Nada
  disso está nos DDL aplicados. Pede-se lote próprio, como o 22-misto-sadt já tinha pedido.

## Correção pelos achados da conferência (2ª volta)
- **Leitura do arquivo de prontuários ligada a `ocorrencia_arquivo_prontuario`** (`adt/porta-propria.ts`):
  - `localizacao` devolve a linha do tempo no formato do contrato (`id`, `em`, `excluido`, `motivoExclusao`,
    `protocolo`, `prazoDevolucao`, `aceito`, `cobrada`) e as `ocorrencias` da conta. Antes devolvia outro formato
    (`movimento`, `data`, `hora`) escondido por `as unknown as`: o controlador não achava o movimento (`x.id`) e
    recusava todo registro com movimento; `ja-aceito` nunca disparava.
  - `devolucoesAtrasadas` lê `cobrada` da cobrança registrada (antes `false` fixo) e usa o prazo da remessa.
  - Um movimento com exclusão registrada aparece como excluído e deixa de valer como posição atual do volume.
- **Movimento da conta** (`gravarSameExt`): o movimento tem de ser do atendimento ou, sem atendimento, do volume do
  mesmo paciente (`atendimento_id = conta OR atendimento_id IS NULL`). A `localizacao` usa o mesmo recorte.
- **Teste novo** em `adt/porta-propria.int.spec.ts`: remessa, aceite, cobrança, ocorrência e exclusão refletidos na
  localização e na lista de cobrança; movimento de outra conta recusado. `massa-adt.spec-util.ts` limpa
  `movimento_prontuario` e `volume_prontuario`.

### Decisões pela melhor prática
- **Prazo de devolução:** o da remessa mais recente, até 23:59 do dia no fuso do estabelecimento; sem remessa, a
  previsão de retorno do movimento; sem ela, o prazo padrão do arquivo. O banco filtra com folga de fuso e o corte
  exato é feito na porta.
- **Movimento sem atendimento** (volume do paciente inteiro) conta como da conta, porque o volume é o mesmo.
- **Datas e horas da linha do tempo** saem no relógio civil do estabelecimento (`AAAA-MM-DDTHH:MM:00`), como na
  porta em memória.

### Pedido
- `same.controller.ts` (fora da lista): trilha com a tabela `ocorrencia_arquivo_prontuario`, JSDoc e
  `@AuditadoNoHandler` atualizados (ver `07-misto-internacao.json`).
