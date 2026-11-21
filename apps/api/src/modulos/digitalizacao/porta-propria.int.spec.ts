// Integração da porta própria da digitalização certificada (F2.2, lote 03-02) contra o MariaDB real, no cliente de
// teste da onda 3 (f22_o3, banco cliente_f22_o3). Massa SINTÉTICA com a marca F22L0302 (nenhuma pessoa real), montada
// no beforeAll e apagada no afterAll; os domínios compartilhados (categoria e caráter do atendimento) ficam.
// Contrato de efeito: a captura (documento, arquivo, lote numerado, ordem, trilha), a conferência (versão, segregação),
// a assinatura (assinatura_icp + validacao_assinatura + documento "assinado"), a repetição do pedido (Idempotency-Key),
// o mesmo arquivo em dois estabelecimentos e as recusas. As gravações e as leituras do índice dependem das colunas
// pedidas pelo lote, aplicadas nas migrações (09_HOT/06, F2.2 onda 3). Num cliente sem elas, o teste aplica o pedido
// (saida/03-02.sql) e o desfaz no fim; sem as colunas depois disso, o teste FALHA (nada é pulado).
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssinaturaParaGravar, ValidacaoParaGravar } from '../assinatura/tipos.js';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { ContextoGravacaoDigitalizacao } from './porta.js';
import { PortaDigitalizacaoPropria } from './porta-propria.js';
import type { CapturaDigitalizacao } from './tipos.js';

const CLIENTE = 'f22_o3';
const BANCO = `cliente_${CLIENTE}`;
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const MARCA = 'F22L0302';
const PRONT = 9_302_001;
const COLUNAS_PEDIDAS = [
  'lote_digitalizacao_id',
  'ordem_lote',
  'descricao',
  'resolucao_dpi',
  'cor',
  'motivo_rejeicao',
  'assinatura_icp_id',
  'assinado_em',
];

const sql = (entrada: string) => execFileSync(resolve(RAIZ, 'tools/db/sql.sh'), [BANCO], { input: entrada, encoding: 'utf8' });
/** O pedido de modelo do lote (sem a carga de domínio: o teste cadastra só os tipos que usa). */
const PEDIDO_MODELO = () => readFileSync(resolve(RAIZ, 'docs/obra/fatias/f22/saida/03-02.sql'), 'utf8').split('-- Carga')[0]!;
/** Desfaz o pedido aplicado pelo teste (o cliente de teste volta ao DDL das migrações). */
const DESFAZER_MODELO = `ALTER TABLE documento_digitalizado
  DROP FOREIGN KEY fk_documento_digitalizado_lote_digitalizacao_id,
  DROP FOREIGN KEY fk_documento_digitalizado_assinatura_icp_id;
ALTER TABLE documento_digitalizado
  DROP CONSTRAINT ck_documento_digitalizado_cor, DROP CONSTRAINT ck_documento_digitalizado_resolucao,
  DROP CONSTRAINT ck_documento_digitalizado_ordem, DROP CONSTRAINT ck_documento_digitalizado_rejeicao,
  DROP CONSTRAINT ck_documento_digitalizado_assinado, DROP CONSTRAINT ck_documento_digitalizado_segregacao,
  DROP CONSTRAINT ck_documento_digitalizado_situacao,
  DROP INDEX uq_documento_digitalizado_lote_ordem, DROP INDEX uq_documento_digitalizado_assinatura_icp;
ALTER TABLE documento_digitalizado
  DROP COLUMN lote_digitalizacao_id, DROP COLUMN ordem_lote, DROP COLUMN descricao, DROP COLUMN resolucao_dpi,
  DROP COLUMN cor, DROP COLUMN motivo_rejeicao, DROP COLUMN assinatura_icp_id, DROP COLUMN assinado_em,
  ADD CONSTRAINT ck_documento_digitalizado_situacao
    CHECK (situacao IN ('pendente_conferencia','conferido','rejeitado','substituido'));
`;

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function codigoDaRecusa(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
}

const hex = (k: number) => k.toString(16).padStart(2, '0').repeat(32);

