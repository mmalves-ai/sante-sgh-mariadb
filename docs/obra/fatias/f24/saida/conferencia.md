# Conferência da F2.4, 2ª volta (tentativa 1)

Data: 2026-11-21. Resultado: **não fecha**. A dívida caiu de 186 (fim da 1ª volta) para **44 arquivos** de código-fonte,
mas a sobra não é pequena: 42 arquivos de `modelo-pendente` são **construção de porta inteira**, não ajuste.

## O que o conferidor aplicou

- `tools/obra/divida_f24.py` ignora `dist/` (pedido do 01-pacote-contratos-1): a saída de build fica fora do git e
  não é consumida, porque os `paths` do `tsconfig.base` apontam para `src/`.
- `apps/api/src/modulos/adt/same.controller.ts` (pedido do 07-misto-internacao): a trilha do `POST registros` passa a
  apontar para `ocorrencia_arquivo_prontuario`, que é a tabela onde a linha é gravada. Antes ligava o registro a
  `movimento_prontuario` com o id de outra tabela. O JSDoc e o texto da auditoria saíram de "modelo pendente".
- `packages/contratos/src/formatacao/hora-legada.ts` **não foi apagado**. O `packages/ui/src/componentes/SanteHora.vue`
  ainda o usa, e o pedido coordenado do 08-misto-assinatura continua aberto.

## Pedidos que continuam abertos

Os pedidos são de construção ou de decisão, não de ajuste (detalhe nos `.json` de cada lote).

| Lote | Arquivos com dívida | Natureza |
|---|---|---|
| 03-pessoas | 9 | Faltam o cálculo e a integração da folha, a ligação de `porta-realizado-propria` ao repasse, o empregador do eSocial (DDL pedido) e a ficha do vínculo (falta a lista de colunas do dono). O autoatendimento depende dos gravadores de outras portas. |
| 04-misto-operadora | 13 | Faltam 4 portas da qualidade (CCIH com 45 leituras, gestão com 46, agravo com 17 e etapa 2 do incidente) e as consultas e o gravador da contabilização do worker, a mover para um pacote comum. Na operadora faltam o acordo, a GRU do SUS e o portal do prestador. |
| 05-misto-agenda | 6 | Faltam as portas da cirurgia (anestesia, bloco seguro, operações) e as de SAE e escores da enfermagem. |
| 06-misto-suprimentos | 8 | O estoque tem 30 leituras, 14 gravações e 15 operações, e a troca da chave antiga (ano, mês, número) por id vai de ponta a ponta. OPME e manipulação dependem do estoque. Falta a rodada da farmácia. A imutabilidade clínica precisa de redesenho, com a lista gerada a partir do modelo e os specs do domínio de acesso. |
| 07-misto-internacao | 1 | Na `sadt/porta-propria.ts` faltam 19 leituras, 6 gravações e as operações. |
| 08-misto-assinatura | 8 | Faltam as portas de especialidades, manutenção, nutrição, SUS e preços (cargas), e a senha do portal médico depende de decisão. Falta a troca coordenada de `relogio.ts` (cerca de 195 pontos em 30 arquivos) e de `SanteHora.vue` para `HH:MM`. |

## Verificações

- `divida_f24.py --falhar-se-pendente`: **falha**, com 44 arquivos de `src/` (42 de modelo-pendente, 1 de nome de
  origem e 1 de vocabulário antigo).
- Estas verificações foram **lançadas, mas o resultado não foi colhido** antes do fim da tentativa, e o commit não
  foi feito. Os registros ficam em `/tmp/claude-1000/conf/`:
  - os tsc (api, migrado, login, worker, web, contratos e núcleo);
  - os vitest de unidade;
  - a integração (104 specs, cliente `f24_conferir`);
  - o `validar_migracoes`, o `contar-legado` e o `conferir-lote-f24 --estrito` dos 8 lotes.
