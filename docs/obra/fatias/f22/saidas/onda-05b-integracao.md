# F2.2 onda 5b: integração (lotes 05-01, 05-09, 05-13), tentativa 1

- **Lotes:** partida comum dos testes de integração sobre o núcleo (05-01), desmontagem do boot antigo e
  ferramentas de implantação e contabilidade sobre o banco próprio (05-09), entrega financeira e publicação de
  catálogos do worker sobre o MariaDB (05-13). Nenhum módulo novo no registro.
- **DDL aplicado** (ADR 0002, só para frente; validar_migracoes 0 erros, 3605 tabelas, 13802 FKs; aplicado aos 10
  clientes de dev e teste: teste_catalogos, teste_nucleo, teste_login, demo, f22_o1 a f22_o5 e f22_o5_b):
  - `17_INTG/06_tabelas.sql` e `06_chaves.sql`: `carga_catalogo.aprovada_como_sessao_suporte_id` e
    `aprovada_como_acao_suporte_id` (FK para `sessao_suporte` e `sessao_suporte_acao`; CHECK: ação só com sessão);
    tabela nova `item_catalogo_licenciado` (por estabelecimento licenciado, FK para `estabelecimento` e
    `licenca_catalogo`; UNIQUE por estabelecimento, catálogo, código e edição; CHECK de catálogo, preços e fator),
    registrada no catálogo do modelo.
- **Outros pedidos aplicados:**
  - worker: 11 arquivos de 05-13 no `apps/worker/tsconfig.migrado.json`;
  - package.json sem `formularios:converter`, `pep:conferencia` e `implantacao:ensaio`;
  - apagados os órfãos `tools/formularios/` e `tools/implantacao/src/ensaio-regras*`/`ensaio-relatorio*`, e os
    perfis da cópia `registro-clinico-perfil.int.spec.ts` (+ massa) e `m34-protolife.int.spec.ts` (ADR 0003);
  - guardas-legado sem as exceções de arquivos apagados; exceção M60.3 para os dois anexos de privilégios do
    `papel_aplicacao`; manual com o anexo `privilegios-plataforma.sql`; comentário do verificar;
    anexos de implantação regenerados (`docs/implantacao/anexos/`);
  - `sem-coexistencia.pendentes` sem `app.module.ts`; conferidor roda também os specs de `tools/`;
  - instalação: campo do manifesto `scriptsSgh` → `migracoes`; catálogo de variáveis com as 14 chaves do banco
    próprio e sem as 28 chaves obsoletas (FB_*, coexistência, combinação de senha do sistema anterior);
  - enfermagem: a vigia da contenção vencida, que só o boot antigo ligava, nasce no módulo sobre o núcleo
    (estabelecimentos ativos do CLIENTE_PADRAO; `ENFERMAGEM_VIGIA_CONTENCAO=nao` desliga).
- **Não aplicados:** ver os avisos da devolução (fechar o censo, prova de imutabilidade clínica, ramo licenciado do
  escrita-catalogo, tsx do contabil:reprocessar, regras contabilizadas, mover catálogo de operações, religar
  serviços do worker-raiz, decisão da ocupação CBO, regraFarmacia na tela).
