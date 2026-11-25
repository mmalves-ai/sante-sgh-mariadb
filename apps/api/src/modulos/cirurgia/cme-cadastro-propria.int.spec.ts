// Contrato de efeito do cadastro da CME (F7, 04-CME linha 115) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA: dois estabelecimentos com o código do teste, três fases fictícias no catálogo (ordem livre do fim da
// faixa) e produtos e caixas fictícios; usuário e item do estoque são ids já existentes do cliente de teste (só os ids
// são lidos). A foto vai para um armazém local numa pasta temporária (o metadado vai para o MariaDB).
// Prova o que fica no banco:
//   - produto: a inclusão grava o produto com contador 0 e as fases na ordem do fluxo (mesmo escolhidas fora de
//     ordem); código de barras repetido dá 409 sem escrita; a esterilização sem limpeza antes dá 422 sem escrita; o
//     limite abaixo do contador dá 422; a alteração tira uma fase (marcada como excluída, com quem) e, ao voltar, a
//     mesma linha é reaproveitada; versão velha dá 409;
//   - situação: o descartado não volta (422) e a linha fica;
//   - caixa: o kit com produto e item do estoque grava a composição em ordem; o produto descartado na composição dá
//     422 sem escrita; a alteração tira uma peça (excluída, sequência fora da faixa da montagem), inverte a ordem e
//     inclui outra, sem apagar nada; inativar a caixa a mantém;
//   - foto: a imagem liga o arquivo (finalidade foto_cme, dono a caixa) e volta igual; o texto disfarçado dá 422 sem
//     arquivo novo;
//   - outro estabelecimento (que existe) não enxerga a caixa nem o produto: 404, sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazemLocal, type Escritor, type NucleoArmazem, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import type { ArquivosDoModulo } from '../arquivos-locais.js';
import { PortaCmeCadastroPropria } from './cme-cadastro-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2055cm';
const P2 = `${P}b`;

