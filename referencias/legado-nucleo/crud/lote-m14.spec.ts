// Lote do M14 no banco EM MEMÓRIA dos domínios (nada conecta a banco): para cada domínio editável do lote, o
// executor inclui um item sintético, relê, altera (quando a declaração edita) e inativa (quando há coluna de
// situação), pela receita genérica e com a prova pós-escrita; e a receita com pendência de prova (POL-3) sai
// completa, com o motivo no que o novo não faz e na recusa fora de desenvolvimento. Dados SINTÉTICOS.
import { type DeclaracaoDominio, operacaoDoDominio, type ValorCampo } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { DECLARACOES } from '../../cadastros.js';
import { operacao } from '../../operacoes.js';
import { ErroOperacao } from '../erros-operacao.js';
import type { ContextoOperacao } from '../operacao.js';
import { BancoMemoriaDominios } from './memoria.js';
import { colunaDaChave } from './declaracao.js';
import { itemDoDominio, listarDominio } from './repositorio.js';

let seq = 0;
const ctx = (): ContextoOperacao => ({
  rede: 'rede-teste',
  hospital: 'aa',
  traceId: 'teste-m14',
  usuarioLegado: 'SGH.TESTE',
  idempotencyKey: `chave-m14-${++seq}`,
  reautenticadoEm: Date.now(),
});
const catalogo = { estado: () => 'especificada' as const };
const lote = DECLARACOES.filter(
  (d) => d.publico.marco === 'M14' && d.publico.natureza === 'editavel' && d.publico.acoes.includes('criar'),
);

/** Valores de inclusão a partir de um item existente: textos novos (únicos), o resto copiado. */
function valoresNovos(d: DeclaracaoDominio, base: Readonly<Record<string, ValorCampo>>, n: number) {
  const chave = colunaDaChave(d);
  const v: Record<string, ValorCampo> = {};
  for (const c of d.colunas.filter((x) => x.naInclusao)) {
    if (c.tipo === 'texto' && !c.valores) {
      const t = `S${n}${String(Date.now()).slice(-4)}`;
      v[c.campo] = t.slice(Math.max(0, t.length - (c.maxBytes ?? 10)));
    } else if (c.coluna === d.chave && chave.codigo === 'manual' && c.tipo === 'inteiro')
      v[c.campo] = Math.min(c.maximo ?? 9_999, 900 + n);
    else v[c.campo] = base[c.campo] ?? null;
  }
  return v;
}

describe('lote do M14 em memória (receita genérica pelo executor)', () => {
  it('incluir, alterar e inativar nos domínios editáveis do lote; a maioria passa inteira', async () => {
    const banco = new BancoMemoriaDominios(DECLARACOES);
    const executor = banco.criarExecutor(catalogo, 'dev');
    const feitos: string[] = [];
    const recusados: string[] = [];
    let n = 0;
    for (const d of lote) {
      n++;
      try {
        const lista = await banco.ler('aa', (l) => listarDominio(l, d));
        const base = lista.itens[lista.itens.length - 1];
        if (!base) continue;
        const inc = await executor.executar(
          operacao(operacaoDoDominio(d.publico, 'incluir')),
          'aa',
          valoresNovos(d, base.valores, n),
          ctx(),
        );
        const codigo = String(inc.resultado['codigo']);
        const lido = await banco.ler('aa', (l) => itemDoDominio(l, d, codigo));
        expect(lido?.ativo).toBe(true);
        let versao = lido!.versao;
        if (d.publico.acoes.includes('editar')) {
          const desc = d.colunas.find((c) => c.campo === d.descricao);
          if (desc?.editavel && desc.tipo === 'texto') {
            const t = `A${n}`;
            await executor.executar(
              operacao(operacaoDoDominio(d.publico, 'alterar')),
              'aa',
              { codigo, versao, valores: { [d.descricao]: t } },
              ctx(),
            );
            versao = (await banco.ler('aa', (l) => itemDoDominio(l, d, codigo)))!.versao;
          }
        }
        if (d.situacao) {
          await executor.executar(
            operacao(operacaoDoDominio(d.publico, 'inativar')),
            'aa',
            { codigo, versao, confirmarEmUso: true },
            ctx(),
          );
          expect((await banco.ler('aa', (l) => itemDoDominio(l, d, codigo)))?.ativo).toBe(false);
        }
        feitos.push(d.tabela);
      } catch (e) {
        if (!(e instanceof ErroOperacao)) throw e;
        recusados.push(`${d.tabela}: ${e.problema.codigo}`);
      }
    }
    // As recusas de negócio (código livre da faixa, duplicidade da massa simples) ficam para a assinatura na cópia.
    console.log(
      `[M14 em memória] ${lote.length} editáveis com inclusão: ${feitos.length} inteiros, ${recusados.length} recusados`,
    );
    expect(feitos.length).toBeGreaterThan(lote.length * 0.6);
  });

  it('pendência de prova (POL-3): receita completa, motivo no que o novo não faz e na recusa fora de dev', async () => {
    const exame = DECLARACOES.find((d) => d.pendenteDeProva && d.publico.acoes.includes('editar'))!;
    const alterar = operacao(operacaoDoDominio(exame.publico, 'alterar'));
    expect(alterar.receita.pendente).toBe(exame.pendenteDeProva!.motivo);
    expect(alterar.receita.naoFaz.some((x) => x.startsWith('ainda não grava:'))).toBe(true);
    // Correção do M14: a inativação fica desligada só onde o histórico guarda a situação (kit, princípio ativo).
    const inativar = operacao(operacaoDoDominio(exame.publico, 'inativar')).receita.pendente;
    expect(inativar).toBe(
      exame.pendenteDeProva!.verbos.includes('inativar') ? exame.pendenteDeProva!.motivo : undefined,
    );
    for (const d of DECLARACOES.filter((x) => x.pendenteDeProva?.verbos.includes('inativar') && x.situacao))
      expect(operacao(operacaoDoDominio(d.publico, 'inativar')).receita.pendente).toBe(
        d.pendenteDeProva!.motivo,
      );
    // Os itens do kit mudam o retrato do kit: incluir e alterar item também ficam desligados.
    const itemKit = DECLARACOES.find((x) => x.tabela === 'SIKITITE')!;
    for (const v of ['incluir', 'alterar'] as const)
      expect(operacao(operacaoDoDominio(itemKit.publico, v)).receita.pendente).toMatch(/retrato do kit/);
    const banco = new BancoMemoriaDominios(DECLARACOES);
    const homolog = banco.criarExecutor(catalogo, 'homologacao');
    const item = (await banco.ler('aa', (l) => listarDominio(l, exame))).itens[0]!;
    try {
      await homolog.executar(alterar, 'aa', { codigo: item.codigo, versao: item.versao, valores: {} }, ctx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroOperacao);
      expect((e as ErroOperacao).problema.detail).toContain(`Falta provar: ${exame.pendenteDeProva!.motivo}`);
    }
  });
});

