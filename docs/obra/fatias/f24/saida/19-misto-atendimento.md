# F2.4, lote 19-misto-atendimento (atendimento, integração, custos e consultas)

## O que mudou
- **Custos (modelo-pendente zerado):** a porta própria agora lê e grava o que respondia "modelo-pendente", sobre as
  tabelas que já existiam (`coleta_estatistica_custo`, `estatistica_centro_mes`, `apuracao_custo`,
  `apuracao_custo_centro`, `custo_conta_paciente`):
  - fontes da coleta: censo fechado, ocupação dos leitos (paciente-dia estimado), atos cirúrgicos, exames das contas,
    requisições ao estoque, vínculos com lotação e leitos;
  - coleta gravada e relida (`ultimaColeta`); a estatística relida traz `estimada`, `idColeta` e `observacao`;
  - fontes do custeio: saídas e devoluções do estoque (atípica acima do limite por linha), despesas do financeiro
    (rateio, senão título), proventos da folha e o faturado por conta fechada × centro, com glosa e recurso acatado;
  - apuração gravada (linhas por centro e custo por conta), lida, listada, agrupada, substituída pela versão lida e
    aprovada. A função `modeloPendenteCustos` saiu.
  - Integração no MariaDB (cliente `f24_19mistoatendimento`): 9 testes, entre eles coleta, fontes e apuração.
- **Integração:** o padrão de troca ausente recusa com `padrao-troca-nao-cadastrado` (é cadastro, não modelo). O
  efeito da suspensão do convênio aponta `fonte_pagadora_estabelecimento.situacao`, a tabela que a porta grava.
- **Vocabulário:**
  - impressos: `retorno: 'S' | 'N'` virou `soNoRetorno: boolean`;
  - teleconsulta: o relógio passou a `{ hoje, hora: 'HH:MM' }` e `minutosCivis` usa `horaParaMinutos` (hora inválida
    é recusada); a telemedicina, do lote 21, já entrega `hora`;
  - custos: a duração da cirurgia chega em minutos (`minutos: number | null`), e `duracaoEmMinutos` (HHMM) saiu.
- **Nomes de origem:** os alvos da trilha do atendimento são `marcacao_horario`, `paciente` e `atendimento`. Os
  comentários foram reescritos com termos de negócio.

## Decisões pela melhor prática (para o dono ver)
- Situação da apuração no banco: apurada = `apurada`; aprovada = `fechada` (com `aprovado_em` e `fechado_em`);
  substituída = `cancelada` com `substituida_por_apuracao_custo_id`. Uma versão nova por refazimento (`numero_versao`).
- Número, tipo, procedimento e prontuário da conta no custo por conta são lidos da conta atual, sem cópia.
- Duração da cirurgia = da incisão ao fim do ato realizado. Horas dos colaboradores = carga mensal do regime de jornada.
- Devolução atípica = devolução cuja linha passa do mesmo limite por linha das saídas.
- O código do centro usado pela coleta e pela apuração é o do cadastro quando é só dígitos; senão, o id (a mesma regra
  da leitura dos centros).

## Pedidos
- `19-misto-atendimento.json`: inventário de segredos com identificador próprio de ponta a ponta. Ele junta-se ao
  pedido do lote 07. As linhas 36 a 99 de `segredos-legado.ts` ficam até essa etapa.
- Fora da `.lista`, mexi nos vizinhos de pasta sem dono em outro lote: `custos/tipos.ts` e `custos/porta-memoria.ts`
  (a duração em minutos de ponta a ponta), e `dominio-custos/estatistica.spec.ts`.

## Correção da revisão (efeito da situação do convênio)
- O efeito declarado em `POST /acoes/convenios/situacao` (proposta e resultado) agora traz o valor que a coluna
  `fonte_pagadora_estabelecimento.situacao` guarda de fato: `ativa` → `suspensa` (ou o inverso). Antes trazia as
  letras do contrato externo (`A (ativo)` → `I (suspenso)`), que não correspondem ao que a porta grava.
- Decisão: `situacaoAtual`/`situacaoDepois`/`situacaoAnterior` continuam com `A`/`I`, porque são o contrato público da
  fachada (compatibilidade com quem já a chama); a tradução para o valor da coluna fica num mapa só, no domínio.
- `fachada.spec.ts` confere tabela, coluna, antes e depois nos dois tempos.
