// Contrato de efeito da identidade do estabelecimento (F3.1, 02-CAD linha 26) contra o MariaDB real, no cliente de
// teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa nem empresa real). Prova o que
// fica no banco:
// - logotipo: o envio grava o metadado do arquivo (finalidade logotipo, dono o estabelecimento) e um logotipo por
//   finalidade marcada, com as dimensões lidas da imagem; o que não é imagem é recusado sem gravar nada; o envio novo
//   da mesma finalidade aposenta o anterior (a linha fica, inativa) e a sequência segue; a alteração que deixaria dois
//   ativos na finalidade é recusada; versão velha = 409; a exclusão é lógica, com o motivo na trilha, e a sequência do
//   excluído não volta; a imagem lida confere com a enviada;
// - mantenedora: incluir cria a pessoa jurídica do CNPJ e liga o estabelecimento; CNPJ que não confere e código
//   repetido recusados sem gravar; alterar reaproveita a pessoa jurídica (nenhuma duplicada); inativar em uso recusado;
//   desligar com motivo na trilha, inativar e reativar; versão velha = 409; a pessoa jurídica que já existia no CNPJ
//   (outro cadastro a usa) é reaproveitada sem perder o que tinha: o branco não apaga, o dado fiscal só completa, e a
//   escrita nela fica na trilha da operação; gravar com "ligar" estando o estabelecimento ligado a outra é recusado;
// - rotas (a app com o módulo do cadastro, sessão sintética, a porta real por baixo): a permissão, a imagem em data
//   URL, a entrada da mantenedora montada do corpo (máscaras, versão ausente, o padrão de ligar) e o status das recusas.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { criarArmazemLocal, type NucleoArmazem, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import {
  type EntradaMantenedora,
  IdentidadeEstabelecimentoPropria,
} from './identidade-estabelecimento-propria.js';
import {
  CLIENTE_F22,
  contextoPorta,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { modulo as moduloCadastro } from './modulo.js';
import { PortaCadastroMemoria } from './porta-memoria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f3-1-12-identidade';
const COD = `${MARCA}M`;
// CNPJs sintéticos com dígitos verificadores válidos (nenhuma empresa real).
const CNPJ_A = '11444777000161';
const CNPJ_B = '45723174000110';

/** PNG mínimo: assinatura e o cabeçalho com largura e altura; `marca` torna o conteúdo (e o hash) único. */
function png(largura: number, altura: number, marca: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, largura);
  v.setUint32(20, altura);
  v.setUint32(40, marca);
  v.setFloat64(48, Date.now() + Math.random());
  return b;
}

