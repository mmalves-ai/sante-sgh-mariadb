// Integração da família pep-resto2 (documentos-propria-operacoes-2.ts) contra o MariaDB do cliente de teste: anexar
// documento (arquivo no disco pela porta de armazenamento, numa raiz temporária; metadado em arquivo e anexo_prontuario)
// e pedir exames (requisição por setor executante + itens). Mesmo preparo sintético da família pep-resto (prefixo l93pr);
// a limpeza apaga só as linhas deste teste. Nenhum dado real.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmazemArquivosLocal, ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { operacoesDocumentosPropria2 } from './documentos-propria-operacoes-2.js';
import { dataHora, fusoValido } from './registro-porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_DOCS_RESTO']?.trim() || 'f22_o4';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l93pr';
const LOGIN = `${P}.medico`;
const CBO = '225125';
const HASH = 'b'.repeat(64);
const DOC = 'x'.repeat(60);

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const x = await e.uma(sel, p);
  if (x) return Number(x['id']);
  return e.inserir(ins, pi);
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem-erro';
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema.codigo) : String(e);
  }
}

describe.skipIf(SEM_BANCO)('documentos-propria-operacoes-2 contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  const ids = {
    est: 0,
    usuario: 0,
    prof: 0,
    inscricao: 0,
    paciente: 0,
    atendimento: 0,
    paciente2: 0,
    atendimento2: 0,
    alergeno: 0,
    principio: 0,
  };
  let fuso = 'America/Sao_Paulo';
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: ids.usuario,
    correlacao: `${P}-op`,
  });
  const ctx = (n: string) => ({
    cliente: CLIENTE,
    estabelecimento: ids.est,
    usuario: ids.usuario,
    correlacao: `${P}-${n}`,
    chaveIdempotencia: `${P}:${randomUUID()}`,
  });
  let raiz = '';
  let armazem: ArmazemArquivosLocal;
  const ops = () => operacoesDocumentosPropria2(nucleo, CLIENTE, armazem);
  const ex = { setorA: 0, setorB: 0, exA: 0, exB: 0, exInativo: 0, tipoAnexo: 0 };
  const agoraLocal = (minutos = 0) =>
    (dataHora(new Date(Date.now() + minutos * 60_000), fuso) ?? '').slice(0, 16);
  const uma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) => l.uma(sql, p));

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
      await e.executar(
        `DELETE ei FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE r.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN ${est}`, [P]);
      const arqs = await e.consultar(
        `SELECT arquivo_id FROM anexo_prontuario WHERE estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM anexo_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      for (const a of arqs) await e.executar('DELETE FROM arquivo WHERE id = ?', [a['arquivo_id']]);
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(
        `UPDATE documento_emitido SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(
        `UPDATE sumario_alta SET documento_prontuario_id = NULL WHERE estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM documento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE pp FROM alergia_paciente_principio pp JOIN alergia_paciente a ON a.id = pp.alergia_paciente_id
          WHERE a.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(
        `DELETE v FROM documento_emitido_versao v JOIN documento_emitido d ON d.id = v.documento_emitido_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      for (const t of [
        'alergia_paciente',
        'documento_emitido',
        'receita_medica',
        'exame_lancado_prontuario',
        'sumario_alta',
      ])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id IN ${est}`, [P]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preparo` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [P],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      fuso = fusoValido(
        (await e.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [ids.est]))?.['fuso_horario'],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
        [LOGIN, `Conta sintética ${LOGIN}`, '24000093101', agora],
      );
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const pessoaProf = await pessoa(`PESSOA SINTETICA ${P} PROFISSIONAL`);
      const pessoaPac = await pessoa(`PESSOA SINTETICA ${P} PACIENTE`);
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', ?, ?)",
        [pessoaProf, `massa ${P}`, agora],
      );
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
        ['LZNOVTRES', 'Z3', 'LZNOVTRES'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em) VALUES (?, ?, ?, ?)',
        ['Z3', 'LZNOVTRES', 'Conselho sintético do lote l93pr', agora],
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
      ids.inscricao = await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [ids.prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, ocupacao_cbo_id, principal, criado_em) VALUES (?, 1, ?, ?, '930001', ?, TRUE, ?)`,
        [ids.prof, conselho, uf, ocupacao, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
        [ids.usuario, ids.est],
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
           criado_em) VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.prof, agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac, 902_493_001, agora],
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
        [ids.est, 'L93-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L93-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
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
      // Segundo paciente com o próprio atendimento: o mesmo PDF anexado aos dois.
      const pessoaPac2 = await pessoa(`PESSOA SINTETICA ${P} PACIENTE 2`);
      ids.paciente2 = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPac2],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoaPac2, 902_493_002, agora],
      );
      ids.atendimento2 = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, 'L93-2'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L93-2', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
        [ids.est, ids.paciente2, categoriaAt, carater, fonte, ids.prof, new Date('2026-11-20T10:00:00Z'), agora],
      );
      await garantir(
        e,
        'SELECT id FROM tipo_receita WHERE codigo = ?',
        [`${P}simples`],
        'INSERT INTO tipo_receita (codigo, descricao, padrao, validade_dias, criado_em) VALUES (?, ?, TRUE, 30, ?)',
        [`${P}simples`, 'Receita simples sintética', agora],
      );
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'receita_medica' AND estabelecimento_id = ?",
        [ids.est],
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, criado_em) VALUES (?, 'receita_medica', 'RX-', 1, ?)",
        [ids.est, agora],
      );
      for (const cat of ['outro', 'receita', 'atestado', 'declaracao', 'sumario', 'laudo'])
        await garantir(
          e,
          'SELECT id FROM tipo_documento_clinico WHERE codigo = ?',
          [`${P}${cat}`],
          'INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}${cat}`, `Tipo sintético ${cat}`, cat, agora],
        );
      await garantir(
        e,
        "SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE LIMIT 1",
        [],
        'INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}lanc`, 'Lançado (sintético)', 'lancado', agora],
      );
      ids.alergeno = await garantir(
        e,
        'SELECT id FROM alergeno WHERE codigo = ?',
        [`${P}ag`],
        "INSERT INTO alergeno (codigo, descricao, natureza, criado_em) VALUES (?, 'Agente sintético', 'medicamento', ?)",
        [`${P}ag`, agora],
      );
      ids.principio = await garantir(
        e,
        'SELECT id FROM principio_ativo WHERE codigo_dcb = ?',
        [`${P}pa`],
        "INSERT INTO principio_ativo (codigo_dcb, descricao, versao_fonte, criado_em) VALUES (?, 'Princípio sintético', 'teste', ?)",
        [`${P}pa`, agora],
      );
      ex.tipoAnexo = await garantir(
        e,
        'SELECT id FROM tipo_anexo WHERE codigo = ?',
        [`${P}anx`],
        "INSERT INTO tipo_anexo (codigo, descricao, finalidade, criado_em) VALUES (?, 'Anexo sintético', 'outro', ?)",
        [`${P}anx`, agora],
      );
      const setor = (s: string, tipo: string) =>
        garantir(
          e,
          'SELECT id FROM setor_diagnostico WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, `${P}${s}`],
          'INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [ids.est, `${P}${s}`, `Setor sintético ${s}`, tipo, agora],
        );
      ex.setorA = await setor('lab', 'laboratorio');
      ex.setorB = await setor('ecg', 'metodos_graficos');
      const exame = (s: string, servico: string, ativo: boolean) =>
        garantir(
          e,
          'SELECT id FROM exame WHERE codigo = ?',
          [`${P}${s}`],
          'INSERT INTO exame (codigo, sigla, nome, tipo_servico, ativo, desativado_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [`${P}${s}`, s.toUpperCase().slice(0, 10), `Exame sintético ${s}`, servico, ativo, ativo ? null : agora, agora],
        );
      ex.exA = await exame('hb', 'laboratorio', true);
      ex.exB = await exame('ecg', 'metodo_grafico', true);
      ex.exInativo = await exame('old', 'laboratorio', false);
      for (const [exm, st] of [
        [ex.exA, ex.setorA],
        [ex.exB, ex.setorB],
        [ex.exInativo, ex.setorA],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM exame_setor_executante WHERE exame_id = ? AND setor_diagnostico_id = ?',
          [exm, st],
          'INSERT INTO exame_setor_executante (exame_id, setor_diagnostico_id, padrao, criado_em) VALUES (?, ?, TRUE, ?)',
          [exm, st, agora],
        );
      await garantir(
        e,
        "SELECT id FROM sequencia_negocio WHERE tipo = 'requisicao_exame' AND estabelecimento_id = ?",
        [ids.est],
        "INSERT INTO sequencia_negocio (estabelecimento_id, tipo, prefixo, proximo_valor, criado_em) VALUES (?, 'requisicao_exame', 'RQ-', 1, ?)",
        [ids.est, agora],
      );
    });
    raiz = await mkdtemp(join(tmpdir(), 'sgh-pep-anexo-'));
    armazem = new ArmazemArquivosLocal({
      raiz,
      executor: nucleo.criarExecutor(),
      ler: (c, fn) => nucleo.lerSomente(c, fn),
      bancoDoCliente: async (c) => (await nucleo.cliente(c)).banco,
    });
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, (e) => limpar(e));
      await nucleo.encerrar();
    }
    if (raiz) await rm(raiz, { recursive: true, force: true });
  });

  const baseDoc = () => ({
    paciente: ids.paciente,
    atendimento: ids.atendimento,
    cbo: ids.inscricao,
    retratos: { htAtendimento: ids.atendimento, htPaciente: ids.paciente },
    dataHoraClinica: agoraLocal(),
    documento: DOC,
    hashConteudo: HASH,
  });
  const PDF = (marca: string) => Buffer.from(`%PDF-1.4\n% sintetico ${marca} ${randomUUID()}\n%%EOF`).toString('base64');
  // O anexo não leva o documento formatado (esquema da memória): só o resumo.
  const anexo = (marca: string, extra: Record<string, unknown> = {}) => ({
    ...Object.fromEntries(Object.entries(baseDoc()).filter(([k]) => k !== 'documento')),
    nome: `Exame externo ${marca}`,
    estacao: 'Estacao sintetica',
    conteudo: PDF(marca),
    ...extra,
  });

  it('anexar: o PDF vai ao disco (registro em arquivo, imutável e com guarda legal) e o metadado ao anexo', async () => {
    const r = await ops()['pep.anexarDocumento']!(C(), anexo('a1', { tipoAnexo: ex.tipoAnexo }), ctx('an1'));
    expect(r).toMatchObject({ trilha: null });
    expect(r['anexo']).toBe(r['origem']);
    const l = await uma(
      `SELECT ap.tipo_anexo_id, ap.situacao, ap.canal_entrada, ap.importado_profissional_id, a.finalidade, a.tipo_mime,
              a.imutavel, a.retencao_ate IS NOT NULL AS guarda, a.entidade, d.entidade_origem, d.id AS doc
         FROM anexo_prontuario ap JOIN arquivo a ON a.id = ap.arquivo_id
         JOIN documento_prontuario d ON d.entidade_origem = 'anexo_prontuario' AND d.entidade_origem_id = ap.id
        WHERE ap.id = ?`,
      [r['anexo']],
    );
    expect(l).toMatchObject({
      tipo_anexo_id: ex.tipoAnexo,
      situacao: 'ativo',
      canal_entrada: 'upload',
      importado_profissional_id: ids.prof,
      finalidade: 'anexo',
      tipo_mime: 'application/pdf',
      entidade: 'anexo_prontuario',
      entidade_origem: 'anexo_prontuario',
    });
    expect(Number(l?.['imutavel'])).toBe(1);
    expect(Number(l?.['guarda'])).toBe(1);
    expect(Number(l?.['doc'])).toBe(r['documento']);
    const arq = await uma('SELECT arquivo_id FROM anexo_prontuario WHERE id = ?', [r['anexo']]);
    const lido = await armazem.ler({ cliente: CLIENTE, correlacao: `${P}-ler` }, Number(arq?.['arquivo_id']));
    expect(lido.conteudo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('anexar: sem tipo usa o tipo ativo do cliente; não-PDF e tipo inexistente recusam', async () => {
    const r = await ops()['pep.anexarDocumento']!(C(), anexo('a2'), ctx('an2'));
    expect(Number(r['anexo'])).toBeGreaterThan(0);
    expect(
      await codigo(
        ops()['pep.anexarDocumento']!(C(), anexo('a3', { conteudo: Buffer.from('texto sintetico').toString('base64') }), ctx('an3')),
      ),
    ).toBe('arquivo-invalido');
    expect(
      await codigo(ops()['pep.anexarDocumento']!(C(), anexo('a4', { tipoAnexo: 999_999_999 }), ctx('an4'))),
    ).toBe('entrada-invalida');
    expect(
      await codigo(operacoesDocumentosPropria2(nucleo, CLIENTE, null)['pep.anexarDocumento']!(C(), anexo('a7'), ctx('an7'))),
    ).toBe('armazenamento-indisponivel');
  });

  it('anexar: o mesmo PDF vai a dois pacientes (como a memória): dois anexos, o registro do arquivo reaproveitado', async () => {
    const mesmo = anexo('a5');
    const r1 = await ops()['pep.anexarDocumento']!(C(), mesmo, ctx('an5'));
    const r2 = await ops()['pep.anexarDocumento']!(
      C(),
      {
        ...mesmo,
        paciente: ids.paciente2,
        atendimento: ids.atendimento2,
        retratos: { htAtendimento: ids.atendimento2, htPaciente: ids.paciente2 },
      },
      ctx('an6'),
    );
    const r3 = await ops()['pep.anexarDocumento']!(C(), mesmo, ctx('an6b'));
    expect(new Set([r1['anexo'], r2['anexo'], r3['anexo']]).size).toBe(3);
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) =>
      l.consultar('SELECT id, paciente_id, arquivo_id FROM anexo_prontuario WHERE id IN (?, ?, ?) ORDER BY id', [
        r1['anexo'],
        r2['anexo'],
        r3['anexo'],
      ]),
    );
    expect(linhas.map((x) => Number(x['paciente_id']))).toEqual([ids.paciente, ids.paciente2, ids.paciente]);
    expect(new Set(linhas.map((x) => Number(x['arquivo_id']))).size).toBe(1);
  });

  it('anexar: chave da requisição de 80 caracteres (o máximo do formato) grava o arquivo e o anexo', async () => {
    const chave = `${P}:${randomUUID()}:${'k'.repeat(80)}`.slice(0, 80);
    expect(chave).toHaveLength(80);
    const r = await ops()['pep.anexarDocumento']!(C(), anexo('a8'), { ...ctx('an8'), chaveIdempotencia: chave });
    expect(Number(r['anexo'])).toBeGreaterThan(0);
  });

  it('pedir exames: uma requisição por setor executante, itens na ordem e documento do prontuário', async () => {
    const r = await ops()['pep.solicitarExame']!(
      C(),
      {
        ...baseDoc(),
        itens: [
          { exame: ex.exA, urgente: false, indicacao: 'Controle sintetico' },
          { exame: ex.exB, urgente: true },
        ],
      },
      ctx('ex1'),
    );
    expect(r).toMatchObject({ exames: 2, trilha: null });
    expect(r['agrupamento']).toBe(r['documentoTrilha']);
    const reqs = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conf` }, (l) =>
      l.consultar(
        `SELECT r.id, r.numero, r.setor_diagnostico_id, r.prioridade, r.situacao, r.solicitante_profissional_id,
                COUNT(ei.id) AS itens, MIN(ei.situacao) AS sit_item
           FROM requisicao_exame r JOIN exame_item ei ON ei.requisicao_exame_id = r.id
          WHERE r.paciente_id = ? AND r.estabelecimento_id = ? AND r.id >= ?
          GROUP BY r.id ORDER BY r.id`,
        [ids.paciente, ids.est, r['agrupamento']],
      ),
    );
    expect(reqs.map((x) => [Number(x['setor_diagnostico_id']), x['prioridade'], Number(x['itens'])])).toEqual([
      [ex.setorA, 'rotina', 1],
      [ex.setorB, 'urgente', 1],
    ]);
    expect(reqs.every((x) => x['situacao'] === 'solicitada' && x['sit_item'] === 'solicitado')).toBe(true);
    expect(reqs.every((x) => Number(x['solicitante_profissional_id']) === ids.prof)).toBe(true);
    expect(String(reqs[0]?.['numero'])).toMatch(/^RQ-/);
    const d = await uma(
      "SELECT id FROM documento_prontuario WHERE entidade_origem = 'requisicao_exame' AND entidade_origem_id = ?",
      [r['agrupamento']],
    );
    expect(Number(d?.['id'])).toBe(r['documento']);
  });

  it('pedir exames: exame inativo recusa e nada é gravado', async () => {
    const antes = await uma('SELECT COUNT(*) AS n FROM requisicao_exame WHERE estabelecimento_id = ?', [ids.est]);
    expect(
      await codigo(
        ops()['pep.solicitarExame']!(
          C(),
          { ...baseDoc(), itens: [{ exame: ex.exA, urgente: false }, { exame: ex.exInativo, urgente: false }] },
          ctx('ex2'),
        ),
      ),
    ).toBe('exame-inativo');
    const depois = await uma('SELECT COUNT(*) AS n FROM requisicao_exame WHERE estabelecimento_id = ?', [ids.est]);
    expect(Number(depois?.['n'])).toBe(Number(antes?.['n']));
  });
});
