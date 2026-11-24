// Contrato de efeito do complemento do profissional (F3.1, 02-CAD linha 16) contra o MariaDB real, no cliente de teste
// f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica no banco: dado
// fiscal com vigência (o anterior aberto encerra na véspera; sobreposição recusa), conta e chave de pagamento (uma
// principal, favorecido terceiro só confirmado, inativar passa a principal), RQE (exige o registro na UF, de um só
// profissional, volta na mesma linha só com o mesmo número) e assinatura (uma vigente por tipo, série de um só
// profissional, imagem só da finalidade da assinatura; encerrar não apaga). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
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
  FINALIDADE_ASSINATURA,
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
    for (const t of TABELAS)
      await e.executar(`DELETE FROM ${t} WHERE profissional_id IN (?, ?)`, [m.profissional, m.enfermeira]);
    await e.executar("DELETE FROM arquivo WHERE chave_armazenamento LIKE 'f22-0102-compl/%'", []);
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
    if (m)
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, (e) =>
        limparTrilhaDaMassa(e, { ids: [m!.estabelecimento, m!.outroEstabelecimento] }),
      );
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
    // O do estabelecimento convive com o geral e vale sobre ele no dia; no mesmo escopo, sobreposição recusa.
    const est = await c.gravarDadoFiscal(
      ctx,
      fiscal({
        estabelecimento: m!.estabelecimento,
        vigenciaInicio: '2026-08-01',
        vigenciaFim: '2026-08-31',
      }),
      trilha('profissional_dado_fiscal'),
    );
    await expect(
      c.gravarDadoFiscal(
        ctx,
        fiscal({
          estabelecimento: m!.estabelecimento,
          vigenciaInicio: '2026-08-15',
          vigenciaFim: '2026-09-15',
        }),
        trilha('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-sobreposta' } });
    expect(
      (await c.destinoDoRepasse(ctx, m!.profissional, '2026-08-10', m!.estabelecimento)).dadoFiscal?.id,
    ).toBe(est);
    expect(
      (await c.destinoDoRepasse(ctx, m!.profissional, '2026-08-10', m!.outroEstabelecimento)).dadoFiscal?.id,
    ).toBe(b);
    expect((await c.destinoDoRepasse(ctx, m!.profissional, '2026-03-10', null)).dadoFiscal?.id).toBe(a);
    // Regra fiscal do domínio antes do banco: ISS fora de 2% a 5% e regime de empresa para pessoa física recusam.
    await expect(
      c.gravarDadoFiscal(ctx, fiscal({ vigenciaInicio: '2027-01-01', aliquotaIss: 10 }), trilha('x')),
    ).rejects.toMatchObject({ problema: { codigo: 'aliquota-iss-fora' } });
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
    // O repasse usa a conta principal ativa.
    expect((await c.destinoDoRepasse(ctx, m!.profissional, '2026-08-10', null)).conta?.id).toBe(a);
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
    // A volta com outro número recusa (o número registrado nunca é sobrescrito); com o mesmo número, volta na linha.
    await expect(c.incluirRqe(ctx, { ...e, numero: '45679' }, trilha('x'))).rejects.toMatchObject({
      problema: { codigo: 'rqe-numero-diferente' },
    });
    // O RQE ativo de outro profissional na mesma UF recusa a inclusão e a volta.
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, (w) =>
      w.executar(
        `INSERT INTO profissional_rqe (profissional_id, sequencia, numero_rqe, unidade_federativa_id,
            especialidade_medica_id, ativo, criado_em) VALUES (?, 1, '45678', ?, ?, TRUE, NOW(3))`,
        [m!.enfermeira, m!.uf, m!.especialidade],
      ),
    );
    await expect(c.incluirRqe(ctx, e, trilha('x'))).rejects.toMatchObject({
      problema: { codigo: 'rqe-de-outro' },
    });
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, (w) =>
      w.executar('UPDATE profissional_rqe SET ativo = FALSE WHERE profissional_id = ?', [m!.enfermeira]),
    );
    const volta = await c.incluirRqe(ctx, e, trilha('profissional_rqe'));
    expect(volta).toBe(id);
    const lista = (await c.complemento(ctx, m!.profissional)).rqes;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ numero: '45678', ativo: true, uf: siglaUf });
    expect(
      (await c.assinaturaNoDia(ctx, m!.profissional, 'imagem', '2026-08-10')).rqes.map((r) => r.id),
    ).toEqual([id]);
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
    const la = await um(
      "SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, ativo FROM profissional_assinatura WHERE id = ?",
      [a],
    );
    expect(la!['fim']).toBe('2026-05-31');
    expect(Number(la!['ativo'])).toBe(1);
    // Sobreposição com a de fim informado (a encerrada) ou com a nova: recusa, nunca duas vigentes no mesmo dia.
    await expect(
      c.incluirAssinatura(
        ctx,
        { ...cert, numeroSerie: 'F22D0102', vigenciaInicio: '2026-05-15', vigenciaFim: '2026-05-20' },
        trilha('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'vigencia-sobreposta' } });
    // A série de outro profissional recusa.
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, (w) =>
      w.executar(
        `INSERT INTO profissional_assinatura (profissional_id, tipo, certificado_titular, certificado_numero_serie,
            uso_tiss, vigencia_inicio, ativo, criado_em) VALUES (?, 'certificado_digital', ?, 'F22E0102', FALSE,
            '2026-01-01', TRUE, NOW(3))`,
        [m!.enfermeira, `OUTRO ${MARCA}`],
      ),
    );
    await expect(
      c.incluirAssinatura(
        ctx,
        { ...cert, numeroSerie: 'F22E0102', vigenciaInicio: '2027-01-01' },
        trilha('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'certificado-de-outro' } });
    expect(
      (await c.assinaturaNoDia(ctx, m!.profissional, 'certificado_digital', '2026-05-31')).assinatura?.id,
    ).toBe(a);
    expect(
      (await c.assinaturaNoDia(ctx, m!.profissional, 'certificado_digital', '2026-06-01')).assinatura?.id,
    ).toBe(b);
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

  it('assinatura em imagem: só o arquivo enviado como assinatura deste profissional (nunca o de um paciente)', async () => {
    const ctx = contextoPorta(m!);
    const arquivo = async (sufixo: string, finalidade: string, entidade: string, dono: number) => {
      let id = 0;
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-compl' }, async (w) => {
        await w.executar(
          `INSERT INTO arquivo (estabelecimento_id, entidade, entidade_id, finalidade, nome_original, tipo_mime,
              tamanho_bytes, hash_sha256, chave_armazenamento, criado_em) VALUES (?, ?, ?, ?, 'a.png', 'image/png', 10, ?, ?, NOW(3))`,
          [
            m!.estabelecimento,
            entidade,
            dono,
            finalidade,
            sufixo.padEnd(64, '0'),
            `f22-0102-compl/${sufixo}`,
          ],
        );
        const r = await w.uma<{ id: unknown }>('SELECT id FROM arquivo WHERE chave_armazenamento = ?', [
          `f22-0102-compl/${sufixo}`,
        ]);
        id = Number(r!.id);
      });
      return id;
    };
    const img = {
      profissional: m!.profissional,
      tipo: 'imagem' as const,
      titular: null,
      numeroSerie: null,
      emissor: null,
      impressaoDigital: null,
      usoTiss: false,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    };
    const dePaciente = await arquivo('a1', 'imagem', 'paciente', m!.profissional);
    const deOutro = await arquivo('a2', FINALIDADE_ASSINATURA, 'profissional', m!.enfermeira);
    const certo = await arquivo('a3', FINALIDADE_ASSINATURA, 'profissional', m!.profissional);
    for (const x of [dePaciente, deOutro])
      await expect(c.incluirAssinatura(ctx, { ...img, arquivo: x }, trilha('x'))).rejects.toMatchObject({
        problema: { codigo: 'arquivo-nao-e-assinatura' },
      });
    const id = await c.incluirAssinatura(ctx, { ...img, arquivo: certo }, trilha('profissional_assinatura'));
    expect((await c.assinaturaNoDia(ctx, m!.profissional, 'imagem', '2026-08-10')).assinatura?.id).toBe(id);
    // O envio pela tela confere o conteúdo: o que não é PNG nem JPEG recusa antes de guardar.
    await expect(
      c.enviarImagemAssinatura(
        ctx,
        {
          profissional: m!.profissional,
          conteudo: new TextEncoder().encode('%PDF-1.7 nao e imagem'),
          nomeOriginal: 'x.pdf',
          usoTiss: false,
          vigenciaInicio: '2026-01-01',
          vigenciaFim: null,
        },
        trilha('x'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'arquivo-nao-imagem' } });
  });
});
