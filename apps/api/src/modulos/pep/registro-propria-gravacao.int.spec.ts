// Integração da gravação do registro clínico no banco próprio contra o MariaDB real (cliente de teste f22_o3). Massa
// SINTÉTICA com o prefixo do lote (l93reg), montada no beforeAll e refeita a cada rodada. O estabelecimento e as contas
// do lote ficam (a trilha é só inclusão e os referencia, com a cadeia do SBIS-16); o resto é apagado na limpeza do
// teste (a regra "registro clínico nunca é apagado" é do produto: a massa sintética do teste sai). Nenhum dado de
// pessoa real. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { converterModelo } from '@sgh/dominio-pep';
import { type ContextoOperacao, type Escritor, executarComo, NucleoProprio } from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DESLOCAMENTO_OPCAO, RegistroPropriaGravacao } from './registro-propria-gravacao.js';
import type { LinhaGravacao } from './tipos-pep.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_REGISTRO']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l93reg';
const PM = P.toUpperCase();
const PRONTUARIO = 901_093_001;
const C = {
  rede: CLIENTE,
  hospital: P,
  cliente: CLIENTE,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
};
const HASH = 'c'.repeat(64);

interface Massa {
  estabelecimento: number;
  medico: number;
  semProfissional: number;
  profissional: number;
  inscricao: number;
  paciente: number;
  atendimento: number;
  modelo: number;
  campoTexto: number;
  campoEscolha: number;
  opcaoGrave: number;
  campoMultipla: number;
  opcaoEnteral: number;
}

const linha = (ordem: string, v: Partial<LinhaGravacao>): LinhaGravacao =>
  ({
    ordem,
    seq: 0,
    idResposta: 1,
    data: null,
    hora: null,
    indice: null,
    valor: null,
    alfa: null,
    texto: null,
    unidade: '',
    cid: null,
    ...v,
  }) as LinhaGravacao;

