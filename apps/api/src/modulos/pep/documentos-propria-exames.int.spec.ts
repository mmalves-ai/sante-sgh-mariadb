// Integração da família exames, anexos e termo de consentimento da porta própria dos documentos contra o MariaDB real
// (cliente de teste f22_o5). Massa SINTÉTICA com códigos do lote (prefixo l97ex): cadastros garantidos (reaproveitáveis;
// o estabelecimento e os usuários ficam, a trilha os referencia) e as linhas do lote apagadas no início e no fim. A
// porta nunca apaga (registro clínico não é apagado); a limpeza é só da massa de teste. A migração 06_PEP/97_exames
// (idempotente) é aplicada no beforeAll. O anexo passa pela porta de armazenamento real (disco, pasta temporária).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type ArmazemArquivosLocal, criarArmazemLocal, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentosPropriaExames } from './documentos-propria-exames.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE_EXAMES']?.trim() || 'f22_o5';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const P = 'l97ex';
const PM = P.toUpperCase();
const LOGIN = `${P}.medico`;
const SEM_VINCULO = `${P}.semvinculo`;
const CBO = '225125';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const x = await e.uma(sel, p);
  if (x) return Number(x['id']);
  return e.inserir(ins, pi);
}

interface Ids {
  est: number;
  usuario: number;
  prof: number;
  inscricao: number;
  paciente: number;
  atendimento: number;
  exameLab: number;
  exameImg: number;
  exameInativo: number;
  exameNaoPedivel: number;
  kit: number;
  tipoAnexo: number;
  modeloVigente: number;
  requisicao: number;
  itemLiberado: number;
}

