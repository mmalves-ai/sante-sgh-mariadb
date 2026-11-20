// Tela de testes de assinatura (M03): lista as operações do catálogo com o estado por estabelecimento e a
// última execução (arquivos de resultado); só em dev; nenhum acesso ao banco.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { esquemaPainelAssinaturas } from '@sgh/contratos';
import { OPERACOES_DOMINIOS } from '@sgh/legado';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { caminhosPadrao, fonteArquivosAssinatura } from './assinaturas.js';

const raiz = resolve(import.meta.dirname, '../../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'sgh-api-assinaturas-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const resultado = (operacao: string, hospital: string, executadoEm: string, cenarios: unknown[]) => ({
  formato: 1,
  operacao,
  hospital,
  executadoEm,
  cenarios,
});

let app: NestFastifyApplication | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/** Ambiente de dev com a rede padrão (a sessão sintética responde no loopback). */
const ENV_DEV = { AMBIENTE: 'dev', REDE_PADRAO: 'rede-teste' };

describe('GET /api/config/assinaturas', () => {
  it('lista as 22 operações do catálogo versionado (18 especificadas, 2 verdes do M04, a trilha do M06 e a troca de senha bloqueada)', async () => {
    const fonte = fonteArquivosAssinatura({ ...caminhosPadrao(raiz, {}), resultados: join(tmp, 'vazio') }, [
      'pc',
    ]);
    // M06: a rota exige sessão e config.assinatura.ler (a sessão sintética de dev a tem).
    app = await criarApp(lerConfiguracao({ AMBIENTE: 'dev' }), null, ENV_DEV, { assinaturas: fonte });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const r = await app.inject({ method: 'GET', url: '/api/config/assinaturas' });
    expect(r.statusCode).toBe(200);
    const p = esquemaPainelAssinaturas.parse(r.json());
    // 20 do protocolo da sante-api (18 especificadas e as 2 do M04 verdes no pc), mais acesso.trocarSenha
    // bloqueada (M05, ADR 0012).
    // M08: mais as 32 da receita genérica do CRUD genérico, verdes no pc. ADR 0022: mais as 11 das
    // permissões do próprio legado, verdes no pc. M11: mais as 6 do CRUD genérico do marco (verdes),
    // cadastro.alterarPaciente (verde) e 4 especificadas (unificação, profissional, solicitante).
    // M12: mais 8 da receita genérica (classificações oncológicas), as 2 novas verdes (contrato e desfazer)
    // e 5 especificadas do marco (onda 4). M10: mais 23 receitas próprias (usuários, escopos, termo, acomodações
    // e leitos) e 20 da receita genérica (estrutura), todas verdes no pc, e 2 especificadas (flags do usuário e
    // parâmetro gravado no banco). M13: mais as 8 do CRUD genérico do marco (verdes), as 9 cargas de catálogo
    // (verdes) e a CBHPM especificada. M22: mais as 4 do registro clínico (registro, rascunho, descarte e
    // suspensão).
    // M17: mais 10 da agenda de consultas (15 receitas no total do marco; 14 verdes no pc e agendarSemProntuario
    // especificada) e a cobertura da agenda de exames separada (especificada, M18).
    // M23: mais as 8 do prontuário de uso diário (alergias, documentos, sumário, anexo, exame externo e pedido de
    // exames) e a coassinatura do preceptor (especificada, desligada: POL-3).
    // M18: a agenda de exames e o centro cirúrgico (11 receitas, 4 delas no lugar das especificadas antigas) e as 7
    // do CRUD genérico do marco. M24: mais as 6 da prescrição (prescrever, copiar, renovar, incluir item, suspender
    // item e suspender a prescrição).
    // M14: mais as operações do lote gerado (receita genérica dos domínios em massa).
    const doM14 = new Set(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M14').map((o) => o.receita.nome),
    );
    // M23: mais as 12 dos cadastros de dieta (receita genérica). M19: mais as 6 receitas da recepção e as 6 do CRUD
    // genérico dos cadastros da recepção (verdes no pc). M18: mais as 11 receitas e as 7 do CRUD genérico, menos as
    // 4 especificadas antigas que as receitas substituem. M24: mais as 6 da prescrição e as 5 dos cadastros de
    // prescrição (receita genérica), mais as 43 dos demais cadastros de prescrição (P-CAD-1). M20: mais as 7 receitas
    // do atendimento externo e as 13 do CRUD genérico das fichas a imprimir e dos leitos de observação. M26: mais as 10
    // do SADT (o cadastro do solicitante já estava no catálogo) e as 13 do CRUD genérico do portal e das modalidades.
    // M21: + as 17 receitas e as 15 do CRUD genérico do marco. M25: + as 3 receitas da beira do leito e as 5 do CRUD
    // genérico (procedimentos e kits de enfermagem). M27: + as 2 do dicionário pessoal. M34: + as 18 do CRUD genérico
    // (de-para do laboratório de apoio e das interfaces, domínios das mensagens e dos webservices). M28: + as 15 do estoque e das compras, menos a do vencedor da
    // cotação especificada antes pela referência da sante-api, que a receita do marco substitui. M29: + as 6 da farmácia.
    // M30: + 5 da conta do paciente no catálogo (conferirItem e lancarItem; as P2 auditarConta, excluirItem e
    // atualizarBeneficiario); fecharConta e reabrirConta já estavam. M31: + 6 do pós-fechamento (gerarLote,
    // registrarRetornoRecurso, fecharCompetencia e as P2 emitirConta, reabrirCompetencia e gerarLoteRecurso); protocolo,
    // baixa e recurso já estavam. M32: + 3 receitas do financeiro (baixarTitulo, criarTituloReceber e lancarMovimento;
    // criarTituloPagar já estava) e as 44 do CRUD genérico dos cadastros financeiros. M33: + 4 receitas do repasse
    // (lancarEvento, emitirRpa, integrarItens e incluirRegra) e as 22 do CRUD genérico dos cadastros do repasse.
    // M44 (etapa 2): + internacao.reservarLeito, especificada até o cenário controlado do M36. M49 (etapa 3): + as 8
    // do CRUD genérico dos cadastros da assinatura digital (incluir o OID e alterar os sete). M56 (etapa 1): + as 30
    // do CRUD genérico da operadora própria (14 incluir e 16 alterar; 29 verdes no pc e alterarMensagemCobranca
    // especificada, POL-3). M45 (etapa 1): + pep.publicarFormularioNovo, especificada até o cenário controlado do M36.
    // M50 (etapa 6): + as 4 do CRUD genérico das agendas de sessões e das cadeiras e salas (verdes no pc).
    // M47 (etapa 2): + as 14 do CRUD genérico dos cadastros da agência transfusional (verdes no pc). M51 (etapa 2):
    // + as 2 do CRUD genérico dos médicos solicitantes SUS (verdes no pc). M51 (etapa 4): + as 2 do CRUD genérico dos
    // leitos de UTI habilitados e a carga dos domínios do SIH e do SIA (catalogo.importarDominiosSus).
    // M53 (etapa F1): + as 12 do CRUD genérico das rubricas, incidências e tabelas legais (12 verdes no pc).
    // M56.7: + operadora.importarCatalogoAns (o importador dos catálogos da ANS, verde no pc).
    // M48 (etapa 4): mais a carga da lista nacional de notificação compulsória (catalogo.importarAgravos, verde no pc).
    // M48 (etapa 5): mais as 4 do CRUD genérico das autoridades sanitárias e da escala GUT (verdes no pc).
    // M54 (etapa 4): mais as 7 do CRUD genérico dos cadastros da estrutura de custos (verdes no pc).
    // M59 (etapa 2): + acesso.retirarSenhaLegado (verde no pc).
    // M54 (etapa F1): + as 10 do CRUD genérico das migrar-crud da controladoria (contabil e patrimonio).
    // M59 (etapa 3): + as 2 da retirada das senhas secundárias e dos segredos de parceiros (verdes no pc).
    // M54 (etapa 3): + catalogo.importarSpedContabil (a carga das tabelas do SPED contábil, verde no pc).
    // D-PROF-39: + as 5 novas do profissional do corpo clínico (registro, especialidade, lotação, credenciamento).
    // D-PROF-39 (requisitos do dono): + 5 (login, inativar, reativar, excluir e excluir registro).
    // W0-02: os verbos novos do motor do CRUD genérico (reativar pela coluna de situação; excluir) são contados à parte:
    // o catálogo só acrescenta, nada muda nas demais.
    const doW002 = new Set(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'W0-02').map((o) => o.receita.nome),
    );
    expect(p.operacoes.filter((o) => doW002.has(o.nome)).length).toBe(doW002.size);
    // W1-01: + acesso.redefinirSenha (senha provisória do gestor, verde no pc). W1-01 4b: + acesso.renomearGrupo e acesso.excluirGrupo.
    // W1-01 parte 6: + acesso.publicarTermo.
    // W1-04: + as 3 da procedência (incluir, alterar e inativar), que saíram do lote do M14 para o M19; parte 3: + incluir recepção;
    // parte 4: + incluir painel de chamada e painel de TV; parte 6: + desfazer a chegada.
    // W1-01 (+ 4) e W1-05 (+ 6): o estorno e a correção do procedimento extra, a correção da ficha aberta e a inclusão
    // do modelo e do título da ficha a imprimir e do local de observação.
    expect(p.operacoes.filter((o) => !doM14.has(o.nome) && !doW002.has(o.nome))).toHaveLength(610);
    const doM56 = p.operacoes.filter((o) => o.nome.startsWith('operadora.'));
    expect(doM56).toHaveLength(31);
    expect(doM56.filter((o) => o.estados['pc'] !== 'verde').map((o) => o.nome)).toEqual([
      'operadora.alterarMensagemCobranca',
    ]);
    expect(p.operacoes.filter((o) => doM14.has(o.nome))).toHaveLength(doM14.size);
    const ehDoM10 = (n: string) =>
      (n.startsWith('organizacao.') && !doW002.has(n)) ||
      /^acesso\.(?:criar|alterar|bloquear|desbloquear)Usuario$/.test(n) ||
      /^acesso\.(?:conceder|retirar)(?:Unidade|Local|Convenio|ConvenioFaturamento|TipoAgenda|TipoProntuario)Usuario$/.test(
        n,
      ) ||
      n === 'acesso.aceitarTermo';
    const doM10 = p.operacoes.filter((o) => ehDoM10(o.nome));
    expect(doM10).toHaveLength(43);
    expect(new Set(doM10.map((o) => o.estados['pc']))).toEqual(new Set(['verde']));
    const adr0022 = p.operacoes.filter(
      (o) => o.nome.startsWith('acesso.') && /(?:Opcoes|Papel|Grupo)/.test(o.nome),
    );
    expect(adr0022).toHaveLength(13); // W1-01 4b: + renomearGrupo e excluirGrupo (verdes).
    expect(new Set(adr0022.map((o) => o.estados['pc']))).toEqual(new Set(['verde']));
    const doM11 = new Set([
      'cadastro.alterarPaciente',
      'cadastro.unificarPaciente',
      'cadastro.cadastrarProfissional',
      'cadastro.alterarProfissional',
      'cadastro.cadastrarSolicitante',
      // D-PROF-39: as receitas novas do profissional (especificadas até a assinatura verde).
      'cadastro.incluirRegistroProfissional',
      'cadastro.alterarRegistroProfissional',
      'cadastro.definirEspecialidadeProfissional',
      'cadastro.lotarProfissional',
      'cadastro.credenciarProfissional',
      'cadastro.vincularLoginProfissional',
      'cadastro.inativarProfissional',
      'cadastro.reativarProfissional',
      'cadastro.excluirProfissional',
      'cadastro.excluirRegistroProfissional',
    ]);
    const doM17 = new Set(
      [
        'agendarConsulta',
        'cancelarConsulta',
        'definirCobertura',
        'gerarGrade',
        'reverterGrade',
        'encaixar',
        'desfazerEncaixe',
        'remarcarConsulta',
        'confirmarConsulta',
        'registrarFalta',
        'bloquearHorarios',
        'incluirAgenda',
        'alterarAgenda',
        'definirEspecialidade',
      ].map((n) => `agenda.${n}`),
    );
    expect(new Set(p.operacoes.filter((o) => doM17.has(o.nome)).map((o) => o.estados['pc']))).toEqual(
      new Set(['verde']),
    );
    const doM19 = new Set([
      'recepcao.emitirSenha',
      'recepcao.chamarSenha',
      'recepcao.registrarEventoSenha',
      'recepcao.registrarChegada',
      'recepcao.desfazerChegada',
      'recepcao.abrirGuiche',
      'recepcao.fecharGuiche',
      'recepcao.alterarRecepcao',
      'recepcao.incluirGerador',
      'recepcao.alterarGerador',
      'recepcao.inativarGerador',
      'recepcao.alterarPainel',
      'relatorio.alterarPainel',
    ]);
    expect(doM19.size).toBe(13);
    expect(new Set(p.operacoes.filter((o) => doM19.has(o.nome)).map((o) => o.estados['pc']))).toEqual(
      new Set(['verde']),
    );
    // M18: as receitas da agenda de exames e do centro cirúrgico, verdes no pc (a sem prontuário segue especificada).
    // M20: as 7 receitas do atendimento externo (verdes no pc).
    const doM20 = new Set([
      'atendimento.abrirAtendimento',
      'atendimento.alterarSegurado',
      'atendimento.lancarProcedimentoExtra',
      'atendimento.conduzirNoConsultorio',
      'atendimento.encerrarAtendimento',
      'atendimento.cancelarAtendimento',
      'atendimento.alterarHeranca',
    ]);
    // M26: as 9 receitas do SADT (verdes no pc; a emissão do laudo no outro sistema fica especificada, D-LAUDO-26).
    const doM26 = new Set([
      'sadt.abrirRequisicao',
      'sadt.receberSolicitacao',
      'sadt.lancarExame',
      'sadt.registrarResultado',
      'sadt.registrarLaudo',
      'sadt.liberarExame',
      'sadt.retificarResultado',
      'sadt.criarOrcamento',
      'sadt.registrarVisualizacaoPortal',
    ]);
    // M21: as 17 receitas da internação, dos leitos, da higienização e do SAME (12 verdes; 5 em referência).
    const doM21 = new Set(
      [
        'internar',
        'transferirLeito',
        'darAlta',
        'preInternar',
        'corrigirPreInternacao',
        'trocarConvenio',
        'trocarClinica',
        'trocarEspecialidade',
        'trocarMedico',
        'registrarGuia',
        'cancelarAlta',
        'excluirInternacao',
      ]
        .map((x) => `internacao.${x}`)
        .concat([
          'hotelaria.solicitarLimpeza',
          'hotelaria.avancarLimpeza',
          'hotelaria.liberarLeito',
          'same.movimentarProntuario',
          'same.excluirMovimento',
        ]),
    );
    // M25: a checagem verde no pc; W1-08: o aprazamento e o estorno verdes no pc (assinatura na cópia, 19/11/2026).
    const doM25 = new Set([
      'enfermagem.checarAdministracao',
      'enfermagem.aprazarHorario',
      'enfermagem.estornarChecagem',
    ]);
    // W0-01: o carregador devolve as operações na ordem do nome.
    expect(p.operacoes.filter((o) => doM25.has(o.nome)).map((o) => [o.nome, o.estados['pc']])).toEqual([
      ['enfermagem.aprazarHorario', 'verde'],
      ['enfermagem.checarAdministracao', 'verde'],
      ['enfermagem.estornarChecagem', 'verde'],
    ]);
    const doM27 = new Set(['acesso.incluirPalavraDicionario', 'acesso.excluirPalavraDicionario']);
    const doM18 = new Set([
      'agenda.agendarExame',
      'agenda.cancelarExame',
      'agenda.remarcarExame',
      'agenda.gerarGradeExame',
      'agenda.definirCoberturaExame',
      'cirurgia.agendarCirurgia',
      'cirurgia.cancelarCirurgia',
      'cirurgia.remarcarCirurgia',
      'cirurgia.registrarCirurgia',
      'cirurgia.definirSalaUsuario',
    ]);
    expect(new Set(p.operacoes.filter((o) => doM18.has(o.nome)).map((o) => o.estados['pc']))).toEqual(
      new Set(['verde']),
    );
    const doPcad1 = new Set(
      OPERACOES_DOMINIOS.filter(
        (o) => o.receita.marco === 'M24' && !/LocalAssistencia|PerguntaOperadora/.test(o.receita.nome),
      ).map((o) => o.receita.nome),
    );
    // M32: os 44 dos cadastros financeiros: 21 verdes e 23 completas e desligadas (POL-3, D-CRUD-32).
    const doM32 = new Set(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M32').map((o) => o.receita.nome),
    );
    expect(doM32.size).toBe(44);
    expect(p.operacoes.filter((x) => doM32.has(x.nome) && x.estados['pc'] === 'verde')).toHaveLength(21);
    for (const o of p.operacoes.filter((x) => doM32.has(x.nome)))
      expect(['verde', 'especificada']).toContain(o.estados['pc']);
    // M33: os 22 dos cadastros do repasse: 4 verdes e 18 completas e desligadas (POL-3, D-CRUD-33).
    const doM33 = new Set(
      OPERACOES_DOMINIOS.filter((o) => o.receita.marco === 'M33').map((o) => o.receita.nome),
    );
    expect(doM33.size).toBe(22);
    expect(p.operacoes.filter((x) => doM33.has(x.nome) && x.estados['pc'] === 'verde')).toHaveLength(4);
    for (const o of p.operacoes.filter((x) => doM33.has(x.nome)))
      expect(['verde', 'especificada']).toContain(o.estados['pc']);
    const genericas = p.operacoes.filter(
      (o) =>
        /^[a-z]+\.(?:incluir|alterar|inativar)[A-Z]/.test(o.nome) &&
        ![
          'convenio.alterarSituacao',
          'convenio.alterarContrato',
          'acesso.alterarFlagsUsuario',
          'config.alterarParametroLegado',
          'pep.incluirItem', // M24: receita própria da prescrição
          // M23: receita própria (retirada da alergia), não a genérica.
          'pep.inativarAlergia',
          // M20: receitas próprias do atendimento externo (carteirinha e herança), não a genérica.
          'atendimento.alterarSegurado',
          'atendimento.alterarHeranca',
          // M26: a inclusão de setor publicado no portal fica especificada (POL-3; teste abaixo).
          'sadt.incluirPortalSetor',
          // M27: receita própria do dicionário pessoal (a chave começa pelo login da sessão; D-DIC-27).
          'acesso.incluirPalavraDicionario',
          // M33: receita própria da inclusão da regra aprovada (não a genérica).
          'repasse.incluirRegra',
        ].includes(o.nome) &&
        !doM11.has(o.nome) &&
        !ehDoM10(o.nome) &&
        !doM14.has(o.nome) &&
        !doM17.has(o.nome) &&
        !doM19.has(o.nome) &&
        !doPcad1.has(o.nome) &&
        !doM32.has(o.nome) &&
        !doM33.has(o.nome) &&
        // M49 (etapa 3): as 8 do CRUD genérico dos cadastros da assinatura digital, todas verdes no pc.
        !o.nome.startsWith('documento.') &&
        // M56 (etapa 1): as 30 do CRUD genérico da operadora própria, conferidas à parte acima.
        !o.nome.startsWith('operadora.') &&
        // M50 (etapa 5): os 5 do CRUD dos tipos de visitante e de visitado, conferidos à parte abaixo.
        !/^hotelaria\.(incluir|alterar|inativar)Tipo(Visitante|Visitado)$/.test(o.nome),
    );
    expect(
      p.operacoes
        .filter((x) => /^hotelaria\.(incluir|alterar|inativar)Tipo(Visitante|Visitado)$/.test(x.nome))
        .map((x) => [x.nome, x.estados['pc']]),
    ).toEqual([
      // W0-01: na ordem do nome.
      ['hotelaria.alterarTipoVisitado', 'verde'],
      ['hotelaria.alterarTipoVisitante', 'verde'],
      ['hotelaria.inativarTipoVisitante', 'verde'],
      ['hotelaria.incluirTipoVisitado', 'especificada'],
      ['hotelaria.incluirTipoVisitante', 'especificada'],
    ]);
    const doM49 = p.operacoes.filter(
      (x) => /^documento\.(incluir|alterar)/.test(x.nome) && x.estados['pc'] === 'verde',
    );
    expect(doM49).toHaveLength(8);
    // M24 (P-CAD-1): os 43 dos demais cadastros de prescrição, verdes ou especificados (desligados, POL-3).
    expect(doPcad1.size).toBe(43);
    for (const o of p.operacoes.filter((x) => doPcad1.has(x.nome)))
      expect(['verde', 'especificada']).toContain(o.estados['pc']);
    // M23: mais as 12 dos cadastros de dieta. M18: mais as 7 do CRUD genérico do marco (agenda de exames, escala da
    // agenda de exames e salas). M24: mais as 5 dos locais de assistência e das perguntas à operadora. M20: mais as
    // 13 das fichas a imprimir e dos leitos de observação. M26: mais as 13 do portal, das modalidades e das grandezas.
    // M21: mais as 15 das fichas da internação, da higienização e do SAME. M25: mais as 5 dos procedimentos e kits de
    // enfermagem. M34: mais as 18 do de-para do laboratório de apoio e das interfaces, dos domínios das mensagens e
    // dos webservices. M50 (etapa 6): mais as 4 das agendas de sessões e das cadeiras e salas. M47 (etapa 2): mais as
    // 14 dos cadastros da agência transfusional. M51 (etapa 2): mais as 2 dos médicos solicitantes SUS. M51 (etapa 4):
    // mais as 2 dos leitos de UTI habilitados. M53 (etapa F1): mais as 12 das rubricas, incidências e tabelas legais.
    // M48 (etapa 5): mais as 4 das autoridades sanitárias e da escala GUT. M54 (etapa 4): mais as 7 dos cadastros da
    // estrutura de custos.
    // M54 (etapa F1): mais as 10 da contabilidade e do patrimônio.
    // W1-04: mais as 3 da procedência (incluir, alterar e inativar), que saíram do lote do M14 para o M19; parte 3:
    // mais a inclusão da recepção; parte 4: mais a inclusão dos dois painéis.
    // W1-05: mais a correção da ficha aberta (atendimento.alterarAtendimento) e a inclusão do modelo e do título da
    // ficha a imprimir e do local de observação.
    expect(genericas).toHaveLength(206);
    expect(p.operacoes.find((o) => o.nome === 'sadt.incluirPortalSetor')?.estados['pc']).toBe('especificada');
    // M53 (etapa F1): a alteração da rubrica também verde (M53.2: o carimbo do gatilho na referência da alteração).
    expect(p.operacoes.find((o) => o.nome === 'pessoas.alterarRubrica')?.estados['pc']).toBe('verde');
    expect(new Set(genericas.map((o) => o.estados['pc']))).toEqual(new Set(['verde']));
    const verdes = [
      'acesso.criarUsuarioIntegracao',
      // M59 (etapa 2): a retirada da senha antiga, verde no pc.
      'acesso.retirarSenhaLegado',
      // M59 (etapa 3): as senhas secundárias e os segredos de parceiros, verdes no pc.
      'acesso.retirarSenhaSecundaria',
      'integracao.cifrarSegredoLegado',
      'auditoria.registrarEventoLegado',
      'cadastro.cadastrarPaciente',
      'convenio.alterarContrato',
      'convenio.alterarSituacao',
      'preco.desfazerReajuste',
      'preco.reajustar',
      // M13: as cargas dos catálogos oficiais.
      'catalogo.importarBrasindice',
      'catalogo.importarCbo',
      'catalogo.importarCep',
      'catalogo.importarCid',
      // M51 (etapa 4): os domínios dos leiautes do SIH e do SIA.
      'catalogo.importarDominiosSus',
      'catalogo.importarAgravos',
      'catalogo.importarFiscal',
      'catalogo.importarListasOficiais',
      'catalogo.importarSigtap',
      'catalogo.importarSimpro',
      // M54 (etapa 3): as tabelas de código e nome do SPED contábil.
      'catalogo.importarSpedContabil',
      'catalogo.importarTuss',
      // M22: o registro clínico.
      'pep.descartarRascunho',
      'pep.registrarEvolucao',
      'pep.salvarRascunho',
      'pep.suspenderEvolucao',
      // M23: o prontuário de uso diário.
      'pep.anexarDocumento',
      'pep.emitirDocumento',
      'pep.finalizarSumarioAlta',
      'pep.inativarAlergia',
      'pep.lancarExameExterno',
      'pep.registrarAlergia',
      'pep.solicitarExame',
      'pep.suspenderDocumento',
      // M24: a prescrição (18 cenários do prescrever e os das demais, verdes no pc).
      'pep.prescrever',
      'pep.copiarPrescricao',
      'pep.renovarPrescricao',
      'pep.incluirItem',
      'pep.suspenderItem',
      'pep.suspenderPrescricao',
      // M28: as do estoque e das compras verdes no pc (os documentos de estoque seguem especificados, D-MOTOR-28).
      'suprimentos.requisitarMaterial',
      // M29: a entrega ao setor, verde no pc.
      'suprimentos.confirmarEntrega',
      'suprimentos.criarPedido',
      'suprimentos.registrarProposta',
      'suprimentos.definirVencedorCotacao',
      // M30: fechar, reabrir e conferir a conta, verdes no pc (o lançamento manual e as P2 seguem especificados).
      'faturamento.fecharConta',
      'faturamento.reabrirConta',
      'faturamento.conferirItem',
      // M31: as 6 do pós-fechamento, verdes no pc (as P2 seguem especificadas).
      'faturamento.gerarLote',
      'faturamento.registrarProtocolo',
      'faturamento.registrarGlosa',
      'faturamento.registrarRecurso',
      'faturamento.registrarRetornoRecurso',
      'faturamento.fecharCompetencia',
      // M32: as 4 receitas do financeiro, verdes no pc.
      'financeiro.criarTituloPagar',
      'financeiro.baixarTitulo',
      'financeiro.criarTituloReceber',
      'financeiro.lancarMovimento',
      // M33: o lançamento de eventos do repasse, verde no pc (RPA, apuração gravada e inclusão da regra especificadas).
      'repasse.lancarEvento',
      // W1-05: o estorno e a correção do procedimento extra com a conta aberta, verdes no pc.
      'atendimento.estornarProcedimentoExtra',
      'atendimento.corrigirProcedimentoExtra',
    ];
    const doProtocolo = p.operacoes.filter(
      (o) =>
        o.nome !== 'acesso.trocarSenha' &&
        !verdes.includes(o.nome) &&
        !genericas.includes(o) &&
        !adr0022.includes(o) &&
        !doM11.has(o.nome) &&
        !ehDoM10(o.nome) &&
        !doM14.has(o.nome) &&
        !doM17.has(o.nome) &&
        !doM19.has(o.nome) &&
        !doM18.has(o.nome) &&
        !doPcad1.has(o.nome) &&
        !doM20.has(o.nome) &&
        !doM26.has(o.nome) &&
        !doM21.has(o.nome) &&
        !doM25.has(o.nome) &&
        !doM27.has(o.nome) &&
        !doM32.has(o.nome) &&
        !doM33.has(o.nome) &&
        !doM49.includes(o) &&
        !doM56.includes(o) &&
        !doW002.has(o.nome) &&
        // W1-01: a senha provisória do gestor e as permissões complementares (verdes no pc).
        o.nome !== 'acesso.redefinirSenha' &&
        o.nome !== 'acesso.alterarFlagsUsuario' &&
        // W1-01 parte 6: a nova versão do termo (verde no pc).
        o.nome !== 'acesso.publicarTermo' &&
        !/^hotelaria\.(incluir|alterar|inativar)Tipo(Visitante|Visitado)$/.test(o.nome),
    );
    // M27: o dicionário pessoal (incluir e excluir palavra), verdes no pc.
    expect(p.operacoes.filter((o) => doM27.has(o.nome)).map((o) => o.estados['pc'])).toEqual([
      'verde',
      'verde',
    ]);
    expect(p.operacoes.filter((o) => doM26.has(o.nome)).map((o) => o.estados['pc'])).toEqual(
      [...doM26].map(() => 'verde'),
    );
    expect(p.operacoes.filter((o) => doM20.has(o.nome)).map((o) => o.estados['pc'])).toEqual(
      [...doM20].map(() => 'verde'),
    );
    expect(p.operacoes.find((o) => o.nome === 'cadastro.alterarPaciente')?.estados['pc']).toBe('verde');
    expect(new Set(doProtocolo.map((o) => o.estados['pc']))).toEqual(new Set(['especificada']));
    // W0-02: as reativações pela situação capturadas na cópia e promovidas (47 verdes; as 5 cuja inativação ainda espera
    // a prova, POL-3, seguem especificadas com o motivo herdado).
    // Rodada 2: + as 2 exclusões dos pilotos do catálogo (característica de dieta e a ligação com a dieta).
    // W1-04: + as 2 exclusões da recepção (motivo de exclusão e procedência); parte 3: + excluir recepção;
    // parte 4: + excluir painel de chamada e painel de TV.
    // W1-05: + as 7 exclusões das fichas a imprimir (modelo, título e as 4 seleções) e do local de observação.
    expect(p.operacoes.filter((o) => doW002.has(o.nome) && o.estados['pc'] === 'verde')).toHaveLength(61);
    expect(p.operacoes.filter((o) => verdes.includes(o.nome)).map((o) => o.estados['pc'])).toEqual(
      verdes.map(() => 'verde'),
    );
    // W1-01: a troca de senha verde no pc (o plano B do ADR 0012 saiu).
    expect(p.operacoes.find((o) => o.nome === 'acesso.trocarSenha')?.estados['pc']).toBe('verde');
    expect(p.operacoes.every((o) => Object.keys(o.ultimasExecucoes).length === 0)).toBe(true);
  }, 30_000); // M36: lê o catálogo inteiro e os resultados versionados; passa dos 5 s com o portão em paralelo

  it('última execução por operação, com diferenças por tipo; arquivo estranho é ignorado', () => {
    const pasta = join(tmp, 'resultados');
    mkdirSync(join(pasta, '2026-10-18'), { recursive: true });
    mkdirSync(join(pasta, '2026-10-19', 'capturas'), { recursive: true });
    const dif = { tipo: 'classe', elemento: 'X', esperado: 'a', obtido: 'b', aceita: false };
    const aceita = { ...dif, tipo: 'formato', aceita: true };
    writeFileSync(
      join(pasta, '2026-10-18', 'agenda.agendarExame.pc.json'),
      JSON.stringify(
        resultado('agenda.agendarExame', 'pc', '2026-10-18T10:00:00Z', [
          { cenario: 'a', resultado: 'verde', diferencas: [] },
        ]),
      ),
    );
    writeFileSync(
      join(pasta, '2026-10-19', 'agenda.agendarExame.pc.json'),
      JSON.stringify(
        resultado('agenda.agendarExame', 'pc', '2026-10-19T10:00:00Z', [
          { cenario: 'a', resultado: 'diferencas', diferencas: [dif, aceita] },
        ]),
      ),
    );
    writeFileSync(
      join(pasta, '2026-10-19', 'agenda.cancelarExame.pc.json'),
      JSON.stringify(
        resultado('agenda.cancelarExame', 'pc', '2026-10-19T10:00:00Z', [
          { cenario: 'a', resultado: 'sem-executor', diferencas: [] },
        ]),
      ),
    );
    writeFileSync(
      join(pasta, '2026-10-19', 'preco.reajustar.pc.json'),
      JSON.stringify(
        resultado('preco.reajustar', 'pc', '2026-10-19T10:00:00Z', [
          { cenario: 'a', resultado: 'verde', diferencas: [] },
        ]),
      ),
    );
    writeFileSync(
      join(pasta, '2026-10-19', 'agenda.gerarGrade.pc.json'),
      JSON.stringify(
        resultado('agenda.gerarGrade', 'pc', '2026-10-19T10:00:00Z', [
          { cenario: 'a', resultado: 'sem-referencia', diferencas: [] },
        ]),
      ),
    );
    // outro estabelecimento, mais novo: não esconde o do pc
    writeFileSync(
      join(pasta, '2026-10-19', 'agenda.agendarExame.hs.json'),
      JSON.stringify(
        resultado('agenda.agendarExame', 'hs', '2026-10-19T11:00:00Z', [
          { cenario: 'a', resultado: 'verde', diferencas: [] },
        ]),
      ),
    );
    writeFileSync(join(pasta, '2026-10-19', 'estranho.json'), '{"x":1}');
    writeFileSync(join(pasta, '2026-10-19', 'resumo.txt'), 'x');
    const p = fonteArquivosAssinatura({ ...caminhosPadrao(raiz, {}), resultados: pasta }, [
      'pc',
      'hs',
    ]).painel();
    const por = Object.fromEntries(p.operacoes.map((o) => [o.nome, o]));
    expect(por['agenda.agendarExame']?.ultimasExecucoes).toEqual({
      hs: { executadoEm: '2026-10-19T11:00:00Z', resultado: 'verde', diferencasPorTipo: {} },
      pc: {
        executadoEm: '2026-10-19T10:00:00Z',
        resultado: 'diferencas',
        diferencasPorTipo: { classe: 1 },
        // M36: a diferença não aceita lado a lado (a aceita fica fora)
        detalhes: [{ cenario: 'a', tipo: 'classe', elemento: 'X', esperado: 'a', obtido: 'b' }],
      },
    });
    expect(por['agenda.cancelarExame']?.ultimasExecucoes['pc']?.resultado).toBe('sem-executor');
    expect(por['preco.reajustar']?.ultimasExecucoes['pc']?.resultado).toBe('verde');
    expect(por['agenda.gerarGrade']?.ultimasExecucoes['pc']?.resultado).toBe('sem-referencia');
    expect(por['agenda.agendarExame']?.estados).toEqual({ pc: 'verde', hs: 'especificada' });
    expect(caminhosPadrao('/r', { SGH_CATALOGO_OPERACOES: 'x.yaml' }).catalogo).toBe('/r/x.yaml');
  });

  it('sem sessão (fora de dev/ci não há a sintética): 401', async () => {
    app = await criarApp(
      lerConfiguracao({ AMBIENTE: 'homolog' }),
      null,
      { AMBIENTE: 'homolog' },
      { assinaturas: { painel: () => ({ estabelecimentos: [], operacoes: [] }) } },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    expect((await app.inject({ method: 'GET', url: '/api/config/assinaturas' })).statusCode).toBe(401);
  });

  it('sem fonte explícita, a API lê os arquivos do repositório (diretório de trabalho da API)', async () => {
    app = await criarApp(lerConfiguracao({ AMBIENTE: 'dev' }), null, { ...ENV_DEV, ESTABELECIMENTOS: '' });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const r = await app.inject({ method: 'GET', url: '/api/config/assinaturas' });
    expect(r.statusCode).toBe(200);
    expect(esquemaPainelAssinaturas.parse(r.json()).estabelecimentos).toEqual([]);
  }, 30_000); // M36: idem (os arquivos do repositório)
});
