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
//   desligar com motivo na trilha, inativar e reativar; versão velha = 409.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazemLocal, type NucleoArmazem, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  async function limparMinhas(): Promise<void> {
    if (!m) return;
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar('UPDATE estabelecimento SET mantenedora_id = ? WHERE id = ?', [
        mantenedoraOriginal,
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
    await limparMinhas();
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
  }, 120_000);
});