describe.skipIf(SEM_BANCO)('DocumentosPropriaExames contra o MariaDB (cliente f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: DocumentosPropriaExames;
  let armazem: ArmazemArquivosLocal;
  let pasta: string;
  const ids = {} as Ids;
  const C = () => ({
    rede: 'rede-sintetica',
    hospital: P,
    cliente: CLIENTE,
    estabelecimento: null,
    usuario: ids.usuario,
    correlacao: `${P}-leitura`,
  });
  const G = (login = LOGIN) => ({ ...C(), usuarioLogin: login, traceId: `${P}-grava` });

  const limpar = (e: Escritor) =>
    (async () => {
      const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
      await e.executar(
        `DELETE FROM termo_consentimento_paciente WHERE estabelecimento_id IN ${est} ORDER BY id DESC`,
        [P],
      );
      await e.executar(
        `DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id
          WHERE d.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM documento_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      const itens = `(SELECT ei.id FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
                       WHERE r.estabelecimento_id IN ${est})`;
      await e.executar(
        `DELETE ra FROM resultado_analito ra JOIN resultado_exame re ON re.id = ra.resultado_exame_id
          WHERE re.exame_item_id IN ${itens}`,
        [P],
      );
      await e.executar(`DELETE FROM resultado_exame WHERE exame_item_id IN ${itens}`, [P]);
      await e.executar(
        `DELETE ei FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE r.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM requisicao_exame WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(
        `DELETE v FROM exame_lancado_valor v JOIN exame_lancado_prontuario x ON x.id = v.exame_lancado_prontuario_id
          WHERE x.estabelecimento_id IN ${est}`,
        [P],
      );
      await e.executar(`DELETE FROM exame_lancado_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM anexo_prontuario WHERE estabelecimento_id IN ${est}`, [P]);
      await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN ${est} AND finalidade = 'anexo'`, [
        P,
      ]);
    })();

  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-conferencia` }, async (l) =>
      Number((await l.uma(sql, p))?.['n'] ?? 0),
    );

  beforeAll(async () => {
    const banco = `cliente_${CLIENTE}`;
    for (const arq of ['97_exames_tabelas.sql', '97_exames_chaves.sql'])
      execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [banco], {
        input: readFileSync(resolve(RAIZ, 'db/migracoes/06_PEP', arq), 'utf8'),
        encoding: 'utf8',
      });
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(banco);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-preparo` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const g = (tabela: string, chave: string, valor: unknown, colunas: string[], valores: unknown[]) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE ${chave} = ?`,
          [valor],
          `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`,
          valores,
        );
      ids.est = await g(
        'estabelecimento',
        'codigo',
        P,
        ['codigo', 'nome_fantasia', 'razao_social', 'criado_em'],
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      ids.usuario = await g(
        'usuario',
        'login',
        LOGIN,
        ['login', 'nome', 'cpf', 'criado_em'],
        [LOGIN, `Conta sintética ${LOGIN}`, '97000000101', agora],
      );
      await g(
        'usuario',
        'login',
        SEM_VINCULO,
        ['login', 'nome', 'cpf', 'criado_em'],
        [SEM_VINCULO, `Conta sintética ${SEM_VINCULO}`, '97000000102', agora],
      );
      const pessoa = (nome: string) => g('pessoa_fisica', 'nome', nome, ['nome', 'criado_em'], [nome, agora]);
      const pessoaProf = await pessoa(`Pessoa sintética ${P} profissional`);
      const pessoaPac = await pessoa(`Pessoa sintética ${P} paciente`);
      ids.prof = await g(
        'profissional',
        'pessoa_fisica_id',
        pessoaProf,
        ['pessoa_fisica_id', 'tipo', 'observacao', 'criado_em'],
        [pessoaProf, 'assistencial', `massa ${P}`, agora],
      );
      const ocupacao = await g(
        'ocupacao_cbo',
        'codigo_cbo',
        CBO,
        ['codigo_cbo', 'descricao', 'criado_em'],
        [CBO, 'Médico clínico (sintético)', agora],
      );
      const conselho = await g(
        'conselho_classe',
        'sigla',
        'LZEXA',
        ['codigo_tiss', 'sigla', 'descricao', 'criado_em'],
        ['Z7', 'LZEXA', 'Conselho sintético do lote l97ex', agora],
      );
      const pais = await g(
        'pais_referencia',
        'codigo_iso',
        'BR',
        ['codigo_iso', 'descricao', 'criado_em'],
        ['BR', 'Brasil', agora],
      );
      const uf = await g(
        'unidade_federativa',
        'sigla',
        'RJ',
        ['codigo_ibge', 'sigla', 'descricao', 'pais_referencia_id', 'criado_em'],
        ['33', 'RJ', 'Rio de Janeiro', pais, agora],
      );
      ids.inscricao = await g(
        'inscricao_conselho',
        'profissional_id',
        ids.prof,
        [
          'profissional_id',
          'sequencia',
          'conselho_classe_id',
          'unidade_federativa_id',
          'numero_inscricao',
          'ocupacao_cbo_id',
          'principal',
          'criado_em',
        ],
        [ids.prof, 1, conselho, uf, '970001', ocupacao, true, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
        [ids.usuario, ids.est],
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
           criado_em) VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.prof, agora],
      );
      ids.paciente = await g(
        'paciente',
        'pessoa_fisica_id',
        pessoaPac,
        ['pessoa_fisica_id', 'numero_prontuario', 'criado_em'],
        [pessoaPac, 909_700_401, agora],
      );
      const categoriaAt = await g(
        'categoria_atendimento',
        'codigo',
        `${P}amb`,
        ['codigo', 'descricao', 'tipo_base', 'criado_em'],
        [`${P}amb`, 'Categoria sintética', 'ambulatorio', agora],
      );
      const carater = await g(
        'carater_atendimento_tiss',
        'codigo_tiss',
        `${P}c`,
        ['codigo_tiss', 'descricao', 'versao_fonte', 'criado_em'],
        [`${P}c`, 'Caráter sintético', 'teste', agora],
      );
      const fonte = await g(
        'fonte_pagadora',
        'codigo',
        `${P}fp`,
        ['codigo', 'nome', 'tipo', 'criado_em'],
        [`${P}fp`, 'Fonte pagadora sintética', 'particular', agora],
      );
      ids.atendimento = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, 'L97-1'],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em, situacao)
         VALUES (?, 'L97-1', ?, ?, ?, ?, ?, ?, ?, 'aberto')`,
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
      // Catálogos do documento e do termo.
      await garantir(
        e,
        "SELECT id FROM situacao_documento_prontuario WHERE categoria = 'lancado' AND ativo = TRUE LIMIT 1",
        [],
        'INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}-lancado`, 'Situação sintética lançado', 'lancado', agora],
      );
      await g(
        'tipo_documento_clinico',
        'codigo',
        `${PM}_TERMO`,
        ['codigo', 'descricao', 'categoria', 'criado_em'],
        [`${PM}_TERMO`, 'Termo sintético', 'termo', agora],
      );
      for (const etapa of ['emitido', 'assinado', 'revogado'])
        await garantir(
          e,
          'SELECT id FROM situacao_termo_consentimento WHERE etapa = ? AND ativo = TRUE LIMIT 1',
          [etapa],
          'INSERT INTO situacao_termo_consentimento (codigo, descricao, etapa, criado_em) VALUES (?, ?, ?, ?)',
          [`${P}-${etapa}`, `Situação sintética ${etapa}`, etapa, agora],
        );
      const modelo = (codigo: string, titulo: string, inicio: string, fim: string | null) =>
        g(
          'termo_consentimento_modelo',
          'codigo',
          codigo,
          [
            'estabelecimento_id',
            'codigo',
            'titulo',
            'texto_simples',
            'vigencia_inicio',
            'vigencia_fim',
            'criado_em',
          ],
          [ids.est, codigo, titulo, 'Texto sintético do termo.', inicio, fim, agora],
        );
      ids.modeloVigente = await modelo(`${PM}_CIR`, `${PM} termo cirúrgico`, '2026-01-01', null);
      await modelo(`${PM}_VENC`, `${PM} termo vencido`, '2025-01-01', '2025-12-31');
      // Catálogo de exames.
      const sexoF = Number(
        (await e.uma("SELECT id FROM sexo WHERE sigla = 'F' OR codigo = 'F' LIMIT 1"))?.['id'],
      );
      const exame = (codigo: string, nome: string, tipo: string, extra: Record<string, unknown>) =>
        g(
          'exame',
          'codigo',
          codigo,
          ['codigo', 'sigla', 'nome', 'tipo_servico', 'criado_em', ...Object.keys(extra)],
          [codigo, codigo.slice(-10), nome, tipo, agora, ...Object.values(extra)],
        );
      ids.exameLab = await exame(`${PM}K`, `${PM} POTÁSSIO`, 'laboratorio', {
        idade_maxima_dias: 36525,
        sexo_id: Number.isFinite(sexoF) ? sexoF : null,
      });
      const modalidade = await e.uma('SELECT id FROM modalidade_imagem LIMIT 1');
      ids.exameImg = await exame(
        `${PM}RX`,
        `${PM} RADIOGRAFIA`,
        modalidade ? 'imagem' : 'outro',
        modalidade ? { modalidade_imagem_id: modalidade['id'] } : {},
      );
      ids.exameInativo = await exame(`${PM}INA`, `${PM} INATIVO`, 'laboratorio', {
        ativo: false,
        desativado_em: agora,
      });
      ids.exameNaoPedivel = await exame(`${PM}NP`, `${PM} SÓ DO SETOR`, 'laboratorio', {
        solicitavel_prontuario: false,
      });
      ids.kit = await g(
        'kit_exame',
        'codigo',
        `${PM}KIT`,
        ['codigo', 'nome', 'criado_em'],
        [`${PM}KIT`, `${PM} ROTINA`, agora],
      );
      for (const [seq, ex] of [
        [1, ids.exameLab],
        [2, ids.exameImg],
      ] as const)
        await garantir(
          e,
          'SELECT id FROM kit_exame_item WHERE kit_exame_id = ? AND sequencia = ?',
          [ids.kit, seq],
          'INSERT INTO kit_exame_item (kit_exame_id, sequencia, exame_id, criado_em) VALUES (?, ?, ?, ?)',
          [ids.kit, seq, ex, agora],
        );
      const setor = await garantir(
        e,
        'SELECT id FROM setor_diagnostico WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}lab`],
        "INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'laboratorio', ?)",
        [ids.est, `${P}lab`, 'Laboratório sintético', agora],
      );
      const analito = await g(
        'analito',
        'codigo',
        `${PM}K`,
        ['codigo', 'nome', 'criado_em'],
        [`${PM}K`, 'POTASSIO', agora],
      );
      const unidade = await g(
        'unidade_resultado',
        'codigo',
        `${P}meq`,
        ['codigo', 'descricao', 'simbolo', 'criado_em'],
        [`${P}meq`, 'Miliequivalente por litro', 'mEq/L', agora],
      );
      ids.tipoAnexo = await g(
        'tipo_anexo',
        'codigo',
        `${PM}EXT`,
        ['codigo', 'descricao', 'criado_em'],
        [`${PM}EXT`, `${PM} EXAME EXTERNO`, agora],
      );
      // Pedido: dois itens válidos (um liberado com resultado) e um cancelado.
      ids.requisicao = await e.inserir(
        `INSERT INTO requisicao_exame (estabelecimento_id, numero, paciente_id, atendimento_id, solicitante_profissional_id,
           fonte_pagadora_id, prioridade, solicitado_em, indicacao_clinica, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'urgente', ?, ?, ?)`,
        [
          ids.est,
          `${P}-1`,
          ids.paciente,
          ids.atendimento,
          ids.prof,
          fonte,
          new Date('2026-11-20T11:00:00Z'),
          'Controle sintético',
          agora,
        ],
      );
      const motivo = await e.uma('SELECT id FROM motivo_cancelamento_item_exame LIMIT 1');
      const item = (seq: number, ex: number, situacao: string, extra: Record<string, unknown> = {}) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, situacao, criado_em${Object.keys(
            extra,
          )
            .map((k) => `, ${k}`)
            .join('')}) VALUES (?, ?, ?, ?, ?${Object.keys(extra)
            .map(() => ', ?')
            .join('')})`,
          [ids.requisicao, seq, ex, situacao, agora, ...Object.values(extra)],
        );
      ids.itemLiberado = await item(1, ids.exameLab, 'liberado', {
        liberado_em: new Date('2026-11-20T15:00:00Z'),
      });
      await item(2, ids.exameImg, 'solicitado');
      if (motivo)
        await item(3, ids.exameLab, 'cancelado', {
          cancelado_em: agora,
          motivo_cancelamento_item_exame_id: motivo['id'],
        });
      const resultado = await e.inserir(
        `INSERT INTO resultado_exame (exame_item_id, paciente_id, setor_diagnostico_id, situacao, resultado_em,
           liberado_em, autoliberado, conclusao, criado_em) VALUES (?, ?, ?, 'liberado', ?, ?, TRUE, ?, ?)`,
        [
          ids.itemLiberado,
          ids.paciente,
          setor,
          agora,
          new Date('2026-11-20T15:00:00Z'),
          'Conclusão sintética',
          agora,
        ],
      );
      await e.inserir(
        `INSERT INTO resultado_analito (resultado_exame_id, sequencia, analito_id, valor_numerico, unidade_resultado_id,
           referencia_minimo, referencia_maximo, critico_minimo, critico_maximo, criado_em)
         VALUES (?, 1, ?, 6.9, ?, 3.5, 5.1, 2.5, 6.5, ?)`,
        [resultado, analito, unidade, agora],
      );
      // Exames de fora: um ativo com dois valores e um suspenso.
      const externo = (nome: string, extra: Record<string, unknown>) =>
        e.inserir(
          `INSERT INTO exame_lancado_prontuario (estabelecimento_id, paciente_id, nome_exame, realizado_em, lancado_em,
             profissional_id, criado_em${Object.keys(extra)
               .map((k) => `, ${k}`)
               .join('')}) VALUES (?, ?, ?, ?, ?, ?, ?${Object.keys(extra)
               .map(() => ', ?')
               .join('')})`,
          [
            ids.paciente,
            ids.paciente,
            nome,
            new Date('2026-11-01T10:00:00Z'),
            agora,
            ids.prof,
            agora,
            ...Object.values(extra),
          ].map((v, i) => (i === 0 ? ids.est : v)),
        );
      const ext = await externo(`${PM} HEMOGRAMA DE FORA`, {});
      for (const [seq, el] of [
        [1, 'HEMOGLOBINA'],
        [2, 'LEUCOCITOS'],
      ] as const)
        await e.inserir(
          `INSERT INTO exame_lancado_valor (exame_lancado_prontuario_id, sequencia, elemento, valor_numerico, criado_em)
           VALUES (?, ?, ?, 1, ?)`,
          [ext, seq, el, agora],
        );
      await externo(`${PM} SUSPENSO`, {
        situacao: 'suspenso',
        suspenso_em: agora,
        suspenso_por_profissional_id: ids.prof,
        motivo_suspensao: 'Lançado no paciente errado (sintético)',
      });
    });
    pasta = mkdtempSync(join(tmpdir(), `${P}-arquivos-`));
    armazem = criarArmazemLocal(nucleo, { raiz: pasta });
    porta = new DocumentosPropriaExames(nucleo, CLIENTE, armazem);
  }, 180_000);

  afterAll(async () => {
    if (nucleo) {
      if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpeza` }, limpar);
      await nucleo.encerrar();
    }
    if (pasta) rmSync(pasta, { recursive: true, force: true });
  });

  it('catálogo: pelo nome ou código; inativo vem marcado; o que não é pedido pelo prontuário fica fora', async () => {
    const r = await porta.catalogoExames(C(), PM.toLowerCase());
    const codigos = r.map((x) => x.codigo);
    expect(codigos).toContain(`${PM}K`);
    expect(codigos).toContain(`${PM}INA`);
    expect(codigos).not.toContain(`${PM}NP`);
    const k = r.find((x) => x.codigo === `${PM}K`)!;
    expect(k).toMatchObject({ id: ids.exameLab, ato: 15, ativo: true, idadeMinima: null, idadeMaxima: 100 });
    expect(r.find((x) => x.codigo === `${PM}INA`)?.ativo).toBe(false);
    expect((await porta.catalogoExames(C(), `${PM}RX`)).map((x) => x.id)).toEqual([ids.exameImg]);
    expect(
      (await porta.examesPorId(C(), [ids.exameNaoPedivel, ids.exameLab])).map((x) => x.id).sort(),
    ).toEqual([ids.exameLab, ids.exameNaoPedivel].sort());
  });

  it('kits: exames na ordem do kit', async () => {
    const k = (await porta.kits(C())).find((x) => x.id === ids.kit);
    expect(k).toEqual({ id: ids.kit, nome: `${PM} ROTINA`, exames: [ids.exameLab, ids.exameImg] });
  });

  it('pedidos: a requisição agrupa; prioridade urgente; cancelado fica fora; situação traduzida', async () => {
    const ps = await porta.pedidos(C(), ids.paciente);
    expect(ps.map((p) => p.exame)).toEqual([ids.exameLab, ids.exameImg]);
    expect(ps.every((p) => p.agrupamento === ids.requisicao && p.urgente)).toBe(true);
    expect(ps[0]).toMatchObject({ liberado: true, pendSadt: null, indicacao: 'Controle sintético' });
    expect(ps[1]).toMatchObject({ liberado: false, pendSadt: 'T' });
    expect(ps[0]!.profissional).toBe(`Pessoa sintética ${P} profissional`);
  });

  it('resultados: o liberado com o valor do analito, a faixa e os limites críticos', async () => {
    const rs = await porta.resultados(C(), ids.paciente);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ exame: ids.itemLiberado, texto: 'Conclusão sintética' });
    expect(rs[0]!.chave).toMatchObject({
      conta: ids.requisicao,
      atend: 'L97-1',
      exame: `${PM}K`,
      sequencia: 1,
    });
    expect(rs[0]!.valores).toEqual([
      expect.objectContaining({
        elemento: 'POTASSIO',
        numerico: 6.9,
        unidade: 'mEq/L',
        refIni: 3.5,
        refFin: 5.1,
        minAbe: 2.5,
        maxAbe: 6.5,
      }),
    ]);
  });

  it('exames de fora: só o ativo, com os elementos lançados', async () => {
    const xs = await porta.examesExternos(C(), ids.paciente);
    expect(xs.map((x) => [x.nome, x.elementos])).toEqual([
      [`${PM} HEMOGRAMA DE FORA`, ['HEMOGLOBINA', 'LEUCOCITOS']],
    ]);
  });

  it('anexos: o metadado e o conteúdo pela porta de armazenamento (disco), conferido pelo hash', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% anexo sintético l97ex\n%%EOF\n', 'latin1');
    const guardado = await armazem.guardar(
      {
        conteudo: pdf,
        nomeOriginal: 'laudo-sintetico.pdf',
        tipoMime: 'application/pdf',
        finalidade: 'anexo',
      },
      {
        cliente: CLIENTE,
        estabelecimento: ids.est,
        usuario: ids.usuario,
        correlacao: `${P}-arquivo`,
        chaveIdempotencia: `${P}-arquivo-${Date.now()}`,
      },
    );
    const anexo = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-anexo` }, (e) =>
      e.inserir(
        `INSERT INTO anexo_prontuario (estabelecimento_id, paciente_id, tipo_anexo_id, arquivo_id, titulo, importado_em,
           importado_profissional_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ids.est,
          ids.paciente,
          ids.tipoAnexo,
          guardado.id,
          'Laudo sintético',
          new Date(),
          ids.prof,
          new Date(),
        ],
      ),
    );
    const as = await porta.anexos(C(), ids.paciente);
    expect(as).toEqual([
      expect.objectContaining({
        id: anexo,
        paciente: ids.paciente,
        nome: 'Laudo sintético',
        extensao: 'pdf',
        tipo: `${PM} EXAME EXTERNO`,
        suspenso: false,
        bytes: pdf.length,
        profissional: `Pessoa sintética ${P} profissional`,
      }),
    ]);
    const a = await porta.arquivoAnexo(C(), anexo);
    expect(a?.paciente).toBe(ids.paciente);
    expect(a?.pdf.equals(pdf)).toBe(true);
    expect(await porta.arquivoAnexo(C(), 999_999_999)).toBeNull();
    expect((await porta.tiposAnexo(C())).some((t) => t.id === ids.tipoAnexo)).toBe(true);
  });

  it('tipos de termo: só os vigentes; sem termo da recepção, nada herdado', async () => {
    const ts = (await porta.tiposTermo(C())).filter((t) => t.nome.startsWith(PM));
    expect(ts).toEqual([{ id: ids.modeloVigente, nome: `${PM} termo cirúrgico` }]);
    expect(await porta.tcleHerdado(C(), ids.atendimento)).toBeNull();
  });

  it('termo: emite pendente com o documento; assinar e revogar gravam novas versões; nada é apagado', async () => {
    const e = await porta.emitirTcle(G(), {
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      tipo: ids.modeloVigente,
      procedimento: 'Procedimento sintético',
      cbo: ids.inscricao,
      hashConteudo: 'e'.repeat(64),
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM documento_prontuario WHERE id = ? AND entidade_origem = 'termo_consentimento_paciente'
           AND entidade_origem_id = ?`,
        [e.documento, e.id],
      ),
    ).toBe(1);
    let ts = await porta.tcles(C(), ids.paciente);
    expect(ts).toEqual([
      expect.objectContaining({
        id: e.id,
        anterior: null,
        tipo: ids.modeloVigente,
        situacao: 'pendente',
        documento: e.documento,
        usuario: LOGIN,
      }),
    ]);
    const assinado = await porta.mudarSituacaoTcle(G(), {
      paciente: ids.paciente,
      versao: e.id,
      situacao: 'assinado',
      motivo: null,
    });
    await expect(
      porta.mudarSituacaoTcle(G(), {
        paciente: ids.paciente,
        versao: e.id,
        situacao: 'assinado',
        motivo: null,
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    const revogado = await porta.mudarSituacaoTcle(G(), {
      paciente: ids.paciente,
      versao: assinado,
      situacao: 'revogado',
      motivo: 'Paciente desistiu do procedimento (sintético)',
    });
    await expect(
      porta.mudarSituacaoTcle(G(), {
        paciente: ids.paciente,
        versao: revogado,
        situacao: 'revogado',
        motivo: 'Segunda revogação sintética',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'situacao-invalida' } });
    ts = await porta.tcles(C(), ids.paciente);
    expect(ts.map((t) => [t.id, t.anterior, t.situacao, t.documento])).toEqual([
      [e.id, null, 'pendente', e.documento],
      [assinado, e.id, 'assinado', e.documento],
      [revogado, assinado, 'revogado', e.documento],
    ]);
    expect(ts[2]!.motivo).toBe('Paciente desistiu do procedimento (sintético)');
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM termo_consentimento_paciente WHERE paciente_id = ? AND excluido_em IS NULL
           AND assinado_em IS NOT NULL`,
        [ids.paciente],
      ),
    ).toBe(2);
  });

  it('termo: login sem profissional vinculado é recusado; atendimento de outro estabelecimento também', async () => {
    const base = {
      paciente: ids.paciente,
      atendimento: ids.atendimento,
      tipo: null,
      procedimento: 'Procedimento sintético',
      cbo: null,
      hashConteudo: 'f'.repeat(64),
    };
    await expect(porta.emitirTcle(G(SEM_VINCULO), base)).rejects.toMatchObject({
      problema: { status: 403, codigo: 'sem-profissional' },
    });
    await expect(porta.emitirTcle(G(), { ...base, atendimento: 999_999_999 })).rejects.toMatchObject({
      problema: { status: 404, codigo: 'atendimento-inexistente' },
    });
  });
});
