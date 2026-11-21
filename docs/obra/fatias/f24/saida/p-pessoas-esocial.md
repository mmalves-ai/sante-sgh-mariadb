# Lote p-pessoas-esocial (F2.4, 3ª etapa)

## O que mudou
- **eSocial, parâmetros do empregador por vigência** (`esocial/porta-esocial-propria.ts`): leitura e gravação reais em
  `cadastro_empregador` + `cadastro_empregador_motivo_afastamento`, pelo Executor (gravação direta com trilha), dentro da
  mesma transação da regra do transmissor único. Cada parâmetro na sua coluna: classificação tributária pelo catálogo
  oficial (tabela 8), FPAS pelo catálogo, sindicato pela pessoa jurídica do CNPJ, FAP em DECIMAL(5,4), indicativos no
  vocabulário do modelo, de-para do motivo de afastamento por vigência. Recusas: `vigencia-repetida`,
  `catalogo-pendente`, `cadastro-pendente`, `cadastro-ambiguo`, `parametros-invalidos`, `outro-estabelecimento`.
  Com isso a geração de eventos e a conciliação, que dependem da vigência, deixam de recusar.
- **eSocial, conferência da conciliação:** a linha guarda e relê a situação exata (seis situações do CHECK novo); a
  recusa `modelo-pendente` da linha divergente saiu.
- `porta-esocial-propria.int.spec.ts`: contrato de efeito dos parâmetros (colunas, autor, versão, releitura igual ao
  gravado, leitura na transação), seis recusas sem gravar e as quatro situações de linha relidas. 28/28 no cliente
  `f24p_pessoasesocial`; specs de unidade do eSocial 32/32; tsc da api 0 erros.
  - O estabelecimento sintético do spec usava código `F22-0305`, recusado pelo CHECK de formato num cliente novo:
    passou a `f220305`.

## Decisões pela melhor prática (para o dono ver)
1. **Leitura dos parâmetros da rede inteira** (como o CNPJ): o transmissor é único por raiz de CNPJ e a regra confere
   as vigências das outras empresas da raiz. A gravação só vale no estabelecimento da sessão.
2. **Linha migrada incompleta volta com o campo nulo** e o serviço a descarta pelo contrato. Nunca se inventa um valor.
3. **`indCoop` e `indConstr` nulos** ("não informado") recusam com `modelo-pendente`: as colunas são NOT NULL com
   padrão e gravar o padrão poria as tags no S-1000 (troca de sentido fiscal). Pedido de DDL (colunas anuláveis) no
   `.json`. A leitura já devolve nulo para coluna nula. Testes: recusa sem gravar e ida e volta de valores ≠ 0.
4. **A vigência anterior não é fechada** (`vigencia_fim` fica nulo): vale a mais recente que já começou, como no serviço.

## Pendências (pedidos em `p-pessoas-esocial.json`)
- Ficha do eSocial do vínculo: há troca de contrato da porta (sai a ficha cifrada inteira, entra a estruturada) e uma
  decisão do dono sobre escrever no cadastro da pessoa. Segue `modelo-pendente`.
- SESMT, dosímetro e quimioterápico: o contrato tipo + id (pedido do 02-pessoas-2). Segue `modelo-pendente`.
- Autoatendimento, efeito da aprovação: faltam os gravadores do ponto, da folha e do cadastro sobre a TxOperacao,
  ligados na composição (pedido do 01/03-pessoas). Segue `modelo-pendente`.
- Carregador do catálogo oficial do eSocial (tabela 8) e do FPAS.
- DDL: `cadastro_empregador.indicador_cooperativa` e `construtora` anuláveis. Até lá, parâmetros com um dos dois nulos
  (o padrão da tela) seguem `modelo-pendente`.
