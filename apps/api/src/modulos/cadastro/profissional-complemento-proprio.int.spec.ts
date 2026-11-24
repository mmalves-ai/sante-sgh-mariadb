// Contrato de efeito do complemento do profissional (F3.1, 02-CAD linha 16) contra o MariaDB real, no cliente de teste
// f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica no banco: dado
// fiscal com vigência (o anterior aberto encerra na véspera; sobreposição recusa), conta e chave de pagamento (uma
// principal, favorecido terceiro só confirmado, inativar passa a principal), RQE (exige o registro na UF, volta na mesma
// linha) e assinatura (uma vigente por tipo; encerrar não apaga). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE_F22,
  contextoPorta,
  cpfSintetico,
  garantir,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import {
  type EntradaConta,
  type EntradaDadoFiscal,
  ProfissionalComplementoProprio,
} from './profissional-complemento-proprio.js';
import type { RegistroTrilhaTela } from './tipos.js';

const TABELAS = [
  'profissional_assinatura',
  'profissional_rqe',
  'conta_bancaria_profissional',
  'profissional_dado_fiscal',
] as const;

async function limparComplemento(nucleo: NucleoProprio, m: Massa | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, async (e) => {
    for (const t of TABELAS) await e.executar(`DELETE FROM ${t} WHERE profissional_id = ?`, [m.profissional]);
  });
}

