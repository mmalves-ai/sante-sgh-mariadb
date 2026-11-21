# Orçamento: arquivos-local

estimativa_M: 21
teto_M: 27

- **Objetivo:** aplicar o ADR 0004. Todo arquivo fica no disco da máquina de hospedagem, a EC2 ou a máquina local do
  cliente, **sem S3** (dono: "ninguém usa S3").
- **Pronto quando:**
  - `@aws-sdk/client-s3`, `ClienteS3` e `S3_ENDPOINT` não aparecem mais no produto, nem nas dependências, nem na
    instalação;
  - os testes de PDF (documento, prescrição, laudo, contingência e licitação) ficam verdes com o `sgh-s3` fora de uso;
  - tsc e vitest verdes;
  - commit feito.
- **Ordem:**
  1. Compartilhado, sozinho: a porta `ArmazemArquivos` e o adaptador local em `packages/nucleo`.
     - A raiz é `ARQUIVOS_RAIZ`, com uma pasta por banco de cliente: o **mesmo** desenho que o conector já usa no
       `#arquivo` (`migracao/<hash>`).
     - Gravação uma vez: temporário, `fsync`, rename atômico, criação exclusiva e somente leitura.
     - Registro na tabela `arquivo`, que já existe (hash, tamanho, tipo, `retencao_ate`, `imutavel`).
     - Exclusão recusada antes da retenção.
     - Versão nova nunca apaga a antiga.
     - O vigia do worker confere o hash contra o registro.
     - Nos testes, uma pasta temporária por `SGH_CLIENTE_TESTE`.
  2. Três lotes de módulos, que migram para a porta:
     - documento, catálogos, integração, worker e instalação;
     - digitalização, fotos da portaria e da internação, portal do paciente;
     - TISS, financeiro, patrimônio e SUS.
  3. Conferidor.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado | 1 | 4,5 M | 4,5 M |
  | Construtor | 3 | 2,0 M | 6 M |
  | Revisor | 3 | 0,3 M | 0,9 M |
  | Corretor | 3 | 0,5 M | 1,5 M |
  | Conferidor | 1 | 3,5 M | 3,5 M |

- **Estimativa:** 16,4 × 1,2 ≈ 20 M, arredondada para 21 M. Teto: 27 M. `LIMITE_AGENTES` = 12. Valem o teto de 60
  turnos e a saída resumida.
