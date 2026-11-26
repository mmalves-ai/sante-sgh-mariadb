// Contrato de efeito da busca ativa de resultados (F8, 05-SADT linha 24) no MariaDB real (cliente f22_o2; massa
// SINTÉTICA do SADT, nenhuma pessoa real). O atendimento da massa recebe alta 30 horas atrás (pedidos 34 horas atrás);
// no laboratório, o exame crítico e um alterado são liberados depois da alta e um alterado antes dela; na imagem, um
// alterado depois da alta; numa terceira requisição, um exame coletado sem resultado liberado (pendente na alta, já
// passada a espera de 24 horas) e outro com resultado só em digitação.
// Prova o que fica no banco:
//   - a varredura abre um caso por requisição só com os liberados depois da alta (o de antes fica de fora) e com os
//     pendentes na alta, com o número da sequência do estabelecimento, o motivo mais grave e o prazo pela gravidade;
//   - duas aberturas ao mesmo tempo deixam um caso só por exame (a segunda espera a trava e não abre nada); repetir
//     não duplica;
//   - a tentativa de contato fica no histórico e põe o caso em contato com a versão; a versão velha, o contato feito
//     sem orientação e o "sem contato" antes de 3 tentativas são recusados sem gravar;
//   - concluir grava desfecho, quem e quando, e resolve os exames; o caso encerrado não recebe contato;
//   - cancelar exige o motivo e cancela os exames (nada apagado); outro estabelecimento não vê o caso.
import { garantirSequencia, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './aplicacao/copia.spec-util.js';
import { PortaBuscaAtivaPropria } from './busca-ativa-propria.js';

const falha = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? String(e),
  );

