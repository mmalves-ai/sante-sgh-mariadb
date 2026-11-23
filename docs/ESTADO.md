# ESTADO do sante-sgh

Atualizado em: 2026-11-20, 23:00. **Em andamento, sem parar** (dono). Retome por `docs/obra/passagens/RETOMADA.md`.

## Fase atual

| Fase | Marco | Status | Observação |
|---|---|---|---|
| F1 | F1.1 Matriz funcional MV × SPDATA × `new-sgh` | rodada 2 concluída e conferida: 3.500 tabelas próprias (F3 1.658, F7 1.105, F8 737); 8.867 do MV e 1.503 do SPDATA com destino (`docs/analise/rodada2/RESUMO.md`). Rodada 1: | 511 funcionalidades (F3 247, F7 109, F8 104, não fazer 51) e cerca de 1.376 entidades propostas (`docs/analise/RESUMO.md`). Aguarda o dono validar as arbitragens D1 a D13. A segunda rodada cobre qualidade e segurança do paciente e o vocabulário único |
| F0 | F0.1 a F0.3 | concluídos | git e remote (o push automático está bloqueado pelo classificador do Claude Code; o dono libera), modelo base `d3f8b5d` trazido sem o legado (`docs/obra/inventario-modelo-base.md`), MariaDB 12.3.3 em `127.0.0.1:3410` |
| F1 | F1.3 DDL das 3.500 tabelas | **concluído e conferido** | 3.500 tabelas, 69.578 colunas, 13.503 FKs, 0 erros no validador; conferência de qualidade em `docs/obra/conferencia-modelo.md`; `criar_cliente.py` cria o banco completo (3.505 tabelas) em cerca de 1 min |
| F1 | F1.4 catálogos públicos | **concluído** | IBGE, BCB, CID-10, SIGTAP (202611) e CBO; revisados; pendentes: topografia CID-O, significado dos tipos 4 e 5 de compatibilidade SIGTAP |
| F2 | F2.1 núcleo | **concluído** | `packages/nucleo`, 73 testes (commit `7067431`) |
| F2 | F2-L login pelo navegador | **concluído** | https://192.168.0.104:5310, admin da plataforma e usuário de teste no cliente `demo`; `tools/dev/subir-login.sh`; commit `9b0c83e` |
| F2 | F2.2/F2.3 demais módulos da API | próximo | 518 arquivos ainda importam `@sgh/legado` (após a onda 4); meta `tools/obra/contar-legado.sh` = 0 |

## Quadro de fases

| Fase | Status |
|---|---|
| F0 Fundação | concluída |
| F1 Análise cruzada e modelo | concluída (pendências pequenas) |
| F2 Núcleo e persistência | em andamento (F2.1 e F2-L concluídos) |
| F3 Cobertura funcional melhorada | pendente |
| F4 Conector | pendente |
| F5 Ferramentas de homologação e virada | pendente |
| F6 Virada | operação do cliente (ADR 0003) |
| F7 Serrano e hospital do zero | pendente |
| F8 Recursos novos | pendente |

## Decisões registradas

- **conta-itens-3, material e medicamento na conta (2026-11-23, proposta B):** o item da tabela de preço de
  mat/med (TBMATMED) grava o item faturável do cliente (`item_faturavel.item_referencia_matmed_id`), e o item da
  conta (FCLANEXT TIPO 4) liga por ele. A origem não separa material de medicamento: o item entra como `material`
  presumido (`opme` quando OPM=S) e o grupo de faturamento por tabela como `material` presumido, ambos visíveis para
  o cliente reclassificar. **Clientes já carregados** (execuções anteriores da ProntoCardio): o Importar ou o
  Sincronizar seguinte completa o item faturável das linhas de TBMATMED já gravadas (`secundarias_completadas`,
  principal intocado); as linhas de FCLANEXT recusadas com 1048 só voltam com o reprocessamento de FCLANEXT depois
  disso (ou carga nova). Ligação ao estoque (proposta A, GEITENS) descartada.

- **ADR 0003** (aceito em 2026-11-20): F3 é cobertura melhorada; F8 sem esperar virada; conector só por comando do admin sobre cliente zerado.

- **ADR 0002** (aceito em 2026-11-20): respostas do dono às 24 decisões; princípios do modelo (convenções do DDL).

