# Integração da onda 2 das ondas finais da F2.2 (lotes 02-01 a 02-10)

- **Módulos ligados** (`REGISTRO_MODULOS`, 43 no total): entram acesso, administracao, carga e sadt.
  - `acesso/modulo.ts` passa a montar, além do saneamento, RH e usuário-modelo: comunicação (mensagens, comunicados,
    avisos, contas dormentes, conselho; parte do 02-01), gestão, recertificação, pedidos de acesso (pessoa e gestão),
    consulta do acesso, identidade (segundo fator, porta própria; chave mestra do ambiente) e contas do banco (porta
    própria). É global: exporta PORTA_COMUNICACAO/AVISOS_INICIO e FONTE_GESTAO.
  - `administracao/modulo.ts` global (os pedidos de acesso leem a FONTE_ADMINISTRACAO).
  - `sadt/modulo.ts`: CENTRAL_AVISOS_SADT = ServicoComunicacao sobre a PORTA_COMUNICACAO do acesso (o sino do crítico
    volta); com `config` em API_MODULOS usa a fonte global da configuração.
  - Fica fora: a emergência ("quebra de vidro"), sem dono para ALERTA_AUDITOR e VINCULO_ASSISTENCIAL; o PIN da troca
    rápida (segue 501 em NAO_MIGRADOS_F2L).
- **Typecheck cumulativo:** `tsconfig.migrado.json` 953 → 1116 arquivos (fecho dos 10 lotes; 4 arquivos do config
  apagados pelo 02-07 saíram; `sadt/infra/laudo-pdf.int.spec.ts` reescrito sobre o registro e incluído).
- **DDL aplicado** (`02_ADM/08`, ADR 0002): saneamento_acesso_item e uso_acao_usuario (02-04), ciclo_certificacao e
  ciclo_certificacao_item (02-06). 4 tabelas no catálogo; validar_migracoes 0 erros, 3583 tabelas, 13728 FKs;
  aplicado aos 9 clientes de dev e teste. O caso dos ciclos do SBIS (antes pulado) agora roda contra o banco.
- **Código ajustado:** `idSilanexa` → `exameItem` (portal e vigia do SADT); memória do SADT volta o id sintético ao
  login (vínculo do laudador); specs que dependiam do app.module passam a pedir os módulos (`acesso,config`,
  `acesso,administracao`, `sadt,acesso,config`, `sadt,pep,acesso,config`); chave de idempotência por avaliação no
  int.spec do SBIS; registro.spec/app-base.spec usam `cirurgia` como não migrado; textos fora da linha de base do
  sem-coexistencia reescritos; 27 erros de lint corrigidos.
- **Web:** `/plataforma/entrar` redireciona para `/entrar` (uma entrada só: administrador da plataforma por
  POST /api/sessao/plataforma e conta da plataforma por e-mail, com o código do segundo fator no próprio formulário);
  `PlataformaEntrarTela.vue` apagada.
- **Pendências registradas:** `sadt/pacs.spec.ts` (lista de trabalho DICOM) em describe.skip: a liberação por pessoa
  de `imagem.worklist` feita na tela não chega ao ServicoPacs com os módulos registrados; `laudo-pdf.int.spec.ts`
  falha só pelo S3 de dev (500, ambiente). DDL não aplicado: ver avisos da integração (pedidos dos lotes 02-01,
  02-02, 02-03, 02-05, 02-06 cujo código ainda responde "modelo-pendente" ou que dependem do núcleo).
- **Conferidor `--estrito`:** ok em 02-01, 02-02, 02-04 a 02-08 e 02-10; 02-03 ok (tsc refeito depois do lint; o
  vitest do lote já verde na rodada anterior); 02-09 só falha nos 2 casos de PDF/A pelo S3 de dev (500, ambiente).
- **Provas:** tsc 0 erros (migrado e login); vitest API 239 arquivos, 1605 verdes e 17 pulados; núcleo 73 verdes; web
  176 arquivos, 1147 verdes; vue-tsc 0; eslint dos arquivos tocados 0; sem-coexistencia ok (1278 pendentes na linha de
  base); `/api/saude` 200 após subir-login com API_MODULOS=todos.
- **Legado restante:** 435 arquivos (507 imports), 0 no fecho do login.
