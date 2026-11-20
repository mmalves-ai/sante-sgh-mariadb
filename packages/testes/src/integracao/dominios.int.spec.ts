// Receita genérica do CRUD genérico na cópia (ficha do M08, seção 10): incluir, alterar e inativar nas 16
// tabelas editáveis do lote-piloto e a leitura das 20 (as 4 de sistema só consulta), pelo EXECUTOR, sempre
// na transação desfeita da cópia; `LOCK TIMEOUT` com a linha travada por outra conexão (409 registro em
// edição, nada gravado); colisão por linha alterada por fora (409 conflito de versão); charset (descrição
// acentuada do corpus CP1252, ida e volta sem U+FFFD). Saída só com contagens e códigos; massa "SGH M08".
import { type DeclaracaoDominio, operacaoDoDominio } from '@sgh/contratos';
import { DECLARACOES, ErroOperacao, itemDoDominio, listarDominio, operacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itemAtivo, textoSintetico, valoresDeAlteracao, valoresDeInclusao } from '../massa/dominios.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

const operacaoDoDominioNome = (d: DeclaracaoDominio, v: 'incluir' | 'alterar' | 'inativar') =>
  operacaoDoDominio(d.publico, v);
// M10: as editáveis sem inclusão (unidade, centro de custo, local: só alterar e inativar) e o domínio sem
// código livre na cópia (a faixa inteira usada) ficam fora do laço de inclusão; a assinatura as prova.
// M50.5 (D-GEN-50-5): os tipos de visitante e de destino da portaria também ficam fora: a inclusão está desligada e
// cada rodada andaria o gerador das cópias (o gerador não volta no ROLLBACK); a assinatura as prova.
const SEM_INCLUSAO_NO_LACO: ReadonlySet<string> = new Set(['CVTPVISITANTE', 'CVTPVISITADO']);
const editaveis = DECLARACOES.filter(
  (d) =>
    d.publico.natureza === 'editavel' &&
    d.publico.acoes.includes('criar') &&
    !SEM_INCLUSAO_NO_LACO.has(d.tabela),
);