describe.skipIf(SEM_BANCO)('identidade do estabelecimento no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let p: IdentidadeEstabelecimentoPropria;
  let m: Massa | null = null;
  let raiz = '';
  let mantenedoraOriginal: number | null = null;
  let app: NestFastifyApplication | null = null;

  const um = <T extends Record<string, unknown>>(sql: string, pr: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, pr));
  const todos = (sql: string, pr: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.consultar(sql, pr));
  const conta = async (sql: string, pr: readonly unknown[]) => Number((await um<{ n: unknown }>(sql, pr))!.n);
  const t = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.estrutura' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const trilhaDe = (entidade: string, id: number, motivo: string) =>
    conta(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? AND motivo = ?',
      [entidade, id, motivo],
    );
  const logos = () =>
    todos(
      `SELECT id, sequencia, finalidade, ativo, versao, arquivo_id, largura_px, altura_px, excluido_em, excluido_por
         FROM logotipo_estabelecimento WHERE estabelecimento_id = ? ORDER BY sequencia`,
      [m!.estabelecimento],
    );
  const recusa = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      const x = (e as { problema?: { status?: number; codigo?: string } }).problema;
      if (!x) throw e;
      return { status: x.status, codigo: x.codigo };
    }
    return { status: 0, codigo: 'nao-recusou' };
  };

  /** Durante o teste o estabelecimento da massa começa sem mantenedora; no fim volta à que tinha. */
  async function limparMinhas(mantenedora: number | null = null): Promise<void> {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar('UPDATE estabelecimento SET mantenedora_id = ? WHERE id = ?', [
        mantenedora,
        m!.estabelecimento,
      ]);
      await e.executar('DELETE FROM mantenedora WHERE codigo LIKE ?', [`${COD}%`]);
      await e.executar('DELETE FROM pessoa_juridica WHERE cnpj IN (?, ?)', [CNPJ_A, CNPJ_B]);
      await e.executar('DELETE FROM logotipo_estabelecimento WHERE estabelecimento_id = ?', [
        m!.estabelecimento,
      ]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    mantenedoraOriginal =
      ((await um<{ mantenedora_id: unknown }>('SELECT mantenedora_id FROM estabelecimento WHERE id = ?', [
        m.estabelecimento,
      ]))!.mantenedora_id as number | null) ?? null;
    await limparMinhas();
    // A porta de arquivos do teste: o armazém local do núcleo numa pasta temporária (o metadado vai para o MariaDB).
    raiz = mkdtempSync(join(tmpdir(), 'f3112-logo-'));
    const armazem = criarArmazemLocal(nucleo as unknown as NucleoArmazem, {
      raiz,
      executor: nucleo.criarExecutor(),
    });
    let n = 0;
    const ctx = (sufixo: string) => ({
      cliente: CLIENTE_F22,
      estabelecimento: m!.estabelecimento,
      usuario: m!.usuario,
      correlacao: `${COR}-${sufixo}`,
    });
    const fora = () => Promise.reject(new Error('fora do teste'));
    const arquivos: ArquivosDoModulo = {
      async guardar(_hospital, e) {
        const g = await armazem.guardar(e, {
          ...ctx('arq'),
          chaveIdempotencia: `${COR}-arq-${Date.now()}-${++n}`,
        });
        return { id: g.id, hash: g.hash, reaproveitado: g.reaproveitado };
      },
      metadado: fora,
      async ler(_hospital, id) {
        const r = await armazem.ler(ctx('ler'), id);
        return { metadado: r.metadado, conteudo: r.conteudo };
      },
      async excluir(_hospital, id) {
        const md = await armazem.metadado(ctx('exc'), id);
        if (md)
          await armazem.excluir(id, md.versao, {
            ...ctx('exc'),
            chaveIdempotencia: `${COR}-exc-${Date.now()}-${++n}`,
          });
      },
      fixarRetencao: fora,
    };
    p = new IdentidadeEstabelecimentoPropria(nucleo, CLIENTE_F22, undefined, arquivos);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await limparMinhas(mantenedoraOriginal);
    if (raiz) rmSync(raiz, { recursive: true, force: true });
    if (m) await limparMassa(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  it('logotipo: envio por finalidade, recusas sem gravar, substituição, alteração, exclusão lógica', async () => {
    const arquivosAntes = await conta(
      "SELECT COUNT(*) AS n FROM arquivo WHERE finalidade = 'logotipo' AND entidade_id = ?",
      [m!.estabelecimento],
    );
    // O que não é imagem e a finalidade inválida: recusados antes do disco, nada gravado.
    const envio = {
      nomeOriginal: 'logo.png',
      cabecalhoRelatorio: 'Hospital Sintético',
      rodapeRelatorio: null,
      imprimeEmRelatorio: true,
    };
    expect(
      await recusa(() =>
        p.enviarLogotipo(
          c(),
          { ...envio, conteudo: new Uint8Array(80).fill(65), finalidades: ['relatorio'] },
          t('logotipo_estabelecimento'),
        ),
      ),
    ).toEqual({ status: 409, codigo: 'arquivo-nao-imagem' });
    expect(
      await recusa(() =>
        p.enviarLogotipo(
          c(),
          { ...envio, conteudo: png(320, 120, 1), finalidades: ['cartaz'] },
          t('logotipo_estabelecimento'),
        ),
      ),
    ).toEqual({ status: 409, codigo: 'finalidade-invalida' });
    expect(await logos()).toHaveLength(0);
    expect(
      await conta("SELECT COUNT(*) AS n FROM arquivo WHERE finalidade = 'logotipo' AND entidade_id = ?", [
        m!.estabelecimento,
      ]),
    ).toBe(arquivosAntes);

    // Um envio para duas finalidades: um arquivo, dois logotipos (sequências 1 e 2), dimensões da imagem.
    const imagem = png(320, 120, 2);
    const ids = await p.enviarLogotipo(
      c(),
      { ...envio, conteudo: imagem, finalidades: ['relatorio', 'documento'] },
      t('logotipo_estabelecimento'),
    );
    expect(ids).toHaveLength(2);
    let l = await logos();
    expect(l.map((x) => [Number(x['sequencia']), x['finalidade'], Number(x['ativo'])])).toEqual([
      [1, 'relatorio', 1],
      [2, 'documento', 1],
    ]);
    expect(l.map((x) => [Number(x['largura_px']), Number(x['altura_px'])])).toEqual([
      [320, 120],
      [320, 120],
    ]);
    expect(l[0]!['arquivo_id']).toBe(l[1]!['arquivo_id']);
    const arq = await um(
      'SELECT finalidade, entidade, entidade_id, tipo_mime, tamanho_bytes, estabelecimento_id FROM arquivo WHERE id = ?',
      [l[0]!['arquivo_id']],
    );
    expect(arq).toMatchObject({
      finalidade: 'logotipo',
      entidade: 'estabelecimento',
      tipo_mime: 'image/png',
    });
    expect(Number(arq!['entidade_id'])).toBe(m!.estabelecimento);
    expect(Number(arq!['tamanho_bytes'])).toBe(imagem.length);
    // A imagem lida é a enviada.
    const lida = await p.imagemLogotipo(c(), ids[0]!);
    expect(lida.tipo).toBe('image/png');
    expect(Buffer.from(imagem).equals(lida.conteudo)).toBe(true);

    // Envio novo para a mesma finalidade: o anterior fica, inativo; o novo é o ativo, com a sequência seguinte.
    const [novo] = await p.enviarLogotipo(
      c(),
      { ...envio, conteudo: png(640, 200, 3), finalidades: ['relatorio'] },
      t('logotipo_estabelecimento'),
    );
    l = await logos();
    expect(l.map((x) => [Number(x['sequencia']), x['finalidade'], Number(x['ativo'])])).toEqual([
      [1, 'relatorio', 0],
      [2, 'documento', 1],
      [3, 'relatorio', 1],
    ]);
    const tela = await p.lerTudo(c());
    expect(tela.logotipos.map((x) => x.sequencia)).toEqual([3, 2, 1]);
    expect(tela.logotipos[0]).toMatchObject({ id: novo, largura: 640, altura: 200, ativo: true });

    // Reativar o antigo deixaria dois ativos na finalidade: recusado, nada muda.
    const antigo = tela.logotipos.find((x) => x.sequencia === 1)!;
    const alterar = {
      id: antigo.id,
      versao: antigo.versao,
      finalidade: 'relatorio',
      cabecalhoRelatorio: null,
      rodapeRelatorio: 'Rodapé sintético',
      imprimeEmRelatorio: false,
      ativo: true,
    };
    expect(await recusa(() => p.alterarLogotipo(c(), alterar, t('logotipo_estabelecimento')))).toEqual({
      status: 409,
      codigo: 'finalidade-com-logotipo-ativo',
    });
    // Para outra finalidade passa: grava finalidade, rodapé, impressão e situação, com versão nova.
    await p.alterarLogotipo(c(), { ...alterar, finalidade: 'portal' }, t('logotipo_estabelecimento'));
    const alterado = await um(
      'SELECT finalidade, ativo, rodape_relatorio, cabecalho_relatorio, imprime_em_relatorio, versao FROM logotipo_estabelecimento WHERE id = ?',
      [antigo.id],
    );
    expect(alterado).toMatchObject({
      finalidade: 'portal',
      rodape_relatorio: 'Rodapé sintético',
      cabecalho_relatorio: null,
    });
    expect([Number(alterado!['ativo']), Number(alterado!['imprime_em_relatorio'])]).toEqual([1, 0]);
    expect(Number(alterado!['versao'])).toBe(antigo.versao + 1);
    // Versão velha: conflito.
    expect(
      await recusa(() =>
        p.alterarLogotipo(c(), { ...alterar, finalidade: 'portal' }, t('logotipo_estabelecimento')),
      ),
    ).toEqual({ status: 409, codigo: 'conflito-versao' });

    // Exclusão lógica: motivo curto recusado; com motivo, a linha fica com quem e quando, o arquivo fica e a trilha
    // guarda o motivo; o excluído sai da tela e a sequência dele não volta.
    const excluir = { id: novo!, versao: tela.logotipos[0]!.versao, motivo: 'curto' };
    expect(await recusa(() => p.excluirLogotipo(c(), excluir, t('logotipo_estabelecimento')))).toEqual({
      status: 409,
      codigo: 'motivo-curto',
    });
    const motivo = 'Logotipo enviado por engano no teste';
    await p.excluirLogotipo(c(), { ...excluir, motivo }, t('logotipo_estabelecimento'));
    const excluido = (await logos()).find((x) => Number(x['id']) === novo)!;
    expect(excluido['excluido_em']).not.toBeNull();
    expect(Number(excluido['excluido_por'])).toBe(m!.usuario);
    expect(
      await conta('SELECT COUNT(*) AS n FROM arquivo WHERE id = ? AND excluido_em IS NULL', [
        excluido['arquivo_id'],
      ]),
    ).toBe(1);
    expect(await trilhaDe('logotipo_estabelecimento', novo!, motivo)).toBe(1);
    expect((await p.lerTudo(c())).logotipos.map((x) => x.sequencia)).toEqual([2, 1]);
    expect(await recusa(() => p.imagemLogotipo(c(), novo!))).toMatchObject({ status: 404 });
    expect(
      await recusa(() => p.excluirLogotipo(c(), { ...excluir, motivo }, t('logotipo_estabelecimento'))),
    ).toMatchObject({ status: 404 });
    await p.enviarLogotipo(
      c(),
      { ...envio, conteudo: png(200, 200, 4), finalidades: ['relatorio'] },
      t('logotipo_estabelecimento'),
    );
    expect((await logos()).map((x) => Number(x['sequencia']))).toEqual([1, 2, 3, 4]);
  }, 120_000);

  it('mantenedora: inclui com a pessoa jurídica e liga; recusas sem gravar; altera, desliga, inativa', async () => {
    const base: EntradaMantenedora = {
      id: null,
      versao: null,
      codigo: `${COD}1`,
      razaoSocial: `ASSOCIACAO SINTETICA ${MARCA}`,
      nomeFantasia: `MANTENEDORA ${MARCA}`,
      cnpj: CNPJ_A,
      naturezaJuridica: null,
      inscricaoEstadual: null,
      inscricaoMunicipal: '123456',
      nire: '31200000011',
      dataRegistroNire: '2001-05-10',
      registroCivil: null,
      dataRegistroCivil: null,
      cnaePrincipal: '8610101',
      registroAns: null,
      optanteSimples: false,
      filantropica: true,
      incentivoCultural: false,
      tipoDeclarante: 'prestador_saude',
      responsavel: null,
      contador: null,
      contadorCrc: null,
      site: 'https://mantenedora.example',
      ligar: true,
    };
    const antes = await conta('SELECT COUNT(*) AS n FROM mantenedora', []);
    // CNPJ que não confere e operadora sem registro: todas as recusas de uma vez, nada gravado.
    expect(
      await recusa(() =>
        p.gravarMantenedora(
          c(),
          { ...base, cnpj: '11444777000160', tipoDeclarante: 'operadora' },
          t('mantenedora'),
        ),
      ),
    ).toEqual({ status: 409, codigo: 'cnpj-invalido' });
    expect(
      await recusa(() => p.gravarMantenedora(c(), { ...base, responsavel: 999_999_999 }, t('mantenedora'))),
    ).toEqual({ status: 409, codigo: 'responsavel-inexistente' });
    expect(await conta('SELECT COUNT(*) AS n FROM mantenedora', [])).toBe(antes);
    expect(await conta('SELECT COUNT(*) AS n FROM pessoa_juridica WHERE cnpj = ?', [CNPJ_A])).toBe(0);

    // Inclui: pessoa jurídica do CNPJ criada, mantenedora gravada e o estabelecimento ligado, numa transação.
    const pessoa = await um<{ pessoa_fisica_id: unknown }>(
      'SELECT pessoa_fisica_id FROM profissional WHERE id = ?',
      [m!.profissional],
    );
    const responsavel = Number(pessoa!.pessoa_fisica_id);
    const id = await p.gravarMantenedora(c(), { ...base, responsavel }, t('mantenedora'));
    const gravada = await um(
      `SELECT m.codigo, m.nire, m.cnae_principal, m.filantropica, m.tipo_declarante_dmed, m.ativo, m.versao,
              m.responsavel_pessoa_fisica_id, m.pessoa_juridica_id, pj.cnpj, pj.razao_social, pj.nome_fantasia
         FROM mantenedora m JOIN pessoa_juridica pj ON pj.id = m.pessoa_juridica_id WHERE m.id = ?`,
      [id],
    );
    expect(gravada).toMatchObject({
      codigo: `${COD}1`,
      nire: '31200000011',
      cnae_principal: '8610101',
      tipo_declarante_dmed: 'prestador_saude',
      cnpj: CNPJ_A,
      razao_social: base.razaoSocial,
      nome_fantasia: base.nomeFantasia,
    });
    expect([Number(gravada!['filantropica']), Number(gravada!['ativo'])]).toEqual([1, 1]);
    expect(Number(gravada!['responsavel_pessoa_fisica_id'])).toBe(responsavel);
    const ligado = async () =>
      (await um('SELECT mantenedora_id FROM estabelecimento WHERE id = ?', [m!.estabelecimento]))![
        'mantenedora_id'
      ];
    expect(Number(await ligado())).toBe(id);
    let tela = await p.lerTudo(c());
    expect(tela.mantenedora).toMatchObject({ id, cnpj: CNPJ_A, estabelecimentos: 1, responsavel });

    // Código e CNPJ repetidos em outra mantenedora: recusados, nada gravado.
    expect(await recusa(() => p.gravarMantenedora(c(), { ...base, cnpj: CNPJ_B }, t('mantenedora')))).toEqual(
      {
        status: 409,
        codigo: 'codigo-repetido',
      },
    );
    expect(
      await recusa(() => p.gravarMantenedora(c(), { ...base, codigo: `${COD}2` }, t('mantenedora'))),
    ).toEqual({ status: 409, codigo: 'cnpj-repetido' });
    expect(await conta('SELECT COUNT(*) AS n FROM mantenedora WHERE codigo LIKE ?', [`${COD}%`])).toBe(1);
    expect(await conta('SELECT COUNT(*) AS n FROM pessoa_juridica WHERE cnpj = ?', [CNPJ_B])).toBe(0);

    // Altera: a pessoa jurídica do CNPJ é a mesma (atualizada, nunca duplicada); versão nova; versão velha = 409.
    const alterada = {
      ...base,
      id,
      versao: tela.mantenedora!.versao,
      responsavel,
      razaoSocial: `ASSOCIACAO SINTETICA ${MARCA} ALTERADA`,
      registroCivil: 'L-A 12 FL 3',
      dataRegistroCivil: '1998-03-02',
    };
    await p.gravarMantenedora(c(), alterada, t('mantenedora'));
    const depois = await um(
      `SELECT m.versao, m.registro_civil, m.pessoa_juridica_id, pj.razao_social
         FROM mantenedora m JOIN pessoa_juridica pj ON pj.id = m.pessoa_juridica_id WHERE m.id = ?`,
      [id],
    );
    expect(depois).toMatchObject({ registro_civil: 'L-A 12 FL 3', razao_social: alterada.razaoSocial });
    expect(Number(depois!['versao'])).toBe(tela.mantenedora!.versao + 1);
    expect(depois!['pessoa_juridica_id']).toBe(gravada!['pessoa_juridica_id']);
    expect(await conta('SELECT COUNT(*) AS n FROM pessoa_juridica WHERE cnpj = ?', [CNPJ_A])).toBe(1);
    expect(await recusa(() => p.gravarMantenedora(c(), alterada, t('mantenedora')))).toEqual({
      status: 409,
      codigo: 'conflito-versao',
    });

    // Inativar em uso: recusado. Desligar com motivo (trilha), inativar, ligar a inativa recusado, reativar e ligar.
    tela = await p.lerTudo(c());
    const v = tela.mantenedora!.versao;
    // Motivo único por execução: a trilha do estabelecimento da massa é de várias execuções.
    const motivo = `Troca de mantenedora no teste ${Date.now()}`;
    expect(
      await recusa(() =>
        p.situacaoMantenedora(c(), { id, versao: v, ativo: false, motivo }, t('mantenedora')),
      ),
    ).toEqual({ status: 409, codigo: 'mantenedora-em-uso' });
    expect(
      await recusa(() =>
        p.ligarMantenedora(c(), { mantenedora: null, motivo: 'curto' }, t('estabelecimento')),
      ),
    ).toEqual({ status: 409, codigo: 'motivo-curto' });
    await p.ligarMantenedora(c(), { mantenedora: null, motivo }, t('estabelecimento'));
    expect(await ligado()).toBeNull();
    expect(await trilhaDe('estabelecimento', m!.estabelecimento, motivo)).toBe(1);
    expect((await p.lerTudo(c())).mantenedora).toBeNull();
    await p.situacaoMantenedora(c(), { id, versao: v, ativo: false, motivo }, t('mantenedora'));
    expect(Number((await um('SELECT ativo FROM mantenedora WHERE id = ?', [id]))!['ativo'])).toBe(0);
    expect(await trilhaDe('mantenedora', id, motivo)).toBe(1);
    expect(
      await recusa(() => p.ligarMantenedora(c(), { mantenedora: id, motivo }, t('estabelecimento'))),
    ).toEqual({ status: 409, codigo: 'mantenedora-inativa' });
    await p.situacaoMantenedora(c(), { id, versao: v + 1, ativo: true, motivo }, t('mantenedora'));
    await p.ligarMantenedora(c(), { mantenedora: id, motivo }, t('estabelecimento'));
    expect(Number(await ligado())).toBe(id);
    // A pessoa pelo CPF inteiro: CPF parcial não lê nada.
    expect(await p.pessoaPorCpf(c(), '123')).toBeNull();

    // A pessoa jurídica que JÁ existe no CNPJ (outro cadastro a usa, com dados preenchidos).
    const pjAntes = {
      razao_social: `FORNECEDOR SINTETICO ${MARCA}`,
      nome_fantasia: `FANTASIA ${MARCA}`,
      inscricao_estadual: 'IE-PRE-1',
      cnae_principal: '4644301',
      site: 'https://fornecedor.example',
    };
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar(
        `INSERT INTO pessoa_juridica (cnpj, razao_social, nome_fantasia, inscricao_estadual, cnae_principal, site,
           criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [CNPJ_B, ...Object.values(pjAntes), new Date()],
      ),
    );
    const pjB = () =>
      um(
        `SELECT id, versao, razao_social, nome_fantasia, inscricao_estadual, inscricao_municipal, cnae_principal,
                site FROM pessoa_juridica WHERE cnpj = ?`,
        [CNPJ_B],
      );
    const pj0 = (await pjB())!;
    const outra: EntradaMantenedora = {
      ...base,
      codigo: `${COD}2`,
      cnpj: CNPJ_B,
      razaoSocial: `FORNECEDOR SINTETICO ${MARCA} SA`,
      nomeFantasia: null,
      inscricaoEstadual: null,
      inscricaoMunicipal: '778899',
      cnaePrincipal: '8610102',
      site: null,
    };
    // Gravar ligando, com o estabelecimento ligado a outra: recusado (a troca é pela ligação, com motivo); nada muda.
    expect(await recusa(() => p.gravarMantenedora(c(), outra, t('mantenedora')))).toEqual({
      status: 409,
      codigo: 'estabelecimento-ja-ligado',
    });
    expect(await conta('SELECT COUNT(*) AS n FROM mantenedora WHERE codigo = ?', [outra.codigo])).toBe(0);
    expect(await pjB()).toEqual(pj0);
    expect(Number(await ligado())).toBe(id);
    // Sem ligar: a pessoa jurídica é reaproveitada (uma só). O branco não apaga (nome fantasia, inscrição estadual,
    // site), o dado fiscal dela fica (atividade) e só completa o que não tinha (inscrição municipal); a razão social
    // informada corrige. A mantenedora guarda os dados fiscais dela nas próprias colunas.
    const idB = await p.gravarMantenedora(c(), { ...outra, ligar: false }, t('mantenedora'));
    expect(await conta('SELECT COUNT(*) AS n FROM pessoa_juridica WHERE cnpj = ?', [CNPJ_B])).toBe(1);
    const pj1 = (await pjB())!;
    expect(pj1).toMatchObject({
      id: pj0['id'],
      razao_social: outra.razaoSocial,
      nome_fantasia: pjAntes.nome_fantasia,
      inscricao_estadual: pjAntes.inscricao_estadual,
      inscricao_municipal: '778899',
      cnae_principal: pjAntes.cnae_principal,
      site: pjAntes.site,
    });
    const mB = await um(
      'SELECT pessoa_juridica_id, cnae_principal, inscricao_estadual, site, versao FROM mantenedora WHERE id = ?',
      [idB],
    );
    expect(mB).toMatchObject({ cnae_principal: '8610102', inscricao_estadual: null, site: null });
    expect(mB!['pessoa_juridica_id']).toEqual(pj0['id']);
    // A trilha da operação diz o que mudou na pessoa jurídica: tabela, id e só as colunas mudadas.
    const linha = await um<{ dados_depois: unknown }>(
      `SELECT dados_depois FROM trilha_auditoria WHERE entidade = 'mantenedora' AND entidade_id = ?
        ORDER BY id DESC LIMIT 1`,
      [idB],
    );
    const dd = linha!.dados_depois;
    const escritas = (
      (typeof dd === 'string' ? JSON.parse(dd) : dd) as {
        escritas: { tabela: string; id: number; acao: string; colunas: string[] }[];
      }
    ).escritas;
    expect(escritas.filter((x) => x.tabela === 'pessoa_juridica')).toEqual([
      {
        acao: 'alteracao',
        tabela: 'pessoa_juridica',
        id: Number(pj0['id']),
        colunas: ['inscricao_municipal', 'razao_social'],
      },
    ]);
    // Gravar de novo sem nada novo para a pessoa jurídica: ela não é tocada (mesma versão).
    await p.gravarMantenedora(
      c(),
      { ...outra, ligar: false, id: idB, versao: Number(mB!['versao']), registroCivil: 'L-B 1 FL 2' },
      t('mantenedora'),
    );
    expect(await pjB()).toEqual(pj1);
    // Alterar pedindo para ligar, com o estabelecimento ligado a outra: recusado, a ligação fica.
    expect(
      await recusa(() =>
        p.gravarMantenedora(
          c(),
          { ...outra, id: idB, versao: Number(mB!['versao']) + 1, ligar: true },
          t('mantenedora'),
        ),
      ),
    ).toEqual({ status: 409, codigo: 'estabelecimento-ja-ligado' });
    expect(Number(await ligado())).toBe(id);
  }, 120_000);

  it('rotas: permissão, imagem em data URL, entrada da mantenedora montada do corpo e o status das recusas', async () => {
    // A app com o módulo do cadastro e a sessão sintética; a identidade é a porta real, com o contexto da massa (o
    // estabelecimento e o usuário sintéticos da sessão não existem no banco do cliente de teste).
    const real = p;
    // A linha da trilha que a rota monta leva o usuário da sessão sintética: aqui, o usuário e o estabelecimento da massa.
    const daMassa = (x: unknown): unknown =>
      x && typeof x === 'object' && 'entidade' in x && 'usuario' in x
        ? { ...x, usuario: m!.usuario, estabelecimento: m!.estabelecimento }
        : x;
    const identidade = new Proxy(real, {
      get(alvo, k) {
        const v = (alvo as unknown as Record<string | symbol, unknown>)[k];
        return typeof v === 'function'
          ? (_c: unknown, ...resto: unknown[]) =>
              (v as (...a: unknown[]) => unknown).call(alvo, c(), ...resto.map(daMassa))
          : v;
      },
    });
    const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'cadastro' };
    app = await criarApp(lerConfiguracao(env), null, env, {
      registro: {
        cadastro: async () => ({
          modulo: (ctx) => moduloCadastro(ctx, { porta: new PortaCadastroMemoria(), identidade }),
        }),
      },
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const entrar = async (login: string) => {
      const r = await app!.inject({
        method: 'POST',
        url: '/api/sessao',
        payload: { estabelecimento: 'aa', login, senha: SENHA },
      });
      expect(r.statusCode).toBe(201);
      const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
      return {
        cookie: set.map((x) => x.split(';')[0]).join('; '),
        'x-csrf':
          set
            .find((x) => x.startsWith('sgh_csrf='))
            ?.split(';')[0]
            ?.slice(9) ?? '',
      };
    };
    let n = 0;
    const R = '/api/cadastros/estrutura-gestao';
    const pedir = (
      h: Record<string, string>,
      method: 'GET' | 'POST' | 'PUT',
      url: string,
      payload?: object,
    ) =>
      app!.inject({
        method,
        url: `${R}${url}`,
        headers: { ...h, 'idempotency-key': `${COR}-http-${Date.now()}-${++n}` },
        ...(payload ? { payload } : {}),
      });
    const cod = (r: { json(): unknown }) => (r.json() as { codigo?: string }).codigo;

    // Sem a permissão: 403 na leitura e na gravação, nada gravado.
    const semAcesso = await entrar('SINT.RECEPCAO');
    expect((await pedir(semAcesso, 'GET', '/identidade')).statusCode).toBe(403);
    expect((await pedir(semAcesso, 'POST', '/mantenedora-ligada', { mantenedora: null })).statusCode).toBe(
      403,
    );
    const adm = await entrar('SINT.FIN.GESTOR');
    const tela = await pedir(adm, 'GET', '/identidade');
    expect(tela.statusCode).toBe(200);
    const antes = tela.json() as {
      mantenedora: { id: number; versao: number } | null;
      mantenedoras: { id: number; versao: number; codigo: string }[];
    };
    const ligada = antes.mantenedora!;
    expect(ligada).not.toBeNull();

    // Logotipo: o que não é base64 e o que passa do teto param na rota (422); o que não é imagem é recusa da regra.
    const antesLogos = (await logos()).length;
    let r = await pedir(adm, 'POST', '/logotipos', {
      conteudo: 'isto não é base64 !!',
      finalidades: ['portal'],
    });
    expect([r.statusCode, cod(r)]).toEqual([422, 'arquivo-nao-imagem']);
    r = await pedir(adm, 'POST', '/logotipos', { conteudo: 'A'.repeat(800_001), finalidades: ['portal'] });
    expect([r.statusCode, cod(r)]).toEqual([422, 'arquivo-nao-imagem']);
    r = await pedir(adm, 'POST', '/logotipos', {
      conteudo: Buffer.from(new Uint8Array(80).fill(65)).toString('base64'),
      finalidades: ['portal'],
    });
    expect([r.statusCode, cod(r)]).toEqual([409, 'arquivo-nao-imagem']);
    expect((await logos()).length).toBe(antesLogos);
    // A imagem em data URL (como a tela envia): 201, o logotipo fica no banco com as dimensões e a imagem volta igual.
    const imagem = png(300, 90, 9);
    r = await pedir(adm, 'POST', '/logotipos', {
      conteudo: `data:image/png;base64,${Buffer.from(imagem).toString('base64')}`,
      nomeOriginal: 'logo-rota.png',
      finalidades: ['etiqueta'],
      cabecalhoRelatorio: '  Hospital Sintético  ',
    });
    expect(r.statusCode).toBe(201);
    const [idLogo] = (r.json() as { ids: number[] }).ids;
    const gravado = await um(
      'SELECT finalidade, largura_px, altura_px, cabecalho_relatorio, imprime_em_relatorio, ativo FROM logotipo_estabelecimento WHERE id = ?',
      [idLogo],
    );
    expect(gravado).toMatchObject({ finalidade: 'etiqueta', cabecalho_relatorio: 'Hospital Sintético' });
    expect([Number(gravado!['largura_px']), Number(gravado!['altura_px'])]).toEqual([300, 90]);
    r = await pedir(adm, 'GET', `/logotipos/${idLogo}/imagem`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ tipo: 'image/png', conteudo: Buffer.from(imagem).toString('base64') });
    // Excluir sem motivo: recusa; logotipo que não existe: 404.
    r = await pedir(adm, 'POST', `/logotipos/${idLogo}/excluir`, { versao: 1 });
    expect([r.statusCode, cod(r)]).toEqual([409, 'motivo-curto']);
    r = await pedir(adm, 'GET', '/logotipos/999999999/imagem');
    expect([r.statusCode, cod(r)]).toEqual([404, 'logotipo-inexistente']);
    r = await pedir(adm, 'PUT', '/mantenedoras/999999999', {
      ...{ codigo: `${COD}9`, razaoSocial: 'X SINTETICA', cnpj: '11222333000181' },
      versao: 1,
    });
    expect([r.statusCode, cod(r)]).toEqual([404, 'mantenedora-inexistente']);

    // Mantenedora pela rota: o corpo vem com máscara (CNPJ, junta comercial, atividade) e números em texto.
    const corpo = {
      codigo: `${COD}1`,
      razaoSocial: `  ASSOCIACAO SINTETICA ${MARCA} ROTA `,
      nomeFantasia: '',
      cnpj: '11.444.777/0001-61',
      nire: '312.0000.001-1',
      dataRegistroNire: '2001-05-10',
      cnaePrincipal: '8610-1/01',
      filantropica: true,
      tipoDeclarante: 'prestador_saude',
      inscricaoMunicipal: 123456,
    };
    // Sem a versão: entrada inválida (400); com a versão velha: conflito (409). Nada gravado.
    r = await pedir(adm, 'PUT', `/mantenedoras/${ligada.id}`, corpo);
    expect([r.statusCode, cod(r)]).toEqual([400, 'entrada-invalida']);
    r = await pedir(adm, 'PUT', `/mantenedoras/${ligada.id}`, { ...corpo, versao: ligada.versao + 7 });
    expect([r.statusCode, cod(r)]).toEqual([409, 'conflito-versao']);
    r = await pedir(adm, 'PUT', `/mantenedoras/${ligada.id}`, { ...corpo, versao: String(ligada.versao) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ id: ligada.id });
    const gm = await um(
      `SELECT m.versao, m.nire, m.cnae_principal, m.inscricao_municipal, m.filantropica, m.optante_simples,
              pj.cnpj, pj.razao_social, pj.nome_fantasia
         FROM mantenedora m JOIN pessoa_juridica pj ON pj.id = m.pessoa_juridica_id WHERE m.id = ?`,
      [ligada.id],
    );
    expect(gm).toMatchObject({
      nire: '31200000011',
      cnae_principal: '8610101',
      inscricao_municipal: '123456',
      cnpj: CNPJ_A,
      razao_social: `ASSOCIACAO SINTETICA ${MARCA} ROTA`,
      // O nome fantasia em branco não apaga o da pessoa jurídica.
      nome_fantasia: `MANTENEDORA ${MARCA}`,
    });
    expect([Number(gm!['versao']), Number(gm!['filantropica']), Number(gm!['optante_simples'])]).toEqual([
      ligada.versao + 1,
      1,
      0,
    ]);
    // Regra recusada pela rota: CNPJ que não confere.
    r = await pedir(adm, 'PUT', `/mantenedoras/${ligada.id}`, {
      ...corpo,
      versao: ligada.versao + 1,
      cnpj: '11.444.777/0001-60',
    });
    expect([r.statusCode, cod(r)]).toEqual([409, 'cnpj-invalido']);

    // O padrão de ligar: alterar OUTRA mantenedora sem o campo não troca a ligação do estabelecimento; pedindo para
    // ligar, e ao incluir (que liga por padrão), com o estabelecimento ligado a outra: recusa, a ligação fica.
    const ligadoA = async () =>
      Number(
        (await um('SELECT mantenedora_id FROM estabelecimento WHERE id = ?', [m!.estabelecimento]))![
          'mantenedora_id'
        ],
      );
    const b = antes.mantenedoras.find((x) => x.codigo === `${COD}2`)!;
    const corpoB = {
      codigo: `${COD}2`,
      razaoSocial: `FORNECEDOR SINTETICO ${MARCA} SA`,
      cnpj: CNPJ_B,
      versao: b.versao,
    };
    r = await pedir(adm, 'PUT', `/mantenedoras/${b.id}`, corpoB);
    expect(r.statusCode).toBe(200);
    expect(await ligadoA()).toBe(ligada.id);
    r = await pedir(adm, 'PUT', `/mantenedoras/${b.id}`, { ...corpoB, versao: b.versao + 1, ligar: true });
    expect([r.statusCode, cod(r)]).toEqual([409, 'estabelecimento-ja-ligado']);
    r = await pedir(adm, 'POST', '/mantenedoras', {
      codigo: `${COD}3`,
      razaoSocial: `TERCEIRA SINTETICA ${MARCA}`,
      cnpj: '11.222.333/0001-81',
    });
    expect([r.statusCode, cod(r)]).toEqual([409, 'estabelecimento-ja-ligado']);
    expect(await conta('SELECT COUNT(*) AS n FROM mantenedora WHERE codigo = ?', [`${COD}3`])).toBe(0);
    expect(await ligadoA()).toBe(ligada.id);
    // Ligar a outra pela rota própria: sem motivo recusa; com motivo, liga e a trilha fica no estabelecimento.
    r = await pedir(adm, 'POST', '/mantenedora-ligada', { mantenedora: b.id });
    expect([r.statusCode, cod(r)]).toEqual([409, 'motivo-curto']);
    const motivo = `Troca pela rota no teste ${Date.now()}`;
    r = await pedir(adm, 'POST', '/mantenedora-ligada', { mantenedora: String(b.id), motivo });
    expect(r.statusCode).toBe(200);
    expect(await ligadoA()).toBe(b.id);
    expect(await trilhaDe('estabelecimento', m!.estabelecimento, motivo)).toBe(1);
    // CPF incompleto na busca da pessoa: 422.
    r = await pedir(adm, 'GET', '/identidade/pessoa?cpf=123');
    expect([r.statusCode, cod(r)]).toEqual([422, 'cpf-invalido']);
  }, 120_000);
});
