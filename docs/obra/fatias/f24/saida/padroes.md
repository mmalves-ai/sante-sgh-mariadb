# F2.4: padrões compartilhados (vocabulário e permissões)

## 1. Auxiliares neutros (`packages/contratos/src/formatacao/`, exportados por `@sgh/contratos`)

| Arquivo | O que usar | No lugar de |
|---|---|---|
| `hora.ts` | `esquemaHora` (estrito `"HH:MM"`), `lerHoraDigitada` (`"8:30"`, `"0830"` → `"08:30"`; vazio → null) | `esquemaHoraLegada`, `paraHhmm` |
| `hora.ts` | `horaParaMinutos` / `minutosParaHora` (0 a 1439) | contas sobre `"HHMM"` |
| `hora.ts` | `esquemaInstante` (ISO com fuso), `dataHoraParaInstante(data, hora, fuso)`, `instanteParaDataHora`, `instanteParaHora`; `FUSO_PADRAO = 'America/Sao_Paulo'` | data + hora soltas quando o campo é um momento |
| `booleano.ts` | `esquemaBooleano`, `esquemaBooleanoConsulta` (`true/false/1/0`), `booleanoDoBanco`, `booleanoParaBanco`, `formatarBooleano` | `'S' \| 'N'`, `z.enum(['S','N'])` |

- Hora do dia (agenda, turno, escala) é `"HH:MM"`. Momento (evolução, prescrição, chegada) é instante ISO.
- O fuso é o do estabelecimento, nunca o do servidor.
- Valor inválido é recusado com código (`hora.formato`, `hora.fora-do-intervalo`, `booleano.valor`). Nunca vira
  vazio, zero ou falso.
- Conversão do formato do sistema de origem (quatro dígitos, S/N) é só do conector. O `hora-legada.ts` continua até
  os lotes migrarem os usos; o conferidor apaga.

## 2. Padrão dos códigos de permissão

- **Código estável de negócio `modulo.recurso.acao`**, em camelCase e em português (`FORMATO_CODIGO_PERMISSAO`).
  Exemplos: `pep.evolucao.ler`, `agenda.marcacao.criar`, `suprimentos.requisicao.autorizar`.
- O código é **contrato gravado** (`acao_sistema.codigo` de cada cliente). Ele não muda por mudança de menu.
  - Renomear exige uma linha em `conector/mapa/permissoes-renomeadas.tsv`.
  - Exige também `python3 -I tools/db/migrar_codigos_permissao.py --aplicar`, rodado antes do `carregar_acoes.py`.
- **Proibido no código e na descrição:** número de opção de menu, nome de tabela ou coluna, e nome do sistema de
  origem.
- **A origem sai do produto e vira dado do conector:**
  - `conector/mapa/permissoes.tsv` (`tipo_origem`, `chave_origem`, `codigo_permissao`) tem 10.805 opções de menu e
    6 marcas de usuário, que levam a 7.738 permissões. É gerado por
    `node --import ./tools/verificadores/src/caminhos-sgh.ts tools/obra/gerar_mapa_permissoes.ts`, e `--conferir`
    confere.
  - O conector usa o mapa para importar grupos como `perfil_acao` e marcas de usuário como `usuario_acao_excecao`.
- **Renomeados nesta etapa** (o gerador aplica o `.tsv`, e o `catalogo-legado.json` segue igual ao gerador):
  - `faturamento.apacUtilitarios.importaTabelaFamedsol` → `…importaTabelaMedicamentoSolicitado`;
  - `sadt.utilitariosInterfaceamento.spdata` → `…sistemaAnterior`.
- **Clientes de dev migrados:** 9 dos 11 registrados renomearam 2 ações cada, sem nenhum perfil nem exceção
  apontando para elas. Nos outros 2 (`teste_catalogos` e `teste_nucleo`), os códigos antigos não existiam. A segunda
  rodada não muda nada.

## 3. Comentário com nome de origem: antes e depois

| Antes | Depois |
|---|---|
| `// Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json): 3310, 3311…` | `// Permissões da agenda de consultas. A correspondência com o menu de origem está em conector/mapa/permissoes.tsv.` |
| `// A marca do usuário do estoque "lançar controlado" (GEUSERS.PERM_LAN_MAT_MED_CONT) concede…` | `// A alçada "lançar controlado" do usuário do estoque concede a conferência e a perda do controlado.` |
| `descricao: '… o escopo por conta (MFCTAUSU)'` | `descricao: '… o escopo por conta bancária do usuário'` |
| `// gravado em PRCABEVOL pelo trigger` | `// grava a evolução (registro clínico)` ou apagar, se for só proveniência |

## 4. Para os lotes de permissão (03 e os mistos)

- **Comentários:** reescreva pela tabela acima.
  - Constantes `OPCOES_*` com números de opção ficam até a etapa da seção 5. São números, não nomes.
  - O comentário diz só "menu de origem, ver conector/mapa/permissoes.tsv".
- **`flagsLegado` e `FlagLegado.tabela`** (em `farmacia.ts`, `suprimentos.ts` e `tipos.ts`) ainda trazem o nome da
  tabela de origem como dado. Não mexa nisso no lote: depende da etapa da seção 5.

## 5. Pedido: etapa coordenada depois dos lotes

O pedido é tirar `opcoesLegado` e `flagsLegado` de `DeclaracaoPermissao` e da origem do `catalogo-legado.json`, que
passa a ser o catálogo-base próprio do produto. A procedência passa a viver só em `conector/mapa/permissoes.tsv`.

Os arquivos tocados ficam fora de um lote só:
- `packages/contratos/src/permissoes/*`;
- `packages/dominio-acesso/src/concessao.ts` (`porOpcao` e `porFlag`);
- `apps/api/src/autorizacao/catalogo.ts`;
- `apps/api/src/modulos/acesso/fonte-sintetica.ts`;
- `apps/api/src/modulos/administracao/permissoes.controller.ts` e `fonte-memoria.ts`;
- `tools/verificadores/src/permissoes.ts`, cuja regra "sem-mapeamento" passa a ler o mapa do conector.

Por isso o pedido é de um agente só, em sequência.
