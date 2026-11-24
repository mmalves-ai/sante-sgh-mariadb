// Integração da porta própria dos documentos do prontuário contra o MariaDB real (cliente de teste f22_o4). Massa
// SINTÉTICA com códigos do lote (prefixo l24doc), garantida no beforeAll (cadastros reaproveitáveis) e com os
// documentos, eventos e registros do lote apagados no início e no fim; nenhum dado de pessoa real. A porta em si nunca
// apaga (registro clínico não é apagado); a limpeza é só da massa de teste. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaDocumentosPropria } from './documentos-porta-propria.js';
import { TITULO_DOCUMENTO_SGH } from './documentos-servico.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_DOCS']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l24doc';
const LOGIN = `${P}.medico`;
const OUTRO = `${P}.outro`;
/** Segunda conta do MESMO profissional no estabelecimento. */
const SEGUNDA = `${P}.medico2`;
const HASH = 'd'.repeat(64);
const CBO = '225125';

interface Ids {
  est: number;
  outroEst: number;
  usuario: number;
  outroUsuario: number;
  segundaConta: number;
  prof: number;
  paciente: number;
  atendimento: number;
  modelo: number;
  registro: number;
  registro2: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const x = await e.uma(sel, p);
  if (x) return Number(x['id']);
  return e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('PortaDocumentosPropria contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDocumentosPropria;
  const ids = {} as Ids;
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: ids.usuario,
    correlacao: `${P}-leitura`,
  });
  const G = (login = LOGIN) => ({
    ...C(),
    usuario: login === LOGIN ? ids.usuario : ids.outroUsuario,
    usuarioLogin: login,
    traceId: `${P}-grava`,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(
        `UPDATE registro_assistencial SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM documento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM registro_assistencial WHERE estabelecimento_id IN ${est}`, [P]);
    })();

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conferencia` }, async (l) =>
      Number((await l.uma(sql, p))?.['n'] ?? 0),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preparo` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const estab = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      ids.est = await estab(P);
      ids.outroEst = await estab(`${P}b`);
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      // CPFs sintéticos do lote (fora de qualquer faixa real usada nos clientes de teste).
      ids.usuario = await usuario(LOGIN, '24000000101');
      ids.outroUsuario = await usuario(OUTRO, '24000000102');
      ids.segundaConta = await usuario(SEGUNDA, '24000000103');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pessoaProf = await pessoa(`Pessoa sintética ${P} profissional`);
      const pessoaOutro = await pessoa(`Pessoa sintética ${P} outro`);
      const pessoaPac = await pessoa(`Pessoa sintética ${P} paciente`);
      const profissional = (pf: number) =>
        garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
          [pf, `massa ${P}`, agora],
        );
      ids.prof = await profissional(pessoaProf);
      const profOutro = await profissional(pessoaOutro);
      const ocupacao = await garantir(
        e,
        'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
        [CBO],
        'INSERT INTO ocupacao_cbo (codigo_cbo, descricao, criado_em) VALUES (?, ?, ?)',
        [CBO, 'Médico clínico (sintético)', agora],
      );
      const conselho = await garantir(
        e,
        'SELECT id FROM conselho_classe WHERE sigla = ? OR codigo_tiss = ? ORDER BY (sigla = ?) DESC LIMIT 1',
        ['LZDOC', 'Z8', 'LZDOC'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
        ['Z8', 'LZDOC', 'Conselho sintético do lote l24doc', agora],
      );
      const pais = await garantir(
        e,
        "SELECT id FROM pais_referencia WHERE codigo_iso = 'BR'",
        [],
        "INSERT INTO pais_referencia (codigo_iso, descricao, criado_em) VALUES ('BR', 'Brasil', ?)",
        [agora],
      );
      const uf = await garantir(
        e,
        "SELECT id FROM unidade_federativa WHERE sigla = 'RJ'",
        [],
        "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em) VALUES ('33', 'RJ', 'Rio de Janeiro', ?, ?)",
        [pais, agora],
      );
      for (const [prof, numero] of [
        [ids.prof, '240001'],
        [profOutro, '240002'],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
          [prof],
          `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
             numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, ?, ?, TRUE, ?)`,
          [prof, conselho, uf, numero, ocupacao, agora],
        );
      for (const [u, prof] of [
        [ids.usuario, ids.prof],
        [ids.outroUsuario, profOutro],
        [ids.segundaConta, ids.prof],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
          [u, ids.est],
          `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
             criado_em) VALUES (?, ?, ?, '2026-01-01', ?)`,
          [u, ids.est, prof, agora],
        );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac, 902_400_401, agora],
      );
      const tipo = await garantir(
        e,
        'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
        [`${P.toUpperCase()}_EVOL`],
        'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${P.toUpperCase()}_EVOL`, 'Evolução sintética', 'evolucao', agora],
      );
      for (const categoria of ['lancado', 'assinado'])
        await garantir(
          e,
          'SELECT id FROM situacao_documento_prontuario WHERE categoria = ? AND ativo = TRUE LIMIT 1',
          [categoria],
          'INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${categoria}`, `Situação sintética ${categoria}`, categoria, agora],
        );
      ids.modelo = await garantir(
        e,
        'SELECT id FROM modelo_documento_clinico WHERE codigo = ?',
        [`${P.toUpperCase()}_MOD`],
        `INSERT INTO modelo_documento_clinico (codigo, titulo, tipo_documento_clinico_id, tipo_registro, criado_em)
         VALUES (?, ?, ?, 'evolucao', ?)`,
        [`${P.toUpperCase()}_MOD`, 'Evolução sintética l24doc', tipo, agora],
      );
      const categoriaAt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}amb`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'ambulatorio', ?)",
        [`${P}amb`, 'Categoria sintética', agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        [`${P}c`],
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}fp`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [`${P}fp`, 'Fonte pagadora sintética', agora],
      );
      ids.atendimento = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, 'L24-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L24-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [
          ids.est,
          ids.paciente,
          categoriaAt,
          carater,
          fonte,
          ids.prof,
          new Date('2026-11-20T10:00:00Z'),
          agora,
        ],
      );
      const registro = (clinica: string) =>
        e.inserir(
          `INSERT INTO registro_assistencial (estabelecimento_id, paciente_id, atendimento_id, modelo_documento_clinico_id,
             autor_profissional_id, autor_usuario_id, data_hora_clinica, data_hora_lancamento, impressao_digital, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ids.est,
            ids.paciente,
            ids.atendimento,
            ids.modelo,
            ids.prof,
            ids.usuario,
            new Date(clinica),
            agora,
            HASH,
            agora,
          ],
        );
      ids.registro = await registro('2026-11-20T11:00:00Z');
      ids.registro2 = await registro('2026-11-20T12:00:00Z');
    });
    porta = new PortaDocumentosPropria(nucleo, CLIENTE);
  }, 180_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, limpar);
    await nucleo.encerrar();
  });

  it('profissional do login: vínculo vigente, inscrição com o CBO 2002 e a ocupação pelo id; login sem vínculo é null', async () => {
    const p = await porta.profissional(C(), LOGIN);
    expect(p).toMatchObject({
      idUsuario: ids.usuario,
      idProfissional: ids.prof,
      nome: `Pessoa sintética ${P} profissional`,
    });
    expect(p!.ocupacoes).toEqual([{ cbo: p!.cbo, codigo: CBO, conselhoAtivo: true }]);
    expect(await porta.ocupacaoDoCbo(C(), p!.cbo)).toBe(CBO);
    expect(await porta.profissional(C(), `${P}.inexistente`)).toBeNull();
    expect((await porta.nomes(C(), [ids.paciente])).get(ids.paciente)).toBe(`Pessoa sintética ${P} paciente`);
    expect(await porta.agora(C())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('emite o documento do registro clínico uma vez só, com evento de criação e o vínculo no registro', async () => {
    const r = { registro: ids.registro, paciente: ids.paciente, atendimento: ids.atendimento, hash: HASH };
    const id = await porta.documentoDoRegistroClinico(G(), r);
    expect(await porta.documentoDoRegistroClinico(G(), r)).toBe(id);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM documento_prontuario WHERE entidade_origem = ? AND entidade_origem_id = ?',
        ['registro_assistencial', ids.registro],
      ),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM documento_prontuario_evento WHERE documento_prontuario_id = ? AND acao = 'criacao'",
        [id],
      ),
    ).toBe(1);
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM registro_assistencial WHERE id = ? AND documento_prontuario_id = ?',
        [ids.registro, id],
      ),
    ).toBe(1);
    // Paciente diferente do registro: recusa, nada gravado.
    await expect(
      porta.documentoDoRegistroClinico(G(), {
        ...r,
        registro: ids.registro2,
        paciente: ids.paciente + 999_999,
      }),
    ).rejects.toMatchObject({
      problema: { status: 409 },
    });
    expect(
      await contar('SELECT COUNT(*) AS n FROM documento_prontuario WHERE entidade_origem_id = ?', [
        ids.registro2,
      ]),
    ).toBe(0);
    const d = await porta.documentoSgh(C(), id);
    // O tipo é o de negócio (pela origem), não o código do catálogo do cliente: o título é "Registro clínico".
    expect(TITULO_DOCUMENTO_SGH[d!.tipo]).toBe('Registro clínico');
    expect(d).toMatchObject({
      id,
      tipo: 'registro-clinico',
      origemTabela: 'registro_assistencial',
      origemId: ids.registro,
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      usuario: LOGIN,
      hash: HASH,
      nivel: 'sem-assinatura',
      assinadoEm: null,
      suspenso: false,
      comoSuporte: false,
    });
    expect((await porta.documentoSghDaOrigem(C(), 'registro_assistencial', ids.registro))?.id).toBe(id);
    expect((await porta.documentosSgh(C(), ids.paciente)).map((x) => x.id)).toContain(id);
    // Outro estabelecimento não vê o documento.
    expect(await porta.documentoSgh({ ...C(), hospital: `${P}b` }, id)).toBeNull();
  });

  it('assina pela fila do autor: recusa outro autor e conteúdo mudado; assinado sai da fila e não assina de novo', async () => {
    const id = await porta.documentoDoRegistroClinico(G(), {
      registro: ids.registro,
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      hash: HASH,
    });
    expect((await porta.pendencias(C(), LOGIN)).map((x) => x.id)).toContain(id);
    expect((await porta.pendencias(C(), OUTRO)).map((x) => x.id)).not.toContain(id);
    expect(await porta.assinar(G(OUTRO), [{ documento: id, hash: HASH }])).toEqual({
      assinados: [],
      recusados: [{ documento: id, motivo: 'Documento não encontrado entre as suas pendências.' }],
    });
    expect((await porta.assinar(G(), [{ documento: id, hash: 'e'.repeat(64) }])).recusados[0]?.motivo).toBe(
      'O conteúdo mudou desde a prévia.',
    );
    expect(await porta.assinar(G(), [{ documento: id, hash: HASH }])).toEqual({
      assinados: [id],
      recusados: [],
    });
    expect((await porta.assinar(G(), [{ documento: id, hash: HASH }])).recusados[0]?.motivo).toBe(
      'Já assinado.',
    );
    const d = await porta.documentoSgh(C(), id);
    expect(d?.assinadoEm).not.toBeNull();
    expect(d?.nivel).toBe('avancada-sessao');
    expect((await porta.pendencias(C(), LOGIN)).map((x) => x.id)).not.toContain(id);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM documento_prontuario_evento WHERE documento_prontuario_id = ? AND acao = 'assinatura'",
        [id],
      ),
    ).toBe(1);
  });

  it('autoria fixada no documento: outra conta do mesmo profissional não vê nem assina; vínculo vencido mantém autor e categoria', async () => {
    const id = await porta.documentoDoRegistroClinico(G(), {
      registro: ids.registro2,
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      hash: HASH,
    });
    const G2 = { ...G(), usuario: ids.segundaConta, usuarioLogin: SEGUNDA };
    // Fila e prévia usam o mesmo critério: a segunda conta não recebe o documento na fila nem assina.
    expect((await porta.pendencias(C(), SEGUNDA)).map((x) => x.id)).not.toContain(id);
    expect((await porta.assinar(G2, [{ documento: id, hash: HASH }])).assinados).toEqual([]);
    const vencer = (fim: string | null) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-vigencia` }, (e) =>
        e.executar(
          'UPDATE usuario_vinculo_profissional SET vigencia_fim = ? WHERE usuario_id = ? AND estabelecimento_id = ?',
          [fim, ids.usuario, ids.est],
        ),
      );
    await vencer('2026-01-01');
    try {
      // O autor do documento não se perde quando o vínculo vence (o sigilo da categoria não abre).
      expect((await porta.documentoSgh(C(), id))?.usuario).toBe(LOGIN);
      const p = await porta.profissional(C(), LOGIN);
      expect(p?.ocupacoes).toEqual([{ cbo: p!.cbo, codigo: CBO, conselhoAtivo: false }]);
    } finally {
      await vencer(null);
    }
    expect((await porta.pendencias(C(), LOGIN)).map((x) => x.id)).toContain(id);
  });

  it('paciente, atendimentos, retratos e linha do tempo do banco do cliente', async () => {
    const p = await porta.paciente(C(), ids.paciente);
    expect(p).toMatchObject({
      id: ids.paciente,
      nome: `Pessoa sintética ${P} paciente`,
      prontuario: 902_400_401,
      obito: null,
    });
    expect(await porta.paciente(C(), 2_000_000_000)).toBeNull();
    const ats = await porta.atendimentos(C(), ids.paciente);
    expect(ats).toEqual([
      {
        id: ids.atendimento,
        registro: 241,
        tipo: 'externo',
        entrada: '2026-11-20T07:00:00',
        alta: null,
        unidade: null,
        leito: null,
        convenio: 'Fonte pagadora sintética',
        medico: `Pessoa sintética ${P} profissional`,
      },
    ]);
    // Outro estabelecimento não vê os atendimentos.
    expect(await porta.atendimentos({ ...C(), hospital: `${P}b` }, ids.paciente)).toEqual([]);
    expect(await porta.retratos(C(), ids.atendimento, ids.paciente)).toEqual({
      htAtendimento: ids.atendimento,
      htPaciente: ids.paciente,
      doPaciente: true,
    });
    expect((await porta.retratos(C(), ids.atendimento, ids.paciente + 1))?.doPaciente).toBe(false);
    const evs = await porta.eventos(
      C(),
      ids.paciente,
      { de: '2026-11-20', ate: '2026-11-20' },
      new Set(['atendimento', 'registro']),
      50,
    );
    expect(evs.map((e) => [e.tipo, e.quando])).toEqual([
      ['registro', '2026-11-20T09:00:00'],
      ['registro', '2026-11-20T08:00:00'],
      ['atendimento', '2026-11-20T07:00:00'],
    ]);
    expect(evs[0]).toMatchObject({ cbo: null, documento: { tipo: 'registro', id: ids.registro2 } });
    // Fora do período e tipo não pedido: nada.
    expect(
      await porta.eventos(
        C(),
        ids.paciente,
        { de: '2026-11-21', ate: '2026-11-22' },
        new Set(['registro']),
        50,
      ),
    ).toEqual([]);
    expect(
      (
        await porta.eventos(
          C(),
          ids.paciente,
          { de: '2026-11-20', ate: '2026-11-20' },
          new Set(['atendimento']),
          50,
        )
      ).length,
    ).toBe(1);
  });

  it('impressão e segunda via contam vias e entram na cadeia; visualização não muda o documento', async () => {
    const id = (await porta.documentoSghDaOrigem(C(), 'registro_assistencial', ids.registro))!.id;
    const eventos = () =>
      contar('SELECT COUNT(*) AS n FROM documento_prontuario_evento WHERE documento_prontuario_id = ?', [id]);
    const antes = await eventos();
    await porta.registrarEventoDocumento(G(), { documento: id, tipo: 'impresso' });
    await porta.registrarEventoDocumento(G(), {
      documento: id,
      tipo: 'segunda-via',
      justificativa: 'Via extraviada',
    });
    await porta.registrarEventoDocumento(G(), { documento: id, tipo: 'visualizado' });
    expect(await eventos()).toBe(antes + 2);
    expect(await contar('SELECT vias_impressas AS n FROM documento_prontuario WHERE id = ?', [id])).toBe(2);
    // Nada apagado: o documento continua lá.
    expect(
      await contar('SELECT COUNT(*) AS n FROM documento_prontuario WHERE id = ? AND excluido_em IS NULL', [
        id,
      ]),
    ).toBe(1);
  });

  it('operação sem adaptador próprio (emitir documento) não é liberada', async () => {
    expect(await porta.podeGravar(C(), 'pep.emitirDocumento', LOGIN)).toMatchObject({
      pode: false,
      codigo: 'pendente-modelo-proprio',
    });
  });
});
