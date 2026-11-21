# F2.4, lote 08-cirurgia: resultado

## O que mudou
- **Nomes do sistema de origem (todos os 25 arquivos):** comentários reescritos com o termo de negócio
  (agendamento cirúrgico, registro profissional, cadastro de tipos de anestesia...). A trilha de leitura da agenda
  (`tabelaAlvo`) passou a usar a tabela real, `agendamento_cirurgico`, na API e no spec.
- **Hora do dia "HH:MM" de ponta a ponta no centro cirúrgico:**
  - contrato `cirurgia/entradas.ts` com `esquemaHora`;
  - domínio `tempo.ts` com `horaDeMinutos` e `minutosDaHora`, em lugar das funções de quatro dígitos; `registro.ts`,
    `mapa.ts` e `checklist/trava.ts` em "HH:MM";
  - API: `porta-memoria.ts` e `banco-apoio.ts`;
  - specs do domínio e da API ajustados.
- **Portal do médico externo no banco próprio** (DDL 08_CC/04 e 20 já aplicado):
  - `estadosDoPortal` lê pela conta do portal;
  - `versoesDosPedidos` lê `agendamento_cirurgico_versao`;
  - pedir pelo portal grava `canal_solicitacao = 'portal'`, a conta, o nome e o nascimento informados;
  - retirar cancela o pedido com histórico e confere a conta;
  - alterar guarda a versão anterior e confere a versão vista (`conferirAlteracaoPedido`).
  - Teste de integração novo: pedido, alteração, versão velha recusada, outra conta recusada, retirada.
- **Marcação "no bloco":** a situação `no_bloco` passou a valer no domínio (`agenda-modelo.ts`) e na API, ocupando a
  sala. O andamento confirmado → no bloco → em sala → realizado está testado no banco.
- **Painel da família:** `codigos()` lê `codigo_painel_familia`. Antes devolvia o mapa vazio.

- **Rodada de correção:**
  - `PARTES_FICHA` sem as tabelas antigas (`tabelaSgh`, `referencia`): todas as partes gravam em
    `lancamento_ficha_anestesica`, coluna `parte`; spec ajustado.
  - `RECURSOS_SALA` sem a coluna de origem: o código interno do recurso é o `campo` de negócio (API, memória e banco).
  - Mapa cirúrgico: `destino` passa de `'legado' | 'memoria'` para `'banco' | 'memoria'`, como nos outros módulos.
  - Comentários com tabelas antigas (`SGH_CC_*`, `PRFA_*`) e a sigla REG reescritos com o termo de negócio.

## Decisões pela melhor prática (para o dono ver)
- A versão guardada do pedido do portal (`agendamento_cirurgico_versao.dados`) é um JSON com sala, início, duração,
  procedimento, convênio, observação e paciente informado, os mesmos campos que a tela mostra.
- A retirada pelo portal grava a situação `cancelado` com o complemento como justificativa do histórico, sem motivo
  de suspensão (quem retira é o médico, não o bloco).
- As gravações da APA, da ficha, da SRPA, do checklist e do rastreio **continuam recusando** (409 com o motivo). A
  estrutura já existe, mas sem a chave de idempotência da requisição no `gravarSgh` o reenvio gravaria em dobro. A
  idempotência é do núcleo, e não se cria coluna de chave em tabela de negócio.

## Pendências (ver 08-cirurgia.json)
0. Equipe em pares com chaves de coluna da origem (`ID_CRM`...): troca coordenada com o OPME (suprimentos).
00. Verificador cego para `PRFA_`, `SGH_CC_`, `ID_*` e `z.enum(['legado'])`.
1. DDL do ato: ASA, pressão, pulso, dispositivos usados e especialidade por procedimento. Até lá, o registro do ato
   pela tela segue 409 com o motivo exato.
2. Apoio comum: a chave de idempotência no `gravarSgh` do M18. Depois disso, os gravadores da anestesia (12 métodos) e
   do bloco seguro (9).
3. ~~Lote 12: `horaDoContrato`~~ resolvido: o `formato.ts` da web já devolve "HH:MM" (conferido nesta rodada).
4. Lote 21: o contrato do portal em "HH:MM". Depois disso, `horaDe` fica estrito.
