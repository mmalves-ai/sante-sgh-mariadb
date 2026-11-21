# Conferência das portas da F2.4 (3ª etapa, 2ª volta)

Data: 2026-11-21. Cliente de teste: `f24q_conferir`.

## Correções pequenas aplicadas

- **Numerações** (`tools/db/configurar_numeracoes.py`), pedido de `p2-suprimentos-farmacia`: entraram
  `ordem_manipulacao` e `solicitacao_opme`. As portas próprias da manipulação e do OPME já pedem esses números
  (`proximoNumero`), e sem a numeração a gravação recusava com `sequencia-nao-configurada`.
- **Teste do portal do médico externo** (`portal-medico/portal-medico.spec.ts`): o autocadastro passou a exigir o CPF
  nesta volta (contrato do SADT e `aplicacao/portal.ts`), e o spec do portal ainda mandava o cadastro sem ele (400).
  Agora manda um CPF sintético válido.

## Verificações (colhidas)

| Verificação | Resultado |
|---|---|
| tsc: api (padrão, migrado, login), worker, web, contratos e núcleo | 0 erros |
| ui (`vue-tsc`, como no `project.json`) | 0 erros (o `tsc` puro dá 4 falsos erros de props em `.vue`) |
| vitest de unidade: worker 155, núcleo 73, contratos 829 | verde |
| vitest de unidade da API: 323 arquivos, 2136 testes | verde depois da correção do spec do portal (antes: 1 arquivo falhava) |
| integração da API: 39 arquivos nas pastas tocadas, 191 testes | 185 passam; 1 falha de **ambiente** (abaixo) |
| `validar_migracoes.py` | ok (3668 tabelas, 0 erros, 0 gatilhos) |
| `contar-legado.sh` | 0 imports |
| `divida_f24.py --falhar-se-pendente` | **falha: 16 arquivos de modelo-pendente** (eram 24) |

### Falha de ambiente

`suprimentos/licitacao-documento.int.spec.ts` recusa com 503. A causa é o S3 local (`sgh-s3`), que está sem volumes
graváveis: cada execução de teste cria um bucket novo, e o servidor de objetos chegou ao limite (`No writable volumes`).
O código não mudou. Para resolver, é preciso limpar os buckets de teste `sgh-teste-*` ou aumentar o limite de volumes do
container. Apagar é ação irreversível, então fica para o dono decidir.

## Dívida que sobra (16 arquivos, todos de construção)

| Grupo | Arquivos | O que falta (detalhe nos `p2-*.json`) |
|---|---|---|
| Pessoas | `autoatendimento/porta-propria`, `banco-apoio`, `esocial/porta-esocial-propria`, `folha/porta-calculo-propria`, `sesmt/porta-sesmt-propria` | Processamento da folha (37 operações), ficha estruturada do eSocial, contrato do registro de proteção do SESMT, gravadores do ponto, das férias e do cadastro para o autoatendimento |
| Qualidade | `apoio-propria`, `porta-gestao-propria`, `porta-propria`, `seguranca.controller` | Construção das portas de gestão e de segurança e as sementes da CCIH |
| Operadora | `apoio-porta-propria`, `autorizacao-porta-propria` | Porta de armazenamento de arquivos (ADR 0004) |
| Clínicos | `enfermagem/sae-porta-propria`, `especialidades/porta-propria`, `sadt/porta-propria`, `sus/porta-propria` | 7 gravações da SAE, oncologia, 10 operações do SADT com contrato novo, cerca de 40 métodos do SUS |
| Suprimentos | `operacoes` | Etapas da solicitação de OPME e o vínculo do pedido ao contrato (DDL pedido) |
