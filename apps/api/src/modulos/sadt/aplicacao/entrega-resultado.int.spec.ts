// Contrato de efeito da entrega de resultados (F3.5, 05-SADT linha 21) no MariaDB real (cliente f22_o2; massa
// SINTÉTICA). Prova o que fica no banco: o prazo de entrega por setor e exame (o novo substitui o anterior sem
// apagá-lo) e a previsão no balcão; o protocolo de entrega numerado, com os exames, quem retirou e o fato no histórico
// do exame; a recusa com motivo sem gravar nada; o cancelamento que não apaga; o exame restrito e o perfil do portal
// decidindo o que cada público vê; o que é de outro estabelecimento não é visto nem alterado. Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../../teste/limpar-trilha.spec-util.js';
import { desligarMapaEstabelecimentos, ligarMapaEstabelecimentos } from '../../cadastro/contexto-nucleo.js';
import { PortalController } from '../portal.controller.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import { ServicoEntregaResultado } from './entrega-resultado-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const CPF_SINTETICO = '52998224725';

describe.skipIf(SEM_BANCO)('entrega de resultados e portal (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoEntregaResultado;
  let m: MassaSadt | null = null;
  let liberacao = 0;
  const ctx = { cliente: CLIENTE, correlacao: 't-f35e' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ctx, (l) => l.uma(sql, p));
  const contar = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n'] ?? 0);
  const recusa = async (p: Promise<unknown>) => codigoDe(await p.catch((e: unknown) => e));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'ENT');
    servico = new ServicoEntregaResultado(nucleo);
    // A publicação do resultado liberado no portal (o que o portal lista).
    liberacao = await nucleo.escrever(ctx, (e) =>
      e.inserir(
        `INSERT INTO liberacao_resultado_portal (estabelecimento_id, resultado_exame_id, paciente_id, liberado_em, situacao,
           criado_em, versao) VALUES (?, ?, ?, ?, 'liberado', ?, 1)`,
        [m!.base.est, m!.resultado, m!.base.paciente, new Date(), new Date()],
      ),
    );
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const ests = [m.base.est, m.base.outroEst];
      await nucleo.escrever(ctx, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x(
          `DELETE i FROM entrega_resultado_item i JOIN entrega_resultado er ON er.id = i.entrega_resultado_id
            WHERE er.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await x('DELETE FROM entrega_resultado WHERE estabelecimento_id IN (?, ?)', ests);
        await x(
          `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await x('DELETE FROM liberacao_resultado_portal WHERE estabelecimento_id IN (?, ?)', ests);
        await x('DELETE FROM prazo_entrega_exame WHERE estabelecimento_id IN (?, ?)', ests);
        await x('DELETE FROM exame_restricao_portal WHERE exame_id IN (?, ?)', [m!.exameLab, m!.exameImagem]);
        await x(
          `DELETE s FROM perfil_portal_setor s JOIN perfil_portal_resultado p ON p.id = s.perfil_portal_resultado_id
            WHERE p.estabelecimento_id IN (?, ?)`,
          ests,
        );
        await x('DELETE FROM perfil_portal_resultado WHERE estabelecimento_id IN (?, ?)', ests);
        await x(
          "DELETE FROM sequencia_negocio WHERE tipo = 'entrega_resultado' AND estabelecimento_id IN (?, ?)",
          ests,
        );
        await limparTrilhaDaMassa(e, { ids: ests });
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('prazo por setor e exame: confere na hora, o novo substitui o anterior sem apagar, e o balcão mostra a previsão', async () => {
    const c = contexto(m!);
    expect(await recusa(servico.incluirPrazo(c, { exame: m!.exameLab, prazoDias: 0 }))).toBe(
      'prazo-sem-tempo',
    );
    expect(
      await contar('SELECT COUNT(*) AS n FROM prazo_entrega_exame WHERE estabelecimento_id = ?', [
        m!.base.est,
      ]),
    ).toBe(0);
    // O setor de outro estabelecimento não entra no prazo deste.
    const primeiro = await servico.incluirPrazo(c, { exame: m!.exameLab, setor: m!.setorLab, prazoDias: 3 });
    const segundo = await servico.incluirPrazo(c, {
      exame: m!.exameLab,
      setor: m!.setorLab,
      prazoDias: 1,
      horarioCorte: '23:59',
    });
    expect(
      await um('SELECT ativo, prazo_dias FROM prazo_entrega_exame WHERE id = ?', [primeiro.id]),
    ).toMatchObject({ ativo: 0, prazo_dias: 3 });
    expect(
      await um(
        'SELECT ativo, prazo_dias, setor_diagnostico_id, estabelecimento_id, realiza_domingo FROM prazo_entrega_exame WHERE id = ?',
        [segundo.id],
      ),
    ).toMatchObject({
      ativo: 1,
      prazo_dias: 1,
      setor_diagnostico_id: m!.setorLab,
      estabelecimento_id: m!.base.est,
      realiza_domingo: 1,
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'prazo_entrega_exame' AND entidade_id IN (?, ?)",
        [primeiro.id, segundo.id],
      ),
    ).toBeGreaterThanOrEqual(2);
    const cadastro = await servico.cadastro(c);
    expect(cadastro.prazos.filter((p) => p.ativo)).toHaveLength(1);
    expect(cadastro.prazos).toHaveLength(2);
    expect(cadastro.setores.some((s) => s.id === m!.setorLab)).toBe(true);

    // O balcão acha o paciente pelo número do pedido: o liberado está pronto; o que falta traz a previsão do prazo.
    const b = await servico.balcao(c, `${m!.marca}-R1`);
    expect(b.paciente?.id).toBe(m!.base.paciente);
    expect(b.prontos.map((x) => x.item)).toEqual([m!.itemLiberado]);
    const falta = b.aguardando.find((x) => x.item === m!.itemLab);
    expect(falta?.previsto).not.toBeNull();
    expect(falta?.situacaoPrazo).toBe('no_prazo');
    // Outro estabelecimento não acha o pedido nem vê o prazo.
    const cOutro = contexto(m!, m!.base.outroEst);
    expect((await servico.balcao(cOutro, `${m!.marca}-R1`)).paciente).toBeNull();
    expect((await servico.cadastro(cOutro)).prazos).toHaveLength(0);
    expect(await recusa(servico.desativar(cOutro, 'prazo', segundo.id))).toBe('nao-encontrado');
    // Desativar não apaga.
    await servico.desativar(c, 'prazo', segundo.id);
    expect(await recusa(servico.desativar(c, 'prazo', segundo.id))).toBe('ja-inativo');
    expect(
      await contar('SELECT COUNT(*) AS n FROM prazo_entrega_exame WHERE estabelecimento_id = ?', [
        m!.base.est,
      ]),
    ).toBe(2);
  }, 60_000);

  it('protocolo de entrega: recusa sem gravar, grava o protocolo com quem retirou, não entrega duas vezes e cancela sem apagar', async () => {
    const c = contexto(m!);
    const est = m!.base.est;
    const entregas = () =>
      contar('SELECT COUNT(*) AS n FROM entrega_resultado WHERE estabelecimento_id = ?', [est]);
    const base = { paciente: m!.base.paciente, itens: [m!.itemLiberado] };
    // Só o liberado sai; terceiro precisa de nome e documento; o CPF é conferido.
    expect(await recusa(servico.registrar(c, { ...base, itens: [m!.itemLab] }))).toBe('entrega-nao-liberado');
    expect(await recusa(servico.registrar(c, { ...base, retiradoPeloPaciente: false }))).toBe(
      'entrega-sem-responsavel',
    );
    expect(
      await recusa(
        servico.registrar(c, {
          ...base,
          retiradoPeloPaciente: false,
          nomeResponsavel: 'RESPONSAVEL SINTETICO',
          cpfResponsavel: '529.982.247-24',
        }),
      ),
    ).toBe('entrega-cpf-invalido');
    // O exame de outro paciente (ou de outro estabelecimento) não entra.
    expect(await recusa(servico.registrar(contexto(m!, m!.base.outroEst), base))).toBe(
      'entrega-item-de-outro',
    );
    expect(await entregas()).toBe(0);

    const feita = await servico.registrar(c, {
      ...base,
      retiradoPeloPaciente: false,
      nomeResponsavel: 'RESPONSAVEL SINTETICO',
      cpfResponsavel: '529.982.247-25',
      observacao: 'Entrega sintetica',
    });
    expect(feita.numero).toMatch(/^ER-/);
    expect(
      await um(
        `SELECT numero, paciente_id, situacao, retirado_pelo_paciente, nome_responsavel, cpf_responsavel,
                entregue_por_usuario_id, setor_diagnostico_id FROM entrega_resultado WHERE id = ?`,
        [feita.id],
      ),
    ).toMatchObject({
      numero: feita.numero,
      paciente_id: m!.base.paciente,
      situacao: 'entregue',
      retirado_pelo_paciente: 0,
      nome_responsavel: 'RESPONSAVEL SINTETICO',
      cpf_responsavel: CPF_SINTETICO,
      entregue_por_usuario_id: m!.base.usuario,
      setor_diagnostico_id: m!.setorLab,
    });
    expect(
      await um('SELECT sequencia, exame_item_id FROM entrega_resultado_item WHERE entrega_resultado_id = ?', [
        feita.id,
      ]),
    ).toMatchObject({ sequencia: 1, exame_item_id: m!.itemLiberado });
    // O fato fica no histórico do exame e a situação do exame não muda.
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM item_exame_evento WHERE exame_item_id = ? AND evento = 'entregue'",
        [m!.itemLiberado],
      ),
    ).toBe(1);
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [m!.itemLiberado])).toMatchObject({
      situacao: 'liberado',
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'entrega_resultado' AND entidade_id = ?",
        [feita.id],
      ),
    ).toBeGreaterThanOrEqual(1);
    // A numeração do estabelecimento nasceu na primeira entrega.
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM sequencia_negocio WHERE tipo = 'entrega_resultado' AND estabelecimento_id = ?",
        [est],
      ),
    ).toBe(1);

    // Não entrega duas vezes; o balcão passa a mostrar o protocolo e nada pronto.
    expect(await recusa(servico.registrar(c, base))).toBe('entrega-ja-feita');
    expect(await entregas()).toBe(1);
    const b = await servico.balcao(c, `${m!.marca}-R1`);
    expect(b.prontos).toHaveLength(0);
    expect(b.entregas).toHaveLength(1);
    expect(b.entregas[0]).toMatchObject({
      numero: feita.numero,
      situacao: 'entregue',
      retiradoPeloPaciente: false,
    });
    expect(b.entregas[0]?.exames.map((x) => x.item)).toEqual([m!.itemLiberado]);
    expect((await servico.protocolo(c, feita.id))?.numero).toBe(feita.numero);
    expect(await servico.protocolo(contexto(m!, m!.base.outroEst), feita.id)).toBeNull();

    // Cancelamento: outro estabelecimento não alcança; exige motivo; não apaga; o exame volta a ficar pronto.
    expect(
      await recusa(
        servico.cancelar(contexto(m!, m!.base.outroEst), feita.id, { motivo: 'motivo sintetico' }),
      ),
    ).toBe('nao-encontrado');
    expect(await recusa(servico.cancelar(c, feita.id, { motivo: 'x' }))).toBe('entrega-sem-motivo');
    await servico.cancelar(c, feita.id, { motivo: 'entregue ao paciente errado' });
    const cancelada = await um(
      'SELECT situacao, motivo_cancelamento, cancelado_em, excluido_em FROM entrega_resultado WHERE id = ?',
      [feita.id],
    );
    expect(cancelada).toMatchObject({
      situacao: 'cancelada',
      motivo_cancelamento: 'entregue ao paciente errado',
      excluido_em: null,
    });
    expect(cancelada?.['cancelado_em']).not.toBeNull();
    expect(await recusa(servico.cancelar(c, feita.id, { motivo: 'de novo o motivo' }))).toBe(
      'entrega-ja-cancelada',
    );
    expect(await entregas()).toBe(1);
    expect((await servico.balcao(c, `${m!.marca}-R1`)).prontos.map((x) => x.item)).toEqual([m!.itemLiberado]);
  }, 60_000);

  it('portal: o exame restrito e o perfil decidem o que cada público vê', async () => {
    const c = contexto(m!);
    const est = m!.base.est;
    const ve = async (publico: 'paciente' | 'medico_externo') =>
      (await servico.publicaveisNoPortal(c, publico, [liberacao])).has(liberacao);
    // Sem restrição nem perfil, o publicado segue visível.
    expect(await ve('paciente')).toBe(true);

    // Só depois da entrega no balcão: some, aparece com o protocolo e some de novo com o cancelamento.
    expect(await recusa(servico.incluirRestricao(c, { exame: m!.exameLab, regra: 'apos_dias' }))).toBe(
      'restricao-sem-carencia',
    );
    expect(await recusa(servico.incluirRestricao(c, { exame: m!.exameLab, global: true }))).toBe(
      'sem-permissao-global',
    );
    const restricao = await servico.incluirRestricao(c, {
      exame: m!.exameLab,
      regra: 'apos_entrega_presencial',
    });
    expect(
      await um('SELECT regra, estabelecimento_id, ativo FROM exame_restricao_portal WHERE id = ?', [
        restricao.id,
      ]),
    ).toMatchObject({ regra: 'apos_entrega_presencial', estabelecimento_id: est, ativo: 1 });
    expect(await ve('paciente')).toBe(false);
    const entrega = await servico.registrar(c, { paciente: m!.base.paciente, itens: [m!.itemLiberado] });
    expect(await ve('paciente')).toBe(true);
    await servico.cancelar(c, entrega.id, { motivo: 'cancelamento sintetico' });
    expect(await ve('paciente')).toBe(false);

    // A mesma restrição muda de regra (uma linha por exame e alcance) e vale para todo público sem perfil.
    const mudada = await servico.incluirRestricao(c, {
      exame: m!.exameLab,
      regra: 'nunca_publicar',
      motivo: 'Resultado entregue só em consulta',
    });
    expect(mudada.id).toBe(restricao.id);
    expect(
      await contar('SELECT COUNT(*) AS n FROM exame_restricao_portal WHERE exame_id = ?', [m!.exameLab]),
    ).toBe(1);
    expect(await ve('paciente')).toBe(false);
    expect(await ve('medico_externo')).toBe(false);

    // Perfil do médico que não oculta o restrito: ele vê; o paciente continua sem ver.
    expect(
      await recusa(
        servico.salvarPerfil(c, { codigo: 'x y', descricao: 'Perfil sintetico', publico: 'medico_externo' }),
      ),
    ).toBe('perfil-codigo-invalido');
    const medico = await servico.salvarPerfil(c, {
      codigo: `${m!.marca}-MED`,
      descricao: 'Medico solicitante sintetico',
      publico: 'medico_externo',
      ocultaExameRestrito: false,
    });
    expect(
      await um(
        'SELECT publico, oculta_exame_restrito, estabelecimento_id FROM perfil_portal_resultado WHERE id = ?',
        [medico.id],
      ),
    ).toMatchObject({ publico: 'medico_externo', oculta_exame_restrito: 0, estabelecimento_id: est });
    expect(await ve('medico_externo')).toBe(true);
    expect(await ve('paciente')).toBe(false);
    expect(
      await recusa(
        servico.salvarPerfil(c, {
          codigo: `${m!.marca}-MED`,
          descricao: 'Repetido sintetico',
          publico: 'paciente',
        }),
      ),
    ).toBe('perfil-codigo-repetido');

    // Perfil do paciente por setor: sem a restrição, só vê os setores do perfil; tirar o setor não apaga a linha.
    await servico.desativar(c, 'restricao', restricao.id);
    expect(await um('SELECT ativo FROM exame_restricao_portal WHERE id = ?', [restricao.id])).toMatchObject({
      ativo: 0,
    });
    expect(await ve('paciente')).toBe(true);
    const paciente = await servico.salvarPerfil(c, {
      codigo: `${m!.marca}-PAC`,
      descricao: 'Paciente sintetico',
      publico: 'paciente',
      setores: [m!.setorImagem],
    });
    const setoresVivos = () =>
      contar(
        'SELECT COUNT(*) AS n FROM perfil_portal_setor WHERE perfil_portal_resultado_id = ? AND excluido_em IS NULL',
        [paciente.id],
      );
    expect(await setoresVivos()).toBe(1);
    expect(await ve('paciente')).toBe(false);
    await servico.salvarPerfil(c, {
      id: paciente.id,
      codigo: `${m!.marca}-PAC`,
      descricao: 'Paciente sintetico',
      publico: 'paciente',
      setores: [m!.setorLab],
    });
    expect(await ve('paciente')).toBe(true);
    expect(await setoresVivos()).toBe(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM perfil_portal_setor WHERE perfil_portal_resultado_id = ?', [
        paciente.id,
      ]),
    ).toBe(2);
    // O setor que volta é reativado (sem linha nova); os dias de visibilidade valem a partir da liberação.
    await servico.salvarPerfil(c, {
      id: paciente.id,
      codigo: `${m!.marca}-PAC`,
      descricao: 'Paciente sintetico',
      publico: 'paciente',
      setores: [m!.setorLab, m!.setorImagem],
      diasVisibilidade: 30,
    });
    expect(await setoresVivos()).toBe(2);
    expect(
      await contar('SELECT COUNT(*) AS n FROM perfil_portal_setor WHERE perfil_portal_resultado_id = ?', [
        paciente.id,
      ]),
    ).toBe(2);
    expect(await ve('paciente')).toBe(true);
    const cadastro = await servico.cadastro(c);
    expect(cadastro.perfis.find((p) => p.id === paciente.id)).toMatchObject({
      setores: [m!.setorLab, m!.setorImagem].sort((a, b) => a - b),
      diasVisibilidade: 30,
      ativo: true,
    });
    // Outro estabelecimento não vê nem desativa o perfil; desativar não apaga, e o perfil inativo deixa de filtrar.
    const cOutro = contexto(m!, m!.base.outroEst);
    expect((await servico.cadastro(cOutro)).perfis.some((p) => p.id === paciente.id)).toBe(false);
    expect(await recusa(servico.desativar(cOutro, 'perfil', paciente.id))).toBe('nao-encontrado');
    await servico.desativar(c, 'perfil', paciente.id);
    expect(await um('SELECT ativo FROM perfil_portal_resultado WHERE id = ?', [paciente.id])).toMatchObject({
      ativo: 0,
    });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade IN ('perfil_portal_resultado', 'exame_restricao_portal') AND entidade_id IN (?, ?, ?)",
        [paciente.id, medico.id, restricao.id],
      ),
    ).toBeGreaterThanOrEqual(5);
  }, 60_000);

  it('um perfil ativo por público e alcance: o novo desativa o anterior sem apagar; público sem efeito é recusado', async () => {
    const c = contexto(m!);
    const est = m!.base.est;
    const ve = async () => (await servico.publicaveisNoPortal(c, 'paciente', [liberacao])).has(liberacao);
    const ativos = () =>
      contar(
        "SELECT COUNT(*) AS n FROM perfil_portal_resultado WHERE estabelecimento_id = ? AND publico = 'paciente' AND ativo = TRUE",
        [est],
      );
    // O primeiro perfil do paciente só publica o setor de imagem: o laudo do laboratório some.
    const restrito = await servico.salvarPerfil(c, {
      codigo: `${m!.marca}-P1`,
      descricao: 'Paciente so imagem sintetico',
      publico: 'paciente',
      setores: [m!.setorImagem],
    });
    expect(await ativos()).toBe(1);
    expect(await ve()).toBe(false);
    // O segundo do mesmo público e alcance passa a valer e desativa o primeiro (que fica no banco, com a trilha).
    const aberto = await servico.salvarPerfil(c, {
      codigo: `${m!.marca}-P2`,
      descricao: 'Paciente todos os setores sintetico',
      publico: 'paciente',
    });
    expect(await ativos()).toBe(1);
    expect(await um('SELECT ativo FROM perfil_portal_resultado WHERE id = ?', [restrito.id])).toMatchObject({
      ativo: 0,
    });
    expect(await um('SELECT ativo FROM perfil_portal_resultado WHERE id = ?', [aberto.id])).toMatchObject({
      ativo: 1,
    });
    expect(await ve()).toBe(true);
    let cadastro = await servico.cadastro(c);
    expect(cadastro.perfis.find((p) => p.id === aberto.id)).toMatchObject({ ativo: true, aplicado: true });
    expect(cadastro.perfis.find((p) => p.id === restrito.id)).toMatchObject({
      ativo: false,
      aplicado: false,
    });
    // O perfil de outro público não é tocado.
    const medico = await servico.salvarPerfil(c, {
      codigo: `${m!.marca}-M1`,
      descricao: 'Medico sintetico',
      publico: 'medico_externo',
    });
    expect(await ativos()).toBe(1);
    expect(await um('SELECT ativo FROM perfil_portal_resultado WHERE id = ?', [medico.id])).toMatchObject({
      ativo: 1,
    });
    // Salvar de novo o primeiro o reativa e desativa o que estava valendo: nunca dois ativos.
    await servico.salvarPerfil(c, {
      id: restrito.id,
      codigo: `${m!.marca}-P1`,
      descricao: 'Paciente so imagem sintetico',
      publico: 'paciente',
      setores: [m!.setorImagem],
    });
    expect(await ativos()).toBe(1);
    expect(await um('SELECT ativo FROM perfil_portal_resultado WHERE id = ?', [aberto.id])).toMatchObject({
      ativo: 0,
    });
    expect(await ve()).toBe(false);
    // Dois ativos gravados por fora (carga de outro sistema): o portal aplica o mais novo e o cadastro diz qual.
    await nucleo.escrever(ctx, (e) =>
      e.executar('UPDATE perfil_portal_resultado SET ativo = TRUE WHERE id = ?', [aberto.id]),
    );
    expect(await ativos()).toBe(2);
    expect(await ve()).toBe(true);
    cadastro = await servico.cadastro(c);
    expect(cadastro.perfis.find((p) => p.id === aberto.id)).toMatchObject({ ativo: true, aplicado: true });
    expect(cadastro.perfis.find((p) => p.id === restrito.id)).toMatchObject({ ativo: true, aplicado: false });
    // Público que o portal ainda não aplica: recusado sem gravar nada.
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM perfil_portal_resultado WHERE estabelecimento_id = ?',
      [est],
    );
    for (const publico of ['empresa', 'interno'])
      expect(
        await recusa(
          servico.salvarPerfil(c, { codigo: `${m!.marca}-X`, descricao: 'Sem efeito sintetico', publico }),
        ),
      ).toBe('perfil-publico-sem-efeito');
    expect(
      await contar('SELECT COUNT(*) AS n FROM perfil_portal_resultado WHERE estabelecimento_id = ?', [est]),
    ).toBe(antes);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'perfil_portal_resultado' AND entidade_id IN (?, ?)",
        [restrito.id, aberto.id],
      ),
    ).toBeGreaterThanOrEqual(3);
    for (const p of [restrito.id, aberto.id, medico.id])
      await servico.desativar(c, 'perfil', p).catch(() => undefined);
  }, 60_000);

  it('o portal (controller) só lista e só abre o que o filtro deixa, com ou sem o mapa de estabelecimentos lido', async () => {
    const c = contexto(m!);
    const codigo = String(
      (await um('SELECT codigo FROM estabelecimento WHERE id = ?', [m!.base.est]))?.['codigo'] ?? '',
    );
    expect(codigo).not.toBe('');
    let abertos = 0;
    const sessao = { hospital: codigo, perfil: 'paciente' as const };
    const portal = {
      sessao: () => sessao,
      laudos: async () => ({ laudos: [{ liberacao }] }),
      abrir: async () => ({ aberto: ++abertos }),
    };
    const controller = (entrega: ServicoEntregaResultado | null, hospital = codigo) => {
      sessao.hospital = hospital;
      return new PortalController(
        { ambiente: 'dev', clientePadrao: CLIENTE } as never,
        portal as never,
        entrega,
      );
    };
    const req = { headers: {} };
    const lista = async (k: PortalController) => (await k.laudos(req)).laudos.length;
    const abre = (k: PortalController) =>
      k.abrir(String(liberacao), {}, req).then(
        () => 200,
        (e: unknown) => (e instanceof ErroProblema ? e.getStatus() : -1),
      );

    for (const comMapa of [false, true]) {
      desligarMapaEstabelecimentos();
      if (comMapa) await ligarMapaEstabelecimentos(CLIENTE, nucleo);
      // Sem restrição ativa: lista e abre.
      expect(await lista(controller(servico))).toBe(1);
      expect(await abre(controller(servico))).toBe(200);
      const restricao = await servico.incluirRestricao(c, { exame: m!.exameLab, regra: 'nunca_publicar' });
      // Com o exame que nunca é publicado: some da lista e o endereço direto responde 404, sem abrir.
      const antes = abertos;
      expect(await lista(controller(servico))).toBe(0);
      expect(await abre(controller(servico))).toBe(404);
      expect(abertos).toBe(antes);
      // Estabelecimento que não se resolve: nada é publicado (falha fechada).
      expect(await lista(controller(servico, 'zzinexist'))).toBe(0);
      expect(await abre(controller(servico, 'zzinexist'))).toBe(404);
      expect(abertos).toBe(antes);
      await servico.desativar(c, 'restricao', restricao.id);
    }
    desligarMapaEstabelecimentos();
    // Só o destino que não é o banco do cliente (serviço nulo pelo módulo) dispensa o filtro.
    expect(await lista(controller(null))).toBe(1);
  }, 60_000);
});
