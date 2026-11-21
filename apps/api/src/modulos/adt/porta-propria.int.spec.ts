// Integração da porta própria da internação (M21) contra o MariaDB real, cliente f22_o3 (onda 3), massa SINTÉTICA
// (massa-adt.spec-util.ts). Contrato de efeito de cada gravação: as linhas (internacao, ocupacao_leito, alta_hospitalar,
// solicitacao_limpeza, periodo_situacao_leito, alta_medica, inspecao_limpeza), a `versao`, a situação atual do leito, a
// trilha (entidade real) e a mensagem de saída; as recusas (versão velha, leito ocupado, leito em higienização,
// paciente já internado, outro estabelecimento) e a idempotência da gravação direta. SGH_NUCLEO_SEM_BANCO=1 pula.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_ADT,
  contextoAdt,
  encerrarMassaAdt,
  lerAdt,
  type MassaAdt,
  operacaoAdt,
  prepararMassaAdt,
  SEM_BANCO_ADT,
  trilhaAdt,
} from './massa-adt.spec-util.js';
import { carimboVersao } from './operacoes.js';
import { PortaAdtPropria } from './porta-propria.js';

const codigoDe = (e: unknown) =>
  (e as { codigo?: string; problema?: { codigo?: string } }).problema?.codigo ?? (e as { codigo?: string }).codigo;

