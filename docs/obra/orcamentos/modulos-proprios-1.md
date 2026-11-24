# Orçamento: modulos-proprios-1

estimativa_M: 38.6
teto_M: 50

- **Inventário medido (23/11, 23h40):** no banco próprio ainda recusam portal do paciente 54 métodos (porta-propria
  19, gravador com falta() 22, agenda online 13 com 503 recurso-sem-modelo), qualidade 53 (porta-propria 11 leituras
  e 9 gravações da ETAPA_2, gestão 33), suporte 26 (com o núcleo, `repo` e `fonte` de servicosSuporte ficam null: as
  21 rotas de /plataforma dão 503), operadora 18 (ans 7, atendimento 9, autorização 2) e SUS 16 (modeloPendente:
  arquivos, APAC, AIH, retorno do gestor). Total 167.
- **Rodada:** 7 famílias em linha de produção (construtor → revisor adversarial → corretor), uma por módulo ou metade
  de módulo, em arquivos próprios do módulo; um integrador por fim liga, roda os testes dos 5 módulos e recontabiliza.
  Migrações com número próprio por família.
- **Decisão do orquestrador (suporte):** o RepositorioPlataforma no banco próprio fica sobre o banco `plataforma`
  (a API já tem o pool da plataforma); a FonteComoEstabelecimento lê os estabelecimentos e usuários do cliente pelo
  núcleo. Credencial e segundo fator seguem o que a porta de memória e o ServicoPlataforma exigem (senha cifrada,
  segredo do segundo fator cifrado com a chave mestra).
- **Agentes:** 7 construtores × 2,5 M; 7 revisores × 0,6; 7 corretores × 1,0; integrador 3,5. Soma 32,2 M × 1,2 =
  **38,6 M**; teto **50 M**.
