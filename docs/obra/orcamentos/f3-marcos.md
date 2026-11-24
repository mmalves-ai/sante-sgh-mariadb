# Orçamento: f3-marcos

estimativa_M: 70
teto_M: 91

- **Medido (24/11, 05h):** F3 com 247 funções da lista mínima (docs/analise/01..09, decisão F3): 192 feitas no
  código herdado, 30 parciais, 25 desligadas; 0 fichas funcionais; 0 revisões "sem cara de SPDATA". Motores F3.0
  fechados nas rodadas f3-motores e fecho-1 (conta na admissão, diárias, estoque na conta, repasse na conta e na
  glosa).
- **Rodada:** os 9 marcos F3.1 a F3.9 em linha de produção, um marco por linha: (1) ficha funcional em
  docs/fases/fichas/F3.x-<nome>.md (passo 1 da F3: lista mínima do SPDATA 100% mapeada, função a função, para o
  código que a cumpre; melhorias do MV e das boas práticas; o que sai por ser contorno do sistema antigo, com motivo;
  o que vai para a F8, com motivo); (2) construção das funções parciais e desligadas do marco, com contrato de efeito
  e E2E pelo tools/obra/e2e-vm.sh; (3) revisão adversarial "sem cara de SPDATA" (passo 6); (4) corretor.
  1 integrador no fim.
- **Encaixe das seções da análise nos marcos:** F3.1 = 02 CAD; F3.2 = 02 REC e AGE; F3.3 = 03; F3.4 = 04 INT e CC;
  F3.5 = 05 SADT; F3.6 = 05 SUP; F3.7 = 06 (com repasse e SUS); F3.8 = 07; F3.9 = 04 HOT, 01 ADM/REL/SIS, 08, 09.
- **Sobras que entram nos marcos:** SUS (8 pontos de recusa) na F3.7; qualidade (10 gravações: publicarDocumento,
  retirarDocumento, registrarCiencia, registrarAnaliseIndicador, registrarAuditoria, alterarAuditoria,
  registrarComissao, registrarReuniaoComissao, sortearRevisao, revisarProntuario) e folha (catálogo vigente/encerrada
  das obrigações na tela; SEFIP, CAGED e RAIS sem geração) na F3.9; armazem-arquivos.int.spec frágil (lista as 100
  primeiras divergências) na F3.9.
- **Agentes:** 9 × (ficha 1,5 + construtor 2,7 + revisor 0,8 + corretor 1,1) + integrador 3 = 58 M × 1,2 =
  **70 M**; teto **91 M**.
