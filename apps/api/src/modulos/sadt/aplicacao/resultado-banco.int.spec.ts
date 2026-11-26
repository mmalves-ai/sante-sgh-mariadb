// Contrato de efeito do ciclo do resultado no MariaDB real (cliente f22_o2; massa SINTÉTICA), F3.5, 05-SADT linha 10:
// digitar grava o resultado e o analito com a faixa vigente congelada (mudar a faixa depois não muda o resultado) e
// marca o crítico; liberar só o digitado e só por profissional habilitado (conselho ativo e CBO do laboratório), que
// fica gravado como quem liberou; o liberado não volta à digitação; retificar exige motivo e mudança, guarda a versão
// anterior inteira em resultado_exame_versao e sobe o número da versão, sem apagar o analito. Tudo com trilha. Linha 25:
// com responsável pelo laudo nomeado no setor, outro profissional habilitado não libera; a nomeação do exame prevalece.
// Avisos na mesma transação: o valor crítico digitado gera o aviso pendente com prazo (sem repetir ao regravar nem ao
// liberar), a correção que tira o crítico cancela o aviso pendente (o registro fica) e o crítico que volta ganha aviso
// novo; a retificação avisa quem já tinha aberto o resultado (aviso clínico com destinatário), menos quem retifica.
// A ponta do destinatário (C1-077): o aviso da retificação chega à central de avisos de quem o recebe
// (PortaAvisosClinicosPropria.listar), com o link para os exames do paciente; quem retificou não o vê; a ciência grava
// no destinatário sem apagar.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAvisosClinicosPropria } from '../../acesso/avisos-clinicos-propria.js';
import { ServicoResultadoSadt } from './resultado-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const COR = { cliente: CLIENTE, correlacao: 't-s35res' };

