# Integração da onda 1 da F2.2 (lotes 01-01 a 01-06)

- **Módulos ligados** (`REGISTRO_MODULOS`): agenda, atendimento, cadastro, config, recepcao. O `config/modulo.ts`
  (novo, global) entrega a `FONTE_CONFIGURACAO` própria (confere o modelo antes) às telas dos outros módulos, mais as
  rotas de liberação e de parâmetros; sem ele, as gravações ficam em consulta (falha fechada).
- **Typecheck cumulativo:** `apps/api/tsconfig.migrado.json` criado (login + fecho dos 6 lotes + integração): 0 erros.
- **Suíte padrão da API** (`suite-base.ts`): por arquivo, login + migrado. Não importa mais `registro.ts` (o
  empacotador da configuração seguia os `import()` dos módulos); módulo registrado não puxa spec de lote futuro.
- **DDL aplicado** (só para frente, convenções do ADR 0002; catálogo com 17 tabelas novas):
  `02_ADM/05` (liberacao_lote, liberacao_chave, recurso_prerequisito, usuario_profissional, sessao_suporte_acao,
  sessao_suporte_leitura, usuario.pessoa_fisica_id), `03_CAD/05` (chave_busca_nome, profissional_ocupacao,
  paciente.sigiloso), `04_REC/03` (gerador_senha: intercalada, tempo-alvo, totem; senha suspensa; dispositivo_recepcao
  e vínculos; termo_consentimento_recepcao; atendimento_etapa_pa), `05_AGE/03` (feriado unificado dos pedidos 01-04 e
  01-05; recorte diário do bloqueio; agenda_servico_exame), `06_PEP/13` (termo exigido na recepção, impressão e
  licença dos protocolos, código do fluxograma 60, CBO do rascunho, inclusao_protocolo_registro,
  aviso_estouro_classificacao), `07_INT/04` (uma observação aberta por atendimento).
  Recusado: `local_atendimento_encaminhamento` (já existe em 04_REC/01).
  Aplicado aos 8 clientes de dev/teste existentes (sem ferramenta de atualização de cliente: ver pendências).
- **Unificação:** `termo_consentimento_recepcao.paciente_id` entrou em `REFERENCIAS_PACIENTE` (a guarda da unificação
  recusou a tabela nova, como devia).
- **Portão da F2** (`apps/api/src/portao-f2.int.spec.ts`, cliente f22_o1, pela HTTP com API_MODULOS=config,cadastro,
  atendimento): login → paciente cadastrado (201) → atendimento aberto (201, AT-n; histórico, cobertura, procedimento
  principal, trilha, saída) → leitura (200). 4/4 verdes.
- **Pendências para as próximas ondas:** cargas do "criar cliente" (domínios do cadastro, atendimento, agenda,
  recepção, parametro_definicao, ações do CRUD de domínios, sequências); ferramenta de atualização de migrações por
  cliente (hoje `versao_migracao` guarda o último `_chaves.sql` por ordem alfabética e não registra arquivos novos de
  módulos anteriores); contratos com vocabulário antigo (destino 'legado', usuarioLegado, corLegado, letras da senha);
  o pré-requisito do recurso `atendimento.ambulatorio` ainda descreve a convivência com o outro sistema; o código das
  portas que hoje responde 'modelo-pendente' passa a poder usar as tabelas novas (lotes donos).