describe.skipIf(SEM_BANCO)('porta própria da digitalização (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDigitalizacaoPropria;
  let pronto = false;
  let aplicadoPeloTeste = false;
  const ids = { est: 0, outro: 0, capt: 0, conf: 0, paciente: 0, atend: 0, atendOutro: 0, cert: 0 };
  let seq = 0;
  const ctx = (usuario: number, est = ids.est): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: est,
    usuario,
    correlacao: `f22-0302-${++seq}`,
  });
  const trilha = (c: ContextoNucleo, id: number | null = null): TrilhaDaGravacao => ({
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    acao: 'operacao',
    entidade: 'documento_digitalizado',
    entidadeId: id,
    dadosDepois: { evento: 'teste.digitalizacao' },
    correlacao: c.correlacao,
  });
  const captura = (k: number, extra: Partial<CapturaDigitalizacao> = {}): CapturaDigitalizacao => ({
    lote: null,
    prontuario: PRONT,
    internacao: ids.atend,
    paciente: ids.paciente,
    tipoDocumento: 'evolucao',
    descricao: `EVOLUCAO SINTETICA ${MARCA}`,
    dataDocumento: '2019-04-02',
    paginas: 2,
    resolucaoDpi: 300,
    cor: 'cinza',
    arquivoChave: `teste/${MARCA}/${hex(k)}.pdf`,
    hash: hex(k),
    tamanho: 1234,
    guardaAte: '2046-10-25',
    usuario: 'f22.l0302.captura',
    ...extra,
  });
  const assinatura = (k: number, estado: 'assinada' | 'falha'): Omit<AssinaturaParaGravar, 'hospital'> => ({
    origem: 'digitalizacao',
    documento: null,
    hash: hex(k),
    formato: 'cades',
    politicaIcp: 'AD-RT',
    midia: 'a1',
    provedor: null,
    certificado: ids.cert,
    usuario: 'f22.l0302.confere',
    estado,
    tentativas: 0,
    falha: estado === 'falha' ? 'carimbo-indisponivel' : null,
    proximaEm: null,
    assinatura: 'AAECAwQ=',
    carimboToken: null,
    carimboEm: new Date('2026-10-25T13:00:00Z'),
    carimboSerie: null,
  });
  const validacao = (valida: boolean): Omit<ValidacaoParaGravar, 'assinatura'> => ({
    momento: 'assinar',
    resultado: valida ? 'valida' : 'indeterminada',
    cadeia: true,
    vigencia: true,
    revogacao: true,
    cpf: true,
    assinaturaConfere: valida,
    carimbo: valida,
    motivos: valida ? [] : ['carimbo-indisponivel'],
    usuario: 'f22.l0302.confere',
    em: new Date(),
  });

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0302-limpeza' }, async (e) => {
      const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
      const p = ['f22l0302', 'f22l0302b'];
      await e.executar(`DELETE FROM documento_digitalizado WHERE estabelecimento_id IN (${ests})`, p);
      await e.executar(
        `DELETE v FROM validacao_assinatura v JOIN assinatura_icp a ON a.id = v.assinatura_icp_id WHERE a.estabelecimento_id IN (${ests})`,
        p,
      );
      await e.executar(`DELETE FROM assinatura_icp WHERE estabelecimento_id IN (${ests})`, p);
      await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN (${ests})`, p);
      await e.executar(`DELETE FROM lote_digitalizacao WHERE estabelecimento_id IN (${ests})`, p);
      await e.executar(`DELETE FROM sequencia_negocio WHERE tipo = 'lote_digitalizacao' AND estabelecimento_id IN (${ests})`, p);
      await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${ests})`, p);
      await e.executar('DELETE FROM paciente WHERE numero_prontuario = ?', [PRONT]);
      await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [`PACIENTE ${MARCA}`]);
      await e.executar("DELETE FROM certificado_usuario WHERE numero_serie = ?", [MARCA]);
      await e.executar("DELETE FROM idempotencia_operacao WHERE chave LIKE 'digitalizacao:%' OR chave LIKE 'f22-0302-%'");
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o3');
    porta = new PortaDigitalizacaoPropria(nucleo);
    const modelo = () =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-modelo' }, async (l) => {
        const c = await l.uma(
          `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE()
             AND table_name = 'documento_digitalizado' AND column_name IN (${COLUNAS_PEDIDAS.map(() => '?').join(', ')})`,
          COLUNAS_PEDIDAS,
        );
        const k = await l.uma(
          `SELECT COUNT(*) AS n FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()
             AND table_name = 'documento_digitalizado' AND check_clause LIKE '%assinado%'`,
        );
        return { colunas: Number(c?.['n']), assinado: Number(k?.['n']) > 0 };
      });
    const antes = await modelo();
    if (antes.colunas === 0 && !antes.assinado) {
      sql(PEDIDO_MODELO());
      aplicadoPeloTeste = true;
    }
    const depois = await modelo();
    pronto = depois.colunas === COLUNAS_PEDIDAS.length && depois.assinado;
    // Sem o modelo do pedido, nenhum contrato de efeito é provado: o teste falha aqui (não pula).
    expect(pronto, 'o documento_digitalizado sem as colunas do pedido 03-02').toBe(true);
    await limpar();
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f22-0302-preparo' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(e, 'SELECT id FROM estabelecimento WHERE codigo = ?', [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital de teste ${codigo}`, `Hospital de teste ${codigo} (fictício)`, agora]);
      ids.est = await est('f22l0302');
      ids.outro = await est('f22l0302b');
      const usu = (login: string) =>
        garantir(e, 'SELECT id FROM usuario WHERE login = ?', [login],
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [login, `USUARIO ${MARCA}`, agora]);
      ids.capt = await usu('f22.l0302.captura');
      ids.conf = await usu('f22.l0302.confere');
      const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`PACIENTE ${MARCA}`, agora]);
      ids.paciente = await e.inserir(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, nome_social, usa_nome_social, criado_em) VALUES (?, ?, ?, TRUE, ?)',
        [pf, PRONT, `NOME SOCIAL ${MARCA}`, agora],
      );
      const categoria = await garantir(e, 'SELECT id FROM categoria_atendimento WHERE codigo = ?', ['consulta'],
        'INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, ?, ?)',
        ['consulta', 'Consulta ambulatorial', 'ambulatorio', agora]);
      const carater = await garantir(e, 'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?', ['1'],
        'INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, ?, ?, ?)',
        ['1', 'Eletivo', 'teste', agora]);
      const fonte = await garantir(e, 'SELECT id FROM fonte_pagadora WHERE codigo = ?', [MARCA],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
        [MARCA, `CONVENIO ${MARCA}`, agora]);
      const pessoaProf = await garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [`MEDICA ${MARCA}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [`MEDICA ${MARCA}`, agora]);
      const prof = await garantir(e, 'SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)", [pessoaProf, agora]);
      const atend = (estab: number, numero: string) =>
        e.inserir(
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [estab, numero, ids.paciente, categoria, carater, fonte, prof, new Date('2019-04-01T12:00:00Z'), agora],
        );
      ids.atend = await atend(ids.est, `${MARCA}-1`);
      ids.atendOutro = await atend(ids.outro, `${MARCA}-2`);
      for (const codigo of ['evolucao', 'laudo'])
        await garantir(e, 'SELECT id FROM tipo_documento_arquivo WHERE codigo = ?', [codigo],
          "INSERT INTO tipo_documento_arquivo (codigo, descricao, grupo, prazo_guarda_anos, criado_em) VALUES (?, ?, 'prontuario', 20, ?)",
          [codigo, `Tipo ${codigo} (teste)`, agora]);
      ids.cert = await e.inserir(
        `INSERT INTO certificado_usuario (usuario_id, midia, nome_titular, cpf_titular, emissor, numero_serie,
           impressao_digital, valido_de, valido_ate, criado_em) VALUES (?, 'a1', ?, '52998224725', ?, ?, ?, ?, ?, ?)`,
        [ids.conf, `TITULAR ${MARCA}`, `AC TESTE ${MARCA}`, MARCA, hex(250), new Date('2026-01-01'), new Date('2027-01-01'), agora],
      );
    });
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    try {
      await limpar();
    } finally {
      await nucleo.encerrar();
      if (aplicadoPeloTeste) sql(DESFAZER_MODELO);
    }
  });

  // ── Leituras que não dependem do pedido de modelo ──

  it('relógio no fuso do estabelecimento', async () => {
    const r = await porta.relogio(ctx(ids.capt));
    expect(r.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.agora.startsWith(`${r.hoje}T`)).toBe(true);
  });

  it('o paciente pelo prontuário: nome social primeiro e só os atendimentos do estabelecimento', async () => {
    const p = await porta.paciente(ctx(ids.capt), PRONT);
    expect(p).toMatchObject({ prontuario: PRONT, paciente: ids.paciente, nome: `NOME SOCIAL ${MARCA}` });
    expect(p?.internacoes.map((i) => i.reg)).toEqual([ids.atend]);
    expect(p?.internacoes[0]).toMatchObject({ entrada: '2019-04-01', saida: null });
    expect(await porta.paciente(ctx(ids.capt), PRONT + 1)).toBeNull();
    expect((await porta.nomes(ctx(ids.capt), [ids.paciente])).get(ids.paciente)).toBe(`NOME SOCIAL ${MARCA}`);
  });

  it('o prontuário da internação: só o atendimento do estabelecimento da sessão', async () => {
    expect(await porta.prontuarioDaInternacao(ctx(ids.capt), ids.atend)).toBe(PRONT);
    expect(await porta.prontuarioDaInternacao(ctx(ids.capt), ids.atendOutro)).toBeNull();
    expect(await porta.prontuarioDaInternacao(ctx(ids.capt, ids.outro), ids.atendOutro)).toBe(PRONT);
  });

  it('lote e resumo inexistentes; sem estabelecimento, recusa', async () => {
    expect(await porta.loteExiste(ctx(ids.capt), 999_999_999)).toBe(false);
    expect(await porta.hashExiste(ctx(ids.capt), hex(1))).toBe(false);
    expect(await codigoDaRecusa(porta.fila({ ...ctx(ids.capt), estabelecimento: null }, null))).toBe('sem-estabelecimento');
  });

  // ── Gravações e leituras do índice (o DDL do pedido) ──

  it('captura: documento, arquivo, lote numerado, ordem e trilha; o mesmo arquivo é recusado', async () => {
    const c = ctx(ids.capt);
    const r = await porta.gravarSgh(c, (x: { id: number }) => trilha(c, x.id), (g) => g.capturar(captura(1)));
    expect(r.ordem).toBe(1);
    const r2 = await porta.gravarSgh(c, trilha(c), (g) => g.capturar(captura(2, { lote: r.lote, paginas: 3 })));
    expect(r2).toMatchObject({ lote: r.lote, ordem: 2 });
    expect(await porta.loteExiste(c, r.lote)).toBe(true);
    expect(await porta.loteExiste(ctx(ids.capt, ids.outro), r.lote)).toBe(false);
    expect(await porta.hashExiste(c, hex(1))).toBe(true);
    expect(await codigoDaRecusa(porta.gravarSgh(c, trilha(c), (g) => g.capturar(captura(1))))).toBe('ja-digitalizado');
    // O tipo 'folha-sala' vem da carga de domínio (09_HOT/06_chaves.sql): inativo, conta como sem cadastro.
    sql("UPDATE tipo_documento_arquivo SET ativo = FALSE WHERE codigo = 'folha-sala'");
    try {
      expect(
        await codigoDaRecusa(porta.gravarSgh(c, trilha(c), (g) => g.capturar(captura(3, { tipoDocumento: 'folha-sala' })))),
      ).toBe('tipo-documento-sem-cadastro');
    } finally {
      sql("UPDATE tipo_documento_arquivo SET ativo = TRUE WHERE codigo = 'folha-sala'");
    }
    const efeito = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-efeito' }, async (l) => ({
      doc: await l.uma(
        `SELECT d.situacao, d.versao, d.conferido, d.digitalizador_usuario_id, d.ordem_lote, a.hash_sha256, a.entidade,
                a.entidade_id, a.imutavel, a.retencao_ate
           FROM documento_digitalizado d JOIN arquivo a ON a.id = d.arquivo_id WHERE d.id = ?`,
        [r.id],
      ),
      lote: await l.uma('SELECT numero, quantidade_documentos, quantidade_paginas, operador_usuario_id FROM lote_digitalizacao WHERE id = ?', [r.lote]),
      trilha: await l.uma("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'documento_digitalizado' AND entidade_id = ?", [r.id]),
    }));
    expect(efeito.doc).toMatchObject({ situacao: 'pendente_conferencia', versao: 1, digitalizador_usuario_id: ids.capt, hash_sha256: hex(1), entidade: 'documento_digitalizado' });
    expect(Number(efeito.doc?.['entidade_id'])).toBe(r.id);
    expect(String(efeito.lote?.['numero'])).toMatch(/^LD-\d+$/);
    expect(efeito.lote).toMatchObject({ quantidade_documentos: 2, quantidade_paginas: 5, operador_usuario_id: ids.capt });
    expect(Number(efeito.trilha?.['n'])).toBeGreaterThanOrEqual(1);
  });

  it('leituras do índice: fila com contagens, documento, por ids, do prontuário; outro estabelecimento não vê', async () => {
    const c = ctx(ids.capt);
    const f = await porta.fila(c, 'capturado');
    expect(f.itens.length).toBe(2);
    expect(f.contagens.capturado).toBe(2);
    const d = f.itens.find((x) => x.hash === hex(1))!;
    expect(d).toMatchObject({
      prontuario: PRONT,
      internacao: ids.atend,
      paciente: ids.paciente,
      tipoDocumento: 'evolucao',
      cor: 'cinza',
      resolucaoDpi: 300,
      paginas: 2,
      situacao: 'capturado',
      capturadoPor: 'f22.l0302.captura',
      conferidoPor: null,
      guardaAte: '2046-10-25',
      dataDocumento: '2019-04-02',
      versao: 1,
    });
    expect(d.capturadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect((await porta.documento(c, d.id))?.id).toBe(d.id);
    expect(await porta.documento(ctx(ids.capt, ids.outro), d.id)).toBeNull();
    expect((await porta.porIds(c, [d.id, d.id])).map((x) => x.id)).toEqual([d.id]);
    expect((await porta.doProntuario(c, PRONT)).length).toBe(2);
    expect((await porta.fila(ctx(ids.capt, ids.outro), null)).itens).toEqual([]);
  });

  it('conferência: quem capturou não confere; versão velha é conflito; fiel e recusada com motivo', async () => {
    const [a, b] = (await porta.fila(ctx(ids.capt), 'capturado')).itens.sort((x, y) => x.ordem - y.ordem);
    const cc = ctx(ids.capt);
    const cf = ctx(ids.conf);
    const conf = (id: number, situacao: 'conferido' | 'recusado', versao: number, motivo: string | null = null) =>
      (g: Parameters<Parameters<typeof porta.gravarSgh>[2]>[0]) => g.conferir({ id, situacao, motivo, versao, usuario: '' });
    expect(await codigoDaRecusa(porta.gravarSgh(cc, trilha(cc, a!.id), conf(a!.id, 'conferido', 1)))).toBe('conferente-capturou');
    expect(await codigoDaRecusa(porta.gravarSgh(cf, trilha(cf, a!.id), conf(a!.id, 'conferido', 7)))).toBe('conflito-versao');
    await porta.gravarSgh(cf, trilha(cf, a!.id), conf(a!.id, 'conferido', 1));
    await porta.gravarSgh(cf, trilha(cf, b!.id), conf(b!.id, 'recusado', 1, 'PAGINA ILEGIVEL'));
    expect(await codigoDaRecusa(porta.gravarSgh(cf, trilha(cf, a!.id), conf(a!.id, 'conferido', 2)))).toBe('ja-conferido');
    const da = await porta.documento(cf, a!.id);
    const db = await porta.documento(cf, b!.id);
    expect(da).toMatchObject({ situacao: 'conferido', conferidoPor: 'f22.l0302.confere', motivo: null, versao: 2 });
    expect(db).toMatchObject({ situacao: 'recusado', motivo: 'PAGINA ILEGIVEL', versao: 2 });
    expect((await porta.fila(cf, null)).contagens).toMatchObject({ capturado: 0, conferido: 1, recusado: 1 });
  });

  it('assinatura: só quem conferiu; assinatura ICP e validação na mesma transação; a falha deixa só a evidência', async () => {
    const [d] = (await porta.fila(ctx(ids.conf), 'conferido')).itens;
    const cc = ctx(ids.capt);
    const cf = ctx(ids.conf);
    expect(
      await codigoDaRecusa(
        porta.gravarSgh(cc, trilha(cc, d!.id), (g) =>
          g.assinar({ id: d!.id, assinatura: assinatura(1, 'assinada'), validacao: validacao(true), usuario: '' }),
        ),
      ),
    ).toBe('versao-desatualizada');
    const falha = await porta.gravarSgh(cf, trilha(cf, d!.id), (g) =>
      g.registrarFalha({ assinatura: assinatura(1, 'falha'), validacao: validacao(false) }),
    );
    expect((await porta.documento(cf, d!.id))?.situacao).toBe('conferido');
    const id = await porta.gravarSgh(cf, trilha(cf, d!.id), (g) =>
      g.assinar({ id: d!.id, assinatura: assinatura(1, 'assinada'), validacao: validacao(true), usuario: '' }),
    );
    const doc = await porta.documento(cf, d!.id);
    expect(doc).toMatchObject({ situacao: 'assinado', assinatura: id, assinadoPor: 'f22.l0302.confere', versao: 3 });
    expect(doc?.carimboEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const efeito = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-efeito' }, (l) =>
      l.consultar(
        `SELECT a.id, a.origem_assinatura, a.situacao, a.usuario_id, v.resultado, v.usuario_id AS validador
           FROM assinatura_icp a JOIN validacao_assinatura v ON v.assinatura_icp_id = a.id WHERE a.id IN (?, ?) ORDER BY a.id`,
        [falha, id],
      ),
    );
    expect(efeito.map((x) => [x['origem_assinatura'], x['situacao'], x['resultado'], Number(x['usuario_id'])])).toEqual([
      ['digitalizacao', 'falha', 'indeterminada', ids.conf],
      ['digitalizacao', 'assinada', 'valida', ids.conf],
    ]);
    expect(
      await codigoDaRecusa(
        porta.gravarSgh(cf, trilha(cf, d!.id), (g) =>
          g.assinar({ id: d!.id, assinatura: assinatura(1, 'assinada'), validacao: validacao(true), usuario: '' }),
        ),
      ),
    ).toBe('versao-desatualizada');
  });

  it('o mesmo arquivo em outro estabelecimento do cliente entra; a chave do arquivo leva o estabelecimento', async () => {
    const c = ctx(ids.capt, ids.outro);
    const r = await porta.gravarSgh(c, (x: { id: number }) => trilha(c, x.id), (g) =>
      g.capturar(captura(1, { internacao: ids.atendOutro })),
    );
    expect(r.ordem).toBe(1);
    expect(await porta.hashExiste(c, hex(1))).toBe(true);
    const d = await porta.documento(c, r.id);
    expect(d?.arquivoChave).toBe(`teste/${MARCA}/${hex(1)}.pdf`);
    const chaves = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-efeito' }, (l) =>
      l.consultar(
        'SELECT estabelecimento_id, chave_armazenamento FROM arquivo WHERE hash_sha256 = ? ORDER BY estabelecimento_id',
        [hex(1)],
      ),
    );
    expect(chaves.map((x) => String(x['chave_armazenamento']))).toEqual(
      [ids.est, ids.outro].sort((a, b) => a - b).map((e) => `estabelecimento-${e}/teste/${MARCA}/${hex(1)}.pdf`),
    );
    expect(await codigoDaRecusa(porta.gravarSgh(c, trilha(c), (g) => g.capturar(captura(1, { internacao: ids.atendOutro }))))).toBe(
      'ja-digitalizado',
    );
  });

  it('o pedido repetido (Idempotency-Key) devolve o resultado gravado; uma linha só; outros dados, 422', async () => {
    const pedido = (k: number, chave = 'f22-0302-idem-1') => ({
      ...ctx(ids.capt),
      pedido: { chave, acao: 'capturar' as const, entrada: { hash: hex(k), paginas: 2 } },
    });
    const c: ContextoGravacaoDigitalizacao = pedido(5);
    expect(await porta.repeticao(c)).toBeNull();
    const r = await porta.gravarSgh(c, (x: { id: number }) => trilha(c, x.id), (g) => g.capturar(captura(5)));
    const r2 = await porta.gravarSgh(c, (x: { id: number }) => trilha(c, x.id), (g) => g.capturar(captura(5)));
    expect(r2).toEqual(r);
    expect(await porta.repeticao(c)).toEqual({ valor: r });
    const efeito = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-0302-efeito' }, async (l) => ({
      docs: await l.uma(
        `SELECT COUNT(*) AS n FROM documento_digitalizado d JOIN arquivo a ON a.id = d.arquivo_id
          WHERE d.estabelecimento_id = ? AND a.hash_sha256 = ?`,
        [ids.est, hex(5)],
      ),
      idem: await l.uma("SELECT COUNT(*) AS n FROM idempotencia_operacao WHERE operacao = 'digitalizacao.capturar' AND chave = ?", [
        'f22-0302-idem-1:capturar',
      ]),
    }));
    expect(Number(efeito.docs?.['n'])).toBe(1);
    expect(Number(efeito.idem?.['n'])).toBe(1);
    expect(await codigoDaRecusa(porta.repeticao(pedido(6)))).toBe('idempotencia-divergente');
    expect(await codigoDaRecusa(porta.repeticao({ ...c, usuario: ids.conf }))).toBe('idempotencia-divergente');
  });
});
