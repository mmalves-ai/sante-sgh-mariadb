# F2.4, 3ª etapa, lote p-enfermagem (escores, SAE e a anotação offline)

## O que mudou
- **`enfermagem/escores-porta-propria.ts`: as 13 gravações saíram de `modelo-pendente`**, todas pelo Executor do
  núcleo, com trilha, e com leitura restrita ao estabelecimento:
  - **Profilaxia de TEV (tromboembolismo venoso), decisão e retificação:**
    - a primeira decisão sobre o escore de Caprini ou Padua cria a avaliação de risco (`profilaxia_tev_avaliacao`) a
      partir do escore e grava a decisão em `profilaxia_tev_decisao`;
    - a retificação e a anulação são linhas novas (a original não muda);
    - depois da anulação, a nova decisão entra como retificação;
    - recusas: só o autor corrige, sem mudança, escore estornado, escore sem sugestão, não prescrita sem motivo;
    - a leitura `decisoesProfilaxia` (antes vazia) agora lê o banco, com o histórico.
  - **TRR (Time de Resposta Rápida):**
    - a chegada e o desfecho viraram eventos versionados em `acionamento_resposta_rapida_evento`;
    - a retificação (só do autor, com motivo, nunca antes do acionamento nem no futuro) e a inativação do evento ficam
      visíveis;
    - as colunas do acionamento (chegada, desfecho, situação) espelham o evento vigente;
    - a leitura dos acionamentos traz os eventos com a sequência e o vigente.
  - **Lesão de pele, 7 gravações** (ficha, versão, curativo, correção, foto, encerramento, inativação):
    - tudo sobre `lesao_pele_paciente` e `lesao_pele_avaliacao`;
    - o tipo, a região e o estágio vêm do cadastro pelo código; o que falta é recusado com `cadastro-incompleto`;
    - a ficha vai em `dados` (JSON conferido, até 2.000 caracteres);
    - a foto exige um anexo do prontuário do mesmo paciente e estabelecimento;
    - a leitura das lesões passou a trazer as fotos e as inativações, e a ficha vem de `dados`.
  - **Protocolo gerenciado do internado:** a meta e o item do checklist gravam no evento da inclusão (o CHECK foi
    ampliado no DDL v2):
    - um registro por tipo e código;
    - recusado depois do encerramento.
  - A operação dos escores passou a declarar as tabelas novas: o evento do TRR e as duas da profilaxia.
- **Testes de integração** em `porta-propria.int.spec.ts`, no cliente próprio `f24p_enfermagem` (criado):
  - três casos novos: profilaxia, TRR versionado e lesão de pele;
  - o caso do protocolo agora prova a meta e o checklist;
  - a limpeza apaga as linhas novas.
  - Resultado: 15 de 15 verdes. Os specs vizinhos (escores e W0-03 de lesão, TRR e protocolo) também passaram: 29 de 29.
- **tsc de apps/api:** 0 erros nos arquivos do lote. Os 5 erros restantes são de outros lotes (operadora e SADT).
- **Dívida do módulo:** de 2 para 1 arquivo. Falta `sae-porta-propria.ts`.

## Decisões pela melhor prática (para o dono ver)
- **Avaliação de TEV criada a partir do escore:**
  - perfil: Caprini é cirúrgico, Padua é clínico;
  - risco: a faixa do escore;
  - profilaxia indicada: a mesma regra da sugestão do domínio (`sugestaoProfilaxia`). Padua alto leva à
    farmacológica. Caprini baixo leva à mecânica, moderado à farmacológica e alto à farmacológica com mecânica (a
    mecânica é a compressão pneumática).
  - O risco de sangramento fica no padrão do modelo (`baixo`), porque o escore não o avalia. A sugestão do domínio já
    avisa o prescritor para conferir.
- **Anulação da profilaxia:** a coluna guarda a decisão anulada (o CHECK não tem `anulada`), e o fato vai em `dados`.
  O pedido opcional de DDL está no JSON.
- **Profilaxia não prescrita:** exige o motivo. Ele vai à justificativa, que o CHECK do modelo exige.
- **Evento do TRR:** o retorno de `eventoTrr` passou a ser o id do evento, como na porta em memória. Esse id é o que a
  retificação e a inativação usam. A chegada antes do acionamento é recusada (`antes-do-acionamento`).
