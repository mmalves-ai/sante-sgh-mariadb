# F2.4 lote 17-misto-internacao (internação, repasse, configuração)

Dívida do lote zerada (`divida_f24.py`: nenhuma linha nos 29 arquivos). Autoconferência: tsc da API e testes vizinhos
verdes; restam só 2 erros de tsc da web em `apps/web/src/modulos/qualidade/*-telas.spec.ts`, de outro lote.

## O que mudou
- **Hora da internação em "HH:MM"** de ponta a ponta:
  - contrato: `adt.ts` usa `esquemaHora` em `horaSaida`, `previsaoSaida` e `horaPrevista`;
  - movimento: `fonte-propria` e `fonte-memoria` entregam `"HH:MM"`;
  - domínio: `minutosDaHora` (`tempo.ts`) aceita só `"HH:MM"`, e a hora vazia vale meia-noite. Formato inválido é
    recusado (`hora.formato`) em vez de virar 0;
  - API: `adt/operacoes.ts` usa `dataHoraParaInstante` e `adt/porta-memoria.ts` converte na entrada;
  - web: `AltaTela` e `PreInternacaoTela` mandam o valor do campo de hora sem `paraHhmm`;
  - testes: massas do domínio da internação em `"HH:MM"`.
- **`destino: 'legado'` saiu do painel de leitos.** Agora é `'banco' | 'memoria'` em `painel.ts`,
  `contratos/internacao/leitos.ts`, `internacao/fonte.ts`, `internacao/servico.ts` e `adt/servico.ts`.
- **Repasse, `modelo-pendente`:** a regra por profissional é gravada em `regra_repasse_item.profissional_id`, coluna
  que já existe no DDL. A leitura devolve `profissional`. O int spec agora cobre a inclusão e as recusas novas.
- **Repasse, horas em "HH:MM":** na porta de memória, no serviço e nas massas do domínio. A porta própria já usava esse
  formato.
- **Auditoria:** `tabelaAlvo` do paciente do leito passou a ser `internacao`.
- **Comentários:** os nomes de origem foram trocados pelo termo de negócio (internação, repasse e configuração).

## Decisões pela melhor prática
- **Prestador e profissional na inclusão da regra:** o prestador é o profissional (id). Se os dois vierem diferentes,
  a regra é recusada (`profissional-divergente`). Profissional inexistente também é recusado
  (`profissional-inexistente`).
- **`diariasFaturaveis` (contrato) compara a hora pelos dígitos.** Assim aceita `"HH:MM"` e ainda aceita os chamadores
  do lote 16 (`adt/porta-propria`), que mandam a hora de quatro dígitos vinda do relógio.
- **Domínio da internação:** hora fora do formato é recusada com exceção (`hora.formato`), nunca vira meia-noite em
  silêncio.

## Pedidos e avisos
- **Arquivos fora da lista tocados, todos sem lote**, para fechar o contrato de ponta a ponta:
  - `apps/api/src/modulos/internacao/{fonte,fonte-memoria,servico}.ts`;
  - `packages/contratos/src/internacao/leitos.ts`;
  - `apps/api/src/modulos/adt/{operacoes,porta-memoria,servico}.ts`;
  - `apps/web/src/modulos/adt/telas/{AltaTela,PreInternacaoTela}.vue`.
- **Lote 20, `exames/relogio.ts`:** `fonte-propria.diaEHora` lê `civil().hhmm` com ou sem os dois-pontos. Se a
  propriedade `hhmm` for renomeada, ajustar esse uso.
- **Lote 16, `adt/porta-propria.ts`:** ao passar a hora para `"HH:MM"`, também `adt/porta-memoria` (estado interno de
  quatro dígitos) e `adt/servico.ts` (`horaSaida ?? '0000'`) podem migrar. Feito isso, `diariasFaturaveis` pode
  exigir `"HH:MM"`.
- **Teste instável:** `config/dominios-propria.int.spec.ts` (fora do lote) estourou uma vez o tempo de consulta de
  15 s. Rodado de novo, passou.