describe.skipIf(SEM_BANCO_ADT)(`porta própria da internação (MariaDB, cliente ${CLIENTE_ADT})`, () => {
  let m: MassaAdt | null = null;
  let porta: PortaAdtPropria;
  const M = () => m!;
  const leito = (l: string) => ({ bloco: 'B1', acomodacao: 'Q1', leito: l });
  const conta = async (sql: string, p: unknown[]) => Number((await lerAdt<{ n: number }>(M(), sql, p))?.n ?? 0);
  const trilhas = (tabela: string, id: number) => conta('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?', [tabela, id]);
  const saidas = (ponto: string) => conta('SELECT COUNT(*) AS n FROM integracao_mensagem WHERE estabelecimento_id = ? AND ponto = ?', [M().est, ponto]);
  const baseDoLeito = async (l: string) =>
    (
      await lerAdt<{ base: string }>(
        M(),
        `SELECT s.situacao_base AS base FROM leito_hospitalar lh JOIN situacao_leito s ON s.id = lh.situacao_leito_id
          JOIN acomodacao ac ON ac.id = lh.acomodacao_id WHERE lh.estabelecimento_id = ? AND ac.codigo = 'Q1' AND lh.codigo = ?`,
        [M().est, l],
      )
    )?.base;
  const executar = (op: string, entrada: unknown, est = M().est) =>
    porta.executar(contextoAdt(M(), est), op, entrada, { ...operacaoAdt(M(), est), reautenticadoEm: Date.now() }).then((r) => r.resultado as Record<string, unknown>);
  const internar = (paciente: number, l: string, extra: Record<string, unknown> = {}, est = M().est) =>
    executar(
      'internacao.internar',
      {
      paciente,
      leito: leito(l),
      convenio: M().convenio,
      acomodacaoPlano: 'ENFERMARIA',
      carater: 'urgencia',
      clinica: 'M',
      especialidade: M().especialidade,
      medicoAssistente: M().medico,
      medicoSolicitante: M().medico,
      cidPrincipal: M().cid,
      procedimento: M().procedimento,
      procedimentoOrigem: 'sigtap',
      centroCusto: 1,
      unidade: 1,
      origem: 'ambulatorio',
      caraterAdmissao: M().carater,
      caraterTiss: M().caraterTiss,
      categoriaAtendimento: M().categoria,
      modalidade: M().modalidade,
      ...extra,
      },
      est,
    );
  const versaoDe = async (id: number) => carimboVersao((await lerAdt<{ versao: number }>(M(), 'SELECT versao FROM internacao WHERE id = ?', [id]))?.versao);

  beforeAll(async () => {
    m = await prepararMassaAdt('A');
    porta = new PortaAdtPropria(M().nucleo);
  }, 60_000);
  afterAll(() => encerrarMassaAdt(m));

  it('internar: atendimento, internação, ocupação aberta, leito ocupado, trilha e saída; recusas', async () => {
    const r = await internar(M().pacientes[0]!, '01');
    const id = Number(r['internacao']);
    const i = await lerAdt(M(), 'SELECT situacao, versao, leito_hospitalar_id, modalidade_internacao_id, carater_admissao_id, procedimento_solicitado_procedimento_sigtap_id AS proc FROM internacao WHERE id = ?', [id]);
    expect(i).toMatchObject({ situacao: 'ativa', versao: 1, modalidade_internacao_id: M().modalidade, carater_admissao_id: M().carater, proc: M().procedimento });
    expect(await conta("SELECT COUNT(*) AS n FROM ocupacao_leito WHERE internacao_id = ? AND situacao = 'ativa' AND data_hora_fim IS NULL", [id])).toBe(1);
    expect(await baseDoLeito('01')).toBe('ocupado');
    expect(await trilhas('internacao', id)).toBe(1);
    expect(await saidas('internacao.internada')).toBeGreaterThanOrEqual(1);
    // Leito ocupado, paciente já internado e outro estabelecimento.
    await expect(internar(M().pacientes[1]!, '01')).rejects.toSatisfy((e) => codigoDe(e) === 'leito-ocupado');
    await expect(internar(M().pacientes[0]!, '02')).rejects.toSatisfy((e) => codigoDe(e) === 'paciente-internado');
    // O leito 02 só existe no estabelecimento da sessão: pelo outro, não é encontrado.
    await expect(internar(M().pacientes[2]!, '02', {}, M().outro)).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
  });

  it('transferir: trecho anterior encerrado, novo aberto, transferência gravada, os dois leitos situados; versão velha recusa', async () => {
    const id = Number((await lerAdt<{ id: number }>(M(), "SELECT id FROM internacao WHERE paciente_id = ? AND situacao = 'ativa'", [M().pacientes[0]]))?.id);
    const velha = await versaoDe(id);
    const r = await executar('internacao.transferirLeito', { internacao: id, destino: leito('02'), versao: velha, motivoTroca: M().motivoTroca });
    expect(r['versao']).toBe(carimboVersao(2));
    expect(await conta('SELECT COUNT(*) AS n FROM transferencia_leito WHERE internacao_id = ?', [id])).toBe(1);
    expect(await conta("SELECT COUNT(*) AS n FROM ocupacao_leito WHERE internacao_id = ? AND situacao = 'encerrada'", [id])).toBe(1);
    expect(await baseDoLeito('01')).toBe('livre');
    expect(await baseDoLeito('02')).toBe('ocupado');
    await expect(executar('internacao.transferirLeito', { internacao: id, destino: leito('03'), versao: velha, motivoTroca: M().motivoTroca })).rejects.toSatisfy(
      (e) => codigoDe(e) === 'conflito-versao',
    );
  });

  it('alta médica e o cancelamento (gravação direta): alta_medica, internação em alta médica, motivo do cadastro, trilha', async () => {
    const id = Number((await lerAdt<{ id: number }>(M(), "SELECT id FROM internacao WHERE paciente_id = ? AND situacao = 'ativa'", [M().pacientes[0]]))?.id);
    const c = contextoAdt(M());
    const am = await porta.gravarSgh(c, (x: number) => trilhaAdt(M(), 'alta_medica', x), (g) =>
      g.registrarAltaMedica({ reg: id, pront: 0, vinculo: M().medico, motivo: M().motivoSaida, destino: 'domicilio' as never, sumarioAlta: null, previsaoSaida: null, observacao: null, usuario: M().login }),
    );
    expect(await lerAdt(M(), 'SELECT situacao FROM internacao WHERE id = ?', [id])).toMatchObject({ situacao: 'alta_medica' });
    expect(await trilhas('alta_medica', am)).toBe(1);
    // Repetição da mesma requisição (mesma chave): não grava outra alta médica.
    const repetida = { ...contextoAdt(M()), idempotencia: `int-0301-am-${am}` };
    const cancelar = () =>
      porta.gravarSgh(repetida, (x: number) => trilhaAdt(M(), 'alta_medica', x), (g) =>
        g.cancelarAltaMedica({ reg: id, motivo: 'Decisão revista pela equipe', motivoCodigo: M().motivoCancelamentoAlta, usuario: M().login }),
      );
    expect(await cancelar()).toBe(am);
    expect(await cancelar()).toBe(am);
    expect(await lerAdt(M(), 'SELECT situacao, motivo_cancelamento_alta_id AS motivo FROM alta_medica WHERE id = ?', [am])).toMatchObject({
      situacao: 'cancelada',
      motivo: M().motivoCancelamentoAlta,
    });
    expect(await lerAdt(M(), 'SELECT situacao FROM internacao WHERE id = ?', [id])).toMatchObject({ situacao: 'ativa' });
    // Outro estabelecimento: a internação não existe lá.
    await expect(
      porta.gravarSgh(contextoAdt(M(), M().outro), trilhaAdt(M(), 'alta_medica'), (g) =>
        g.cancelarAltaMedica({ reg: id, motivo: 'Outro estabelecimento', motivoCodigo: M().motivoCancelamentoAlta, usuario: M().login }),
      ),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
  });

  it('dar alta: alta hospitalar, ocupação encerrada, limpeza terminal pedida e leito em higienização; nova internação recusada', async () => {
    const id = Number((await lerAdt<{ id: number }>(M(), "SELECT id FROM internacao WHERE paciente_id = ? AND situacao = 'ativa'", [M().pacientes[0]]))?.id);
    const r = await executar('internacao.darAlta', { internacao: id, motivo: M().motivoSaida, medicoAlta: M().medico, versao: await versaoDe(id) });
    const sol = Number(r['solicitacao']);
    expect(sol).toBeGreaterThan(0);
    expect(await lerAdt(M(), 'SELECT situacao FROM internacao WHERE id = ?', [id])).toMatchObject({ situacao: 'alta' });
    expect(await lerAdt(M(), 'SELECT motivo_geracao, atendimento_id IS NOT NULL AS com_atendimento, alta_hospitalar_id IS NOT NULL AS com_alta FROM solicitacao_limpeza WHERE id = ?', [sol])).toMatchObject({
      motivo_geracao: 'alta',
      com_atendimento: 1,
      com_alta: 1,
    });
    expect(await conta('SELECT COUNT(*) AS n FROM periodo_situacao_leito WHERE solicitacao_limpeza_id = ? AND data_hora_fim IS NULL', [sol])).toBe(1);
    expect(await baseDoLeito('02')).toBe('higienizacao');
    expect(await saidas('hotelaria.limpeza_solicitada')).toBeGreaterThanOrEqual(1);
    await expect(internar(M().pacientes[1]!, '02')).rejects.toSatisfy((e) => codigoDe(e) === 'leito-bloqueado');
  });

  it('cancelar a alta: ocupação reaberta, limpeza da alta cancelada e período encerrado; alta de novo', async () => {
    const id = Number((await lerAdt<{ id: number }>(M(), "SELECT id FROM internacao WHERE paciente_id = ? AND situacao = 'alta'", [M().pacientes[0]]))?.id);
    await executar('internacao.cancelarAlta', { internacao: id, justificativa: 'Alta dada no paciente errado', motivoCancelamento: M().motivoCancelamentoAlta });
    expect(await lerAdt(M(), 'SELECT situacao FROM internacao WHERE id = ?', [id])).toMatchObject({ situacao: 'ativa' });
    expect(await conta('SELECT COUNT(*) AS n FROM cancelamento_alta WHERE internacao_id = ? AND motivo_cancelamento_alta_id = ?', [id, M().motivoCancelamentoAlta])).toBe(1);
    expect(await conta("SELECT COUNT(*) AS n FROM solicitacao_limpeza s JOIN alta_hospitalar a ON a.id = s.alta_hospitalar_id WHERE a.internacao_id = ? AND s.cancelada_em IS NOT NULL", [id])).toBe(1);
    expect(await baseDoLeito('02')).toBe('ocupado');
    await executar('internacao.darAlta', { internacao: id, motivo: M().motivoSaida, medicoAlta: M().medico, versao: await versaoDe(id) });
    expect(await baseDoLeito('02')).toBe('higienizacao');
  });

  it('higienização: etapas, inspeção e liberação pelo mesmo caminho; nova internação no leito liberado', async () => {
    const sol = Number(
      (await lerAdt<{ id: number }>(M(), "SELECT s.id FROM solicitacao_limpeza s JOIN solicitacao_limpeza_local l ON l.solicitacao_limpeza_id = s.id JOIN leito_hospitalar lh ON lh.id = l.leito_hospitalar_id WHERE s.estabelecimento_id = ? AND lh.codigo = '02' AND s.concluida_em IS NULL AND s.cancelada_em IS NULL", [M().est]))?.id,
    );
    const c = contextoAdt(M());
    const etapa = (e: string) =>
      porta.gravarSgh(c, (x: number) => trilhaAdt(M(), e === 'inspecionado' ? 'inspecao_limpeza' : 'solicitacao_limpeza', x), (g) =>
        g.gravarEtapaLimpeza({ solicitacao: sol, leitoEspelho: null, leito: leito('02'), etapa: e as never, checklist: ['piso'], usuario: M().login }),
      );
    await etapa('emExecucao');
    await etapa('concluido');
    const insp = await etapa('inspecionado');
    expect(await conta("SELECT COUNT(*) AS n FROM inspecao_limpeza WHERE id = ? AND resultado = 'aprovada'", [insp])).toBe(1);
    expect(await trilhas('inspecao_limpeza', insp)).toBe(1);
    await etapa('liberado');
    expect(await lerAdt(M(), 'SELECT concluida_em IS NOT NULL AS liberada FROM solicitacao_limpeza WHERE id = ?', [sol])).toMatchObject({ liberada: 1 });
    expect(await conta('SELECT COUNT(*) AS n FROM periodo_situacao_leito WHERE solicitacao_limpeza_id = ? AND data_hora_fim IS NULL', [sol])).toBe(0);
    expect(await baseDoLeito('02')).toBe('livre');
    await expect(etapa('liberado')).rejects.toSatisfy((e) => codigoDe(e) === 'limpeza-encerrada');
    const nova = Number((await internar(M().pacientes[1]!, '02'))['internacao']);
    expect(nova).toBeGreaterThan(0);
  });

  it('solicitar limpeza e liberar leito (operações): período aberto no leito vazio e encerrado na liberação; outro estabelecimento', async () => {
    const r = await executar('hotelaria.solicitarLimpeza', { leito: leito('03'), tipoLimpeza: M().tipoLimpeza });
    const sol = Number(r['solicitacao']);
    expect(await baseDoLeito('03')).toBe('higienizacao');
    await expect(executar('hotelaria.liberarLeito', { solicitacao: sol }, M().outro)).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
    await executar('hotelaria.liberarLeito', { solicitacao: sol });
    expect(await baseDoLeito('03')).toBe('livre');
    expect(await trilhas('solicitacao_limpeza', sol)).toBe(2);
    expect(await saidas('hotelaria.leito_liberado')).toBeGreaterThanOrEqual(1);
  });

  it('estado do leito: bloqueio com o motivo do cadastro, situação do leito e encerramento; versão vista velha recusa', async () => {
    const c = contextoAdt(M());
    const p = await porta.gravarSgh(c, (x: number) => trilhaAdt(M(), 'periodo_situacao_leito', x), (g) =>
      g.abrirEstadoLeito({ leito: leito('03'), estado: 'bloqueio', motivo: 'manutencao', usuario: M().login }),
    );
    expect(await lerAdt(M(), 'SELECT motivo_bloqueio_leito_id IS NOT NULL AS com_motivo FROM periodo_situacao_leito WHERE id = ?', [p])).toMatchObject({ com_motivo: 1 });
    expect(await baseDoLeito('03')).toBe('bloqueado');
    await expect(internar(M().pacientes[2]!, '03')).rejects.toSatisfy((e) => codigoDe(e) === 'leito-bloqueado');
    await expect(
      porta.gravarSgh(c, trilhaAdt(M(), 'periodo_situacao_leito'), (g) => g.encerrarEstadoLeito({ leito: leito('03'), estado: 'bloqueio', versao: 99, usuario: M().login })),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'conflito-versao');
    await porta.gravarSgh(c, trilhaAdt(M(), 'periodo_situacao_leito', p), (g) => g.encerrarEstadoLeito({ leito: leito('03'), estado: 'bloqueio', versao: 1, usuario: M().login }));
    expect(await baseDoLeito('03')).toBe('livre');
    expect(await trilhas('periodo_situacao_leito', p)).toBe(2);
  });

  it('excluir a internação: retrato com o motivo, ocupação cancelada e leito livre', async () => {
    const id = Number((await lerAdt<{ id: number }>(M(), "SELECT id FROM internacao WHERE paciente_id = ? AND situacao = 'ativa'", [M().pacientes[1]]))?.id);
    await expect(
      executar('internacao.excluirInternacao', { internacao: id, motivo: M().motivoExclusao, justificativa: 'Internação aberta por engano', confirmaApagarConta: true, confirmaApagarPeriodos: true }, M().outro),
    ).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
    await executar('internacao.excluirInternacao', { internacao: id, motivo: M().motivoExclusao, justificativa: 'Internação aberta por engano', confirmaApagarConta: true, confirmaApagarPeriodos: true });
    expect(await lerAdt(M(), 'SELECT situacao FROM internacao WHERE id = ?', [id])).toMatchObject({ situacao: 'cancelada' });
    expect(await conta('SELECT COUNT(*) AS n FROM cancelamento_internacao WHERE internacao_id = ? AND motivo_cancelamento_internacao_id = ?', [id, M().motivoExclusao])).toBe(1);
    expect(await baseDoLeito('02')).toBe('livre');
  });

  it('atributo por tipo de acomodação: inclui, altera com motivo, limpa; tipo inexistente recusa', async () => {
    const c = contextoAdt(M());
    const cat = Number((await lerAdt<{ id: number }>(M(), "SELECT ac.categoria_acomodacao_id AS id FROM acomodacao ac WHERE ac.estabelecimento_id = ? AND ac.codigo = 'Q1'", [M().est]))?.id);
    const gravar = (extra: Record<string, unknown>) =>
      porta.gravarSgh(c, trilhaAdt(M(), 'atributo_categoria_acomodacao'), (g) =>
        g.gravarAtributo({ escopo: 'tipo', chave: String(cat), usuario: M().login, ...extra } as never),
      );
    await gravar({ sexo: 'F', criticidade: 3, idadeMinima: 0, idadeMaxima: 12, intensiva: false });
    const linha = () =>
      lerAdt<Record<string, unknown>>(M(), 'SELECT sexo_permitido, criticidade, idade_maxima_dias, versao FROM atributo_categoria_acomodacao WHERE estabelecimento_id = ? AND categoria_acomodacao_id = ?', [M().est, cat]);
    expect(await linha()).toMatchObject({ sexo_permitido: 'feminino', criticidade: 'alta', idade_maxima_dias: 12 * 365, versao: 1 });
    await expect(gravar({ sexo: 'M' })).rejects.toSatisfy((e) => codigoDe(e) === 'motivo-obrigatorio');
    await gravar({ sexo: 'M', motivo: 'Ala masculina' });
    expect(await linha()).toMatchObject({ sexo_permitido: 'masculino', criticidade: 'alta', versao: 2 });
    await porta.gravarSgh(c, trilhaAdt(M(), 'atributo_categoria_acomodacao'), (g) =>
      g.limparAtributos({ escopo: 'tipo', chave: String(cat), justificativa: 'Volta ao padrão', usuario: M().login }),
    );
    expect(await linha()).toMatchObject({ sexo_permitido: null, criticidade: null, idade_maxima_dias: null, versao: 3 });
    await expect(gravar({ chave: '999999999', sexo: 'F' })).rejects.toSatisfy((e) => codigoDe(e) === 'tipo-acomodacao-inexistente');
  });

  it('registro do arquivo de prontuários sem movimento: ocorrência gravada; motivo, aval do descarte e outra conta recusam', async () => {
    const c = contextoAdt(M());
    const atend = Number((await lerAdt<{ id: number }>(M(), 'SELECT atendimento_id AS id FROM internacao WHERE estabelecimento_id = ? ORDER BY id LIMIT 1', [M().est]))?.id);
    const registrar = (x: Record<string, unknown>) =>
      porta.gravarSgh(c, (id: number) => trilhaAdt(M(), 'ocorrencia_arquivo_prontuario', id), (g) =>
        g.gravarSameExt({ movimento: null, conta: atend, usuario: M().login, ...x } as never),
      );
    const id = await registrar({ tipo: 'ocorrencia', motivo: 'Volume com folhas soltas' });
    expect(await lerAdt(M(), 'SELECT tipo, atendimento_id, usuario_id IS NOT NULL AS com_usuario FROM ocorrencia_arquivo_prontuario WHERE id = ?', [id])).toMatchObject({
      tipo: 'ocorrencia',
      atendimento_id: atend,
      com_usuario: 1,
    });
    expect(await trilhas('ocorrencia_arquivo_prontuario', id)).toBe(1);
    await expect(registrar({ tipo: 'ocorrencia' })).rejects.toSatisfy((e) => codigoDe(e) === 'motivo-obrigatorio');
    await expect(registrar({ tipo: 'descarte', motivo: 'Prazo de guarda vencido' })).rejects.toSatisfy((e) => codigoDe(e) === 'aval-obrigatorio');
    await expect(registrar({ tipo: 'cobranca', movimento: 999999999 })).rejects.toSatisfy((e) => codigoDe(e) === 'movimento-inexistente');
    await expect(registrar({ tipo: 'cobranca', conta: 999999999 })).rejects.toSatisfy((e) => codigoDe(e) === 'registro-inexistente');
  });

  it('arquivo de prontuários: a localização e a cobrança leem aceite, cobrança, remessa e ocorrências; movimento de outra conta recusa', async () => {
    const c = contextoAdt(M());
    const paciente = M().pacientes[0];
    const atend = Number(
      (await lerAdt<{ id: number }>(M(), 'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND paciente_id = ? AND excluido_em IS NULL ORDER BY id LIMIT 1', [M().est, paciente]))?.id,
    );
    // Volume e movimentos sintéticos: o volume saiu do arquivo há 30 dias para o setor da massa e não voltou; outro
    // atendimento do mesmo paciente tem o seu próprio movimento.
    const [mov, movOutra] = await M().nucleo.escrever({ cliente: CLIENTE_ADT, correlacao: 'int-0301-same-massa' }, async (e) => {
      const agora = new Date();
      const outraConta = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id,
           profissional_id, entrada_em, criado_em)
         SELECT estabelecimento_id, CONCAT('S', id), paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id,
           profissional_id, entrada_em, criado_em FROM atendimento WHERE id = ?`,
        [atend],
      );
      const doc =
        Number((await e.uma<{ id: number }>("SELECT id FROM tipo_documento_arquivo WHERE codigo = 'T0301'", []))?.id) ||
        (await e.inserir("INSERT INTO tipo_documento_arquivo (codigo, descricao, criado_em) VALUES ('T0301', 'PRONTUARIO SINTETICO', ?)", [agora]));
      const op =
        Number((await e.uma<{ id: number }>("SELECT id FROM operacao_movimento_prontuario WHERE codigo = '2'", []))?.id) ||
        (await e.inserir("INSERT INTO operacao_movimento_prontuario (codigo, descricao, tipo, sentido, criado_em) VALUES ('2', 'SAIDA', 'saida', 'saida', ?)", [agora]));
      const vol = await e.inserir(
        'INSERT INTO volume_prontuario (estabelecimento_id, paciente_id, tipo_documento_arquivo_id, numero_volume, aberto_em, abertura_usuario_id, criado_em) VALUES (?, ?, ?, 1, ?, ?, ?)',
        [M().est, paciente, doc, agora, M().usuario, agora],
      );
      const movimento = (conta: number | null, dias: number) =>
        e.inserir(
          `INSERT INTO movimento_prontuario (estabelecimento_id, volume_prontuario_id, paciente_id, atendimento_id, operacao_movimento_prontuario_id,
             movimentado_em, movimentado_por_usuario_id, destino_setor_funcional_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [M().est, vol, paciente, conta, op, new Date(agora.getTime() - dias * 86_400_000), M().usuario, M().setor, agora],
        );
      const anterior = await movimento(outraConta, 40);
      return [await movimento(atend, 30), anterior];
    });
    const registrar = (x: Record<string, unknown>) =>
      porta.gravarSgh(c, (id: number) => trilhaAdt(M(), 'ocorrencia_arquivo_prontuario', id), (g) =>
        g.gravarSameExt({ conta: atend, usuario: M().login, ...x } as never),
      );
    const o = { setorSame: 999999999, prazoDias: 10 };
    let l = await porta.localizacao(c, atend, o);
    expect(l?.linhaDoTempo.find((m) => m.id === mov)).toMatchObject({ excluido: false, aceito: false, cobrada: false, protocolo: null });
    expect(l?.devolucaoAtrasada).toBe(true);
    expect((await porta.devolucoesAtrasadas(c, o)).itens.find((i) => i.movimento === mov)).toMatchObject({ conta: atend, cobrada: false });

    await registrar({ tipo: 'remessa', movimento: mov, protocolo: 'P-0301', prazoDevolucao: '2099-12-31' });
    await registrar({ tipo: 'aceite', movimento: mov });
    await registrar({ tipo: 'ocorrencia', movimento: null, motivo: 'Recebido sem a folha de rosto' });
    l = await porta.localizacao(c, atend, o);
    expect(l?.linhaDoTempo.find((m) => m.id === mov)).toMatchObject({ aceito: true, cobrada: false, protocolo: 'P-0301', prazoDevolucao: '2099-12-31' });
    expect(l?.ocorrencias?.[0]).toMatchObject({ motivo: 'Recebido sem a folha de rosto', por: M().login });
    // O prazo da remessa ainda não venceu: o volume sai da lista de cobrança.
    expect(l?.devolucaoAtrasada).toBe(false);
    expect((await porta.devolucoesAtrasadas(c, o)).itens.some((i) => i.movimento === mov)).toBe(false);

    await registrar({ tipo: 'remessa', movimento: mov, protocolo: 'P-0302', prazoDevolucao: '2000-01-31' });
    await registrar({ tipo: 'cobranca', movimento: mov });
    l = await porta.localizacao(c, atend, o);
    expect(l?.linhaDoTempo.find((m) => m.id === mov)).toMatchObject({ cobrada: true, protocolo: 'P-0302' });
    expect((await porta.devolucoesAtrasadas(c, o)).itens.find((i) => i.movimento === mov)).toMatchObject({ cobrada: true, prazo: '2000-01-31' });

    expect(l?.linhaDoTempo.some((m) => m.id === movOutra)).toBe(false);
    await expect(registrar({ tipo: 'cobranca', movimento: movOutra })).rejects.toSatisfy((e) => codigoDe(e) === 'movimento-inexistente');
    await registrar({ tipo: 'exclusao', movimento: mov, motivo: 'Lançado no volume errado' });
    l = await porta.localizacao(c, atend, o);
    expect(l?.linhaDoTempo.find((m) => m.id === mov)).toMatchObject({ excluido: true, motivoExclusao: 'Lançado no volume errado' });
    expect(l?.local).toBeNull();
  });
});