interface Massa {
  usuario: number;
  est: number;
  insumo: number;
  recepcao: number;
  limpeza: number;
  esterilizacao: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  await e.executar(
    `DELETE pf FROM produto_fase_reprocessamento pf JOIN produto_reprocessavel p ON p.id = pf.produto_reprocessavel_id
      WHERE p.estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(
    `DELETE pf FROM produto_fase_reprocessamento pf JOIN caixa_instrumental c ON c.id = pf.caixa_instrumental_id
      WHERE c.estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(
    `DELETE i FROM caixa_instrumental_item i JOIN caixa_instrumental c ON c.id = i.caixa_instrumental_id
      WHERE c.estabelecimento_id IN (${est})`,
    [P, P2],
  );
  await e.executar(`DELETE FROM caixa_instrumental WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM produto_reprocessavel WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar(`DELETE FROM arquivo WHERE estabelecimento_id IN (${est})`, [P, P2]);
  await e.executar('DELETE FROM fase_reprocessamento WHERE codigo LIKE ?', [`${P}-%`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8,
  8, 2, 0, 0, 0, 0x4b, 0x6d, 0x29, 0xdc,
]);

describe.skipIf(SEM_BANCO)('PortaCmeCadastroPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCmeCadastroPropria;
  let m: Massa;
  let raiz = '';
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const contar = async (sql: string, p: unknown[] = []) => Number((await ler(sql, p))[0]?.['n'] ?? 0);
  const codigo = async (pr: Promise<unknown>) => {
    try {
      await pr;
      return 'ok';
    } catch (e) {
      const x = e as { status?: number; codigo?: string; problema?: { status?: number } };
      return String(x.status ?? x.problema?.status ?? 'erro');
    }
  };
  const fasesDe = (coluna: string, id: number) =>
    ler(
      `SELECT id, fase_reprocessamento_id AS fase, ordem, obrigatoria, excluido_em, excluido_por
         FROM produto_fase_reprocessamento WHERE ${coluna} = ? ORDER BY id`,
      [id],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const insumo = await e.uma('SELECT MIN(id) AS id FROM insumo WHERE excluido_em IS NULL');
      if (!usuario?.['id'] || !insumo?.['id'])
        throw new Error('O cliente de teste precisa de usuário e de um produto do estoque.');
      const ins = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await ins(P);
      await ins(P2);
      const usadas = new Set(
        (await e.consultar('SELECT ordem FROM fase_reprocessamento')).map((r) => Number(r['ordem'])),
      );
      const livres = [...Array(60).keys()].map((i) => 195 + i).filter((o) => !usadas.has(o));
      if (livres.length < 3) throw new Error('Sem ordem livre no catálogo de fases.');
      const fase = (s: string, ordem: number, ciclo: boolean) =>
        e.inserir(
          'INSERT INTO fase_reprocessamento (codigo, descricao, ordem, exige_ciclo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [`${P}-${s}`, `FASE SINTETICA ${s}`, ordem, ciclo, agora],
        );
      return {
        usuario: Number(usuario['id']),
        est,
        insumo: Number(insumo['id']),
        recepcao: await fase('REC', livres[0]!, false),
        limpeza: await fase('LIM', livres[1]!, false),
        esterilizacao: await fase('EST', livres[2]!, true),
      };
    });
    raiz = mkdtempSync(join(tmpdir(), 'c2055-foto-'));
    const armazem = criarArmazemLocal(nucleo as unknown as NucleoArmazem, {
      raiz,
      executor: nucleo.criarExecutor(),
    });
    let n = 0;
    const c = (s: string) => ({
      cliente: CLIENTE,
      estabelecimento: m.est,
      usuario: m.usuario,
      correlacao: `${P}-${s}`,
    });
    const fora = () => Promise.reject(new Error('fora do teste'));
    const arquivos: ArquivosDoModulo = {
      async guardar(_h, e) {
        const g = await armazem.guardar(e, {
          ...c('arq'),
          chaveIdempotencia: `${P}-arq-${Date.now()}-${++n}`,
        });
        return { id: g.id, hash: g.hash, reaproveitado: g.reaproveitado };
      },
      metadado: fora,
      async ler(_h, id) {
        const r = await armazem.ler(c('ler'), id);
        return { metadado: r.metadado, conteudo: r.conteudo };
      },
      async excluir(_h, id) {
        const md = await armazem.metadado(c('exc'), id);
        if (md)
          await armazem.excluir(id, md.versao, {
            ...c('exc'),
            chaveIdempotencia: `${P}-exc-${Date.now()}-${++n}`,
          });
      },
      fixarRetencao: fora,
    };
    porta = new PortaCmeCadastroPropria(nucleo, CLIENTE, arquivos);
  }, 120_000);

  afterAll(async () => {
    if (m) await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    if (raiz) rmSync(raiz, { recursive: true, force: true });
    await nucleo?.encerrar?.();
  });

  const produtoBase = () => ({
    descricao: 'PINCA SINTETICA',
    tipo: 'instrumental',
    codigoBarras: 'SINT-0001',
    limiteReprocessamentos: 50,
    validadeDias: 30,
    tempoMinutos: 15,
    temperaturaCelsius: 134,
    fases: [
      { fase: m.esterilizacao, obrigatoria: true },
      { fase: m.recepcao, obrigatoria: false },
      { fase: m.limpeza, obrigatoria: true },
    ],
  });

  it('produto: inclui com fases em ordem; recusas sem escrita; tira e devolve a fase reaproveitando a linha', async () => {
    const r = await porta.gravarProduto(ctx(), null, produtoBase());
    const [prod] = await ler(
      'SELECT descricao, tipo, contador_reprocessamentos, situacao, criado_por, versao FROM produto_reprocessavel WHERE id = ?',
      [r.produto],
    );
    expect(prod).toMatchObject({ tipo: 'instrumental', situacao: 'ativo', criado_por: m.usuario, versao: 1 });
    expect(Number(prod!['contador_reprocessamentos'])).toBe(0);
    let fases = await fasesDe('produto_reprocessavel_id', r.produto);
    expect(fases.map((f) => [Number(f['fase']), Number(f['ordem'])])).toEqual([
      [m.recepcao, 1],
      [m.limpeza, 2],
      [m.esterilizacao, 3],
    ]);

    const antes = await contar(
      'SELECT COUNT(*) AS n FROM produto_reprocessavel WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(await codigo(porta.gravarProduto(ctx(), null, produtoBase()))).toBe('409');
    expect(
      await codigo(
        porta.gravarProduto(ctx(), null, {
          ...produtoBase(),
          codigoBarras: null,
          fases: [{ fase: m.esterilizacao, obrigatoria: true }],
        }),
      ),
    ).toBe('422');
    expect(
      await contar('SELECT COUNT(*) AS n FROM produto_reprocessavel WHERE estabelecimento_id = ?', [m.est]),
    ).toBe(antes);

    // O contador vem do processamento: o limite não fica abaixo dele.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: P }, (e) =>
      e.executar('UPDATE produto_reprocessavel SET contador_reprocessamentos = 7 WHERE id = ?', [r.produto]),
    );
    expect(
      await codigo(
        porta.gravarProduto(ctx(), r.produto, { ...produtoBase(), versao: 1, limiteReprocessamentos: 5 }),
      ),
    ).toBe('422');

    // Tira a recepção: a linha fica marcada como excluída, com quem.
    const a1 = await porta.gravarProduto(ctx(), r.produto, {
      ...produtoBase(),
      versao: 1,
      fases: [
        { fase: m.limpeza, obrigatoria: true },
        { fase: m.esterilizacao, obrigatoria: true },
      ],
    });
    expect(a1.versao).toBe(2);
    fases = await fasesDe('produto_reprocessavel_id', r.produto);
    const rec = fases.find((f) => Number(f['fase']) === m.recepcao)!;
    expect(rec['excluido_em']).not.toBeNull();
    expect(Number(rec['excluido_por'])).toBe(m.usuario);
    expect(fases.filter((f) => f['excluido_em'] === null).map((f) => Number(f['ordem']))).toEqual([1, 2]);

    // Volta a recepção: a mesma linha é reaproveitada (sem linha nova), e a versão velha dá 409.
    expect(await codigo(porta.gravarProduto(ctx(), r.produto, { ...produtoBase(), versao: 1 }))).toBe('409');
    await porta.gravarProduto(ctx(), r.produto, { ...produtoBase(), versao: 2 });
    const depois = await fasesDe('produto_reprocessavel_id', r.produto);
    expect(depois).toHaveLength(3);
    expect(depois.find((f) => Number(f['id']) === Number(rec['id']))).toMatchObject({ excluido_em: null });
  });

  it('situação: descartado não volta e a linha fica; outro estabelecimento não enxerga', async () => {
    const r = await porta.gravarProduto(ctx(), null, { ...produtoBase(), codigoBarras: 'SINT-0002' });
    const d = await porta.situacaoProduto(ctx(), r.produto, { versao: 1, situacao: 'descartado' });
    expect(
      await codigo(porta.situacaoProduto(ctx(), r.produto, { versao: d.versao, situacao: 'ativo' })),
    ).toBe('422');
    const [linha] = await ler('SELECT situacao, excluido_em FROM produto_reprocessavel WHERE id = ?', [
      r.produto,
    ]);
    expect(linha).toMatchObject({ situacao: 'descartado', excluido_em: null });
    expect(
      await codigo(porta.situacaoProduto(ctx(P2), r.produto, { versao: d.versao, situacao: 'inativo' })),
    ).toBe('404');
  });

  it('caixa: kit com composição em ordem; recusa do produto descartado; tirar, inverter e incluir peça sem apagar', async () => {
    const ativo = await porta.gravarProduto(ctx(), null, { ...produtoBase(), codigoBarras: 'SINT-0003' });
    const outro = await porta.gravarProduto(ctx(), null, { ...produtoBase(), codigoBarras: 'SINT-0004' });
    const descartado = await porta.gravarProduto(ctx(), null, {
      ...produtoBase(),
      codigoBarras: 'SINT-0005',
    });
    await porta.situacaoProduto(ctx(), descartado.produto, { versao: 1, situacao: 'descartado' });
    const fases = [
      { fase: m.limpeza, obrigatoria: true },
      { fase: m.esterilizacao, obrigatoria: true },
    ];
    const base = {
      codigo: `${P}-KIT1`,
      descricao: 'KIT SINTETICO',
      natureza: 'kit',
      validadeDias: 30,
      controlaReprocessamentos: true,
      limiteReprocessamentos: 100,
      fases,
    };

    const antes = await contar('SELECT COUNT(*) AS n FROM caixa_instrumental WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    expect(
      await codigo(
        porta.gravarCaixa(ctx(), null, {
          ...base,
          pecas: [{ produto: descartado.produto, quantidade: 1 }],
        }),
      ),
    ).toBe('422');
    expect(
      await contar('SELECT COUNT(*) AS n FROM caixa_instrumental WHERE estabelecimento_id = ?', [m.est]),
    ).toBe(antes);

    const cx = await porta.gravarCaixa(ctx(), null, {
      ...base,
      pecas: [
        { produto: ativo.produto, quantidade: 2, pecaMestre: true },
        { insumo: m.insumo, quantidade: 1.5 },
      ],
    });
    expect(cx.pecas).toBe(2);
    let lida = await porta.caixa(ctx(), cx.caixa);
    expect(lida).toMatchObject({ natureza: 'kit', ativo: true, versao: 1, limiteReprocessamentos: 100 });
    expect(lida.pecas.map((p) => [p.sequencia, p.produto, p.insumo, p.quantidade])).toEqual([
      [1, ativo.produto, null, 2],
      [2, null, m.insumo, 1.5],
    ]);
    expect(lida.fases.map((f) => f.fase)).toEqual([m.limpeza, m.esterilizacao]);
    expect(await codigo(porta.caixa(ctx(P2), cx.caixa))).toBe('404');
    expect(
      await codigo(porta.gravarCaixa(ctx(), null, { ...base, pecas: [{ insumo: m.insumo, quantidade: 1 }] })),
    ).toBe('409');

    // Tira a primeira peça, põe o item do estoque em primeiro e inclui outro produto.
    const [p1, p2] = lida.pecas;
    const a = await porta.gravarCaixa(ctx(), cx.caixa, {
      ...base,
      versao: 1,
      pecas: [
        { id: p2!.id, insumo: m.insumo, quantidade: 3 },
        { produto: outro.produto, quantidade: 1 },
      ],
    });
    expect(a.versao).toBe(2);
    lida = await porta.caixa(ctx(), cx.caixa);
    expect(lida.pecas.map((p) => [p.sequencia, p.id === p2!.id, p.produto, p.quantidade])).toEqual([
      [1, true, null, 3],
      [2, false, outro.produto, 1],
    ]);
    const [tirada] = await ler(
      'SELECT sequencia, excluido_em, excluido_por FROM caixa_instrumental_item WHERE id = ?',
      [p1!.id],
    );
    expect(Number(tirada!['sequencia'])).toBeGreaterThanOrEqual(1000);
    expect(tirada!['excluido_em']).not.toBeNull();
    expect(Number(tirada!['excluido_por'])).toBe(m.usuario);
    expect(
      await contar('SELECT COUNT(*) AS n FROM caixa_instrumental_item WHERE caixa_instrumental_id = ?', [
        cx.caixa,
      ]),
    ).toBe(3);
    expect(await codigo(porta.gravarCaixa(ctx(), cx.caixa, { ...base, versao: 1, pecas: [] }))).toBe('422');
    expect(
      await codigo(
        porta.gravarCaixa(ctx(), cx.caixa, {
          ...base,
          versao: 1,
          pecas: [{ id: p2!.id, insumo: m.insumo, quantidade: 3 }],
        }),
      ),
    ).toBe('409');

    const inat = await porta.situacaoCaixa(ctx(), cx.caixa, { versao: 2, ativo: false });
    const [cab] = await ler('SELECT ativo, excluido_em, versao FROM caixa_instrumental WHERE id = ?', [
      cx.caixa,
    ]);
    expect(Boolean(cab!['ativo'])).toBe(false);
    expect(cab!['excluido_em']).toBeNull();
    expect(Number(cab!['versao'])).toBe(inat.versao);
  });

  it('foto: liga o arquivo à caixa e volta igual; o que não é imagem é recusado sem arquivo novo', async () => {
    const cx = await porta.gravarCaixa(ctx(), null, {
      codigo: `${P}-CX2`,
      descricao: 'CAIXA SINTETICA',
      natureza: 'caixa',
      fases: [{ fase: m.limpeza, obrigatoria: true }],
      pecas: [{ insumo: m.insumo, quantidade: 1 }],
    });
    const arquivosAntes = await contar('SELECT COUNT(*) AS n FROM arquivo WHERE estabelecimento_id = ?', [
      m.est,
    ]);
    expect(
      await codigo(
        porta.enviarFoto(ctx(), 'caixa', cx.caixa, {
          versao: 1,
          conteudo: Buffer.from('texto disfarcado').toString('base64'),
        }),
      ),
    ).toBe('422');
    expect(await contar('SELECT COUNT(*) AS n FROM arquivo WHERE estabelecimento_id = ?', [m.est])).toBe(
      arquivosAntes,
    );

    const f = await porta.enviarFoto(ctx(), 'caixa', cx.caixa, {
      versao: 1,
      conteudo: PNG.toString('base64'),
      nomeOriginal: 'caixa.png',
    });
    expect(f.versao).toBe(2);
    const [arq] = await ler('SELECT finalidade, entidade, entidade_id, tipo_mime FROM arquivo WHERE id = ?', [
      f.arquivo,
    ]);
    expect(arq).toMatchObject({
      finalidade: 'foto_cme',
      entidade: 'caixa_instrumental',
      tipo_mime: 'image/png',
    });
    expect(Number(arq!['entidade_id'])).toBe(cx.caixa);
    const [cab] = await ler('SELECT foto_arquivo_id FROM caixa_instrumental WHERE id = ?', [cx.caixa]);
    expect(Number(cab!['foto_arquivo_id'])).toBe(f.arquivo);
    const volta = await porta.foto(ctx(), 'caixa', cx.caixa);
    expect(volta.tipo).toBe('image/png');
    expect(Buffer.compare(volta.conteudo, PNG)).toBe(0);
    expect(await codigo(porta.foto(ctx(P2), 'caixa', cx.caixa))).toBe('404');
  });
});
