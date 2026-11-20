// M14 na cópia (ficha, seção 10): inativação nos dois caminhos (pela coluna de situação do legado, pelo executor;
// e só no novo, em SGH_CFG_DOMINIO_SITUACAO com a SGH_TRILHA), sempre na transação DESFEITA; as consultas
// somente leitura do lote (página por chave, contagem com teto, registro pela chave), a tabela grande que exige
// filtro e o cancelamento por tempo; a vigia das tabelas vazias (desfeita); dois hospitais (Bloqueio HS-1).
// Saída só com contagens e códigos; nenhum valor de linha é impresso. Correção do M14: depois de cada transação
// desfeita, o retrato (contagem nas pequenas, maior chave nas grandes) das tabelas do legado tocadas, da trilha
// dupla e das tabelas SGH_ é igual ao de antes; reativação só no novo e o "Corrigir" da sessão "como".
import { operacaoDoDominio } from '@sgh/contratos';
import {
  comImagens,
  CONSULTAS_LEGADO,
  contarConsulta,
  DECLARACOES,
  ErroTempoEsgotado,
  executarCorrecao,
  exigeFiltro,
  gravarVigia,
  inativarSoNoNovo,
  itemDoDominio,
  lerImagens,
  lerInativosSoNoNovo,
  limparMetadadosComo,
  listarDominio,
  type MarcaComo,
  operacao,
  paginaDaConsulta,
  reativarSoNoNovo,
  registroDaConsulta,
  tabelasComLinha,
  tabelasForaDaLista,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { valoresDeInclusao } from '../massa/dominios.js';
import {
  type Ambiente,
  codigos,
  contar,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const soNoNovo = DECLARACOES.find((d) => d.tabela === 'RISITREGLEITO')!;
const comSituacao = DECLARACOES.find(
  (d) =>
    d.publico.marco === 'M14' &&
    d.publico.natureza === 'editavel' &&
    d.situacao &&
    d.publico.acoes.includes('criar') &&
    !d.pendenteDeProva,
)!;

/** Operações destes testes na SGH_TRILHA (o dev do dono, no ar sobre a mesma cópia, registra as dele). */
const OPERACOES_DO_TESTE = [
  operacaoDoDominio(comSituacao.publico, 'incluir'),
  operacaoDoDominio(comSituacao.publico, 'inativar'),
  'internacao.inativarNoNovo',
  'internacao.reativarNoNovo',
];

const trilhaSoNoNovo = (a: Ambiente, operacaoNome: string) => ({
  rede: a.nucleo.rede,
  hospital: a.cod,
  usuario: 'SGH.M14',
  evento: `internacao.situacaoRegulacaoLeito.${operacaoNome.endsWith('reativarNoNovo') ? 'reativadoNoNovo' : 'inativadoNoNovo'}`,
  recurso: 'internacao.situacaoRegulacaoLeito',
  operacao: operacaoNome,
  resultado: 'sucesso',
  estacao: null,
  correlacao: 'integracao-m14',
});

describe.skipIf(!PODE_ESCREVER)('M14 na cópia', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  /** Retrato fora da transação: contagem (pequenas) ou maior chave (grandes) das tabelas que os testes tocam. */
  const RETRATO: readonly (readonly [string, string])[] = [
    [comSituacao.tabela, `SELECT COUNT(*) N FROM ${comSituacao.tabela}`],
    [soNoNovo.tabela, `SELECT COUNT(*) N FROM ${soNoNovo.tabela}`],
    ['TBCABTRILHA', 'SELECT MAX(ID) N FROM TBCABTRILHA'],
    ['TBLANTRILHASGH', 'SELECT MAX(ID_TBCABTRILHA) N FROM TBLANTRILHASGH'],
    ['SGH_TRILHA', 'SELECT MAX(ID) N FROM SGH_TRILHA'],
    ['SGH_OUTBOX', 'SELECT COALESCE(MAX(ID), 0) N FROM SGH_OUTBOX'],
    ['SGH_CFG_DOMINIO_SITUACAO', 'SELECT COUNT(*) N FROM SGH_CFG_DOMINIO_SITUACAO'],
    ['SGH_CFG_TABELA_VAZIA', 'SELECT COUNT(*) N FROM SGH_CFG_TABELA_VAZIA'],
    ['SGH_SUP_IMAGEM', 'SELECT COUNT(*) N FROM SGH_SUP_IMAGEM'],
  ];
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const r: Record<string, number> = {};
      for (const [t, sql] of RETRATO) r[t] = await contar(l, sql).catch(() => -1);
      return r;
    });
  /** As tabelas cujo retrato mudou depois do ROLLBACK (deve ser nenhuma); SGH_TRILHA só pelas nossas operações. */
  const diferencas = async (antes: Record<string, number>) => {
    const depois = await retrato();
    const r = Object.keys(antes).filter((t) => t !== 'SGH_TRILHA' && antes[t] !== depois[t]);
    const nossas = await a.nucleo.lerSomente(ctx(a), (l) =>
      contar(
        l,
        `SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND OPERACAO IN (${OPERACOES_DO_TESTE.map(() => '?').join(', ')})`,
        [antes['SGH_TRILHA'] ?? 0, ...OPERACOES_DO_TESTE],
      ),
    );
    return nossas > 0 ? [...r, 'SGH_TRILHA'] : r;
  };
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('inativação pela coluna de situação (executor) e só no novo (SGH_CFG_DOMINIO_SITUACAO), tudo desfeito', async () => {
    const fotografia = await retrato();
    const antes = await a.nucleo.lerSomente(ctx(a), (l) => lerInativosSoNoNovo(l, soNoNovo.tabela));
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      // 1. Pela coluna de situação do legado: inclui um item sintético e inativa pelo executor.
      const inc = await a.executor.executar(
        operacao(operacaoDoDominio(comSituacao.publico, 'incluir')),
        a.cod,
        await valoresDeInclusao(e, comSituacao),
        ctxOperacao(a, 'SGH.M14'),
        { escritor: e },
      );
      const codigo = String(inc.resultado['codigo']);
      const lido = await itemDoDominio(e, comSituacao, codigo);
      await a.executor.executar(
        operacao(operacaoDoDominio(comSituacao.publico, 'inativar')),
        a.cod,
        { codigo, versao: lido!.versao, confirmarEmUso: true },
        ctxOperacao(a, 'SGH.M14'),
        { escritor: e },
      );
      expect((await itemDoDominio(e, comSituacao, codigo))?.ativo).toBe(false);
      // 2. Só no novo: a tabela sem coluna de situação não muda; a situação e a trilha vão às tabelas SGH_.
      const lista = await listarDominio(e, soNoNovo);
      const alvo = lista.itens.find((i) => i.ativo && Number(i.codigo) > 0)!;
      const linhasAntes = await contar(e, `SELECT COUNT(*) N FROM ${soNoNovo.tabela}`);
      const trilhaAntes = await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA');
      await inativarSoNoNovo(
        e,
        soNoNovo,
        { codigo: alvo.codigo, versao: alvo.versao, usuario: 'SGH.M14', confirmarEmUso: true },
        trilhaSoNoNovo(a, 'internacao.inativarNoNovo'),
      );
      expect(await contar(e, `SELECT COUNT(*) N FROM ${soNoNovo.tabela}`)).toBe(linhasAntes);
      expect(await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA')).toBe(trilhaAntes + 1);
      expect((await lerInativosSoNoNovo(e, soNoNovo.tabela)).has(alvo.codigo)).toBe(true);
      const inativo = await itemDoDominio(e, soNoNovo, alvo.codigo);
      expect(inativo?.ativo).toBe(false);
      // 3. Correção do M14: a reativação desfaz a inativação só no novo (DELETE + trilha), sem tocar o legado.
      await reativarSoNoNovo(
        e,
        soNoNovo,
        { codigo: alvo.codigo, versao: inativo!.versao, usuario: 'SGH.M14' },
        trilhaSoNoNovo(a, 'internacao.reativarNoNovo'),
      );
      expect((await itemDoDominio(e, soNoNovo, alvo.codigo))?.ativo).toBe(true);
      expect(await contar(e, `SELECT COUNT(*) N FROM ${soNoNovo.tabela}`)).toBe(linhasAntes);
      expect(await contar(e, 'SELECT COUNT(*) N FROM SGH_TRILHA')).toBe(trilhaAntes + 2);
    });
    // Desfeito: nada ficou na cópia (legado, trilha dupla e SGH_).
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => lerInativosSoNoNovo(l, soNoNovo.tabela));
    expect(depois).toEqual(antes);
    expect(await diferencas(fotografia)).toEqual([]);
    console.log(
      `[${a.cod}] inativação: ${comSituacao.tabela} pela situação; ${soNoNovo.tabela} só no novo (desfeitas)`,
    );
  });

  it('consultas do lote: página, contagem com teto e registro pela chave nas pequenas; tempo de cada uma', async () => {
    const pequenas = CONSULTAS_LEGADO.filter((c) => !c.publico.grande && c.chave.length > 0).slice(0, 40);
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      let lidas = 0;
      let maior = 0;
      for (const d of pequenas) {
        const t0 = performance.now();
        const p = await paginaDaConsulta(l, d, [], null, 5);
        const n = await contarConsulta(l, d, []);
        expect(p.linhas.length).toBeLessThanOrEqual(5);
        expect(n.valor).toBeGreaterThanOrEqual(p.linhas.length);
        const primeira = p.linhas[0];
        if (primeira) {
          const chave = d.chave.map((k) =>
            String(primeira[d.colunas.find((c) => c.coluna === k)!.campo] ?? ''),
          );
          // Correção do M14: também as de chave com data e hora (o valor leva os segundos e as frações).
          const reg = await registroDaConsulta(l, d, chave);
          expect(reg, d.publico.recurso).not.toBeNull();
          lidas++;
        }
        maior = Math.max(maior, performance.now() - t0);
      }
      return { lidas, maior };
    });
    expect(r.maior).toBeLessThan(15_000);
    console.log(
      `[${a.cod}] ${pequenas.length} consultas: ${r.lidas} com linhas; mais lenta ${Math.round(r.maior)} ms`,
    );
  });

  it('correção do M14: consultas com data e hora na chave — duas páginas sem repetir e o registro aberto pela chave', async () => {
    const comDataHora = CONSULTAS_LEGADO.filter(
      (c) =>
        !c.publico.grande && c.chave.some((k) => c.colunas.find((x) => x.coluna === k)?.tipo === 'dataHora'),
    );
    expect(comDataHora.length).toBeGreaterThanOrEqual(5);
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      let comDuas = 0;
      for (const d of comDataHora) {
        const campos = d.chave.map((k) => d.colunas.find((c) => c.coluna === k)!.campo);
        const p1 = await paginaDaConsulta(l, d, [], null, 3);
        const chaves = (p: typeof p1) => p.linhas.map((x) => campos.map((c) => String(x[c] ?? '')).join('|'));
        for (const linha of p1.linhas.slice(0, 1))
          expect(
            await registroDaConsulta(
              l,
              d,
              campos.map((c) => String(linha[c] ?? '')),
            ),
            d.publico.recurso,
          ).not.toBeNull();
        if (!p1.proxima) continue;
        const p2 = await paginaDaConsulta(l, d, [], p1.proxima, 3);
        const primeira = new Set(chaves(p1));
        expect(
          chaves(p2).some((k) => primeira.has(k)),
          d.publico.recurso,
        ).toBe(false);
        comDuas++;
      }
      return comDuas;
    });
    console.log(`[${a.cod}] ${comDataHora.length} consultas com data e hora na chave; ${r} com duas páginas`);
  });

  it('tabela grande: exige filtro; com filtro de período a página sai; consulta pesada é cancelada pelo tempo', async () => {
    const grandes = CONSULTAS_LEGADO.filter((c) => c.publico.grande);
    expect(grandes.length).toBeGreaterThan(0);
    expect(grandes.every((d) => exigeFiltro(d))).toBe(true);
    const comPeriodo = grandes.find((d) => d.colunas.some((c) => c.filtro === 'periodo'));
    await a.nucleo.lerSomente(ctx(a), async (l) => {
      if (comPeriodo) {
        const campo = comPeriodo.colunas.find((c) => c.filtro === 'periodo')!.campo;
        const t0 = performance.now();
        const p = await paginaDaConsulta(
          l,
          comPeriodo,
          [{ campo, modo: 'periodo', de: '2026-07-01', ate: '2026-07-02' }],
          null,
        );
        expect(p.linhas.length).toBeLessThanOrEqual(100);
        expect(performance.now() - t0).toBeLessThan(15_000);
      }
      const maior = grandes[0]!;
      await expect(
        l.consultar(`SELECT COUNT(*) N FROM ${maior.tabela} a CROSS JOIN ${maior.tabela} b`, [], {
          teto: 1,
          tempoMaximoMs: 300,
        }),
      ).rejects.toBeInstanceOf(ErroTempoEsgotado);
    });
  });

  it('correção do M14: inativação só no novo numa sessão "como" e o Corrigir a desfaz (item ativo de novo)', async () => {
    limparMetadadosComo();
    const fotografia = await retrato();
    const marca: MarcaComo = {
      sessao: '999014001',
      acao: '999014002',
      atorTipo: 'suporte',
      idConta: '999014003',
      alvo: 'SINT.SGH.SUPORTE',
    };
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const como = comImagens(e, marca, a.nucleo.rede);
      const alvo = (await listarDominio(e, soNoNovo)).itens.find((i) => i.ativo && Number(i.codigo) > 0)!;
      await inativarSoNoNovo(
        como,
        soNoNovo,
        { codigo: alvo.codigo, versao: alvo.versao, usuario: 'SGH.M14', confirmarEmUso: true },
        trilhaSoNoNovo(a, 'internacao.inativarNoNovo'),
      );
      const inativo = (await itemDoDominio(e, soNoNovo, alvo.codigo))?.ativo;
      const imagens = await lerImagens(e, marca.sessao);
      const feitas = await executarCorrecao(
        e,
        imagens,
        { atorTipo: 'suporte', idConta: marca.idConta },
        false,
      );
      return {
        inativo,
        imagens: imagens.filter((i) => i.tabela === 'SGH_CFG_DOMINIO_SITUACAO').length,
        feitas: feitas.length,
        ativoDepois: (await itemDoDominio(e, soNoNovo, alvo.codigo))?.ativo,
      };
    });
    expect(r).toMatchObject({ inativo: false, imagens: 1, ativoDepois: true });
    expect(r.feitas).toBeGreaterThan(0);
    expect(await diferencas(fotografia)).toEqual([]);
    console.log(`[${a.cod}] "como": inativação só no novo corrigida (${r.feitas} passo(s); desfeito)`);
  });

  it('vigia das tabelas vazias: fora das povoadas, sem linha; gravação desfeita', async () => {
    const fotografia = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const fora = (await tabelasForaDaLista(e, new Set())).slice(0, 30);
      const comLinha = await tabelasComLinha(e, fora);
      const vazias = fora.filter((t) => !comLinha.includes(t));
      const v = await gravarVigia(e, { rede: a.nucleo.rede, hospital: a.cod, vazias, comDados: [] });
      return { fora: fora.length, vazias: v.vazias };
    });
    expect(r.fora).toBeGreaterThan(0);
    expect(await diferencas(fotografia)).toEqual([]);
    console.log(`[${a.cod}] vigia: ${r.fora} tabelas olhadas, ${r.vazias} vazias (desfeito)`);
  });

  it.skipIf(codigos.length > 1)('dois hospitais: Bloqueio HS-1 (só o pc tem cópia)', () => {
    expect(codigos).toEqual(['pc']);
  });
});
