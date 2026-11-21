// Integração da porta própria da agência transfusional (etapa 1) contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA
// L0205 (nenhuma pessoa real). Contrato de efeito de cada gravação: as linhas, a versão, a trilha e a idempotência; e as
// recusas (requisição em aberto, conferente igual, bolsa fora do estoque, bolsa já usada, sinais repetidos, outro
// estabelecimento, notificação repetida, cancelamento repetido, alteração sem modelo). SGH_NUCLEO_SEM_BANCO=1 pula.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import {
  CLIENTE,
  contextoDe,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaTransfusaoPropria } from './transfusao-porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const recusada = async (p: Promise<unknown>) => codigoDe(await p.then(() => null, (e: unknown) => e));
const SINAIS = { pas: 120, pad: 80, fc: 80, temperatura: 36.5 };

describe.skipIf(SEM_BANCO)('porta própria da agência transfusional (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTransfusaoPropria;
  let m: MassaEnfermagem | null = null;
  let requisicao = 0;
  let requisicao2 = 0;
  let ato = 0;
  const chave = `l0205-req-${Date.now()}`;
  const agora = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 16);

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-l0205' }, async (l) =>
      Number((await l.uma<{ n: number }>(sql, p))?.n ?? 0),
    );
  const linha = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-l0205' }, (l) => l.uma(sql, p));
  const executar = (sql: string, p: unknown[]) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't-l0205' }, (e) => e.executar(sql, p));
  /** A linha da trilha que a tela monta (pelo resultado ou pronta), como o apoio da gravação. */
  const linhaTela = (evento: string, entidade: string, id: number): TrilhaDaGravacao => ({
    estabelecimento: m!.est,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: id,
    dadosDepois: { evento, recurso: 'teste', paciente: m!.paciente, estacao: 'L0205' },
    correlacao: 't-l0205',
  });
  const trilhaDoEvento = (tabela: string, id: number, evento: string) =>
    contar(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?
          AND JSON_VALUE(dados_depois, '$.dados.evento') = ? AND JSON_VALUE(dados_depois, '$.dados.paciente') = ?`,
      [tabela, id, evento, m!.paciente],
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await montarMassa(nucleo, 'L0205T');
    porta = new PortaTransfusaoPropria(nucleo);
  }, 60_000);

  afterAll(async () => {
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  const c = () => contextoDe(m!);
  const g = () => porta.gravarSgh(c(), null, async (x) => x);
  const novaRequisicao = (
    item: number,
    k: string | null,
    trilha: ((x: { id: number }) => TrilhaDaGravacao) | null = null,
  ) =>
    porta.gravarSgh(c(), trilha, (x) =>
      x.requisitar({
        item,
        prescricao: m!.prescricao,
        atendimento: m!.atendimento,
        paciente: m!.paciente,
        hemocomponente: 'CH',
        quantidadeBolsas: 1,
        volumeMl: 280,
        urgencia: 2,
        programadaPara: null,
        prazo: null,
        indicacao: 'Hemoglobina 6,9 g/dL sintética',
        examesDeApoio: null,
        termo: null,
        justificativaUrgencia: 'Sem termo no teste sintético',
        transfusaoAnterior: 'nao',
        reacaoAnterior: 'naoSabe',
        gestacaoAnterior: 'naoSeAplica',
        usuario: m!.login,
        chave: k,
      }),
    );

  it('lê os itens de hemoterapia da prescrição vigente, a tipagem e a pessoa', async () => {
    const r = await porta.itensAAtender(c(), { agora: agora() });
    expect(r.itens.map((i) => i.item).sort()).toEqual([...m!.itens].sort());
    expect(r.itens[0]).toMatchObject({ hemocomponente: { codigo: 'CH', classe: 'hemacias' }, atendimento: m!.atendimento });
    expect(await porta.tipagem(c(), m!.paciente)).toEqual({ abo: 'O', rh: 'positivo' });
    expect((await porta.pessoa(c(), m!.paciente)).sexo).toBe('F');
    expect((await porta.horarios(c(), m!.itens[0])).map((h) => h.situacao)).toEqual(['P']);
    // Outro estabelecimento: nada.
    expect((await porta.itensAAtender(contextoDe(m!, m!.outroEst), { agora: agora() })).itens).toEqual([]);
  });

  it('requisita: linhas, versão, trilha e idempotência; a repetição devolve a mesma; a segunda em aberto é recusada', async () => {
    const r = await novaRequisicao(m!.itens[0], chave, (x) => linhaTela('L0205_REQUISITADA', 'SGH_SADT_HEMO_REQ', x.id));
    expect(r.repetida).toBe(false);
    requisicao = r.id;
    // A linha da tela montada pelo resultado chega à trilha da operação: o evento e o paciente.
    expect(await trilhaDoEvento('requisicao_transfusao', r.id, 'L0205_REQUISITADA')).toBe(1);
    const q = await linha('SELECT situacao, versao, numero FROM requisicao_transfusao WHERE id = ?', [r.id]);
    expect(q).toMatchObject({ situacao: 'requisitada', versao: 1 });
    expect(String(q?.['numero'])).toMatch(/^L0205T-\d+$/);
    expect(await contar('SELECT COUNT(*) AS n FROM requisicao_transfusao_item WHERE requisicao_transfusao_id = ?', [r.id])).toBe(1);
    expect(
      await contar("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'requisicao_transfusao' AND entidade_id = ?", [r.id]),
    ).toBeGreaterThanOrEqual(1);
    expect(await novaRequisicao(m!.itens[0], chave)).toEqual({ id: r.id, repetida: true });
    expect(await porta.gravadoPorChave(c(), { tipo: 'requisicao', chave, usuario: m!.login })).toBe(r.id);
    expect(await recusada(novaRequisicao(m!.itens[0], null))).toBe('requisicao-em-aberto');
    const lida = await porta.requisicao(c(), r.id, agora());
    expect(lida).toMatchObject({ estado: 'requisitada', urgencia: 'rotina', item: m!.itens[0], reacaoAnterior: 'naoSabe' });
    expect(lida?.prazo).not.toBeNull();
    expect(await porta.requisicao(contextoDe(m!, m!.outroEst), r.id, agora())).toBeNull();
    // Já requisitado: o item sai da lista a atender.
    expect((await porta.itensAAtender(c(), { agora: agora() })).itens.map((i) => i.item)).toEqual([m!.itens[1]]);
  });

  it('amostra: a etiqueta, a requisição passa a amostra coletada (versão 2)', async () => {
    const a = await g().then((x) =>
      x.amostra({
        requisicao,
        pulseiraLida: true,
        motivoSemPulseira: null,
        coletadaEm: agora(),
        validaAte: new Date(Date.now() + 70 * 3_600_000).toISOString().slice(0, 16),
        usuario: m!.login,
        estacao: null,
        chave: null,
      }),
    );
    expect(a.codigo).toMatch(/^HT\d{10}$/);
    expect(await linha('SELECT situacao, versao FROM requisicao_transfusao WHERE id = ?', [requisicao])).toMatchObject({
      situacao: 'amostra_coletada',
      versao: 2,
    });
    expect((await porta.requisicao(c(), requisicao, agora()))?.amostra?.codigo).toBe(a.codigo);
  });

  it('inicia: dupla checagem com outro profissional e bolsa do estoque; recusas', async () => {
    const inicio = (conferente: string, numero: string, k: string | null) =>
      g().then((x) =>
        x.iniciar({
          requisicao,
          horario: m!.horario,
          bolsa: { numero, hemocomponente: 'CH', abo: 4, rh: 1, validade: agora(), volumeMl: 280 },
          inicioEm: agora(),
          pulseiraLida: true,
          motivoSemPulseira: null,
          profissional: m!.login,
          conferente,
          alertas: [],
          justificativaRh: null,
          sinaisAntes: SINAIS,
          sinaisAntesEm: agora(),
          chave: k,
        }),
      );
    expect(await recusada(inicio(m!.login, m!.bolsas[0], null))).toBe('segundo-profissional-igual');
    expect(await recusada(inicio(m!.login2, 'L0205T-NAOEXISTE', null))).toBe('bolsa-nao-recebida');
    // A bolsa reservada (prova cruzada) para outra requisição não é transfundida; a vencida no estoque também não.
    requisicao2 = (await novaRequisicao(m!.itens[1], null)).id;
    const b2 = 'UPDATE bolsa_hemocomponente SET situacao = ?, reservada_requisicao_transfusao_id = ?, validade_em = ? WHERE numero = ? AND estabelecimento_id = ?';
    const futuro = new Date(Date.now() + 20 * 86_400_000);
    await executar(b2, ['reservada', requisicao2, futuro, m!.bolsas[1], m!.est]);
    expect(await recusada(inicio(m!.login2, m!.bolsas[1], null))).toBe('bolsa-reservada-outra-requisicao');
    await executar(b2, ['liberada', null, new Date(Date.now() - 86_400_000), m!.bolsas[1], m!.est]);
    expect(await recusada(inicio(m!.login2, m!.bolsas[1], null))).toBe('bolsa-vencida');
    await executar(b2, ['liberada', null, futuro, m!.bolsas[1], m!.est]);
    // O bloqueio da dupla checagem (regra 11): sem escrita, a linha vai à trilha numa operação só de trilha.
    await porta.gravarSgh(c(), linhaTela('L0205_BLOQUEADA', 'SGH_SADT_HEMO_REQ', requisicao), async () => ({ ok: false }));
    expect(await trilhaDoEvento('requisicao_transfusao', requisicao, 'L0205_BLOQUEADA')).toBe(1);
    const k = `l0205-ato-${Date.now()}`;
    const r = await inicio(m!.login2, m!.bolsas[0], k);
    ato = r.id;
    expect(await linha('SELECT situacao, executor_profissional_id, conferente_profissional_id, etiqueta_receptor_conferida, inspecao_visual_aprovada FROM ato_transfusional WHERE id = ?', [ato])).toMatchObject({
      situacao: 'em_andamento',
      executor_profissional_id: m!.profissional,
      conferente_profissional_id: m!.profissional2,
      // Atestados não colhidos pela tela ficam falsos (o padrão do banco), nunca afirmados pela porta.
      etiqueta_receptor_conferida: 0,
      inspecao_visual_aprovada: 0,
    });
    // O horário pendente do hemocomponente foi checado (administrado) na mesma operação, com o evento do horário.
    expect(await linha('SELECT sc.categoria, h.administrado_por_profissional_id FROM horario_administracao h JOIN situacao_checagem sc ON sc.id = h.situacao_checagem_id WHERE h.id = ?', [m!.horario])).toMatchObject({
      categoria: 'administrado',
      administrado_por_profissional_id: m!.profissional,
    });
    expect(await contar("SELECT COUNT(*) AS n FROM horario_administracao_evento WHERE horario_administracao_id = ? AND evento = 'checagem'", [m!.horario])).toBe(1);
    expect((await porta.horarios(c(), m!.itens[0])).map((h) => h.situacao)).toEqual(['A']);
    expect(await contar("SELECT COUNT(*) AS n FROM monitoramento_transfusao WHERE ato_transfusional_id = ? AND momento = 'antes'", [ato])).toBe(1);
    expect((await linha('SELECT situacao FROM requisicao_transfusao WHERE id = ?', [requisicao]))?.['situacao']).toBe('em_atendimento');
    expect(await porta.bolsaUsada(c(), m!.bolsas[0])).toBe(true);
    expect(await porta.gravadoPorChave(c(), { tipo: 'ato', chave: k, usuario: m!.login })).toBe(ato);
    expect(await recusada(inicio(m!.login2, m!.bolsas[1], null))).toBe('ato-em-curso');
  });

  it('sinais durante (uma vez), conclusão: requisição atendida e bolsa transfundida', async () => {
    const sinais = () =>
      g().then((x) =>
        x.sinais({ ato, momento: 'durante', sinais: SINAIS, medidoEm: agora(), foraJanela: false, usuario: m!.login, chave: null }),
      );
    await sinais();
    expect(await recusada(sinais())).toBe('sinais-ja-registrados');
    const janela = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 16);
    const kc = `l0205-concluir-${Date.now()}`;
    const concluir = () =>
      g().then((x) =>
        x.concluir({ ato, terminoEm: agora(), volumeTransfundidoMl: 280, interrompida: false, motivoInterrupcao: null, usuario: m!.login, janelaBalanco: janela, chave: kc }),
      );
    const r = await concluir();
    expect(r.estadoRequisicao).toBe('atendida');
    // O volume transfundido entra como ganho no balanço hídrico da janela, na mesma transação.
    expect(r.ganho).not.toBeNull();
    expect(Number((await linha('SELECT volume_ml FROM balanco_lancamento WHERE id = ?', [r.ganho]))?.['volume_ml'])).toBe(280);
    // O reenvio com a mesma chave é reconhecido (não volta como "ato encerrado" nem lança outro ganho).
    expect((await concluir()).id).toBe(ato);
    expect(await contar("SELECT COUNT(*) AS n FROM balanco_lancamento l JOIN balanco_hidrico_paciente b ON b.id = l.balanco_hidrico_paciente_id WHERE b.atendimento_id = ? AND l.sentido = 'ganho'", [m!.atendimento])).toBe(1);
    expect((await linha('SELECT situacao FROM bolsa_hemocomponente WHERE numero = ? AND estabelecimento_id = ?', [m!.bolsas[0], m!.est]))?.['situacao']).toBe('transfundida');
    const [lido] = await porta.atos(c(), { requisicao });
    expect(lido).toMatchObject({ estado: 'concluido', profissional: m!.login, segundoProfissional: m!.login2 });
    expect(lido?.sinais.map((s) => s.momento)).toEqual(['antes', 'durante']);
  });

  it('reação e notificação: uma vez; outro estabelecimento não acha', async () => {
    const r = await g().then((x) =>
      x.reacao({
        ato,
        tipo: 'febrilNaoHemolitica',
        descricaoOutra: null,
        grau: 1,
        correlacao: 'provavel',
        inicioEm: agora(),
        sinaisESintomas: 'Febre sintética',
        condutas: ['comunicarMedico'],
        condutaOutra: null,
        destinoBolsa: 'naoSeAplica',
        prioridade: 'rotina',
        usuario: m!.login,
        chave: null,
        sinais: null,
        interromper: null,
      }),
    );
    expect(r.interrompeu).toBe(false);
    const [lida] = await porta.reacoes(c(), { reacao: r.id });
    expect(lida).toMatchObject({ tipo: 'febrilNaoHemolitica', destinoBolsa: 'naoSeAplica', condutas: ['comunicarMedico'], requisicao });
    const notificar = (cx = c()) =>
      porta.gravarSgh(cx, null, (x) => x.notificada({ reacao: r.id, enviadaEm: agora() }));
    expect(await recusada(notificar(contextoDe(m!, m!.outroEst)))).toBe('nao-encontrada');
    await notificar();
    expect(await recusada(notificar())).toBe('ja-notificada');
    expect((await porta.reacoes(c(), { reacao: r.id }))[0]?.notificacao.enviadaEm).not.toBeNull();
  });

  it('a reação que interrompe o ato devolve a bolsa: estoque com o destino da reação, não transfundida', async () => {
    const a = await g().then((x) =>
      x.iniciar({
        requisicao: requisicao2,
        horario: null,
        bolsa: { numero: m!.bolsas[1], hemocomponente: 'CH', abo: 4, rh: 1, validade: agora(), volumeMl: 280 },
        inicioEm: agora(),
        pulseiraLida: true,
        motivoSemPulseira: null,
        profissional: m!.login,
        conferente: m!.login2,
        alertas: [],
        justificativaRh: null,
        sinaisAntes: SINAIS,
        sinaisAntesEm: agora(),
        chave: null,
        etiquetaReceptorConferida: true,
        inspecaoVisualAprovada: true,
      }),
    );
    expect(await linha('SELECT etiqueta_receptor_conferida, inspecao_visual_aprovada FROM ato_transfusional WHERE id = ?', [a.id])).toMatchObject({
      etiqueta_receptor_conferida: 1,
      inspecao_visual_aprovada: 1,
    });
    const r = await g().then((x) =>
      x.reacao({
        ato: a.id,
        tipo: 'febrilNaoHemolitica',
        descricaoOutra: null,
        grau: 2,
        correlacao: 'provavel',
        inicioEm: agora(),
        sinaisESintomas: 'Calafrios sintéticos',
        condutas: ['comunicarMedico'],
        condutaOutra: null,
        destinoBolsa: 'devolvida',
        prioridade: 'imediata',
        usuario: m!.login,
        chave: null,
        sinais: null,
        interromper: { terminoEm: agora(), volumeTransfundidoMl: 40, motivoInterrupcao: 'Reação febril', janelaBalanco: null },
      }),
    );
    expect(r.interrompeu).toBe(true);
    expect(await linha('SELECT situacao FROM ato_transfusional WHERE id = ?', [a.id])).toMatchObject({ situacao: 'interrompido' });
    const b = await linha('SELECT situacao, destino_em FROM bolsa_hemocomponente WHERE numero = ? AND estabelecimento_id = ?', [m!.bolsas[1], m!.est]);
    expect(b?.['situacao']).toBe('devolvida');
    expect(b?.['destino_em']).not.toBeNull();
  });

  it('cancela a segunda requisição uma vez; a alteração aguarda o modelo (409)', async () => {
    const r = await novaRequisicao(m!.itens[1], null);
    const kx = `l0205-cancelar-${Date.now()}`;
    const cancelarComChave = () =>
      g().then((x) => x.cancelar({ requisicao: r.id, motivo: 'Pedido em duplicidade sintético', usuario: m!.login, chave: kx }));
    const cancelar = () => g().then((x) => x.cancelar({ requisicao: r.id, motivo: 'Pedido em duplicidade sintético', usuario: m!.login }));
    await cancelarComChave();
    // O reenvio com a mesma chave é reconhecido (sem erro); outro pedido é recusado pela situação.
    expect((await cancelarComChave()).id).toBe(r.id);
    expect(await linha('SELECT situacao, versao, observacao_cancelamento FROM requisicao_transfusao WHERE id = ?', [r.id])).toMatchObject({
      situacao: 'cancelada',
      versao: 2,
    });
    expect(await recusada(cancelar())).toBe('ja-cancelada');
    expect((await porta.requisicoes(c(), { agora: agora(), estado: 'cancelada' })).itens.map((x) => x.id)).toContain(r.id);
    expect(await recusada(g().then((x) => x.alterar({ requisicao: r.id } as never)))).toBe('modelo-pendente');
  });
});
