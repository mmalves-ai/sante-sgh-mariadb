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
- **DDL aplicado na tentativa 2** (só para frente, ADR 0002; validar_migracoes 0 erros, 3602 tabelas, 13793 FKs,
  colunas *_id sem FK inalteradas em 71; aplicado aos 9 clientes de dev e teste):
  - `08_CC/04`: checklist e ficha anestésica pelo agendamento (ato opcional, CHECK de alvo), assinatura da ficha,
    passagem, lacuna e adendo da ficha, critérios e plano estruturado da pré-anestésica, código do painel da família,
    destino da saída do bloco, pedido do portal sem paciente cadastrado, situação `no_bloco`, versões do pedido (03-01);
  - `15_RH/05`: competências, cargo×competência, PDI, versões e ciência da avaliação, atestado com CID restrito e trilha
    de leitura, vínculo da solicitação (03-02); cobertura mínima da escala, realizado/repasse/estorno do plantão,
    sobreaviso, tempo parcial neutro (`ate_25h`/`ate_26h`/`ate_30h`, não o código do eSocial), dimensionamento,
    histórico da escala (03-04); vigência do empregador no eSocial, conferência de eventos, ambiente coletor, operação
    e data de referência do evento (03-05); intercâmbio da folha, adicional escolhido, colunas de férias, rescisão
    (modalidade, `substituida`), 13º por vínculo, obrigações e parâmetros (03-06); sorologia pós-exposição, CAT,
    profilaxia, retificação de vacina e ASO, dosimetria, quimioterápico, incidências da rubrica (03-10); vínculo e
    conclusão da presença, versão do procedimento da turma (03-11);
  - `12_FAT/10`: valor da hora por tipo de plantão (03-04); motivo do retorno e evidência da glosa, recibo do protocolo
    (03-16); `05_AGE/05`: município e ciência do alerta crônico da teleconsulta (03-15); `14_FIN/12`: fornecedor
    crítico e observação do contrato (03-13).
  - CHECKs só ampliam domínios ou valem sobre colunas novas. Os que amarram a situação de hoje a uma coluna nova
    (recusa do realizado com motivo, decisor diferente do revisor, cancelamento do sobreaviso/afastamento/obrigação com
    motivo, finalização e ciência da avaliação com usuário) ficam para o lote que grava essas colunas, para não recusar
    as gravações atuais. As portas continuam respondendo `modelo-pendente` até o lote de continuação ligar as colunas.
  - Pedidos **não aplicados** (decisão, tabela de destino inexistente ou só em prosa): ver avisos da integração.
  - Código ajustado ao DDL: o SESMT já gravava `sorologia_exposicao` quando a tabela existe; o resultado vai ao banco em
    snake_case (`sem_alteracao`, `nao_realizada`, convenção do modelo) e volta com hífen no contrato; a massa do teste
    apaga os marcos antes da exposição (a FK nova recusava a limpeza).
  - Pedidos não aplicados nesta tentativa: 03-01 (recurso do agendamento: decisão do dono; acesso do portal do médico
    externo: sem tabela de destino); 03-03 (quadro de vagas, faixa salarial: só em prosa); 03-04 (registro do conselho
    do plantão: sem tabela de destino; tipo de folga padrão: código sem domínio); 03-05 (ficha do eSocial do vínculo:
    decisão); 03-06 (processamento da folha, parâmetro da folha, fechamento do período, ligação da obrigação ao
    fechamento e do recibo/rescisão ao processamento: tabelas inexistentes; único do 13º por vínculo: vínculo nulo
    enfraquece o único); 03-07 (integração folha→financeiro, títulos e fato contábil da folha, papel da rubrica no
    resumo: só em prosa); 03-09 (todos, em prosa); 03-11 (público e categoria do curso: decisão); 03-12 (portal do
    paciente, 10 pedidos de tabela de segurança e LGPD, em prosa); 03-13 (vínculo do contrato, eventos da licitação,
    carga de índices, razão do consignado); 03-14 (prazo de reposição por local, opcional); 03-16 (pagamento por item do
    demonstrativo, calendário de entrega, contas bancárias por usuário). Os CHECKs que amarram a situação atual às
    colunas novas também ficam para o lote que grava essas colunas.
- **Conferidor `--estrito`:** ok em 15 lotes; 03-13 só falha em `licitacao-documento.int.spec.ts` (S3 local 500 ao
  gravar com retenção; ambiente, igual à onda 2).
- **Provas:** tsc 0 (migrado e login); vitest API 316 arquivos, 2075 verdes e 19 pulados; núcleo 73; web pessoas 39;
  vue-tsc 0; eslint dos arquivos tocados 0; validar_migracoes 0 erros (3583 tabelas, 13728 FKs); `/api/saude` 200 após
  subir-login com API_MODULOS=todos.
- **Legado restante:** 323 imports em 262 arquivos (apps/api 19: contabil, portal-medico e app.module.ts), 0 no fecho do
  login.
