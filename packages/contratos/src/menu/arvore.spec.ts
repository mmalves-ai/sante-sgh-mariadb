import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { ITENS_CONSULTA_PROVISORIA } from '../consultas/catalogo.js';
import { ARVORE_MENU, CONTAGEM_DO_CABECALHO } from './arvore.js';

describe('menu gerado da árvore (regra 12)', () => {
  it('408 itens: M 189, P 57, N 162, iguais ao cabeçalho do arquivo', () => {
    expect(CONTAGEM_DO_CABECALHO).toEqual({ total: 408, M: 189, P: 57, N: 162 });
    expect(ARVORE_MENU).toHaveLength(CONTAGEM_DO_CABECALHO.total);
    expect(ARVORE_MENU.filter((i) => i.selo === 'M')).toHaveLength(CONTAGEM_DO_CABECALHO.M);
    expect(ARVORE_MENU.filter((i) => i.selo === 'P')).toHaveLength(CONTAGEM_DO_CABECALHO.P);
    expect(ARVORE_MENU.filter((i) => i.selo === 'N')).toHaveLength(CONTAGEM_DO_CABECALHO.N);
  });

  it('ids estáveis e únicos; cada item tem fase F0 a F7 e caminho que termina no título', () => {
    expect(new Set(ARVORE_MENU.map((i) => i.id)).size).toBe(408);
    for (const i of ARVORE_MENU) {
      expect(i.id).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(i.fase).toBeGreaterThanOrEqual(0);
      expect(i.fase).toBeLessThanOrEqual(7);
      expect(i.caminho.at(-1)).toBe(i.titulo);
      expect(i.area).not.toBe('');
    }
  });

  it('rota e permissão vêm juntas, só nas telas que já existem', () => {
    const comRota = ARVORE_MENU.filter((i) => i.rota !== null);
    expect(comRota.every((i) => i.permissao !== null && i.rota!.startsWith('/'))).toBe(true);
    expect(ARVORE_MENU.filter((i) => (i.rota === null) !== (i.permissao === null))).toEqual([]);
    // M14: a consulta provisória dos itens das Fases 5 e 6 (uma rota por item, gerada do lote).
    const provisorias = new Set(ITENS_CONSULTA_PROVISORIA.map((i) => `/consultas/item/${i.item}`));
    // M44 e M49 (etapas 1 e 3): os itens que ganharam a tela completa substituem a consulta provisória deles.
    const substituidas = [
      '/consultas/item/pronto-atendimento.classificacao-de-risco-manchester-ou-accr-proprio',
      '/consultas/item/administracao.assinatura-digital.provedores-de-certificado-em-nuvem-psc',
      '/consultas/item/administracao.assinatura-digital.oids-tipos-de-certificado-e-formas-de-assinatura',
      // M44 (etapa 3): a regulação estadual ganhou a tela.
      '/consultas/item/internacao-e-leitos.nir-e-regulacao.regulacao-estadual-gerint-gercon-n-de-regulacao',
      // M53.1 (etapa F0): a folha de pagamento ganhou a tela da competência.
      '/consultas/item/gestao-de-pessoas.folha-de-pagamento-rubricas-ferias-rescisao',
      // M56 (etapa F0): Envios à ANS abre a tela da operadora (catálogos da ANS).
      '/consultas/item/faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.envios-a-ans-sib-sip-e-exportacoes',
      // M56 (etapa 4, F3): a rede credenciada ganhou a tela.
      '/consultas/item/faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.rede-credenciada-e-prestadora',
      // M56 (etapa 3, F2): a cobrança e as mensalidades ganharam a tela.
      '/consultas/item/faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.cobranca-e-mensalidades',
      // M56 (etapa 5, F4): o atendimento, a autorização e os protocolos ganhou a tela das autorizações.
      '/consultas/item/faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.atendimento-autorizacao-e-protocolos',
      // M56.2 (fatia F1): beneficiários, planos e contratos ganhou a tela.
      '/consultas/item/faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.beneficiarios-planos-e-contratos',
      // M56 (etapa 8, F7): o portal do prestador credenciado ganhou a tela da operadora.
      '/consultas/item/faturamento.operadora-propria-sgo-se-a-rede-tiver-plano.portal-do-prestador-credenciado',
      // M54 (etapa 4): a estrutura de custos e a coleta de estatísticas ganharam a tela.
      '/consultas/item/controladoria.custos-hospitalares.centros-de-custo-e-criterios-de-rateio',
      // M45 (etapa 3): o balanço hídrico.
      '/consultas/item/enfermagem.balanco-hidrico-ganhos-perdas-fechamento-24-h',
      // M50 (etapa 5): a portaria e os terminais ganharam as telas.
      '/consultas/item/hotelaria-e-apoio.portaria-e-visitantes.cadastro-de-visitantes-e-cracha',
      '/consultas/item/hotelaria-e-apoio.portaria-e-visitantes.terminais-e-catracas',
      // M45 (etapa 2): os índices de gravidade da UTI ganharam a tela.
      '/consultas/item/pep.indices-de-gravidade-de-uti-apache-ii-sofa-saps-3',
      // M45 (etapa 6): a oftalmologia e a oncologia ganharam a tela (construída e desligada; DP-32).
      '/consultas/item/pep.especialidades.oftalmologia-exames-e-acuidade',
      '/consultas/item/pep.especialidades.oncologia-protocolos-de-quimioterapia',
      // M50 (etapa 6): a agenda de sessões e recursos ganhou a tela (a grade das cadeiras e salas).
      '/consultas/item/agenda.agenda-de-sessoes-e-recursos-cadeiras-salas',
      // M45 (etapa 4): o processo de enfermagem ganhou a tela.
      '/consultas/item/enfermagem.processo-de-enfermagem-sae-nanda-i-ou-cipe',
      // M46 (etapa 1): a ficha anestésica ganhou a tela.
      '/consultas/item/centro-cirurgico.ficha-anestesica-sinais-farmacos-gases-eventos',
      // M52.1: o cadastro de colaboradores ganhou a tela (os domínios do RH embutidos).
      '/consultas/item/gestao-de-pessoas.cadastro-de-colaboradores-admissao-dependentes',
      // M52.2: a programação de escala e banco de horas ganhou a tela dos regimes (os domínios embutidos).
      '/consultas/item/gestao-de-pessoas.programacao-de-escala-e-banco-de-horas',
      // M52.5 (fatia F5): as quatro telas do SESMT.
      '/consultas/item/gestao-de-pessoas.sesmt.aso-e-exames-ocupacionais',
      '/consultas/item/gestao-de-pessoas.sesmt.cat-acidente-de-trabalho',
      '/consultas/item/gestao-de-pessoas.sesmt.riscos-ocupacionais-epi-epc-e-ppp',
      '/consultas/item/gestao-de-pessoas.sesmt.vacinacao-do-colaborador',
      // M47 (etapa 2): os cadastros da agência transfusional ganharam o índice do CRUD genérico (com as consultas).
      '/consultas/item/diagnostico-sadt.agencia-transfusional.cadastros-e-parametros-da-agencia',
      // M51 (etapa 2): os médicos solicitantes SUS ganharam a tela (o CRUD genérico do FAMEDSOL embutido).
      '/consultas/item/faturamento.faturamento-sus.medicos-solicitantes-sus',
      // M52.4 (fatia F4): o ponto ganhou a tela (os domínios do ponto embutidos).
      '/consultas/item/gestao-de-pessoas.ponto-eletronico-marcacoes-justificativas',
      // M51 (etapa 3): a APAC ganhou a tela (os domínios do laudo de nefrologia em consulta nela).
      '/consultas/item/faturamento.faturamento-sus.apac-laudos-e-autorizacoes',
      // M51 (etapa 4): a AIH ganhou a tela de trabalho (os domínios do SIH seguem na consulta do item, por um link).
      '/consultas/item/faturamento.faturamento-sus.aih-internacao-sih',
      // M46 (etapa 4): os consignados e a manipulação ganharam as telas.
      '/consultas/item/suprimentos.estoque-e-almoxarifado.consignados',
      '/consultas/item/suprimentos.farmacia-hospitalar.manipulacao-e-capelas',
      // M48 (etapa 4): a notificação compulsória ganhou a tela de trabalho (os domínios de notificação em consulta nela).
      '/consultas/item/qualidade-e-seguranca.vigilancia-epidemiologica.notificacao-compulsoria-sinan-gatilho-por-cid',
      // M48 (etapa 5): a matriz de riscos ganhou a tela (riscos, não conformidades e a escala GUT, com o CRUD por link).
      '/consultas/item/qualidade-e-seguranca.gestao-da-qualidade-ona.matriz-de-riscos-gut-e-nao-conformidades',
      // M53.6 (etapa F5): o eSocial ganhou a tela de trabalho (eventos, lotes, retornos e conciliação).
      '/consultas/item/gestao-de-pessoas.esocial-eventos-lotes-retornos',
      // M53.8 (etapa F7): as obrigações legais ganharam a tela (FGTS Digital, SEFIP, CAGED e RAIS).
      '/consultas/item/gestao-de-pessoas.obrigacoes-legais-rais-caged-sefip-fgts',
      // M53.9 (etapa F8): a integração da folha com o financeiro e o contábil ganhou a tela de trabalho.
      '/consultas/item/gestao-de-pessoas.integracao-da-folha-com-financeiro-e-contabil',
      // M54.1 (etapa F1): o plano de contas ganhou a tela de trabalho (plano, regras de contabilização e problemas).
      '/consultas/item/controladoria.contabilidade.plano-de-contas-e-plano-referencial',
      // M54.7 (etapa F7): o orçamento empresarial ganhou a tela de trabalho (os parâmetros seguem na consulta, por um link).
      '/consultas/item/financeiro.orcamento-empresarial',
      // M54.3 (etapa F3): o SPED ECD/ECF ganhou a tela de trabalho (prévia, geração, arquivos; as tabelas por link).
      '/consultas/item/controladoria.contabilidade.sped-ecd-ecf',
      // M55 (etapa 5): a contratualização SUS ganhou a tela de trabalho (os domínios em consulta nela).
      '/consultas/item/faturamento.faturamento-sus.contratualizacao-sus-metas-e-incentivos',
      // M54.6 (etapa F6): o cadastro de bens e os parâmetros do patrimônio ganharam as telas de trabalho.
      '/consultas/item/controladoria.patrimonio.cadastro-de-bens-plaquetas-e-responsaveis',
      '/consultas/item/controladoria.patrimonio.parametros-do-patrimonio',
    ];
    expect(comRota.filter((i) => provisorias.has(i.rota!))).toHaveLength(
      provisorias.size - substituidas.length,
    );
    expect(
      comRota
        .map((i) => i.rota)
        .filter((r) => !provisorias.has(r!))
        .sort(),
    ).toEqual(
      [
        '/admin/integracoes/endpoints', // M34
        '/admin/integracoes/fhir', // M34
        '/admin/integracoes/hl7', // M34
        '/admin/integracoes/mensagens', // M34
        '/admin/integracoes/monitor', // M34
        '/admin/integracoes/parceiros', // M34
        '/administracao/acesso/grupos', // M06
        '/administracao/acesso/permissoes', // M10 (o mapa do M06 e Perfis e permissões abrem dela)
        '/administracao/acesso/quebras-de-vidro',
        '/administracao/acesso/simulador', // M10 (D-MENU-2: o item da árvore abre o simulador)
        '/administracao/acesso/termo',
        '/administracao/acesso/usuarios',
        '/administracao/alertas',
        '/administracao/auditoria/acessos-prontuario',
        '/administracao/auditoria/trilha',
        '/administracao/assinatura/oids', // M49 (etapa 3: OIDs, tipos de certificado e formas)
        '/administracao/assinatura/politica', // M49 (etapa 1)
        '/administracao/assinatura/provedores', // M49 (etapa 1)
        '/pep/assinaturas', // M49 (etapa 2: PEP › Assinatura ICP-Brasil)
        '/administracao/backup',
        '/administracao/coexistencia/assinaturas', // M03 (no menu desde o M08)
        '/administracao/coexistencia/conexoes', // M04
        '/administracao/coexistencia/estabelecimentos', // M02
        '/administracao/coexistencia/gravacao', // M04
        '/administracao/coexistencia/matriz', // M14
        '/administracao/coexistencia/schema', // M02
        '/administracao/empresa', // M10
        '/administracao/integracoes/fachada', // M58 (etapa 4: fachada da API de integração da Hal-AI)
        '/administracao/integracoes/leiautes', // M13
        '/administracao/liberacao', // M08 (POL-3)
        '/administracao/notificacoes', // M10
        '/administracao/parametros', // M08
        '/administracao/privacidade', // M10
        '/administracao/saude', // M09
        '/agenda/consultas/agendas', // M17
        '/agenda/consultas/bloqueios',
        '/agenda/consultas/cancelamentos',
        '/agenda/consultas/escalas',
        '/agenda/consultas/gerar',
        '/agenda/consultas/grade',
        '/agenda/consultas/marcar',
        '/agenda/espera',
        '/agenda/exames/agendas', // M18
        '/agenda/exames/cancelamentos',
        '/agenda/exames/escalas',
        '/agenda/exames/gerar',
        '/agenda/exames/marcar',
        '/agenda/sessoes', // M50 (etapa 6)
        '/beira-leito/checagem', // M25
        '/beira-leito/sinais-vitais',
        '/bloco/apa', // M46 (etapa 1)
        '/bloco/checklist', // M46 (etapa 2)
        '/bloco/ficha-anestesica',
        '/bloco/opme', // M46 (etapa 3)
        '/bloco/rastreio', // M46 (etapa 2: o rastreio e o quadro do bloco abrem a mesma tela)
        '/bloco/rastreio',
        '/bloco/srpa',
        '/cadastros/catalogos/cbo', // M13
        '/cadastros/catalogos/cid',
        '/cadastros/catalogos/dcb',
        '/cadastros/catalogos/enderecos',
        '/cadastros/catalogos/sigtap',
        '/cadastros/catalogos/tuss',
        '/cadastros/clinicos/alergias-principios', // M14
        '/cadastros/convenios', // M12
        '/cadastros/convenios/classificacoes-oncologicas',
        '/cadastros/convenios/codigos-prestador',
        '/cadastros/convenios?aba=indices',
        '/cadastros/convenios?aba=modificadores',
        '/cadastros/convenios?aba=tabelas',
        '/cadastros/convenios?aba=tiss',
        '/cadastros/dominios/enumeracoes', // M14
        '/cadastros/dominios/grupo/agenda', // M08 (CRUD genérico)
        '/cadastros/dominios/grupo/clinicos',
        '/cadastros/dominios/grupo/demograficos',
        '/cadastros/dominios/grupo/faturamentoDominios', // M14
        '/cadastros/dominios/grupo/hotelaria',
        '/cadastros/dominios/grupo/internacao',
        '/cadastros/dominios/grupo/portalResultados', // M26
        '/cadastros/dominios/grupo/sadtModalidades',
        '/cadastros/enfermagem/procedimentos',
        '/cadastros/especialidades', // M11
        '/cadastros/estrutura', // M10
        '/cadastros/estrutura/centros-custo',
        '/cadastros/estrutura/leitos',
        '/cadastros/estrutura/locais',
        '/cadastros/estrutura/locais-conta',
        '/cadastros/exames', // M14
        '/cadastros/exames/apoio',
        '/cadastros/exames/kits',
        '/cadastros/exames/resultados',
        '/cadastros/exames/setores',
        '/cadastros/fornecedores/categorias', // M14
        '/repasse/apuracao', // M33
        '/repasse/configuracoes', // M33 (CRUD genérico do subitem)
        '/repasse/cooperativas', // M33 (CRUD genérico do subitem)
        '/repasse/integracao-contabil', // M33 (CRUD genérico do subitem)
        '/repasse/lancamentos', // M33
        '/repasse/meu-extrato', // M33 (só o próprio médico)
        '/repasse/regras', // M33
        '/repasse/rpa', // M33
        '/suprimentos/itens', // M28
        '/suprimentos/fornecedores', // M28
        '/suprimentos/locais', // M28
        '/suprimentos/usuarios-locais', // M28
        '/suprimentos/parametros', // M28
        '/suprimentos/pedidos', // M28
        '/suprimentos/cotacao', // M28
        '/suprimentos/aprovacoes', // M28
        '/suprimentos/historico-compras', // M28
        '/suprimentos/notas-fiscais', // M28
        '/suprimentos/requisicoes', // M28
        '/suprimentos/movimento-direto', // M28
        '/suprimentos/transferencias', // M28
        '/suprimentos/devolucoes', // M28
        '/suprimentos/saldos', // M28
        '/suprimentos/kits', // M28
        '/suprimentos/inventarios', // M28
        '/suprimentos/consumo', // M28
        '/suprimentos/fechamentos', // M28
        '/suprimentos/recalculos', // M28
        '/suprimentos/sugestao-compra', // M28
        '/suprimentos/opme', // M46 (etapa 3)
        '/suprimentos/opme?aba=autorizacao',
        '/suprimentos/opme/conciliacao',
        '/suprimentos/consignados', // M46 (etapa 4)
        '/suprimentos/contratos', // M55 (etapa 3: contratos com fornecedores)
        '/suprimentos/licitacao', // M55 (etapa 4: licitação e pregão)
        '/farmacia/manipulacao', // M46 (etapa 4)
        '/farmacia/dispensacao', // M29
        '/farmacia/entregas', // M29
        '/farmacia/controlados', // M29
        '/farmacia/avaliacao', // M29
        '/inicio/farmacia', // M29
        '/cadastros/pacientes',
        '/cadastros/pacientes/duplicidades',
        '/cadastros/pacientes/historico',
        '/cadastros/pacientes/rede', // M57 (etapa 1): MPI da Rede
        '/cadastros/pessoas',
        '/cadastros/prescricao/frequencias', // M24
        '/cadastros/prescricao/hemocomponentes',
        '/cadastros/prescricao/horarios-padrao',
        '/cadastros/prescricao/itens-nao-padronizados',
        '/cadastros/prescricao/kits',
        '/cadastros/prescricao/locais-assistencia',
        '/cadastros/prescricao/parametros-item',
        '/cadastros/prescricao/perguntas-operadora',
        '/cadastros/prescricao/protocolos',
        '/cadastros/prescricao/receitas-padrao',
        '/cadastros/prestadores',
        '/cadastros/profissionais',
        '/cadastros/profissionais/historico',
        '/cadastros/solicitantes',
        '/cirurgia/mapa', // M18
        '/cirurgia/notas-sala', // M30
        '/cirurgia/registro',
        '/cirurgia/salas',
        '/consultorio/fila',
        '/contabil/demonstracoes', // M54.3
        '/contabil/lancamentos', // M54.1
        '/contabil/plano', // M54.1
        '/contabil/sped', // M54.3
        '/enfermagem/aprazamento',
        '/enfermagem/balanco', // M45 (etapa 3)
        '/enfermagem/sae', // M45 (etapa 4)
        '/enfermagem/classificacao', // M45 (etapa 2)
        '/enfermagem/escores', // M45 (etapa 2)
        '/enfermagem/plantao',
        '/enfermagem/turno',
        '/enfermagem/turno?secao=cuidados', // M45 (etapa 4): a prescrição de enfermagem no turno
        '/farmacia-clinica/antimicrobianos',
        '/farmacia-clinica/interacoes',
        '/faturamento/auditoria', // M30
        '/faturamento/competencias', // M31
        '/faturamento/contas',
        '/faturamento/contas-sus',
        '/faturamento/demonstrativos', // M31
        '/faturamento/credenciamento', // M12
        '/faturamento/de-para-exames',
        '/faturamento/glosas', // M31
        '/faturamento/guias', // M31
        '/faturamento/lancamento-automatico', // M30
        '/faturamento/lancamentos',
        '/faturamento/lotes', // M31
        '/faturamento/pacotes',
        '/faturamento/particular/caixa',
        '/faturamento/particular/orcamentos',
        '/faturamento/particular/pagamentos',
        '/faturamento/portes-terceiros',
        '/faturamento/regras-faturabilidade', // M30
        '/faturamento/simulador',
        '/faturamento/sus/apac', // M51 (etapa 3)
        '/faturamento/sus/aih', // M51 (etapa 4)
        '/faturamento/sus/bpa', // M51 (etapa 2)
        '/faturamento/sus/ciha', // M51 (etapa 1)
        '/faturamento/sus/contratualizacao', // M55 (etapa 5)
        '/faturamento/sus/sigtap', // M13
        '/faturamento/sus/solicitantes', // M51 (etapa 2)
        '/financeiro/fiscal/tabelas', // M13
        '/higienizacao/cadastros', // M21
        '/higienizacao/inspecao', // M21
        '/higienizacao/painel', // M21
        '/higienizacao/solicitacoes', // M21
        '/hotelaria/nutricao/dietas', // M23: Serviço de nutrição e dietética (CRUD genérico)
        '/hotelaria/rouparia', // M55 (etapa 2): rouparia e lavanderia
        '/inicio',
        '/inicio/assinaturas', // M23
        '/inicio/faturamento', // M30
        '/inicio/medico', // M27
        '/inicio/recepcao', // M27
        '/integracao/tiss', // M31
        '/internacao/admissao', // M21
        '/internacao/censo', // M16
        '/internacao/leitos/painel', // M16
        '/internacao/nir/altas-previstas', // M44 (etapa 2)
        '/internacao/nir/fila', // M44 (etapa 2)
        '/internacao/nir/fila', // M44 (etapa 3): o cartão do NIR na fila de trabalho
        '/internacao/nir/permanencia', // M44 (etapa 2)
        '/internacao/nir/regulacao', // M44 (etapa 3)
        '/internacao/nir/reservas', // M44 (etapa 2)
        '/internacao/pre', // M21
        '/internacao?acao=alta', // M21
        '/internacao?acao=guias', // M21
        '/internacao?acao=impressos', // M21
        '/internacao?acao=procedimentos', // M21
        '/internacao?acao=trocas', // M21
        '/leitos/historico', // M21
        '/leitos/mapa', // M21
        '/leitos/transferencias', // M21
        '/m/higienizacao', // M21
        '/m/higienizacao', // M21
        '/manutencao/os', // M55 (etapa 1): manutenção e engenharia clínica
        '/mensagens', // M27
        '/nutricao/mapa', // M45 (etapa 5)
        '/nutricao/mapa?aba=etiquetas', // M45 (etapa 5): a etiqueta e o acompanhante na tela do mapa
        '/nutricao/terapia', // M45 (etapa 5)
        '/nutricao/triagem', // M45 (etapa 5)
        '/nutricao/triagem', // M45 (etapa 5): o cartão da nutrição na fila de trabalho
        '/operadora/ans', // M56 (etapa F0)
        '/operadora/autorizacoes', // M56 (etapa 5, F4)
        '/operadora/rede', // M56 (etapa 4, F3)
        '/operadora/cobranca', // M56 (etapa 3, F2)
        '/operadora/beneficiarios', // M56.2 (fatia F1)
        '/operadora/portal-prestador', // M56 (etapa 8, F7)
        '/pa/classificacao', // M44
        '/pa/classificacao-externa', // M34
        '/pa/classificacao?lista=reclassificar', // M44
        '/pa/observacao',
        '/pa/protocolos', // M44 (etapa 3)
        '/pa/quadro',
        '/pa/quadro',
        '/pa/quadro', // M44 (etapa 3): o cartão do PA na fila de trabalho
        '/paineis', // M19
        '/patrimonio/bens', // M54.6
        '/patrimonio/depreciacao', // M54.6
        '/patrimonio/movimentos', // M54.6
        '/patrimonio/parametros', // M54.6
        '/pep/admin/impressao', // M22
        '/pep/admin/modelos', // M22
        '/pep/admin/tipos', // M22
        '/pep/uti/indices', // M45 (etapa 2)
        '/pep/cadastros/nutricao', // M23: Nutrição clínica (CRUD genérico das dietas)
        '/pep/especialidades/obstetricia', // M45 (etapa 6)
        '/pep/especialidades/oftalmologia', // M45 (etapa 6)
        '/pep/especialidades/oncologia', // M45 (etapa 6)
        '/pep/interconsultas',
        '/pep/pacientes',
        '/pep/pacientes?aba=alergias',
        '/pep/pacientes?aba=alta',
        '/pep/pacientes?aba=anexos',
        '/pep/pacientes?aba=atestados',
        '/pep/pacientes?aba=exames',
        '/pep/pacientes?aba=linha-do-tempo', // Início › Contexto do paciente
        '/pep/pacientes?aba=linha-do-tempo', // PEP › Linha do tempo e documentos
        '/pep/pacientes?aba=problemas',
        '/pep/pacientes?aba=receitas',
        '/pep/pacientes?aba=registro-novo', // M23: Multiprofissional › Evoluções multiprofissionais
        '/pep/pacientes?aba=resultados',
        '/pep/pacientes?aba=tcle',
        '/pep/pacientes?aba=tempos',
        '/pep/prescricao',
        '/pep/prescricao-digital', // M34
        '/pep/prescricao/alertas',
        '/pep/prescricao/futura',
        '/pep/prescricao/hemoterapia',
        '/pep/prescricao/montar',
        '/pep/prescricao/reconciliacao',
        '/pep/resultados/grupos', // F3.3 (03-PEP L128): grupos comparativos de resultados
        '/pessoas/colaboradores', // M52.1 (fatia F1)
        '/pessoas/escala', // M52.2 (fatia F2: a escala de plantão)
        '/pessoas/dimensionamento', // M52.3 (fatia F3: dimensionamento de enfermagem)
        '/pessoas/ponto', // M52.4 (fatia F4: o ponto)
        '/pessoas/regimes', // M52.2 (fatia F2: programação de escala e banco de horas)
        '/pessoas/sesmt/aso', // M52.5 (fatia F5)
        '/pessoas/sesmt/cat', // M52.5
        '/pessoas/sesmt/riscos', // M52.5
        '/pessoas/sesmt/vacinas', // M52.5
        '/pessoas/treinamentos', // M52.6 (fatia F6)
        '/pessoas/meu', // M52.6
        '/pessoas/folha', // M53.1 (etapa F0: a folha da competência)
        '/pessoas/esocial', // M53.6 (etapa F5: eventos, lotes, retornos e conciliação do eSocial)
        '/pessoas/obrigacoes', // M53.8 (etapa F7: FGTS Digital e obrigações legais)
        '/pessoas/folha/integracao', // M53.9 (etapa F8: títulos e fatos contábeis da folha)
        '/pep/prontuario', // M15
        '/pep/rascunhos', // M22
        '/pep/telemedicina', // M50 (etapa 4: PEP › Telemedicina; D-MENU-50.4)
        '/pep/telemedicina', // M50 (etapa 4: Portais › Portal do paciente › Teleconsulta; D-MENU-50.4)
        '/portais/medico-externo', // M50 (etapa 3: as contas do médico externo e o vínculo com o corpo clínico)
        '/portais/paciente', // M50 (etapa 1: o portal do paciente, lado interno)
        '/recepcao/pre-checkin', // M50 (etapa 2: a conferência do pré-check-in; D-MENU-50.2)
        '/portais/paciente/responsaveis', // M50 (etapa 1: a conferência dos responsáveis legais)
        '/portais/verificador', // M49 (etapa 3: o painel do verificador público)
        '/portaria', // M50 (etapa 5: a portaria)
        '/portaria/acompanhantes', // M50 (etapa 5)
        '/portaria/regras', // M50 (etapa 5)
        '/portaria/terminais', // M50 (etapa 5)
        '/precos/diarias-taxas', // M12
        '/precos/honorarios',
        '/precos/importacoes',
        '/precos/matmed',
        '/preferencias',
        '/preferencias/dicionario', // M27
        '/qualidade/ccih/antimicrobianos', // M48 (etapa 3)
        '/qualidade/ccih/iras', // M48 (etapa 3)
        '/qualidade/ccih/maos-surtos', // M48 (etapa 3)
        '/qualidade/ccih/precaucoes', // M48 (etapa 3)
        '/qualidade/ccih/vigilancia', // M48 (etapa 3)
        '/qualidade/ccih/vigilancia', // M48 (etapa 3): o cartão da CCIH na fila de trabalho
        '/qualidade/documentos', // M48 (etapa 5): gestão documental
        '/qualidade/gestao/auditorias', // M48 (etapa 5): auditorias internas por checklist
        '/qualidade/gestao/comissoes', // M48 (etapa 5): comissões obrigatórias
        '/qualidade/gestao/riscos', // M48 (etapa 5): matriz de riscos GUT e não conformidades
        '/qualidade/indicadores', // M48 (etapa 5): indicadores com ficha técnica e análise crítica
        '/qualidade/notificar', // M48 (etapa 1): Início › Notificar incidente (a tela cheia do botão global)
        '/qualidade/nsp/analises', // M48 (etapa 2): análise e plano de ação 5W2H
        '/qualidade/nsp/notificacoes', // M48 (etapa 1)
        '/qualidade/nsp/prazos', // M48 (etapa 1)
        '/qualidade/nsp/prazos', // M48 (etapa 1): o cartão do NSP na fila de trabalho
        '/qualidade/nsp/protocolos', // M48 (etapa 2): adesão a protocolos e painel do plano de segurança
        '/qualidade/ouvidoria', // M48 (etapa 5): ouvidoria, SAC e pesquisa de satisfação
        '/qualidade/vigilancia/agravos', // M48 (etapa 4): notificação compulsória (fila, casos e ficha impressa)
        // M20: atendimento ambulatorial e pronto atendimento (as telas de uma ficha abrem da lista do dia).
        '/recepcao/atendimento/novo',
        '/recepcao/atendimento?acao=encerrar',
        '/recepcao/atendimento?acao=impressos',
        '/recepcao/atendimento?acao=procedimentos',
        '/recepcao/atendimento?acao=segurado',
        '/recepcao/guiche', // M19
        '/recepcao/recepcoes',
        '/recepcao/senhas/geradores',
        '/recepcao/senhas/paineis',
        '/relatorios', // M34
        '/relatorios/agendamentos', // M34
        '/relatorios/bi/rede', // M57 (etapa 3): BI consolidado da Rede
        '/relatorios/envios-regulatorios', // M48 (etapa 5): PM-QUALISS, IRAS e Notivisa
        '/relatorios/glosas', // M31
        '/relatorios/indicadores', // M16
        '/relatorios/paineis/assistencial', // M16
        '/sadt/agencia/cadastros', // M47 (etapa 2)
        '/sadt/agencia/estoque', // M47 (etapa 2)
        '/sadt/agencia/hemovigilancia', // M47 (etapa 1)
        '/sadt/agencia/imuno', // M47 (etapa 2)
        '/sadt/agencia/requisicoes', // M47 (etapa 1)
        '/sadt/amostras',
        '/sadt/atendimentos', // M26
        '/sadt/coleta',
        '/sadt/exames',
        '/sadt/imagem/worklist', // M47 (etapa 3)
        '/sadt/laboratorio/apoio', // M34
        '/sadt/laboratorio/interfaces', // M34
        '/sadt/laudos',
        '/sadt/laudos/emissao',
        '/sadt/orcamentos',
        '/sadt/resultados/digitacao',
        '/sadt/resultados/liberacao',
        '/sadt/solicitantes/autocadastro',
        '/same/digitalizacao', // M50 (etapa 6)
        '/same/movimentos', // M21
        '/servico-social', // M45 (etapa 5)
        '/cadastros/dominios/grupo/financeiroCadastros', // M32
        '/cadastros/dominios/grupo/financeiroNaturezas', // M32
        '/financeiro/contabil/exportacao', // M32
        '/custos/centros', // M54 (etapa 4)
        '/financeiro/orcamento', // M54 (etapa 7)
        '/custos/apuracao', // M54 (etapa 5)
        '/custos/resultado', // M54 (etapa 5)
        '/financeiro/fiscal/dmed', // M32
        '/financeiro/fiscal/entradas', // M32
        '/financeiro/fiscal/nfse', // M32
        '/financeiro/fiscal/reinf', // M32
        '/financeiro/gerencial', // M32
        '/financeiro/pagar/adiantamentos', // M32
        '/financeiro/pagar/aprovacao', // M32
        '/financeiro/pagar/borderos', // M32
        '/financeiro/pagar/remessas', // M32
        '/financeiro/pagar/titulos', // M32
        '/financeiro/parametros', // M32
        '/financeiro/receber/convenios', // M32
        '/financeiro/receber/demonstrativos', // M32
        '/financeiro/receber/renegociacoes', // M32
        '/financeiro/receber/titulos', // M32
        '/financeiro/tesouraria/conciliacao', // M32
        '/financeiro/tesouraria/fluxo-caixa', // M32
        '/financeiro/tesouraria/movimento', // M32
      ].sort(),
    );
  });

  it('nenhum nome de tabela do sistema de origem no contrato (fronteira: só o conector conhece a origem)', () => {
    // As tabelas da origem que o mapa do conector conhece (versionado; 1.ª coluna de conector/mapa/tabelas.tsv),
    // somadas às do dicionário completo de colunas da origem quando ele existe na máquina (referencias/, fora do
    // git por ser estrutura de terceiros: TABELA|COLUNA|... por linha). No CI só o mapa existe.
    const raizRepo = resolve(import.meta.dirname, '../../../..');
    const mapa = readFileSync(resolve(raizRepo, 'conector/mapa/tabelas.tsv'), 'utf8')
      .split('\n')
      .slice(1)
      .map((l) => l.split('\t')[0]!);
    const caminhoDicionario = resolve(raizRepo, 'referencias/spdata-colunas-raw.txt');
    const dicionario = existsSync(caminhoDicionario)
      ? readFileSync(caminhoDicionario, 'utf8')
          .split('\n')
          .map((l) => l.split('|')[0]!)
      : [];
    const tabelas = new Set([...mapa, ...dicionario].filter(Boolean));
    expect(tabelas.size).toBeGreaterThan(1500);
    const palavras = JSON.stringify(ARVORE_MENU).match(/[A-Z][A-Z0-9_]{2,}/g) ?? [];
    expect(palavras.filter((p) => tabelas.has(p))).toEqual([]);
    expect(JSON.stringify(ARVORE_MENU)).not.toContain('tabelas:');
  });

  it('rótulo de produto: telas no menu sem parênteses de planejamento nem menção ao sistema antigo', () => {
    const visiveis = ARVORE_MENU.filter((i) => i.rota !== null);
    for (const i of visiveis) {
      const textos = [i.area, ...i.caminho];
      expect(
        textos.filter((t) => /[()]/.test(t)),
        i.id,
      ).toEqual([]);
      expect(
        textos.filter((t) => /spdata|legado|sistema (atual|antigo)/i.test(t)),
        i.id,
      ).toEqual([]);
    }
    expect(ARVORE_MENU.find((i) => i.rota === '/inicio')?.titulo).toBe('Minha fila de trabalho');
    expect(ARVORE_MENU.find((i) => i.rota === '/preferencias')?.titulo).toBe(
      'Aparência e segurança da conta',
    );
    expect(ARVORE_MENU.find((i) => i.rota === '/administracao/liberacao')?.titulo).toBe(
      'Funcionalidades por estabelecimento',
    );
    expect(ARVORE_MENU.find((i) => i.rota === '/cadastros/dominios/grupo/agenda')?.caminho[1]).toBe(
      'Cadastros auxiliares',
    );
  });

  it('área Técnico: só telas de permissão técnica, concedida só ao perfil técnico (e ao acesso total)', () => {
    const tecnicas = ARVORE_MENU.filter((i) => i.area === 'TÉCNICO' && i.rota !== null);
    expect(tecnicas.map((i) => i.rota).sort()).toEqual([
      '/administracao/coexistencia/assinaturas',
      '/administracao/coexistencia/conexoes',
      '/administracao/coexistencia/estabelecimentos',
      '/administracao/coexistencia/gravacao',
      '/administracao/coexistencia/matriz',
      '/administracao/coexistencia/schema',
      '/administracao/saude',
    ]);
    for (const i of tecnicas) {
      const p = CATALOGO_DECLARADO.find((d) => d.codigo === i.permissao);
      expect(p, i.permissao!).toMatchObject({ categoria: 'tecnica', perfis: ['administrador-sistema'] });
    }
  });
});
