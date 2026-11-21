// Integração da porta própria da assinatura ICP-Brasil contra o MariaDB real (cliente f22_o2, lote 02-01). A massa é
// SINTÉTICA e idempotente (estabelecimentos, conta, profissional e catálogos com o prefixo do lote); no fim, a massa
// que muda (certificados, provedores, consultas e documentos) é apagada. A trilha fica (é só de inclusão).
// Contrato de efeito: cada gravação confere as linhas, a versão, a trilha (pela correlação) e as recusas (repetido,
// versão desatualizada, outro estabelecimento) e o motor inteiro da assinatura (política, pedido, prévia, tentativa, conclusão
// com envelope e evento, avisos e numeração). A mesma bateria do certificado e do provedor
// roda também na porta em memória. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ErroOperacao, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoAssinatura, GravadorAssinatura, PortaAssinaturaIcp } from './porta.js';
import { PortaAssinaturaMemoria } from './porta-memoria.js';
import { PortaAssinaturaPropria } from './porta-propria.js';
import { type CertificadoParaGravar, ErroAssinatura, type TrilhaAssinatura } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0201';
const LOGIN = 'l0201.autor';
const OUTRO_LOGIN = 'l0201.outro';
const CPF = '20100000001';
const CODIGO_VERIFICACAO = 'L0201codigoVerificacao0001';
const CODIGO_PARCIAL = 'L0201codigoVerificacao0002';
const CODIGO_REVOGADA = 'L0201codigoVerificacao0003';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

const codigoDe = (e: unknown) =>
  e instanceof ErroAssinatura ? e.codigo : e instanceof ErroOperacao ? String(e.problema.codigo ?? '') : null;

async function erroDe(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return codigoDe(e);
  }
}

function certificado(hospital: string, usuario: string, der = randomBytes(64)): CertificadoParaGravar {
  return {
    hospital,
    usuario,
    midia: 'a3',
    provedor: null,
    idTipoCertificado: null,
    serie: der.subarray(0, 8).toString('hex'),
    emissorHash: createHash('sha256').update(der.subarray(8, 16)).digest('hex'),
    tipoIcp: null,
    validoDe: new Date('2026-01-01T00:00:00.000Z'),
    validoAte: new Date('2028-01-01T00:00:00.000Z'),
    cpfMascarado: '***.000.000-**',
    certificadoDer: der.toString('base64'),
  };
}

const trilhaDe = (c: ContextoAssinatura, tabela: string, evento: string) => (x: { id: number }) =>
  ({
    estabelecimento: c.estabelecimento ?? null,
    usuario: c.usuario ?? null,
    acao: 'operacao',
    entidade: tabela,
    entidadeId: x.id,
    dadosDepois: { evento, recurso: 'documento.certificado', operacao: 'teste', chave: `${P}:${evento}` },
    correlacao: c.correlacao ?? null,
  }) satisfies TrilhaAssinatura;

const provedor = (hospital: string, codigo: string, nome = 'Provedor sintético') => ({
  hospital,
  codigo,
  nome,
  uriBase: 'https://psc.invalido.test',
  clientId: 'cliente-sintetico',
  autoridades: ['ac-sintetica'],
  ativo: true,
  segredoRef: `cofre:psc/${hospital}/${codigo}/client-secret`,
  por: LOGIN,
  em: new Date(),
});

