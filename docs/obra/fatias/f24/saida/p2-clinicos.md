# F2.4, 3ª etapa: lote p2-clinicos (modelo-pendente de SADT, SUS, manutenção, especialidades, nutrição e enfermagem)

Resultado: manutenção e nutrição zeradas. No SADT, o portal de resultados ficou inteiro; restam as 10 operações, que
dependem do contrato novo. Nas especialidades, o exame oftalmológico ficou pronto; resta a oncologia. SUS e SAE (sistematização
da assistência de enfermagem) não couberam no teto e viraram pedido de lote próprio (`p2-clinicos.json`).

## O que mudou
- **Nutrição** (`nutricao/porta-propria.ts`): `registrarAlteracao` do plano de refeição do acompanhante grava em
  `plano_refeicao_acompanhante_evento` (alterado ou cancelado, antes e depois em JSON, motivo e usuário), só para um
  plano do estabelecimento. A recusa `modelo-pendente` e o `modeloPendente` saíram. O teste prova o efeito e as recusas
  (`acompanhante-inexistente` de outro estabelecimento, `evento-invalido` para etiqueta).
- **Manutenção** (`manutencao/porta-propria.ts`): a queixa aberta pela OS (ordem de serviço) grava a `natureza`
  (queixa técnica, evento adverso ou alerta sanitário). O alerta sanitário liga o alerta da ação de campo que gerou a
  OS (`alerta_sanitario_id`). Sem esse alerta, recusa com `os-sem-alerta`. O teste `tecnovigilancia.int.spec` prova a
  natureza e o alerta gravados.
- **SADT, portal de resultados** (`sadt/porta-propria.ts`):
  - `criarProtocoloPortal` grava só o SHA-256 do código em `protocolo_acesso_portal`. O novo protocolo do atendimento
    revoga o anterior, e o atendimento tem de ser do paciente e do estabelecimento;
  - `acessoPorProtocolo`, `acessoDoMedico` e `acessoPorId` leem restritos ao estabelecimento;
  - `registrarAutocadastro` grava o pedido com o CPF, o resumo da senha e o segredo cifrado. Um pedido em aberto (ou
    conta ativa) por inscrição;
  - `decidirAutocadastro` copia a credencial do pedido para a conta na aprovação;
  - `registrarTentativaPortal` grava as falhas e o bloqueio no protocolo ou na conta, e o último acesso na conta.
  - `LEITURAS_PENDENTES` e `GRAVACOES_PENDENTES` saíram. O `vigia-criticos.int.spec` perdeu o ramo de pendência morto.
- **Especialidades** (`especialidades/porta-propria.ts`): `registrarExame` grava o exame oftalmológico consolidado
  (cabeçalho com tipo nulo e alertas em JSON, medidas por olho em `exame_oftalmologico_valor`, um item por tipo e
  lado em `exame_oftalmologico_item`). `exames` lê pela internação, só no estabelecimento dela.

## Decisões pela melhor prática (para o dono ver)
1. **Id do acesso ao portal com sinal:** o protocolo do paciente tem id positivo. O médico tem id negativo: o da
   conta, ou, antes da aprovação, o do pedido somado a uma base. A tentativa e a releitura voltam pela mesma chave sem
   mudar o contrato (`chaveAcessoPortal`).
2. **Tentativa do médico sem conta (correção da revisão):** o autocadastro conta as falhas e bloqueia como a conta,
   porque a senha do pedido passa à conta na aprovação. Colunas `tentativas_falhas` e `bloqueado_ate` no pedido,
   acrescentadas em `db/migracoes/17_INTG/23_tabelas.sql` (fora da lista do lote; idempotente).
3. **Novo protocolo revoga o anterior** do mesmo atendimento: o código impresso antes deixa de valer.
4. **Exame oftalmológico:** a classificação visual fica em `achados` e a conduta em `conclusao`. O grau da gonioscopia
   vira a medida `outro` com o método `gonioscopia`, porque o CHECK de medida não tem gonioscopia. Há pedido opcional de
   DDL para colunas próprias.
5. **Natureza da queixa pela OS:** o alerta sanitário só se abre a partir da OS da ação de campo do alerta
   (`os-sem-alerta` fora disso). **Evento adverso pela OS recusa** com `evento-adverso-pela-notificacao` (correção da
   revisão): ele nasce da notificação de incidente, com tipo, dano percebido e prazo, que a OS não traz nem liga; criar
   a notificação a partir da OS inventaria tipo e dano. Pela OS, abre-se como queixa técnica.

## Pedidos (`p2-clinicos.json`)
- **Lote próprio para o SADT:** as 10 operações, com o contrato novo.
- **Lote próprio para o SUS:** cerca de 40 métodos, em 4 blocos (arquivo, APAC, AIH e retorno), sobre a estrutura que
  já existe.
- **Lote próprio para a SAE:** 7 gravações.
- **Lote próprio para a oncologia:** 10 gravações e 8 leituras.
- **DDL aplicada no arquivo:** o contador de tentativas no pedido do médico externo (17_INTG/23). **DDL opcional:** a
  conduta e a gonioscopia no exame oftalmológico.
- **Contrato da manutenção (opcional):** expor a natureza da queixa em `vinculosTecnovigDaOs` e aceitar a notificação
  de incidente na abertura pela OS, para ligar o evento adverso; a porta em memória ainda aceita evento adverso e não
  recusa `os-sem-alerta` (paridade).

## Prova
- O tsc da API passou sem erro.
- O vitest rodou no cliente `f24q_clinicos`: sadt (porta própria e vigia), nutrição, tecnovigilância e especialidades,
  todos verdes. A conferência do lote está em `tools/obra/conferir-lote-f24.sh p2-clinicos`.