describe.skipIf(!PODE_ESCREVER)('CRUD genérico na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });
  /**
   * Correção do M14: retrato fora da transação — contagem de cada tabela editável, maior chave da trilha dupla e
   * da outbox; a SGH_TRILHA conta só as linhas destes testes (usuário SGH.M08) acima da maior chave de antes.
   */
  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => {
      const r: Record<string, number> = {};
      for (const d of editaveis) r[d.tabela] = await contar(l, `SELECT COUNT(*) N FROM ${d.tabela}`);
      r['TBCABTRILHA'] = await contar(l, 'SELECT MAX(ID) N FROM TBCABTRILHA');
      r['TBLANTRILHASGH'] = await contar(l, 'SELECT MAX(ID_TBCABTRILHA) N FROM TBLANTRILHASGH');
      r['SGH_OUTBOX'] = await contar(l, 'SELECT COALESCE(MAX(ID), 0) N FROM SGH_OUTBOX');
      r['SGH_TRILHA'] = await contar(l, 'SELECT MAX(ID) N FROM SGH_TRILHA');
      return r;
    });
  const diferencas = async (antes: Record<string, number>) => {
    const depois = await retrato();
    const r = Object.keys(antes).filter((t) => t !== 'SGH_TRILHA' && antes[t] !== depois[t]);
    const nossas = await a.nucleo.lerSomente(ctx(a), (l) =>
      contar(l, "SELECT COUNT(*) N FROM SGH_TRILHA WHERE ID > ? AND USUARIO = 'SGH.M08'", [
        antes['SGH_TRILHA'] ?? 0,
      ]),
    );
    return nossas > 0 ? [...r, 'SGH_TRILHA'] : r;
  };

  it('as 20 tabelas leem pela declaração (teto, ordem pela chave, versão); as 4 de sistema sem operação', async () => {
    const r = await a.nucleo.lerSomente(ctx(a), async (l) => {
      const contagens: Record<string, number> = {};
      for (const d of DECLARACOES) {
        const lista = await listarDominio(l, d);
        expect(lista.truncada, d.tabela).toBe(false);
        expect(lista.itens.every((i) => i.versao.length > 2)).toBe(true);
        contagens[d.tabela] = lista.itens.length;
      }
      return contagens;
    });
    expect(Object.keys(r)).toHaveLength(DECLARACOES.length);
    // Sem contagem fixa: a cópia é compartilhada (a sante-api pode gravar nela); cada domínio tem linhas.
    expect(Object.values(r).every((n) => n > 0)).toBe(true);
    const total = Object.values(r).reduce((x, y) => x + y, 0);
    console.log(`[${a.cod}] ${DECLARACOES.length} domínios lidos: ${total} linhas (teto de 500 por tabela)`);
  });

  it('incluir, alterar e inativar nas 16 editáveis pelo executor (prova pós-escrita), tudo desfeito', async () => {
    const feitos: string[] = [];
    const semCodigo: string[] = [];
    const fotografia = await retrato();
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      for (const d of editaveis) {
        let v: Awaited<ReturnType<typeof valoresDeInclusao>>;
        try {
          v = await valoresDeInclusao(e, d);
        } catch (x) {
          if (String((x as Error).message).includes('nenhum código')) {
            semCodigo.push(d.tabela);
            continue;
          }
          throw x;
        }
        const inc = await a.executor.executar(
          operacao(operacaoDoDominioNome(d, 'incluir')),
          a.cod,
          v,
          ctxOperacao(a, 'SGH.M08'),
          { escritor: e },
        );
        const codigo = String(inc.resultado['codigo']);
        feitos.push(`${d.tabela}:incluir`);
        const lido = await itemDoDominio(e, d, codigo);
        expect(lido?.ativo).toBe(true);
        if (d.publico.acoes.includes('editar')) {
          const novos = await valoresDeAlteracao(e, d, lido!.valores, codigo);
          await a.executor.executar(
            operacao(operacaoDoDominioNome(d, 'alterar')),
            a.cod,
            { codigo, versao: lido!.versao, valores: novos },
            ctxOperacao(a, 'SGH.M08'),
            { escritor: e },
          );
          feitos.push(`${d.tabela}:alterar`);
        }
        // M14: sem coluna de situação a inativação é só no novo (m14.int.spec.ts), sem receita no legado.
        if (d.publico.acoes.includes('inativar') && d.situacao) {
          const atual = await itemDoDominio(e, d, codigo);
          await a.executor.executar(
            operacao(operacaoDoDominioNome(d, 'inativar')),
            a.cod,
            { codigo, versao: atual!.versao },
            ctxOperacao(a, 'SGH.M08'),
            { escritor: e },
          );
          expect((await itemDoDominio(e, d, codigo))?.ativo).toBe(false);
          feitos.push(`${d.tabela}:inativar`);
        }
      }
    });
    const esperado = editaveis
      .filter((d) => !semCodigo.includes(d.tabela))
      .reduce(
        (n, d) =>
          n +
          1 +
          (d.publico.acoes.includes('editar') ? 1 : 0) +
          (d.publico.acoes.includes('inativar') && d.situacao ? 1 : 0),
        0,
      );
    expect(feitos).toHaveLength(esperado);
    if (semCodigo.length)
      console.log(`[${a.cod}] sem código livre na cópia (fora do laço): ${semCodigo.join(', ')}`);
    // Fora da transação: nada ficou (o código sintético some com o ROLLBACK).
    const restos = await a.nucleo.lerSomente(ctx(a), async (l) => {
      let n = 0;
      for (const d of editaveis)
        n += (await listarDominio(l, d)).itens.filter((i) =>
          Object.values(i.valores).some((x) => String(x ?? '').includes('M08')),
        ).length;
      return n;
    });
    expect(restos).toBe(0);
    // Correção do M14: contagens das tabelas do legado, da trilha dupla e das SGH_ iguais depois do ROLLBACK.
    expect(await diferencas(fotografia)).toEqual([]);
    console.log(
      `[${a.cod}] receita genérica: ${feitos.length} operações nas ${editaveis.length} editáveis, desfeitas; 0 resto`,
    );
  });

  it('LOCK TIMEOUT: linha travada por outra conexão → 409 registro em edição, nada gravado', async () => {
    const d = DECLARACOES.find((x) => x.tabela === 'TBRELIG')!;
    const item = await a.nucleo.lerSomente(ctx(a), (l) => itemAtivo(l, d));
    let codigo = '';
    await a.nucleo.desfazendoNaCopia(ctx(a), async (trava) => {
      // Outra conexão segura a linha (SELECT … WITH LOCK numa transação de escrita desfeita).
      await trava.consultar('SELECT COD FROM TBRELIG WHERE COD = ? WITH LOCK', [Number(item.codigo)], {
        teto: 1,
      });
      const inicio = Date.now();
      try {
        await a.executor.executar(
          operacao(operacaoDoDominioNome(d, 'alterar')),
          a.cod,
          { codigo: item.codigo, versao: item.versao, valores: { nome: textoSintetico(30, 'TRAVA') } },
          ctxOperacao(a, 'SGH.M08'),
          { desfazer: true },
        );
      } catch (e) {
        codigo = e instanceof ErroOperacao ? (e.problema.codigo ?? '') : 'outro';
      }
      console.log(
        `[${a.cod}] linha travada: ${codigo} depois de ${Math.round((Date.now() - inicio) / 100) / 10} s`,
      );
    });
    expect(codigo).toBe('registro-em-edicao');
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => itemDoDominio(l, d, item.codigo));
    expect(depois?.versao).toBe(item.versao);
  });

  it('colisão: a linha mudou por fora desde a leitura → 409 conflito de versão com os campos', async () => {
    const d = DECLARACOES.find((x) => x.tabela === 'TBMOTEXC')!;
    let colunas: readonly string[] = [];
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const lido = await itemAtivo(e, d);
      await a.executor.executar(
        operacao(operacaoDoDominioNome(d, 'alterar')),
        a.cod,
        { codigo: lido.codigo, versao: lido.versao, valores: { nome: textoSintetico(50, 'FORA') } },
        ctxOperacao(a, 'SGH.M08'),
        { escritor: e },
      );
      try {
        await a.executor.executar(
          operacao(operacaoDoDominioNome(d, 'alterar')),
          a.cod,
          { codigo: lido.codigo, versao: lido.versao, valores: { nome: textoSintetico(50, 'VELHA') } },
          ctxOperacao(a, 'SGH.M08'),
          { escritor: e },
        );
      } catch (x) {
        if (x instanceof ErroOperacao && x.problema.codigo === 'conflito-versao')
          colunas = x.problema.colunas ?? [];
      }
    });
    expect(colunas).toEqual(['nome']);
  });

  it('charset: descrição acentuada do corpus CP1252 grava e relê igual (sem U+FFFD); emoji recusado antes do banco', async () => {
    const d = DECLARACOES.find((x) => x.tabela === 'TBMOTEXC')!;
    const acentuada = 'SGH M08 ÁÉÍÓÚ ÂÊÔ ÃÕ ÇÜ àèìòù';
    let relida = '';
    await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const v = await valoresDeInclusao(e, d);
      const r = await a.executor.executar(
        operacao(operacaoDoDominioNome(d, 'incluir')),
        a.cod,
        { ...v, nome: acentuada },
        ctxOperacao(a, 'SGH.M08'),
        { escritor: e },
      );
      relida = String((await itemDoDominio(e, d, String(r.resultado['codigo'])))?.valores['nome'] ?? '');
    });
    expect(relida).toBe(acentuada);
    expect(relida).not.toContain('�');
    let codigo = '';
    try {
      await a.executor.executar(
        operacao(operacaoDoDominioNome(d, 'incluir')),
        a.cod,
        { codigo: 30000, nome: 'SGH M08 😀' },
        ctxOperacao(a, 'SGH.M08'),
        { desfazer: true },
      );
    } catch (e) {
      codigo = e instanceof ErroOperacao ? (e.problema.codigo ?? '') : 'outro';
    }
    expect(codigo).toBe('entrada-invalida');
  });
});
