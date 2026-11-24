# Orçamento: fecho-1

estimativa_M: 62
teto_M: 81

- **Sobras medidas da f3-motores (24/11, 06h; integrador 7b7918d9, 36f4e6ea):** limpeza das massas dos .int.spec
  que apagam trilha_auditoria sem apagar antes trilha_cadeia/trilha_auditoria_fecho (farmácia e outros, erro 1451);
  adt/internacao/atendimento sem rodar depois das ligações; adt/fluxo-paciente.int.spec.ts escrito e nunca rodado;
  E2E pela tools/obra/e2e-vm.sh não rodado, entrar.spec (@M05) com seletor-estabelecimento duplicado, falta o script
  e2e:vm; glosa/estorno/transferência do item não disparam sincronizarProducaoDaConta (a glosa roda no worker, que
  não importa apps/api); lançamento por profissional e RPA não abatem o débito do repasse; o gerador de privilégios
  não resolve constantes importadas de outro módulo (TABELAS_PRODUCAO_CONTA) e deixa passar.
- **Sobras do banco próprio (recontagem de 24/11 04h):** SUS montagens restantes; qualidade (gestão restante);
  folha (período aquisitivo, obrigações oficiais); SAE terminologias; cadastro gravarProfissional; pessoas
  incluirDependente; recusa-senha.int.spec criando cliente na plataforma da VM.
- **Decisões do orquestrador (prática de mercado, regra 5 da memória regras-de-mercado):**
  - Férias: período aquisitivo **por vínculo** (cada contrato de trabalho tem o seu; 12 meses de vigência; faltas
    injustificadas reduzem os dias pela CLT art. 130).
  - Obrigações acessórias: o catálogo oficial vigente é eSocial, EFD-Reinf, DCTFWeb e FGTS Digital. SEFIP, CAGED e
    RAIS entram como obrigações **encerradas** (substituídas), só para histórico e consulta, sem gerador de arquivo.
  - Enfermagem: terminologias (NANDA-I, NIC, NOC, CIPE) com chave única por sistema + código + edição, nunca só pelo
    código. NANDA-I, NIC e NOC são licenciadas: o produto traz a estrutura e o carregador versionado da edição
    licenciada (ADR 0006, espelho padrão), sem conteúdo licenciado no repositório.
  - Suporte previa/corrigir: continua falha fechada (409) até desenho próprio.
- **Rodada:** 10 famílias em linha de produção e 2 integradores (A: motores, E2E, privilégios, limpeza de testes;
  B: SUS, qualidade, folha, SAE, cadastro, pessoas, sessão).
- **Agentes:** 10 × 2,7 + 10 × 0,6 + 10 × 1,1 + 2 × 3 = 50 M; × 1,2 = **60 M**, arredondado a **62 M** pelo integrador
  A maior; teto **81 M**.