describe('correção do M14: consultas ligadas ao mestre (histórico do exame e do kit)', () => {
  it('cada consulta do mestre-detalhe existe e filtra (igual) pelos campos ligados; o mestre tem o campo de origem', async () => {
    const { MESTRE_DETALHE } = await import('@sgh/contratos');
    const { CONSULTAS_LEGADO } = await import('../../index.js');
    let n = 0;
    for (const md of Object.values(MESTRE_DETALHE)) {
      const mestre = DECLARACOES.find((d) => `${d.publico.modulo}.${d.publico.recurso}` === md!.mestre)!;
      for (const c of md!.consultas ?? []) {
        const d = CONSULTAS_LEGADO.find((x) => `${x.publico.modulo}.${x.publico.recurso}` === c.consulta);
        expect(d, c.consulta).toBeDefined();
        for (const f of c.filtros) {
          expect(d!.colunas.find((x) => x.campo === f.campo)?.filtro, `${c.consulta}.${f.campo}`).toBe(
            'igual',
          );
          expect(f.deCampo === 'codigo' || mestre.colunas.some((x) => x.campo === f.deCampo)).toBe(true);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(4);
    // M32: a importação fria do índice do legado (todas as declarações) passa de 5 s na VM compartilhada.
  }, 30_000);
});

describe('correção do M14: documento, nome e credencial nas consultas', () => {
  it('nas consultas com pessoa ou clínicas, documento e contato de pessoa saem mascarados; credencial nunca sai', async () => {
    const { CONSULTAS_LEGADO } = await import('../../index.js');
    const DOC = /^(?!ID_).*(?:CPF|CNS|NUM_IDENT|^RG$|_RG$|FONE|CELULAR|EMAIL|ENDERECO|LOGRADOURO)/;
    const soltas: string[] = [];
    for (const d of CONSULTAS_LEGADO) {
      for (const c of d.colunas) {
        expect(c.coluna, `${d.tabela}.${c.coluna}`).not.toMatch(
          /SENHA|SALT|HASH|DIGEST|CIFRA|TOKEN|PASSWORD/,
        );
        if (d.publico.classe !== 'comum' && DOC.test(c.coluna) && !d.chave.includes(c.coluna) && !c.mascarada)
          soltas.push(`${d.tabela}.${c.coluna}`);
      }
      // Tabela com nome e prontuário (ou registro) de paciente nunca é comum.
      const nomes = d.colunas.map((c) => c.coluna);
      if (nomes.includes('NOME') && nomes.some((n) => /^(?:PRONT|REG)$/.test(n)))
        expect(d.publico.classe, d.tabela).not.toBe('comum');
    }
    expect(soltas).toEqual([]);
    expect(CONSULTAS_LEGADO.some((d) => d.tabela === 'TBHISTSENHA')).toBe(false);
  });
});