describe.skipIf(SEM_BANCO)('busca ativa de resultados (MariaDB, cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let m: MassaSadt | null = null;
  let porta: PortaBuscaAtivaPropria;
  let hospital = '';
  let requisicaoPendente = 0;
  let itemPendente = 0;
  let itemEmDigitacao = 0;
  let outroHospital = '';
  const ctx = (h = hospital) => ({
    cliente: CLIENTE,
    hospital: h,
    usuario: m!.base.usuario,
    correlacao: 't-bar',
  });
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-bar' }, (l) =>
      l.consultar<Record<string, unknown>>(sql, p),
    );

  beforeAll(async () => {
    m = await montarMassaSadt(nucleo, 'BAR');
    porta = new PortaBuscaAtivaPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-bar' }, async (e) => {
      const agora = Date.now();
      const alta = new Date(agora - 30 * 3_600_000);
      // A entrada vem antes da alta (CHECK do atendimento); os pedidos, entre as duas.
      await e.executar('UPDATE atendimento SET entrada_em = ?, alta_medica_em = ? WHERE id = ?', [
        new Date(agora - 36 * 3_600_000),
        alta,
        m!.base.atendimento,
      ]);
      await e.executar('UPDATE requisicao_exame SET solicitado_em = ? WHERE id IN (?, ?)', [
        new Date(agora - 34 * 3_600_000),
        m!.requisicao,
        m!.requisicaoImagem,
      ]);
      // O resultado crítico da massa foi liberado agora (depois da alta).
      await e.executar('UPDATE resultado_exame SET liberado_em = ? WHERE id = ?', [
        new Date(agora - 60_000),
        m!.resultado,
      ]);
      const resultado = (item: number, setor: number, liberado: Date) =>
        e.inserir(
          `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, forma_entrada, situacao, numero_versao,
             resultado_em, liberado_em, liberado_por_profissional_id, anormal, critico, criado_em, versao)
           VALUES (?, ?, ?, 'digitado', 'liberado', 1, ?, ?, ?, TRUE, FALSE, ?, 1)`,
          [item, m!.base.paciente, setor, liberado, liberado, m!.base.profissional, new Date(agora)],
        );
      await resultado(m!.itemLab, m!.setorLab, new Date(agora - 31 * 3_600_000)); // antes da alta: fica de fora
      await resultado(m!.itemLab2, m!.setorLab, new Date(agora - 30 * 60_000));
      await resultado(m!.itemImagem, m!.setorImagem, new Date(agora - 20 * 60_000));
      // A terceira requisição, copiada da de imagem: os exames ficaram pendentes na alta.
      requisicaoPendente = await e.inserir(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, setor_diagnostico_id,
           solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em, versao)
         SELECT estabelecimento_id, CONCAT(numero, 'P'), paciente_id, atendimento_id, setor_diagnostico_id,
                solicitante_profissional_id, fonte_pagadora_id, solicitado_em, criado_em, 1
           FROM requisicao_exame WHERE id = ?`,
        [m!.requisicaoImagem],
      );
      const pendente = (seq: number, situacao: string) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, material_biologico_id, situacao, criado_em, versao)
           SELECT ?, ?, exame_id, material_biologico_id, ?, criado_em, 1 FROM exame_item WHERE id = ?`,
          [requisicaoPendente, seq, situacao, m!.itemImagem],
        );
      itemPendente = await pendente(1, 'coletado');
      itemEmDigitacao = await pendente(2, 'em_analise');
      await e.inserir(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, forma_entrada, situacao, numero_versao,
           resultado_em, anormal, critico, criado_em, versao)
         VALUES (?, ?, ?, 'digitado', 'em_digitacao', 1, ?, FALSE, FALSE, ?, 1)`,
        [itemEmDigitacao, m!.base.paciente, m!.setorImagem, new Date(agora), new Date(agora)],
      );
      // A sequência já existe (a corrida da primeira criação vira "registro em edição", nunca caso em dobro).
      await garantirSequencia(
        e,
        { tipo: 'busca_ativa', estabelecimento: m!.base.est, prefixo: 'BA' },
        { agora: new Date(agora), usuario: m!.base.usuario },
      );
      const ests = await e.consultar<{ id: number; codigo: string }>(
        'SELECT id, codigo FROM estabelecimento WHERE id IN (?, ?)',
        [m!.base.est, m!.base.outroEst],
      );
      hospital = String(ests.find((x) => Number(x.id) === m!.base.est)!.codigo);
      outroHospital = String(ests.find((x) => Number(x.id) === m!.base.outroEst)!.codigo);
    });
  }, 90_000);

  afterAll(async () => {
    if (m)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-bar' }, async (e) => {
        const casos = 'SELECT id FROM busca_ativa_resultado WHERE estabelecimento_id IN (?, ?)';
        const ests = [m!.base.est, m!.base.outroEst];
        await e.executar(
          `DELETE FROM busca_ativa_contato WHERE busca_ativa_resultado_id IN (${casos})`,
          ests,
        );
        await e.executar(
          `DELETE FROM busca_ativa_resultado_exame WHERE busca_ativa_resultado_id IN (${casos})`,
          ests,
        );
        await e.executar('DELETE FROM busca_ativa_resultado WHERE estabelecimento_id IN (?, ?)', ests);
        await e.executar(
          "DELETE FROM sequencia_negocio WHERE tipo = 'busca_ativa' AND estabelecimento_id IN (?, ?)",
          ests,
        );
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('abre um caso por requisição com o liberado depois da alta e o pendente na alta, sem duplicar', async () => {
    const candidatos = await porta.candidatos(ctx());
    expect(candidatos.map((k) => [k.requisicao, k.motivo, k.itens.length]).sort()).toEqual(
      [
        [m!.requisicao, 'resultado_critico', 2],
        [m!.requisicaoImagem, 'resultado_alterado', 1],
        [requisicaoPendente, 'resultado_pendente', 2],
      ].sort(),
    );
    expect(await porta.candidatos(ctx(outroHospital))).toEqual([]);
    // Duas aberturas ao mesmo tempo: uma abre tudo, a outra espera a trava e não abre nada.
    const juntas = await Promise.all([porta.abrirPendentes(ctx()), porta.abrirPendentes(ctx())]);
    expect(juntas.map((r) => r.abertos).sort()).toEqual([0, 3]);
    expect(juntas.map((r) => r.exames).sort()).toEqual([0, 5]);
    expect(await porta.abrirPendentes(ctx())).toEqual({ abertos: 0, exames: 0 });
    const [dobro] = await ler(
      `SELECT COUNT(*) AS n FROM (SELECT x.exame_item_id FROM busca_ativa_resultado_exame x
          JOIN busca_ativa_resultado b ON b.id = x.busca_ativa_resultado_id
         WHERE b.estabelecimento_id = ? GROUP BY x.exame_item_id HAVING COUNT(*) > 1) d`,
      [m!.base.est],
    );
    expect(Number(dobro!['n'])).toBe(0);
    const casos = await ler(
      `SELECT b.id, b.numero, b.motivo, b.situacao, b.requisicao_exame_id, b.criado_por,
              TIMESTAMPDIFF(HOUR, b.aberto_em, b.prazo_em) AS horas,
              (SELECT GROUP_CONCAT(x.exame_item_id ORDER BY x.sequencia) FROM busca_ativa_resultado_exame x
                WHERE x.busca_ativa_resultado_id = b.id AND x.situacao = 'pendente') AS itens
         FROM busca_ativa_resultado b WHERE b.estabelecimento_id = ? ORDER BY b.id`,
      [m!.base.est],
    );
    expect(casos).toHaveLength(3);
    const lab = casos.find((x) => Number(x['requisicao_exame_id']) === m!.requisicao)!;
    expect(lab).toMatchObject({
      motivo: 'resultado_critico',
      situacao: 'aberto',
      criado_por: m!.base.usuario,
    });
    expect(String(lab['numero'])).toMatch(/^BA\d+$/);
    expect(String(lab['itens']).split(',').map(Number).sort()).toEqual([m!.itemLab2, m!.itemLiberado].sort());
    expect(Number(lab['horas'])).toBeLessThanOrEqual(24);
    const img = casos.find((x) => Number(x['requisicao_exame_id']) === m!.requisicaoImagem)!;
    expect(img).toMatchObject({ motivo: 'resultado_alterado', itens: String(m!.itemImagem) });
    expect(Number(img['horas'])).toBeGreaterThan(24);
    // O pendente: prazo de 72 horas do fim da espera (alta + 24 h), com os dois exames sem resultado liberado.
    const pend = casos.find((x) => Number(x['requisicao_exame_id']) === requisicaoPendente)!;
    expect(pend).toMatchObject({ motivo: 'resultado_pendente', situacao: 'aberto' });
    expect(String(pend['itens']).split(',').map(Number)).toEqual([itemPendente, itemEmDigitacao]);
    expect(Number(pend['horas'])).toBeGreaterThanOrEqual(64);
    expect(Number(pend['horas'])).toBeLessThanOrEqual(66);
    const fila = await porta.fila(ctx(), { situacao: null, paciente: m!.base.paciente });
    expect(fila).toHaveLength(3);
    expect(fila.every((x) => x.tentativas === 0 && !x.atrasado)).toBe(true);
    expect(await porta.fila(ctx(outroHospital), { situacao: null, paciente: null })).toEqual([]);
  });

  it('registra o contato com a versão, recusa o inválido e conclui com o desfecho', async () => {
    const [caso] = (await porta.fila(ctx(), { situacao: null, paciente: null })).filter(
      (x) => x.motivo === 'resultado_critico',
    );
    const agora = new Date().toISOString();
    const contato = (versao: number, p: Record<string, unknown> = {}) =>
      porta.registrarContato(ctx(), caso!.id, {
        versao,
        contatadoEm: agora,
        canal: null,
        resultado: 'sem_resposta',
        orientacao: null,
        novaColetaEm: null,
        ...p,
      });
    expect(await falha(contato(1, { resultado: 'contato_realizado' }))).toBe('regra-violada');
    expect(await falha(contato(1))).toBe('ok');
    expect(await falha(contato(1))).toBe('conflito-versao');
    expect(
      await falha(porta.concluir(ctx(), caso!.id, { versao: 2, desfecho: 'sem_contato', observacao: null })),
    ).toBe('regra-violada');
    expect(
      await falha(
        porta.concluir(ctx(), caso!.id, { versao: 2, desfecho: 'paciente_orientado', observacao: null }),
      ),
    ).toBe('regra-violada');
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      await falha(
        contato(2, {
          resultado: 'contato_realizado',
          orientacao: 'Nova coleta combinada',
          novaColetaEm: amanha,
        }),
      ),
    ).toBe('ok');
    expect(await falha(porta.detalhe(ctx(outroHospital), caso!.id))).toBe('registro-inexistente');
    const d = await porta.detalhe(ctx(), caso!.id);
    expect(d).toMatchObject({ situacao: 'em_contato', versao: 3 });
    expect(d.contatos.map((x) => x.resultado)).toEqual(['contato_realizado', 'sem_resposta']);
    expect(d.contatos[0]!.novaColetaEm).not.toBeNull();
    expect(
      await falha(
        porta.concluir(ctx(), caso!.id, { versao: 3, desfecho: 'paciente_orientado', observacao: null }),
      ),
    ).toBe('ok');
    const [b] = await ler(
      `SELECT situacao, desfecho, concluido_em IS NOT NULL AS concluido, concluido_por_usuario_id, versao,
              (SELECT COUNT(*) FROM busca_ativa_resultado_exame x WHERE x.busca_ativa_resultado_id = b.id AND x.situacao = 'resolvido') AS resolvidos,
              (SELECT COUNT(*) FROM busca_ativa_contato t WHERE t.busca_ativa_resultado_id = b.id AND t.usuario_id = ?) AS contatos
         FROM busca_ativa_resultado b WHERE b.id = ?`,
      [m!.base.usuario, caso!.id],
    );
    expect(b).toMatchObject({
      situacao: 'concluido',
      desfecho: 'paciente_orientado',
      concluido_por_usuario_id: m!.base.usuario,
    });
    expect(Number(b!['concluido'])).toBe(1);
    expect(Number(b!['versao'])).toBe(4);
    expect(Number(b!['resolvidos'])).toBe(2);
    expect(Number(b!['contatos'])).toBe(2);
    expect(await falha(contato(4))).toBe('regra-violada');
  });

  it('cancela só com o motivo e mantém o caso e os exames', async () => {
    const [caso] = (await porta.fila(ctx(), { situacao: null, paciente: null })).filter(
      (x) => x.motivo === 'resultado_alterado',
    );
    expect(await falha(porta.cancelar(ctx(), caso!.id, { versao: caso!.versao, observacao: '' }))).toBe(
      'regra-violada',
    );
    expect(
      await falha(
        porta.cancelar(ctx(), caso!.id, {
          versao: caso!.versao,
          observacao: 'Aberto em duplicidade (teste)',
        }),
      ),
    ).toBe('ok');
    const [b] = await ler(
      `SELECT situacao, observacao, excluido_em,
              (SELECT situacao FROM busca_ativa_resultado_exame x WHERE x.busca_ativa_resultado_id = b.id) AS exame
         FROM busca_ativa_resultado b WHERE b.id = ?`,
      [caso!.id],
    );
    expect(b).toMatchObject({ situacao: 'cancelado', excluido_em: null, exame: 'cancelado' });
    expect((await porta.fila(ctx(), { situacao: null, paciente: null })).map((x) => x.motivo)).toEqual([
      'resultado_pendente',
    ]);
    expect(
      (await porta.fila(ctx(), { situacao: 'todos', paciente: null })).map((x) => x.situacao).sort(),
    ).toEqual(['aberto', 'cancelado', 'concluido']);
  });
});
