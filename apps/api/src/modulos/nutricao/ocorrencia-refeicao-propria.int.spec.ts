// Contrato de efeito das ocorrências na entrega da refeição (F8, 04-HOT linha 143) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA com o prefixo do teste: estabelecimento, unidade de internação, refeição do dia, modalidade de
// dieta, tipos de ocorrência, pacientes, atendimentos, internações e o mapa fechado com as bandejas; usuário e ids de
// cadastro básico (unidade assistencial, setor, categoria) são os do cliente de teste (só lidos).
// Prova o que fica no banco: a ocorrência gravada sobre a bandeja do mapa fechado (atendimento, paciente, refeição,
// registrante, sem resolução) com a descrição do tipo quando não há exigência; a justificativa exigida pelo tipo (422 sem
// linha); o aviso de reposição; o paciente fora do mapa e a bandeja cancelada recusados (422 sem linha); a lista do mapa;
// a resolução com a providência, quem e quando (versão +1) e a segunda resolução recusada sem reescrever; a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaOcorrenciaRefeicaoPropria } from './ocorrencia-refeicao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c1131oc';
const HOJE = new Date().toISOString().slice(0, 10);
const ONTEM = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

interface Massa {
  est: number;
  usuario: number;
  refeicao: number;
  tipoSimples: number;
  tipoJustifica: number;
  tipoRepoe: number;
  intNoMapa: number;
  intForaMapa: number;
  intCancelada: number;
  itemNoMapa: number;
  atdNoMapa: number;
  pacNoMapa: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM ocorrencia_entrega_refeicao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE it FROM mapa_dieta_item it JOIN mapa_dieta m ON m.id = it.mapa_dieta_id WHERE m.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM mapa_dieta WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      'DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome LIKE ?',
      [`SINTETICO ${P}%`],
    );
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`SINTETICO ${P}%`]);
    await e.executar(`DELETE FROM unidade_internacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM tipo_ocorrencia_refeicao WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM modalidade_dieta WHERE codigo LIKE ?', [`${P}-%`]);
    await e.executar('DELETE FROM refeicao_do_dia WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaOcorrenciaRefeicaoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaOcorrenciaRefeicaoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]?.['n'] ?? 0);
  const total = () =>
    contar('SELECT COUNT(*) AS n FROM ocorrencia_entrega_refeicao WHERE estabelecimento_id = ?', [m.est]);
  const base = (internacao: number, tipo: number) => ({
    unidade: `${P}-UI`,
    refeicao: m.refeicao,
    data: HOJE,
    internacao,
    tipo,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        const ui = await e.inserir(
          `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, setor_funcional_id, codigo,
             descricao, tipo, criado_em) VALUES (?, 1, 1, ?, 'ENFERMARIA SINTETICA', 'enfermaria', ?)`,
          [est, `${P}-UI`, agora],
        );
        const refeicao = await e.inserir(
          `INSERT INTO refeicao_do_dia (codigo, descricao, ordem, servida_acompanhante, ativo, criado_em)
           VALUES (?, ?, 9311, FALSE, TRUE, ?)`,
          [`${P}-R1`, `ALMOCO SINTETICO ${P}`, agora],
        );
        const modalidade = await e.inserir(
          "INSERT INTO modalidade_dieta (codigo, descricao, ativo, classe, criado_em) VALUES (?, ?, TRUE, 'oral', ?)",
          [`${P}-MD`, `DIETA LIVRE SINTETICA ${P}`, agora],
        );
        const tipo = (cod: string, desc: string, repoe: boolean, justifica: boolean) =>
          e.inserir(
            `INSERT INTO tipo_ocorrencia_refeicao (codigo, descricao, gera_reposicao, exige_justificativa, ativo, criado_em)
             VALUES (?, ?, ?, ?, TRUE, ?)`,
            [`${P}-${cod}`, desc, repoe, justifica, agora],
          );
        const tipoSimples = await tipo('ATR', 'Atraso na entrega', false, false);
        const tipoJustifica = await tipo('REC', 'Recusa do paciente', false, true);
        const tipoRepoe = await tipo('ERR', 'Dieta errada', true, false);
        const paciente = async (sufixo: string, prontuario: number) => {
          const pf = await e.inserir(
            "INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, '1980-01-01', ?)",
            [`SINTETICO ${P} ${sufixo}`, agora],
          );
          return e.inserir(
            "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
            [pf, prontuario, agora],
          );
        };
        const atendimento = (pac: number, n: string) =>
          e.inserir(
            `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
               carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
             VALUES (?, ?, ?, 1, 1, 1, 1, NOW(3) - INTERVAL 2 DAY, ?)`,
            [est, `${P}-${n}`, pac, agora],
          );
        const internacao = (atd: number, pac: number, n: string) =>
          e.inserir(
            `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
               carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id,
               especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
             VALUES (?, ?, ?, ?, NOW(3) - INTERVAL 2 DAY, 1, 1, ?, 1, 1, 1, 1, 1, 'ativa', ?)`,
            [est, `${P}-${n}`, atd, pac, ui, agora],
          );
        const pacs = [
          await paciente('A', 931_131_001),
          await paciente('B', 931_131_002),
          await paciente('C', 931_131_003),
        ];
        const atds = [
          await atendimento(pacs[0]!, 'A1'),
          await atendimento(pacs[1]!, 'A2'),
          await atendimento(pacs[2]!, 'A3'),
        ];
        const ints = [
          await internacao(atds[0]!, pacs[0]!, 'I1'),
          await internacao(atds[1]!, pacs[1]!, 'I2'),
          await internacao(atds[2]!, pacs[2]!, 'I3'),
        ];
        const mapa = await e.inserir(
          `INSERT INTO mapa_dieta (estabelecimento_id, data_referencia, refeicao_do_dia_id, setor_funcional_id,
             unidade_internacao_id, horario_corte, situacao, fechado_em, fechado_por_usuario_id, criado_em)
           VALUES (?, ?, ?, 1, ?, ?, 'fechado', ?, ?, ?)`,
          [est, HOJE, refeicao, ui, agora, agora, usuario['id'], agora],
        );
        const item = (seq: number, k: number, situacao: string) =>
          e.inserir(
            `INSERT INTO mapa_dieta_item (mapa_dieta_id, sequencia, atendimento_id, paciente_id, modalidade_dieta_id,
               situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [mapa, seq, atds[k], pacs[k], modalidade, situacao, agora],
          );
        const itemNoMapa = await item(1, 0, 'previsto');
        await item(2, 2, 'cancelado');
        // Mapa ainda aberto (vindo de importação) da mesma unidade e refeição no dia anterior, com a mesma internação.
        const mapaAberto = await e.inserir(
          `INSERT INTO mapa_dieta (estabelecimento_id, data_referencia, refeicao_do_dia_id, setor_funcional_id,
             unidade_internacao_id, horario_corte, situacao, origem, criado_em)
           VALUES (?, ?, ?, 1, ?, ?, 'aberto', 'migracao', ?)`,
          [est, ONTEM, refeicao, ui, agora, agora],
        );
        await e.inserir(
          `INSERT INTO mapa_dieta_item (mapa_dieta_id, sequencia, atendimento_id, paciente_id, modalidade_dieta_id,
             situacao, criado_em) VALUES (?, 1, ?, ?, ?, 'previsto', ?)`,
          [mapaAberto, atds[0], pacs[0], modalidade, agora],
        );
        return {
          est,
          usuario: Number(usuario['id']),
          refeicao,
          tipoSimples,
          tipoJustifica,
          tipoRepoe,
          intNoMapa: ints[0]!,
          intForaMapa: ints[1]!,
          intCancelada: ints[2]!,
          itemNoMapa,
          atdNoMapa: atds[0]!,
          pacNoMapa: pacs[0]!,
        };
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    porta = new PortaOcorrenciaRefeicaoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('registra sobre a bandeja do mapa fechado, com a justificativa exigida e o aviso de reposição', async () => {
    const tipos = await porta.tipos(ctx());
    expect(tipos.find((t) => t.id === m.tipoJustifica)).toMatchObject({ exigeJustificativa: true });

    const r1 = await porta.registrar(ctx(), base(m.intNoMapa, m.tipoSimples));
    expect(r1.reposicao).toBe(false);
    const [g] = await ler(
      `SELECT mapa_dieta_item_id, atendimento_id, paciente_id, refeicao_do_dia_id, descricao, registrado_por_usuario_id,
              resolvida, resolvida_em, providencia, versao FROM ocorrencia_entrega_refeicao WHERE id = ?`,
      [r1.id],
    );
    expect(g).toMatchObject({
      mapa_dieta_item_id: m.itemNoMapa,
      atendimento_id: m.atdNoMapa,
      paciente_id: m.pacNoMapa,
      refeicao_do_dia_id: m.refeicao,
      descricao: 'Atraso na entrega',
      registrado_por_usuario_id: m.usuario,
      resolvida: 0,
      resolvida_em: null,
      providencia: null,
      versao: 1,
    });

    await expect(
      porta.registrar(ctx(), { ...base(m.intNoMapa, m.tipoJustifica), descricao: 'curta' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await total()).toBe(1);
    const r2 = await porta.registrar(ctx(), {
      ...base(m.intNoMapa, m.tipoJustifica),
      descricao: 'Paciente recusou por náusea',
    });
    expect(
      (await ler('SELECT descricao FROM ocorrencia_entrega_refeicao WHERE id = ?', [r2.id]))[0]?.[
        'descricao'
      ],
    ).toBe('Paciente recusou por náusea');

    const r3 = await porta.registrar(ctx(), base(m.intNoMapa, m.tipoRepoe));
    expect(r3.reposicao).toBe(true);
    expect(r3.mensagem).toContain('reposição');
    expect(await total()).toBe(3);
  });

  it('recusa o paciente fora do mapa, a bandeja cancelada e o momento no futuro, sem gravar', async () => {
    const antes = await total();
    await expect(porta.registrar(ctx(), base(m.intForaMapa, m.tipoSimples))).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(porta.registrar(ctx(), base(m.intCancelada, m.tipoSimples))).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.registrar(ctx(), { ...base(m.intNoMapa, m.tipoSimples), ocorridoEm: '2099-01-01T12:00' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.registrar(ctx(), { ...base(m.intNoMapa, m.tipoSimples), unidade: 'NAO-EXISTE' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(await total()).toBe(antes);
  });

  it('recusa a ocorrência sobre a bandeja de mapa ainda aberto, sem gravar', async () => {
    const antes = await total();
    await expect(
      porta.registrar(ctx(), {
        ...base(m.intNoMapa, m.tipoSimples),
        data: ONTEM,
        ocorridoEm: `${ONTEM}T12:00`,
      }),
    ).rejects.toMatchObject({ problema: { status: 422, title: 'Sem bandeja no mapa' } });
    expect(await total()).toBe(antes);
  });

  it('lista as ocorrências do mapa e resolve uma vez só, sem reescrever', async () => {
    const lista = await porta.listar(ctx(), { unidade: `${P}-UI`, refeicao: m.refeicao, data: HOJE });
    expect(lista).toHaveLength(3);
    expect(lista.every((o) => o.internacao === m.intNoMapa && !o.resolvida)).toBe(true);
    const alvo = lista.find((o) => o.reposicao)!;
    await expect(porta.resolver(ctx(), alvo.id, { providencia: 'ok', versao: 1 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await porta.resolver(ctx(), alvo.id, { providencia: 'Nova bandeja servida às 12h40', versao: 1 });
    const [r] = await ler(
      `SELECT resolvida, resolvida_em, resolvida_por_usuario_id, providencia, versao, excluido_em
         FROM ocorrencia_entrega_refeicao WHERE id = ?`,
      [alvo.id],
    );
    expect(r).toMatchObject({
      resolvida: 1,
      resolvida_por_usuario_id: m.usuario,
      providencia: 'Nova bandeja servida às 12h40',
      versao: 2,
      excluido_em: null,
    });
    expect(r?.['resolvida_em']).not.toBeNull();
    await expect(
      porta.resolver(ctx(), alvo.id, { providencia: 'Outra providência qualquer', versao: 2 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect(
      (await ler('SELECT providencia, versao FROM ocorrencia_entrega_refeicao WHERE id = ?', [alvo.id]))[0],
    ).toMatchObject({ providencia: 'Nova bandeja servida às 12h40', versao: 2 });
    const depois = await porta.listar(ctx(), { unidade: `${P}-UI`, refeicao: m.refeicao, data: HOJE });
    expect(depois.find((o) => o.id === alvo.id)).toMatchObject({
      resolvida: true,
      resolvidaPor: expect.any(String),
    });
    expect(await total()).toBe(3);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
        [m.est, m.usuario],
      ),
    ).toBeGreaterThan(0);
  });
});
