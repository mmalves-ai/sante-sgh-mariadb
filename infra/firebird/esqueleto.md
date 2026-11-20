# Esqueleto do banco para o CI (entrega futura)

O CI **nunca** recebe cópia com dados reais (DP-41 vale só para `dev`; `convencoes.md` §10 e §11). O banco
do CI é o **esqueleto**: o mesmo modelo do SPDATA, sem nenhum dado de paciente. Este arquivo descreve o
que ele é e como será gerado; **nada dele existe no repositório ainda**, e nenhum `.fbk`, `.fdb`, dump ou
extração de dado real entra no git (o `.gitignore` recusa `*.fbk` e `*.fdb`).

## Composição

1. **Metadados**: backup só de metadados da cópia de dev (`gbak -b -m`), com tabelas, domínios, índices,
   triggers, procedures, generators e as declarações das funções externas (`ib_udf` e `VLR_MED`). As
   contagens têm de bater com o BRIEF §3 (3.756 tabelas, 2.538 triggers dos quais 2.511 ativos, 181
   procedures, 2.046 generators), conferidas por `pnpm copia:restaurar -- --hospital=<cod> --conferir`.
2. **Tabelas de domínio e configuração**: só as de natureza domínio e configuração da matriz (códigos,
   tipos, parâmetros como `REPARAM`, `RIPARAM`, `TBGERSEQ`, `TBNACION`), exportadas por lista explícita
   e revisada pelo responsável técnico. Nenhuma tabela com dado de pessoa (paciente, profissional,
   usuário, beneficiário) entra, nem coluna livre que possa conter nome, CPF, prontuário ou texto
   clínico. As configurações de saída (`TBINFBANCO`, `TBTISSWEBSERV`, `SITPEQV`, `PREMAILCFG`) entram já
   neutralizadas, com os mesmos destinos de teste da cópia de dev.
3. **Massa sintética**: gerada por `packages/testes` (fábrica de cenários), com nomes e documentos
   inventados e marcados como sintéticos, nunca derivados de dado real.

## Como será gerado (quando a esteira do CI subir, DP-15: "CI com cópias" fica para o deploy)

- Script versionado que, a partir da cópia de dev neutralizada, extrai os metadados (`gbak -b -m`) e as
  tabelas da lista do item 2, cria um banco novo vazio, aplica os dois e roda a massa sintética.
- O resultado vai para um artefato do CI (efêmero), nunca para o git.
- Conferência no CI: catálogo igual ao BRIEF §3, `pnpm ambiente:verificar` verde e a prova dos triggers
  (`pnpm testes:integracao`) passando sobre a massa sintética.
- Revisão humana da lista do item 2 antes do primeiro uso (dado pessoal é a fronteira).

Enquanto isso, os testes que precisam de banco rodam só nesta máquina, sobre a cópia de dev
(`../banco-dev`), e o CI roda os testes unitários.
