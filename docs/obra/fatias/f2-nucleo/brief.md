# Brief da F2.1: `packages/nucleo` sobre o MariaDB

**Projeto:** `/home/mmalves/workspace/redesante/sante-sgh`. É um monorepo Nx + pnpm vindo do `new-sgh`:
- sem `package.json` por pacote: há um só, na raiz;
- cada pacote tem `project.json`, `tsconfig*.json` e `vitest.config.ts`;
- os aliases `@sgh/*` ficam em `tsconfig.base.json`.

## Objetivo

Criar o **`packages/nucleo`** (alias `@sgh/nucleo`): a infraestrutura neutra que a API e o worker usam para
operar sobre o **banco MariaDB do cliente**, no lugar do núcleo que morava dentro do antigo
`packages/legado`. **Nada de Firebird nem de SPDATA.**

## Leia

- `docs/obra/passagens/F2-plano.md`: o destino de cada arquivo e os símbolos mais usados.
- `referencias/legado-nucleo/`: o núcleo original, fora da compilação. Leia **só** os arquivos que a passagem
  manda manter ou reescrever.
- `docs/adr/0002-decisoes-do-dono-e-principios-do-modelo.md`, parte 2: convenções do banco (auditoria,
  versão, trilha, sequência de negócio).
- `db/migracoes/00_NUCLEO/00_nucleo_tabelas.sql`: as tabelas `trilha_auditoria`, `sequencia_negocio`,
  `pendencia`, `integracao_mensagem` e `arquivo`.
- `tools/db/criar_cliente.py`: o banco de cada cliente é `cliente_<codigo>`, registrado em
  `plataforma.cliente`.

## O que entregar

1. **Driver:** `mariadb` **3.5.5**, versão exata, em `dependencies` do `package.json` da raiz. Depois,
   `./pnpm install` (nunca `npm` ou `npx` soltos).
2. **`packages/nucleo/src`:**
   - **Pool por cliente:** a conexão vem da plataforma (`plataforma.cliente.banco_nome`), uma por banco de
     cliente, com cache. A configuração (host, porta, usuário, senha) vem de variáveis de ambiente. Para
     desenvolvimento: `127.0.0.1:3410`, usuário `root`, senha em `MARIADB_SENHA` do `.env` (leia o arquivo
     pelo código; **nunca imprima o valor**).
   - **`Leitor` e `Escritor`,** com a mesma ideia de interface do legado, sem os tipos do SPDATA. A
     transação usa `SELECT ... FOR UPDATE` quando pedido, e a trava otimista usa a coluna `versao`.
   - **`Executor` de operações**, com o protocolo mantido do legado:
     - contexto (usuário, estabelecimento, correlação);
     - idempotência por chave;
     - **trilha** em `trilha_auditoria` e outbox em `integracao_mensagem`, **na mesma transação** da gravação;
     - erros tipados (`ErroOperacao` e afins).

     Sai: "gravar como o SPDATA", prova por gatilho, codec CP1252.
   - **Números de negócio** pela `sequencia_negocio` (`SELECT ... FOR UPDATE` e incremento), por
     estabelecimento.
   - **Auditoria automática** nas gravações: `criado_em`, `criado_por`, `alterado_em`, `alterado_por`,
     `versao`.
   - **Neutralização** fora de produção (o `trava-saidas` do legado): o envio externo só existe com a chave de
     ambiente de produção.
   - **Fachada `NucleoProprio`,** no lugar do `NucleoLegado`, com a mesma função de ponto único de entrada.
3. **Testes com Vitest:**
   - **Unitários:** executor, erros, idempotência e trava otimista, com um banco dublê.
   - **Integração contra o MariaDB real:**
     - criar um cliente de teste com `python3 -I tools/db/criar_cliente.py teste_nucleo "Teste do núcleo"`,
       se ainda não existir;
     - gravar um registro numa tabela simples do modelo, por exemplo um domínio;
     - conferir a auditoria, a trilha, o número de negócio e o conflito de versão.
4. **Alias:** `@sgh/nucleo` no `tsconfig.base.json`.
5. **Não troque ainda os imports da API** (isso é a F2.2). Entregue o pacote compilando e testado.

## Comandos

- `./pnpm exec tsc -p packages/nucleo/tsconfig.lib.json --noEmit`
- `./pnpm exec vitest run --config packages/nucleo/vitest.config.ts`
- Sempre pelo wrapper `./pnpm`.

## Regras

- Código e comentários em português, como no `new-sgh`.
- **Nada de dado pessoal.** Não imprima segredos.
- **Disco:** confira o espaço antes de instalar algo grande. Mínimo de 120 GB livres.
- **Protocolo de tokens:**
  - leia por partes (`grep -n` e `sed -n`);
  - saídas longas de teste e compilação, para arquivo, lendo só `tail`;
  - devolva só o resumo.
