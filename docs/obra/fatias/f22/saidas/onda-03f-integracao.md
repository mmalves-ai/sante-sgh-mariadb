# Integração da onda 3 das ondas finais da F2.2 (lotes 03-01 a 03-16)

- **Módulos ligados** (`REGISTRO_MODULOS`, 49 no total): entram cirurgia, pessoas, portal-paciente, suprimentos,
  telemedicina e tiss.
  - `pessoas/modulo.ts` (novo, do integrador): 24 controllers e 15 portas pela regra do F2-L (própria com núcleo;
    memória só em dev/ci; indisponível fora disso). Cifra do CPF pela chave do ambiente; sem chave fora de dev/ci, as
    portas que leem/gravam CPF (pessoas, ponto, folha) ficam indisponíveis. Opções de teste tipadas
    (`OpcoesModuloPessoas`); `criarAppPessoas` sobe o módulo pelo `registro` e confere que cada porta chegou.
  - `cirurgia/modulo.ts` passa a global (o OPME e a manipulação do suprimentos leem a PORTA_CIRURGIA; sem isso o boot
    com `todos` caía).
- **Typecheck cumulativo:** `tsconfig.migrado.json` 1116 → 1445 arquivos (fecho dos 16 lotes, mais pessoas/modulo.ts
  e folha.spec.ts; arquivos apagados pelos lotes saíram).
- **Apagados:** `suprimentos/licitacao-porta-legado.ts` (sem uso; a licitação fica sem porta própria e sem rota, ver
  avisos) e `pessoas/treinamento/treinamento-modulo.ts` (absorvido pelo modulo.ts).
- **Código ajustado:** specs HTTP do pessoas (f6, folha, cálculo, fechamento, férias, integração, rescisão,
  avaliação, solicitações) sobem pelo `criarAppPessoas`; ficha do colaborador: `situacaoLegado` (código S/N do
  sistema de origem) → `situacao` neutra no contrato, no serviço, na tela e no e2e m52-1; lotação com centro de custo
  opcional na tela de colaboradores; registro.spec/app-base.spec usam `contabil` como não migrado; lint (expressões
  com vírgula viraram blocos; assinaturas de porta pendentes de modelo com a diretiva e o motivo).
- **DDL:** nenhum pedido aplicado nesta integração (83 pedidos nos saida/03-*.json; o código correspondente responde
  `modelo-pendente`, 409, com o motivo). Lista nos avisos da integração.
- **Conferidor `--estrito`:** ok em 15 lotes; 03-13 só falha em `licitacao-documento.int.spec.ts` (S3 local 500 ao
  gravar com retenção; ambiente, igual à onda 2).
- **Provas:** tsc 0 (migrado e login); vitest API 316 arquivos, 2075 verdes e 19 pulados; núcleo 73; web pessoas 39;
  vue-tsc 0; eslint dos arquivos tocados 0; validar_migracoes 0 erros (3583 tabelas, 13728 FKs); `/api/saude` 200 após
  subir-login com API_MODULOS=todos.
- **Legado restante:** 323 imports em 262 arquivos (apps/api 19: contabil, portal-medico e app.module.ts), 0 no fecho do
  login.