- **ADR 0001** (aceito em 2026-11-20): banco próprio em MariaDB 12.3, modelo base do `new-sgh` trazido para
  cá, conector diferencial, operação dia 0, dia 1 e dia 2+n.

## Pendência registrada da F2.2 (onda 4, fila do médico M27)

- **"Resultado novo" degradado:** a fila do médico devolve `vistoPeloMedico` sempre falso até a porta própria dos
  documentos gravar `visualizacao_resultado_exame` (tabela criada na onda 4) na abertura do resultado e a fila ler dela.
- **Sem prova no banco próprio:** a regra 2 do M27 (vínculo assistencial) e o p95 < 1,5 s da fila PENDENTES. O
  `worklist-medico.autorizacao.int.spec.ts` usa dublê do painel; a prova vem com a porta própria dos documentos.
- Detalhe em `docs/obra/fatias/f22/saidas/onda-04-integracao.md`.

## Pendência registrada do F2-L (login pelo navegador)

- **Decisão (b) ligada** (revisão do lote 5, 2026-11-20): o administrador da plataforma entra pelo
  `POST /api/sessao/plataforma` (opção "Sou administrador da plataforma" na tela de entrada), com a credencial
  argon2id do banco plataforma (`db/plataforma/0002`) e todas as permissões só no cliente desta API.
  - O `@sgh/nucleo` ganhou `lerPlataforma`/`escreverPlataforma` (`PoolsPorCliente.fontePlataforma`).
  - O login da plataforma é só ASCII minúsculo (`[a-z0-9._-]`), no contrato e no CHECK. As senhas erradas
    contam pela credencial no banco plataforma: no limite (5), `bloqueado_ate` fica armado por 15 min, e o
    login certo zera a contagem.
  - A sessão relê a credencial a cada 3 minutos. Administrador inativo, removido ou com outra senha perde a
    sessão. O bloqueio por tentativas não derruba sessões vivas: impede só entradas novas.
  - Na troca de senha, o evento vai para `cliente_evento` na mesma transação e para a trilha do cliente, e as
    outras sessões do administrador são encerradas.
  - A sessão traz `usuario.ator = 'plataforma'` e um `usuario.id` não numérico (`plataforma:<id>`). A quebra de
    vidro recusa esse ator.
  - Os logins de usuário do cliente não podem ter `:` (`esquemaLogin` e `ck_usuario_login_sem_dois_pontos`). Os
    bancos de cliente já criados não recebem esse CHECK sozinhos, e o conector precisa tratar como pendência um
    login de origem que tenha `:`.
- **Falta, por decisão do dono: segundo fator do administrador da plataforma.** A sessão dele abre só com a senha,
  sem TOTP, embora seja a conta que pode tudo em qualquer cliente. O dono precisa escolher entre exigir o TOTP
  (segredo no banco plataforma e `codigoSegundoFator` no contrato) e dispensá-lo, com registro.

## Decisões pendentes (do dono)

1. **"Vetorização de-para":** confirmar que é sugestão por similaridade com aprovação humana.
2. **Isolamento entre hospitais:** banco por hospital (recomendado) ou coluna de estabelecimento. Decidir
   antes da F1.3.
3. **Commit de partida do `new-sgh`** para a F0.2.
4. **Dump do MV:** registrar a origem e a autorização de posse; apagar os dados do volume Oracle e manter
   só o metadado.
5. **`git init`** desta pasta (F0.1).

## Ambiente

- **Oracle de referência:** `sante-sgh-oracle` no ar, com o dump do MV carregado parcialmente no 23ai Free
  (limite de 12 GB; 172.981 linhas recusadas por conversão de charset). Só metadados interessam.
- **MariaDB de desenvolvimento:** ainda não criado (F0.3).

## Diário

- **2026-11-19 e 2026-11-20:**
  - Oracle Free montado e dump do MV importado: o arquivo da `sante-api` estava truncado, e a cópia
    completa veio do cache do VMware.
  - Avaliação do `new-sgh`: cinco leituras e parecer.
  - ADR 0001 escrito, revisado por três lentes (43 achados) e aceito.
  - Fases F0 a F8 escritas.
  - Análise cruzada iniciada.