describe.skipIf(SEM_BANCO)('complemento do profissional no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let c: ProfissionalComplementoProprio;
  let m: Massa | null = null;
  let empresa = 0;
  let banco = 0;
  let siglaUf = '';
  const CPF_FAV = cpfSintetico('990102161');

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, (l) => l.uma<T>(sql, p));
  const trilha = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.profissional-complemento' },
    correlacao: 'f22-0102-compl',
  });
  const fiscal = (x: Partial<EntradaDadoFiscal> = {}): EntradaDadoFiscal => ({
    profissional: m!.profissional,
    estabelecimento: null,
    vigenciaInicio: '2026-01-01',
    vigenciaFim: null,
    tipoRecebedor: 'pessoa_fisica',
    pessoaJuridica: null,
    regime: 'autonomo',
    inscricaoMunicipal: null,
    inscricaoInss: null,
    pisPasep: '12056412547',
    categoriaSefip: null,
    aliquotaIss: 5,
    percentualInss: 11,
    retemIss: true,
    retemInss: true,
    retemIrrf: true,
    retemPisCofinsCsll: false,
    dependentesIrrf: 1,
    incidencia: 'pagamento',
    ...x,
  });
  const conta = (x: Partial<EntradaConta> = {}): EntradaConta => ({
    profissional: m!.profissional,
    banco,
    tipoConta: null,
    agencia: '1234',
    agenciaDigito: null,
    numeroConta: '998877',
    contaDigito: '1',
    tipoChavePix: null,
    chavePix: null,
    favorecidoNome: `FAVORECIDO ${MARCA}`,
    favorecidoTipo: 'fisica',
    favorecidoDocumento: CPF_FAV,
    principal: false,
    confirmaTerceiro: true,
    ...x,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparComplemento(nucleo, m);
    c = new ProfissionalComplementoProprio(nucleo, CLIENTE_F22);
    const agora = new Date();
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, async (e) => {
      empresa = await garantir(
        e,
        'SELECT id FROM pessoa_juridica WHERE razao_social = ?',
        [`CLINICA ${MARCA}`],
        'INSERT INTO pessoa_juridica (razao_social, cnpj, criado_em) VALUES (?, ?, ?)',
        [`CLINICA ${MARCA}`, '11222333000181', agora],
      );
      banco = await garantir(
        e,
        'SELECT id FROM banco WHERE codigo_ispb = ?',
        ['99010216'],
        'INSERT INTO banco (codigo_ispb, descricao, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        ['99010216', `BANCO ${MARCA}`, '2020-01-01', agora],
      );
    });
    siglaUf = String(
      (await um<{ s: unknown }>('SELECT sigla AS s FROM unidade_federativa WHERE id = ?', [m!.uf]))!.s,
    );
  });

  afterAll(async () => {
    await limparComplemento(nucleo, m);
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('dado fiscal: grava com vigência; o novo encerra o anterior aberto na véspera; sobreposição e PJ sem empresa recusam', async () => {
    const ctx = contextoPorta(m!);
    const a = await c.gravarDadoFiscal(ctx, fiscal(), trilha('profissional_dado_fiscal'));
    const b = await c.gravarDadoFiscal(
      ctx,
      fiscal({
        vigenciaInicio: '2026-07-01',
        tipoRecebedor: 'pessoa_juridica',
        pessoaJuridica: empresa,
        regime: 'simples_nacional',
        retemInss: false,
        percentualInss: null,
        dependentesIrrf: 0,
      }),
      trilha('profissional_dado_fiscal'),
    );
    const la = await um(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, sequencia FROM profissional_dado_fiscal WHERE id = ?",
      [a],
    );
    const lb = await um(
      'SELECT vigencia_fim, sequencia, tipo_recebedor, pessoa_juridica_id, aliquota_iss, retem_iss FROM profissional_dado_fiscal WHERE id = ?',
      [b],
    );
    expect(la!['fim']).toBe('2026-06-30');
    expect(Number(lb!['sequencia'])).toBe(Number(la!['sequencia']) + 1);
    expect(lb).toMatchObject({
      vigencia_fim: null,
      tipo_recebedor: 'pessoa_juridica',
      pessoa_juridica_id: empresa,
    });
    expect(Number(lb!['aliquota_iss'])).toBe(5);
    await expect(
      c.gravarDadoFiscal(
        ctx,
        fiscal({ vigenciaInicio: '2026-03-01', vigenciaFim: '2026-03-31' }),
        trilha('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-sobreposta' } });
    await expect(
      c.gravarDadoFiscal(
        ctx,
        fiscal({ vigenciaInicio: '2027-01-01', tipoRecebedor: 'pessoa_juridica', dependentesIrrf: 0 }),
        trilha('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'recebedor-sem-empresa' } });
    const f = await c.financeiro(ctx, m!.profissional);
    expect(f.fiscais.map((x) => x.id)).toEqual([b, a]);
    // Encerrar não apaga: a linha fica com o fim.
    await c.encerrar(
      ctx,
      'profissional_dado_fiscal',
      { profissional: m!.profissional, id: b, versao: f.fiscais[0]!.versao, fim: '2026-12-31' },
      trilha('x'),
    );
    const n = await um<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM profissional_dado_fiscal WHERE profissional_id = ?',
      [m!.profissional],
    );
    expect(Number(n!.n)).toBe(2);
  });

  it('conta e chave: a primeira é a principal; nova principal tira a marca; terceiro só confirmado; inativar passa a principal', async () => {
    const ctx = contextoPorta(m!);
    await expect(c.incluirConta(ctx, conta({ confirmaTerceiro: false }), trilha('x'))).rejects.toMatchObject({
      problema: { codigo: 'favorecido-terceiro' },
    });
    // A empresa do dado fiscal não é terceiro: entra sem confirmação.
    const a = await c.incluirConta(
      ctx,
      conta({ favorecidoTipo: 'juridica', favorecidoDocumento: '11222333000181', confirmaTerceiro: false }),
      trilha('conta_bancaria_profissional'),
    );
    const b = await c.incluirConta(
      ctx,
      conta({
        banco: null,
        agencia: null,
        numeroConta: null,
        contaDigito: null,
        tipoChavePix: 'cpf',
        chavePix: CPF_FAV,
        principal: true,
      }),
      trilha('conta_bancaria_profissional'),
    );
    await expect(
      c.incluirConta(ctx, conta({ tipoChavePix: 'telefone', chavePix: '31999990000' }), trilha('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'chave-invalida' } });
    const pa = await um('SELECT principal, ativo, versao FROM conta_bancaria_profissional WHERE id = ?', [a]);
    const pb = await um(
      'SELECT principal, chave_pix, banco_id, versao FROM conta_bancaria_profissional WHERE id = ?',
      [b],
    );
    expect(Number(pa!['principal'])).toBe(0);
    expect(Number(pb!['principal'])).toBe(1);
    expect(pb!['banco_id']).toBeNull();
    await c.encerrar(
      ctx,
      'conta_bancaria_profissional',
      { profissional: m!.profissional, id: b, versao: Number(pb!['versao']), fim: null },
      trilha('x'),
    );
    const depois = await um('SELECT principal FROM conta_bancaria_profissional WHERE id = ?', [a]);
    const inativa = await um('SELECT principal, ativo FROM conta_bancaria_profissional WHERE id = ?', [b]);
    expect(Number(depois!['principal'])).toBe(1);
    expect(inativa).toMatchObject({ principal: 0, ativo: 0 });
  });

  it('RQE: exige o registro ativo na UF; repetido recusa; inativado volta na mesma linha', async () => {
    const ctx = contextoPorta(m!);
    const e = {
      profissional: m!.profissional,
      numero: '45678',
      uf: siglaUf,
      especialidade: m!.especialidade,
      dataRegistro: '2020-05-01',
    };
    const outraUf = siglaUf === 'SP' ? 'RJ' : 'SP';
    await expect(c.incluirRqe(ctx, { ...e, uf: outraUf }, trilha('x'))).rejects.toMatchObject({
      problema: { codigo: 'rqe-sem-registro-na-uf' },
    });
    const id = await c.incluirRqe(ctx, e, trilha('profissional_rqe'));
    const l = await um(
      'SELECT numero_rqe, inscricao_conselho_id, conselho_classe_id, ativo, versao FROM profissional_rqe WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({ numero_rqe: '45678', conselho_classe_id: m!.conselho, ativo: 1 });
    expect(l!['inscricao_conselho_id']).not.toBeNull();
    await expect(c.incluirRqe(ctx, e, trilha('x'))).rejects.toMatchObject({
      problema: { codigo: 'rqe-repetido' },
    });
    await c.encerrar(
      ctx,
      'profissional_rqe',
      { profissional: m!.profissional, id, versao: Number(l!['versao']), fim: null },
      trilha('x'),
    );
    const volta = await c.incluirRqe(ctx, { ...e, numero: '45679' }, trilha('profissional_rqe'));
    expect(volta).toBe(id);
    const lista = (await c.complemento(ctx, m!.profissional)).rqes;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ numero: '45679', ativo: true, uf: siglaUf });
  });

  it('assinatura: certificado com série única; o novo encerra o anterior na véspera; encerrar não apaga', async () => {
    const ctx = contextoPorta(m!);
    const cert = {
      profissional: m!.profissional,
      tipo: 'certificado_digital' as const,
      arquivo: null,
      titular: `TITULAR ${MARCA}`,
      numeroSerie: 'F22A0102',
      emissor: 'AC TESTE',
      impressaoDigital: 'ab'.repeat(32),
      usoTiss: true,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    const a = await c.incluirAssinatura(ctx, cert, trilha('profissional_assinatura'));
    const b = await c.incluirAssinatura(
      ctx,
      { ...cert, numeroSerie: 'F22B0102', vigenciaInicio: '2026-06-01' },
      trilha('profissional_assinatura'),
    );
    await expect(c.incluirAssinatura(ctx, { ...cert, tipo: 'imagem' }, trilha('x'))).rejects.toMatchObject({
      problema: { codigo: 'imagem-sem-arquivo' },
    });
    const la = await um('SELECT vigencia_fim, ativo FROM profissional_assinatura WHERE id = ?', [a]);
    expect(la!['vigencia_fim']).not.toBeNull();
    expect(Number(la!['ativo'])).toBe(1);
    const lista = (await c.complemento(ctx, m!.profissional)).assinaturas;
    expect(lista.filter((x) => x.vigente).map((x) => x.id)).toEqual([b]);
    const vb = lista.find((x) => x.id === b)!.versao;
    await c.encerrar(
      ctx,
      'profissional_assinatura',
      { profissional: m!.profissional, id: b, versao: vb, fim: null },
      trilha('x'),
    );
    const n = await um<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM profissional_assinatura WHERE profissional_id = ? AND excluido_em IS NULL',
      [m!.profissional],
    );
    expect(Number(n!.n)).toBe(2);
    const trilhas = await um<{ n: unknown }>(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'profissional_assinatura' AND entidade_id IN (?, ?)`,
      [String(a), String(b)],
    );
    expect(Number(trilhas!.n)).toBeGreaterThanOrEqual(3);
  });
});
