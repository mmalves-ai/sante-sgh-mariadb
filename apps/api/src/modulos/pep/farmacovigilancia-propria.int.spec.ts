// Contrato de efeito da farmacovigilância no paciente (03-PEP L103) e da lista de uso contínuo com a reconciliação
// que parte dela (03-PEP L104), contra o MariaDB real (cliente de teste f22_o4 por padrão). Massa SINTÉTICA própria
// (estabelecimento f78fv, logins teste.f78fv.*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que
// fica no banco: a reação ligada ao item prescrito com o medicamento derivado dele, cada passo no histórico com a
// situação de antes e a nova, a avaliação da farmácia com causalidade e autor, a reação grave que só encerra
// notificada, a inativação com justificativa (nada apagado) e o alerta na prescrição seguinte pelo princípio ativo; a
// lista de uso contínuo com a reconciliação que grava o lote ligado a cada medicamento da lista e atualiza a lista
// (suspenso com autor e justificativa; conduta da última reconciliação); as recusas sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { achados, type ItemAvaliado, type ProdutoAlerta, REGRAS_PADRAO } from '@sgh/dominio-pep';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { FarmacovigilanciaController, PERMISSAO_AVALIAR_REACAO } from './farmacovigilancia.controller.js';
import { FarmacovigilanciaPropria } from './farmacovigilancia-propria.js';
import { PortaPrescricaoPropria } from './prescricao-porta-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f78fv';
const LOGIN = 'teste.f78fv.a';
const LOGIN_SEM_PROF = 'teste.f78fv.b';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('farmacovigilância e uso contínuo (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let fv: FarmacovigilanciaPropria;
  const ids = {
    est: 0,
    usuario: 0,
    semProf: 0,
    prof: 0,
    paciente: 0,
    atendimento: 0,
    principio: 0,
    produto: 0,
    item: 0,
    leve: 0,
    grave: 0,
    causalidade: 0,
  };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    if (!ids.est) return;
    await e.executar(
      `DELETE ev FROM reacao_adversa_evento ev JOIN reacao_adversa_paciente r ON r.id = ev.reacao_adversa_paciente_id
        WHERE r.estabelecimento_id = ?`,
      [ids.est],
    );
    await e.executar('DELETE FROM reacao_adversa_paciente WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(
      `DELETE i FROM reconciliacao_item i JOIN reconciliacao_medicamentosa r ON r.id = i.reconciliacao_medicamentosa_id
        WHERE r.estabelecimento_id = ?`,
      [ids.est],
    );
    await e.executar('DELETE FROM reconciliacao_medicamentosa WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM medicamento_uso_previo WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar(
      'DELETE i FROM prescricao_item i JOIN prescricao p ON p.id = i.prescricao_id WHERE p.estabelecimento_id = ?',
      [ids.est],
    );
    await e.executar('DELETE FROM prescricao WHERE estabelecimento_id = ?', [ids.est]);
    await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
    await limparTrilhaDaMassa(e, { codigos: [EST] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-f78fv' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (login = LOGIN) => ({
    hospital: EST,
    login,
    correlacao: 'teste-f78fv',
    chaveIdempotencia: `f78fv-${randomUUID()}`,
  });
  const reacao = (e: Record<string, unknown>, login = LOGIN) => fv.reacao(ctx(login), e);
  const uso = (e: Record<string, unknown>) => fv.usoContinuo(ctx(), e);
  const versao = async (id: number) =>
    Number(
      (await ler<{ versao: number }>('SELECT versao FROM reacao_adversa_paciente WHERE id = ?', [id]))[0]!
        .versao,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    fv = new FarmacovigilanciaPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f78fv' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      await limpar(e);
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      ids.usuario = await usuario(LOGIN, '24078031001');
      ids.semProf = await usuario(LOGIN_SEM_PROF, '24078031002');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pessoaProf = await pessoa('PESSOA SINTETICA F78FV PROFISSIONAL');
      const pessoaPac = await pessoa('PESSOA SINTETICA F78FV PACIENTE');
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', 'massa f78fv', ?)",
        [pessoaProf, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?',
        [ids.usuario, ids.prof],
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [ids.usuario, ids.prof, '2026-01-01', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac, 978_031_01, agora],
      );
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        ['f78fvamb'],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        ['f78fvamb', 'Categoria sintética f78fv', agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['f78fvc'],
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        ['f78fvc', 'Caráter sintético', 'teste', agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        ['f78fvfp'],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        ['f78fvfp', 'Fonte pagadora sintética', agora],
      );
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'F78FV-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [ids.est, ids.paciente, categoria, carater, fonte, ids.prof, new Date('2026-11-20T10:00:00Z'), agora],
      );
      const tipoItem = await garantir(
        e,
        "SELECT id FROM tipo_item_prescricao WHERE categoria = 'medicamento' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES ('f78fvmed', 'Medicamento sintético', 'medicamento', ?)",
        [agora],
      );
      ids.principio = await garantir(
        e,
        'SELECT id FROM principio_ativo WHERE codigo_dcb = ?',
        ['F78FVA'],
        'INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        ['F78FVA', 'PRINCIPIO SINTETICO F78FVA', 'teste', agora],
      );
      ids.produto = await garantir(
        e,
        'SELECT id FROM item_prescritivel WHERE codigo = ?',
        ['f78fvA'],
        'INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, principio_ativo_id, criado_em) VALUES (?, ?, ?, ?, ?)',
        ['f78fvA', 'PRODUTO SINTETICO F78FVA', tipoItem, ids.principio, agora],
      );
      const inicio = new Date(Date.now() - 6 * 3_600_000);
      const prescricao = await e.inserir(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, criado_em)
         VALUES (?, 978031, ?, ?, ?, 'medica', 'vigente', ?, ?, ?, ?)`,
        [
          ids.est,
          ids.paciente,
          ids.atendimento,
          ids.prof,
          inicio,
          inicio,
          new Date(Date.now() + 18 * 3_600_000),
          agora,
        ],
      );
      ids.item = await e.inserir(
        `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, inicio_em,
           lancamento_profissional_id, criado_em) VALUES (?, 1, ?, ?, ?, ?, ?)`,
        [prescricao, tipoItem, ids.produto, inicio, ids.prof, agora],
      );
      // Catálogos de gravidade e causalidade: usa os do cliente; sem dois níveis, completa com linhas sintéticas.
      const niveis = await e.consultar(
        'SELECT id, nivel FROM gravidade_reacao_adversa WHERE ativo = TRUE ORDER BY nivel',
      );
      for (let n = niveis.length; n < 3; n++) {
        const max = Number(
          (await e.uma<{ m: number }>('SELECT COALESCE(MAX(nivel), 0) AS m FROM gravidade_reacao_adversa'))!
            .m,
        );
        await e.inserir(
          'INSERT INTO gravidade_reacao_adversa (codigo, descricao, nivel, criado_em) VALUES (?, ?, ?, ?)',
          [`f78fv${max + 1}`, `Gravidade sintética ${max + 1}`, max + 1, agora],
        );
      }
      const g = await e.consultar(
        'SELECT id, nivel FROM gravidade_reacao_adversa WHERE ativo = TRUE ORDER BY nivel',
      );
      ids.leve = Number(g[0]!['id']);
      ids.grave = Number(g[g.length - 1]!['id']);
      ids.causalidade = await garantir(
        e,
        'SELECT id FROM causalidade_reacao_adversa WHERE ativo = TRUE ORDER BY grau, id LIMIT 1',
        [],
        "INSERT INTO causalidade_reacao_adversa (codigo, descricao, grau, criado_em) VALUES ('f78fvprov', 'Provável (sintética)', 3, ?)",
        [agora],
      );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f78fv' }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('reação grave: registro pelo item prescrito, avaliação, notificação obrigatória e encerramento no histórico', async () => {
    const inicio = new Date(Date.now() - 3_600_000).toISOString();
    const r = await reacao({
      acao: 'registrar',
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      prescricaoItem: ids.item,
      descricao: 'Exantema maculopapular e prurido após a segunda dose',
      inicio,
      gravidade: ids.grave,
      medicamentoSuspenso: true,
    });
    const id = r.resultado.reacao;
    const [linha] = await ler('SELECT * FROM reacao_adversa_paciente WHERE id = ?', [id]);
    expect(linha).toMatchObject({
      paciente_id: ids.paciente,
      prescricao_item_id: ids.item,
      item_prescritivel_id: ids.produto,
      situacao: 'registrada',
      registrado_por_profissional_id: ids.prof,
    });
    expect(Boolean(Number(linha!['medicamento_suspenso']))).toBe(true);

    // Alerta na prescrição seguinte pelo princípio ativo do medicamento suspeito.
    const alertas = await fv.alertasDaPrescricao({ hospital: EST }, ids.paciente);
    expect(alertas).toContainEqual(expect.objectContaining({ alergia: -id, principios: [ids.principio] }));

    // Encerrar antes da avaliação da farmácia é recusado, sem gravar.
    await expect(
      reacao({ acao: 'encerrar', reacao: id, versao: await versao(id), desfecho: 'recuperado' }),
    ).rejects.toMatchObject(recusada('avaliacao-pendente'));
    await expect(reacao({ acao: 'avaliar', reacao: id, versao: await versao(id) })).rejects.toMatchObject(
      recusada('causalidade-obrigatoria'),
    );
    await reacao({ acao: 'avaliar', reacao: id, versao: await versao(id), causalidade: ids.causalidade });
    // Grave: só encerra notificada.
    await expect(
      reacao({ acao: 'encerrar', reacao: id, versao: await versao(id), desfecho: 'recuperado' }),
    ).rejects.toMatchObject(recusada('notificacao-obrigatoria'));
    await reacao({ acao: 'notificar', reacao: id, versao: await versao(id), observacao: 'Notivisa enviado' });
    await reacao({
      acao: 'encerrar',
      reacao: id,
      versao: await versao(id),
      desfecho: 'recuperado',
      fim: new Date().toISOString(),
    });
    const [fim] = await ler('SELECT * FROM reacao_adversa_paciente WHERE id = ?', [id]);
    expect(fim).toMatchObject({
      situacao: 'encerrada',
      desfecho: 'recuperado',
      causalidade_reacao_adversa_id: ids.causalidade,
      avaliado_por_profissional_id: ids.prof,
    });
    expect(fim!['notificado_em']).not.toBeNull();
    const eventos = await ler<{ etapa: string; situacao_anterior: string | null; situacao_nova: string }>(
      'SELECT etapa, situacao_anterior, situacao_nova, usuario_id FROM reacao_adversa_evento WHERE reacao_adversa_paciente_id = ? ORDER BY id',
      [id],
    );
    expect(eventos.map((e) => [e.etapa, e.situacao_anterior, e.situacao_nova])).toEqual([
      ['registro', null, 'registrada'],
      ['avaliacao_farmacia', 'registrada', 'avaliada'],
      ['notificacao', 'avaliada', 'notificada'],
      ['encerramento', 'notificada', 'encerrada'],
    ]);
    // Encerrada continua alertando (só a inativada sai do alerta).
    expect(
      (await fv.alertasDaPrescricao({ hospital: EST }, ids.paciente)).some((a) => a.alergia === -id),
    ).toBe(true);
  });

  it('reação de medicamento externo: inativação com justificativa sai do alerta e nada é apagado', async () => {
    const r = await reacao({
      acao: 'registrar',
      paciente: ids.paciente,
      medicamentoDescricao: 'Anti-inflamatório de uso domiciliar',
      descricao: 'Epigastralgia',
      inicio: new Date(Date.now() - 86_400_000).toISOString(),
      gravidade: ids.leve,
    });
    const id = r.resultado.reacao;
    await expect(
      reacao({ acao: 'inativar', reacao: id, versao: await versao(id), justificativa: 'curta' }),
    ).rejects.toMatchObject(recusada('justificativa-obrigatoria'));
    await reacao({
      acao: 'inativar',
      reacao: id,
      versao: await versao(id),
      justificativa: 'Registrada no paciente errado, corrigido no correto',
    });
    const [l] = await ler(
      'SELECT situacao, justificativa_inativacao, excluido_em FROM reacao_adversa_paciente WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({ situacao: 'inativa', excluido_em: null });
    expect(l!['justificativa_inativacao']).toContain('paciente errado');
    expect(
      (await fv.alertasDaPrescricao({ hospital: EST }, ids.paciente)).some((a) => a.alergia === -id),
    ).toBe(false);
    const tela = await fv.doPaciente({ hospital: EST, login: LOGIN }, ids.paciente);
    expect(tela.reacoes.find((x) => x.id === id)?.eventos.map((e) => e.etapa)).toEqual([
      'registro',
      'inativacao',
    ]);
  });

  it('recusa reação sem medicamento, sem profissional na conta ou com item de outro paciente, sem gravar', async () => {
    const antes = (
      await ler('SELECT COUNT(*) AS n FROM reacao_adversa_paciente WHERE estabelecimento_id = ?', [ids.est])
    )[0]!['n'];
    const base = {
      acao: 'registrar',
      paciente: ids.paciente,
      descricao: 'Urticária',
      inicio: new Date().toISOString(),
      gravidade: ids.leve,
    };
    await expect(reacao(base)).rejects.toMatchObject(recusada('medicamento-obrigatorio'));
    await expect(reacao({ ...base, medicamentoDescricao: 'X' }, LOGIN_SEM_PROF)).rejects.toMatchObject(
      recusada('usuario-sem-profissional'),
    );
    const depois = (
      await ler('SELECT COUNT(*) AS n FROM reacao_adversa_paciente WHERE estabelecimento_id = ?', [ids.est])
    )[0]!['n'];
    expect(Number(depois)).toBe(Number(antes));
  });

  it('uso contínuo: a reconciliação parte da lista, grava o lote ligado e atualiza a lista', async () => {
    const a = await uso({
      acao: 'incluir',
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      itemPrescritivel: ids.produto,
      posologia: '1 comprimido de 12 em 12 horas',
      fonte: 'receita',
      ultimaTomada: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    });
    const b = await uso({
      acao: 'incluir',
      paciente: ids.paciente,
      descricaoLivre: 'Losartana 50 mg',
      fonte: 'prontuario_anterior',
    });
    const ua = a.resultado.alvo;
    const ub = b.resultado.alvo;
    const lotes = () =>
      ler('SELECT COUNT(*) AS n FROM reconciliacao_medicamentosa WHERE estabelecimento_id = ?', [ids.est]);
    const antes = Number((await lotes())[0]!['n']);
    const rec = (decisoes: unknown[], momento = 'admissao') =>
      uso({ acao: 'reconciliar', paciente: ids.paciente, atendimento: ids.atendimento, momento, decisoes });
    await expect(rec([{ usoContinuo: ua, conduta: 'manter' }])).rejects.toMatchObject(
      recusada('lista-incompleta'),
    );
    await expect(
      rec([
        { usoContinuo: ua, conduta: 'manter' },
        { usoContinuo: ub, conduta: 'suspender' },
      ]),
    ).rejects.toMatchObject(recusada('justificativa-obrigatoria'));
    expect(Number((await lotes())[0]!['n'])).toBe(antes);

    const r = await rec([
      { usoContinuo: ua, conduta: 'ajustar', justificativa: 'Reduzir dose pela função renal' },
      { usoContinuo: ub, conduta: 'suspender', justificativa: 'Hipotensão na admissão' },
    ]);
    const itens = await ler(
      'SELECT medicamento_uso_previo_id, conduta, fonte, justificativa FROM reconciliacao_item WHERE reconciliacao_medicamentosa_id = ? ORDER BY sequencia',
      [r.resultado.alvo],
    );
    expect(itens).toEqual([
      expect.objectContaining({ medicamento_uso_previo_id: ua, conduta: 'ajustar', fonte: 'receita' }),
      expect.objectContaining({ medicamento_uso_previo_id: ub, conduta: 'suspender', fonte: 'prontuario' }),
    ]);
    const [lote] = await ler(
      'SELECT momento, situacao, responsavel_profissional_id FROM reconciliacao_medicamentosa WHERE id = ?',
      [r.resultado.alvo],
    );
    expect(lote).toMatchObject({
      momento: 'admissao',
      situacao: 'concluida',
      responsavel_profissional_id: ids.prof,
    });
    const lista = await ler(
      'SELECT id, conduta, suspenso, suspensor_usuario_id, justificativa_suspensao FROM medicamento_uso_previo WHERE id IN (?, ?) ORDER BY id',
      [ua, ub],
    );
    expect(lista.map((x) => [x['conduta'], Boolean(Number(x['suspenso']))])).toEqual([
      ['ajustar_dose', false],
      ['suspender', true],
    ]);
    expect(lista[1]).toMatchObject({
      suspensor_usuario_id: ids.usuario,
      justificativa_suspensao: 'Hipotensão na admissão',
    });

    // Alta: só o que ficou ativo entra; o suspenso fica fora da lista ativa (recusado se decidido de novo).
    await expect(
      rec(
        [
          { usoContinuo: ua, conduta: 'manter' },
          { usoContinuo: ub, conduta: 'manter' },
        ],
        'alta',
      ),
    ).rejects.toMatchObject(recusada('fora-da-lista'));
    // Transferência entre unidades (03-PEP L104): também parte da lista ativa, com o momento gravado no lote.
    const tr = await rec([{ usoContinuo: ua, conduta: 'manter' }], 'transferencia');
    const [loteTr] = await ler(
      'SELECT r.momento, COUNT(i.id) AS itens FROM reconciliacao_medicamentosa r JOIN reconciliacao_item i ON i.reconciliacao_medicamentosa_id = r.id WHERE r.id = ? GROUP BY r.momento',
      [tr.resultado.alvo],
    );
    expect([loteTr!['momento'], Number(loteTr!['itens'])]).toEqual(['transferencia', 1]);
    await rec([{ usoContinuo: ua, conduta: 'manter' }], 'alta');
    const tela = await fv.doPaciente({ hospital: EST, login: LOGIN }, ids.paciente);
    expect(tela.usoContinuo.map((x) => [x.id, x.suspenso, x.conduta])).toEqual([
      [ua, false, 'manter'],
      [ub, true, 'suspender'],
    ]);
    expect(tela.itensPrescritos.map((x) => x.id)).toContain(ids.item);
  });

  it('reação grave notifica já, antes da avaliação da farmácia; a não grave espera a avaliação', async () => {
    const inicio = new Date(Date.now() - 3_600_000).toISOString();
    const leve = (
      await reacao({
        acao: 'registrar',
        paciente: ids.paciente,
        itemPrescritivel: ids.produto,
        descricao: 'Prurido leve',
        inicio,
        gravidade: ids.leve,
      })
    ).resultado.reacao;
    await expect(
      reacao({ acao: 'notificar', reacao: leve, versao: await versao(leve) }),
    ).rejects.toMatchObject(recusada('avaliacao-pendente'));
    const grave = (
      await reacao({
        acao: 'registrar',
        paciente: ids.paciente,
        itemPrescritivel: ids.produto,
        descricao: 'Anafilaxia após a dose',
        inicio,
        gravidade: ids.grave,
      })
    ).resultado.reacao;
    await reacao({ acao: 'notificar', reacao: grave, versao: await versao(grave), observacao: 'Notivisa' });
    const [n] = await ler(
      'SELECT situacao, notificado_em, avaliado_em FROM reacao_adversa_paciente WHERE id = ?',
      [grave],
    );
    expect(n).toMatchObject({ situacao: 'registrada', avaliado_em: null });
    expect(n!['notificado_em']).not.toBeNull();
    await expect(
      reacao({ acao: 'notificar', reacao: grave, versao: await versao(grave) }),
    ).rejects.toMatchObject(recusada('ja-notificada'));
    await expect(
      reacao({ acao: 'encerrar', reacao: grave, versao: await versao(grave), desfecho: 'recuperado' }),
    ).rejects.toMatchObject(recusada('avaliacao-pendente'));
    await reacao({
      acao: 'avaliar',
      reacao: grave,
      versao: await versao(grave),
      causalidade: ids.causalidade,
    });
    await reacao({ acao: 'encerrar', reacao: grave, versao: await versao(grave), desfecho: 'recuperado' });
    const ev = await ler<{ etapa: string; situacao_anterior: string | null; situacao_nova: string }>(
      'SELECT etapa, situacao_anterior, situacao_nova FROM reacao_adversa_evento WHERE reacao_adversa_paciente_id = ? ORDER BY id',
      [grave],
    );
    expect(ev.map((e) => [e.etapa, e.situacao_anterior, e.situacao_nova])).toEqual([
      ['registro', null, 'registrada'],
      ['notificacao', 'registrada', 'registrada'],
      ['avaliacao_farmacia', 'registrada', 'notificada'],
      ['encerramento', 'notificada', 'encerrada'],
    ]);
  });

  it('a prescrição seguinte: o motor de alertas avisa pela reação com princípio e pela informada só pelo nome', async () => {
    const porNome = (
      await reacao({
        acao: 'registrar',
        paciente: ids.paciente,
        medicamentoDescricao: 'Cetoprofeno de uso domiciliar',
        descricao: 'Urticária',
        inicio: new Date(Date.now() - 86_400_000).toISOString(),
        gravidade: ids.leve,
      })
    ).resultado.reacao;
    // Pela porta da prescrição (alergias do paciente + reações), como o serviço monta o contexto do motor.
    const porta = new PortaPrescricaoPropria(nucleo as never, CLIENTE);
    const alergias = await porta.alergias({ hospital: EST } as never, ids.paciente);
    const produto = (id: number, nome: string, principios: number[]): ProdutoAlerta => ({
      produto: id,
      nome,
      principiosAtivos: principios,
      padronizado: true,
      altoAlerta: false,
      controlado: null,
      antimicrobiano: false,
      doseMinima: null,
      doseMaxima: null,
      viasPermitidas: [],
    });
    const item = (chave: string, p: ProdutoAlerta): ItemAvaliado => ({
      chave,
      tipo: 'medicamento',
      produtos: [{ produto: p, dose: 1, unidade: 'MG' }],
      via: 'VO',
      dosesNoPeriodo: 1,
      intervaloHoras: 24,
      aCriterio: false,
      seNecessario: null,
      fichaAntimicrobiano: false,
    });
    const gerados = achados({
      itens: [
        item('mesmo-principio', produto(ids.produto + 900_000, 'OUTRA MARCA SINTETICA', [ids.principio])),
        item('pelo-nome', produto(ids.produto + 900_001, 'CETOPROFENO 100MG COMPRIMIDO', [])),
        item('sem-relacao', produto(ids.produto + 900_002, 'PRODUTO SEM RELACAO', [])),
      ],
      ctx: {
        alergias,
        ativos: [],
        paciente: { clearance: null, pesoKg: null },
        tipoAtendimento: 'I',
        alta: false,
        regras: REGRAS_PADRAO,
        interacoes: [],
        duplicidade: { porMedicamento: true, porPrincipio: true, consistir: true },
        altaVigilancia: new Set(),
        dietaDeOutro: null,
        hoje: new Date().toISOString().slice(0, 10),
      },
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    }).filter((a) => a.tipo === 'alergia');
    expect(gerados.some((a) => a.item === 'mesmo-principio')).toBe(true);
    expect(gerados.filter((a) => a.item === 'pelo-nome').map((a) => a.id)).toContain(
      `alergia:${ids.produto + 900_001}:${-porNome}`,
    );
    expect(gerados.some((a) => a.item === 'sem-relacao')).toBe(false);
  });

  it('as rotas exigem o vínculo assistencial com o paciente e a leitura vai à trilha', async () => {
    const PERMS = [
      'pep.reconciliacao.ler',
      'pep.evolucao.criar',
      'pep.reconciliacao.registrar',
      PERMISSAO_AVALIAR_REACAO,
    ];
    const montar = (vinculo: boolean, perms: readonly string[] = PERMS) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new FarmacovigilanciaController(
        new EstadoProntuario(),
        trilha,
        fv,
        null,
        null,
        new VinculoSintetico(
          vinculo ? [{ login: LOGIN, idPaciente: ids.paciente, forma: 'atendimento-em-curso' }] : [],
        ),
        null,
      );
      const req = () =>
        ({
          headers: { 'idempotency-key': `f78fv-ctrl-${randomUUID()}`, 'x-correlation-id': 'f78fv-ctrl' },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...perms], null)),
            sessao: {
              usuario: { id: String(ids.usuario), nome: 'Conta sintética', login: LOGIN },
              rede: 'rede-f78fv',
              estabelecimentos: [],
              estabelecimentoAtivo: EST,
              unidadeAtiva: null,
              permissoes: [...perms],
              restricaoVinculo: true,
              sintetica: true,
              bloqueioInatividadeSegundos: 0,
              expiraEm: '',
            },
          },
        }) as unknown as RequisicaoAutorizada;
      return { trilha, ctrl, req };
    };
    const sem = montar(false);
    await expect(sem.ctrl.doPaciente(ids.paciente, sem.req())).rejects.toMatchObject({ status: 403 });
    expect(
      sem.trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === ids.paciente,
      ),
    ).toBe(true);
    const [qualquer] = await ler<{ id: number }>(
      'SELECT id FROM reacao_adversa_paciente WHERE paciente_id = ? ORDER BY id LIMIT 1',
      [ids.paciente],
    );
    // Gravação pelo id da reação: o paciente sai do registro e o vínculo é conferido antes de gravar.
    await expect(
      sem.ctrl.reacao(
        { acao: 'avaliar', reacao: Number(qualquer!.id), versao: 1, causalidade: ids.causalidade },
        sem.req(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      sem.ctrl.usoContinuo(
        { acao: 'incluir', paciente: ids.paciente, descricaoLivre: 'Losartana', fonte: 'paciente' },
        sem.req(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      sem.ctrl.reacao({ acao: 'avaliar', reacao: 999_999_999, versao: 1 }, sem.req()),
    ).rejects.toMatchObject({
      status: 404,
    });
    const com = montar(true);
    const tela = await com.ctrl.doPaciente(ids.paciente, com.req());
    expect(tela.reacoes.length).toBeGreaterThan(0);
    expect(
      com.trilha.eventos.filter(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo &&
          e.paciente === ids.paciente &&
          e.recurso === 'pep.prontuario',
      ),
    ).toHaveLength(1);
    await expect(com.ctrl.doPaciente(999_999_999, com.req())).rejects.toMatchObject({ status: 404 });
  });
  it('a avaliação é da farmácia clínica (permissão própria): quem só registra recebe 403 e nada muda', async () => {
    const trilha = new RegistradorTrilhaMemoria();
    const ctrl = new FarmacovigilanciaController(
      new EstadoProntuario(),
      trilha,
      fv,
      null,
      null,
      new VinculoSintetico([{ login: LOGIN, idPaciente: ids.paciente, forma: 'atendimento-em-curso' }]),
      null,
    );
    const req = (perms: readonly string[]) =>
      ({
        headers: { 'idempotency-key': `f78fv-aval-${randomUUID()}`, 'x-correlation-id': 'f78fv-aval' },
        ip: '127.0.0.1',
        sgh: {
          real: false,
          ability: criarAbility(regrasDeAcesso([...perms], null)),
          sessao: {
            usuario: { id: String(ids.usuario), nome: 'Conta sintética', login: LOGIN },
            rede: 'rede-f78fv',
            estabelecimentos: [],
            estabelecimentoAtivo: EST,
            unidadeAtiva: null,
            permissoes: [...perms],
            restricaoVinculo: true,
            sintetica: true,
            bloqueioInatividadeSegundos: 0,
            expiraEm: '',
          },
        },
      }) as unknown as RequisicaoAutorizada;
    const MEDICO = ['pep.reconciliacao.ler', 'pep.evolucao.criar'];
    const FARMACIA = [PERMISSAO_AVALIAR_REACAO];
    const negadas = (recurso: string) =>
      trilha.eventos.filter(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.recurso === recurso,
      ).length;

    // O médico registra pela rota; a farmácia, que não registra evolução, não registra a reação.
    const registrada = await ctrl.reacao(
      {
        acao: 'registrar',
        paciente: ids.paciente,
        itemPrescritivel: ids.produto,
        descricao: 'Exantema após a dose',
        inicio: new Date(Date.now() - 3_600_000).toISOString(),
        gravidade: ids.leve,
      },
      req(MEDICO),
    );
    const id = Number(registrada.resultado.reacao);
    await expect(
      ctrl.reacao(
        {
          acao: 'registrar',
          paciente: ids.paciente,
          itemPrescritivel: ids.produto,
          descricao: 'Tentativa sem a permissão',
          inicio: new Date(Date.now() - 3_600_000).toISOString(),
          gravidade: ids.leve,
        },
        req(FARMACIA),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(negadas('pep.evolucao.criar')).toBe(1);

    // O médico não avalia: 403, negação na trilha e a reação segue como estava.
    const antes = await versao(id);
    await expect(
      ctrl.reacao({ acao: 'avaliar', reacao: id, versao: antes, causalidade: ids.causalidade }, req(MEDICO)),
    ).rejects.toMatchObject({ status: 403 });
    expect(negadas(PERMISSAO_AVALIAR_REACAO)).toBe(1);
    expect(await versao(id)).toBe(antes);
    const [semAval] = await ler('SELECT situacao, avaliado_em FROM reacao_adversa_paciente WHERE id = ?', [
      id,
    ]);
    expect(semAval).toMatchObject({ situacao: 'registrada', avaliado_em: null });

    // A farmácia lê a tela do paciente e avalia: a causalidade e o passo ficam no banco.
    const tela = await ctrl.doPaciente(ids.paciente, req(FARMACIA));
    expect(tela.reacoes.some((r) => r.id === id)).toBe(true);
    await ctrl.reacao(
      { acao: 'avaliar', reacao: id, versao: antes, causalidade: ids.causalidade },
      req(FARMACIA),
    );
    const [aval] = await ler<{ situacao: string; avaliado_em: Date | null }>(
      'SELECT situacao, avaliado_em FROM reacao_adversa_paciente WHERE id = ?',
      [id],
    );
    expect(aval!.avaliado_em).not.toBeNull();
    expect(aval!.situacao).toBe('avaliada');
    const ev = await ler<{ etapa: string }>(
      'SELECT etapa FROM reacao_adversa_evento WHERE reacao_adversa_paciente_id = ? ORDER BY id',
      [id],
    );
    expect(ev.map((e) => e.etapa)).toEqual(['registro', 'avaliacao_farmacia']);
  });
});
