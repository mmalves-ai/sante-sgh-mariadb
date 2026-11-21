# Lote qualidade, 3ª etapa (2ª volta): CCIH completa sobre o banco próprio

## O que mudou
- **`qualidade/porta-ccih-propria.ts`**: as 9 leituras e as 9 gravações da CCIH (comissão de controle de infecção
  hospitalar) que recusavam com `modelo-pendente` foram construídas sobre o DDL da 4ª leva. A porta não usa mais
  `leituraPendente` nem `modeloPendente`.
  - **Ficha de IRAS** (infecção relacionada à assistência): `caso_infeccao` com os critérios em
    `caso_infeccao_criterio` e o isolado em `caso_infeccao_microrganismo`. Registrar, corrigir com a versão anterior na
    trilha (e os critérios anteriores) e descartar. Leituras `iras`, `irasDas` e `irasNoPeriodo`, essa com o corte.
  - **Configuração do antimicrobiano por insumo** (`configuracao_antimicrobiano_insumo`): insere ou atualiza com a linha
    travada e o valor anterior na trilha. O ATC é conferido no formato.
  - **Decisão da CCIH e revisões D3/D7** (`decisao_antimicrobiano` e `revisao_decisao_antimicrobiano`). Recusa
    `ja-decidido`, `dias-obrigatorios` e `justificativa-obrigatoria`. A revisão sobe a versão da decisão.
  - **Precaução** (`isolamento_paciente`): definir, alterar (versão anterior na trilha) e encerrar. O bloqueio dos
    vizinhos é um `periodo_situacao_leito` na situação "bloqueado", com o motivo `isolamento`, ligado à precaução.
  - Todas as gravações passam pelo Executor (`gravacaoDireta`), com trilha e idempotência. A lista de tabelas da CCIH
    ganhou as 8 tabelas novas. As leituras ficam restritas ao estabelecimento da sessão.
- **`ccih.int.spec.ts`**: o teste "falha fechado" deu lugar a dois testes:
  - IRAS, configuração, decisão e precaução, ponta a ponta, com isolamento entre estabelecimentos;
  - a recusa no meio da operação desfaz o dispositivo já incluído.

  A limpeza da massa passou a cobrir as tabelas novas e a sequência `caso_infeccao`. São 8 testes verdes no cliente
  `f24q_qualidade`.

## Decisões pela melhor prática (para o dono ver)
1. **Multirresistente é marca do isolado, não da ficha.**
   - O microrganismo em texto fica na ficha. Quando ele está no cadastro de microrganismos (descrição, código ou
     mnemônico), o isolado vai ligado ao caso com a marca.
   - Marcar multirresistente sem microrganismo cadastrado é recusado com `microrganismo-nao-cadastrado`. Nada é
     gravado solto.
2. **Critério desmarcado não é apagado.** O critério fica com `atendido = FALSE` e volta a valer se for marcado de novo.
   A unicidade do modelo é mantida.
3. **Sítio e critério da ficha** são os cadastros `sitio_infeccao` e `criterio_infeccao`, com o código em snake_case.
   O critério é o vigente na data da infecção. O que não está cadastrado é recusado.
4. **"Setor" da ficha** é o código do bloco da unidade de internação, como já valia no censo. A ficha grava a unidade
   e o setor funcional dela.
5. **IRAS registrada pela CCIH já nasce confirmada.** A natureza é `infeccao` e a aquisição é `hospitalar`. Quem
   confirma é a conta da sessão.
6. **O bloqueio é do quarto.**
   - A precaução aberta mostra os bloqueios por isolamento ainda abertos na mesma acomodação. Assim, as precauções do
     mesmo quarto partilham os bloqueios sem tabela nova.
   - A encerrada mostra os bloqueios que ela mesma abriu.
   - Um leito que já está num período aberto (de outra precaução ou de outro motivo) não é bloqueado de novo.
   - A liberação só encerra o período de bloqueio por isolamento.
7. **O tipo do leito é derivado** das precauções abertas, pela mais restritiva: aerossóis, depois gotículas, depois
   contato. O retorno "abriu", "manteve" ou "trocou" sai da comparação dele com o tipo pedido.
8. **Descarte da IRAS:** a versão anterior vai à trilha com a ação `cancelamento`, porque `AcaoVersao` não tem
   "descarte".

## Pedidos (`p2-qualidade.json`)
- **Sementes:**
  - `sitio_infeccao`, com os 6 sítios do contrato;
  - `criterio_infeccao`, com os 21 critérios por sítio;
  - `situacao_leito`, com a situação "bloqueado", se faltar.
- **Construção que falta (não coube no teto de turnos desta volta):**
  - **gestão** (`porta-gestao-propria.ts`): documentos, indicadores, auditorias, comissões, pesquisas, contagem, envios,
    versões, protocolos, revisão de prontuário, cancelamento da não conformidade e controles do risco em texto. O DDL
    já existe;
  - **etapa 2 do incidente** (`porta-propria.ts`): as gravações, a queixa técnica, a sugestão e as 7 leituras de
    outros módulos;
  - **depois disso:** apagar `leituraPendente`, `modeloPendente` e `liberacaoPendente` de `apoio-propria.ts` e o
    `indisponiveis` de `seguranca.controller.ts`.

## Correção pela conferência (referência da trilha no controller da CCIH)
- `qualidade/ccih.controller.ts`: a trilha e o evento da liberação e da revisão do antimicrobiano passam a apontar para
  `decisao_antimicrobiano` (o id gravado é o da decisão), e não mais para `liberacao_antimicrobiano`, que é o histórico da
  ficha completa. Os textos do `@AuditadoNoHandler` foram atualizados (a revisão cita também `revisao_decisao_antimicrobiano`).
- Configuração do antimicrobiano: a referência era `antimicrobiano` com o id do insumo; agora é
  `configuracao_antimicrobiano_insumo` com o id da linha. Para isso, `configurarAntimicrobiano` devolve `{ id, criado }`
  (porta, porta própria, porta em memória e o teste de integração, que confere que a atualização devolve o mesmo id).
- Decisão (melhor prática): a trilha registra a linha realmente gravada, não a chave de negócio do insumo.
- Arquivos fora da `.lista` do lote 04 tocados (mesmo módulo, sem outro lote neles): `ccih.controller.ts`, `porta-ccih.ts`,
  `porta-ccih-memoria.ts`, `ccih.int.spec.ts`.