describe.skipIf(SEM_BANCO)('RegistroPropriaGravacao contra o MariaDB (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let g: RegistroPropriaGravacao;
  let m: Massa;
  const ctx = (extra: Partial<ContextoOperacao> = {}): ContextoOperacao => ({
    cliente: CLIENTE,
    estabelecimento: m.estabelecimento,
    usuario: m.medico,
    correlacao: P,
    chaveIdempotencia: `${P}:${randomUUID()}`,
    ...extra,
  });

  async function limpar(e: Escritor): Promise<void> {
    const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
    await e.executar(
      `DELETE s FROM registro_assistencial_resposta s JOIN registro_assistencial r ON r.id = s.registro_assistencial_id
        WHERE r.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM registro_assistencial_rascunho WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE s FROM registro_assistencial_supervisao s JOIN registro_assistencial r ON r.id = s.registro_assistencial_id
        WHERE r.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(
      `UPDATE registro_assistencial SET corrige_registro_assistencial_id = NULL WHERE estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN ${est}`, [P]);
    const doModelo = `IN (SELECT c.id FROM modelo_campo c JOIN modelo_documento_versao v ON v.id = c.modelo_documento_versao_id
                          JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id WHERE m.codigo LIKE ?)`;
    await e.executar(`DELETE FROM modelo_campo_opcao WHERE modelo_campo_id ${doModelo}`, [`${PM}_%`]);
    await e.executar(
      `UPDATE modelo_campo c JOIN modelo_documento_versao v ON v.id = c.modelo_documento_versao_id
         JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id
          SET c.pai_modelo_campo_id = NULL WHERE m.codigo LIKE ?`,
      [`${PM}_%`],
    );
    await e.executar(
      `DELETE c FROM modelo_campo c JOIN modelo_documento_versao v ON v.id = c.modelo_documento_versao_id
         JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id WHERE m.codigo LIKE ?`,
      [`${PM}_%`],
    );
    await e.executar(
      'UPDATE modelo_documento_clinico SET publicada_modelo_documento_versao_id = NULL, situacao = ? WHERE codigo LIKE ?',
      ['rascunho', `${PM}_%`],
    );
    await e.executar(
      `DELETE v FROM modelo_documento_versao v JOIN modelo_documento_clinico m ON m.id = v.modelo_documento_clinico_id
        WHERE m.codigo LIKE ?`,
      [`${PM}_%`],
    );
    await e.executar('DELETE FROM modelo_documento_clinico WHERE codigo LIKE ?', [`${PM}_%`]);
    await e.executar('DELETE FROM tipo_documento_clinico WHERE codigo LIKE ?', [`${PM}_%`]);
    await e.executar(
      'DELETE FROM paciente WHERE pessoa_fisica_id IN (SELECT id FROM pessoa_fisica WHERE nome LIKE ?)',
      [`Pessoa sintética ${P}%`],
    );
    const prof = '(SELECT id FROM profissional WHERE observacao = ?)';
    await e.executar(`DELETE FROM inscricao_conselho WHERE profissional_id IN ${prof}`, [`massa ${P}`]);
    await e.executar(
      `DELETE FROM vinculo_supervisao_profissional WHERE supervisor_profissional_id IN ${prof}
          OR supervisionado_profissional_id IN ${prof}`,
      [`massa ${P}`, `massa ${P}`],
    );
    await e.executar(`DELETE FROM usuario_vinculo_profissional WHERE profissional_id IN ${prof}`, [
      `massa ${P}`,
    ]);
    await e.executar(`DELETE FROM usuario_profissional WHERE profissional_id IN ${prof}`, [`massa ${P}`]);
    await e.executar('DELETE FROM profissional WHERE observacao = ?', [`massa ${P}`]);
    await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
    await e.executar('DELETE FROM categoria_atendimento WHERE codigo LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM carater_atendimento_tiss WHERE codigo_tiss LIKE ?', [`${P}%`]);
    await e.executar('DELETE FROM fonte_pagadora WHERE codigo LIKE ?', [`${P}%`]);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const ins = (sql: string, p: unknown[]) => e.inserir(sql, p);
      const um = async (sql: string, p: unknown[] = []) =>
        Number((await e.consultar(sql, p))[0]?.['id'] ?? 0);
      const estabelecimento =
        (await um('SELECT id FROM estabelecimento WHERE codigo = ?', [P])) ||
        (await ins(
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
        ));
      const conta = async (login: string) =>
        (await um('SELECT id FROM usuario WHERE login = ?', [login])) ||
        (await ins(
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [login, 'Conta sintética', agora],
        ));
      const medico = await conta(`${P}.medico`);
      const semProfissional = await conta(`${P}.semprof`);
      const pessoaPac = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} paciente`,
        agora,
      ]);
      const pessoaProf = await ins('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
        `Pessoa sintética ${P} profissional`,
        agora,
      ]);
      const paciente = await ins(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac, PRONTUARIO, agora],
      );
      const profissional = await ins(
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)",
        [pessoaProf, `massa ${P}`, agora],
      );
      await ins(
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [medico, profissional, '2020-01-01', agora],
      );
      const conselho = await um('SELECT id FROM conselho_classe ORDER BY id LIMIT 1');
      const uf = await um('SELECT id FROM unidade_federativa ORDER BY id LIMIT 1');
      expect(conselho * uf).toBeGreaterThan(0);
      const inscricao = await ins(
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, principal, situacao, criado_em) VALUES (?, 1, ?, ?, ?, TRUE, 'ativa', ?)`,
        [profissional, conselho, uf, '93001', agora],
      );
      const tipo = await ins(
        'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${PM}_EVOL`, 'Evolução sintética', 'evolucao', agora],
      );
      const modelo = await ins(
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        [`${PM}_PUB`, 'Evolução sintética', tipo, agora],
      );
      const versao = await ins(
        `INSERT INTO modelo_documento_versao (modelo_documento_clinico_id, numero_versao, situacao, publicada_em,
           publicacao_usuario_id, hash_definicao, operacao, dados, ocorrido_em, usuario_id, criado_em)
         VALUES (?, 1, 'publicada', ?, ?, ?, 'inclusao', ?, ?, ?, ?)`,
        [modelo, agora, medico, 'd'.repeat(64), '{"campos":[]}', agora, medico, agora],
      );
      await e.executar(
        "UPDATE modelo_documento_clinico SET situacao = 'publicado', publicada_modelo_documento_versao_id = ? WHERE id = ?",
        [versao, modelo],
      );
      const novoCampo = (seq: number, tipoCampo: string, titulo: string, pai: number | null) =>
        ins(
          `INSERT INTO modelo_campo (modelo_documento_versao_id, sequencia, pai_modelo_campo_id, identificador, titulo,
             tipo_campo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [versao, seq, pai, `c${seq}`, titulo, tipoCampo, agora],
        );
      const secao = await novoCampo(1, 'secao', 'Evolução', null);
      const campoTexto = await novoCampo(2, 'texto', 'Quadro clínico', secao);
      const campoEscolha = await novoCampo(3, 'escolha', 'Gravidade', secao);
      const campoMultipla = await novoCampo(4, 'multipla', 'Dieta', secao);
      const opcao = (campo: number, seq: number, rotulo: string) =>
        ins(
          'INSERT INTO modelo_campo_opcao (modelo_campo_id, sequencia, codigo, rotulo, criado_em) VALUES (?, ?, ?, ?, ?)',
          // Código único da opção (como o da carga: a chave da opção na origem), lido pelo rascunho importado.
          [campo, seq, `o${campo}_${seq}`, rotulo, agora],
        );
      await opcao(campoEscolha, 1, 'Leve');
      const opcaoGrave = await opcao(campoEscolha, 2, 'Grave');
      await opcao(campoMultipla, 1, 'Oral');
      const opcaoEnteral = await opcao(campoMultipla, 2, 'Enteral');
      // A carga cria uma opção (inativa no formulário) também para a pergunta de texto: é por ela que a resposta
      // importada acha o campo.
      await ins(
        'INSERT INTO modelo_campo_opcao (modelo_campo_id, sequencia, codigo, rotulo, ativo, criado_em) VALUES (?, ?, ?, ?, FALSE, ?)',
        [campoTexto, 9, `o${campoTexto}_9`, 'Texto', agora],
      );
      const categoria = await ins(
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [`${P}int`, 'Categoria sintética', agora],
      );
      const carater = await ins(
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await ins(
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      const atendimento = await ins(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [estabelecimento, '93001', paciente, categoria, carater, fonte, profissional, agora, agora],
      );
      return {
        estabelecimento,
        medico,
        semProfissional,
        profissional,
        inscricao,
        paciente,
        atendimento,
        modelo,
        campoTexto,
        campoEscolha,
        opcaoGrave,
        campoMultipla,
        opcaoEnteral,
      };
    });
    g = new RegistroPropriaGravacao(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  const linhas = (): LinhaGravacao[] => [
    linha('01', { idResposta: 1 }),
    linha('0101', { idResposta: m.campoTexto, texto: 'Quadro sintético estável' }),
    linha('0102', { idResposta: DESLOCAMENTO_OPCAO + m.opcaoGrave, indice: '2' }),
    linha('0103', { idResposta: DESLOCAMENTO_OPCAO + m.opcaoEnteral, indice: '1', alfa: 'Enteral' }),
  ];
  const base = () => ({
    paciente: m.paciente,
    modelo: m.modelo,
    atendimento: m.atendimento,
    cbo: m.profissional,
    dataHoraClinica: '2026-11-20T09:30',
    retratos: { htAtendimento: m.atendimento, htPaciente: m.paciente },
  });

  it('profissional e podeGravar: a conta ligada ao profissional com inscrição ativa grava', async () => {
    const p = await g.profissional(C, `${P}.medico`);
    expect(p).toMatchObject({ idUsuario: m.medico, idProfissional: m.profissional, cbo: m.profissional });
    expect(await g.podeGravar(C, 'pep.registro.registrar', `${P}.medico`)).toEqual({
      pode: true,
      codigo: null,
      motivo: null,
    });
    expect(await g.profissional(C, `${P}.semprof`)).toBeNull();
    expect((await g.podeGravar(C, 'x', `${P}.semprof`)).codigo).toBe('sem-profissional');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.executar("UPDATE inscricao_conselho SET situacao = 'suspensa' WHERE id = ?", [m.inscricao]),
    );
    try {
      expect((await g.podeGravar(C, 'x', `${P}.medico`)).codigo).toBe('sem-inscricao-ativa');
      await expect(g.salvarRascunho(C, { ...base(), linhas: linhas() }, ctx())).rejects.toMatchObject({
        problema: { codigo: 'sem-inscricao-ativa' },
      });
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
        e.executar("UPDATE inscricao_conselho SET situacao = 'ativa' WHERE id = ?", [m.inscricao]),
      );
    }
  });

  it('definição da versão publicada: ordem hierárquica e o conversor do domínio lê', async () => {
    const def = await g.definicao(C, m.modelo);
    expect(def?.vinculos.map((v) => v.ordem)).toEqual(['01', '0101', '0102', '0103']);
    const r = await converterModelo(def!);
    expect(r.itens.length).toBeGreaterThan(0);
    expect(r.pendencias.filter((x) => x.tipo === 'escolha')).toEqual([]);
    expect(await g.definicao(C, 999_999_999)).toBeNull();
  });

  it('rascunho → nova versão → registro: listas, conflito de versão, finalização, leitura e trilha', async () => {
    const r1 = await g.salvarRascunho(C, { ...base(), linhas: linhas() }, ctx());
    expect((await g.rascunhosDoProfissional(C, [m.profissional])).map((x) => x.id)).toContain(r1.rascunho);
    const doPaciente = await g.rascunhosDoPaciente(C, m.paciente, m.modelo);
    expect(doPaciente[0]).toMatchObject({ id: r1.rascunho, respostas: 3, doNovo: true, cbo: m.profissional });
    expect(doPaciente[0]?.dataHoraClinica).toBe('2026-11-20T09:30:00.000');
    const r2 = await g.salvarRascunho(
      C,
      { ...base(), linhas: linhas(), rascunho: { id: r1.rascunho, versao: r1.versao } },
      ctx(),
    );
    expect(r2.rascunho).not.toBe(r1.rascunho);
    const lido1 = await g.lerRascunho(C, r1.rascunho);
    expect(lido1).toMatchObject({ aberto: false, substituido: true });
    await expect(
      g.salvarRascunho(
        C,
        { ...base(), linhas: linhas(), rascunho: { id: r1.rascunho, versao: r1.versao } },
        ctx(),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    // Outro profissional (cbo diferente da sessão): recusa.
    await expect(
      g.registrar(C, { ...registro(), cbo: m.profissional + 1 } as never, ctx()),
    ).rejects.toMatchObject({ problema: { codigo: 'profissional-sem-cbo' } });

    const { registro: id } = await g.registrar(
      C,
      { ...registro(), rascunho: { id: r2.rascunho, versao: r2.versao } } as never,
      ctx(),
    );
    expect(await g.lerRascunho(C, r2.rascunho)).toMatchObject({ aberto: false, substituido: false });
    expect(await g.rascunhosDoPaciente(C, m.paciente, m.modelo)).toEqual([]);
    const ultimo = await g.ultimoRegistro(C, m.paciente, m.modelo);
    expect(ultimo?.registro).toBe(id);
    expect(ultimo?.linhas.map((l) => [l.ordem, l.idResposta, l.indice, l.texto])).toEqual([
      ['0101', m.campoTexto, null, 'Quadro sintético estável'],
      ['0102', DESLOCAMENTO_OPCAO + m.opcaoGrave, '2', null],
      ['0103', DESLOCAMENTO_OPCAO + m.opcaoEnteral, '1', null],
    ]);
    expect(await g.respostasRegistro(C, id)).toEqual(ultimo?.linhas);
    const hist = await g.historico(C, m.paciente, m.modelo, '0102');
    expect(hist.map((h) => [h.registro, h.linhas.length])).toEqual([[id, 1]]);
    expect(await g.cabecalhoRegistro(C, id)).toMatchObject({
      id,
      paciente: m.paciente,
      cbo: m.profissional,
      dataHoraClinica: '2026-11-20T09:30:00.000',
      suspensoEm: null,
      profissionalNome: `Pessoa sintética ${P} profissional`,
    });
    expect(await g.prova(C, id)).toEqual({
      guardado: HASH,
      hashConteudo: HASH,
      atual: HASH,
      comoSuporte: [],
    });
    const cab = await g.cabecalhoDocumento(
      C,
      { htPaciente: m.paciente, htAtendimento: m.atendimento },
      m.profissional,
      1,
    );
    expect(cab.situacao).toBe('Lançado');
    const trilha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      l.uma(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'registro_assistencial' AND entidade_id = ?",
        [id],
      ),
    );
    expect(Number(trilha?.['n'])).toBeGreaterThan(0);

    // Suspensão: exige reautenticação, só o autor; depois a correção aponta o suspenso.
    const susp = {
      registro: id,
      cbo: m.profissional,
      justificativa: 'Lançado no paciente errado (teste)',
      documento: 'x'.repeat(20),
    };
    await expect(g.suspender(C, susp, ctx())).rejects.toMatchObject({
      problema: { codigo: 'reautenticacao-necessaria' },
    });
    await g.suspender(C, susp, ctx({ reautenticadoEm: Date.now() }));
    await expect(g.suspender(C, susp, ctx({ reautenticadoEm: Date.now() }))).rejects.toMatchObject({
      problema: { codigo: 'ja-suspenso' },
    });
    expect((await g.cabecalhoRegistro(C, id))?.suspensoEm).not.toBeNull();
    expect(await g.ultimoRegistro(C, m.paciente, m.modelo)).toBeNull();
    const corr = await g.registrar(C, { ...registro(), corrige: id } as never, ctx());
    expect((await g.cabecalhoRegistro(C, corr.registro))?.corrige).toBe(id);
  }, 60_000);

  it('descarte do rascunho: fica descartado (nunca apagado) e não volta às listas', async () => {
    const r = await g.salvarRascunho(C, { ...base(), linhas: linhas() }, ctx());
    await g.descartarRascunho(C, { rascunho: r.rascunho, versao: r.versao, cbo: m.profissional }, ctx());
    expect(await g.lerRascunho(C, r.rascunho)).toMatchObject({ aberto: false, substituido: false });
    await expect(
      g.descartarRascunho(C, { rascunho: r.rascunho, versao: r.versao, cbo: m.profissional }, ctx()),
    ).rejects.toMatchObject({ problema: { codigo: 'rascunho-fechado' } });
    const n = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      l.uma(
        "SELECT COUNT(*) AS n FROM registro_assistencial_rascunho WHERE id = ? AND situacao = 'descartado'",
        [r.rascunho],
      ),
    );
    expect(Number(n?.['n'])).toBe(1);
  });

  it('rascunho importado (ADR 0006): como a carga grava, o autor vê as respostas e o lançamento de origem, continua e finaliza', async () => {
    // Como o conector grava: respostas '[]', origem 'migracao', sem conta do autor, iniciado_em da origem e as respostas
    // em edição na linha de inclusão da trilha do rascunho (lista JSON com as colunas da origem).
    const importar = async (itens: readonly Record<string, unknown>[]): Promise<number> =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
        const id = await e.inserir(
          `INSERT INTO registro_assistencial_rascunho (estabelecimento_id, paciente_id, atendimento_id,
             modelo_documento_clinico_id, autor_profissional_id, autor_usuario_id, data_hora_clinica, iniciado_em,
             respostas, situacao, origem, criado_em)
           VALUES (?, ?, ?, ?, ?, NULL, '2025-03-10 12:00:00.000', '2025-03-10 12:15:00.000', '[]', 'aberto',
             'migracao', UTC_TIMESTAMP(3))`,
          [m.estabelecimento, m.paciente, m.atendimento, m.modelo, m.profissional],
        );
        await e.inserir(
          `INSERT INTO trilha_auditoria (estabelecimento_id, ocorrido_em, acao, entidade, entidade_id, dados_depois,
             motivo, criado_em)
           VALUES (?, UTC_TIMESTAMP(3), 'inclusao', 'registro_assistencial_rascunho', ?, ?, ?, UTC_TIMESTAMP(3))`,
          [
            m.estabelecimento,
            id,
            JSON.stringify(itens),
            'respostas em edição do rascunho importado (sintético)',
          ],
        );
        return id;
      });
    const item = (codigo: string, v: Record<string, unknown>) => ({
      ID_RESPOSTA: codigo,
      SEQ: 1,
      ORDEM: null,
      TAB: null,
      RESPALFA: null,
      CONTEVOL: null,
      RESPVALOR: null,
      RESPDATA: null,
      RESPHORA: null,
      RESPSNAO: null,
      UNIDRESP: null,
      ID_HTCID: null,
      ID_HTPROCTO: null,
      OBSERVACAO: null,
      AUTOPREENCHIDO: 'N',
      JUSTIFICATIVA_DIAGNOSTICO: null,
      ...v,
    });
    const r1 = await importar([
      item(`o${m.campoMultipla}_2`, { RESPALFA: 'Enteral' }),
      item(`o${m.campoTexto}_9`, { CONTEVOL: 'Quadro importado sintético' }),
      item(`o${m.campoEscolha}_2`, {}),
    ]);
    const lido = await g.lerRascunho(C, r1);
    expect(lido?.rascunho).toMatchObject({ doNovo: false, cbo: m.profissional, respostas: 3 });
    // O lançamento é o de origem (iniciado_em), nunca o momento da carga.
    expect(lido?.rascunho.lancadoEm?.slice(0, 10)).toBe('2025-03-10');
    expect(lido?.linhas.map((l) => [l.ordem, l.idResposta, l.indice, l.alfa, l.texto])).toEqual([
      ['0101', m.campoTexto, null, null, 'Quadro importado sintético'],
      ['0102', DESLOCAMENTO_OPCAO + m.opcaoGrave, '2', null, null],
      ['0103', DESLOCAMENTO_OPCAO + m.opcaoEnteral, '1', 'Enteral', null],
    ]);
    const naLista = (await g.rascunhosDoPaciente(C, m.paciente, m.modelo)).find((x) => x.id === r1);
    expect(naLista).toMatchObject({ respostas: 3, lancadoEm: lido!.rascunho.lancadoEm });

    // O autor salva por cima com o que leu: a nova versão leva o conteúdo e o lançamento de origem; o importado
    // fica arquivado (nunca apagado).
    const doContrato = lido!.linhas.map(
      (l) => ({ ...l, procedimento: undefined, observacao: undefined }) as unknown as LinhaGravacao,
    );
    const r2 = await g.salvarRascunho(
      C,
      { ...base(), linhas: doContrato, rascunho: { id: r1, versao: lido!.rascunho.versao } },
      ctx(),
    );
    const lido2 = await g.lerRascunho(C, r2.rascunho);
    expect(lido2?.rascunho).toMatchObject({
      doNovo: true,
      respostas: 3,
      lancadoEm: lido!.rascunho.lancadoEm,
    });
    expect(lido2?.linhas.map((l) => l.texto)).toContain('Quadro importado sintético');
    const situacao = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      l.uma('SELECT situacao, excluido_em FROM registro_assistencial_rascunho WHERE id = ?', [r1]),
    );
    expect(situacao).toMatchObject({ situacao: 'arquivado', excluido_em: null });
    const { registro: id } = await g.registrar(
      C,
      { ...registro(), linhas: doContrato, rascunho: { id: r2.rascunho, versao: r2.versao } } as never,
      ctx(),
    );
    expect((await g.respostasRegistro(C, id)).map((l) => l.texto)).toContain('Quadro importado sintético');

    // Resposta que não acha campo na versão publicada: a edição é recusada (nunca o formulário vazio); a lista mostra
    // a contagem de origem e o autor ainda descarta.
    const r3 = await importar([item('sem-opcao-no-formulario', { RESPALFA: 'x' })]);
    await expect(g.lerRascunho(C, r3)).rejects.toMatchObject({
      problema: { codigo: 'rascunho-importado-ilegivel' },
    });
    expect((await g.rascunhosDoPaciente(C, m.paciente, m.modelo)).find((x) => x.id === r3)).toMatchObject({
      respostas: 1,
    });
    const v3 = (await g.rascunhosDoPaciente(C, m.paciente, m.modelo)).find((x) => x.id === r3)!.versao;
    await g.descartarRascunho(C, { rascunho: r3, versao: v3, cbo: m.profissional }, ctx());
    expect(await g.lerRascunho(C, r3)).toMatchObject({ aberto: false, substituido: false, linhas: [] });

    // Importado sem linha de carga: o rascunho de origem estava vazio de fato.
    const r4 = await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.inserir(
        `INSERT INTO registro_assistencial_rascunho (estabelecimento_id, paciente_id, atendimento_id,
           modelo_documento_clinico_id, autor_profissional_id, data_hora_clinica, respostas, situacao, origem, criado_em)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), '[]', 'aberto', 'migracao', UTC_TIMESTAMP(3))`,
        [m.estabelecimento, m.paciente, m.atendimento, m.modelo, m.profissional],
      ),
    );
    expect((await g.lerRascunho(C, r4))?.linhas).toEqual([]);
    const v4 = (await g.lerRascunho(C, r4))!.rascunho.versao;
    await g.descartarRascunho(C, { rascunho: r4, versao: v4, cbo: m.profissional }, ctx());
  });

  it('coassinatura (03-PEP L96): o registro do residente nasce aguardando o preceptor, com o pedido pendente na mesma transação', async () => {
    // Dois preceptores: um com vínculo vigente neste estabelecimento e cadastro de supervisão acadêmica do autor; outro
    // só com a conta ligada (sem vínculo aqui), que é recusado.
    const preceptorSintetico = (sufixo: string, noEstabelecimento: boolean) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preceptor-${sufixo}` }, async (e) => {
        const agora = new Date();
        const login = `${P}.prec${sufixo}`;
        const u =
          Number((await e.uma('SELECT id FROM usuario WHERE login = ?', [login]))?.['id'] ?? 0) ||
          (await e.inserir(
            "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
            [login, `Conta sintética ${login}`, agora],
          ));
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          `Pessoa sintética ${P} preceptor ${sufixo}`,
          agora,
        ]);
        const pr = await e.inserir(
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)",
          [pf, `massa ${P}`, agora],
        );
        await e.inserir(
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, pr, '2020-01-01', agora],
        );
        if (noEstabelecimento) {
          await e.inserir(
            `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
             VALUES (?, ?, ?, ?, ?)`,
            [u, m.estabelecimento, pr, '2020-01-01', agora],
          );
          await e.inserir(
            `INSERT INTO vinculo_supervisao_profissional (estabelecimento_id, supervisor_profissional_id,
               supervisionado_profissional_id, tipo_vinculo, vigencia_inicio, criado_em) VALUES (?, ?, ?, 'academico', ?, ?)`,
            [m.estabelecimento, pr, m.profissional, '2020-01-01', agora],
          );
        }
        return pr;
      });
    const preceptor = await preceptorSintetico('a', true);
    const semVinculoAqui = await preceptorSintetico('b', false);
    const { registro: id } = await g.registrar(
      C,
      { ...registro(), supervisao: { preceptor: 'PRECEPTOR', idProfissional: preceptor } } as never,
      ctx(),
    );
    const l = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (x) =>
      x.uma(
        `SELECT r.situacao AS sr, s.sequencia, s.situacao, s.tipo_vinculo, s.preceptor_profissional_id,
                s.supervisionado_profissional_id, s.solicitado_em
           FROM registro_assistencial r JOIN registro_assistencial_supervisao s ON s.registro_assistencial_id = r.id
          WHERE r.id = ?`,
        [id],
      ),
    );
    expect(l).toMatchObject({
      sr: 'aguardando_coassinatura',
      situacao: 'pendente',
      tipo_vinculo: 'academico',
    });
    expect(Number(l?.['sequencia'])).toBe(1);
    expect(Number(l?.['preceptor_profissional_id'])).toBe(preceptor);
    expect(Number(l?.['supervisionado_profissional_id'])).toBe(m.profissional);
    expect(l?.['solicitado_em']).not.toBeNull();
    // O autor como o próprio preceptor é recusado, sem nada gravado pela metade.
    const antes = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (x) =>
      x.uma('SELECT COUNT(*) AS n FROM registro_assistencial WHERE estabelecimento_id = ?', [
        m.estabelecimento,
      ]),
    );
    await expect(
      g.registrar(
        C,
        { ...registro(), supervisao: { preceptor: 'EU', idProfissional: m.profissional } } as never,
        ctx(),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'preceptor-e-autor' } });
    // O preceptor só com a conta ligada, sem vínculo vigente neste estabelecimento, é recusado sem gravar nada.
    await expect(
      g.registrar(
        C,
        { ...registro(), supervisao: { preceptor: 'FORA', idProfissional: semVinculoAqui } } as never,
        ctx(),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'preceptor-indisponivel' } });
    const depois = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (x) =>
      x.uma('SELECT COUNT(*) AS n FROM registro_assistencial WHERE estabelecimento_id = ?', [
        m.estabelecimento,
      ]),
    );
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  }, 60_000);

  it('suporte técnico: gravação e suspensão em sessão de suporte voltam como marcas na prova', async () => {
    const { registro: id } = await g.registrar(C, { ...registro(), comoSuporte: true } as never, ctx());
    expect((await g.prova(C, id)).comoSuporte).toEqual(['criado']);
    const marca = {
      sessao: `${P}-sessao`,
      acao: null,
      atorTipo: 'suporte' as const,
      idConta: '1',
      alvo: `${P}.medico`,
    };
    await executarComo(marca, () =>
      g.suspender(
        C,
        {
          registro: id,
          cbo: m.profissional,
          justificativa: 'Suspensão em sessão de suporte (teste)',
          documento: 'x'.repeat(20),
        },
        ctx({ reautenticadoEm: Date.now() }),
      ),
    );
    expect((await g.prova(C, id)).comoSuporte).toEqual(['criado', 'suspenso']);
    const { registro: outro } = await g.registrar(C, registro() as never, ctx());
    expect((await g.prova(C, outro)).comoSuporte).toEqual([]);
  }, 60_000);

  it('prova: alteração feita fora do sistema (resposta sem marca, resposta incluída, linha do registro) diverge', async () => {
    const alterado = `${HASH.slice(0, 63)}x`;
    const novo = async () => (await g.registrar(C, registro() as never, ctx())).registro;
    const [a, b, d] = [await novo(), await novo(), await novo()];
    for (const id of [a, b, d]) expect((await g.prova(C, id)).atual).toBe(HASH);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
      await e.executar(
        "UPDATE registro_assistencial_resposta SET valor_texto = 'Texto trocado fora' WHERE registro_assistencial_id = ? AND valor_texto IS NOT NULL",
        [a],
      );
      await e.executar(
        `INSERT INTO registro_assistencial_resposta (registro_assistencial_id, sequencia, modelo_campo_id, tipo_valor,
                valor_texto, criado_em, versao) VALUES (?, 99, ?, 'texto', 'Resposta incluída fora', UTC_TIMESTAMP(3), 1)`,
        [b, m.campoTexto],
      );
      await e.executar("UPDATE registro_assistencial SET texto_consolidado = 'Trocado fora' WHERE id = ?", [
        d,
      ]);
    });
    for (const id of [a, b, d]) expect((await g.prova(C, id)).atual).toBe(alterado);
  }, 60_000);

  it('leitura: campo excluído e opção desativada depois da gravação não somem do registro', async () => {
    const { registro: id } = await g.registrar(C, registro() as never, ctx());
    const antes = await g.respostasRegistro(C, id);
    expect(antes.length).toBe(3);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
      await e.executar('UPDATE modelo_campo_opcao SET ativo = FALSE WHERE id = ?', [m.opcaoGrave]);
      await e.executar('UPDATE modelo_campo SET excluido_em = UTC_TIMESTAMP(3) WHERE id = ?', [m.campoTexto]);
    });
    try {
      expect(await g.respostasRegistro(C, id)).toEqual(antes);
      expect((await g.ultimoRegistro(C, m.paciente, m.modelo))?.linhas).toEqual(antes);
      const hist = await g.historico(C, m.paciente, m.modelo, '0101');
      expect(hist[0]?.linhas.map((l) => l.texto)).toEqual(['Quadro sintético estável']);
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, async (e) => {
        await e.executar('UPDATE modelo_campo_opcao SET ativo = TRUE WHERE id = ?', [m.opcaoGrave]);
        await e.executar('UPDATE modelo_campo SET excluido_em = NULL WHERE id = ?', [m.campoTexto]);
      });
    }
  }, 60_000);

  it('rascunho regravado mantém o lançamento do primeiro da cadeia', async () => {
    const r1 = await g.salvarRascunho(C, { ...base(), linhas: linhas() }, ctx());
    const l1 = (await g.lerRascunho(C, r1.rascunho))?.rascunho.lancadoEm;
    await new Promise((ok) => setTimeout(ok, 1_100));
    const r2 = await g.salvarRascunho(
      C,
      { ...base(), linhas: linhas(), rascunho: { id: r1.rascunho, versao: r1.versao } },
      ctx(),
    );
    const r3 = await g.salvarRascunho(
      C,
      { ...base(), linhas: linhas(), rascunho: { id: r2.rascunho, versao: r2.versao } },
      ctx(),
    );
    expect(l1).toBeTruthy();
    expect((await g.lerRascunho(C, r2.rascunho))?.rascunho.lancadoEm).toBe(l1);
    expect((await g.lerRascunho(C, r3.rascunho))?.rascunho.lancadoEm).toBe(l1);
    expect(
      (await g.rascunhosDoPaciente(C, m.paciente, m.modelo)).find((x) => x.id === r3.rascunho)?.lancadoEm,
    ).toBe(l1);
    await g.descartarRascunho(C, { rascunho: r3.rascunho, versao: r3.versao, cbo: m.profissional }, ctx());
  }, 60_000);

  it('idempotência: a mesma chave repete o resultado; com outro conteúdo, 409 idempotencia-divergente', async () => {
    const k = ctx();
    const r1 = await g.registrar(C, registro() as never, k);
    expect((await g.registrar(C, registro() as never, k)).registro).toBe(r1.registro);
    const outras = linhas().map((l) => (l.ordem === '0101' ? { ...l, texto: 'Outro conteúdo' } : l));
    await expect(g.registrar(C, { ...registro(), linhas: outras } as never, k)).rejects.toMatchObject({
      problema: { codigo: 'idempotencia-divergente' },
    });
  }, 60_000);

  it('modelos de impressão: listas do cliente (fichas e relatórios ativos)', async () => {
    const x = await g.modelosImpressao(C);
    expect(Array.isArray(x.fichas) && Array.isArray(x.relatorios)).toBe(true);
  });

  function registro() {
    return {
      ...base(),
      toleranciaMin: 60,
      linhas: linhas(),
      rtf: '{\\rtf1 sintetico}',
      xml: '<registro/>',
      documento: '<documento/>',
      hashConteudo: HASH,
      representacao: { impressao: HASH, selo: '1', codigo: null, versaoLayout: 1, representacao: null },
    };
  }
});
