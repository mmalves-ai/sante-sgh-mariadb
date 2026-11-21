# F2.4, lote 02-pessoas-2 (RH: ponto, SESMT, treinamento, contratos e domínio de pessoas)

## O que mudou

- **Nome de origem (≈80 linhas, só comentário):** os nomes de tabela e coluna do sistema de origem saíram dos
  comentários de `packages/contratos/src/pessoas/*` e `packages/dominio-pessoas/src/*`. Ficaram os termos de negócio
  (inscrição no conselho, unidade assistencial, tipos de hora da apuração…). A chave da trilha da habilitação
  (`servico.ts`) passou a `inscricao_conselho:<id>`.
- **Vocabulário (hora):**
  - CAT: `atestadoHora` é `HH:MM` (`esquemaHora`) e `horasAntes` é duração `HH:MM` (até 99:59). A porta grava minutos e
    devolve `HH:MM`; o gerador do S-2210 converte para os quatro dígitos do leiaute (`hrAcid`, `hrsTrabAntesAcid`,
    `hrAtendimento`). Rótulo da tela e specs acompanham.
  - Autoatendimento: a hora digitada passa por `lerHoraDigitada` (auxiliar comum).
  - Os comentários do AEJ e do identificador do eSocial descrevem o formato do leiaute, sem a sigla antiga.
- **Modelo pendente, ligado ao DDL aplicado:**
  - Treinamento: categorias `pop` e `gestao`, o público por unidade, o curso obrigatório para todo o estabelecimento e
    o público do curso não obrigatório (`curso_publico_alvo`). Saiu a recusa da memória e do banco.
  - Ponto: a trilha do período (`evento_periodo_ponto`), a regra do banco de horas por regime (`regra_banco_horas`),
    os movimentos e o saldo (`movimento_banco_horas`), o ajuste com o vínculo gravado e o abono do tipo
    "justificativa" (tipo de movimento e minutos).
  - SESMT: o anti-HBs com título, a situação, a data e a observação da profilaxia, o encerramento do acidente sem
    material biológico (na comunicação), a ligação da retificação (ASO com motivo, vacina) e a sorologia sem o desvio
    de "tabela ausente".
- **Testes:** os specs de integração do ponto, do SESMT e do treinamento passaram a provar a gravação e a leitura do
  que antes era recusado (16 de 16 verdes no cliente `f24_02pessoas2`).

## Decisões pela melhor prática (para o dono ver)

1. **Público do curso em duas tabelas.** O curso obrigatório por função continua em `treinamento_obrigatorio_funcao`,
   porque essa tabela tem vigência. O resto vai a `curso_publico_alvo`: unidade, "todo o estabelecimento" (linha sem
   setor nem função) e o público do curso não obrigatório. A leitura junta as duas.
2. **A referência da reabertura e da ciência não tem coluna.** Ela é o último fechamento da mesma competência, pela
   ordem dos eventos, que é a regra do domínio. A `fechamento_ponto` não é criada pela trilha do período, para não
   gerar fechamentos com horas zeradas nos indicadores.
3. **O movimento do banco aponta o evento que o gerou pela ordem no tempo.** É o último fechamento ou reabertura da
   competência registrado até o movimento, na mesma transação. O acerto manual não tem evento. O destino vem da
   origem: fechamento e acerto vão ao banco, o pagamento à folha e a expiração expira.
4. **Tipo do acordo do banco pelo ciclo.** Até 6 meses é `acordo_individual`; acima, `acordo_coletivo` (CLT, art. 59).
   O critério de início é a competência.
5. **O dia do abono fica em `ajuste_ponto.marcacao_em`, à meia-noite local.** Há um pedido opcional de coluna própria.
6. **Motivo da desativação da regra:** lido da trilha (a correção registrada pelo serviço), sem coluna nova.

## Pedidos (em `02-pessoas-2.json`)

- **Contrato (bloqueia a última dívida do lote):** o registro de proteção do SESMT precisa ser endereçado por tipo e
  id. As tabelas `leitura_dosimetria` e `exposicao_quimioterapico` existem, mas os ids se repetiriam entre as três
  tabelas e o cancelamento pegaria o registro errado. Até lá, a leitura do dosímetro e a exposição a quimioterápico
  recusam com 409 (`modelo-pendente`, com o motivo). É a única linha de dívida que sobra
  (`porta-sesmt-propria.ts`).
- **DDL opcional:** `ajuste_ponto.data_referencia` para o dia do abono.

## Pedido adicional (revisão)
- `RetificarAcidente.vue` (fora de qualquer lista): o campo `horasAntes` da CAT ainda tem `max-bytes=4` e não aceita `HH:MM`. Pedido de contrato registrado no `02-pessoas-2.json` (prioridade alta): `max-bytes=5` ou componente de duração, com teste da tela.