describe.skipIf(SEM_BANCO)('porta própria da assinatura ICP (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAssinaturaPropria;
  const ids = { est: 0, outroEst: 0, usuario: 0, outro: 0, prof: 0, conselho: 0, pessoa: 0, paciente: 0 };
  const ids2 = { tipoDoc: 0, situacao: 0, tipoCert: 0, rascunho: 0 };
  let ctx: ContextoAssinatura;

  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'l0201-conferencia' }, (l) => l.consultar(sql, p));
  const novoCtx = (o: Partial<ContextoAssinatura> = {}): ContextoAssinatura => ({
    ...ctx,
    correlacao: `l0201-${randomUUID().slice(0, 18)}`,
    ...o,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar('DELETE FROM consulta_verificacao_documento WHERE codigo_informado LIKE ?', [`${P}%`]);
      // O motor da assinatura, na ordem das chaves estrangeiras.
      await e.executar('DELETE FROM aviso_assinatura WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE v FROM validacao_assinatura v JOIN assinatura_icp a ON a.id = v.assinatura_icp_id WHERE a.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('UPDATE documento_prontuario SET documento_assinado_id = NULL WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM assinatura_icp WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM previa_assinatura WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM pedido_assinatura WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM pedido_numeracao_receita WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar(
        'DELETE ev FROM documento_prontuario_evento ev JOIN documento_prontuario d ON d.id = ev.documento_prontuario_id WHERE d.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar(
        'DELETE r FROM regra_politica_assinatura r JOIN politica_assinatura p ON p.id = r.politica_assinatura_id WHERE p.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM politica_assinatura WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM emissao_documento WHERE chave_objeto LIKE ?', [`${P}/%`]);
      await e.executar(
        'DELETE a FROM assinatura_documento a JOIN documento_assinado d ON d.id = a.documento_assinado_id WHERE d.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM documento_prontuario WHERE estabelecimento_id = ? AND titulo LIKE ?', [ids.est, `${P}%`]);
      await e.executar('DELETE FROM documento_assinado WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM arquivo WHERE chave_armazenamento LIKE ?', [`${P}/%`]);
      await e.executar('DELETE FROM certificado_usuario WHERE usuario_id IN (?, ?)', [ids.usuario, ids.outro]);
      await e.executar('DELETE FROM provedor_assinatura_nuvem WHERE codigo LIKE ?', ['l0201-%']);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-preparo' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em, versao) VALUES (?, ?, ?, ?, 1)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo}`, agora],
        );
      ids.est = await est(`${P}A`);
      ids.outroEst = await est(`${P}B`);
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em, versao) VALUES (?, ?, ?, ?, 1)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      ids.usuario = await usuario(LOGIN, CPF);
      ids.outro = await usuario(OUTRO_LOGIN, '20100000002');
      ids.pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE cpf = ?',
        [CPF],
        'INSERT INTO pessoa_fisica (nome, cpf, criado_em, versao) VALUES (?, ?, ?, 1)',
        ['Profissional Sintético L0201', CPF, agora],
      );
      ids.prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [ids.pessoa],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em, versao) VALUES (?, 'corpo_clinico', ?, 1)",
        [ids.pessoa, agora],
      );
      ids.conselho = await garantir(
        e,
        'SELECT id FROM conselho_classe WHERE sigla = ?',
        ['LZCRM'],
        'INSERT INTO conselho_classe (codigo_tiss, sigla, descricao, criado_em, versao) VALUES (?, ?, ?, ?, 1)',
        ['Z1', 'LZCRM', 'Conselho sintético do lote 02-01', agora],
      );
      const pais = await garantir(
        e,
        "SELECT id FROM pais_referencia WHERE codigo_iso = 'BR'",
        [],
        "INSERT INTO pais_referencia (codigo_iso, descricao, criado_em, versao) VALUES ('BR', 'Brasil', ?, 1)",
        [agora],
      );
      const uf = await garantir(
        e,
        "SELECT id FROM unidade_federativa WHERE sigla = 'RJ'",
        [],
        "INSERT INTO unidade_federativa (codigo_ibge, sigla, descricao, pais_referencia_id, criado_em, versao) VALUES ('33', 'RJ', 'Rio de Janeiro', ?, ?, 1)",
        [pais, agora],
      );
      await garantir(
        e,
        'SELECT id FROM inscricao_conselho WHERE profissional_id = ? AND sequencia = 1',
        [ids.prof],
        `INSERT INTO inscricao_conselho (profissional_id, sequencia, conselho_classe_id, unidade_federativa_id,
           numero_inscricao, principal, criado_em, versao) VALUES (?, 1, ?, ?, '201001', TRUE, ?, 1)`,
        [ids.prof, ids.conselho, uf, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_vinculo_profissional WHERE usuario_id = ? AND estabelecimento_id = ?',
        [ids.usuario, ids.est],
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio,
           criado_em, versao) VALUES (?, ?, ?, '2026-01-01', ?, 1)`,
        [ids.usuario, ids.est, ids.prof, agora],
      );
      ids2.tipoCert = await garantir(
        e,
        'SELECT id FROM tipo_certificado WHERE codigo = ?',
        ['l0201-nuvem'],
        `INSERT INTO tipo_certificado (codigo, descricao, modalidade, repositorio, exige_provedor, criado_em, versao)
         VALUES ('l0201-nuvem', 'Nuvem sintética L0201', 'nuvem', 'nuvem', TRUE, ?, 1)`,
        [agora],
      );
      await garantir(
        e,
        "SELECT id FROM formato_assinatura_icp WHERE familia = 'pades' AND politica = 'ad_rb'",
        [],
        `INSERT INTO formato_assinatura_icp (codigo, descricao, familia, politica, criado_em, versao)
         VALUES ('l0201-pades-rb', 'PAdES AD-RB', 'pades', 'ad_rb', ?, 1)`,
        [agora],
      );
      await garantir(
        e,
        'SELECT id FROM oid_icp WHERE codigo = ?',
        ['l0201-crm'],
        `INSERT INTO oid_icp (codigo, descricao, oid, tipo_oid, conselho_classe_id, criado_em, versao)
         VALUES ('l0201-crm', 'Registro no conselho sintético', '2.16.76.1.4.2.2.20101', 'registro_conselho', ?, ?, 1)`,
        [ids.conselho, agora],
      );
      const pessoaPaciente = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ? AND cpf IS NULL',
        ['Paciente Sintético L0201'],
        'INSERT INTO pessoa_fisica (nome, criado_em, versao) VALUES (?, ?, 1)',
        ['Paciente Sintético L0201', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoaPaciente],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em, versao) VALUES (?, ?, ?, 1)',
        [pessoaPaciente, 9_020_100_001, agora],
      );
      ids2.tipoDoc = await garantir(
        e,
        "SELECT id FROM tipo_documento_clinico WHERE codigo = 'atestado'",
        [],
        "INSERT INTO tipo_documento_clinico (codigo, descricao, categoria, criado_em, versao) VALUES ('atestado', 'Atestado', 'atestado', ?, 1)",
        [agora],
      );
      ids2.situacao = await garantir(
        e,
        'SELECT id FROM situacao_documento_prontuario WHERE codigo = ?',
        ['l0201-lancado'],
        "INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, criado_em, versao) VALUES ('l0201-lancado', 'Lançado', 'lancado', ?, 1)",
        [agora],
      );
      ids2.rascunho = await garantir(
        e,
        'SELECT id FROM situacao_documento_prontuario WHERE codigo = ?',
        ['l0201-rascunho'],
        "INSERT INTO situacao_documento_prontuario (codigo, descricao, categoria, permite_edicao, criado_em, versao) VALUES ('l0201-rascunho', 'Rascunho', 'rascunho', TRUE, ?, 1)",
        [agora],
      );
      await limpar(e);
    });
    porta = new PortaAssinaturaPropria(nucleo, CLIENTE);
    ctx = {
      rede: 'rede-sintetica',
      hospital: `${P}A`,
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: 'l0201-leitura',
    };
  }, 180_000);

  afterAll(async () => {
    if (!nucleo) return;
    if (ids.est) await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-limpeza' }, limpar);
    await nucleo.encerrar();
  });

  it('identidade: CPF da conta e do profissional ligado, e as inscrições no conselho; login desconhecido é null', async () => {
    expect(await porta.identidade(ctx, LOGIN)).toEqual({
      cpf: CPF,
      cpfProfissional: CPF,
      registros: [{ cbo: null, sigla: 'LZCRM', uf: 'RJ', numero: '201001' }],
    });
    // No outro estabelecimento a conta não tem vínculo de profissional.
    expect(await porta.identidade({ ...ctx, estabelecimento: ids.outroEst, hospital: `${P}B` }, LOGIN)).toEqual({
      cpf: CPF,
      cpfProfissional: null,
      registros: [],
    });
    expect(await porta.identidade(ctx, 'l0201.ninguem')).toBeNull();
  });

  it('catálogos: formas, tipos de certificado, conselhos e OIDs de registro', async () => {
    expect((await porta.formasIcp(ctx)).some((f) => f.politica === 'AD-RB')).toBe(true);
    expect(await porta.tiposCertificado(ctx)).toContainEqual({
      id: ids2.tipoCert,
      nome: 'Nuvem sintética L0201',
      ativo: true,
    });
    expect(await porta.conselhos(ctx)).toContain('LZCRM');
    expect(await porta.oidsDeConselho(ctx)).toContainEqual({ oid: '2.16.76.1.4.2.2.20101', conselho: 'LZCRM' });
  });

  it('vincular certificado: linha, impressão digital, padrão, versão e trilha; repetido é recusado sem gravar', async () => {
    const c = novoCtx();
    const x = certificado(ctx.hospital, LOGIN);
    const { id } = await porta.gravar(c, (g) => g.gravarCertificado(x), trilhaDe(c, 'certificado_usuario', 'vinculado'));
    const [linha] = await ler(
      'SELECT usuario_id, impressao_digital, padrao, situacao, cpf_titular, numero_serie, versao FROM certificado_usuario WHERE id = ?',
      [id],
    );
    expect(linha).toMatchObject({
      usuario_id: ids.usuario,
      impressao_digital: createHash('sha256').update(Buffer.from(x.certificadoDer, 'base64')).digest('hex'),
      padrao: 1,
      situacao: 'ativo',
      cpf_titular: CPF,
      numero_serie: x.serie,
      versao: 1,
    });
    const trilha = await ler(
      'SELECT entidade, entidade_id, estabelecimento_id, usuario_id, dados_depois FROM trilha_auditoria WHERE correlacao = ?',
      [c.correlacao],
    );
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({
      entidade: 'certificado_usuario',
      entidade_id: id,
      estabelecimento_id: ids.est,
      usuario_id: ids.usuario,
    });
    expect(JSON.stringify(trilha[0]!['dados_depois'])).toContain('vinculado');
    expect(JSON.stringify(trilha[0]!['dados_depois'])).not.toContain(CPF);
    // A lista e a leitura por id.
    const lista = await porta.certificados(ctx, LOGIN);
    expect(lista.map((l) => l.id)).toContain(id);
    expect(lista.find((l) => l.id === id)).toMatchObject({ ativo: true, cpfMascarado: expect.not.stringContaining(CPF) });
    expect((await porta.certificado(ctx, id))?.usuario).toBe(LOGIN);
    // O mesmo certificado de novo: recusa de negócio, nenhuma linha nem trilha a mais.
    const c2 = novoCtx();
    expect(await erroDe(porta.gravar(c2, (g) => g.gravarCertificado(x), null))).toBe('certificado-ja-vinculado');
    expect(await ler('SELECT id FROM certificado_usuario WHERE usuario_id = ?', [ids.usuario])).toHaveLength(1);
    expect(await ler('SELECT id FROM trilha_auditoria WHERE correlacao = ?', [c2.correlacao])).toHaveLength(0);
  });

  it('desvincular: exclusão lógica com nova versão; some da lista, segue legível por id; de outro login não acha', async () => {
    const c = novoCtx();
    const { id } = await porta.gravar(c, (g) => g.gravarCertificado(certificado(ctx.hospital, LOGIN)), null);
    const de = (usuario: string) => ({ hospital: ctx.hospital, usuario, id, por: usuario, em: new Date() });
    expect(await porta.gravar(novoCtx(), (g) => g.inativarCertificado(de(OUTRO_LOGIN)), null)).toBe(false);
    expect(await porta.gravar(novoCtx(), (g) => g.inativarCertificado(de(LOGIN)), null)).toBe(true);
    const [linha] = await ler('SELECT versao, excluido_em, excluido_por, padrao FROM certificado_usuario WHERE id = ?', [id]);
    expect(linha).toMatchObject({ versao: 2, excluido_por: ids.usuario, padrao: 0 });
    expect(linha!['excluido_em']).not.toBeNull();
    expect((await porta.certificados(ctx, LOGIN)).map((l) => l.id)).not.toContain(id);
    expect((await porta.certificado(ctx, id))?.ativo).toBe(false);
    expect(await porta.gravar(novoCtx(), (g) => g.inativarCertificado(de(LOGIN)), null)).toBe(false);
  });

  it('provedor: inclusão no estabelecimento, alteração com versão, conflito, repetido e invisível no outro estabelecimento', async () => {
    const p = provedor(ctx.hospital, 'l0201-psc');
    const r = await porta.gravar(novoCtx(), (g) => g.gravarProvedor(p, null), null);
    expect(r.versao).toBe(1);
    const [linha] = await ler(
      'SELECT estabelecimento_id, tipo_certificado_id, referencia_cofre, url_servico, versao FROM provedor_assinatura_nuvem WHERE id = ?',
      [r.id],
    );
    expect(linha).toMatchObject({
      estabelecimento_id: ids.est,
      tipo_certificado_id: ids2.tipoCert,
      referencia_cofre: p.segredoRef,
      url_servico: p.uriBase,
      versao: 1,
    });
    expect(await porta.provedor(ctx, 'l0201-psc')).toMatchObject({ codigo: 'l0201-psc', versao: 1, alteradoPor: LOGIN });
    const alterado = await porta.gravar(
      novoCtx(),
      (g) => g.gravarProvedor(provedor(ctx.hospital, 'l0201-psc', 'Provedor renomeado'), 1),
      null,
    );
    expect(alterado).toEqual({ id: r.id, versao: 2 });
    expect((await porta.provedores(ctx)).find((x) => x.codigo === 'l0201-psc')?.nome).toBe('Provedor renomeado');
    expect(await erroDe(porta.gravar(novoCtx(), (g) => g.gravarProvedor(p, 1), null))).toBe('versao-desatualizada');
    expect(await erroDe(porta.gravar(novoCtx(), (g) => g.gravarProvedor(p, null), null))).toBe('provedor-repetido');
    const fora = { ...ctx, estabelecimento: ids.outroEst, hospital: `${P}B` };
    expect(await porta.provedor(fora, 'l0201-psc')).toBeNull();
    expect(await erroDe(porta.gravar(novoCtx(fora), (g) => g.gravarProvedor(p, 2), null))).toBe('versao-desatualizada');
    // Sem estabelecimento resolvido: recusa, nada de provedor da rede inteira.
    const semEst: ContextoAssinatura = { rede: 'rede-sintetica', hospital: `${P}Inexistente`, correlacao: `l0201-semest-${randomUUID().slice(0, 8)}` };
    expect(await erroDe(porta.gravar(semEst, (g) => g.gravarProvedor(provedor(`${P}A`, 'l0201-rede'), null), null))).toBe(
      'estabelecimento-ausente',
    );
    expect(await ler('SELECT id FROM provedor_assinatura_nuvem WHERE codigo = ?', ['l0201-rede'])).toHaveLength(0);
    // O mesmo código no outro estabelecimento, com credencial própria. Enquanto o banco tiver a unicidade antiga (só o
    // código, no cliente inteiro: pedido de troca em saida/02-01.json), a inclusão é recusada como repetida.
    const [ix] = await ler(
      `SELECT COUNT(*) AS colunas FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'provedor_assinatura_nuvem'
          AND INDEX_NAME = 'uq_provedor_assinatura_nuvem_codigo'`,
    );
    const pb = provedor(`${P}B`, 'l0201-psc');
    const noOutro = porta.gravar(novoCtx(fora), (g) => g.gravarProvedor(pb, null), null);
    if (Number(ix!['colunas']) === 1) {
      expect(await erroDe(noOutro)).toBe('provedor-repetido');
    } else {
      const b = await noOutro;
      expect(b.id).not.toBe(r.id);
      const [lb] = await ler('SELECT estabelecimento_id, referencia_cofre FROM provedor_assinatura_nuvem WHERE id = ?', [b.id]);
      expect(lb).toEqual({ estabelecimento_id: ids.outroEst, referencia_cofre: pb.segredoRef });
      expect(await porta.provedor(fora, 'l0201-psc')).toMatchObject({ id: b.id, segredoRef: pb.segredoRef });
      expect(await porta.provedor(ctx, 'l0201-psc')).toMatchObject({ id: r.id, versao: 2 });
    }
  });

  it('verificador: documento achado pelo código só no estabelecimento dele; consulta gravada sem usuário e resumida', async () => {
    const agora = new Date();
    const gerado = new Date(agora.getTime() - 7_200_000);
    const doc = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-documento' }, async (e) => {
      const arquivo = await e.inserir(
        `INSERT INTO arquivo (estabelecimento_id, finalidade, nome_original, tipo_mime, tamanho_bytes, hash_sha256,
           chave_armazenamento, criado_em, versao) VALUES (?, 'documento_assinado', 'atestado.pdf', 'application/pdf', 1, ?, ?, ?, 1)`,
        [ids.est, 'a'.repeat(64), `${P}/atestado.pdf`, agora],
      );
      const d = await e.inserir(
        `INSERT INTO documento_assinado (estabelecimento_id, codigo_verificacao, tipo_documento, entidade, entidade_id,
           titulo, hash_conteudo, arquivo_id, nivel_exigido, politica_icp, gerado_em, situacao, criado_em, versao)
         VALUES (?, ?, 'atestado', 'documento_prontuario', 77, 'Atestado', ?, ?, 'icp-brasil', 'AD-RT', ?, 'assinado', ?, 1)`,
        [ids.est, CODIGO_VERIFICACAO, 'b'.repeat(64), arquivo, gerado, agora],
      );
      const cert = await e.inserir(
        `INSERT INTO certificado_usuario (usuario_id, midia, nome_titular, cpf_titular, emissor, numero_serie,
           impressao_digital, valido_de, valido_ate, criado_em, versao)
         VALUES (?, 'a3', 'Conta sintética', ?, 'emissor', 'serie', ?, '2026-01-01', '2028-01-01', ?, 1)`,
        [ids.outro, '20100000002', 'c'.repeat(64), agora],
      );
      const assinatura = (envelope: number, seq: number, situacao: string) =>
        e.inserir(
          `INSERT INTO assinatura_documento (documento_assinado_id, sequencia, signatario_usuario_id, profissional_id,
             nome_signatario, cpf_signatario, certificado_usuario_id, nivel, politica_icp, hash_assinado, assinado_em,
             carimbo_tempo_em, situacao, verificada_em, criado_em, versao)
           VALUES (?, ?, ?, ?, 'Profissional Sintético', '20100000002', ?, 'icp-brasil', 'AD-RT', ?, ?, ?, ?, ?, ?, 1)`,
          [envelope, seq, ids.outro, ids.prof, cert, 'd'.repeat(64), agora, agora, situacao, agora, agora],
        );
      const envelope = (codigo: string, situacao: string, exigidas: number) =>
        e.inserir(
          `INSERT INTO documento_assinado (estabelecimento_id, codigo_verificacao, tipo_documento, entidade, entidade_id,
             titulo, hash_conteudo, arquivo_id, nivel_exigido, politica_icp, assinaturas_exigidas, gerado_em, situacao,
             criado_em, versao)
           VALUES (?, ?, 'atestado', 'documento_prontuario', 78, 'Atestado', ?, ?, 'icp-brasil', 'AD-RT', ?, ?, ?, ?, 1)`,
          [ids.est, codigo, 'b'.repeat(64), arquivo, exigidas, gerado, situacao, agora],
        );
      await assinatura(d, 1, 'valida');
      // Envelope parcial: duas assinaturas exigidas, uma aplicada.
      await assinatura(await envelope(CODIGO_PARCIAL, 'parcial', 2), 1, 'valida');
      // Envelope com a primeira assinatura revogada e a segunda válida.
      const rev = await envelope(CODIGO_REVOGADA, 'assinado', 1);
      await assinatura(rev, 1, 'revogada');
      await assinatura(rev, 2, 'valida');
      return d;
    });
    const [lida] = await ler('SELECT assinado_em FROM assinatura_documento WHERE documento_assinado_id = ?', [doc]);
    const assinadoEm = new Date(lida!['assinado_em'] as Date).toISOString();
    const achado = await porta.documentoDoCodigo({ rede: 'rede-sintetica', hospital: `${P}A` }, CODIGO_VERIFICACAO);
    expect(achado).toMatchObject({
      previa: doc,
      documento: 77,
      tipo: 'atestado',
      suspenso: false,
      politicaIcp: 'AD-RT',
      profissional: 'Profissional Sintético',
      // A data da assinatura (não a da geração do envelope) e o registro principal ativo do signatário.
      assinarEm: assinadoEm,
      registro: 'LZCRM-RJ 201001',
      assinatura: { estado: 'assinada', hashPdf: 'd'.repeat(64) },
      validacao: { resultado: 'valida', momento: 'assinar' },
    });
    expect(achado!.assinarEm).not.toBe(achado!.emitidoEm);
    const pub = { rede: 'rede-sintetica', hospital: `${P}A` };
    // Parcial: pendente, sem validação; nunca "válido".
    expect(await porta.documentoDoCodigo(pub, CODIGO_PARCIAL)).toMatchObject({
      assinatura: { estado: 'pendente' },
      validacao: null,
    });
    // Uma assinatura revogada no envelope: falha e inválida, mesmo com a última válida.
    expect(await porta.documentoDoCodigo(pub, CODIGO_REVOGADA)).toMatchObject({
      assinatura: { estado: 'falha' },
      validacao: { resultado: 'invalida' },
    });
    expect(await porta.documentoDoCodigo({ rede: 'rede-sintetica', hospital: `${P}B` }, CODIGO_VERIFICACAO)).toBeNull();
    // A consulta pública: sem usuário, o estabelecimento pelo código; a origem já mascarada.
    const publico: ContextoAssinatura = { rede: 'rede-sintetica', hospital: `${P}A`, correlacao: `l0201-pub-${randomUUID().slice(0, 8)}` };
    const consulta = (resultado: 'valida' | 'nao-encontrado' | 'pendente', previa: number | null) =>
      porta.gravar(
        publico,
        (g) =>
          g.registrarConsultaPublica({
            hospital: `${P}A`,
            codigo: `${P}${resultado}`,
            documento: previa ? 77 : null,
            previa,
            resultado,
            origemMascarada: '203.0.113.0',
          }),
        null,
      );
    const { id } = await consulta('valida', doc);
    await consulta('nao-encontrado', null);
    const [linha] = await ler(
      'SELECT documento_assinado_id, resultado, canal, endereco_ip, codigo_informado FROM consulta_verificacao_documento WHERE id = ?',
      [id],
    );
    expect(linha).toEqual({
      documento_assinado_id: doc,
      resultado: 'autentico',
      canal: 'portal',
      endereco_ip: '203.0.113.0',
      codigo_informado: `${P}valida`,
    });
    const [t] = await ler('SELECT usuario_id, estabelecimento_id FROM trilha_auditoria WHERE correlacao = ? ORDER BY id LIMIT 1', [
      publico.correlacao,
    ]);
    expect(t).toEqual({ usuario_id: null, estabelecimento_id: ids.est });
    // Pendente também é guardado, no vocabulário do banco.
    await consulta('pendente', doc);
    expect(await ler('SELECT resultado FROM consulta_verificacao_documento WHERE codigo_informado = ?', [`${P}pendente`])).toEqual([
      { resultado: 'pendente' },
    ]);
    const resumo = await porta.resumoVerificacoes(ctx, new Date(Date.now() - 86_400_000));
    expect(resumo.find((r) => r.resultado === 'valida')?.consultas).toBeGreaterThanOrEqual(1);
    expect(resumo.find((r) => r.resultado === 'nao-encontrado')?.consultas).toBeGreaterThanOrEqual(1);
  });

  it('documento do prontuário: leitura do autor e fila ICP; outro estabelecimento e outro login não veem', async () => {
    const agora = new Date();
    const id = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-prontuario' }, (e) =>
      e.inserir(
        `INSERT INTO documento_prontuario (estabelecimento_id, paciente_id, tipo_documento_clinico_id,
           situacao_documento_prontuario_id, entidade_origem, entidade_origem_id, titulo, profissional_id,
           referencia_em, lancado_em, conteudo, criado_em, versao)
         VALUES (?, ?, ?, ?, 'registro_assistencial', ?, ?, ?, ?, ?, '{"texto":"sintético"}', ?, 1)`,
        [ids.est, ids.paciente, ids2.tipoDoc, ids2.situacao, Date.now() % 1_000_000_000, `${P} atestado`, ids.prof, agora, agora, agora],
      ),
    );
    expect(await porta.documentoEmitido(ctx, id)).toMatchObject({
      id,
      tipo: 'atestado',
      paciente: ids.paciente,
      usuario: LOGIN,
      suspenso: false,
      assinadoEm: null,
    });
    expect(await porta.documentoEmitido({ ...ctx, estabelecimento: ids.outroEst, hospital: `${P}B` }, id)).toBeNull();
    const fila = await porta.filaIcp(ctx, LOGIN, 10, ['atestado']);
    expect(fila.itens.map((i) => i.documento)).toContain(id);
    expect(fila.itens.find((i) => i.documento === id)).toMatchObject({ assinatura: null, estado: null, tentativas: 0 });
    expect((await porta.filaIcp(ctx, OUTRO_LOGIN, 10, ['atestado'])).itens).toEqual([]);
    expect((await porta.filaIcp(ctx, LOGIN, 10, ['receita'])).itens.map((i) => i.documento)).not.toContain(id);
    // Rascunho: fora da fila e recusado na leitura por id (suspenso para a assinatura).
    const rascunho = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-rascunho' }, (e) =>
      e.inserir(
        `INSERT INTO documento_prontuario (estabelecimento_id, paciente_id, tipo_documento_clinico_id,
           situacao_documento_prontuario_id, entidade_origem, entidade_origem_id, titulo, profissional_id,
           referencia_em, lancado_em, conteudo, criado_em, versao)
         VALUES (?, ?, ?, ?, 'registro_assistencial', ?, ?, ?, ?, ?, '{"texto":"sintético"}', ?, 1)`,
        [ids.est, ids.paciente, ids2.tipoDoc, ids2.rascunho, (Date.now() + 1) % 1_000_000_000, `${P} rascunho`, ids.prof, agora, agora, agora],
      ),
    );
    expect(await porta.documentoEmitido(ctx, rascunho)).toMatchObject({ id: rascunho, suspenso: true });
    expect((await porta.filaIcp(ctx, LOGIN, 10, ['atestado'])).itens.map((i) => i.documento)).not.toContain(rascunho);
  });

  it('motor ICP: política vigente, pedido de uso único, prévia, tentativa, conclusão com envelope e evento, avisos e numeração', async () => {
    const H = ctx.hospital;
    const agora = new Date();
    const gravar = <T extends { id: number }>(fn: (g: GravadorAssinatura) => Promise<T>, tabela: string, evento: string) => {
      const c = novoCtx();
      return porta.gravar(c, fn, trilhaDe(c, tabela, evento));
    };
    const sem = <T>(fn: (g: GravadorAssinatura) => Promise<T>) => porta.gravar(novoCtx(), fn, null);
    const doc = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-motor' }, (e) =>
      e.inserir(
        `INSERT INTO documento_prontuario (estabelecimento_id, paciente_id, tipo_documento_clinico_id,
           situacao_documento_prontuario_id, entidade_origem, entidade_origem_id, titulo, profissional_id,
           referencia_em, lancado_em, conteudo, criado_em, versao)
         VALUES (?, ?, ?, ?, 'registro_assistencial', ?, ?, ?, ?, ?, '{"texto":"sintético"}', ?, 1)`,
        [ids.est, ids.paciente, ids2.tipoDoc, ids2.situacao, (Date.now() + 7) % 1_000_000_000, `${P} motor`, ids.prof, agora, agora, agora],
      ),
    );
    const { id: cert } = await sem((g) => g.gravarCertificado(certificado(H, LOGIN)));

    // Política: a regra vigente por tipo, destino e conselho; a segunda mudança do dia altera a de hoje; inativar tira.
    const politica = (nivel: 'icp-brasil' | 'eletronica-avancada', ativa: boolean) =>
      gravar(
        (g) =>
          g.gravarPolitica({
            hospital: H,
            tipoDocumento: 'atestado',
            conselho: 'LZCRM',
            destino: 'interno',
            nivel,
            politicaIcp: 'AD-RT',
            idFormaIcp: null,
            formato: 'pades',
            ativa,
            justificativa: 'Regra sintética L0201',
            usuario: LOGIN,
          }),
        'regra_politica_assinatura',
        'politica',
      );
    const p1 = await politica('icp-brasil', true);
    const daChave = async () => (await porta.politicas(ctx)).filter((x) => x.conselho === 'LZCRM');
    expect(await daChave()).toEqual([
      expect.objectContaining({ id: p1.id, tipoDocumento: 'atestado', nivel: 'icp-brasil', politicaIcp: 'AD-RT', ativa: true, usuario: LOGIN }),
    ]);
    expect((await politica('eletronica-avancada', true)).id).toBe(p1.id);
    expect((await daChave()).map((x) => x.nivel)).toEqual(['eletronica-avancada']);
    await politica('icp-brasil', false);
    expect(await daChave()).toEqual([]);
    expect(await porta.politicas({ ...ctx, estabelecimento: ids.outroEst, hospital: `${P}B` })).toEqual([]);

    // Pedido de autorização: único pelo resumo do estado, gasto uma vez e só pela conta dona.
    const estado = createHash('sha256').update(randomUUID()).digest('hex');
    const pedido = {
      hospital: H,
      usuario: LOGIN,
      finalidade: 'documento' as const,
      midia: 'a3' as const,
      provedor: null,
      certificado: cert,
      stateHash: estado,
      pkceCifrado: null,
      hashes: ['f'.repeat(64)],
      documentos: [doc],
      expiraEm: new Date(Date.now() + 60_000),
    };
    await gravar((g) => g.gravarPedido(pedido), 'pedido_assinatura', 'pedido');
    expect(await erroDe(sem((g) => g.gravarPedido(pedido)))).toBe('pedido-repetido');
    expect(await sem((g) => g.consumirPedido(estado, { hospital: H, usuario: OUTRO_LOGIN }, new Date()))).toBeNull();
    expect(await sem((g) => g.consumirPedido(estado, { hospital: H, usuario: LOGIN }, new Date()))).toMatchObject({
      finalidade: 'documento',
      certificado: cert,
      hashes: ['f'.repeat(64)],
      documentos: [doc],
      vencido: false,
    });
    expect(await sem((g) => g.consumirPedido(estado, { hospital: H, usuario: LOGIN }, new Date()))).toBeNull();

    // Prévia: o PDF vira arquivo; a versão vem da coluna pedida ou da emissão registrada para a mesma chave.
    const [coluna] = await ler(
      "SELECT COUNT(*) AS q FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'arquivo' AND COLUMN_NAME = 'versao_objeto'",
    );
    const temColuna = Number(coluna!['q']) > 0;
    const emitir = (chave: string, versao: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-emissao' }, (e) =>
        e.inserir(
          `INSERT INTO emissao_documento (estabelecimento_id, codigo, rede, estabelecimento_codigo, modelo, versao_modelo,
             origem_tipo, origem_registro_id, via, hash_conteudo, chave_objeto, identificador_qr, autor, emitido_em,
             versao_objeto, situacao, confirmado_em, criado_em, versao)
           VALUES (?, ?, 'rede-sintetica', ?, 'pep', '1', 'pep-documento', ?, 1, ?, ?, ?, ?, ?, ?, 'emitida', ?, ?, 1)`,
          [ids.est, randomUUID(), H, doc, '1'.repeat(64), chave, randomUUID(), LOGIN, agora, versao, agora, agora],
        ),
      );
    const chavePrevia = `${P}/previa-${doc}.pdf`;
    await emitir(chavePrevia, 'v1');
    const previa = {
      hospital: H,
      documento: doc,
      usuario: LOGIN,
      certificado: cert,
      politicaIcp: 'AD-RT' as const,
      hashPdf: '1'.repeat(64),
      chaveS3: chavePrevia,
      versaoS3: 'v1',
      codigo: `${P}motor${doc}`,
      assinarEm: agora.toISOString(),
      profissional: 'Profissional Sintético',
      registro: 'LZCRM-RJ 201001',
    };
    if (!temColuna)
      expect(await erroDe(sem((g) => g.gravarPrevia({ ...previa, chaveS3: `${P}/sem-emissao.pdf`, codigo: `${P}x${doc}` })))).toBe(
        'modelo-pendente',
      );
    const { id: pv } = await gravar((g) => g.gravarPrevia(previa), 'previa_assinatura', 'previa');
    expect(await porta.previaMaisRecente(ctx, doc, LOGIN)).toMatchObject({ id: pv, chaveS3: chavePrevia, versaoS3: 'v1', codigo: previa.codigo });
    expect(await porta.previa({ ...ctx, estabelecimento: ids.outroEst, hospital: `${P}B` }, pv)).toBeNull();

    // Tentativa pendente com avisos: aparece na fila (mesmo fora dos tipos da política), na contagem e no reprocessamento.
    const tentativa = {
      hospital: H,
      origem: 'documento' as const,
      documento: doc,
      hash: '2'.repeat(64),
      formato: 'pades' as const,
      politicaIcp: 'AD-RT' as const,
      midia: 'a3' as const,
      provedor: null,
      certificado: cert,
      usuario: LOGIN,
      estado: 'pendente' as const,
      tentativas: 1,
      falha: 'carimbo-indisponivel',
      proximaEm: new Date(Date.now() - 1_000),
      assinatura: Buffer.from('cms sintético').toString('base64'),
      carimboToken: null,
      carimboEm: null,
      carimboSerie: null,
    };
    const { id: a } = await gravar(
      async (g) => {
        expect(await g.travarDocumentoParaAssinar(H, doc, null)).toBeNull();
        const r = await g.gravarAssinatura(tentativa);
        await g.gravarAssinaturaPdf({ assinatura: r.id, previa: pv });
        await g.gravarAviso({ hospital: H, assinatura: r.id, destinatario: 'autor', usuario: LOGIN, estado: 'pendente', falha: tentativa.falha });
        await g.gravarAviso({ hospital: H, assinatura: r.id, destinatario: 'diretor-tecnico', usuario: null, estado: 'pendente', falha: tentativa.falha });
        return r;
      },
      'assinatura_icp',
      'tentativa',
    );
    expect((await porta.filaIcp(ctx, LOGIN, 10, [])).itens.find((i) => i.documento === doc)).toMatchObject({
      assinatura: a,
      estado: 'pendente',
      tentativas: 1,
      falha: 'carimbo-indisponivel',
    });
    expect(await porta.pendentesVencidas(ctx, new Date(), 10)).toContainEqual({ id: a, usuario: LOGIN });
    expect(await porta.contagemPendencias(ctx)).toEqual({ pendentes: 1, falhas: 0 });
    expect((await porta.assinaturasDosDocumentos(ctx, [doc])).get(doc)).toEqual({ id: a, estado: 'pendente' });
    const doAutor = await porta.avisos(ctx, { autor: LOGIN });
    expect(doAutor).toEqual([expect.objectContaining({ assinatura: a, documento: doc, autor: LOGIN, destinatario: 'autor', estado: 'pendente' })]);
    const daDirecao = await porta.avisos(ctx, 'diretor-tecnico');
    expect(daDirecao).toHaveLength(1);
    const todos = [doAutor[0]!.id, daDirecao[0]!.id];
    expect(await sem((g) => g.marcarAvisosLidos(H, todos, { login: OUTRO_LOGIN, diretorTecnico: false }, new Date()))).toBe(0);
    expect(await sem((g) => g.marcarAvisosLidos(H, todos, { login: LOGIN, diretorTecnico: false }, new Date()))).toBe(1);
    expect(await porta.avisos(ctx, { autor: LOGIN })).toEqual([]);
    expect(await porta.avisos(ctx, 'diretor-tecnico')).toHaveLength(1);

    // Conclusão: a leitura desatualizada não muda nada; a certa conclui, grava o envelope, a assinatura nele e o evento.
    const conclusao = {
      id: a,
      hospital: H,
      estadoLido: 'pendente' as const,
      tentativasLidas: 0,
      estado: 'assinada' as const,
      tentativas: 2,
      falha: null,
      proximaEm: null,
      carimboToken: Buffer.from('carimbo sintético').toString('base64'),
      carimboEm: agora,
      carimboSerie: 'serie-sintetica',
    };
    expect(await sem((g) => g.atualizarAssinatura(conclusao, new Date()))).toBe(false);
    await gravar(
      async (g) => {
        expect(await g.travarDocumentoParaAssinar(H, doc, a)).toBeNull();
        expect(await g.atualizarAssinatura({ ...conclusao, tentativasLidas: 1 }, new Date())).toBe(true);
        await g.gravarEventoAssinadoIcp({ hospital: H, usuario: LOGIN }, doc, false);
        await g.gravarValidacao({
          assinatura: a,
          momento: 'assinar',
          resultado: 'valida',
          cadeia: true,
          vigencia: true,
          revogacao: true,
          cpf: true,
          assinaturaConfere: true,
          carimbo: true,
          motivos: [],
          usuario: LOGIN,
          em: new Date(),
        });
        return { id: a };
      },
      'assinatura_icp',
      'concluida',
    );
    expect(await sem((g) => g.travarDocumentoParaAssinar(H, doc, null))).toBe('assinada');
    const [envelope] = await ler(
      `SELECT da.codigo_verificacao, da.situacao, da.nivel_exigido, ad.signatario_usuario_id, ad.nivel, ad.profissional_id
         FROM documento_prontuario dp
         JOIN documento_assinado da ON da.id = dp.documento_assinado_id
         JOIN assinatura_documento ad ON ad.documento_assinado_id = da.id
        WHERE dp.id = ?`,
      [doc],
    );
    expect(envelope).toEqual({
      codigo_verificacao: previa.codigo,
      situacao: 'assinado',
      nivel_exigido: 'icp-brasil',
      signatario_usuario_id: ids.usuario,
      nivel: 'icp-brasil',
      profissional_id: ids.prof,
    });
    expect(await ler('SELECT acao, usuario_id FROM documento_prontuario_evento WHERE documento_prontuario_id = ?', [doc])).toEqual([
      { acao: 'assinatura', usuario_id: ids.usuario },
    ]);
    expect(await porta.documentoDoCodigo({ rede: 'rede-sintetica', hospital: H }, previa.codigo)).toMatchObject({
      documento: doc,
      tipo: 'atestado',
      assinatura: { estado: 'assinada' },
    });
    expect((await porta.filaIcp(ctx, LOGIN, 10, ['atestado'])).itens.map((i) => i.documento)).not.toContain(doc);
    expect(await porta.contagemPendencias(ctx)).toEqual({ pendentes: 0, falhas: 0 });
    expect((await porta.assinadosRecentes(ctx, LOGIN)).find((x) => x.assinatura === a)).toMatchObject({
      documento: doc,
      tipo: 'atestado',
      codigo: previa.codigo,
      temPdf: false,
      resultado: 'valida',
    });
    expect((await porta.assinaturas(ctx, LOGIN, 'documento')).find((x) => x.id === a)).toMatchObject({
      estado: 'assinada',
      validacao: { resultado: 'valida', cadeia: true, motivos: [] },
    });

    // O PDF assinado: uma vez só, e no envelope.
    const chaveAssinado = `${P}/assinado-${a}.pdf`;
    await emitir(chaveAssinado, 'v2');
    const pdf = { assinatura: a, chaveS3: chaveAssinado, versaoS3: 'v2', hashPdf: '3'.repeat(64) };
    expect(await sem((g) => g.registrarPdfAssinado(pdf, new Date()))).toBe(true);
    expect(await sem((g) => g.registrarPdfAssinado(pdf, new Date()))).toBe(false);
    expect(await porta.assinaturaDocumento(ctx, a)).toMatchObject({
      documento: doc,
      estado: 'assinada',
      tentativas: 2,
      previa: pv,
      carimboToken: conclusao.carimboToken,
      pdf: { chaveS3: chaveAssinado, versaoS3: 'v2', hashPdf: '3'.repeat(64) },
    });
    const [comPdf] = await ler(
      'SELECT da.arquivo_assinado_id IS NOT NULL AS tem FROM documento_prontuario dp JOIN documento_assinado da ON da.id = dp.documento_assinado_id WHERE dp.id = ?',
      [doc],
    );
    expect(Number(comPdf!['tem'])).toBe(1);

    // Numeração da receita controlada: o pedido, a resposta uma vez, e o documento aceita um número só.
    const { id: sn } = await gravar(
      (g) => g.gravarSolicitacaoSncr({ hospital: H, documento: doc, origemId: 1, tipo: 'controle-especial', medicamentos: 2, usuario: LOGIN }),
      'pedido_numeracao_receita',
      'numeracao',
    );
    const resposta = { id: sn, hospital: H, situacao: 'numerada' as const, tentativas: 1, numero: 'N-0001', retorno: 'ok' };
    expect(
      await sem(async (g) => [await g.atualizarSolicitacaoSncr(resposta, new Date()), await g.gravarNumeroSncr(H, doc, 'N-0001')]),
    ).toEqual([true, true]);
    expect(await sem((g) => g.atualizarSolicitacaoSncr(resposta, new Date()))).toBe(false);
    expect(await sem((g) => g.gravarNumeroSncr(H, doc, 'N-0002'))).toBe(false);
    expect(await porta.solicitacoesSncr(ctx, doc)).toEqual([
      { id: sn, documento: doc, situacao: 'numerada', tentativas: 1, numero: 'N-0001', retorno: 'ok' },
    ]);
    expect(await porta.solicitacoesSncr({ ...ctx, estabelecimento: ids.outroEst, hospital: `${P}B` }, doc)).toEqual([]);
  });
});

/** A mesma bateria do certificado e do provedor sobre as duas portas (memória sempre; banco quando há). */
const fabricas: [string, () => Promise<{ porta: PortaAssinaturaIcp; c: ContextoAssinatura; fim: () => Promise<void> }>][] = [
  [
    'memória',
    async () => ({ porta: new PortaAssinaturaMemoria(), c: { rede: 'rede-sintetica', hospital: `${P}A` }, fim: async () => {} }),
  ],
];
if (!SEM_BANCO)
  fabricas.push([
    'banco',
    async () => {
      const nucleo = new NucleoProprio();
      const [u] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'l0201-bateria' }, (l) =>
        l.consultar('SELECT id FROM usuario WHERE login = ?', [LOGIN]),
      );
      const [e] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'l0201-bateria' }, (l) =>
        l.consultar('SELECT id FROM estabelecimento WHERE codigo = ?', [`${P}A`]),
      );
      return {
        porta: new PortaAssinaturaPropria(nucleo, CLIENTE),
        c: {
          rede: 'rede-sintetica',
          hospital: `${P}A`,
          cliente: CLIENTE,
          estabelecimento: Number(e!['id']),
          usuario: Number(u!['id']),
          correlacao: 'l0201-bateria',
        },
        fim: async () => {
          await nucleo.escrever({ cliente: CLIENTE, correlacao: 'l0201-bateria-fim' }, async (x) => {
            await x.executar('DELETE FROM certificado_usuario WHERE usuario_id = ?', [Number(u!['id'])]);
            await x.executar('DELETE FROM provedor_assinatura_nuvem WHERE codigo = ?', ['l0201-bateria']);
          });
          await nucleo.encerrar();
        },
      };
    },
  ]);

describe.each(fabricas)('mesma bateria da assinatura: porta em %s', (_nome, fabrica) => {
  it('vincula, recusa o repetido, desvincula uma vez; provedor com versão e repetido', async () => {
    const { porta, c, fim } = await fabrica();
    try {
      const x = certificado(c.hospital, LOGIN);
      const { id } = await porta.gravar(c, (g) => g.gravarCertificado(x), null);
      expect(await erroDe(porta.gravar(c, (g) => g.gravarCertificado(x), null))).toBe('certificado-ja-vinculado');
      const de = { hospital: c.hospital, usuario: LOGIN, id, por: LOGIN, em: new Date() };
      expect(await porta.gravar(c, (g) => g.inativarCertificado(de), null)).toBe(true);
      expect(await porta.gravar(c, (g) => g.inativarCertificado(de), null)).toBe(false);
      expect((await porta.certificado(c, id))?.ativo).toBe(false);
      const p = provedor(c.hospital, 'l0201-bateria');
      expect((await porta.gravar(c, (g) => g.gravarProvedor(p, null), null)).versao).toBe(1);
      expect(await erroDe(porta.gravar(c, (g) => g.gravarProvedor(p, null), null))).toBe('provedor-repetido');
      expect((await porta.gravar(c, (g) => g.gravarProvedor(p, 1), null)).versao).toBe(2);
      expect(await erroDe(porta.gravar(c, (g) => g.gravarProvedor(p, 1), null))).toBe('versao-desatualizada');
    } finally {
      await fim();
    }
  });
});