- **Lesão:**
  - a versão de rascunho não aponta a anterior no banco, porque o CHECK exige o motivo. A leitura deriva a anterior
    pela ordem;
  - a correção da ficha finalizada aponta a corrigida, com a justificativa;
  - o curativo com estágio atualiza o estágio atual da lesão;
  - o encerramento exige a ficha finalizada.

## Pedidos e o que falta (veja `p-enfermagem.json`)
- **SAE (sistematização da assistência de enfermagem), `sae-porta-propria.ts`:** as 7 gravações seguem com
  `modelo-pendente`:
  - atividade prescrita (prescrever, suspender, checar, estornar);
  - terminologia licenciada;
  - receita do enfermeiro e a inativação dela.
  - As leituras ligadas devolvem vazio. O desenho sobre as tabelas existentes está no JSON. Não coube nesta rodada.
- **Anotação offline (`enfermagem.controller.ts`):**
  - segue recusada com `registro-inexistente`, e o lote devolve `ok:false` por anotação;
  - pedido ao dono do registro assistencial do PEP: uma gravação compartilhada de `registro_assistencial` e o modelo
    de documento da anotação de enfermagem.
- **Nomes antigos na trilha de `trr.controller.ts`:** os alvos `SGH_PEP_TRR*` e `SGH_PEP_PCR` deveriam ser
  `acionamento_resposta_rapida(_evento)` e `parada_cardiorrespiratoria_ficha`. O verificador não aponta, e este lote
  não os mexeu.

## Correção dos achados da revisão (3ª etapa)
- **Anotação offline da beira do leito (`enfermagem.controller.ts`, `porta.ts`, `porta-propria.ts`, `porta-memoria.ts`):**
  - nova gravação `registrarAnotacaoOffline`: na mesma transação, grava o registro assistencial do atendimento
    (modelo `ANOTACAO_ENFERMAGEM` publicado, autor pelo vínculo de profissional, momento clínico pela hora real no
    fuso do estabelecimento, texto consolidado e impressão digital SHA-256) e, nele, a resposta de extensão
    (`anexo`, chave `anotacao:<chave do ato>`);
  - o reenvio da mesma chave devolve o registro da primeira vez (não duplica); atendimento de outro paciente ou
    estabelecimento é recusado;
  - a trilha aponta `registro_assistencial` com o id do registro (antes apontava `afericao` com o id da extensão);
  - a operação declara `registro_assistencial` e `registro_assistencial_extensao`;
  - teste de integração novo (gravação, reenvio, outro estabelecimento).
- **Profilaxia de TEV (tromboembolismo venoso):** a regra (perfil, risco e profilaxia indicada pela faixa) saiu da
  porta para o domínio (`dominio-enfermagem/escores/profilaxia.ts`, `avaliacaoTevDoEscore`, com teste unitário). Faixa
  desconhecida é recusada com `faixa-desconhecida` (antes virava risco "alto"); teste de integração cobre a recusa.
- **Estágio da lesão de pele:** curativo, correção do curativo e inativação do curativo recalculam o estágio atual da
  lesão pela última linha lançada (sequência), vigente, não inativada e com estágio (ficha, curativo ou reavaliação);
  sem nenhuma, a lesão fica sem estágio. Teste de integração cobre o lançamento errado, a correção e a inativação.

### Decisões pela melhor prática (para o dono ver)
- A regra de TEV foi para `dominio-enfermagem` (onde já estão `sugestaoProfilaxia` e os parâmetros de TEV), não para
  `dominio-pep`: é a mesma regra, num lugar só.
- O perfil da avaliação segue a população em que a escala foi validada (Caprini cirúrgico, Padua clínico), não o
  parâmetro do estabelecimento.
- "Última linha" do estágio é a última lançada (sequência), como o curativo já fazia, e não a de hora clínica mais
  recente: a ficha guarda a hora do lançamento, não a da observação.
- A anotação offline exige o modelo `ANOTACAO_ENFERMAGEM` publicado; sem ele, recusa `cadastro-incompleto` (pedido de
  semente no JSON).