describe.skipIf(SEM_BANCO)('resultado: digitar, liberar e retificar (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoResultadoSadt;
  let m: MassaSadt | null = null;
  let faixa = 0;
  let inscricao = 0;
  const nomeacoes: number[] = [];
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(COR, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S5R');
    servico = new ServicoResultadoSadt(nucleo);
    const mm = m;
    await nucleo.escrever(COR, async (e) => {
      const ea = await e.uma('SELECT id FROM exame_analito WHERE exame_id = ? AND analito_id = ?', [
        mm.exameLab,
        mm.analito,
      ]);
      faixa = await e.inserir(
        `INSERT INTO faixa_referencia (exame_analito_id, referencia_minima, referencia_maxima, critico_minimo, critico_maximo,
           absurdo_minimo, absurdo_maximo, referencia_texto, vigencia_inicio, criado_em)
         VALUES (?, 10, 20, 5, 30, 0, 100, '10 a 20', '2020-01-01', ?)`,
        [ea!['id'], new Date()],
      );
      await e.executar("UPDATE exame_item SET situacao = 'em_analise' WHERE id = ?", [mm.itemLab]);
    });
  });

  afterAll(async () => {
    if (m)
      await nucleo.escrever(COR, async (e) => {
        const itens = [m!.itemLab];
        await e.executar(
          `DELETE d FROM aviso_clinico_destinatario d JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
             JOIN resultado_exame r ON r.id = a.resultado_exame_id WHERE r.exame_item_id IN (?)`,
          itens,
        );
        await e.executar(
          'DELETE a FROM aviso_clinico a JOIN resultado_exame r ON r.id = a.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE v FROM visualizacao_resultado_exame v JOIN resultado_exame r ON r.id = v.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE a FROM aviso_valor_critico a JOIN resultado_exame r ON r.id = a.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE v FROM resultado_exame_versao v JOIN resultado_exame r ON r.id = v.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE o FROM resultado_observacao o JOIN resultado_exame r ON r.id = o.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        await e.executar(
          'DELETE a FROM resultado_analito a JOIN resultado_exame r ON r.id = a.resultado_exame_id WHERE r.exame_item_id IN (?)',
          itens,
        );
        if (faixa) await e.executar('DELETE FROM faixa_referencia WHERE id = ?', [faixa]);
        if (inscricao) await e.executar('DELETE FROM inscricao_conselho WHERE id = ?', [inscricao]);
        if (nomeacoes.length)
          await e.executar('DELETE FROM responsavel_laudo_setor WHERE id IN (?)', [nomeacoes]);
      });
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('digita com a faixa congelada, libera pelo habilitado e retifica guardando a versão anterior', async () => {
    const c = contexto(m!);
    const item = m!.itemLab;
    const an = m!.analito;
    const tenta = (p: Promise<unknown>) => p.then(() => 'ok').catch(codigoDe);

    expect(await tenta(servico.liberar(c, item, {}))).toBe('nao-digitado');
    expect(await tenta(servico.registrar(c, item, { valores: [{ analito: an + 999_999, numero: 1 }] }))).toBe(
      'analito-fora-do-exame',
    );
    expect(await tenta(servico.registrar(c, item, { valores: [{ analito: an, numero: 500 }] }))).toBe(
      'valor-absurdo',
    );
    expect(
      await tenta(
        servico.registrar(contexto(m!, m!.base.outroEst), item, { valores: [{ analito: an, numero: 4 }] }),
      ),
    ).toBe('exame-inexistente');

    const r = await servico.registrar(c, item, {
      valores: [{ analito: an, numero: 4 }],
      observacao: 'Amostra lipêmica',
    });
    expect(r).toMatchObject({ situacao: 'digitado', critico: true, anormal: true, numeroVersao: 1 });
    const ra = () =>
      um(
        `SELECT COUNT(*) OVER () AS q, id, valor_numerico, faixa_referencia_id, referencia_minimo, referencia_maximo,
                interpretacao, critico, justificativa_alteracao FROM resultado_analito WHERE resultado_exame_id = ?`,
        [r.resultado],
      );
    expect(await ra()).toMatchObject({ interpretacao: 'critico_baixo' });
    expect(Number((await ra())!['faixa_referencia_id'])).toBe(faixa);
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [item])).toMatchObject({
      situacao: 'resultado_digitado',
    });
    expect(
      Number(
        (await um('SELECT COUNT(*) AS q FROM resultado_observacao WHERE resultado_exame_id = ?', [
          r.resultado,
        ]))!['q'],
      ),
    ).toBe(1);

    // O valor crítico avisa já na digitação: um aviso pendente do analito, com prazo depois da geração.
    const avisos = async () =>
      (
        await nucleo.lerSomente(COR, (l) =>
          l.consultar(
            `SELECT situacao, resultado_analito_id, estabelecimento_id, paciente_id, prazo_em > gerado_em AS prazo
               FROM aviso_valor_critico WHERE resultado_exame_id = ? ORDER BY id`,
            [r.resultado],
          ),
        )
      ).map((a): Record<string, unknown> & { situacao: string } => ({
        ...a,
        situacao: String(a['situacao']),
      }));
    const a1 = await avisos();
    expect(a1.map((a) => a.situacao)).toEqual(['pendente']);
    expect(Number(a1[0]!['resultado_analito_id'])).toBe(Number((await ra())!['id']));
    expect(Number(a1[0]!['estabelecimento_id'])).toBe(m!.base.est);
    expect(Number(a1[0]!['prazo'])).toBe(1);
    // Regravar o mesmo crítico não repete; corrigir para dentro da faixa cancela o pendente (o registro fica); o crítico
    // que volta ganha aviso novo.
    await servico.registrar(c, item, { valores: [{ analito: an, numero: 4 }] });
    expect((await avisos()).map((a) => a.situacao)).toEqual(['pendente']);
    expect(await servico.registrar(c, item, { valores: [{ analito: an, numero: 15 }] })).toMatchObject({
      critico: false,
    });
    expect((await avisos()).map((a) => a.situacao)).toEqual(['cancelado']);
    expect(await servico.registrar(c, item, { valores: [{ analito: an, numero: 4 }] })).toMatchObject({
      critico: true,
    });
    expect((await avisos()).map((a) => a.situacao)).toEqual(['cancelado', 'pendente']);

    // A faixa muda depois: o resultado guarda a faixa do momento da digitação.
    await nucleo.escrever(COR, (e) =>
      e.executar('UPDATE faixa_referencia SET referencia_minima = 1 WHERE id = ?', [faixa]),
    );
    expect(Number((await ra())!['referencia_minimo'])).toBe(10);

    // Sem inscrição no conselho com CBO do laboratório, não libera.
    expect(await tenta(servico.liberar(c, item, {}))).toBe('nao-habilitado');
    await nucleo.escrever(COR, async (e) => {
      const cbo = await e.uma(
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo LIKE '2212%' ORDER BY id LIMIT 1",
        [],
      );
      const cc = await e.uma('SELECT id FROM conselho_classe ORDER BY id LIMIT 1', []);
      const uf = await e.uma('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1', []);
      const seq = await e.uma(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM inscricao_conselho WHERE profissional_id = ?',
        [m!.base.profissional],
      );
      inscricao = await e.inserir(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, TRUE, 'ativa', ?)`,
        [
          m!.base.profissional,
          seq!['s'],
          cc!['id'],
          uf!['id'],
          `${m!.marca}9`.slice(0, 20),
          cbo!['id'],
          new Date(),
        ],
      );
    });
    // 05-SADT linha 25: com responsável pelo laudo nomeado no setor, só ele libera; a nomeação do exame prevalece.
    const setor = await um(
      `SELECT COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS s, ei.exame_id AS x FROM exame_item ei
         JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE ei.id = ?`,
      [item],
    );
    const outro = await um(
      'SELECT id FROM profissional WHERE id <> ? AND excluido_em IS NULL ORDER BY id LIMIT 1',
      [m!.base.profissional],
    );
    const nomear = (prof: unknown, exame: unknown) =>
      nucleo.escrever(COR, async (e) => {
        nomeacoes.push(
          await e.inserir(
            `INSERT INTO responsavel_laudo_setor (setor_diagnostico_id, profissional_id, exame_id, libera_resultado,
               responsavel_tecnico, vigencia_inicio, criado_em) VALUES (?, ?, ?, TRUE, FALSE, '2020-01-01', ?)`,
            [setor!['s'], prof, exame, new Date()],
          ),
        );
      });
    await nomear(outro!['id'], null);
    expect(await tenta(servico.liberar(c, item, {}))).toBe('fora-dos-responsaveis-setor');
    await nomear(m!.base.profissional, setor!['x']);
    const lib = await servico.liberar(c, item, {});
    expect(lib).toMatchObject({ situacao: 'liberado', numeroVersao: 1 });
    const re = await um(
      'SELECT liberado_por_profissional_id, liberado_em FROM resultado_exame WHERE id = ?',
      [r.resultado],
    );
    expect(Number(re!['liberado_por_profissional_id'])).toBe(m!.base.profissional);
    expect(re!['liberado_em']).not.toBeNull();
    expect(await um('SELECT situacao FROM exame_item WHERE id = ?', [item])).toMatchObject({
      situacao: 'liberado',
    });

    // A liberação não repete o aviso do crítico já avisado.
    expect((await avisos()).map((a) => a.situacao)).toEqual(['cancelado', 'pendente']);
    // Dois usuários abriram o resultado liberado: o outro e quem vai retificar.
    await nucleo.escrever(COR, async (e) => {
      for (const u of [m!.base.usuario2, m!.base.usuario])
        await e.inserir(
          `INSERT INTO visualizacao_resultado_exame (estabelecimento_id, resultado_exame_id, paciente_id, usuario_id,
             visualizado_em, criado_em) VALUES (?, ?, (SELECT paciente_id FROM resultado_exame WHERE id = ?), ?, ?, ?)`,
          [m!.base.est, r.resultado, r.resultado, u, new Date(Date.now() - 60_000), new Date()],
        );
    });

    // O liberado não volta à digitação; a retificação exige mudança.
    expect(await tenta(servico.registrar(c, item, { valores: [{ analito: an, numero: 15 }] }))).toBe(
      'ja-liberado',
    );
    expect(
      await tenta(
        servico.retificar(c, item, { valores: [{ analito: an, numero: 4 }], motivo: 'Erro de transcrição' }),
      ),
    ).toBe('sem-mudanca');

    const ret = await servico.retificar(c, item, {
      valores: [{ analito: an, numero: 15 }],
      motivo: 'Erro de transcrição do valor',
    });
    expect(ret).toMatchObject({ situacao: 'retificado', numeroVersao: 2, critico: false, anormal: false });
    const v = await um(
      'SELECT COUNT(*) OVER () AS q, numero_versao, operacao, motivo, dados, liberado_em_original FROM resultado_exame_versao WHERE resultado_exame_id = ?',
      [r.resultado],
    );
    expect(v).toMatchObject({
      numero_versao: 1,
      operacao: 'alteracao',
      motivo: 'Erro de transcrição do valor',
    });
    expect(Number(v!['q'])).toBe(1);
    expect(v!['liberado_em_original']).not.toBeNull();
    const dados = typeof v!['dados'] === 'string' ? JSON.parse(v!['dados'] as string) : v!['dados'];
    expect(dados.analitos[0]).toMatchObject({ analito: an, numero: 4, interpretacao: 'critico_baixo' });
    // O valor retificado deixou de ser crítico: o aviso ainda pendente é cancelado, sem apagar.
    expect((await avisos()).map((a) => a.situacao)).toEqual(['cancelado', 'cancelado']);
    // Quem já tinha visto (menos quem retificou) recebe o aviso da retificação, ligado à versão guardada.
    const ac = await nucleo.lerSomente(COR, (l) =>
      l.consultar(
        `SELECT a.id AS aviso_id, a.prioridade, a.situacao, a.entidade_origem, a.entidade_origem_chave, a.paciente_id, a.atendimento_id,
                d.usuario_id, d.situacao AS situacao_destinatario,
                (SELECT id FROM resultado_exame_versao WHERE resultado_exame_id = a.resultado_exame_id) AS versao_guardada
           FROM aviso_clinico a JOIN aviso_clinico_destinatario d ON d.aviso_clinico_id = a.id
          WHERE a.resultado_exame_id = ?`,
        [r.resultado],
      ),
    );
    expect(ac).toHaveLength(1);
    expect(ac[0]).toMatchObject({
      prioridade: 'alta',
      situacao: 'pendente',
      entidade_origem: 'resultado_exame_versao',
      situacao_destinatario: 'pendente',
    });
    expect(Number(ac[0]!['usuario_id'])).toBe(m!.base.usuario2);
    expect(Number(ac[0]!['entidade_origem_chave'])).toBe(Number(ac[0]!['versao_guardada']));
    expect(ac[0]!['atendimento_id']).not.toBeNull();
    const depois = await ra();
    expect(Number(depois!['q'])).toBe(1);
    expect(Number(depois!['valor_numerico'])).toBe(15);
    expect(depois!['justificativa_alteracao']).toBe('Erro de transcrição do valor');
    // A retificação usa a faixa vigente agora (mínimo 1).
    expect(Number(depois!['referencia_minimo'])).toBe(1);

    // O aviso da retificação chega à central de avisos do destinatário, como ele a lê (GET /api/acesso/avisos-clinicos).
    const caixa = new PortaAvisosClinicosPropria(nucleo, CLIENTE);
    const codigoEst = String(
      (await um('SELECT codigo FROM estabelecimento WHERE id = ?', [m!.base.est]))!['codigo'],
    );
    const sessao = (usuario: number) => ({
      cliente: CLIENTE,
      hospital: codigoEst,
      usuario,
      correlacao: 't-s35res',
    });
    const pac = Number(
      (await um('SELECT paciente_id FROM resultado_exame WHERE id = ?', [r.resultado]))!['paciente_id'],
    );
    const doResultado = (cx: Awaited<ReturnType<typeof caixa.listar>>) =>
      cx.avisos.filter((a) => a.aviso === Number(ac[0]!['aviso_id']));
    const doDestinatario = await caixa.listar(sessao(m!.base.usuario2));
    expect(doResultado(doDestinatario)).toHaveLength(1);
    expect(doResultado(doDestinatario)[0]).toMatchObject({
      estado: 'novo',
      gravidade: 'atencao',
      link: `/pep/paciente/${pac}/exames`,
    });
    expect(doDestinatario.novos).toBeGreaterThanOrEqual(1);
    // Quem retificou não recebe o próprio aviso.
    expect(doResultado(await caixa.listar(sessao(m!.base.usuario)))).toHaveLength(0);
    // A ciência do destinatário grava no destinatário (nada apagado) e o aviso segue na caixa como ciente.
    const idDest = doResultado(doDestinatario)[0]!.id;
    expect(await caixa.ciente(sessao(m!.base.usuario2), idDest)).toEqual({ id: idDest, gravou: true });
    expect(
      await um(
        'SELECT situacao, ciente_em IS NOT NULL AS ciente, lido_usuario_id, excluido_em IS NULL AS vivo FROM aviso_clinico_destinatario WHERE id = ?',
        [idDest],
      ),
    ).toMatchObject({ situacao: 'ciente', ciente: 1, vivo: 1 });
    expect(doResultado(await caixa.listar(sessao(m!.base.usuario2)))[0]).toMatchObject({ estado: 'ciente' });
    expect(
      Number(
        (await um(
          "SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'resultado_exame' AND entidade_id = ?",
          [r.resultado],
        ))!['q'],
      ),
    ).toBeGreaterThanOrEqual(3);
  });
});
